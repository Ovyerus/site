# Fly deployment: fixed Sydney writer, LiteFS replicas, split B2 storage

Routine deployments run automatically on pushes to `main`, with manual GitHub
Actions dispatch also available on `main`. The initial migration and commands
below require explicit operator review; do not run them blindly against
production. Keep a three-Machine regional topology. There is exactly one writer,
selected by **Machine ID**, not by region.

## Layout and invariants

- Every Machine needs its own persistent `data` volume mounted at `/data`.
  Volumes are regional and are not shared. Budget for volumes independently of
  any grandfathered compute allowance.
- LiteFS stores its internal files in `/data/litefs` and mounts the application
  database at `/litefs/emdash.db`. Never open/copy/edit its internal database
  files directly. Both EmDash and the announcement worker use the mounted file.
- LiteFS listens privately on port 20202. Only its HTTP proxy on 8080 is a Fly
  service; Node listens on loopback port 8081. Do not expose 20202 publicly.
- Astro must trust Fly's forwarded HTTPS scheme for `ovyerus.com`; the shared
  `proxySecurity` configuration pins that hostname and HTTPS protocol. Without
  it, OAuth metadata incorrectly advertises HTTP behind TLS termination. Test
  the real HTTPS metadata URL (or real HTTP Host plus forwarded scheme through a
  private proxy), not a localhost-origin request.
- `PRIMARY_MACHINE_ID` names the sole writable Sydney Machine. Static leases do
  **not** elect a replacement. Never configure two writable candidates.
- Admin/API/authentication, previews, session-bearing requests, and every
  non-GET/HEAD request go to the primary using `fly-replay`. In particular, the
  Atmosphere GET callback is not a read-only request. Public anonymous pages,
  feeds, and OG images read the regional replica.
- Media uploads use public `ovy-cdn/blog/` behind existing Bunny CDN, not a
  local directory. Backups and transfer staging use a separate private B2
  bucket. Never route those private prefixes to the public media bucket.
  Same-origin media proxy URLs remain supported and replay through the primary.
- Only the primary runs migrations, seed bootstrap, scheduled publishing,
  maintenance, and Bluesky announcements. Replicas enforce SQLite read-only
  connections and suppress EmDash's incidental runtime writes.
- Keep autostop **off** and autostart **disabled**. Avoid blue/green deployment,
  cloning the writer, or creating an extra Sydney candidate. Keep the writer's
  Machine identity stable; do not casually destroy/recreate it.
- Replication is asynchronous. A publish does not wait for every region. The
  LiteFS proxy tracks a writing browser's transaction position for subsequent
  reads; other visitors may briefly see the previous publication. Checks drain
  replicas with more than 10 seconds of lag or no current primary connection.
  This deliberately prefers freshness over stale reads during an outage.
- Replication is **not a backup**. A deletion can replicate just as efficiently
  as a publication. Fly currently treats LiteFS as self-managed/outside its
  support scope.

## Provisioning checkpoint (2026-10-25)

**Public cutover completed.** Sydney is the sole writer; Virginia and Frankfurt
serve read-only regional content. All three run the same immutable image on
shared CPU / **512 MB RAM** (explicitly approved, with higher compute costs).
The old stateless Machines are **cordoned and stopped**, retained for rollback;
no Machine or volume was destroyed. Recheck live inventory before acting.
Autostart on the replacements is disabled and autostop is off.

The production database is no longer pristine: it contains content through
**2026-w42**, the sole prelinked owner DID, and a completed setup flag. Preserve
its encryption key and volumes. Do not reseed, regenerate the key, or export the
local w43 placeholder. `EMDASH_BOOTSTRAP=false` is deployed on all three;
`BLUESKY_ANNOUNCE_ENABLED=false` remains intentional.

| Region            | Original (retained) | Replacement target         | Attached 1 GiB `data` volume |
| ----------------- | ------------------- | -------------------------- | ---------------------------- |
| Sydney (`syd`)    | `78432d5f466938`    | `7847575f5093e8` — writer  | `vol_vp2nw1w5x60633y4`       |
| Virginia (`iad`)  | `48e254dc794d08`    | `28744397c16178` — replica | `vol_40o3ezepn5egppk4`       |
| Frankfurt (`fra`) | `4d89704c2d7768`    | `8576906a40e138` — replica | `vol_4585jmjzomgoyl94`       |

