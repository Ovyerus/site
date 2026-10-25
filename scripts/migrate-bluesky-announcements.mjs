import { access } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

const databasePath = process.argv[2] ?? "data/emdash.db";
await access(databasePath);
const database = new DatabaseSync(databasePath);
database.exec("PRAGMA busy_timeout = 5000");

const fieldLabel = "Bluesky announcement (plain-text teaser)";
let transactionOpen = false;
try {
  database.exec("BEGIN IMMEDIATE");
  transactionOpen = true;

  const collection = database
    .prepare("SELECT id FROM _emdash_collections WHERE slug = 'weeknotes'")
    .get();
  if (!collection) throw new Error("Weeknotes collection not found");

  const columns = database.prepare("PRAGMA table_info(ec_weeknotes)").all();
  if (columns.length === 0)
    throw new Error("Weeknotes content table not found");
  const announcementColumn = columns.find(
    (column) => column.name === "bluesky_announcement",
  );
  if (announcementColumn && announcementColumn.type.toUpperCase() !== "TEXT") {
    throw new Error("Weeknotes bluesky_announcement column must be TEXT");
  }
  if (!announcementColumn) {
    database.exec(
      "ALTER TABLE ec_weeknotes ADD COLUMN bluesky_announcement TEXT",
    );
  }

  const field = database
    .prepare(
      "SELECT id FROM _emdash_fields WHERE collection_id = ? AND slug = 'bluesky_announcement'",
    )
    .get(collection.id);
  if (field) {
    database
      .prepare(
        `UPDATE _emdash_fields
         SET label = ?, type = 'text', column_type = 'TEXT', required = 0,
             "unique" = 0, default_value = NULL, validation = NULL,
             widget = NULL, options = NULL
         WHERE id = ?`,
      )
      .run(fieldLabel, field.id);
  } else {
    const sortOrder = database
      .prepare(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 AS sort_order FROM _emdash_fields WHERE collection_id = ?",
      )
      .get(collection.id).sort_order;
    database
      .prepare(
        `INSERT INTO _emdash_fields (
           id, collection_id, slug, label, type, column_type, required, "unique",
           default_value, validation, widget, options, sort_order, created_at,
           searchable, translatable, indexed
         ) VALUES (?, ?, 'bluesky_announcement', ?, 'text', 'TEXT', 0, 0,
                   NULL, NULL, NULL, NULL, ?, ?, 0, 1, 0)`,
      )
      .run(
        randomUUID(),
        collection.id,
        fieldLabel,
        sortOrder,
        new Date().toISOString(),
      );
  }

  const entryCount = database
    .prepare("SELECT COUNT(*) AS count FROM ec_weeknotes")
    .get().count;
  database.exec("COMMIT");
  transactionOpen = false;
  console.log(
    `Weeknote Bluesky announcement schema ready; ${entryCount} existing entries and their revisions were left unchanged.`,
  );
} catch (error) {
  if (transactionOpen) database.exec("ROLLBACK");
  throw error;
} finally {
  database.close();
}
