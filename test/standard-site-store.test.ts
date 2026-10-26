import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import { StandardSiteStore } from "~lib/standard-site-store";
import {
  publicationRkey,
  type StandardClient,
  type StandardRemoteRecord,
} from "~lib/standard-site";

const date = "2026-10-20T00:00:00.000Z";
type Collection = "posts" | "weeknotes";
interface Fixture {
  directory: string;
  path: string;
  db: DatabaseSync;
}
const fixtures: Fixture[] = [];
const stores: StandardSiteStore[] = [];
const oldReadOnly = process.env.EMDASH_READ_ONLY;
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const fixture of fixtures.splice(0)) {
    fixture.db.close();
    rmSync(fixture.directory, { recursive: true, force: true });
  }
  if (oldReadOnly === undefined) delete process.env.EMDASH_READ_ONLY;
  else process.env.EMDASH_READ_ONLY = oldReadOnly;
});
function fixture(): Fixture {
  const directory = mkdtempSync(join(tmpdir(), "standard-site-store-"));
  const path = join(directory, "emdash.db");
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE revisions (
      id TEXT PRIMARY KEY, collection TEXT NOT NULL, entry_id TEXT NOT NULL,
      data TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE ec_posts (
      id TEXT PRIMARY KEY, slug TEXT NOT NULL, status TEXT NOT NULL,
      deleted_at TEXT, created_at TEXT NOT NULL, published_at TEXT,
      updated_at TEXT NOT NULL, live_revision_id TEXT, draft_revision_id TEXT,
      title TEXT, body TEXT
    );
    CREATE TABLE ec_weeknotes (
      id TEXT PRIMARY KEY, slug TEXT NOT NULL, status TEXT NOT NULL,
      deleted_at TEXT, created_at TEXT NOT NULL, published_at TEXT,
      updated_at TEXT NOT NULL, live_revision_id TEXT, draft_revision_id TEXT,
      title TEXT, body TEXT
    );
  `);
  const result = { directory, path, db };
  fixtures.push(result);
  return result;
}
function insert(
  fx: Fixture,
  collection: Collection,
  id: string,
  options: {
    slug?: string;
    status?: string;
    live?: boolean;
    draft?: boolean;
  } = {},
): void {
  const slug = options.slug ?? (collection === "posts" ? "a-post" : "2026-w42");
  const data = {
    title: `Live ${id}`,
    body: `Published ${id} body`,
    description: "Public summary",
    tags: ["public"],
    written_at: date,
  };
  if (options.live !== false)
    fx.db
      .prepare("INSERT INTO revisions VALUES (?, ?, ?, ?, ?)")
      .run(`live-${id}`, collection, id, JSON.stringify(data), date);
  if (options.draft)
    fx.db.prepare("INSERT INTO revisions VALUES (?, ?, ?, ?, ?)").run(
      `draft-${id}`,
      collection,
      id,
      JSON.stringify({
        title: "PRIVATE DRAFT POISON",
        body: "PRIVATE DRAFT POISON",
      }),
      date,
    );
  fx.db
    .prepare(
      `INSERT INTO ec_${collection} VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      slug,
      options.status ?? "published",
      date,
      date,
      date,
      options.live === false ? null : `live-${id}`,
      options.draft ? `draft-${id}` : null,
      "PRIVATE MUTABLE POISON",
      "PRIVATE MUTABLE POISON",
    );
}
function store(fx: Fixture, clock = () => Date.parse(date)): StandardSiteStore {
  const value = new StandardSiteStore(fx.path, clock);
  stores.push(value);
  return value;
}
function row(
  fx: Fixture,
  collection: Collection,
  id: string,
): Record<string, unknown> {
  return fx.db
    .prepare(
      "SELECT * FROM standard_site_records WHERE collection = ? AND entry_id = ?",
    )
    .get(collection, id) as Record<string, unknown>;
}
function snapshot(fx: Fixture): string {
  return JSON.stringify(
    ["ec_posts", "ec_weeknotes", "revisions", "bluesky_announcement_jobs"].map(
      (table) => {
        const exists = fx.db
          .prepare("SELECT 1 FROM sqlite_master WHERE name = ?")
          .get(table);
        return exists
          ? fx.db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()
          : null;
      },
    ),
  );
}
class FakePds implements StandardClient {
  records = new Map<string, StandardRemoteRecord>();
  calls: string[] = [];
  writes = 0;
  dropResponse = false;
  failNext = false;
  gate?: Promise<void>;
  private cid = 0;
  key(ns: string, rkey: string): string {
    return `${ns}/${rkey}`;
  }
  async get(ns: string, rkey: string): Promise<StandardRemoteRecord | null> {
    this.calls.push(`get:${this.key(ns, rkey)}`);
    if (this.gate) await this.gate;
    return this.records.get(this.key(ns, rkey)) ?? null;
  }
  async put(
    ns: string,
    rkey: string,
    value: Record<string, unknown>,
    swapRecord: string | null,
  ) {
    this.calls.push(`put:${this.key(ns, rkey)}`);
    if (this.failNext) {
      this.failNext = false;
      throw new Error("secret-password-do-not-store");
    }
    const key = this.key(ns, rkey);
    if ((this.records.get(key)?.cid ?? null) !== swapRecord)
      throw new Error("CAS conflict");
    const record = {
      uri: `at://did:plc:jrrhosrfzgjf6v4oydav6ftb/${key}`,
      cid: `fake-cid-${++this.cid}`,
      value: structuredClone(value),
    };
    this.records.set(key, record);
    this.writes++;
    if (this.dropResponse) {
      this.dropResponse = false;
      throw new Error("ambiguous transport error");
    }
    return { uri: record.uri, cid: record.cid };
  }
  async delete(ns: string, rkey: string, swapRecord: string) {
    this.calls.push(`delete:${this.key(ns, rkey)}`);
    const key = this.key(ns, rkey);
    if (this.records.get(key)?.cid !== swapRecord)
      throw new Error("CAS conflict");
    this.records.delete(key);
    this.writes++;
  }
  foreign(ns: string, rkey: string): void {
    this.records.set(this.key(ns, rkey), {
      uri: `at://did:plc:jrrhosrfzgjf6v4oydav6ftb/${this.key(ns, rkey)}`,
      cid: `foreign-${++this.cid}`,
      value: { $type: ns, title: "MANUAL FOREIGN EDIT" },
    });
  }
}
async function publication(s: StandardSiteStore, pds: FakePds): Promise<void> {
  expect(await s.syncOne(pds)).toBe("synced");
  expect(
    pds.records.get(pds.key("site.standard.publication", publicationRkey))
      ?.value,
  ).toMatchObject({
    $type: "site.standard.publication",
    url: "https://ovyerus.com",
  });
}