The 256 MB guests had only about 207 MiB usable RAM and stalled under measured
memory/page pressure, even after removing two idle Node startup wrappers. At 512
MB, the private primary had about 263 MiB available and zero measured memory
pressure; cold OG rendering took about 0.56 seconds instead of timing out. These
are smoke measurements, not a load test.

Volumes are encrypted with Fly's default automatic snapshots and five-day
retention; these do not replace tested application backups. All nine required
runtime/credential secrets were staged without exposing values. Live checks
confirmed the private bucket's owner-only ACL and reciprocal cross-bucket
listing denial. Unique fixtures verified signed public upload/anonymous reads
and private write/read/anonymous denial; both fixtures were deleted. An additive
Native B2 CORS rule enables only the canonical origin's S3 PUTs; both original
download rules and public bucket visibility were preserved. The private bucket
and Bunny configuration were not changed.

The initial Sydney boot was isolated with zero public services. Minimal-image
requirements include `/tmp` (mode 1777), a root NSS entry, `/bin/sh`, and `/etc`
existing before Fly injects its DNS configuration. Include `cacert` and set
`SSL_CERT_FILE`/`NODE_EXTRA_CA_CERTS` to its bundle; otherwise server-side B2
and OAuth HTTPS calls cannot validate issuers in the minimal root filesystem.
Startup uses process replacement rather than retaining two idle Node supervisors
(about 22 MiB combined); the primary preparation CLI remains a short-lived
child. Full rootless-Podman OCI boots with real FUSE exercised fresh seed,
health, pages, feeds, OG images, and canonical HTTPS OAuth metadata; these do
not model Fly's guest/kernel overhead. The final image also passed a real
external B2 TLS check without disabling certificate verification.

Live checks passed for both bucket-restricted credential pairs (own-bucket
listing 200, cross-bucket 403). A unique private transfer fixture was readable
with its signed B2 request but returned 404 through the anonymous EmDash media
handler; the fixture was deleted. Public HTTPS checks forced to each Machine
passed, including writer replay from both replicas. All four first-admin setup
endpoints reject registration. The owner confirmed successful interactive
Atmosphere sign-in and that their posts are present.

The GitHub workflow's repository variables are set and verified:
`FLY_PRIMARY_MACHINE_ID=7847575f5093e8` and
`FLY_REPLICA_MACHINE_IDS=28744397c16178,8576906a40e138`. On 2026-10-26 the
published `main` workflow was verified byte-for-byte against the safe local
definition and was active. Pushes to `main` build, test and deploy
automatically; manual dispatch on `main` remains available. It targets only the
three volume-backed Machines, primary first. Do not restore the old unqualified
app-wide deployment or include retained rollback Machines.

One production concurrency group covers build, image publication, and both
rollout stages. An active run finishes rather than being cancelled between the
writer and replicas; rapid pushes can replace an older pending run with the
latest one. If the primary deployment fails, replicas are not updated.

The first encrypted full database backup was uploaded to private B2 and restored
on an independent workstation on 2026-10-26. The restored bytes matched the
export's SHA-256; SQLite integrity/foreign-key checks passed (75 tables, one
user). The isolated packaged app then served the home page, weeknote and RSS
using that read-only restored database without production storage credentials;
admin requests deliberately return writer-replay responses and were not an
isolated login test. Its database bytes remained unchanged. Plaintext scratch
and the local server were removed afterward. This also verified the existing
separately stored production encryption key. Daily scheduling and 30-day
retention are described below; Fly snapshots are not the backup policy.

The scheduler image was then rolled out primary-first to exactly the three 512
MB volume-backed Machines, leaving the stopped originals unchanged. The serving
process's five-minute timer produced another remotely verified backup at
`2026-10-26T02:56:47Z` (193,817 encrypted bytes); no manual backup command
triggered that run. Its stored manifest authenticated successfully, temporary
scratch was removed, and no backup/retention failure events appeared. Both
replicas retained read-only mode. Health, home, weeknote, RSS and sitemap checks
passed after deployment. The backup feature's source remains local in change
`uvqxmxyo`: publish it before another main deployment, otherwise the older
published source can remove the manually deployed scheduler.

