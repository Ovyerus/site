import tailwind from "@astrojs/tailwind";
import prefetch from "@astrojs/prefetch";
import a11yEmoji from "@fec/remark-a11y-emoji";
import remarkFigureCaption from "@microflash/remark-figure-caption";
import { defineConfig } from "astro/config";
import compress from "astro-compress";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeSlug from "rehype-slug";

import dolch from "./src/dolch.theme.json";

// https://astro.build/config
export default defineConfig({
  integrations: [tailwind(), prefetch(), compress()],
  site: "https://ovyerus.com",
  markdown: {
    extendDefaultPlugins: true,
    remarkPlugins: [remarkFigureCaption, a11yEmoji],
    rehypePlugins: [rehypeSlug, rehypeAutolinkHeadings],
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
