import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { createRequest } from "astro/app/node";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  databasePath,
  isReadOnlyReplica,
  proxySecurity,
} from "~lib/deployment";
import { replayToPrimary } from "~lib/primary-routing";
import { createStorage } from "~lib/emdash-storage";
import { databaseIsReady } from "~lib/readiness";
import { AnnouncementStore } from "~lib/bluesky-announcement-store";
import { announcementConfig } from "~lib/bluesky-announcement";
import sessionDriver from "~lib/session-driver";

const directories: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("Fly deployment boundaries", () => {
  test("trusts canonical HTTPS proxy headers without accepting a spoofed forwarded host", () => {
    const socket = new Socket();
    const request = new IncomingMessage(socket);
    request.url = "/.well-known/atproto-client-metadata.json";
    request.headers = { host: "ovyerus.com", "x-forwarded-proto": "https" };
    try {
      expect(new URL(createRequest(request, proxySecurity).url).origin).toBe(
        "https://ovyerus.com",
      );
      request.headers["x-forwarded-host"] = "attacker.invalid";
      request.headers["x-forwarded-port"] = "444";
      expect(new URL(createRequest(request, proxySecurity).url).origin).toBe(
        "https://ovyerus.com",
      );
      // Astro's pattern matcher treats an empty port as unrestricted; this
      // policy pins the hostname/protocol, not arbitrary ports on that host.
      request.headers["x-forwarded-host"] = "attacker.invalid:444";
      expect(new URL(createRequest(request, proxySecurity).url).origin).toBe(
        "https://ovyerus.com",
      );
      request.headers["x-forwarded-proto"] = "http";
      expect(new URL(createRequest(request, proxySecurity).url).origin).toBe(
        "http://localhost",
      );
    } finally {
      socket.destroy();
    }
  });

  test("the CMS and worker share the runtime database, retaining local defaults", () => {
    vi.stubEnv("EMDASH_DATABASE_URL", undefined);
    expect(databasePath()).toBe("./data/emdash.db");
    vi.stubEnv("EMDASH_DATABASE_URL", "file:/litefs/emdash.db");
    expect(databasePath()).toBe("/litefs/emdash.db");
    vi.stubEnv("EMDASH_DATABASE_URL", "https://example.test/db");
    expect(() => databasePath()).toThrow("local SQLite file");
    vi.stubEnv("EMDASH_DATABASE_URL", "");
    expect(() => databasePath()).toThrow();
  });

  test("replicas cannot open the writable announcement store or activate posting", () => {
    vi.stubEnv("EMDASH_READ_ONLY", "true");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BLUESKY_ANNOUNCE_ENABLED", "true");
    expect(isReadOnlyReplica()).toBe(true);
    expect(() => new AnnouncementStore(":memory:")).toThrow(
      "only run on the primary",
    );
    expect(announcementConfig()).toBeNull();
    vi.stubEnv("EMDASH_READ_ONLY", "typo");
    expect(() => isReadOnlyReplica()).toThrow("true or false");
  });

  test.each([
    ["GET", "/_emdash/admin", {}],
    ["GET", "/_emdash/api/auth/atproto/callback?code=fixture", {}],
    ["GET", "/_emdash/api/search?q=hello", {}],
    ["GET", "/_%65mdash/admin", {}],
    ["GET", "/weeknotes/2026-w42?_preview=fixture", {}],
    ["GET", "/", { cookie: "other=1; astro-session=fixture" }],
    ["HEAD", "/", { cookie: "emdash-edit-mode=true" }],
    ["GET", "/posts", { authorization: "Bearer fixture" }],
    ["POST", "/", {}],
    ["OPTIONS", "/_emdash/api/media", {}],
  ])("replays %s %s before invoking EmDash", (method, path, headers) => {
    vi.stubEnv("EMDASH_READ_ONLY", "true");
    vi.stubEnv("PRIMARY_MACHINE_ID", "primary-fixture");
    const response = replayToPrimary(
      new Request(`https://ovyerus.com${path}`, { method, headers }),
    );
    expect(response?.headers.get("fly-replay")).toBe(
      "instance=primary-fixture",
    );
    expect(response?.headers.get("cache-control")).toBe("no-store");
  });

  test("anonymous public reads stay regional; primary and local development never replay", () => {
    vi.stubEnv("EMDASH_READ_ONLY", "true");
    expect(
      replayToPrimary(new Request("https://ovyerus.com/weeknotes")),
    ).toBeNull();
    expect(
      replayToPrimary(
        new Request("https://ovyerus.com/posts/rss.xml", { method: "HEAD" }),
      ),
    ).toBeNull();
    vi.stubEnv("EMDASH_READ_ONLY", undefined);
    expect(
      replayToPrimary(new Request("https://ovyerus.com/_emdash/admin")),
    ).toBeNull();
  });

  test("missing or unsafe primary identity fails closed", () => {
    vi.stubEnv("EMDASH_READ_ONLY", "true");
    for (const id of [undefined, "", "primary,region=elsewhere"]) {
      vi.stubEnv("PRIMARY_MACHINE_ID", id);
      expect(
        replayToPrimary(new Request("https://ovyerus.com/_emdash/admin"))
          ?.status,
      ).toBe(503);
    }
  });

  test("split B2 storage resolves runtime credentials and isolates private URLs", async () => {
    vi.stubEnv("EMDASH_STORAGE", "s3");
    vi.stubEnv("S3_ENDPOINT", "https://s3.us-west-004.backblazeb2.com");
    vi.stubEnv("S3_REGION", "us-west-004");
    vi.stubEnv("S3_BUCKET", "fixture");
    vi.stubEnv("S3_ACCESS_KEY_ID", "fixture-key-id");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "fixture-secret");
    vi.stubEnv("S3_PUBLIC_URL", undefined);
    vi.stubEnv("PRIVATE_S3_BUCKET", "fixture-private");
    vi.stubEnv("PRIVATE_S3_ACCESS_KEY_ID", "fixture-private-id");
    vi.stubEnv("PRIVATE_S3_SECRET_ACCESS_KEY", "fixture-private-secret");
    vi.stubEnv("PRIVATE_S3_ENDPOINT", undefined);
    vi.stubEnv("PRIVATE_S3_REGION", undefined);
    vi.stubEnv("PRIVATE_S3_PUBLIC_URL", undefined);
    const storage = createStorage();
    expect(storage.getPublicUrl("image.png")).toBe(
      "/_emdash/api/media/file/image.png",
    );
    expect(storage.getClientUploadOrigin?.()).toBe(
      "https://s3.us-west-004.backblazeb2.com",
    );
    const signed = await storage.getSignedUploadUrl({
      key: "uploads/fixture.png",
      contentType: "image/png",
      expiresIn: 60,
    });
    const url = new URL(signed.url);
    expect(url.origin).toBe("https://s3.us-west-004.backblazeb2.com");
    expect(url.pathname).toBe("/fixture/blog/uploads/fixture.png");
    expect(url.searchParams.get("X-Amz-Credential")).toContain(
      "fixture-key-id/",
    );
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[a-f0-9]{64}$/);
    expect(signed.method).toBe("PUT");
    vi.stubEnv("S3_PUBLIC_URL", "https://bucket.example.test");
    expect(createStorage().getPublicUrl("image.png")).toBe(
      "https://bucket.example.test/blog/image.png",
    );
    expect(() => createStorage().getPublicUrl("backups/private.json")).toThrow(
      "Private",
    );
    vi.stubEnv("S3_PUBLIC_URL", undefined);
    vi.stubEnv("S3_REGION", undefined);
    expect(() => createStorage()).toThrow("S3_REGION");
  });

  test("sessions persist in the runtime-selected writable directory", async () => {
    const directory = mkdtempSync(join(tmpdir(), "site-sessions-"));
    directories.push(directory);
    vi.stubEnv("EMDASH_SESSION_PATH", directory);
    const first = sessionDriver();
    await first.setItem!("fixture", "private session");
    const restarted = sessionDriver();
    expect(await restarted.getItem!("fixture")).toBe("private session");
    await first.dispose?.();
    await restarted.dispose?.();
  });

  test("readiness rejects missing, unseeded and incompletely migrated databases without creating them", () => {
    const directory = mkdtempSync(join(tmpdir(), "site-readiness-"));
    directories.push(directory);
    const path = join(directory, "emdash.db");
    expect(databaseIsReady(path)).toBe(false);
    const db = new DatabaseSync(path);
    db.exec(`
      CREATE TABLE ec_posts (title TEXT, body TEXT);
      CREATE TABLE ec_weeknotes (title TEXT, body TEXT);
      CREATE TABLE ec_pages (title TEXT, body TEXT);
      CREATE TABLE ec_home (title TEXT, tagline TEXT);
    `);
    expect(databaseIsReady(path)).toBe(false);
    db.exec(`
      ALTER TABLE ec_weeknotes ADD COLUMN bluesky_announcement TEXT;
      CREATE TRIGGER weeknotes_iso_week_insert BEFORE INSERT ON ec_weeknotes BEGIN SELECT 1; END;
      CREATE TRIGGER weeknotes_iso_week_update BEFORE UPDATE ON ec_weeknotes BEGIN SELECT 1; END;
    `);
    expect(databaseIsReady(path)).toBe(true);
    vi.stubEnv("EMDASH_READ_ONLY", "true");
    vi.stubEnv("FLY_MACHINE_ID", "replica");
    vi.stubEnv("PRIMARY_MACHINE_ID", "primary");
    expect(databaseIsReady(path)).toBe(false);
    writeFileSync(join(directory, ".primary"), "wrong-primary\n");
    expect(databaseIsReady(path)).toBe(false);
    writeFileSync(join(directory, ".primary"), "primary\n");
    expect(databaseIsReady(path)).toBe(true);
    db.close();
  });
});
