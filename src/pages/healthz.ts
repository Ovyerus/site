import type { APIRoute } from "astro";
import { databaseIsReady } from "~lib/readiness";

export const GET: APIRoute = ({ locals }) => {
  const ready = !!locals.emdash?.storage && databaseIsReady();
  return new Response(ready ? "ready\n" : "not ready\n", {
    status: ready ? 200 : 503,
    headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
  });
};
