import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";

const parser = new MarkdownIt("commonmark");

// TODO: replace this with a remark/rehype chain to get similar output as to on the website.
export const renderMarkdownForRSS = (markdown: string) =>
  sanitizeHtml(parser.render(markdown), {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img"]),
  });

export const synopsisFromHtml = (html: string) =>
  sanitizeHtml(html, { allowedTags: [] }).replaceAll("\n", " ").slice(0, 200) +
  "...";
