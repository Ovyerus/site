import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import { GET } from "../src/pages/.well-known/site.standard.publication";
import {
  publicationRkey,
  publicationUri,
  documentUri,
} from "~lib/standard-site";
import {
  getStandardDocumentUri,
  getStandardPublicationUri,
} from "~lib/standard-site-verification";

const enabled = { STANDARD_SITE_ENABLED: "true", EMDASH_READ_ONLY: "true" };
const fixtures: { directory: string; db: DatabaseSync }[] = [];
const previousEnabled = process.env.STANDARD_SITE_ENABLED;
const previousDatabase = process.env.EMDASH_DATABASE_URL;

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.db.close();
    rmSync(fixture.directory, { recursive: true, force: true });
  }
  if (previousEnabled === undefined) delete process.env.STANDARD_SITE_ENABLED;
  else process.env.STANDARD_SITE_ENABLED = previousEnabled;
  if (previousDatabase === undefined) delete process.env.EMDASH_DATABASE_URL;
  else process.env.EMDASH_DATABASE_URL = previousDatabase;
});

function fixture(withTables = true) {
  const directory = mkdtempSync(join(tmpdir(), "standard-site-verification-"));
  const path = join(directory, "emdash.db");
  const db = new DatabaseSync(path);
  fixtures.push({ directory, db });
  if (withTables)
    db.exec(`
    CREATE TABLE standard_site_records (
      collection TEXT NOT NULL, entry_id TEXT NOT NULL,
      rkey TEXT NOT NULL UNIQUE, desired_hash TEXT, synced_hash TEXT,
      cid TEXT, verified_path TEXT, attempts INTEGER, next_attempt_at INTEGER,
      claim_token TEXT, lease_until INTEGER, intent_hash TEXT, last_error TEXT,
      PRIMARY KEY (collection, entry_id)
    );
    CREATE TABLE ec_posts (id TEXT PRIMARY KEY, slug TEXT, status TEXT, deleted_at TEXT);
    CREATE TABLE ec_weeknotes (id TEXT PRIMARY KEY, slug TEXT, status TEXT, deleted_at TEXT);
  `);
  return { db, path, directory };
}

function record(
  db: DatabaseSync,
  collection: string,
  entryId: string,
  rkey: string,
  cid: string | null,
  verifiedPath: string | null,
) {
  db.prepare(
    `INSERT INTO standard_site_records
    (collection, entry_id, rkey, cid, verified_path) VALUES (?, ?, ?, ?, ?)`,
  ).run(collection, entryId, rkey, cid, verifiedPath);
}

function article(
  db: DatabaseSync,
  collection: "posts" | "weeknotes",
  id: string,
  slug: string,
  status = "published",
  deletedAt: string | null = null,
) {
  db.prepare(
    `INSERT INTO ec_${collection} (id, slug, status, deleted_at) VALUES (?, ?, ?, ?)`,
  ).run(id, slug, status, deletedAt);
}

