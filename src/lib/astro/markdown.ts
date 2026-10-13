import type { AstroMarkdownOptions } from "@astrojs/markdown-remark";
import a11yEmoji from "@fec/remark-a11y-emoji";
import remarkFigureCaption from "@microflash/remark-figure-caption";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeExternalLinks from "rehype-external-links";
import rehypeSlug from "rehype-slug";
import dolch from "../../dolch.theme.json" with { type: "json" };
import { transformerTitle } from "./shikiTransformerTitle";

export const markdownOptions: AstroMarkdownOptions = {
  remarkPlugins: [remarkFigureCaption, a11yEmoji],
  rehypePlugins: [
    rehypeSlug,
    [
      rehypeAutolinkHeadings,
      { behavior: "append", content: { type: "text", value: "#" } },
    ],
    [rehypeExternalLinks, { target: "_blank", rel: ["nofollow", "noopener"] }],
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
};
