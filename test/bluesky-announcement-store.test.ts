import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import { AnnouncementStore } from "~lib/bluesky-announcement-store";

const AUTHOR_DID = "did:plc:jrrhosrfzgjf6v4oydav6ftb";

interface Fixture {
  directory: string;
  path: string;
  db: DatabaseSync;
}

interface EntryOptions {
  id?: string;
  slug?: string;
  status?: string;
  deletedAt?: string | null;
  teaser?: string | null;
  description?: string | null;
  rowComments?: Record<string, unknown> | null;
  revisionComments?: Record<string, unknown> | null;
  draftData?: Record<string, unknown>;
}

const fixtures: Fixture[] = [];
const stores: AnnouncementStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const fixture of fixtures.splice(0)) {
    fixture.db.close();
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

function fixture(): Fixture {
  const directory = mkdtempSync(join(tmpdir(), "bluesky-announcement-store-"));
  const path = join(directory, "emdash.db");
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE revisions (
      id TEXT PRIMARY KEY,
      collection TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      data TEXT NOT NULL,
      author_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE ec_weeknotes (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      status TEXT NOT NULL,
      deleted_at TEXT,
      updated_at TEXT NOT NULL,
      version INTEGER NOT NULL,
      live_revision_id TEXT,
      draft_revision_id TEXT,
      comments TEXT,
      bluesky_announcement TEXT,
      description TEXT
    );
  `);
  const result = { directory, path, db };
  fixtures.push(result);
  return result;
}

function createStore(fx: Fixture): AnnouncementStore {
  const store = new AnnouncementStore(fx.path);
  stores.push(store);
  return store;
}

function insertRevision(
  db: DatabaseSync,
  id: string,
  entryId: string,
  data: Record<string, unknown>,
): void {
  db.prepare(
    `
    INSERT INTO revisions (id, collection, entry_id, data, author_id, created_at)
    VALUES (?, 'weeknotes', ?, ?, NULL, ?)
  `,
  ).run(id, entryId, JSON.stringify(data), "2026-10-01T00:00:00.000Z");
}

function insertEntry(db: DatabaseSync, options: EntryOptions = {}): string {
  const id = options.id ?? "entry-1";
  const slug = options.slug ?? "2026-w42";
  const liveRevisionId = `live-${id}`;
  const draftRevisionId = options.draftData ? `draft-${id}` : null;
  const rowComments = options.rowComments ?? null;
  const revisionComments = options.revisionComments ?? rowComments;
  insertRevision(db, liveRevisionId, id, {
    title: `Live title for ${slug}`,
    body: "Published body",
    _slug: slug,
    comments: revisionComments,
  });
  if (options.draftData)
    insertRevision(db, draftRevisionId as string, id, options.draftData);
  db.prepare(
    `
    INSERT INTO ec_weeknotes (
      id, slug, status, deleted_at, updated_at, version,
      live_revision_id, draft_revision_id, comments, bluesky_announcement, description
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    id,
    slug,
    options.status ?? "published",
    options.deletedAt ?? null,
    "2026-10-01T00:00:00.000Z",
    7,
    liveRevisionId,
    draftRevisionId,
    rowComments === null ? null : JSON.stringify(rowComments),
    options.teaser === undefined ? "A short authored teaser." : options.teaser,
    options.description ?? "A rich-card description.",
  );
  return id;
}

function readJob(
  db: DatabaseSync,
  entryId = "entry-1",
): Record<string, unknown> | undefined {
  return db
    .prepare("SELECT * FROM bluesky_announcement_jobs WHERE entry_id = ?")
    .get(entryId) as Record<string, unknown> | undefined;
}

function readEntry(
  db: DatabaseSync,
  entryId = "entry-1",
): Record<string, unknown> {
  return db
    .prepare("SELECT * FROM ec_weeknotes WHERE id = ?")
    .get(entryId) as Record<string, unknown>;
}

function readRevision(db: DatabaseSync, id: string): Record<string, unknown> {
  return db.prepare("SELECT * FROM revisions WHERE id = ?").get(id) as Record<
    string,
    unknown
  >;
}

describe("durable Bluesky announcement store", () => {
  test("reconciles published opt-ins and recovers a dropped publication hook", () => {
    const fx = fixture();
    insertEntry(fx.db);
    insertEntry(fx.db, { id: "private-entry", status: "draft" });
    insertEntry(fx.db, {
      id: "manual-entry",
      rowComments: null,
      revisionComments: {
        bsky: { did: "did:plc:manual", postCid: "manual-key" },
      },
    });
    const store = createStore(fx);

    store.reconcile();
    const job = store.claim();

    expect(job).toMatchObject({
      entryId: "entry-1",
      slug: "2026-w42",
      text: "A short authored teaser.",
      description: "A rich-card description.",
      uri: null,
      cid: null,
    });
    expect(job?.rkey).toMatch(
      /^[234567][234567abcdefghijklmnopqrstuvwxyz]{12}$/,
    );
    expect(store.claim()).toBeNull();
    expect(readJob(fx.db, "private-entry")).toBeUndefined();
    expect(readJob(fx.db, "manual-entry")).toBeUndefined();
  });

  test("serializes claims, recovers expired leases, and fences stale workers", () => {
    const fx = fixture();
    insertEntry(fx.db);
    const firstStore = createStore(fx);
    const secondStore = createStore(fx);
    firstStore.reconcile();
    const firstClaim = firstStore.claim();
    expect(firstClaim).not.toBeNull();
    expect(secondStore.claim()).toBeNull();

    fx.db
      .prepare(
        "UPDATE bluesky_announcement_jobs SET lease_until = 0 WHERE entry_id = ?",
      )
      .run("entry-1");
    const recovered = secondStore.claim();
    expect(recovered?.rkey).toBe(firstClaim?.rkey);

    firstStore.recordPost(
      "entry-1",
      "at://author/app.bsky.feed.post/stale",
      "stale-cid",
    );
    expect(readJob(fx.db)?.uri).toBeNull();
    secondStore.recordPost(
      "entry-1",
      `at://${AUTHOR_DID}/app.bsky.feed.post/${recovered?.rkey}`,
      "post-cid",
    );
    secondStore.complete("entry-1", AUTHOR_DID, recovered?.rkey as string);
    expect(readJob(fx.db)?.state).toBe("completed");
    firstStore.fail("entry-1", "stale worker failure");
    expect(readJob(fx.db)?.state).toBe("completed");
  });

  test("backs off failures without marking announced and retains the post reference for retry", () => {
    const fx = fixture();
    insertEntry(fx.db);
    const store = createStore(fx);
    store.reconcile();
    const first = store.claim();
    expect(first).not.toBeNull();

    store.fail("entry-1", "provider error containing a credential");
    expect(readJob(fx.db)?.state).toBe("retry");
    expect(readJob(fx.db)?.last_error).toBe("Announcement processing failed");
    expect(store.claim()).toBeNull();
    fx.db
      .prepare("UPDATE bluesky_announcement_jobs SET next_attempt_at = 0")
      .run();

    const retry = store.claim();
    expect(retry?.rkey).toBe(first?.rkey);
    const uri = `at://${AUTHOR_DID}/app.bsky.feed.post/${retry?.rkey}`;
    store.recordPost("entry-1", uri, "post-cid");
    store.fail("entry-1", "attachment failed");
    expect(readJob(fx.db)).toMatchObject({
      state: "retry",
      uri,
      cid: "post-cid",
    });
    fx.db
      .prepare("UPDATE bluesky_announcement_jobs SET next_attempt_at = 0")
      .run();

    const attachRetry = store.claim();
    expect(attachRetry).toMatchObject({
      rkey: first?.rkey,
      uri,
      cid: "post-cid",
    });
    store.recordPost("entry-1", uri, "post-cid");
    store.complete("entry-1", AUTHOR_DID, attachRetry?.rkey as string);
    expect(readJob(fx.db)?.state).toBe("completed");
  });

  test("keeps the attempted post payload immutable across edits, backoff, and cancellation", () => {
    const fx = fixture();
    insertEntry(fx.db);
    const store = createStore(fx);
    store.reconcile();
    const first = store.claim();
    expect(first).not.toBeNull();
    store.fail("entry-1", "ambiguous provider failure");

    fx.db
      .prepare("UPDATE bluesky_announcement_jobs SET next_attempt_at = 0")
      .run();
    fx.db
      .prepare(
        "UPDATE ec_weeknotes SET slug = ?, bluesky_announcement = ?, description = ? WHERE id = ?",
      )
      .run("new-slug", "Changed teaser", "Changed card description", "entry-1");
    store.reconcile();
    const retry = store.claim();
    expect(retry).toMatchObject({
      entryId: "entry-1",
      slug: first?.slug,
      text: first?.text,
      description: first?.description,
      rkey: first?.rkey,
    });
    store.fail("entry-1", "second ambiguous failure");

    fx.db
      .prepare("UPDATE bluesky_announcement_jobs SET next_attempt_at = 0")
      .run();
    fx.db
      .prepare("UPDATE ec_weeknotes SET status = 'draft' WHERE id = ?")
      .run("entry-1");
    store.reconcile();
    expect(readJob(fx.db)?.state).toBe("cancelled");
    fx.db
      .prepare(
        "UPDATE ec_weeknotes SET status = 'published', slug = ?, bluesky_announcement = ?, description = ? WHERE id = ?",
      )
      .run(
        "republished-slug",
        "Republished teaser",
        "Republished card",
        "entry-1",
      );
    store.reconcile();
    const afterRepublish = store.claim();
    expect(afterRepublish).toMatchObject({
      slug: first?.slug,
      text: first?.text,
      description: first?.description,
      rkey: first?.rkey,
    });
    expect(readJob(fx.db)).toMatchObject({
      attempts: 3,
      created_at: first?.createdAt,
    });
  });

  test("attaches to the published base and a new live revision without changing staged edits or history", () => {
    const fx = fixture();
    const id = insertEntry(fx.db, {
      rowComments: { mastodon: "live-only" },
      revisionComments: { revisionOnly: "keep this" },
      draftData: {
        title: "Private staged title",
        body: "Private staged body",
        _slug: "private-staged-slug",
        comments: { draftOnly: "keep this too" },
        custom: { nested: true },
      },
    });
    const oldEntry = readEntry(fx.db, id);
    const oldLiveId = oldEntry.live_revision_id as string;
    const oldDraftId = oldEntry.draft_revision_id as string;
    const oldLiveData = readRevision(fx.db, oldLiveId).data;
    const oldDraftData = readRevision(fx.db, oldDraftId).data;
    const store = createStore(fx);
    store.reconcile();
    const job = store.claim();
    expect(job).not.toBeNull();
    store.recordPost(
      "entry-1",
      `at://${AUTHOR_DID}/app.bsky.feed.post/${job?.rkey}`,
      "real-cid",
    );
    store.complete("entry-1", AUTHOR_DID, job?.rkey as string);
    store.complete("entry-1", AUTHOR_DID, job?.rkey as string);

    const updatedEntry = readEntry(fx.db, id);
    const newLiveData = JSON.parse(
      String(readRevision(fx.db, updatedEntry.live_revision_id as string).data),
    );
    const newDraftData = JSON.parse(
      String(
        readRevision(fx.db, updatedEntry.draft_revision_id as string).data,
      ),
    );
    expect(updatedEntry).toMatchObject({
      status: "published",
      slug: "2026-w42",
      version: 8,
    });
    expect(updatedEntry.live_revision_id).not.toBe(oldLiveId);
    expect(updatedEntry.draft_revision_id).not.toBe(oldDraftId);
    expect(JSON.parse(String(updatedEntry.comments))).toEqual({
      revisionOnly: "keep this",
      mastodon: "live-only",
      bsky: { did: AUTHOR_DID, postCid: job?.rkey },
    });
    expect(newLiveData).toMatchObject({
      title: "Live title for 2026-w42",
      body: "Published body",
      _slug: "2026-w42",
      comments: {
        revisionOnly: "keep this",
        mastodon: "live-only",
        bsky: { did: AUTHOR_DID, postCid: job?.rkey },
      },
    });
    expect(newDraftData).toEqual({
      title: "Private staged title",
      body: "Private staged body",
      _slug: "private-staged-slug",
      comments: {
        draftOnly: "keep this too",
        bsky: { did: AUTHOR_DID, postCid: job?.rkey },
      },
      custom: { nested: true },
    });
    expect(readRevision(fx.db, oldLiveId).data).toBe(oldLiveData);
    expect(readRevision(fx.db, oldDraftId).data).toBe(oldDraftData);
    expect(readEntry(fx.db, id).status).toBe("published");
  });

  test("leaves a staged draft's explicit Bluesky thread untouched", () => {
    const fx = fixture();
    const draftData = {
      title: "Private staged title",
      body: "Private staged body",
      _slug: "private-staged-slug",
      comments: {
        bsky: { did: "did:plc:manual", postCid: "other-thread" },
        draftOnly: "preserved",
      },
    };
    insertEntry(fx.db, { draftData });
    const original = readEntry(fx.db);
    const draftId = original.draft_revision_id as string;
    const originalDraft = readRevision(fx.db, draftId).data;
    const store = createStore(fx);
    store.reconcile();
    const job = store.claim();
    expect(job).not.toBeNull();
    store.recordPost(
      "entry-1",
      `at://${AUTHOR_DID}/app.bsky.feed.post/${job?.rkey}`,
      "post-cid",
    );
    store.complete("entry-1", AUTHOR_DID, job?.rkey as string);

    expect(readEntry(fx.db).draft_revision_id).toBe(draftId);
    expect(readRevision(fx.db, draftId).data).toBe(originalDraft);
    expect(readEntry(fx.db).status).toBe("published");
    expect(JSON.parse(String(readEntry(fx.db).comments))).toEqual({
      bsky: { did: AUTHOR_DID, postCid: job?.rkey },
    });
  });

  test("preserves an existing manual thread and never creates a second announcement", () => {
    const fx = fixture();
    insertEntry(fx.db);
    const store = createStore(fx);
    store.reconcile();
    fx.db.prepare("UPDATE ec_weeknotes SET comments = ? WHERE id = ?").run(
      JSON.stringify({
        bsky: { did: "did:plc:manual", postCid: "manual-key" },
        other: "kept",
      }),
      "entry-1",
    );

    expect(store.claim()).toBeNull();
    expect(readJob(fx.db)?.state).toBe("skipped");
    expect(JSON.parse(String(readEntry(fx.db).comments))).toEqual({
      bsky: { did: "did:plc:manual", postCid: "manual-key" },
      other: "kept",
    });
  });

  test("does not enqueue private entries and does not announce again after republishing a completed entry", () => {
    const fx = fixture();
    insertEntry(fx.db);
    insertEntry(fx.db, { id: "draft-only", status: "draft" });
    const store = createStore(fx);
    store.reconcile();
    const job = store.claim();
    expect(job).not.toBeNull();
    store.recordPost(
      "entry-1",
      `at://${AUTHOR_DID}/app.bsky.feed.post/${job?.rkey}`,
      "post-cid",
    );
    store.complete("entry-1", AUTHOR_DID, job?.rkey as string);

    const current = readEntry(fx.db);
    const republishedRevisionId = "republished-entry-1";
    insertRevision(fx.db, republishedRevisionId, "entry-1", {
      title: "Republished title",
      body: "Republished body",
      _slug: "2026-w42",
      comments: JSON.parse(String(current.comments)),
    });
    fx.db
      .prepare(
        "UPDATE ec_weeknotes SET status = 'draft', live_revision_id = ? WHERE id = ?",
      )
      .run(republishedRevisionId, "entry-1");
    fx.db
      .prepare("UPDATE ec_weeknotes SET status = 'published' WHERE id = ?")
      .run("entry-1");
    store.reconcile();

    expect(store.claim()).toBeNull();
    expect(readJob(fx.db)?.state).toBe("completed");
    expect(
      (
        fx.db
          .prepare("SELECT COUNT(*) AS count FROM bluesky_announcement_jobs")
          .get() as { count: number }
      ).count,
    ).toBe(1);
    expect(readJob(fx.db, "draft-only")).toBeUndefined();
  });

  test.each([
    ["unpublish", "UPDATE ec_weeknotes SET status = 'draft' WHERE id = ?"],
    [
      "soft delete",
      "UPDATE ec_weeknotes SET deleted_at = '2026-10-24T00:00:00.000Z' WHERE id = ?",
    ],
    [
      "remove teaser",
      "UPDATE ec_weeknotes SET bluesky_announcement = NULL WHERE id = ?",
    ],
  ])(
    "cancels a pending job when an entry is no longer eligible (%s)",
    (_label, sql) => {
      const fx = fixture();
      insertEntry(fx.db);
      const store = createStore(fx);
      store.reconcile();
      const original = readJob(fx.db);
      fx.db.prepare(sql).run("entry-1");
      store.reconcile();

      expect(store.claim()).toBeNull();
      expect(readJob(fx.db)?.state).toBe("cancelled");

      if (_label !== "soft delete") {
        fx.db
          .prepare(
            "UPDATE ec_weeknotes SET status = 'published', deleted_at = NULL, bluesky_announcement = ? WHERE id = ?",
          )
          .run("A restored teaser.", "entry-1");
        store.reconcile();
        expect(store.claim()?.rkey).toBe(original?.rkey);
        expect(
          (
            fx.db
              .prepare(
                "SELECT COUNT(*) AS count FROM bluesky_announcement_jobs",
              )
              .get() as { count: number }
          ).count,
        ).toBe(1);
      }
    },
  );

  test("cancels an announcement when its content row is hard-deleted", () => {
    const fx = fixture();
    insertEntry(fx.db);
    const store = createStore(fx);
    store.reconcile();
    fx.db.prepare("DELETE FROM ec_weeknotes WHERE id = ?").run("entry-1");
    store.reconcile();

    expect(store.claim()).toBeNull();
    expect(readJob(fx.db)?.state).toBe("cancelled");
  });

  test("recovers a persisted post reference after attachment failure without replacing its record", () => {
    const fx = fixture();
    insertEntry(fx.db);
    const store = createStore(fx);
    store.reconcile();
    const job = store.claim();
    expect(job).not.toBeNull();
    const uri = `at://${AUTHOR_DID}/app.bsky.feed.post/${job?.rkey}`;
    store.recordPost("entry-1", uri, "post-cid");
    fx.db.exec(`
      CREATE TRIGGER fail_announcement_revision
      BEFORE INSERT ON revisions
      BEGIN
        SELECT RAISE(ABORT, 'simulated attachment failure');
      END;
    `);

    expect(() =>
      store.complete("entry-1", AUTHOR_DID, job?.rkey as string),
    ).toThrow();
    expect(readJob(fx.db)).toMatchObject({
      state: "posted",
      uri,
      cid: "post-cid",
    });
    expect(readEntry(fx.db).live_revision_id).toBe("live-entry-1");
    fx.db.exec("DROP TRIGGER fail_announcement_revision");
    store.fail("entry-1", "attachment failed");
    fx.db
      .prepare("UPDATE bluesky_announcement_jobs SET next_attempt_at = 0")
      .run();

    const retry = store.claim();
    expect(retry).toMatchObject({ uri, cid: "post-cid", rkey: job?.rkey });
    store.recordPost("entry-1", uri, "post-cid");
    store.complete("entry-1", AUTHOR_DID, retry?.rkey as string);
    expect(readJob(fx.db)?.state).toBe("completed");
    expect(readEntry(fx.db).live_revision_id).not.toBe("live-entry-1");
  });
});
