import { access } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { parseWeeknoteId, weeknoteIdPattern } from "../src/lib/iso-week.ts";

const databasePath = process.argv[2] ?? "data/emdash.db";
await access(databasePath);
const database = new DatabaseSync(databasePath);
database.exec("PRAGMA busy_timeout = 5000");

const getRevision = database.prepare("SELECT * FROM revisions WHERE id = ?");
const insertRevision = database.prepare(
  "INSERT INTO revisions (id, collection, entry_id, data, author_id) VALUES (?, 'weeknotes', ?, ?, NULL)",
);

function migrateRevision(id, entryId, slug, draft = false) {
  if (!id) return id;
  const revision = getRevision.get(id);
  if (
    !revision ||
    revision.collection !== "weeknotes" ||
    revision.entry_id !== entryId
  ) {
    throw new Error(`Missing weeknote revision ${id} for ${entryId}`);
  }
  const data = JSON.parse(revision.data);
  const week = draft && data._slug !== undefined ? data._slug : slug;
  parseWeeknoteId(week);
  if (data.title === week) return id;
  data.title = week;
  const newId = randomUUID();
  insertRevision.run(newId, entryId, JSON.stringify(data));
  return newId;
}

let changed = 0;
try {
  database.exec("BEGIN IMMEDIATE");
  const entries = database.prepare("SELECT * FROM ec_weeknotes").all();
  const update = database.prepare(
    "UPDATE ec_weeknotes SET title = ?, live_revision_id = ?, draft_revision_id = ?, version = version + 1 WHERE id = ?",
  );
  for (const entry of entries) {
    parseWeeknoteId(entry.slug);
    const live = migrateRevision(entry.live_revision_id, entry.id, entry.slug);
    const draft = migrateRevision(
      entry.draft_revision_id,
      entry.id,
      entry.slug,
      true,
    );
    if (
      entry.title !== entry.slug ||
      live !== entry.live_revision_id ||
      draft !== entry.draft_revision_id
    ) {
      update.run(entry.slug, live, draft, entry.id);
      changed++;
    }
  }

  const field = database
    .prepare(
      "SELECT id, validation FROM _emdash_fields WHERE collection_id = (SELECT id FROM _emdash_collections WHERE slug = 'weeknotes') AND slug = 'title'",
    )
    .get();
  if (!field) throw new Error("Weeknotes title field not found");
  const validation = {
    ...JSON.parse(field.validation ?? "{}"),
    pattern: weeknoteIdPattern,
  };
  database
    .prepare(
      "UPDATE _emdash_fields SET label = 'ISO week', validation = ? WHERE id = ?",
    )
    .run(JSON.stringify(validation), field.id);
  database
    .prepare(
      "UPDATE _emdash_collections SET description = ? WHERE slug = 'weeknotes'",
    )
    .run(
      "Weeknote slugs and admin titles use YYYY-wWW (e.g. 2026-w41); the public title and date derive from the ISO week.",
    );
  // Policy hooks do not run for direct creates with status: "published".
  // Keep public/scheduled rows valid even for imports and direct API writes.
  const validSlug = `
    NEW.slug GLOB '[0-9][0-9][0-9][0-9]-w[0-9][0-9]'
    AND strftime('%G-w%V', date(
      substr(NEW.slug, 1, 4) || '-01-04',
      '-6 days', 'weekday 1',
      printf('+%d days', (CAST(substr(NEW.slug, 7, 2) AS INTEGER) - 1) * 7)
    )) = NEW.slug
  `;
  for (const operation of ["INSERT", "UPDATE"]) {
    const name = `weeknotes_iso_week_${operation.toLowerCase()}`;
    database.exec(`
      DROP TRIGGER IF EXISTS ${name};
      CREATE TRIGGER ${name} BEFORE ${operation} ON ec_weeknotes
      WHEN NEW.status IN ('published', 'scheduled')
        AND (NEW.title IS NOT NEW.slug OR NOT COALESCE((${validSlug}), 0))
      BEGIN
        SELECT RAISE(ABORT, 'Weeknotes require matching valid YYYY-wWW slug and title.');
      END;
    `);
  }
  database.exec("COMMIT");
  console.log(
    `Migrated ${changed} weeknote titles; historical revisions and article bodies preserved.`,
  );
} catch (error) {
  database.exec("ROLLBACK");
  throw error;
} finally {
  database.close();
}
