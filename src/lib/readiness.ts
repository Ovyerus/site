import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { databasePath, isReadOnlyReplica } from "./deployment";

/** No writes or archive scans; a mounted but unbootstrapped replica is not ready. */
export function databaseIsReady(path = databasePath()): boolean {
  // LiteFS reports zero lag before initial sync. On Fly, an old replica file
  // alone is not proof that this machine is currently attached to its writer.
  if (isReadOnlyReplica() && process.env.FLY_MACHINE_ID) {
    try {
      const primary = readFileSync(
        join(dirname(path), ".primary"),
        "utf8",
      ).trim();
      if (!primary || primary !== process.env.PRIMARY_MACHINE_ID) return false;
    } catch {
      return false;
    }
  }
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    db.prepare("SELECT title, body FROM ec_posts LIMIT 0").all();
    db.prepare(
      "SELECT title, body, bluesky_announcement FROM ec_weeknotes LIMIT 0",
    ).all();
    db.prepare("SELECT title, body FROM ec_pages LIMIT 0").all();
    db.prepare("SELECT title, tagline FROM ec_home LIMIT 0").all();
    const guards = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN ('weeknotes_iso_week_insert', 'weeknotes_iso_week_update')",
      )
      .all();
    return guards.length === 2;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}
