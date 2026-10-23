import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

let directory: string;
let database: DatabaseSync;
let path: string;

function migrate() {
  execFileSync(process.execPath, ["scripts/migrate-weeknotes.mjs", path]);
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "weeknote-migration-"));
  path = join(directory, "emdash.db");
  database = new DatabaseSync(path);
  database.exec(`
    CREATE TABLE _emdash_collections (id TEXT PRIMARY KEY, slug TEXT, description TEXT);
    INSERT INTO _emdash_collections VALUES ('collection', 'weeknotes', '');
    CREATE TABLE _emdash_fields (id TEXT PRIMARY KEY, collection_id TEXT, slug TEXT, label TEXT, validation TEXT);
    INSERT INTO _emdash_fields VALUES ('title', 'collection', 'title', 'Admin title', NULL);
    CREATE TABLE revisions (id TEXT PRIMARY KEY, collection TEXT, entry_id TEXT, data TEXT, author_id TEXT);
    CREATE TABLE ec_weeknotes (
      id TEXT PRIMARY KEY, slug TEXT, title TEXT, body TEXT, status TEXT,
      live_revision_id TEXT, draft_revision_id TEXT, version INTEGER DEFAULT 1
    );
    INSERT INTO ec_weeknotes VALUES ('entry', '2020-w53', 'Long title', 'Published text', 'published', 'live', 'draft', 1);
  `);
  const insert = database.prepare(
    "INSERT INTO revisions VALUES (?, 'weeknotes', 'entry', ?, 'author')",
  );
  insert.run(
    "live",
    JSON.stringify({ title: "Long title", body: "Published text" }),
  );
  insert.run(
    "draft",
    JSON.stringify({
      title: "Draft title",
      body: "Private edits",
      _slug: "2026-w43",
    }),
  );
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true });
});

describe("weeknote migration", () => {
  test("preserves live text, staged edits, and immutable history; reruns change nothing", () => {
    const history = database
      .prepare("SELECT * FROM revisions ORDER BY id")
      .all();
    migrate();
    const entry = database.prepare("SELECT * FROM ec_weeknotes").get()!;
    expect(entry.title).toBe("2020-w53");
    expect(entry.body).toBe("Published text");
    expect(entry.status).toBe("published");
    const currentDraft = database
      .prepare("SELECT data FROM revisions WHERE id = ?")
      .get(entry.draft_revision_id)!;
    expect(JSON.parse(currentDraft.data as string)).toEqual({
      title: "2026-w43",
      body: "Private edits",
      _slug: "2026-w43",
    });
    for (const revision of history) {
      expect(
        database
          .prepare("SELECT * FROM revisions WHERE id = ?")
          .get(revision.id),
      ).toEqual(revision);
    }
    const revisions = database
      .prepare("SELECT * FROM revisions ORDER BY id")
      .all();
    migrate();
    expect(database.prepare("SELECT * FROM ec_weeknotes").get()).toEqual(entry);
    expect(
      database.prepare("SELECT * FROM revisions ORDER BY id").all(),
    ).toEqual(revisions);
  });

  test("guards direct published inserts and scheduled updates, including nonexistent week 53", () => {
    migrate();
    const insert = database.prepare(
      "INSERT INTO ec_weeknotes (id, slug, title, status) VALUES (?, ?, ?, 'published')",
    );
    for (const [slug, title] of [
      ["2026-w3", "2026-w3"],
      ["2021-w53", "2021-w53"],
      ["2026-w43", "2026-w42"],
    ]) {
      expect(() => insert.run(slug, slug, title)).toThrow(
        "matching valid YYYY-wWW",
      );
    }
    expect(() =>
      database
        .prepare(
          "UPDATE ec_weeknotes SET status = 'scheduled', slug = '2021-w53', title = '2021-w53' WHERE id = 'entry'",
        )
        .run(),
    ).toThrow("matching valid YYYY-wWW");
    insert.run("valid", "2026-w53", "2026-w53");
    expect(
      database
        .prepare(
          "SELECT slug, title, status FROM ec_weeknotes WHERE id = 'valid'",
        )
        .get(),
    ).toEqual({
      slug: "2026-w53",
      title: "2026-w53",
      status: "published",
    });
  });
});
