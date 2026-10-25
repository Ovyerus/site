import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

let directory: string;
let database: DatabaseSync;
let path: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "bluesky-announcement-migration-"));
  path = join(directory, "emdash.db");
  database = new DatabaseSync(path);
  database.exec(`
    CREATE TABLE _emdash_collections (id TEXT PRIMARY KEY, slug TEXT);
    INSERT INTO _emdash_collections VALUES ('weeknotes-collection', 'weeknotes');
    CREATE TABLE _emdash_fields (
      id TEXT PRIMARY KEY, collection_id TEXT, slug TEXT, label TEXT, type TEXT,
      column_type TEXT, required INTEGER, "unique" INTEGER, default_value TEXT,
      validation TEXT, widget TEXT, options TEXT, sort_order INTEGER,
      created_at TEXT, searchable INTEGER, translatable INTEGER, indexed INTEGER
    );
    INSERT INTO _emdash_fields VALUES (
      'title-field', 'weeknotes-collection', 'title', 'Title', 'text', 'TEXT',
      1, 0, NULL, NULL, NULL, NULL, 0, '2026-01-01T00:00:00.000Z', 0, 1, 0
    );
    CREATE TABLE ec_weeknotes (
      id TEXT PRIMARY KEY, slug TEXT, status TEXT, title TEXT, body TEXT,
      comments TEXT, version INTEGER, live_revision_id TEXT
    );
    INSERT INTO ec_weeknotes VALUES (
      'entry-1', '2026-w01', 'published', '2026-w01', 'Published body',
      '{"bsky":{"did":"did:plc:manual","postCid":"cid"}}', 7, 'revision-1'
    );
    CREATE TABLE revisions (id TEXT PRIMARY KEY, data TEXT);
    INSERT INTO revisions VALUES ('revision-1', '{"title":"2026-w01","body":"Published body"}');
  `);
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true });
});

describe("Bluesky announcement schema migration", () => {
  test("adds the optional field once without rewriting entries or revisions", () => {
    const originalEntry = database
      .prepare("SELECT * FROM ec_weeknotes WHERE id = 'entry-1'")
      .get();
    const originalRevision = database
      .prepare("SELECT data FROM revisions WHERE id = 'revision-1'")
      .get();

    execFileSync(process.execPath, [
      "scripts/migrate-bluesky-announcements.mjs",
      path,
    ]);

    const columns = database.prepare("PRAGMA table_info(ec_weeknotes)").all();
    expect(
      columns.find((column) => column.name === "bluesky_announcement"),
    ).toMatchObject({
      type: "TEXT",
      notnull: 0,
    });
    expect(
      database
        .prepare(
          "SELECT type, column_type, required FROM _emdash_fields WHERE collection_id = 'weeknotes-collection' AND slug = 'bluesky_announcement'",
        )
        .get(),
    ).toEqual({
      type: "text",
      column_type: "TEXT",
      required: 0,
    });
    expect(
      database.prepare("SELECT * FROM ec_weeknotes WHERE id = 'entry-1'").get(),
    ).toEqual({
      ...originalEntry,
      bluesky_announcement: null,
    });
    expect(
      database
        .prepare("SELECT data FROM revisions WHERE id = 'revision-1'")
        .get(),
    ).toEqual(originalRevision);

    execFileSync(process.execPath, [
      "scripts/migrate-bluesky-announcements.mjs",
      path,
    ]);

    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM _emdash_fields WHERE collection_id = 'weeknotes-collection' AND slug = 'bluesky_announcement'",
        )
        .get().count,
    ).toBe(1);
    expect(
      database.prepare("SELECT * FROM ec_weeknotes WHERE id = 'entry-1'").get(),
    ).toEqual({
      ...originalEntry,
      bluesky_announcement: null,
    });
    expect(
      database
        .prepare("SELECT data FROM revisions WHERE id = 'revision-1'")
        .get(),
    ).toEqual(originalRevision);
  });
});
