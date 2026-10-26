import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import {
  createStandardClient,
  documentUri,
  standardDid,
  publicationUri,
  type StandardRemoteRecord,
} from "~lib/standard-site";
import { StandardSiteStore } from "~lib/standard-site-store";
import {
  getStandardDocumentUri,
  getStandardPublicationUri,
} from "~lib/standard-site-verification";

function cid(value: unknown) {
  const bytes = Buffer.concat([
    Buffer.from([1, 0x71, 0x12, 0x20]),
    createHash("sha256").update(JSON.stringify(value)).digest(),
  ]);
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let result = "b",
    bits = 0,
    buffer = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += alphabet[(buffer >>> bits) & 31];
    }
  }
  if (bits) result += alphabet[(buffer << (5 - bits)) & 31];
  return result;
}

test("real client + ledger + discovery publish, update and remove only live content", async () => {
  const dir = mkdtempSync(join(tmpdir(), "standard-site-e2e-"));
  const path = join(dir, "cms.db");
  const db = new DatabaseSync(path);
  const oldRole = process.env.EMDASH_READ_ONLY;
  let store: StandardSiteStore | undefined;
  const records = new Map<string, StandardRemoteRecord>();
  let logins = 0;
  try {
    process.env.EMDASH_READ_ONLY = "false";
    db.exec(`CREATE TABLE revisions(id TEXT PRIMARY KEY,collection TEXT,entry_id TEXT,data TEXT,created_at TEXT);
      CREATE TABLE ec_posts(id TEXT PRIMARY KEY,slug TEXT,status TEXT,deleted_at TEXT,live_revision_id TEXT,body TEXT);
      CREATE TABLE ec_weeknotes(id TEXT PRIMARY KEY,slug TEXT,status TEXT,deleted_at TEXT,live_revision_id TEXT,body TEXT);`);
    for (const [collection, id, slug] of [
      ["posts", "p1", "café"],
      ["weeknotes", "w1", "2026-w42"],
    ] as const) {
      db.prepare("INSERT INTO revisions VALUES (?,?,?,?,?)").run(
        id,
        collection,
        id,
        JSON.stringify({
          title: "Published title",
          body: "**Public body** with [an anchor](#hi)",
          written_at: "2026-10-01T00:00:00Z",
        }),
        "2026-10-01T00:00:00Z",
      );
      db.prepare(
        `INSERT INTO ec_${collection} VALUES (?,?, 'published',NULL,?,?)`,
      ).run(id, slug, id, "PRIVATE MUTABLE DRAFT");
    }
    const fetcher: typeof fetch = async (input, options) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://pds.invalid");
      expect(options?.redirect).toBe("error");
      const body = options?.body ? JSON.parse(String(options.body)) : null;
      const method = url.pathname.split("/").at(-1);
      if (method === "com.atproto.server.createSession") {
        expect(body.identifier).toBe(standardDid);
        expect(body.password).toBe("fake-password");
        logins++;
        return Response.json({ did: standardDid, accessJwt: "fake-token" });
      }
      expect((options?.headers as Record<string, string>).Authorization).toBe(
        "Bearer fake-token",
      );
      const collection = body?.collection ?? url.searchParams.get("collection");
      const rkey = body?.rkey ?? url.searchParams.get("rkey");
      const key = `${collection}/${rkey}`;
      if (method === "com.atproto.repo.getRecord") {
        return records.has(key)
          ? Response.json(records.get(key))
          : Response.json({ error: "RecordNotFound" }, { status: 400 });
      }
      const existing = records.get(key);
      expect(body.swapRecord).toBe(existing?.cid ?? null);
      if (method === "com.atproto.repo.putRecord") {
        const record = {
          uri: `at://${standardDid}/${key}`,
          cid: cid(body.record),
          value: body.record,
        };
        records.set(key, record);
        return Response.json({ uri: record.uri, cid: record.cid });
      }
      expect(method).toBe("com.atproto.repo.deleteRecord");
      records.delete(key);
      return Response.json({});
    };
    const client = createStandardClient(
      { pdsUrl: "https://pds.invalid", password: "fake-password" },
      fetcher,
    );
    store = new StandardSiteStore(path);
    store.reconcile(true);
    const enabled = { STANDARD_SITE_ENABLED: "true", EMDASH_READ_ONLY: "true" };
    expect(getStandardPublicationUri(path, enabled)).toBeNull();
    expect(await store.syncOne(client)).toBe("synced");
    expect(getStandardPublicationUri(path, enabled)).toBe(publicationUri);
    expect(await store.syncOne(client)).toBe("synced");
    expect(await store.syncOne(client)).toBe("synced");
    expect(logins).toBe(1);
    const post = store.status().find((r) => r.collection === "posts")!;
    expect(getStandardDocumentUri("posts", "café", path, enabled)).toBe(
      documentUri(post.rkey),
    );
    const remote = records.get(`site.standard.document/${post.rkey}`)!;
    expect(remote.value.path).toBe("/posts/caf%C3%A9");
    expect(remote.value.textContent).toBe(
      "Public body with an anchor (https://ovyerus.com/posts/caf%C3%A9#hi)",
    );
    expect(JSON.stringify([...records.values()])).not.toContain("PRIVATE");
    expect(db.prepare("SELECT body FROM ec_posts").get()!.body).toBe(
      "PRIVATE MUTABLE DRAFT",
    );
    expect(await store.syncOne(client)).toBe("idle");
    db.prepare("INSERT INTO revisions VALUES ('p2','posts','p1',?,?)").run(
      JSON.stringify({
        title: "Edited live",
        body: "New live body",
        written_at: "2026-10-01T00:00:00Z",
      }),
      "2026-10-02T00:00:00Z",
    );
    db.exec("UPDATE ec_posts SET live_revision_id='p2'");
    store.reconcile();
    expect(await store.syncOne(client)).toBe("synced");
    expect(
      records.get(`site.standard.document/${post.rkey}`)!.value.title,
    ).toBe("Edited live");
    expect(records.get(`site.standard.document/${post.rkey}`)!.cid).not.toBe(
      remote.cid,
    );
    db.exec("UPDATE ec_posts SET status='draft'");
    store.reconcile();
    expect(getStandardDocumentUri("posts", "café", path, enabled)).toBeNull();
    expect(await store.syncOne(client)).toBe("deleted");
    expect(records.has(`site.standard.document/${post.rkey}`)).toBe(false);
    expect(records.size).toBe(2);
  } finally {
    store?.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
    if (oldRole === undefined) delete process.env.EMDASH_READ_ONLY;
    else process.env.EMDASH_READ_ONLY = oldRole;
  }
});
