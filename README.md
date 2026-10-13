# site

Source code for my personal website, [ovyerus.com](https://ovyerus.com)

## Development

Use Node.js 24 or newer and pnpm 12.9.0. The Nix shell provides both plus the
native libraries used by the build:

```sh
nix develop
pnpm install --frozen-lockfile
mkdir -p data
pnpm cms:import
pnpm exec emdash secrets generate --write .env
chmod 600 .env data/emdash.db
pnpm dev --host 127.0.0.1
```

Open <http://localhost:4321/> to review the site and
<http://localhost:4321/_emdash/admin/> to edit it. Complete the setup wizard and
register your own passkey. The initial content is already imported; the seed
contains the original site content rather than demo posts. Keep the development
server bound to loopback: EmDash's development-only authentication bypass is not
suitable for a publicly accessible server.

EmDash owns published content at request time:

- **Posts:** title, description, Markdown body, tags, original written/modified
  dates, and optional Bluesky thread metadata.
  The tag picker starts with the archive's existing tags; add new choices in
  **Content Types → Posts → Tags**.
- **Weeknotes:** Markdown body, subtitle, description, and Bluesky thread
  metadata. Keep slugs in `YYYY-wWW` format; public titles and dates derive from
  ISO weeks.
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
`pnpm cms:import` regenerates `seed/seed.json` and imports missing entries; its
`skip` conflict policy does not overwrite existing CMS edits. The seed is only
initial content, not a deployment-time synchronization mechanism.

Run `pnpm build` for standalone Node production output, then `pnpm preview` to
serve it locally with the private `.env` file. Run
`pnpm test --run --exclude '.direnv/**'` for the existing test suite.
`nix build .#site` and `nix build .#container` package the server and runtime
dependencies, excluding local data and secrets.

### Local MCP connection

`.omp/mcp.json` defines `emdash-local` at
<http://localhost:4321/_emdash/api/mcp>. Keep the local server running, then
run these commands in omp:

```text
/mcp reload
/mcp reauth emdash-local
/mcp test emdash-local
```

Sign in with your own EmDash passkey and approve the browser consent screen.
The requested scopes allow content and media reading/editing (including
publishing), plus schema and settings reading. `content:write` also permits
taxonomy and menu management. Schema changes, settings changes, plugin tools,
and site transfer are not requested.

OAuth credentials and refresh tokens stay in omp's active-profile auth storage,
not this repository. Each profile authorizes separately. Use
`/mcp unauth emdash-local` to remove omp's stored credentials, and revoke the
grant in EmDash to invalidate server-side access. This connection targets only
the local review database; production needs a separate approved connection.

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
