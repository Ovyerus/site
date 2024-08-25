import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import { renderMarkdownForRSS, synopsisFromHtml } from "~lib/rss";
import {
  getDayWeeknoteWasWritten,
  getWeeknoteTitle,
  sortWeeknotes,
} from "~lib/weeknotes";

const weeknotes = sortWeeknotes(await getCollection("weeknotes"));

export const GET = () =>
  rss({
    title: "Ovyerus' weeknotes",
    description:
      "An attempt to force me to do some decent writing frequently, in the form of weekly journal-ish entries.",
    site: import.meta.env.SITE,
    items: weeknotes.map(({ body, data, slug }) => {
      const date = getDayWeeknoteWasWritten(slug);
      const subtitle = data.subtitle ? `: ${data.subtitle}` : "";
      const content = renderMarkdownForRSS(body);
      const description = synopsisFromHtml(content);

      return {
        link: `/weeknotes/${slug}`,
        title: `${getWeeknoteTitle(slug)}${subtitle}`,
        pubDate: date,
        description,
        content,
      };
    }),
  });