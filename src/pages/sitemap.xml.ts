import type { APIRoute } from "astro";
import { getEmDashCollection } from "emdash";
import { getArticles } from "~lib/content";

export const GET: APIRoute = async ({ site }) => {
  const [posts, weeknotes, pages] = await Promise.all([
    getArticles("posts"),
    getArticles("weeknotes"),
    getEmDashCollection("pages"),
  ]);
  if (pages.error) throw pages.error;
  const paths = [
    "/",
    "/posts",
    "/weeknotes",
    ...posts.map(({ id }) => `/posts/${encodeURIComponent(id)}`),
    ...weeknotes.map(({ id }) => `/weeknotes/${encodeURIComponent(id)}`),
    ...pages.entries.map(({ id }) => `/${encodeURIComponent(id)}`),
  ];
  const urls = paths
    .map((path) => `<url><loc>${new URL(path, site).href}</loc></url>`)
    .join("");
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
    {
      headers: { "Content-Type": "application/xml; charset=utf-8" },
    },
  );
};
