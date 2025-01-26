import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import { sortPosts } from "~lib/posts";
import { renderMarkdownForRSS } from "~lib/rss";

const posts = sortPosts(await getCollection("posts"));

export const GET = () =>
  rss({
    title: "Ovyerus' posts",
    description:
      "A stream of my consciousness shouted into the ether. Sometimes big posts, sometimes small posts. Depends on how I'm feeling when I write whatever.",
    site: import.meta.env.SITE,
    trailingSlash: false,
    items: posts.map(({ body, data, id }) => ({
      link: `/posts/${id}`,
      title: data.title,
      pubDate: data.createdAt,
      description: data.description,
      content: renderMarkdownForRSS(body),
    })),
  });
