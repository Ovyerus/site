import sitemap from "@astrojs/sitemap";
import a11yEmoji from "@fec/remark-a11y-emoji";
import remarkFigureCaption from "@microflash/remark-figure-caption";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import compress from "astro-compress";
import icon from "astro-icon";
import workerLinks from "astro-worker-links";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeExternalLinks from "rehype-external-links";
import rehypeSlug from "rehype-slug";
import * as fs from "node:fs";
import { transformerTitle } from "./src/lib/astro/shikiTransformerTitle";

import dolch from "./src/dolch.theme.json" assert { type: "json" };

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
  integrations: [
    icon(),
    sitemap(),
    workerLinks({
      domain: "https://ovy.rs",
      secret: process.env.WORKER_LINKS_SECRET!,
      getPageMapping(pages) {
        return pages
          .filter(
            (url) =>
              url.pathname !== "/posts/" && url.pathname.includes("/posts"),
          )
          .map((url) => {
            return {
              page: url.href,
              shortlink: url.pathname.replace("/posts", ""),
            };
          });
      },
    }),
    compress(),
  ],
  prefetch: {
    prefetchAll: true,
  },
  site: "https://ovyerus.com",
  markdown: {
    remarkPlugins: [remarkFigureCaption, a11yEmoji],
    rehypePlugins: [
      rehypeSlug,
      [
        rehypeAutolinkHeadings,
        { behavior: "append", content: { type: "text", value: "#" } },
      ],
      [
        rehypeExternalLinks,
        { target: "_blank", rel: ["nofollow", "noopener"] },
      ],
    ],
    shikiConfig: {
      wrap: true,
      theme: {
        ...dolch,
        settings: dolch.tokenColors,
        bg: "#101416",
        fg: "#b0b4b7",
        type: "dark",
      },
      transformers: [transformerTitle()],
    },
  },
  vite: {
    plugins: [rawFonts([".ttf", ".woff", ".woff2"]), tailwindcss() as any],
    optimizeDeps: { exclude: ["@resvg/resvg-js"] },
  },
});