Initial deployment image (before backup scheduling):
`registry.fly.io/site-polished-fog-5586@sha256:9a72c9e49c0a03b06e6afc21ac80dfecbfaaee2bb35664f88b37c9fe31fba4e7`.
That initial rollout passed 98 unit/regression tests in 12 files. Query current
Machine configuration rather than treating this historical image as latest.

## Before the first rollout

1. Inspect `fly machine list` and `fly volumes list`. Record all three Machine
   IDs, regions, and attached volume IDs. Back up any existing state first.
2. Each target Machine needs a distinct `data` volume mounted at `/data` in its
   own region. **Fly does not let you attach a volume to an existing stateless
   Machine by updating its configuration.** If the current Machines have no
   volumes, create volume-backed replacements in the same regions using Fly's
   documented volume/clone procedure. Those replacements have **new IDs**.
   Verify each replacement before retiring the corresponding old Machine;
   temporary additional Machines/volumes may cost money. Do not deploy this
   runtime to old stateless Machines or destroy an authoritative content volume.
   Choose the final volume-backed Sydney ID as `PRIMARY_MACHINE_ID` only after
   this topology is established. The repository does not perform this migration
   or infer the IDs for you. See
   [Fly's volume guide](https://fly.io/docs/volumes/volume-manage/).
3. `fly.toml` supplies the non-secret media settings: endpoint
   `https://s3.us-west-004.backblazeb2.com`, region `us-west-004`, public bucket
   `ovy-cdn`, and the existing Bunny bucket-root origin `https://cdn.ovy.cloud`.
   **Leave that bucket and Bunny configuration unchanged.** New media lives
   under `ovy-cdn/blog/<stable-generated-key>`; public URL resolution appends
   `/blog/<key>` to the configured `S3_PUBLIC_URL` origin.
   Admin/backward-compatible `/_emdash/api/media/file/...` URLs continue to
   work. Every media upload is public, including draft/unpublished attachments;
   publishing is not an ACL.

   The **separate private B2 bucket** is `ovy-site-priv`, in the same
   `us-west-004` region, configured as `PRIVATE_S3_BUCKET` in `fly.toml`. Keep
   it private and do not connect it to Bunny. Its objects live under
   `blog/backups/` and `blog/transfers/`. The adapter routes logical `backups/`
   and `transfers/` keys there for upload, download, existence checks, listing,
   and deletion. Private failures never retry against the media bucket; private
   objects have no public/CDN URL or browser-upload URL. Root listings paginate
   media first, then private objects, with opaque cursors bound to the requested
   prefix; specific backup/staging listings touch only private storage.

   Create two bucket-restricted application keys (not the master account key),
   one per bucket, restricted to `blog/` where supported. Each needs read,
   write, list, and delete capabilities for its own bucket only. The private
   backup key also needs B2 `readBuckets` for the owner-only ACL preflight;
   version listing uses `listFiles`, and permanent version deletion uses
   `deleteFiles`. Set the media key as `S3_ACCESS_KEY_ID` /
   `S3_SECRET_ACCESS_KEY`; set the private key as `PRIVATE_S3_ACCESS_KEY_ID` /
   `PRIVATE_S3_SECRET_ACCESS_KEY`. Private credentials are mandatory and never
   inherit the public key. Optional `PRIVATE_S3_ENDPOINT` and
   `PRIVATE_S3_REGION` default to the media endpoint/region if omitted; set both
   explicitly if the private bucket is elsewhere. Never set
   `PRIVATE_S3_PUBLIC_URL`. Verify the new bucket is actually private in B2:
   constructor validation cannot establish its remote ACL.

   This is a new split, not an automatic migration. Do not deploy over an older
   CMS installation that stored private files in the public bucket without
   separately moving/removing those objects and reviewing CDN caches. None have
   been uploaded by this rollout. Keep both physical `blog/` namespaces stable
   after deployment; changing them requires a deliberate data migration.

   EmDash's stock shared-library uploads do not carry a post slug, so new media
   currently uses `blog/<stable-generated-key>` rather than per-post folders. A
   later slug change or media reuse never moves an existing object. Existing
   manually organised `blog/<slug>/...` assets and article URLs stay untouched.

4. Allow browser uploads in the **public media bucket's** CORS configuration:
   allow origin `https://ovyerus.com`, S3 PUT requests and their
   `Content-Type`/`x-amz-*` headers, and expose `ETag`. Preserve existing CORS
   rules used by other clients; add this access rather than replacing them. If
   previewing uploads from another production origin, explicitly allow that
   origin too. No CORS or CDN configuration is needed for the server-only
   private bucket. `S3_PUBLIC_URL` is the existing media bucket-root HTTPS
   origin, without `/blog` or a query string; leave it unset only if
   deliberately using the same-origin media proxy instead of Bunny.

5. Generate a fresh production EmDash encryption key with
   `pnpm exec emdash secrets generate`. Store the key securely, separately from
   backups. If restoring an existing database instead, retain its encryption
   key; generating a replacement would make stored encrypted secrets unreadable.
6. Prepare a private environment file outside version control (permissions
   `0600`), containing:

   ```dotenv
   PRIMARY_MACHINE_ID=the_actual_sydney_machine_id
   EMDASH_SITE_URL=https://ovyerus.com
   EMDASH_ENCRYPTION_KEY=the_generated_production_key
   S3_ACCESS_KEY_ID=the_bucket_application_key_id
   S3_SECRET_ACCESS_KEY=the_bucket_application_key
   PRIVATE_S3_ACCESS_KEY_ID=the_private_bucket_application_key_id
   PRIVATE_S3_SECRET_ACCESS_KEY=the_private_bucket_application_key
   BLUESKY_ANNOUNCE_ENABLED=false
   EMDASH_BOOTSTRAP=true
   ```

   Stage these for the next approved deployment without printing them in chat or
   storing them in a shell history:

   ```sh
   fly secrets import --stage < /secure/path/site-production.env
   ```

   The container determines `EMDASH_READ_ONLY` itself from the Machine ID. Do
   not override it manually. Storage, database, session paths, and the serving
   migration policy are set by the startup script.

## Seed and deploy once

The initial content is the committed `seed/seed.json`: posts, weeknotes, pages,
and homepage settings. Review/regenerate it with `pnpm cms:import` locally if
needed. This command operates on your development database; it is **not** a
production synchronization command. Preserve CMS-only local edits separately
with EmDash's export/import tools if they are not represented in the archive. Do
not ship a development database with development users/sessions as a fresh
production seed.

Build/push the reviewed container image using the repository's Nix/GHCR flow.
For a **fresh first rollout**, keep the primary completely nonpublic until owner
setup is closed. The DID allowlist does not protect EmDash's separate
first-admin passkey endpoints when there are no users; setting only
`emdash:setup_complete` is insufficient. Do not use the workflow for this
initial topology/bootstrap operation.

On a stopped target, install the reviewed image/configuration with an explicit
Machine configuration containing `"services": []` and `--skip-start`. Verify the
actual Machine configuration has zero services before starting it. **Omitting
`[http_service]` from a deployment TOML does not reliably remove an existing
Machine's services.** Keep the image, environment, primary ID and volume
identical to the eventual public configuration. Reach this private Machine
through its exact-instance Fly proxy/SSH connection, not public DNS.

After bootstrap, deliberately provision the sole allowed owner and close setup
while still isolated. EmDash has no noninteractive owner-provisioning CLI. The
initial rollout uses a reviewed, one-off SQLite transaction through the mounted
`/litefs/emdash.db`: create one enabled role-50 user, link its exact atproto DID
in `oauth_accounts`, and set the JSON boolean setup flag. Never import a dev
user, passkey, session or OAuth token, elevate an unexpected existing user, or
edit LiteFS's backing files. Check the actual LiteFS mount and primary identity,
use `BEGIN IMMEDIATE`, and refuse unexpected identity state. Read back the sole
owner/link, setup flag, and zero credential/token rows before any exposure.
Verify setup/admin registration endpoints now refuse anonymous registration.
This low-level provisioning is not an OAuth login: the owner must still sign in
normally with Atmosphere. A supported alternative is interactive setup/OAuth
with all setup endpoints externally fenced until completed.

Only then expose the primary with the normal service configuration. Keep fresh
replicas nonpublic until replication confirms the same closed owner/setup state.
Use the **same immutable image digest** throughout, replacing the placeholders
below:

```sh
fly deploy --image ghcr.io/ovyerus/site@sha256:IMAGE_DIGEST \
  --only-machines SYDNEY_MACHINE_ID --strategy rolling --update-only --ha=false
# Primary is already privately bootstrapped and owner setup closed.
# Verify its health/content before proceeding; privately verify each replica's
# replicated owner/setup state before enabling that replica's public service.
fly deploy --image ghcr.io/ovyerus/site@sha256:IMAGE_DIGEST \
  --only-machines REPLICA_ONE_ID,REPLICA_TWO_ID --strategy rolling --update-only --ha=false
```

These commands target the already volume-backed Machines, not the old stateless
ones. Verify Fly's plan before proceeding: `--update-only` alone is not a
general guarantee that no Machines will be created; the explicit target IDs,
rolling strategy, existing topology, and disabled HA creation matter. There is
no `release_command`: those temporary Machines do not have the application's
volumes.

After LiteFS mounts, the primary applies EmDash migrations using the generated
manifest and an explicit target fingerprint. With `EMDASH_BOOTSTRAP=true`, it
seeds **only if there are no application collections yet**, using conflict
policy `skip`. It then applies the two custom migrations before starting Node.
Existing/partial application schemas are never silently reseeded. Without the
explicit flag, an empty database refuses to start rather than letting a public
request bootstrap it. Replicas never run these operations.

Once all three are healthy, stage `EMDASH_BOOTSTRAP=false` and apply it through
controlled primary-first, exact-target updates. Do not casually use
`fly secrets unset EMDASH_BOOTSTRAP`: that can restart **every** app Machine,
including retained originals. Leaving the flag true cannot replay the archive
over existing collections, but disabling it keeps future mistakes obvious. Sign
in at `https://ovyerus.com/_emdash/admin/` with Atmosphere. The canonical HTTPS
site URL must be reachable by the PDS for OAuth metadata discovery.

If importing an **existing production database** instead of a fresh seed, use
LiteFS's documented import on the primary while application writes are stopped,
then run preparation/migrations. Import **replaces** the target database. Never
copy a live `.db` without its WAL or overwrite a running mount with `cp`. Move
existing CMS media objects to B2 preserving keys, or use EmDash's export/import
workflow. Do not turn on bootstrap as a substitute for restoring private edits.

## Verify before enabling announcements

- Both `/healthz` (runtime, seeded/custom schema, replica attachment) and
  `/litefs/health` (replication lag) must pass on **each** Machine. A static
  `/health.json` response is not a database readiness check.
- Open admin, sign in, upload a harmless image, and publish a test edit. Check
  the page, lists, RSS, sitemap, and OG image through each Machine/region. Use
  Fly's instance selection/replay tools, not only the public hostname, which
  might keep returning the same healthy region.
- Check browser console/network for a successful signed B2 PUT and media
  retrieval. Verify `backups/` and `transfers/` cannot be fetched through the
  public media endpoint. Never test by making the bucket public.
- Confirm only Sydney logs scheduler/announcement activity. A replica must not
  emit read-only/SQLite write errors; those are bugs, not expected noise.
- Confirm the Atmosphere callback and session-bearing public pages replay to
  Sydney. Sessions live in `/data/sessions` **only on the primary**, outside the
  immutable Nix store. Losing/promoting a primary requires signing in again.
- Finally set the documented Bluesky credentials/gates if desired. Keep
  announcements disabled during import/validation. A teaser on an already
  published entry is eligible for an announcement when the worker is enabled.

## Later deployments, backups, and manual failover

Routine code deployments migrate the primary before Node serves requests; they
never reseed it. Roll out primary first, then replicas with the same image. Use
a maintenance window for incompatible schema changes: old replica binaries may
briefly read the newly migrated database. A code rollback is not a database
rollback.

After initial verification, configure the GitHub workflow's repository
variables: `FLY_PRIMARY_MACHINE_ID` must match the runtime primary ID, and
`FLY_REPLICA_MACHINE_IDS` must be the two distinct volume-backed replica IDs,
comma-separated without spaces. It refuses missing/duplicate IDs, targets only
those three Machines, deploys primary first, and reuses one image digest. Do not
include old stateless Machines awaiting retirement. Incompatible schema changes
still need a maintenance window, not an automatic rollback.

### Daily database backups

`EMDASH_BACKUPS_ENABLED=true` in `fly.toml` enables a tiny Node preload on the
fixed writer only. It registers unreferenced timers, not a second daemon: first
check five minutes after startup, then hourly. A verified backup is due after 24
hours; failures retry at the next hourly check. This is best-effort daily
scheduling, not a precise UTC cron or a guarantee while the writer is stopped.
Replicas never schedule backups. Enabling backups must not block web startup.

`scripts/backup-database.mjs` exports the full live database through the private
loopback LiteFS API (`GET http://127.0.0.1:20202/export?name=emdash.db`), not by
copying the FUSE or backing files. It checks SQLite integrity and foreign keys,
compresses/encrypts the snapshot, and uploads to **private**
`ovy-site-priv/blog/backups/sqlite/v1/`. Auth/users/OAuth data, plugin config,
content and media metadata are included: this is not EmDash's content-only JSON
export. Files in `/data/sessions` are not included; restored users sign in
again.

Each archive uses a unique salt and nonce with AES-256-GCM and a
context-separated HKDF-SHA256 key derived from the **existing**
`EMDASH_ENCRYPTION_KEY`. The entire header and exact physical object key are
authenticated. The manifest records plaintext/encrypted SHA-256 and sizes,
creation time and database identity, with a separately derived HMAC. The archive
is downloaded, authenticated, decrypted and SQLite-checked before its manifest
is committed; the manifest is then read back before `/data/backups/state.json`
records success. Plaintext is never uploaded. Do not rotate or lose the
production encryption key: B2 objects alone cannot recover the database. Keep
its existing separate, user-controlled escrow outside both the repository and
this bucket; do not print it into logs/chat.

Retention runs only after a successful commit and freshly verifies the keeper
again before deleting anything. It preserves that backup and recent archives;
only correctly named, authenticated pairs older than **30 days** are eligible.
Malformed/foreign objects and ambiguous manifest-read failures are preserved.
Old uncommitted archive orphans require an explicit `NoSuchKey`/404 for their
manifest and a 30-day grace period. B2 version IDs are deleted explicitly:
ordinary S3 DELETE would only hide an object and leave its stored versions. The
marker is deleted last; uncertain orphan markers remain for inspection. No
bucket-wide lifecycle rule is changed.

A separate `/data/backups/coordination.sqlite` transaction serializes manual and
scheduled jobs and releases its OS lock on process death; this is **not** the
application database. Scratch files/directories are 0600/0700 and normally
removed immediately. Aged, narrowly named interrupted scratch/state temp files
are scavenged under that lock. Snapshots are capped at 128 MiB, archives at 132
MiB, and the job requires 692 MiB of free scratch space (worst-case copies plus
reserve). Storage requests and pagination are bounded, with a 20-minute S3
operation budget. An overfull namespace fails closed at 510 objects rather than
accumulating unlimited failed uploads; investigate the emitted error,
permissions/capacity and orphan data rather than broad-deleting prefixes.

For an on-demand backup, run the packaged script **on the current fixed
writer**:

```sh
node /nix/store/<current-site-package>/scripts/backup-database.mjs
```

Use the current serving process's site package, not a historical store path. The
command refuses replicas/non-FUSE environments and shares the same lock. Check
`/data/backups/state.json` for `lastVerifiedAt` and the committed object key.
Logs emit `backup-verified`, `backup-failed`, `backup-retention-failed` and
`backup-orphan-cleanup-failed`; SDK request/credential objects are never logged.
A success marker means the archive was remotely restored, not that retention
necessarily succeeded. There is no external alert delivery configured: monitor
these events and alert if `lastVerifiedAt` is older than 48 hours. Backup
failure must not take the CMS health checks offline.

### Isolated recovery and media

Download an archive and its adjacent `.json` manifest using private B2 access,
and use the retained v1 script with the original key: `validManifest`,
`decryptFile`, `fileDigest` and `inspectDatabase` verify it in a fresh **private
scratch directory**. Authenticate GCM fully before decompressing or opening
SQLite. Match both checksums/sizes and run integrity/foreign-key checks. Never
point a restore at `/litefs`, `/data/litefs`, the working database or an
existing file. Test the restored app with read-only mode, migration checking,
bootstrap and announcements disabled, isolated sessions and no production
credentials. A real production restore is a separate maintenance operation:
fence the old writer, preserve survivors, restore/import through LiteFS's
documented workflow into a fresh isolated volume, then verify before
exposing/promoting it. Never repair a live LiteFS backing database by copying
files into it.

The v1 archive layout is `OVYDB01\n` (8 bytes), 32-byte salt, 12-byte nonce,
gzip ciphertext, then 16-byte GCM tag. HKDF info is
`ovyerus/emdash.db/backup/v1/archive`; AAD is the full 52-byte header followed
by the UTF-8 physical object key. Manifest HMAC uses the same master key with
empty HKDF salt and info `ovyerus/emdash.db/backup/v1/manifest`, over JSON
fields in creation order, excluding `mac`. Keep this format/context stable; use
a new version/prefix for incompatible changes.

**Media binaries are not inside SQLite.** Read-only B2 checks on 2026-10-26
confirmed both buckets have versioning enabled and no lifecycle expiration
configuration. All 11 current public `blog/` objects (5,008,155 bytes) were read
in full, checked against response lengths and applicable MD5 ETags, and SHA-256
inventoried with their current version IDs in the private verification receipts.
A disposable public fixture was overwritten and hidden, then its original
version was retrieved with `VersionId` and byte-verified. All three fixture
versions/markers were explicitly purged. A separate private fixture also
verified the backup client's exact-key physical version purge. No existing media
object or lifecycle rule was changed. Existing media stays in `ovy-cdn`, with
its visibility, objects and Bunny config unchanged. To recover an
overwritten/hidden asset, inspect that exact physical key's B2 versions, GET the
chosen `VersionId`, verify its bytes/metadata, and only with explicit restore
authorization PUT it back to the original key. Preserve content type and stable
URLs, then check Bunny cache/range delivery as needed. This is existing
same-bucket version recovery, **not a new independent media copy**: permanent
version/bucket deletion or account loss can still destroy assets. References to
external providers are not backed up by this job. Do not change the public
bucket's lifecycle or copy an entire bucket implicitly.

If the primary fails, writes/admin/announcements stop. Replicas can be drained
by freshness checks; do not assume the public site remains available. Before
promoting a replacement:

1. **Fence/stop the old writer first**, including preventing it from restarting.
2. Inspect replica transaction positions and choose the freshest intact copy.
   Asynchronous replication can lose writes that never reached a survivor.
3. Preserve backups of the old and surviving volumes. Never promote an empty
   volume, and never use bootstrap to hide a lost database.
4. Stage the replacement's Machine ID as `PRIMARY_MACHINE_ID`, update the GitHub
   `FLY_PRIMARY_MACHINE_ID` and `FLY_REPLICA_MACHINE_IDS` repository variables
   to match the new three-Machine topology, then restart the new primary with
   its existing volume. Restart the remaining replicas with the new ID. Keep the
   old writer fenced until it is deliberately reintroduced as a replica/reseeded
   from the authoritative database.
5. Verify health/content/auth again before enabling writing/announcements.

Changing a region label does not perform failover. Do not run two static
primaries even briefly. Treat replacing a lost Machine ID as this same
procedure, not a normal deploy.

## Local verification

Local development defaults remain local SQLite, uploads, and sessions. The
maintained `patches/emdash@1.2.0.patch` adds an opt-in read-only role and
runtime SQLite URL resolution to the exact pinned EmDash version. Re-audit and
update the patch/tests before upgrading EmDash; remove it if equivalent support
lands upstream. It updates shipped runtime code and source, not generated
sourcemaps.

```sh
pnpm install --frozen-lockfile
pnpm test --run --exclude '.direnv/**'
pnpm build
node scripts/test-replica.mjs
# Same packaged server with split-S3 configuration and isolated fake endpoints:
node scripts/test-replica.mjs --split-s3
# Real two-node WAL replication test; needs Linux /dev/fuse and LiteFS on PATH:
node scripts/test-litefs.mjs /path/to/litefs
nix build .#container
```

The built-server smoke test uses only temporary databases, disables outgoing
announcements, and waits beyond a maintenance heartbeat while asserting the
replica database/WAL is unchanged. `--split-s3` uses explicit fixture
credentials and loopback endpoints, never real buckets; add a package root
before the flag to test a Nix-built site. It does not verify real Fly routing,
B2 credentials/CORS, production OAuth, backups, or disaster recovery. Validate
those on nonproduction Fly Machines before the approved rollout.

References: [LiteFS configuration](https://fly.io/docs/litefs/config/),
[proxy](https://fly.io/docs/litefs/proxy/),
[import](https://fly.io/docs/litefs/import/),
[backups](https://fly.io/docs/litefs/backup/),
[B2 S3 API](https://www.backblaze.com/docs/cloud-storage-s3-compatible-api).
