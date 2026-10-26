import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { databasePath } from "./deployment";
import { documentUri, publicationRkey, publicationUri } from "./standard-site";

type Collection = "posts" | "weeknotes";

/** Discovery never initializes the CMS database or the writer's ledger. */
function readVerified<T>(
  path: string,
  tables: string[],
  query: (db: DatabaseSync) => T | null,
): T | null {
  if (!existsSync(path)) return null;
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec("PRAGMA query_only = ON");
    const present = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => row.name),
    );
    if (tables.some((table) => !present.has(table))) return null;
    return query(db);
  } finally {
    db.close();
  }
}

export function getStandardPublicationUri(
  path = databasePath(),
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (env.STANDARD_SITE_ENABLED !== "true") return null;
  return readVerified(path, ["standard_site_records"], (db) => {
    const row = db
      .prepare(
        `
      SELECT cid FROM standard_site_records
      WHERE collection = 'publication' AND entry_id = 'site' AND rkey = ?
    `,
      )
      .get(publicationRkey);
    return typeof row?.cid === "string" && row.cid.length > 0
      ? publicationUri
      : null;
  });
}

export function getStandardDocumentUri(
  collection: Collection,
  slug: string | undefined,
  path = databasePath(),
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (env.STANDARD_SITE_ENABLED !== "true") return null;
  if (collection !== "posts" && collection !== "weeknotes") return null;
  // Path segments must remain literal, and never permit encoded separators or traversal.
  if (
    !slug ||
    slug === "." ||
    slug === ".." ||
    /[\/?#%\\\u0000-\u0020]/.test(slug)
  )
    return null;
  return readVerified(
    path,
    ["standard_site_records", `ec_${collection}`],
    (db) => {
      const row = db
        .prepare(
          `
      SELECT r.rkey FROM ec_${collection} AS e
      JOIN standard_site_records AS r
        ON r.collection = ? AND r.entry_id = e.id
      WHERE e.slug = ? AND e.status = 'published' AND e.deleted_at IS NULL
        AND r.cid IS NOT NULL AND r.cid <> '' AND r.verified_path = ?
      LIMIT 1
    `,
        )
        .get(collection, slug, `/${collection}/${encodeURIComponent(slug)}`);
      return typeof row?.rkey === "string" ? documentUri(row.rkey) : null;
    },
  );
}
