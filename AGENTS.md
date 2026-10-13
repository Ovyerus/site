# Repository Guidelines

## Project Overview

Personal website at **ovyerus.com**, built with Astro 5, Svelte 5, TypeScript,
and Tailwind CSS 4. Primarily static posts and weeknotes; Svelte adds
interactive Bluesky comments. Source licensing and separate content licensing
are in `README.md`; preserve that distinction when editing articles.

## Architecture & Data Flow

- `src/content.config.ts` loads posts/weeknotes from Markdown or MDX using Astro
  glob loaders and validates frontmatter with Zod. Files beginning with `_` are
  excluded.
- File-based routes in `src/pages/` fetch collections. List routes sort entries
  through `src/lib`; dynamic `[slug].astro` routes enumerate `getStaticPaths()`,
  call `render(entry)`, and pass content into `ArticleLayout.astro`.
- `Layout.astro` owns the document shell, `Head.astro`, and global styles.
  `ArticleLayout.astro` owns article metadata, navigation, footer, and comments;
  `ArticleIndex.astro`/`ArticleCard.astro` handle collection listings.
- Posts require `title`, `description`, `tags`, and `createdAt`; `modifiedAt` is
  optional. Weeknotes use **`YYYY-wWW.md`** filenames, e.g. `2026-w41.md`.
  `getWeeknoteStrings()` derives their title/date/summary using ISO weeks;
  frontmatter may supply `subtitle` and `description`.
- Collection IDs also drive URLs, RSS items, and OG images. Keep changes aligned
  across article/list routes, `src/lib/weeknotes.ts`, both `rss.xml.ts`
  endpoints, and `src/pages/og/[...slug].png.ts`.
- RSS uses a separate MarkdownIt + sanitization pipeline in `src/lib/rss.ts`,
  not Astro's website Markdown renderer. OG images use Satori and resvg.
- Optional `comments.bsky: { did, postCid }` metadata enables
  `BskyComments.svelte`, hydrated with `client:idle`. It fetches public Bluesky
  threads through `src/lib/bsky.ts`; `BskyPost.svelte` recursively renders
  replies.
- Builds produce static `dist/`. Nix packages it into a Caddy container serving
  port 8080; GitHub Actions publishes to GHCR and deploys to Fly.io.

## Key Directories

- `src/pages/`: routes and build-time RSS/OG endpoints, not a backend API layer.
- `src/lib/`: content/date helpers, RSS rendering, Bluesky utilities, and custom
  Shiki transformer under `astro/`.
- `src/components/`, `src/layouts/`: presentation and reusable page shells.
- `src/content/posts/`, `src/content/weeknotes/`: schema-validated article
  sources.
- `src/styles/`, `src/assets/`: theme/styles and bundled assets; `public/` holds
  files copied directly to the output, including health and well-known
  resources.
- `test/`: current Vitest suite. `.astro/`, `dist/`, and `.direnv/` are
  generated artifacts, not source to edit.

## Development Commands

Run in `nix develop` or the direnv shell (`.envrc` uses `use flake`):

```sh
yarn install --immutable                 # Install from the committed lockfile
yarn dev                                 # Development server; yarn start is equivalent
yarn build                               # Static production build
yarn preview                             # Serve the built output
yarn test                                # Vitest watch mode locally
yarn test --run --exclude '.direnv/**'     # One-shot local suite, ignoring Nix source copies
yarn prettier --check <paths>             # Formatting check
yarn prettier --write <paths>             # Format changed files
nix flake check                          # Check flake evaluation/build checks
nix build .#site                         # Nix static-site package
nix build .#container                    # Caddy container image
```

There are no lint or typecheck package scripts or corresponding CI gates. Do not
claim `yarn build` performs a separate typecheck. The shortlink integration in
`astro.config.ts` reads `WORKER_LINKS_SECRET` for `https://ovy.rs`; account for
this external integration when diagnosing builds, and never commit credentials.

## Code Conventions & Common Patterns

- Use existing Prettier configuration: Astro/Svelte/Tailwind plugins, wrapped
  prose, and sorted utility classes. EditorConfig specifies two spaces, LF,
  UTF-8, and final newlines; Markdown preserves trailing whitespace.
