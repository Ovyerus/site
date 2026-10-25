import { isReadOnlyReplica } from "./deployment";

/** Run before EmDash: even authentication GETs and preview reads can write. */
export function replayToPrimary(request: Request): Response | null {
  if (!isReadOnlyReplica()) return null;
  const url = new URL(request.url);
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return new Response("Invalid URL", { status: 400 });
  }
  const cookies = request.headers.get("cookie") ?? "";
  const needsPrimary =
    !["GET", "HEAD"].includes(request.method) ||
    path === "/_emdash" ||
    path.startsWith("/_emdash/") ||
    url.searchParams.has("_preview") ||
    request.headers.has("authorization") ||
    /(?:^|;\s*)(?:astro-session|emdash-edit-mode)=/.test(cookies);
  if (!needsPrimary) return null;

  const primary = process.env.PRIMARY_MACHINE_ID;
  if (!primary || !/^[a-zA-Z0-9_-]+$/.test(primary)) {
    return new Response("Primary is not configured", {
      status: 503,
      headers: { "Cache-Control": "no-store", "Retry-After": "5" },
    });
  }
  return new Response(null, {
    headers: {
      "fly-replay": `instance=${primary}`,
      "Cache-Control": "no-store",
    },
  });
}
