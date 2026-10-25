import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { invalidateCollectionCache } from "emdash";
import { databasePath, isReadOnlyReplica } from "./deployment";

export interface AnnouncementJob {
  entryId: string;
  slug: string;
  text: string;
  description: string | null;
  rkey: string;
  createdAt: string;
  uri: string | null;
  cid: string | null;
}

const COLLECTION = "weeknotes";
const LEASE_MS = 5 * 60 * 1000;
const RETRY_BASE_MS = 30 * 1000;
const RETRY_MAX_MS = 6 * 60 * 60 * 1000;
const TID_ALPHABET = "234567abcdefghijklmnopqrstuvwxyz";
const EXPECTED_AUTHOR_DID = "did:plc:jrrhosrfzgjf6v4oydav6ftb";

type SqlRow = Record<string, unknown>;
type JobState =
  | "queued"
  | "leased"
  | "retry"
  | "posted"
  | "completed"
  | "skipped"
  | "cancelled";
type Eligibility = "eligible" | "manual-thread" | "ineligible";

interface ContentRow extends SqlRow {
  id: string;
  slug: string;
  status: string;
  deleted_at: string | null;
  version: number;
  live_revision_id: string | null;
  draft_revision_id: string | null;
  comments: string | null;
  bluesky_announcement: string | null;
  description: string | null;
  live_revision_data: string | null;
  live_revision_author_id: string | null;
}

