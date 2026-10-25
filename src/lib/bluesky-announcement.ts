import { getWeeknoteStrings } from "./weeknotes";
import { isReadOnlyReplica } from "./deployment";
import type { AnnouncementJob } from "./bluesky-announcement-store";

export const announcementDid = "did:plc:jrrhosrfzgjf6v4oydav6ftb";
export const announcementSite = "https://ovyerus.com";
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

export interface AnnouncementConfig {
  pdsUrl: string;
  password: string;
  siteUrl: string;
}

export function announcementConfig(): AnnouncementConfig | null {
  if (
    isReadOnlyReplica() ||
    process.env.NODE_ENV !== "production" ||
    process.env.BLUESKY_ANNOUNCE_ENABLED !== "true"
  ) {
    return null;
  }
  const password = process.env.BLUESKY_APP_PASSWORD;
  const pds = process.env.BLUESKY_PDS_URL;
  if (!password || !pds) {
    throw new Error(
      "Bluesky announcements require BLUESKY_APP_PASSWORD and BLUESKY_PDS_URL.",
    );
  }
  const url = new URL(pds);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("BLUESKY_PDS_URL must be an HTTPS origin.");
  }
  return { pdsUrl: url.origin, password, siteUrl: announcementSite };
}

export function announcementText(
  teaser: string,
  slug: string,
  siteUrl = announcementSite,
) {
  const link = new URL(`/weeknotes/${slug}`, siteUrl).href;
  const prefix = `#weeknotes: ${teaser.trim()}\n\n`;
  const text = prefix + link;
  let graphemes = 0;
  for (const _ of segmenter.segment(text)) {
    if (++graphemes > 300) {
      throw new Error(
        "Bluesky announcement must fit in 300 characters including #weeknotes and the article link.",
      );
    }
  }
  if (Buffer.byteLength(text) > 3000) {
    throw new Error(
      "Bluesky announcement exceeds Bluesky's 3000-byte text limit.",
    );
  }
  return {
    text,
    facets: [
      {
        index: { byteStart: 0, byteEnd: 10 },
        features: [{ $type: "app.bsky.richtext.facet#tag", tag: "weeknotes" }],
      },
      {
        index: {
          byteStart: Buffer.byteLength(prefix),
          byteEnd: Buffer.byteLength(text),
        },
        features: [{ $type: "app.bsky.richtext.facet#link", uri: link }],
      },
    ],
  };
}

class PdsError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    method: string,
  ) {
    super(`Bluesky ${method} failed (${status}, ${code}).`);
  }
}

interface XrpcResult {
  error?: unknown;
  uri?: unknown;
  cid?: unknown;
  did?: unknown;
  accessJwt?: unknown;
  blob?: {
    $type?: unknown;
    ref?: { $link?: unknown };
    mimeType?: unknown;
    size?: unknown;
  };
  value?: {
    $type?: unknown;
    text?: unknown;
    embed?: { external?: { uri?: unknown } };
  };
}

async function xrpc(
  config: AnnouncementConfig,
  method: string,
  options: {
    body?: unknown;
    token?: string;
    query?: Record<string, string>;
    image?: ArrayBuffer;
  } = {},
): Promise<XrpcResult> {
  const url = new URL(`/xrpc/${method}`, config.pdsUrl);
  if (options.query) url.search = new URLSearchParams(options.query).toString();
  const res = await fetch(url, {
    method: options.body !== undefined || options.image ? "POST" : "GET",
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.image
        ? { "Content-Type": "image/png" }
        : options.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
    },
    ...(options.image
      ? { body: options.image }
      : options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {}),
    signal: AbortSignal.timeout(10_000),
    redirect: "error",
  });
  let result: XrpcResult;
  try {
    const parsed: unknown = await res.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Invalid response");
    }
    result = parsed as XrpcResult;
  } catch {
    throw new Error(`Bluesky ${method} returned invalid JSON (${res.status}).`);
  }
  if (!res.ok) {
    // Never persist server-supplied messages or arbitrary error codes.
    const code =
      result.error === "RecordNotFound" ? "RecordNotFound" : "RequestFailed";
    throw new PdsError(code, res.status, method);
  }
  return result;
}

