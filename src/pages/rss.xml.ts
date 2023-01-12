import rss from "@astrojs/rss";
import type { MarkdownInstance } from "astro";
import { parseISO } from "date-fns";
import type { PostFrontmatter } from "~types";

type Post = MarkdownInstance<PostFrontmatter>;

const postsImport = import.meta.glob<true, string, Post>("./posts/*.md", {
  eager: true,
});
const posts = Object.values(postsImport);

export const get = () =>
  rss({
    title: "Ovyerus' Posts",
    description:
      "A stream of my consciousness shouted into the ether. Sometimes big posts, sometimes small posts. Depends on how I'm feeling when I write whatever.",
    site: import.meta.env.SITE,
    drafts: false,
    items: posts.map((p) => ({
      link: p.url!,
      title: p.frontmatter.title,
      pubDate: parseISO(p.frontmatter.createdAt),
      description: p.frontmatter.description!,
    })),
  });
