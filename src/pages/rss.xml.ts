import type { APIRoute } from "astro";

export const GET: APIRoute = ({ redirect }) => redirect("/posts/rss.xml", 307);
