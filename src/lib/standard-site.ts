import { createHash } from "node:crypto";
import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";
import { getWeeknoteStrings } from "./weeknotes";

export type StandardCollection = "posts" | "weeknotes";
export interface PublishedArticle {
  collection: StandardCollection;
  entryId: string;
  slug: string;
  /** Only the immutable live revision, never mutable draft data. */
  data: Record<string, unknown>;
  publishedAt: string;
  updatedAt: string;
}
export const standardDid = "did:plc:jrrhosrfzgjf6v4oydav6ftb";
export const standardSite = "https://ovyerus.com";
const alphabet = "234567abcdefghijklmnopqrstuvwxyz";
const tidPattern = /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/;
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
const markdown = new MarkdownIt({ html: true, linkify: true });
const maxRecordBytes = 900_000;

function fail(message: string): never {
  throw new Error(`Standard.site ${message}`);
}
function string(
  value: unknown,
  field: string,
  bytes: number,
  graphemes?: number,
): string {
  if (
    typeof value !== "string" ||
    !value.isWellFormed() ||
    Buffer.byteLength(value) > bytes
  )
    fail(`invalid ${field}.`);
  if (graphemes !== undefined) {
    let count = 0;
    for (const _ of segmenter.segment(value))
      if (++count > graphemes) fail(`${field} exceeds its grapheme limit.`);
  }
  return value;
}
function date(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    !Number.isFinite(Date.parse(value))
  )
    fail("invalid date.");
  return new Date(value).toISOString();
}
function boundedRecord(
  record: Record<string, unknown>,
): Record<string, unknown> {
  if (Buffer.byteLength(JSON.stringify(record)) > maxRecordBytes)
    fail("record exceeds 900000 bytes.");
  return record;
}

/** Timestamp microseconds plus a stable 10-bit clock identifier; caller resolves collisions. */
export function makeStandardRkey(timestamp: string, identity: string): string {
  const millis = Date.parse(date(timestamp));
  if (millis < 0) fail("record key date predates the Unix epoch.");
  const hash = createHash("sha256").update(identity).digest();
  let value =
    ((BigInt(millis) * 1000n) << 10n) | BigInt(hash.readUInt16BE(0) & 1023);
  if (value >= 1n << 63n) fail("record key date is out of range.");
  let key = "";
  for (let i = 0; i < 13; i++) {
    key = alphabet[Number(value & 31n)] + key;
    value >>= 5n;
  }
  return key;
}
export const publicationRkey = makeStandardRkey(
  "2026-01-01T00:00:00.000Z",
  "ovyerus.com/publication/v1",
);
export const publicationUri = `at://${standardDid}/site.standard.publication/${publicationRkey}`;
export function documentUri(rkey: string): string {
  if (!tidPattern.test(rkey)) fail("invalid record key.");
  return `at://${standardDid}/site.standard.document/${rkey}`;
}
export function publicationRecord(): Record<string, unknown> {
  return boundedRecord({
    $type: "site.standard.publication",
    url: standardSite,
    name: "Ovyerus",
    preferences: { showInDiscover: true },
  });
}

