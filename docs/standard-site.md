# Standard.site publishing

The `standard-site` EmDash plugin mirrors published **posts and weeknotes** to
`did:plc:jrrhosrfzgjf6v4oydav6ftb`. EmDash remains authoritative. It does not
import PDS edits or replace the website renderer, feeds, or Bluesky
announcements.

## Payload and identity

- One `site.standard.publication` describes `https://ovyerus.com`; each tracked
  article has one `site.standard.document` referencing it.
- Documents contain canonical paths, titles, published/updated dates, optional
  descriptions/tags, and genuine plaintext. Markdown formatting is removed;
  useful link/media URLs remain. Rich portable embeds and Bluesky strongrefs are
  not included in this version. `comments.bsky.postCid` is an rkey, not a CID.
- Only the entry's matching **live revision** supplies article fields. Draft
  bodies, mutable editor fields, and announcement teasers are not serialized. A
  corrupt/missing live revision fails safely instead of falling back to drafts
  or deleting the last valid remote record.
- Immutable CMS IDs map to stored TID record keys. Edits, slug changes,
  unpublish, and republish reuse that key. Deletion keeps a small tombstone for
  identity; creating a different CMS entry creates a different identity.
- Local builders enforce Lexicon field limits and a 900,000-byte record limit.
  Oversized/invalid records fail rather than being silently truncated. PDS
  writes leave `validate` unspecified: validate known schemas, accept unknown
  community Lexicons; local validation and remote readback still apply.

## Runtime gates

Default: **disabled**, including discovery links. Enable only after reviewing
which published content should be mirrored and explicitly authorizing PDS
writes. These are runtime settings, not build-time credentials:

```text
NODE_ENV=production
STANDARD_SITE_ENABLED=true
STANDARD_SITE_BACKFILL=false
STANDARD_SITE_PDS_URL=https://pds.ovy.cloud
STANDARD_SITE_APP_PASSWORD=<secret-manager-only>
```

`STANDARD_SITE_PDS_URL` and `STANDARD_SITE_APP_PASSWORD` may fall back to the
existing `BLUESKY_PDS_URL` and `BLUESKY_APP_PASSWORD`; the two workers' enable
flags remain independent. The password must belong to the fixed DID and permit
custom repository writes. This has not been verified against the live PDS as
part of implementation. Atmosphere admin login does not grant publishing access.

Outgoing work requires a writable production primary. Read-only replicas never
open the writer ledger or authenticate to the PDS. On Fly, `FLY_MACHINE_ID` must
match `PRIMARY_MACHINE_ID`; the PDS URL must be an HTTPS origin without embedded
credentials, paths, query strings, or fragments. Development cannot publish.

Activation registers `sync-standard-site` (`* * * * *`) even while disabled, so
enabling the flag after restarting does not require reinstalling the plugin.
Content hooks only enqueue/reconcile local state, never perform network calls.
The worker processes **one record per minute**, publication first. A roughly
120-article backfill therefore takes about two hours, plus retries. The client
reuses its lazy authenticated session between ticks; a 401 clears it for retry.

## Controlled backfill and normal operation

With `STANDARD_SITE_BACKFILL=false`, publish/save hooks can enroll published
entries, and each tick reconciles previously tracked entries. Existing archive
entries are **not automatically enrolled** just by enabling the worker.

Set `STANDARD_SITE_BACKFILL=true` explicitly to enroll all current published
posts/weeknotes, including archive entries and anything missed by hooks while
this worker was disabled. Return it to `false` after enrollment if desired:
already tracked entries continue to synchronize. This is independent of teaser
fields and never enqueues additional Bluesky announcements.

Periodic reconciliation recovers missed edits, unpublishes, and deletions of
tracked entries. An untracked publish whose hook is lost requires backfill to
enroll it. No change history or article bodies are copied into the ledger; it is
capped at 5,000 documents, including retained tombstones. Reconciliation reads
bounded metadata; only the claimed article body is loaded for a write.

## Retry, concurrency, and deletion safety

`standard_site_records` lives inside the CMS SQLite database, so it replicates
with LiteFS and is covered by the existing database backup. It stores desired
and acknowledged versions, CIDs, verified paths, leases, pending write intents,
and bounded retry/error state. It never updates CMS content or revisions.

- A durable two-minute lease protects each job; the cron hook has a 90-second
  timeout. No SQLite transaction remains open across network I/O.
- PDS calls have 15-second deadlines, bounded bodies/responses, no redirects,
  and fixed account/address checks. Credentials and arbitrary PDS errors are not
  logged.
- Before a PUT, its canonical payload fingerprint is persisted. A committed PUT
  with a lost response can be adopted on retry, including after an intervening
  edit or unpublish, without producing duplicate records or orphaning content.
- Creation asserts absence with `swapRecord: null`; edits and deletions use CID
  compare-and-swap. Unknown/manual PDS changes cause `StandardSiteConflict`
  rather than being overwritten or deleted. Only ledger-owned keys are touched;
  there is no repository-wide enumeration or deletion.
- Acknowledgement requires remote readback. Retry delays grow from one minute to
  six hours; there is no unbounded error history. EmDash scheduler locks can
  also delay recovery after a crash.

Unpublish, trash, or permanently delete a tracked article to remove its remote
record on a later tick. Source changes during an in-flight request are
**eventually**, not atomically, reflected remotely. Keep the worker enabled
until deletions are confirmed. Setting `STANDARD_SITE_ENABLED=false` pauses work
and hides discovery links; **it does not remove already-public PDS records**.
Neither deletion nor disabling can erase copies already taken by external
readers.

## Verification and monitoring

Once the publication has a confirmed CID,
`/.well-known/site.standard.publication` returns its AT-URI as plain text with
`Cache-Control: no-store`; until then it returns 404. Published article pages
emit `<link rel="site.standard.document" href="at://…">` only when their current
canonical path matches an acknowledged remote path. Read-only replicas serve
these hints from replicated state, with no network/authentication or DB
creation.

Inspect `standard_site_records` through a **read-only** SQLite connection to the
serving `/litefs/emdash.db` (never the LiteFS backing files). Useful columns:
`collection`, `entry_id`, `desired_hash`, `synced_hash`, `cid`, `verified_path`,
`attempts`, `next_attempt_at`, `intent_hash`, and `last_error`.
`next_attempt_at` is Unix milliseconds; error state is a redacted class name.
The EmDash cron task must remain enabled and advancing. A queued version differs
from its acknowledged version, or still has a pending intent. Logs report failed
sync ticks; no external alerting is added here.

Do not delete/reset the ledger to clear a conflict: that discards ownership and
stable identity. After restoring an older database backup, keep publishing
paused until the restored ledger and current PDS records have been reviewed; CID
conflicts are intentional protection, not permission to force an overwrite.

For Fly activation follow [the deployment runbook](fly-deployment.md), including
staged secret synchronization and exact-primary-first rollout. Do not enable a
live archive backfill merely to test the implementation.