interface StoredJob extends SqlRow {
  entry_id: string;
  slug: string;
  text: string;
  description: string | null;
  rkey: string;
  created_at: string;
  state: JobState;
  attempts: number;
  next_attempt_at: number;
  lease_until: number | null;
  lease_token: string | null;
  uri: string | null;
  cid: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRecord(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function hasBskyThread(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const record = parseRecord(value);
  // Malformed comments are not safe to replace with a generated thread.
  return record === null || Object.hasOwn(record, "bsky");
}

function commentsRecord(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  const record = parseRecord(value);
  if (record === null)
    throw new Error("Weeknote comments are not a JSON object");
  return record;
}

function contentEligibility(row: ContentRow | undefined): Eligibility {
  if (!row) return "ineligible";
  const liveData = parseRecord(row.live_revision_data);
  if (hasBskyThread(row.comments) || hasBskyThread(liveData?.comments)) {
    return "manual-thread";
  }
  if (
    row.status !== "published" ||
    row.deleted_at !== null ||
    typeof row.bluesky_announcement !== "string" ||
    row.bluesky_announcement.trim().length === 0 ||
    typeof row.live_revision_id !== "string" ||
    liveData === null
  ) {
    return "ineligible";
  }
  return "eligible";
}

function encodeBase32(value: bigint, width: number): string {
  let remaining = value;
  let encoded = "";
  for (let index = 0; index < width; index += 1) {
    encoded = TID_ALPHABET[Number(remaining & 31n)] + encoded;
    remaining >>= 5n;
  }
  return encoded;
}

function makeTid(
  createdAt: string,
  entryId: string,
  clockOffset: number,
): string {
  const timestamp = BigInt(Date.parse(createdAt)) * 1000n;
  const digest = createHash("sha256").update(entryId).digest();
  const initialClock = digest.readUInt16BE(0) & 1023;
  const clock = (initialClock + clockOffset) & 1023;
  return encodeBase32((timestamp << 10n) | BigInt(clock), 13);
}

function jobFromRow(row: StoredJob): AnnouncementJob {
  return {
    entryId: row.entry_id,
    slug: row.slug,
    text: row.text,
    description: row.description,
    rkey: row.rkey,
    createdAt: row.created_at,
    uri: row.uri,
    cid: row.cid,
  };
}

export class AnnouncementStore {
  readonly #db: DatabaseSync;
  readonly #activeClaims = new Map<string, string>();

  constructor(path = databasePath()) {
    if (isReadOnlyReplica()) {
      throw new Error("Bluesky announcement jobs can only run on the primary.");
    }
    this.#db = new DatabaseSync(path);
    this.#db.exec("PRAGMA busy_timeout = 5000");
    this.#db.exec("PRAGMA journal_mode = WAL");
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS bluesky_announcement_jobs (
        entry_id TEXT PRIMARY KEY,
        slug TEXT NOT NULL,
        text TEXT NOT NULL,
        description TEXT,
        rkey TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('queued', 'leased', 'retry', 'posted', 'completed', 'skipped', 'cancelled')),
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL DEFAULT 0,
        lease_until INTEGER,
        lease_token TEXT,
        uri TEXT,
        cid TEXT,
        last_error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_bluesky_announcement_due
        ON bluesky_announcement_jobs (state, next_attempt_at, lease_until, created_at);
    `);
  }

  reconcile(): void {
    this.#transaction(() => {
      const entries = this.#loadContentRows();
      const entriesById = new Map(entries.map((row) => [row.id, row]));
      const jobs = this.#db
        .prepare("SELECT * FROM bluesky_announcement_jobs")
        .all() as StoredJob[];
      const jobsById = new Map(jobs.map((job) => [job.entry_id, job]));

      for (const job of jobs) {
        if (job.state === "completed" || job.state === "skipped") continue;
        const entry = entriesById.get(job.entry_id);
        const eligibility = contentEligibility(entry);
        if (eligibility === "manual-thread") {
          this.#setTerminalState(job.entry_id, "skipped");
          continue;
        }
        if (eligibility !== "eligible") {
          this.#setTerminalState(job.entry_id, "cancelled");
          continue;
        }
        if (job.state === "cancelled") {
          const nextState: JobState = job.uri === null ? "queued" : "posted";
          this.#db
            .prepare(
              `
              UPDATE bluesky_announcement_jobs
              SET slug = CASE WHEN uri IS NULL AND attempts = 0 THEN ? ELSE slug END,
                  text = CASE WHEN uri IS NULL AND attempts = 0 THEN ? ELSE text END,
                  description = CASE WHEN uri IS NULL AND attempts = 0 THEN ? ELSE description END,
                  state = ?,
                  next_attempt_at = 0, lease_until = NULL, lease_token = NULL,
                  last_error = NULL
              WHERE entry_id = ? AND state = 'cancelled'
            `,
            )
            .run(
              entry.slug,
              entry.bluesky_announcement,
              entry.description,
              nextState,
              job.entry_id,
            );
        } else if (job.state === "queued" || job.state === "retry") {
          this.#updateJobContent(job.entry_id, entry);
        }
      }

      for (const entry of entries) {
        if (contentEligibility(entry) !== "eligible" || jobsById.has(entry.id))
          continue;
        this.#insertJob(entry);
      }
    });
  }

  claim(): AnnouncementJob | null {
    const token = randomUUID();
    let claimed: StoredJob | null = null;
    this.#transaction(() => {
      while (true) {
        const now = Date.now();
        const activeEntryIds = [...this.#activeClaims.keys()];
        const exclusions = activeEntryIds.length
          ? `AND entry_id NOT IN (${activeEntryIds.map(() => "?").join(", ")})`
          : "";
        const candidate = this.#db
          .prepare(
            `
            SELECT * FROM bluesky_announcement_jobs
            WHERE ((state IN ('queued', 'retry') AND next_attempt_at <= ?)
               OR (state IN ('leased', 'posted') AND (lease_until IS NULL OR lease_until <= ?)))
              ${exclusions}
            ORDER BY created_at, entry_id
            LIMIT 1
          `,
          )
          .get(now, now, ...activeEntryIds) as StoredJob | undefined;
        if (!candidate) return;

        const entry = this.#loadContentRow(candidate.entry_id);
        const eligibility = contentEligibility(entry);
        if (eligibility === "manual-thread") {
          this.#setTerminalState(candidate.entry_id, "skipped");
          continue;
        }
        if (eligibility !== "eligible" || !entry) {
          this.#setTerminalState(candidate.entry_id, "cancelled");
          continue;
        }

        const shouldRefreshText =
          candidate.uri === null && candidate.attempts === 0;
        const slug = shouldRefreshText ? entry.slug : candidate.slug;
        const text = shouldRefreshText
          ? (entry.bluesky_announcement as string)
          : candidate.text;
        const description = shouldRefreshText
          ? entry.description
          : candidate.description;
        const result = this.#db
          .prepare(
            `
            UPDATE bluesky_announcement_jobs
            SET slug = ?, text = ?, description = ?, state = 'leased',
                attempts = attempts + 1, lease_until = ?, lease_token = ?
            WHERE entry_id = ? AND state = ?
          `,
          )
          .run(
            slug,
            text,
            description,
            now + LEASE_MS,
            token,
            candidate.entry_id,
            candidate.state,
          );
        if (Number(result.changes) === 0) continue;
        claimed = {
          ...candidate,
          slug,
          text,
          description,
          state: "leased",
          attempts: candidate.attempts + 1,
          lease_until: now + LEASE_MS,
          lease_token: token,
        };
        return;
      }
    });

    if (!claimed) return null;
    this.#activeClaims.set(claimed.entry_id, token);
    return jobFromRow(claimed);
  }

  recordPost(entryId: string, uri: string, cid: string): void {
    const claim = this.#claimFor(entryId);
    if (!claim) return;

    const job = this.#db
      .prepare(
        "SELECT state, uri, cid FROM bluesky_announcement_jobs WHERE entry_id = ? AND lease_token = ?",
      )
      .get(entryId, claim.token) as SqlRow | undefined;
    if (!job || (job.state !== "leased" && job.state !== "posted")) return;
    if (job.uri !== null && (job.uri !== uri || job.cid !== cid)) {
      throw new Error(
        "A different Bluesky post is already recorded for this announcement",
      );
    }

    this.#db
      .prepare(
        `
        UPDATE bluesky_announcement_jobs
        SET uri = ?, cid = ?, state = 'posted'
        WHERE entry_id = ? AND lease_token = ? AND state IN ('leased', 'posted')
      `,
      )
      .run(uri, cid, entryId, claim.token);
  }

  complete(entryId: string, did: string, postRkey: string): void {
    if (did !== EXPECTED_AUTHOR_DID)
      throw new Error("Unexpected Bluesky announcement author");
    const claim = this.#claimFor(entryId);
    if (!claim) {
      const state = this.#db
        .prepare(
          "SELECT state FROM bluesky_announcement_jobs WHERE entry_id = ?",
        )
        .get(entryId) as SqlRow | undefined;
      if (state?.state === "completed") return;
      return;
    }

    let attached = false;
    let released = false;
    this.#transaction(() => {
      const job = this.#db
        .prepare(
          "SELECT * FROM bluesky_announcement_jobs WHERE entry_id = ? AND lease_token = ?",
        )
        .get(entryId, claim.token) as StoredJob | undefined;
      if (!job || (job.state !== "leased" && job.state !== "posted")) {
        released = true;
        return;
      }
      if (job.rkey !== postRkey)
        throw new Error("Bluesky post key does not match the announcement job");
      if (job.uri === null || job.cid === null) {
        throw new Error(
          "Bluesky post reference must be recorded before attaching comments",
        );
      }

      const entry = this.#loadContentRow(entryId);
      const eligibility = contentEligibility(entry);
      if (eligibility === "manual-thread") {
        this.#setTerminalState(entryId, "skipped");
        released = true;
        return;
      }
      if (eligibility !== "eligible" || !entry) {
        this.#setTerminalState(entryId, "cancelled");
        released = true;
        return;
      }

      const liveData = parseRecord(entry.live_revision_data);
      if (!liveData || !entry.live_revision_id) {
        throw new Error("Published weeknote is missing its live revision");
      }
      const currentComments = commentsRecord(entry.comments);
      const revisionComments = commentsRecord(liveData.comments);
      const mergedComments = { ...revisionComments, ...currentComments };
      if (Object.hasOwn(mergedComments, "bsky")) {
        this.#setTerminalState(entryId, "skipped");
        released = true;
        return;
      }
      mergedComments.bsky = { did, postCid: postRkey };
      const liveSnapshot = { ...liveData, comments: mergedComments };
      const createdAt = new Date().toISOString();
      const newLiveRevisionId = randomUUID();
      this.#insertRevision(
        newLiveRevisionId,
        entryId,
        liveSnapshot,
        entry.live_revision_author_id,
        createdAt,
      );

      let newDraftRevisionId: string | null = null;
      if (entry.draft_revision_id) {
        const draft = this.#db
          .prepare(
            "SELECT data, author_id FROM revisions WHERE id = ? AND collection = ? AND entry_id = ?",
          )
          .get(entry.draft_revision_id, COLLECTION, entryId) as
          | SqlRow
          | undefined;
        if (!draft) throw new Error("Staged weeknote revision is missing");
        const draftData = parseRecord(draft.data);
        if (!draftData)
          throw new Error("Staged weeknote revision is not a JSON object");
        const draftComments = commentsRecord(draftData.comments);
        if (!Object.hasOwn(draftComments, "bsky")) {
          const draftSnapshot = {
            ...draftData,
            comments: { ...draftComments, bsky: { did, postCid: postRkey } },
          };
          newDraftRevisionId = randomUUID();
          this.#insertRevision(
            newDraftRevisionId,
            entryId,
            draftSnapshot,
            typeof draft.author_id === "string" ? draft.author_id : null,
            createdAt,
          );
        }
      }

      const updatedAt = new Date().toISOString();
      const update = newDraftRevisionId
        ? this.#db
            .prepare(
              `
            UPDATE ec_weeknotes
            SET comments = ?, live_revision_id = ?, draft_revision_id = ?,
                updated_at = ?, version = version + 1
            WHERE id = ? AND version = ? AND live_revision_id = ? AND draft_revision_id IS ?
          `,
            )
            .run(
              JSON.stringify(mergedComments),
              newLiveRevisionId,
              newDraftRevisionId,
              updatedAt,
              entryId,
              entry.version,
              entry.live_revision_id,
              entry.draft_revision_id,
            )
        : this.#db
            .prepare(
              `
            UPDATE ec_weeknotes
            SET comments = ?, live_revision_id = ?, updated_at = ?, version = version + 1
            WHERE id = ? AND version = ? AND live_revision_id = ? AND draft_revision_id IS ?
          `,
            )
            .run(
              JSON.stringify(mergedComments),
              newLiveRevisionId,
              updatedAt,
              entryId,
              entry.version,
              entry.live_revision_id,
              entry.draft_revision_id,
            );
      if (Number(update.changes) !== 1)
        throw new Error("Weeknote changed while attaching the Bluesky thread");

      const completion = this.#db
        .prepare(
          `
          UPDATE bluesky_announcement_jobs
          SET state = 'completed', lease_until = NULL, lease_token = NULL, last_error = NULL
          WHERE entry_id = ? AND lease_token = ? AND state IN ('leased', 'posted')
        `,
        )
        .run(entryId, claim.token);
      if (Number(completion.changes) !== 1)
        throw new Error(
          "Announcement lease was lost while attaching the Bluesky thread",
        );
      attached = true;
      released = true;
    });

    if (released && this.#activeClaims.get(entryId) === claim.token) {
      this.#activeClaims.delete(entryId);
    }
    if (attached) invalidateCollectionCache(COLLECTION);
  }

  fail(entryId: string, _message: string): void {
    const claim = this.#claimFor(entryId);
    if (!claim) return;
    const job = this.#db
      .prepare(
        "SELECT attempts FROM bluesky_announcement_jobs WHERE entry_id = ? AND lease_token = ?",
      )
      .get(entryId, claim.token) as SqlRow | undefined;
    if (!job) {
      if (this.#activeClaims.get(entryId) === claim.token)
        this.#activeClaims.delete(entryId);
      return;
    }
    const attempts = Number(job.attempts) || 1;
    const delay = Math.min(
      RETRY_BASE_MS * 2 ** Math.min(attempts - 1, 10),
      RETRY_MAX_MS,
    );
    const result = this.#db
      .prepare(
        `
        UPDATE bluesky_announcement_jobs
        SET state = 'retry', next_attempt_at = ?, lease_until = NULL,
            lease_token = NULL, last_error = 'Announcement processing failed'
        WHERE entry_id = ? AND lease_token = ? AND state IN ('leased', 'posted')
      `,
      )
      .run(Date.now() + delay, entryId, claim.token);
    if (
      Number(result.changes) === 1 &&
      this.#activeClaims.get(entryId) === claim.token
    ) {
      this.#activeClaims.delete(entryId);
    }
  }

  close(): void {
    this.#activeClaims.clear();
    if (this.#db.isOpen) this.#db.close();
  }

  #loadContentRows(): ContentRow[] {
    return this.#db
      .prepare(
        `
        SELECT e.id, e.slug, e.status, e.deleted_at, e.version,
               e.live_revision_id, e.draft_revision_id, e.comments,
               e.bluesky_announcement, e.description,
               r.data AS live_revision_data, r.author_id AS live_revision_author_id
        FROM ec_weeknotes AS e
        LEFT JOIN revisions AS r
          ON r.id = e.live_revision_id
         AND r.collection = 'weeknotes'
         AND r.entry_id = e.id
      `,
      )
      .all() as ContentRow[];
  }

  #loadContentRow(entryId: string): ContentRow | undefined {
    return this.#db
      .prepare(
        `
        SELECT e.id, e.slug, e.status, e.deleted_at, e.version,
               e.live_revision_id, e.draft_revision_id, e.comments,
               e.bluesky_announcement, e.description,
               r.data AS live_revision_data, r.author_id AS live_revision_author_id
        FROM ec_weeknotes AS e
        LEFT JOIN revisions AS r
          ON r.id = e.live_revision_id
         AND r.collection = 'weeknotes'
         AND r.entry_id = e.id
        WHERE e.id = ?
      `,
      )
      .get(entryId) as ContentRow | undefined;
  }

  #updateJobContent(entryId: string, entry: ContentRow): void {
    this.#db
      .prepare(
        `
        UPDATE bluesky_announcement_jobs
        SET slug = ?, text = ?, description = ?
        WHERE entry_id = ? AND state IN ('queued', 'retry') AND uri IS NULL AND attempts = 0
      `,
      )
      .run(entry.slug, entry.bluesky_announcement, entry.description, entryId);
  }

  #insertJob(entry: ContentRow): void {
    const createdAt = new Date().toISOString();
    let rkey: string | null = null;
    for (let offset = 0; offset < 1024; offset += 1) {
      const candidate = makeTid(createdAt, entry.id, offset);
      const collision = this.#db
        .prepare("SELECT 1 FROM bluesky_announcement_jobs WHERE rkey = ?")
        .get(candidate);
      if (!collision) {
        rkey = candidate;
        break;
      }
    }
    if (!rkey) throw new Error("Could not allocate a Bluesky record key");
    this.#db
      .prepare(
        `
        INSERT INTO bluesky_announcement_jobs
          (entry_id, slug, text, description, rkey, created_at, state)
        VALUES (?, ?, ?, ?, ?, ?, 'queued')
      `,
      )
      .run(
        entry.id,
        entry.slug,
        entry.bluesky_announcement,
        entry.description,
        rkey,
        createdAt,
      );
  }

  #insertRevision(
    id: string,
    entryId: string,
    data: Record<string, unknown>,
    authorId: string | null,
    createdAt: string,
  ): void {
    this.#db
      .prepare(
        `
        INSERT INTO revisions (id, collection, entry_id, data, author_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      )
      .run(id, COLLECTION, entryId, JSON.stringify(data), authorId, createdAt);
  }

  #setTerminalState(entryId: string, state: "skipped" | "cancelled"): void {
    this.#db
      .prepare(
        `
        UPDATE bluesky_announcement_jobs
        SET state = ?, lease_until = NULL, lease_token = NULL
        WHERE entry_id = ? AND state NOT IN ('completed', 'skipped')
      `,
      )
      .run(state, entryId);
  }

  #claimFor(entryId: string): { token: string } | null {
    const token = this.#activeClaims.get(entryId);
    return token ? { token } : null;
  }

  #transaction<T>(operation: () => T): T {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }
}
