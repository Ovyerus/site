# site

Source code for my personal website, [ovyerus.com](https://ovyerus.com)

## Development

Use Node.js 24 or newer and pnpm 12.9.0. The Nix shell provides both plus the
native libraries used by the build:

```sh
nix develop
pnpm install --frozen-lockfile
pnpm cms:import
pnpm exec emdash secrets generate --write .env
chmod 600 .env data/emdash.db
pnpm dev --host 127.0.0.1
```

Open <http://127.0.0.1:4321/> to review the site and
<http://127.0.0.1:4321/_emdash/admin/> to edit it. Complete the setup wizard and
register your own passkey or sign in with Atmosphere. The seed contains the
original site content rather than demo posts. Keep the development server bound
to loopback: EmDash's development-only authentication bypass is not suitable for
a publicly accessible server.

EmDash owns published content at request time:

- **Posts:** title, description, Markdown body, tags, original written/modified
  dates, and optional Bluesky thread metadata. The tag picker starts with the
  archive's existing tags; add new choices in **Content Types → Posts → Tags**.
- **Weeknotes:** Markdown body, subtitle, description, Bluesky thread metadata,
  and an optional Bluesky announcement teaser. Set both **ISO week** (the admin
  title) and the slug to the same real ISO week, e.g. `2026-w43`. Titles are
  checked on save; publishing and scheduling reject malformed slugs, nonexistent
  week 53, and mismatched titles. Public titles and dates still derive from the
  ISO week.
- **Pages:** About and Uses, plus new pages at `/{slug}`. Avoid reserved routes
  such as `posts`, `weeknotes`, `og`, and `_emdash`.
- **Homepage:** tagline, contact email, title metadata, and homepage social
  URLs. Layout, wordmark artwork, navigation, and article-footer links remain
  code.

Save keeps edits in a private draft. **Publish changes** makes them visible on
the public page, feeds, and generated social images without rebuilding. Markdown
bodies use the site's existing heading, figure-caption, and Shiki rendering. The
admin uses system fonts so Nix builds need no external font downloads.

`data/emdash.db`, `data/uploads/`, and `.env` are private, ignored local state.
Back up the database, uploads, and encryption key together. The original files
under `src/content/` are import archives, not a second live content source.
`pnpm cms:import` creates `data/` if needed, regenerates `seed/seed.json`, and
initializes or migrates `data/emdash.db` before importing missing entries. Its
`skip` conflict policy does not overwrite existing CMS article edits. It runs
both the weeknote and Bluesky announcement schema migrations. The seed is only
initial content, not a deployment-time synchronization mechanism.

### Bluesky weeknote announcements

Weeknote announcements are opt-in per entry: fill **Bluesky announcement** with
the plain-text teaser only; leave it blank to skip. Markdown is not interpreted.
The complete post must fit Bluesky's 300-grapheme and 3000-byte limits,
including the generated tag and link; oversized teasers are rejected on save. On
publish, the site adds `#weeknotes` and the weeknote link, and builds the rich
card from the existing title, description, and Open Graph data. The generated
post is attached to the entry's existing `comments` JSON metadata. Existing
manual Bluesky threads are preserved, and each eligible weeknote is announced at
most once; failed posts are retried using persistent job state. Private drafts
are never announced or overwritten: automation operates on the published entry
and preserves private draft content and status.

The worker handles one queued entry per minute. Publishing ensures the recurring
task exists and reconciles published weeknotes. With no backlog, an announcement
normally appears on the next run. Enabling the worker also picks up
already-published entries with a teaser and no existing thread; imported archive
entries start with no teaser. Failures retry with exponential backoff. After a
process crash, EmDash's scheduler lock can delay recovery for about ten minutes.

The `comments.bsky.postCid` field keeps its existing name but contains the
post's record key, not its `bafyre…` CID. The job stores the actual CID
separately.

Outgoing Bluesky requests require all runtime gates: set `NODE_ENV=production`,
`BLUESKY_ANNOUNCE_ENABLED=true`, a dedicated `BLUESKY_APP_PASSWORD`, and
`BLUESKY_PDS_URL` to the account's actual PDS (`https://pds.ovy.cloud`). The
allowed author is fixed to `did:plc:jrrhosrfzgjf6v4oydav6ftb`; use credentials
for that account. Store the app password only in the production runtime's secret
manager; never commit it. Development is not allowed to post. This app password
is separate from Atmosphere login, and OAuth login does not grant permission to
create announcements.

For each existing database, deploy the updated `weeknotes` schema before
starting the new runtime. `pnpm cms:import` runs the
`migrate-bluesky-announcements.mjs` migration automatically; on a deployment
database, run `node scripts/migrate-bluesky-announcements.mjs` against that
database before starting the updated server. This migration only adds the
nullable field and its editor schema; it does not rewrite entries or historical
revisions. The updated runtime cannot store announcement teasers on an
unmigrated database.

Run `pnpm build` for standalone Node production output, then `pnpm preview` to
serve it locally with the private `.env` file. Run
`pnpm test --run --exclude '.direnv/**'` for the existing test suite.
`nix build .#site` and `nix build .#container` package the server and runtime
dependencies, excluding local data and secrets.

### Weeknote identifiers

For an existing database, run `node scripts/migrate-weeknotes.mjs` and
`node scripts/migrate-bluesky-announcements.mjs` before using the updated
editor, or pass a different SQLite path as the first argument to each script.
The migration converts existing admin titles to their `YYYY-wWW` slugs, updates
the current live/draft revision pointers, and installs the title format
constraint and SQLite publication guards. Staged drafts use their staged slug.
Historical revisions, article bodies, publication dates, and private draft edits
are preserved; rerunning the migration makes no further content changes.

The `weeknote-iso-week` EmDash plugin provides save, publish, and scheduling
feedback. SQLite guards also reject invalid published/scheduled rows written by
paths that bypass those hooks. Run the migration against any existing deployment
database before starting the updated server; a code build alone does not migrate
its private content database.

### Atmosphere login

The official `@emdash-cms/auth-atproto` provider is enabled alongside passkeys.
Open <http://127.0.0.1:4321/_emdash/admin/login>, choose **Atmosphere**, and
enter `ovyerus.com`. Sign in and approve OAuth at your own PDS; EmDash never
receives your password. No app password, client secret, or OAuth-app
registration is needed.

Access is restricted to `did:plc:jrrhosrfzgjf6v4oydav6ftb`, the stable DID for
`ovyerus.com`. That single allowed identity gets Admin access (role `50`); a
handle change does not grant access to someone who later takes the old handle.
The plugin creates a separate EmDash user on first Atmosphere login rather than
automatically linking to the existing passkey account. Existing users and
passkeys are unchanged.

Use `127.0.0.1` throughout the Atmosphere flow: AT Protocol requires an
IP-literal loopback callback. An existing passkey registered at `localhost` must
still be used at `localhost`; passkeys are origin-bound. The MCP definition also
uses `127.0.0.1` so Atmosphere login and MCP consent share the same browser
session.

In production, the PDS must be able to fetch
`https://ovyerus.com/.well-known/atproto-client-metadata.json`. Keep
`EMDASH_SITE_URL` set to that HTTPS origin behind the reverse proxy.

### Local MCP connection

`.omp/mcp.json` defines `emdash-local` at
<http://127.0.0.1:4321/_emdash/api/mcp>. Keep the local server running and sign
in at <http://127.0.0.1:4321/_emdash/admin/> before running these commands in
omp:

```text
/mcp reload
/mcp reauth emdash-local
/mcp test emdash-local
```

Approve the browser consent screen. Atmosphere currently returns to the admin
dashboard after login instead of the pending MCP consent page; if this happens,
run `/mcp reauth emdash-local` again after signing in.

The configured scopes are `content:read`, `content:write`, `media:read`,
`media:write`, `schema:read`, and `settings:read`. These allow content and media
reading/editing (including publishing), plus schema and settings reading.
`content:write` also permits taxonomy and menu management. Review the consent
screen: OMP 18.4.6 can request all advertised scopes despite `oauth.scope`.
Approve only the six configured scopes; leave administrative access, schema
changes, settings changes, plugin tools, and site transfer unselected.

OAuth credentials and refresh tokens stay in omp's active-profile auth storage,
not this repository. Each profile authorizes separately. Use
`/mcp unauth emdash-local` to remove omp's stored credentials, and revoke the
grant in EmDash to invalidate server-side access. This connection targets only
the local review database; production needs a separate approved connection.

If EmDash rejects a stored refresh token with `INVALID_GRANT` (for example after
replacing the local database), reauthorize rather than changing authentication
requirements. Changing the endpoint hostname also requires a fresh
authorization: omp binds credentials to the full server URL. Run `/mcp reload`
in any already-open omp sessions after changing `.omp/mcp.json`.

## Review before deployment

The deployment workflow is manual (`workflow_dispatch`); pushing to main no
longer publishes an image or deploys. Nothing is deployed by local development.
The old static Caddy runtime has been replaced by Node on port 8080. The
container runs from `/`, so the configured relative data paths resolve to
`/data/emdash.db` and `/data/uploads`.

Before an approved Fly deployment, create a persistent volume named `data` in
`syd`, provide `EMDASH_ENCRYPTION_KEY` through runtime secrets, set
`EMDASH_SITE_URL=https://ovyerus.com`, and arrange database/media backups.
Transfer the reviewed local content using EmDash's site export/import workflow
or a consistent database/uploads backup; do not bake private state into the
image. Fly is configured to keep the server running for scheduled publication.
The manual GitHub deployment also needs its existing `FLY_API_TOKEN`.

The sitemap is generated from published CMS entries at `/sitemap.xml`;
`/rss.xml` still redirects to `/posts/rss.xml`. The static-build shortlink
integration is removed: existing `ovy.rs` mappings are untouched, but new CMS
entries do not automatically create shortlinks.

## License

The source code in this repository is licensed under the
[zlib License](./LICENSE), but post content - `./src/content/posts/*.md` and
`./src/content/weeknotes/*.md`, including their copies in `seed/seed.json` and
the CMS database - is licensed under a
[Creative Commons CC-BY-NC-SA 4.0 International License](https://creativecommons.org/licenses/by-nc-sa/4.0/)
