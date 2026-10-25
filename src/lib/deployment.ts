/** Trust Fly's forwarded HTTPS origin only for the canonical site. */
export const proxySecurity = {
  allowedDomains: [
    { protocol: "https" as const, hostname: "ovyerus.com", port: "" },
  ],
};

/** Shared by the CMS and its announcement worker; never open a second database. */
export function databasePath(): string {
  const url = process.env.EMDASH_DATABASE_URL ?? "file:./data/emdash.db";
  const path = url.startsWith("file:") ? url.slice(5) : url;
  if (!path || path.includes("\0") || /^[a-z]+:\/\//i.test(path)) {
    throw new Error("EMDASH_DATABASE_URL must name a local SQLite file.");
  }
  return path;
}

export function isReadOnlyReplica(): boolean {
  const value = process.env.EMDASH_READ_ONLY;
  if (value !== undefined && value !== "true" && value !== "false") {
    throw new Error("EMDASH_READ_ONLY must be true or false.");
  }
  return value === "true";
}
