import type { APIRoute } from "astro";
import { getStandardPublicationUri } from "~lib/standard-site-verification";

export const GET: APIRoute = () => {
  const uri = getStandardPublicationUri();
  return new Response(uri ? `${uri}\n` : "Not found\n", {
    status: uri ? 200 : 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
};
