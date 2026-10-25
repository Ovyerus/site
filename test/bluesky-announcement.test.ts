import { afterEach, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  announcementConfig,
  announcementDid,
  announcementText,
  publishAnnouncement,
} from "~lib/bluesky-announcement";
import type { AnnouncementJob } from "~lib/bluesky-announcement-store";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        }),
    ),
  );
});

describe("weeknote announcements", () => {
  test("facets retain the correct UTF-8 byte boundaries after emoji and accented text", () => {
    const post = announcementText("café ☕ and 🏳️‍⚧️", "2026-w42");
    const encoded = Buffer.from(post.text);
    expect(
      post.facets.map(({ index }) =>
        encoded.subarray(index.byteStart, index.byteEnd).toString(),
      ),
    ).toEqual(["#weeknotes", "https://ovyerus.com/weeknotes/2026-w42"]);
  });

  test("allows exactly 300 graphemes but rejects an oversized announcement", () => {
    const fixedLength = [
      ...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(
        announcementText("", "2026-w42").text,
      ),
    ].length;
    expect(
      announcementText("é".repeat(300 - fixedLength), "2026-w42").text,
    ).toBe(
      `#weeknotes: ${"é".repeat(300 - fixedLength)}\n\nhttps://ovyerus.com/weeknotes/2026-w42`,
    );
    expect(() =>
      announcementText("é".repeat(301 - fixedLength), "2026-w42"),
    ).toThrow("300 characters");
    // Long combining sequences can fit the grapheme limit but exceed ATProto's byte limit.
    expect(() =>
      announcementText("a" + "\u0301".repeat(1500), "2026-w42"),
    ).toThrow("3000-byte");
  });

  test("never activates outside production even with a posting flag", () => {
    const env = { ...process.env };
    try {
      process.env.NODE_ENV = "development";
      process.env.BLUESKY_ANNOUNCE_ENABLED = "true";
      expect(announcementConfig()).toBeNull();
      process.env.NODE_ENV = "production";
      process.env.BLUESKY_ANNOUNCE_ENABLED = "false";
      expect(announcementConfig()).toBeNull();
      process.env.BLUESKY_ANNOUNCE_ENABLED = "true";
      process.env.BLUESKY_APP_PASSWORD = "fixture-secret";
      process.env.BLUESKY_PDS_URL = "http://example.test";
      expect(() => announcementConfig()).toThrow("HTTPS origin");
    } finally {
      process.env = env;
    }
  });

  test("recovers a committed post when its create response is lost, without overwriting it", async () => {
    let stored: Record<string, any> | undefined;
    let creates = 0;
    let wrongAccount = false;
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const payload = chunks.length ? Buffer.concat(chunks) : undefined;
      const url = new URL(req.url!, "http://localhost");
      res.setHeader("Content-Type", "application/json");
      if (url.pathname === "/xrpc/com.atproto.server.createSession") {
        res.end(
          JSON.stringify({
            did: wrongAccount ? "did:plc:someoneelse" : announcementDid,
            accessJwt: "fixture-jwt",
          }),
        );
      } else if (url.pathname === "/xrpc/com.atproto.repo.getRecord") {
        if (stored) res.end(JSON.stringify(stored));
        else {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "RecordNotFound" }));
        }
      } else if (url.pathname === "/og/weeknotes/2026-w42.png") {
        res.setHeader("Content-Type", "image/png");
        res.end(Buffer.from("89504e470d0a1a0a", "hex"));
      } else if (url.pathname === "/xrpc/com.atproto.repo.uploadBlob") {
        res.end(
          JSON.stringify({
            blob: {
              $type: "blob",
              ref: { $link: "fixture-image" },
              mimeType: "image/png",
              size: 8,
            },
          }),
        );
      } else if (url.pathname === "/xrpc/com.atproto.repo.createRecord") {
        const body = JSON.parse(payload!.toString());
        creates++;
        stored = {
          uri: `at://${announcementDid}/app.bsky.feed.post/${body.rkey}`,
          cid: "fixture-cid",
          value: body.record,
        };
        res.destroy();
      } else {
        res.statusCode = 404;
        res.end("{}");
      }
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const config = {
      pdsUrl: origin,
      siteUrl: origin,
      password: "fixture-secret",
    };
    const job: AnnouncementJob = {
      entryId: "fixture-weeknote",
      slug: "2026-w42",
      text: "café ☕",
      description: null,
      rkey: "weeknote-fixture",
      createdAt: "2026-10-20T00:00:00.000Z",
      uri: null,
      cid: null,
    };
    const expected = {
      uri: `at://${announcementDid}/app.bsky.feed.post/weeknote-fixture`,
      cid: "fixture-cid",
    };
    expect(await publishAnnouncement(job, config)).toEqual(expected);
    expect(stored!.value).toMatchObject({
      text: `#weeknotes: café ☕\n\n${origin}/weeknotes/2026-w42`,
      embed: {
        external: {
          title: "Weeknote 42, 2026",
          description: "My weekly journal-ish entry for week 42 of 2026.",
        },
      },
    });
    expect(await publishAnnouncement(job, config)).toEqual(expected);
    expect(creates).toBe(1);
    wrongAccount = true;
    await expect(publishAnnouncement(job, config)).rejects.toThrow(
      "do not belong",
    );
    expect(creates).toBe(1);
  });
});
