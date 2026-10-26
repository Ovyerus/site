import svelte from "@astrojs/svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import node from "@astrojs/node";
import react from "@astrojs/react";
import emdash from "emdash/astro";
import { sqlite } from "emdash/db";
import { markdownOptions } from "./src/lib/astro/markdown";
import { unified } from "@astrojs/markdown-remark";
import { atproto } from "@emdash-cms/auth-atproto";
import { proxySecurity } from "./src/lib/deployment";

const rawFonts = (exts: string[]) => ({
  name: "vite-plugin-ovyerus-raw-fonts",
  transform(_: unknown, id: string) {
    if (exts.some((e) => id.endsWith(e))) {
      const buffer = fs.readFileSync(id);
      return {
        code: `export default ${JSON.stringify(buffer)};`,
        map: null,
      };
    }
  },
});

// TODO: indieweb/microformats?

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  server: { host: "127.0.0.1" },
  security: proxySecurity,
  session: {
    driver: {
      entrypoint: new URL("./src/lib/session-driver.ts", import.meta.url),
      config: {},
    },
  },
  integrations: [
    svelte(),
    react(),
    emdash({
      middleware: {
        outer: new URL("./src/lib/fly-middleware.ts", import.meta.url),
      },
      // Use system fonts in the admin so offline Nix builds never fetch fonts.
      fonts: false,
      plugins: [
        {
          id: "weeknote-iso-week",
          version: "1.0.0",
          format: "standard",
          capabilities: ["content:write", "hooks.content-policy:register"],
          entrypoint: fileURLToPath(
            new URL("./src/lib/emdash-weeknotes.ts", import.meta.url),
          ),
        },
        {
          id: "standard-site",
          version: "1.0.0",
          format: "standard",
          capabilities: ["content:read"],
          entrypoint: fileURLToPath(
            new URL("./src/lib/emdash-standard-site.ts", import.meta.url),
          ),
        },
        {
          id: "weeknote-bluesky",
          version: "1.0.0",
          format: "standard",
          capabilities: ["content:write"],
          entrypoint: fileURLToPath(
            new URL("./src/lib/emdash-bluesky.ts", import.meta.url),
          ),
        },
      ],
      authProviders: [
        atproto({
          // ovyerus.com: keep access tied to the account, not its mutable handle.
          allowedDIDs: ["did:plc:jrrhosrfzgjf6v4oydav6ftb"],
          defaultRole: 50,
        }),
      ],
      database: sqlite({
        url: "file:./data/emdash.db",
        urlEnv: "EMDASH_DATABASE_URL",
      }),
      storage: {
        entrypoint: fileURLToPath(
          new URL("./src/lib/emdash-storage.ts", import.meta.url),
        ),
        config: {},
      },
    }),
  ],
  prefetch: {
    prefetchAll: true,
  },
  site: "https://ovyerus.com",
  markdown: {
    processor: unified({
      remarkPlugins: markdownOptions.remarkPlugins,
      rehypePlugins: markdownOptions.rehypePlugins,
    }),
    shikiConfig: markdownOptions.shikiConfig,
  },
  vite: {
    plugins: [rawFonts([".ttf", ".woff", ".woff2"]), tailwindcss() as any],
    optimizeDeps: { exclude: ["@resvg/resvg-js"] },
  },
});
