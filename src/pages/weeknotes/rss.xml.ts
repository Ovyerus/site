import rss from "@astrojs/rss";
import { getArticles } from "~lib/content";
import { renderMarkdownForRSS, synopsisFromHtml } from "~lib/rss";
import { getWeeknoteStrings, sortWeeknotes } from "~lib/weeknotes";

export const GET = async () => {
  const weeknotes = sortWeeknotes(await getArticles("weeknotes"));

  return rss({
    title: "Ovyerus' weeknotes",
    description:
      "An attempt to force me to do some decent writing frequently, in the form of weekly journal-ish entries.",
    site: import.meta.env.SITE,
    items: weeknotes.map(({ body, data, id }) => {
      const { createdAt, title } = getWeeknoteStrings(id);
      const subtitle = data.subtitle ? `: ${data.subtitle}` : "";
      const content = renderMarkdownForRSS(body);
      const description = synopsisFromHtml(content);

      return {
        link: `/weeknotes/${id}`,
        title: `${title}${subtitle}`,
        pubDate: createdAt,
        description,
        content,
      };
    }),
  });
};