describe("Standard.site durable writer ledger", () => {
  test("does not create a CMS database or write on replicas", () => {
    const fx = fixture();
    process.env.EMDASH_READ_ONLY = "true";
    expect(() => store(fx)).toThrow();
    expect(
      fx.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name = 'standard_site_records'",
        )
        .get(),
    ).toBeUndefined();
    delete process.env.EMDASH_READ_ONLY;
    expect(
      () => new StandardSiteStore(join(fx.directory, "missing.db")),
    ).toThrow();
    expect(
      fx.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name = 'standard_site_records'",
        )
        .get(),
    ).toBeUndefined();
  });

  test("only explicit enrollment/backfill; publication first; live revision never private draft", async () => {
    const fx = fixture();
    insert(fx, "posts", "post-1", { draft: true });
    insert(fx, "weeknotes", "note-1");
    insert(fx, "posts", "private-post", { status: "draft" });
    const before = snapshot(fx);
    const s = store(fx);
    const pds = new FakePds();
    s.reconcile();
    expect(row(fx, "posts", "post-1")).toBeUndefined();
    await publication(s, pds);
    expect(await s.syncOne(pds)).toBe("idle");
    s.track("posts", "post-1");
    expect(await s.syncOne(pds)).toBe("synced");
    const document = pds.records.get(
      pds.key(
        "site.standard.document",
        String(row(fx, "posts", "post-1").rkey),
      ),
    )!;
    expect(document.value).toMatchObject({
      path: "/posts/a-post",
      title: "Live post-1",
    });
    expect(JSON.stringify(document.value)).not.toContain("PRIVATE");
    expect(row(fx, "posts", "post-1")).toMatchObject({
      cid: document.cid,
      verified_path: "/posts/a-post",
    });
    s.reconcile(true);
    expect(row(fx, "weeknotes", "note-1")).toBeDefined();
    expect(row(fx, "posts", "private-post")).toBeUndefined();
    expect(snapshot(fx)).toBe(before);
  });

  test("missing or mismatched live revision cannot fall back to draft or mutable row", async () => {
    const fx = fixture();
    insert(fx, "posts", "missing-live", { live: false, draft: true });
    fx.db
      .prepare("UPDATE revisions SET entry_id = ? WHERE id = ?")
      .run("another-entry", "draft-missing-live");
    fx.db
      .prepare("UPDATE ec_posts SET live_revision_id = ? WHERE id = ?")
      .run("draft-missing-live", "missing-live");
    const s = store(fx);
    const pds = new FakePds();
    await publication(s, pds);
    s.track("posts", "missing-live");
    const outcome = await s.syncOne(pds);
    expect(["failed", "idle"]).toContain(outcome);
    expect(pds.records.size).toBe(1);
    expect(JSON.stringify([...pds.records.values()])).not.toContain("PRIVATE");
  });

  test("live edits and slug edits update the same remote rkey; unchanged content makes no RPC", async () => {
    const fx = fixture();
    insert(fx, "posts", "post-1");
    const s = store(fx);
    const pds = new FakePds();
    await publication(s, pds);
    s.track("posts", "post-1");
    expect(await s.syncOne(pds)).toBe("synced");
    const rkey = String(row(fx, "posts", "post-1").rkey);
    pds.calls.length = 0;
    s.reconcile();
    expect(await s.syncOne(pds)).toBe("idle");
    expect(pds.calls).toEqual([]);
    fx.db.prepare("UPDATE revisions SET data = ? WHERE id = ?").run(
      JSON.stringify({
        title: "Changed live",
        body: "Changed public body",
        written_at: date,
      }),
      "live-post-1",
    );
    fx.db
      .prepare("UPDATE ec_posts SET slug = ? WHERE id = ?")
      .run("new-slug", "post-1");
    s.reconcile();
    expect(await s.syncOne(pds)).toBe("synced");
    expect(row(fx, "posts", "post-1")).toMatchObject({
      rkey,
      verified_path: "/posts/new-slug",
    });
    expect(
      pds.records.get(pds.key("site.standard.document", rkey))?.value,
    ).toMatchObject({
      path: "/posts/new-slug",
      title: "Changed live",
    });
  });

  test("unpublish deletes remote record, republish retains rkey; missing source also deletes", async () => {
    const fx = fixture();
    insert(fx, "weeknotes", "note-1");
    const s = store(fx);
    const pds = new FakePds();
    await publication(s, pds);
    s.track("weeknotes", "note-1");
    expect(await s.syncOne(pds)).toBe("synced");
    const rkey = String(row(fx, "weeknotes", "note-1").rkey);
    fx.db
      .prepare("UPDATE ec_weeknotes SET status = 'draft' WHERE id = 'note-1'")
      .run();
    s.reconcile();
    expect(await s.syncOne(pds)).toBe("deleted");
    expect(pds.records.has(pds.key("site.standard.document", rkey))).toBe(
      false,
    );
    fx.db
      .prepare(
        "UPDATE ec_weeknotes SET status = 'published' WHERE id = 'note-1'",
      )
      .run();
    s.reconcile();
    expect(await s.syncOne(pds)).toBe("synced");
    expect(row(fx, "weeknotes", "note-1").rkey).toBe(rkey);
    fx.db.prepare("DELETE FROM ec_weeknotes WHERE id = 'note-1'").run();
    s.reconcile();
    expect(await s.syncOne(pds)).toBe("deleted");
  });

  test("lost PUT response recovers recorded intent by readback without a second PUT", async () => {
    const fx = fixture();
    insert(fx, "posts", "post-1");
    const s = store(fx);
    const pds = new FakePds();
    await publication(s, pds);
    s.track("posts", "post-1");
    pds.dropResponse = true;
    expect(await s.syncOne(pds)).toBe("failed");
    const rkey = String(row(fx, "posts", "post-1").rkey);
    const cid = pds.records.get(pds.key("site.standard.document", rkey))?.cid;
    expect(row(fx, "posts", "post-1").intent_hash).toBeTruthy();
    fx.db
      .prepare(
        "UPDATE standard_site_records SET next_attempt_at = 0 WHERE entry_id = 'post-1'",
      )
      .run();
    expect(await s.syncOne(pds)).toBe("synced");
    expect(row(fx, "posts", "post-1").cid).toBe(cid);
    expect(
      pds.calls.filter((call) => call === `put:site.standard.document/${rkey}`),
    ).toHaveLength(1);
  });

  test("unpublish after an unacknowledged initial PUT deletes the remote orphan", async () => {
    const fx = fixture();
    insert(fx, "posts", "post-1");
    const s = store(fx);
    const pds = new FakePds();
    await publication(s, pds);
    s.track("posts", "post-1");
    pds.dropResponse = true;
    expect(await s.syncOne(pds)).toBe("failed");
    const rkey = String(row(fx, "posts", "post-1").rkey);
    const key = pds.key("site.standard.document", rkey);
    expect(pds.records.has(key)).toBe(true);
    expect(row(fx, "posts", "post-1")).toMatchObject({
      cid: null,
      synced_hash: null,
    });
    expect(row(fx, "posts", "post-1").intent_hash).toBeTruthy();
    fx.db
      .prepare("UPDATE ec_posts SET status = 'draft' WHERE id = 'post-1'")
      .run();
    s.reconcile();
    expect(row(fx, "posts", "post-1")).toMatchObject({
      cid: null,
      desired_hash: null,
      synced_hash: null,
    });
    fx.db
      .prepare(
        "UPDATE standard_site_records SET next_attempt_at = 0 WHERE collection = 'posts' AND entry_id = 'post-1'",
      )
      .run();
    expect(await s.syncOne(pds)).toBe("deleted");
    expect(pds.records.has(key)).toBe(false);
    expect(pds.calls).toContain(`delete:site.standard.document/${rkey}`);
    expect(row(fx, "posts", "post-1")).toMatchObject({
      cid: null,
      synced_hash: null,
      intent_hash: null,
      verified_path: null,
    });
    expect(await s.syncOne(pds)).toBe("idle");
  });

  test("lost response followed by a new live revision adopts the old intent before CAS update", async () => {
    const fx = fixture();
    insert(fx, "posts", "post-1", { draft: true });
    const originalCms = snapshot(fx);
    const s = store(fx);
    const pds = new FakePds();
    await publication(s, pds);
    s.track("posts", "post-1");
    pds.dropResponse = true;
    expect(await s.syncOne(pds)).toBe("failed");
    const rkey = String(row(fx, "posts", "post-1").rkey);
    const firstRemote = pds.records.get(
      pds.key("site.standard.document", rkey),
    )!;
    expect(firstRemote.value.title).toBe("Live post-1");
    expect(row(fx, "posts", "post-1")).toMatchObject({ cid: null });
    expect(row(fx, "posts", "post-1").intent_hash).toBeTruthy();
    expect(snapshot(fx)).toBe(originalCms);
    // A CMS publish creates a new immutable live revision; the draft remains untouched.
    fx.db.prepare("INSERT INTO revisions VALUES (?, ?, ?, ?, ?)").run(
      "live-post-2",
      "posts",
      "post-1",
      JSON.stringify({
        title: "New public title",
        body: "New public body",
        written_at: date,
      }),
      "2026-10-21T00:00:00.000Z",
    );
    fx.db
      .prepare("UPDATE ec_posts SET live_revision_id = ? WHERE id = ?")
      .run("live-post-2", "post-1");
    const revisedCms = snapshot(fx);
    s.reconcile();
    expect(await s.syncOne(pds)).toBe("synced");
    const updatedRemote = pds.records.get(
      pds.key("site.standard.document", rkey),
    )!;
    expect(updatedRemote.cid).not.toBe(firstRemote.cid);
    expect(updatedRemote.value).toMatchObject({
      title: "New public title",
      path: "/posts/a-post",
    });
    expect(JSON.stringify(updatedRemote.value)).not.toContain("PRIVATE");
    expect(row(fx, "posts", "post-1")).toMatchObject({
      rkey,
      cid: updatedRemote.cid,
      intent_hash: null,
      verified_path: "/posts/a-post",
    });
    expect(
      pds.calls.filter((call) => call === `put:site.standard.document/${rkey}`),
    ).toHaveLength(2);
    expect(snapshot(fx)).toBe(revisedCms);
  });

  test("the 5000 document cap rejects enrollment without changing CMS tables", () => {
    const fx = fixture();
    insert(fx, "posts", "extra-post");
    const before = snapshot(fx);
    const s = store(fx);
    const write = fx.db.prepare(`INSERT INTO standard_site_records
      (collection, entry_id, rkey) VALUES ('posts', ?, ?)`);
    fx.db.exec("BEGIN IMMEDIATE");
    try {
      for (let i = 0; i < 5000; i++) write.run(`cap-${i}`, `cap-rkey-${i}`);
      fx.db.exec("COMMIT");
    } catch (error) {
      fx.db.exec("ROLLBACK");
      throw error;
    }
    expect(() => s.track("posts", "extra-post")).toThrow(/limit/i);
    expect(row(fx, "posts", "extra-post")).toBeUndefined();
    expect(s.status()).toHaveLength(5001);
    expect(snapshot(fx)).toBe(before);
  });

  test("foreign collision and manual edits are preserved, never overwritten or deleted", async () => {
    const fx = fixture();
    insert(fx, "posts", "post-1");
    const s = store(fx);
    const pds = new FakePds();
    await publication(s, pds);
    s.track("posts", "post-1");
    const rkey = String(row(fx, "posts", "post-1").rkey);
    pds.foreign("site.standard.document", rkey);
    expect(await s.syncOne(pds)).toBe("failed");
    expect(
      pds.records.get(pds.key("site.standard.document", rkey))?.value.title,
    ).toBe("MANUAL FOREIGN EDIT");
    expect(pds.calls).not.toContain(`put:site.standard.document/${rkey}`);
  });

  test("manual edit after our successful sync cannot be overwritten or deleted", async () => {
    const fx = fixture();
    insert(fx, "posts", "post-1");
    const s = store(fx);
    const pds = new FakePds();
    await publication(s, pds);
    s.track("posts", "post-1");
    expect(await s.syncOne(pds)).toBe("synced");
    const rkey = String(row(fx, "posts", "post-1").rkey);
    pds.foreign("site.standard.document", rkey);
    const manual = structuredClone(
      pds.records.get(pds.key("site.standard.document", rkey)),
    );
    fx.db
      .prepare("UPDATE ec_posts SET status = 'draft' WHERE id = 'post-1'")
      .run();
    s.reconcile();
    expect(await s.syncOne(pds)).toBe("failed");
    expect(pds.records.get(pds.key("site.standard.document", rkey))).toEqual(
      manual,
    );
    expect(pds.calls).not.toContain(`delete:site.standard.document/${rkey}`);
  });

  test("backoff redacts remote errors and defers retry with injectable clock", async () => {
    const fx = fixture();
    insert(fx, "posts", "post-1");
    let now = Date.parse(date);
    const s = store(fx, () => now);
    const pds = new FakePds();
    await publication(s, pds);
    s.track("posts", "post-1");
    pds.failNext = true;
    expect(await s.syncOne(pds)).toBe("failed");
    const failed = row(fx, "posts", "post-1");
    expect(failed.attempts).toBeGreaterThan(0);
    expect(Number(failed.next_attempt_at)).toBeGreaterThan(now);
    expect(JSON.stringify(failed)).not.toContain(
      "secret-password-do-not-store",
    );
    const calls = pds.calls.length;
    expect(await s.syncOne(pds)).toBe("idle");
    expect(pds.calls).toHaveLength(calls);
    now = Number(failed.next_attempt_at) + 1;
    expect(await s.syncOne(pds)).toBe("synced");
  });

  test("a concurrent second store cannot claim an active lease", async () => {
    const fx = fixture();
    insert(fx, "posts", "post-1");
    const first = store(fx);
    const second = store(fx);
    const pds = new FakePds();
    await publication(first, pds);
    first.track("posts", "post-1");
    let release!: () => void;
    pds.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = first.syncOne(pds);
    try {
      expect(await second.syncOne(pds)).toBe("idle");
    } finally {
      release();
    }
    expect(await running).toBe("synced");
    expect(
      pds.calls.filter((call) =>
        call.startsWith("put:site.standard.document/"),
      ),
    ).toHaveLength(1);
  });
});