function postReference(result: XrpcResult, rkey: string) {
  const uri = `at://${announcementDid}/app.bsky.feed.post/${rkey}`;
  if (result.uri !== uri || typeof result.cid !== "string" || !result.cid) {
    throw new Error("Bluesky returned an unexpected post reference.");
  }
  return { uri, cid: result.cid as string };
}

/** Recover an earlier successful create before attempting another network write. */
export async function publishAnnouncement(
  job: AnnouncementJob,
  config: AnnouncementConfig,
) {
  const { text, facets } = announcementText(job.text, job.slug, config.siteUrl);
  const link = new URL(`/weeknotes/${job.slug}`, config.siteUrl).href;
  const session = await xrpc(config, "com.atproto.server.createSession", {
    body: { identifier: announcementDid, password: config.password },
  });
  if (
    session.did !== announcementDid ||
    typeof session.accessJwt !== "string"
  ) {
    throw new Error(
      "Bluesky credentials do not belong to the configured announcement account.",
    );
  }
  const token = session.accessJwt as string;
  const findExisting = async () => {
    try {
      const existing = await xrpc(config, "com.atproto.repo.getRecord", {
        token,
        query: {
          repo: announcementDid,
          collection: "app.bsky.feed.post",
          rkey: job.rkey,
        },
      });
      if (
        existing.value?.$type !== "app.bsky.feed.post" ||
        existing.value?.text !== text ||
        existing.value?.embed?.external?.uri !== link
      ) {
        throw new Error(
          "Bluesky announcement record key is already occupied by a different post.",
        );
      }
      return postReference(existing, job.rkey);
    } catch (error) {
      if (error instanceof PdsError && error.code === "RecordNotFound")
        return null;
      throw error;
    }
  };
  const existing = await findExisting();
  if (existing) return existing;

  const image = await fetch(
    new URL(`/og/weeknotes/${job.slug}.png`, config.siteUrl),
    {
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    },
  );
  if (
    !image.ok ||
    !image.headers.get("content-type")?.startsWith("image/png")
  ) {
    throw new Error(
      "Unable to load the published weeknote's PNG preview image.",
    );
  }
  const bytes = await image.arrayBuffer();
  if (bytes.byteLength > 1_000_000) {
    throw new Error(
      "Weeknote preview image exceeds Bluesky's 1 MB image limit.",
    );
  }
  const uploaded = await xrpc(config, "com.atproto.repo.uploadBlob", {
    token,
    image: bytes,
  });
  if (
    uploaded.blob?.$type !== "blob" ||
    typeof uploaded.blob?.ref?.$link !== "string"
  ) {
    throw new Error("Bluesky returned an invalid preview image blob.");
  }
  const { title, sentence } = getWeeknoteStrings(job.slug);
  try {
    const created = await xrpc(config, "com.atproto.repo.createRecord", {
      token,
      body: {
        repo: announcementDid,
        collection: "app.bsky.feed.post",
        rkey: job.rkey,
        record: {
          $type: "app.bsky.feed.post",
          text,
          facets,
          langs: ["en"],
          createdAt: job.createdAt,
          embed: {
            $type: "app.bsky.embed.external",
            external: {
              uri: link,
              title,
              description:
                job.description ||
                `My weekly journal-ish entry for ${sentence}.`,
              thumb: uploaded.blob,
            },
          },
        },
      },
    });
    return postReference(created, job.rkey);
  } catch (error) {
    // A response can be lost after commit, or a lease can expire in flight.
    const recovered = await findExisting();
    if (recovered) return recovered;
    throw error;
  }
}
