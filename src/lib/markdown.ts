import { createMarkdownProcessor } from "@astrojs/markdown-remark";
import { markdownOptions } from "./astro/markdown";

export const markdownRenderer = createMarkdownProcessor(markdownOptions);