describe("verified Standard.site discovery", () => {
  test("disabled, missing database, and pre-migration table are safely omitted without creating files", () => {
    const fx = fixture(false);
    const missing = join(fx.directory, "missing.db");
    expect(getStandardPublicationUri(missing, enabled)).toBeNull();
    expect(
      getStandardDocumentUri("posts", "hello", missing, enabled),
    ).toBeNull();
    expect(existsSync(missing)).toBe(false);
    expect(getStandardPublicationUri(fx.path, enabled)).toBeNull();
    expect(
      getStandardDocumentUri("posts", "hello", fx.path, enabled),
    ).toBeNull();
    expect(getStandardPublicationUri(fx.path, {})).toBeNull();
    expect(getStandardDocumentUri("posts", "hello", fx.path, {})).toBeNull();
  });

  test("publication appears only once the fixed publication row has its CID", () => {
    const { db, path } = fixture();
    record(db, "publication", "site", publicationRkey, null, null);
    expect(getStandardPublicationUri(path, enabled)).toBeNull();
    db.prepare(
      "UPDATE standard_site_records SET cid = 'bafycid' WHERE collection = 'publication'",
    ).run();
    expect(getStandardPublicationUri(path, enabled)).toBe(publicationUri);
    db.prepare(
      "UPDATE standard_site_records SET rkey = '3aaaaaaaaaaaa' WHERE collection = 'publication'",
    ).run();
    expect(getStandardPublicationUri(path, enabled)).toBeNull();
  });

  test("published, verified posts and weeknotes resolve on read-only replicas", () => {
    const { db, path } = fixture();
    const postKey = "3aaaaaaaaaaaa",
      weekKey = "3bbbbbbbbbbbb";
    article(db, "posts", "post-immutable", "hello");
    article(db, "weeknotes", "week-immutable", "2026-w42");
    record(db, "posts", "post-immutable", postKey, "bafy-post", "/posts/hello");
    record(
      db,
      "weeknotes",
      "week-immutable",
      weekKey,
      "bafy-week",
      "/weeknotes/2026-w42",
    );
    expect(getStandardDocumentUri("posts", "hello", path, enabled)).toBe(
      documentUri(postKey),
    );
    expect(getStandardDocumentUri("weeknotes", "2026-w42", path, enabled)).toBe(
      documentUri(weekKey),
    );
    expect(
      getStandardDocumentUri("posts", "2026-w42", path, enabled),
    ).toBeNull();
  });

  test("Unicode slugs require the protocol-encoded verified path", () => {
    const { db, path } = fixture();
    const slug = "café-日本";
    const key = "3ffffffffffff";
    article(db, "posts", "unicode-entry", slug);
    record(db, "posts", "unicode-entry", key, "bafy-unicode", `/posts/${slug}`);
    expect(getStandardDocumentUri("posts", slug, path, enabled)).toBeNull();
    db.prepare(
      "UPDATE standard_site_records SET verified_path = ? WHERE entry_id = 'unicode-entry'",
    ).run(`/posts/${encodeURIComponent(slug)}`);
    expect(getStandardDocumentUri("posts", slug, path, enabled)).toBe(
      documentUri(key),
    );
    expect(
      getStandardDocumentUri(
        "posts",
        "caf%C3%A9-%E6%97%A5%E6%9C%AC",
        path,
        enabled,
      ),
    ).toBeNull();
  });

  test("pending, deleted, draft, renamed, and unsafe path rows never leak a link", () => {
    const { db, path } = fixture();
    article(db, "posts", "pending", "pending");
    article(db, "posts", "draft", "draft", "draft");
    article(db, "posts", "deleted", "deleted", "published", "2026-10-01");
    article(db, "posts", "renamed", "new-slug");
    article(db, "posts", "unsafe", "x/y");
    record(db, "posts", "pending", "3aaaaaaaaaaaa", null, "/posts/pending");
    record(db, "posts", "draft", "3bbbbbbbbbbbb", "bafy-draft", "/posts/draft");
    record(
      db,
      "posts",
      "deleted",
      "3cccccccccccc",
      "bafy-deleted",
      "/posts/deleted",
    );
    record(
      db,
      "posts",
      "renamed",
      "3dddddddddddd",
      "bafy-old",
      "/posts/old-slug",
    );
    record(db, "posts", "unsafe", "3eeeeeeeeeeee", "bafy-unsafe", "/posts/x/y");
    for (const slug of [
      "pending",
      "draft",
      "deleted",
      "new-slug",
      "old-slug",
      "../hello",
      "x/y",
      "x?y",
      "x%2Fy",
      "x\\y",
      "",
    ]) {
      expect(getStandardDocumentUri("posts", slug, path, enabled)).toBeNull();
    }
    expect(
      getStandardDocumentUri(
        // @ts-expect-error Exercise the runtime whitelist against an untyped caller.
        "posts; DROP TABLE ec_posts",
        "pending",
        path,
        enabled,
      ),
    ).toBeNull();
  });

  test("endpoint returns plain URI after verification and 404 otherwise", async () => {
    const { db, path } = fixture();
    process.env.STANDARD_SITE_ENABLED = "true";
    process.env.EMDASH_DATABASE_URL = `file:${path}`;
    const pending = (await GET({} as never)) as Response;
    expect(pending.status).toBe(404);
    expect(pending.headers.get("Cache-Control")).toBe("no-store");
    record(db, "publication", "site", publicationRkey, "bafy", null);
    const verified = (await GET({} as never)) as Response;
    expect(verified.status).toBe(200);
    expect(verified.headers.get("Content-Type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(await verified.text()).toBe(`${publicationUri}\n`);
  });
});
