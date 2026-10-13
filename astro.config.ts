import svelte from "@astrojs/svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import * as fs from "node:fs";
import node from "@astrojs/node";
import react from "@astrojs/react";
import emdash, { local } from "emdash/astro";
import { sqlite } from "emdash/db";
import { markdownOptions } from "./src/lib/astro/markdown";
import { unified } from "@astrojs/markdown-remark";
import { atproto } from "@emdash-cms/auth-atproto";

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
  integrations: [
    svelte(),
    react(),
    emdash({
      // Use system fonts in the admin so offline Nix builds never fetch fonts.
      fonts: false,
      authProviders: [
        atproto({
          // ovyerus.com: keep access tied to the account, not its mutable handle.
          allowedDIDs: ["did:plc:jrrhosrfzgjf6v4oydav6ftb"],
          defaultRole: 50,
        }),
      ],
      database: sqlite({ url: "file:./data/emdash.db" }),
      storage: local({
        directory: "./data/uploads",
        baseUrl: "/_emdash/api/media/file",
      }),
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
