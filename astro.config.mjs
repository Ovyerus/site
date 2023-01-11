import tailwind from "@astrojs/tailwind";
import prefetch from "@astrojs/prefetch";
import sitemap from "@astrojs/sitemap";
import a11yEmoji from "@fec/remark-a11y-emoji";
import remarkFigureCaption from "@microflash/remark-figure-caption";
import { defineConfig } from "astro/config";
import compress from "astro-compress";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeExternalLinks from "rehype-external-links";
import rehypeSlug from "rehype-slug";

import dolch from "./src/dolch.theme.json" assert { type: "json" };

// TODO: indieweb/microformats?

// https://astro.build/config
export default defineConfig({
  integrations: [tailwind(), prefetch(), sitemap(), compress()],
  site: "https://ovyerus.com",
  markdown: {
    extendDefaultPlugins: true,
    remarkPlugins: [remarkFigureCaption, a11yEmoji],
    rehypePlugins: [
      rehypeSlug,
      rehypeAutolinkHeadings,
      [
        rehypeExternalLinks,
        { target: "_blank", rel: ["nofollow", "noopener"] },
      ],
    ],
    shikiConfig: {
      wrap: true,
      theme: {
        ...dolch,
        bg: "#101416",
        fg: "#b0b4b7",
        type: "dark",
      },
    },
  },
});
