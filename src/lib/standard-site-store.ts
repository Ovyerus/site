import { createHash, randomUUID } from "node:crypto";
import { accessSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { databasePath, isReadOnlyReplica } from "./deployment";
import {
  buildDocument,
  makeStandardRkey,
  publicationRecord,
  publicationRkey,
  type PublishedArticle,
  type StandardClient,
  type StandardCollection,
} from "./standard-site";

const MAX_DOCUMENTS = 5000;
const LEASE_MS = 120_000;
const kinds = ["posts", "weeknotes"] as const;
type Kind = StandardCollection | "publication";
interface Ledger {
  collection: Kind;
  entry_id: string;
  rkey: string;
  desired_hash: string | null;
  synced_hash: string | null;
  cid: string | null;
  verified_path: string | null;
  attempts: number;
  next_attempt_at: number;
  claim_token: string | null;
  lease_until: number | null;
  intent_hash: string | null;
  last_error: string | null;
}
interface Source {
  id: string;
  slug: string;
  status: string;
  deleted_at: string | null;
  live_revision_id: string | null;
  revision_id: string | null;
  revision_date: string | null;
}
export type SyncResult = "idle" | "synced" | "deleted" | "changed" | "failed";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
function desired(source: Source | undefined): string | null {
  if (!source || source.status !== "published" || source.deleted_at !== null)
    return null;
  // A missing revision is an error to retry, NOT permission to publish mutable fields.
  return digest([
    source.slug,
    source.live_revision_id,
    source.revision_id,
    source.revision_date,
    1,
  ]);
}
function namespace(kind: Kind) {
  return `site.standard.${kind === "publication" ? "publication" : "document"}`;
}
class Conflict extends Error {
  override name = "StandardSiteConflict";
}

/** Stores only integration state in the existing CMS DB, never article bodies/history. */
export class StandardSiteStore {
  readonly #db: DatabaseSync;
  readonly #now: () => number;
  constructor(path = databasePath(), now: () => number = Date.now) {
    if (isReadOnlyReplica())
      throw new Error("Standard.site writes require the primary");
    accessSync(path); // Never create a stray empty CMS database.
    this.#db = new DatabaseSync(path);
    this.#now = now;
    this.#db.exec("PRAGMA busy_timeout=5000");
    this.#db.exec(`CREATE TABLE IF NOT EXISTS standard_site_records (
      collection TEXT NOT NULL CHECK(collection IN ('publication','posts','weeknotes')),
      entry_id TEXT NOT NULL, rkey TEXT NOT NULL UNIQUE,
      desired_hash TEXT, synced_hash TEXT, cid TEXT, verified_path TEXT,
      attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0,
      claim_token TEXT, lease_until INTEGER, intent_hash TEXT, last_error TEXT,
      PRIMARY KEY(collection,entry_id)
    );
    CREATE INDEX IF NOT EXISTS standard_site_due ON standard_site_records(next_attempt_at,lease_until);`);
    this.#db
      .prepare(
        `INSERT INTO standard_site_records(collection,entry_id,rkey,desired_hash)
      VALUES ('publication','site',?,?) ON CONFLICT(collection,entry_id) DO UPDATE SET
      desired_hash=excluded.desired_hash,attempts=0,next_attempt_at=0,last_error=NULL
      WHERE standard_site_records.desired_hash IS NOT excluded.desired_hash`,
      )
      .run(publicationRkey, digest(publicationRecord()));
  }

  #transaction<T>(fn: () => T): T {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.#db.exec("COMMIT");
      return value;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }
  #source(kind: StandardCollection, id: string): Source | undefined {
    return this.#db
      .prepare(
        `SELECT e.id,e.slug,e.status,e.deleted_at,e.live_revision_id,
      r.id AS revision_id,r.created_at AS revision_date FROM ec_${kind} e
      LEFT JOIN revisions r ON r.id=e.live_revision_id AND r.collection=? AND r.entry_id=e.id
      WHERE e.id=?`,
      )
      .get(kind, id) as Source | undefined;
  }
  #row(kind: Kind, id: string): Ledger {
    return this.#db
      .prepare(
        "SELECT * FROM standard_site_records WHERE collection=? AND entry_id=?",
      )
      .get(kind, id) as unknown as Ledger;
  }
  #track(kind: StandardCollection, id: string) {
    const source = this.#source(kind, id);
    if (!source || desired(source) === null || this.#row(kind, id)) return;
    const count = this.#db
      .prepare("SELECT count(*) AS n FROM standard_site_records")
      .get()!.n as number;
    if (count >= MAX_DOCUMENTS + 1)
      throw new Error("Standard.site tracked-document limit reached");
    // A deterministic TID is allocated once, durably before the first remote write.
    let rkey = "";
    for (let offset = 0; offset < 1024; offset++) {
      rkey = makeStandardRkey(
        new Date(this.#now() + offset).toISOString(),
        `${kind}:${id}`,
      );
      if (
        !this.#db
          .prepare("SELECT 1 FROM standard_site_records WHERE rkey=?")
          .get(rkey)
      )
        break;
      rkey = "";
    }
    if (!rkey) throw new Error("Unable to allocate a unique document TID");
    this.#db
      .prepare(
        `INSERT INTO standard_site_records(collection,entry_id,rkey,desired_hash)
      VALUES (?,?,?,?)`,
      )
      .run(kind, id, rkey, desired(source));
  }
  track(collection: StandardCollection, entryId: string): void {
    if (!kinds.includes(collection))
      throw new Error("Unsupported Standard.site collection");
    this.#transaction(() => {
      this.#track(collection, entryId);
      this.#refresh(collection, entryId);
    });
  }
  #refresh(kind: StandardCollection, id: string) {
    const row = this.#row(kind, id);
    if (!row) return;
    const hash = desired(this.#source(kind, id));
    if (hash !== row.desired_hash)
      this.#db
        .prepare(
          `UPDATE standard_site_records SET
      desired_hash=?,attempts=0,next_attempt_at=0,last_error=NULL WHERE collection=? AND entry_id=?`,
        )
        .run(hash, kind, id);
  }
  /** Opt-in backfill enrolls public metadata only. Missing/failed sources never imply global deletion. */
  reconcile(backfill = false): void {
    this.#transaction(() => {
      if (backfill)
        for (const kind of kinds) {
          const entries = this.#db
            .prepare(
              `SELECT id FROM ec_${kind}
          WHERE status='published' AND deleted_at IS NULL LIMIT ?`,
            )
            .all(MAX_DOCUMENTS + 1);
          if (entries.length > MAX_DOCUMENTS)
            throw new Error("Standard.site backfill limit reached");
          for (const entry of entries) this.#track(kind, entry.id as string);
        }
      for (const row of this.status())
        if (row.collection !== "publication") {
          this.#refresh(row.collection, row.entry_id);
        }
    });
  }
  status(): Ledger[] {
    return this.#db
      .prepare(
        "SELECT * FROM standard_site_records ORDER BY collection,entry_id LIMIT ?",
      )
      .all(MAX_DOCUMENTS + 2) as unknown as Ledger[];
  }
  #claim(): Ledger | undefined {
    return this.#transaction(() => {
      const pub = this.#row("publication", "site");
      const publicationReady =
        pub.cid !== null && pub.desired_hash === pub.synced_hash;
      const row = this.#db
        .prepare(
          `SELECT * FROM standard_site_records WHERE
        (desired_hash IS NOT synced_hash OR intent_hash IS NOT NULL) AND next_attempt_at<=?
        AND (claim_token IS NULL OR lease_until<=?)
        ${publicationReady ? "" : "AND collection='publication'"}
        ORDER BY CASE collection WHEN 'publication' THEN 0 ELSE 1 END,next_attempt_at,entry_id LIMIT 1`,
        )
        .get(this.#now(), this.#now()) as unknown as Ledger | undefined;
      if (!row) return;
      row.claim_token = randomUUID();
      row.lease_until = this.#now() + LEASE_MS;
      this.#db
        .prepare(
          `UPDATE standard_site_records SET claim_token=?,lease_until=?
        WHERE collection=? AND entry_id=?`,
        )
        .run(row.claim_token, row.lease_until, row.collection, row.entry_id);
      return row;
    });
  }
  #owned(row: Ledger): boolean {
    const current = this.#row(row.collection, row.entry_id);
    return (
      current?.claim_token === row.claim_token &&
      (current.lease_until ?? 0) > this.#now()
    );
  }
  #leaseUpdate(row: Ledger, sql: string, values: (string | number | null)[]) {
    if (!this.#owned(row)) throw new Error("Standard.site lease lost");
    this.#db
      .prepare(
        `UPDATE standard_site_records SET ${sql} WHERE collection=? AND entry_id=? AND claim_token=?`,
      )
      .run(...values, row.collection, row.entry_id, row.claim_token);
  }
  #current(row: Ledger): boolean {
    if (!this.#owned(row)) return false;
    const hash =
      row.collection === "publication"
        ? digest(publicationRecord())
        : desired(this.#source(row.collection, row.entry_id));
    return row.desired_hash === hash;
  }
  #release(row: Ledger) {
    this.#leaseUpdate(row, "claim_token=NULL,lease_until=NULL", []);
  }
  #record(row: Ledger): Record<string, unknown> {
    if (row.collection === "publication") return publicationRecord();
    const source = this.#source(row.collection, row.entry_id);
    if (!source?.revision_id || !source.revision_date)
      throw new Error("Published revision missing");
    const revision = this.#db
      .prepare(
        `SELECT data FROM revisions WHERE id=? AND collection=? AND entry_id=?`,
      )
      .get(source.revision_id, row.collection, row.entry_id);
    const data: unknown = JSON.parse(revision!.data as string);
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error("Invalid published revision");
    const article: PublishedArticle = {
      collection: row.collection,
      entryId: row.entry_id,
      slug: source.slug,
      data: data as Record<string, unknown>,
      publishedAt: source.revision_date,
      updatedAt: source.revision_date,
    };
    return buildDocument(article);
  }
  /** Exactly one leased network operation per tick; no CMS transaction spans network I/O. */
  async syncOne(client: StandardClient): Promise<SyncResult> {
    const row = this.#claim();
    if (!row) return "idle";
    try {
      if (!this.#current(row)) {
        this.#release(row);
        return "changed";
      }
      const ns = namespace(row.collection);
      const remote = await client.get(ns, row.rkey);
      if (!this.#owned(row)) return "changed";
      // Recover an acknowledged-or-lost previous PUT before replacing its durable intent.
      if (
        remote &&
        row.intent_hash &&
        digest(remote.value) === row.intent_hash
      ) {
        this.#leaseUpdate(row, "cid=?,intent_hash=NULL", [remote.cid]);
        row.cid = remote.cid;
        row.intent_hash = null;
      }
      if (remote && remote.cid !== row.cid) {
        // An unowned record or a manual PDS edit is NEVER overwritten/deleted.
        throw new Conflict("Remote record changed outside this integration");
      }
      if (!this.#current(row)) {
        this.#release(row);
        return "changed";
      }
      if (row.desired_hash === null) {
        if (remote) await client.delete(ns, row.rkey, remote.cid);
        if (await client.get(ns, row.rkey))
          throw new Error("Remote deletion not confirmed");
        this.#leaseUpdate(
          row,
          `cid=NULL,verified_path=NULL,synced_hash=NULL,intent_hash=NULL,
          attempts=0,next_attempt_at=0,last_error=NULL,claim_token=NULL,lease_until=NULL`,
          [],
        );
        return "deleted";
      }
      const value = this.#record(row);
      const hash = digest(value);
      let cid = remote?.cid ?? null;
      if (!remote || digest(remote.value) !== hash) {
        this.#leaseUpdate(row, "intent_hash=?", [hash]);
        if (!this.#current(row)) {
          this.#release(row);
          return "changed";
        }
        const result = await client.put(ns, row.rkey, value, cid);
        cid = result.cid;
      }
      const verified = await client.get(ns, row.rkey);
      if (
        !verified ||
        verified.cid !== cid ||
        digest(verified.value) !== hash
      ) {
        throw new Error("Remote record readback failed");
      }
      this.#leaseUpdate(
        row,
        `cid=?,verified_path=?,synced_hash=?,intent_hash=NULL,
        attempts=0,next_attempt_at=0,last_error=NULL,claim_token=NULL,lease_until=NULL`,
        [
          cid,
          row.collection === "publication" ? "/" : (value.path as string),
          row.desired_hash,
        ],
      );
      return "synced";
    } catch (error) {
      if (this.#owned(row)) {
        const attempts = Math.min(row.attempts + 1, 30);
        const delay = Math.min(
          6 * 3600_000,
          30_000 * 2 ** Math.min(attempts, 10),
        );
        const name =
          error instanceof Error &&
          /^[A-Za-z][A-Za-z0-9]{0,79}$/.test(error.name)
            ? error.name
            : "Error";
        this.#leaseUpdate(
          row,
          `attempts=?,next_attempt_at=?,last_error=?,claim_token=NULL,lease_until=NULL`,
          [attempts, this.#now() + delay, name],
        );
      }
      return "failed";
    }
  }
  close(): void {
    this.#db.close();
  }
}