- TypeScript extends Astro's `strictest` config, with
  `exactOptionalPropertyTypes: false`. Prefer existing aliases such as
  `~lib/weeknotes`, `~components/ArticleCard.astro`, and
  `~layouts/Layout.astro`; `~*` maps to `src/*`.
- Astro components use TypeScript frontmatter, `interface Props`, destructured
  `Astro.props`, and slots. Components/layouts use PascalCase filenames; helpers
  and functions follow existing camelCase names such as `getWeeknoteStrings`.
- Svelte components use TypeScript, Svelte 5 `$props()`, and snippets. Keep
  loading/success/error states explicit with `{#await}` for comments. There is
  no shared application store or dependency-injection framework; pass props and
  import small helpers directly rather than introducing either.
- Collection loading/static generation uses `await` in Astro frontmatter and
  `getStaticPaths()`. Zod validates metadata; invalid weeknote IDs produce a
  build-time error. Bluesky errors surface through the component's catch branch;
  the fetch helper currently parses JSON without checking HTTP status.
- Reuse date/sorting helpers rather than duplicating ISO-week calculations.
  Lists use non-mutating `toSorted()` and newest-first ordering.
- Styling combines Tailwind utilities, scoped component CSS, and theme tokens in
  `src/styles/global.css`. Reuse existing fonts, magenta/cyan/dolch colors, and
  `.content`/`.link-list` styles. Website Markdown plugins and Shiki `title=...`
  code-block rendering are configured in `astro.config.ts`.

## Important Files

- `src/content.config.ts`: collection schemas and loaders.
- `src/lib/weeknotes.ts`, `src/lib/posts.ts`: derived metadata and ordering.
- `src/layouts/ArticleLayout.astro`: shared article presentation and hydration.
- `astro.config.ts`: site URL, integrations, Markdown, Shiki, Tailwind, raw-font
  loading for OG images, and shortlinks.
- `package.json`, `yarn.lock`, `.yarnrc.yml`: commands, dependencies, package
  pins.
- `tsconfig.json`, `svelte.config.js`, `prettier.config.cjs`: language/format
  setup.
- `flake.nix`, `site.nix`, `container.nix`: dev shell, offline dependency cache,
  build, and image. Dependency changes may require updating the fixed-output
  `yarnOfflineCache.outputHash` in `site.nix` as well as `yarn.lock`.
- `Caddyfile`, `fly.toml`, `.github/workflows/push.yaml`: serving/deployment.
  Caddy redirects `/rss.xml` to `/posts/rss.xml` and serves the custom 404 page.

## Runtime/Tooling Preferences

- Use **Node >=22 and Yarn 4.9.1**, not Bun/npm. Yarn is pinned in
  `.yarn/releases/` and uses the `node-modules` linker.
- `.tool-versions` still specifies Node 18.13.0, conflicting with
  `package.json`; follow the Node 22 Nix shell instead of that stale pin.
- The Nix shell supplies Node, Yarn, vips, pkg-config, and flyctl, and sets
  `LD_LIBRARY_PATH` for vips. Prefer it on NixOS for native dependencies.
- `scripts.nix` provides `ovy-mp4 INPUT` and `ovy-hls INPUT` FFmpeg wrappers for
  content media. HLS output directories must already exist; the wrapper does not
  create them and expects an audio stream.

## Testing & QA

- Vitest 3.2.4 uses Astro's `getViteConfig` in `vitest.config.ts`. Tests import
  `describe`, `test`, and `expect` directly and production helpers via aliases.
- `test/weeknotes.test.ts` currently covers four date/title/summary cases,
  including ISO-week year boundaries. Use deterministic inputs and compare dates
  with `date-fns` `isEqual`, following that suite's pattern.
- No coverage provider, thresholds, browser tests, or mocking setup is
  configured. The existing suite does not verify page rendering, feeds, OG
  images, or comments; exercise affected outputs/UI separately when changing
  those paths.
- Bare `yarn test --run` can discover duplicate tests in `.direnv/flake-inputs/`
  and fail resolving Astro from Nix store source copies. Use the exclusion shown
  above for local one-shot runs.
- Main-branch CI runs `nix flake check`, immutable dependency installation,
  `yarn test`, container build/push, then Fly deployment. Deployment requires
  `FLY_API_TOKEN`; do not deploy merely to verify a local change.
