import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import { parseISO } from "date-fns";

const posts = await getCollection("posts");

export const GET = () =>
  rss({
    title: "Ovyerus' Posts",
    description:
      "A stream of my consciousness shouted into the ether. Sometimes big posts, sometimes small posts. Depends on how I'm feeling when I write whatever.",
    site: import.meta.env.SITE,
    items: posts.map(({ data, slug }) => ({
      link: new URL(slug, import.meta.env.SITE).href,
      title: data.title,
      pubDate: parseISO(data.createdAt),
      description: data.description!,
    })),
  });