function decodeEntities(value: string): string {
  return value.replace(
    /&(?:[a-z][a-z0-9]{1,31}|#(?:[0-9]{1,8}|x[a-f0-9]{1,8}));/gi,
    (entity) => markdown.utils.unescapeAll(entity),
  );
}
function usefulUrl(raw: string | undefined, base: string): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(decodeEntities(raw), base);
    if (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password
    )
      return url.href;
  } catch {
    /* Invalid links are not useful plaintext URLs. */
  }
  return undefined;
}
/** Render Markdown, sanitize active HTML, then extract text and useful link/media URLs. */
function plainText(body: unknown, base: string): string {
  const source = string(body, "body", 2_000_000);
  const safe = sanitizeHtml(markdown.render(source), {
    allowedTags: [
      "p",
      "div",
      "br",
      "hr",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "pre",
      "blockquote",
      "ul",
      "ol",
      "li",
      "table",
      "tr",
      "td",
      "th",
      "a",
      "img",
      "video",
      "audio",
      "source",
    ],
    allowedAttributes: {
      a: ["href"],
      img: ["src", "alt"],
      video: ["src", "poster"],
      audio: ["src"],
      source: ["src"],
    },
    allowedSchemes: ["http", "https"],
    nonTextTags: ["script", "style", "textarea", "option"],
  });
  const links: (string | undefined)[] = [];
  let text = "";
  for (const part of safe.match(/<[^>]*>|[^<]+/g) ?? []) {
    if (!part.startsWith("<")) {
      text += decodeEntities(part);
      continue;
    }
    const match = /^<(\/?)([a-z0-9]+)\b/i.exec(part);
    if (!match) continue;
    const closing = match[1] === "/",
      tag = match[2]!;
    const attr = (name: string) =>
      new RegExp(`\\b${name}="([^"]*)"`).exec(part)?.[1];
    if (tag === "a") {
      if (closing) {
        const href = links.pop();
        if (href) text += ` (${href})`;
      } else links.push(usefulUrl(attr("href"), base));
    }
    if (!closing && ["img", "video", "audio", "source"].includes(tag)) {
      const alt = attr("alt");
      if (alt) text += decodeEntities(alt) + " ";
      const urls = new Set([
        usefulUrl(attr("src"), base),
        usefulUrl(attr("poster"), base),
      ]);
      for (const url of urls) if (url) text += ` ${url} `;
    }
    if (
      [
        "p",
        "div",
        "br",
        "hr",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "pre",
        "blockquote",
        "li",
        "tr",
      ].includes(tag)
    )
      text += "\n";
    if (["td", "th"].includes(tag)) text += " ";
  }
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
export function buildDocument(
  article: PublishedArticle,
): Record<string, unknown> {
  const { collection, data, slug } = article;
  if (collection !== "posts" && collection !== "weeknotes")
    fail("invalid collection.");
  if (
    typeof slug !== "string" ||
    !slug ||
    slug === "." ||
    slug === ".." ||
    /[\/?#%\u0000-\u0020\\]/.test(slug)
  )
    fail("invalid slug.");
  const weeknote =
    collection === "weeknotes" ? getWeeknoteStrings(slug) : undefined;
  const path = `/${collection}/${encodeURIComponent(slug)}`;
  const record: Record<string, unknown> = {
    $type: "site.standard.document",
    site: publicationUri,
    path,
    title: string(weeknote?.title ?? data.title, "title", 5000, 500),
    publishedAt: weeknote
      ? weeknote.createdAt.toISOString()
      : date(data.written_at ?? article.publishedAt),
    updatedAt: date(data.modified_at ?? article.updatedAt),
    textContent: plainText(data.body, new URL(path, standardSite).href),
  };
  if (data.description !== undefined && data.description !== null)
    record.description = string(data.description, "description", 30000, 3000);
  if (data.tags !== undefined && data.tags !== null) {
    if (!Array.isArray(data.tags) || data.tags.length > maxRecordBytes / 3)
      fail("invalid tags.");
    record.tags = data.tags.map((tag) => string(tag, "tag", 1280, 128));
  }
  return boundedRecord(record);
}

export interface StandardConfig {
  pdsUrl: string;
  password: string;
}
function pdsOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail("PDS URL must be an HTTPS origin.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.href !== `${url.origin}/`
  )
    fail("PDS URL must be an HTTPS origin.");
  return url.origin;
}
export function standardConfig(
  env: NodeJS.ProcessEnv = process.env,
): StandardConfig | null {
  if (
    env.EMDASH_READ_ONLY !== undefined &&
    env.EMDASH_READ_ONLY !== "true" &&
    env.EMDASH_READ_ONLY !== "false"
  )
    fail("EMDASH_READ_ONLY must be true or false.");
  if (
    env.NODE_ENV !== "production" ||
    env.STANDARD_SITE_ENABLED !== "true" ||
    env.EMDASH_READ_ONLY === "true"
  )
    return null;
  if (env.FLY_APP_NAME || env.FLY_MACHINE_ID || env.PRIMARY_MACHINE_ID) {
    if (!env.FLY_MACHINE_ID || !env.PRIMARY_MACHINE_ID)
      fail("Fly requires a fixed primary Machine ID.");
    if (env.FLY_MACHINE_ID !== env.PRIMARY_MACHINE_ID) return null;
  }
  const password = env.STANDARD_SITE_APP_PASSWORD ?? env.BLUESKY_APP_PASSWORD;
  const pds = env.STANDARD_SITE_PDS_URL ?? env.BLUESKY_PDS_URL;
  if (!password || !pds) fail("requires a PDS URL and app password.");
  return { pdsUrl: pdsOrigin(pds), password };
}
export interface StandardRemoteRecord {
  uri: string;
  cid: string;
  value: Record<string, unknown>;
}
export interface StandardClient {
  get(collection: string, rkey: string): Promise<StandardRemoteRecord | null>;
  put(
    collection: string,
    rkey: string,
    value: Record<string, unknown>,
    swapRecord: string | null,
  ): Promise<{ uri: string; cid: string }>;
  delete(collection: string, rkey: string, swapRecord: string): Promise<void>;
}
function validCid(value: unknown): value is string {
  // AT repositories use CIDv1, dag-cbor, sha2-256 (36 bytes, canonical base32).
  return (
    typeof value === "string" &&
    /^bafyrei[a-h][a-z2-7]{50}[aeimquy4]$/.test(value)
  );
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
class RemoteError extends Error {
  constructor(
    readonly missing: boolean,
    status: number,
  ) {
    super(`Standard.site PDS request failed (${status}).`);
  }
}
export function createStandardClient(
  config: StandardConfig,
  fetcher: typeof fetch = fetch,
): StandardClient {
  const origin = pdsOrigin(config.pdsUrl);
  let session: Promise<string> | undefined;
  async function request(
    method: string,
    body?: unknown,
    token?: string,
    query?: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const url = new URL(`/xrpc/com.atproto.${method}`, origin);
    if (query) url.search = new URLSearchParams(query).toString();
    const payload = body === undefined ? undefined : JSON.stringify(body);
    if (payload && Buffer.byteLength(payload) > 950_000)
      fail("request exceeds size limit.");
    let res: Response;
    try {
      res = await fetcher(url, {
        method: body === undefined ? "GET" : "POST",
        body: payload,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(payload ? { "Content-Type": "application/json" } : {}),
        },
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      });
    } catch {
      return fail("PDS transport failed.");
    }
    let parsed: unknown;
    try {
      if (!res.body) fail("empty PDS response.");
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 1_000_000) {
            await reader.cancel();
            fail("PDS response exceeds size limit.");
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!object(parsed)) fail("invalid PDS response.");
    } catch {
      return fail("invalid or oversized PDS response.");
    }
    if (!res.ok) {
      if (res.status === 401) session = undefined;
      throw new RemoteError(
        (res.status === 400 || res.status === 404) &&
          parsed.error === "RecordNotFound",
        res.status,
      );
    }
    return parsed;
  }
  function token(): Promise<string> {
    if (!session) {
      session = request("server.createSession", {
        identifier: standardDid,
        password: config.password,
      })
        .then((result) => {
          if (
            result.did !== standardDid ||
            typeof result.accessJwt !== "string" ||
            !result.accessJwt ||
            result.accessJwt.length > 16000 ||
            /[\r\n]/.test(result.accessJwt)
          )
            fail("credentials do not match the expected account.");
          return result.accessJwt;
        })
        .catch((error) => {
          session = undefined;
          throw error;
        });
    }
    return session;
  }
  function reference(collection: string, rkey: string): string {
    if (
      !["site.standard.document", "site.standard.publication"].includes(
        collection,
      ) ||
      !tidPattern.test(rkey)
    )
      fail("invalid record address.");
    return `at://${standardDid}/${collection}/${rkey}`;
  }
  function resultRef(result: Record<string, unknown>, uri: string) {
    if (result.uri !== uri || !validCid(result.cid))
      fail("unexpected PDS record reference.");
    return { uri, cid: result.cid };
  }
  return {
    async get(collection, rkey) {
      const uri = reference(collection, rkey);
      const auth = await token();
      let result: Record<string, unknown>;
      try {
        result = await request("repo.getRecord", undefined, auth, {
          repo: standardDid,
          collection,
          rkey,
        });
      } catch (error) {
        if (error instanceof RemoteError && error.missing) return null;
        throw error;
      }
      const ref = resultRef(result, uri);
      if (!object(result.value) || result.value.$type !== collection)
        fail("unexpected PDS record value.");
      return { ...ref, value: result.value };
    },
    async put(collection, rkey, value, swapRecord) {
      const uri = reference(collection, rkey);
      if (value.$type !== collection)
        fail("record type does not match its collection.");
      boundedRecord(value);
      if (swapRecord !== null && !validCid(swapRecord))
        fail("invalid compare-and-swap CID.");
      const result = await request(
        "repo.putRecord",
        {
          repo: standardDid,
          collection,
          rkey,
          record: value,
          swapRecord,
          // Omit validate: community lexicons may be unknown to the PDS.
          // Builders validate locally; the PDS still validates schemas it knows.
        },
        await token(),
      );
      return resultRef(result, uri);
    },
    async delete(collection, rkey, swapRecord) {
      reference(collection, rkey);
      if (!validCid(swapRecord))
        fail("delete requires a compare-and-swap CID.");
      await request(
        "repo.deleteRecord",
        { repo: standardDid, collection, rkey, swapRecord },
        await token(),
      );
    },
  };
}
