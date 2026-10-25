import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

// Run after pnpm build. All state is isolated; no real B2/Bluesky/Fly access.
const splitS3 = process.argv.includes("--split-s3");
const projectArgument = process.argv
  .slice(2)
  .find((arg) => arg !== "--split-s3");
const project = projectArgument
  ? resolve(projectArgument)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = await mkdtemp(join(tmpdir(), "site-replica-smoke-"));
const database = join(root, "data", "emdash.db");
const children = [];
const env = {
  ...process.env,
  NODE_ENV: "production",
  HOST: "127.0.0.1",
  EMDASH_DATABASE_URL: `file:${database}`,
  EMDASH_MIGRATIONS_MODE: "check",
  EMDASH_STORAGE: splitS3 ? "s3" : "local",
  // All S3 addresses/keys are fixtures, never inherited account credentials.
  // A mistaken object request must fail locally, not touch a real bucket.
  ...(splitS3
    ? {
        S3_ENDPOINT: "https://127.0.0.1:1",
        S3_REGION: "us-west-004",
        S3_BUCKET: "fixture-public",
        S3_ACCESS_KEY_ID: "fixture-media-id",
        S3_SECRET_ACCESS_KEY: "fixture-media-secret",
        S3_PUBLIC_URL: "https://cdn.fixture.invalid",
        PRIVATE_S3_ENDPOINT: "https://127.0.0.1:1",
        PRIVATE_S3_REGION: "us-west-004",
        PRIVATE_S3_BUCKET: "fixture-private",
        PRIVATE_S3_ACCESS_KEY_ID: "fixture-private-id",
        PRIVATE_S3_SECRET_ACCESS_KEY: "fixture-private-secret",
        PRIVATE_S3_PUBLIC_URL: "",
      }
    : {}),
  EMDASH_SESSION_PATH: join(root, "sessions"),
  EMDASH_SITE_URL: "https://ovyerus.com",
  EMDASH_READ_ONLY: "false",
  BLUESKY_ANNOUNCE_ENABLED: "false",
  PRIMARY_MACHINE_ID: "fixture-primary",
};

function command(...args) {
  execFileSync(process.execPath, args, { cwd: project, env, stdio: "pipe" });
}
async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  server.close();
  await once(server, "close");
  return port;
}
async function start(readOnly) {
  const port = await freePort();
  const child = spawn(
    process.execPath,
    [join(project, "dist/server/entry.mjs")],
    {
      cwd: root,
      env: { ...env, PORT: String(port), EMDASH_READ_ONLY: String(readOnly) },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  children.push(child);
  const state = { child, origin: `http://127.0.0.1:${port}`, logs: "" };
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => {
      state.logs = (state.logs + chunk.toString()).slice(-131_072);
    });
  }
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`Server exited: ${state.logs}`);
    try {
      const res = await fetch(`${state.origin}/healthz`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (res.status === 200) return state;
    } catch {
      /* Listener not started yet. */
    }
    await delay(100);
  }
  throw new Error(`Server did not become ready: ${state.logs}`);
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const kill = setTimeout(() => child.kill("SIGKILL"), 5_000);
  await exited;
  clearTimeout(kill);
}
async function digest() {
  const hash = createHash("sha256");
  hash.update(await readFile(database));
  try {
    hash.update(await readFile(`${database}-wal`));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return hash.digest("hex");
}

try {
  await mkdir(join(root, "data"));
  command(
    "node_modules/emdash/dist/cli/index.mjs",
    "seed",
    "seed/seed.json",
    "--database",
    database,
    "--on-conflict",
    "skip",
    "--uploads-dir",
    join(root, "uploads"),
  );
  command("scripts/migrate-weeknotes.mjs", database);
  command("scripts/migrate-bluesky-announcements.mjs", database);

  const primary = await start(false);
  assert.equal((await fetch(`${primary.origin}/weeknotes`)).status, 200);
  await stop(primary.child);
  assert.doesNotMatch(
    primary.logs,
    /runtime init failed|middleware error|SQLITE_READONLY|disk I\/O/i,
  );

  const db = new DatabaseSync(database);
  // Leave stale redirect artifacts and overdue scheduled work: replicas must not
  // repair artifacts, record redirect/404 telemetry, or run maintenance timers.
  db.prepare(
    "INSERT INTO _emdash_redirects (id, source, destination, type) VALUES (?, ?, ?, 301)",
  ).run("replica-redirect", "/old-replica-test", "/weeknotes");
  const note = db
    .prepare(
      "SELECT id, slug FROM ec_weeknotes WHERE status = 'published' ORDER BY slug DESC LIMIT 1",
    )
    .get();
  const post = db
    .prepare("SELECT slug FROM ec_posts WHERE status = 'published' LIMIT 1")
    .get();
  const scheduled = db
    .prepare(
      "SELECT id FROM ec_weeknotes WHERE id <> ? AND status = 'published' LIMIT 1",
    )
    .get(note.id);
  db.prepare(
    "UPDATE ec_weeknotes SET status = 'scheduled', scheduled_at = ? WHERE id = ?",
  ).run("2000-01-01T00:00:00.000Z", scheduled.id);
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
  const before = await digest();
  const replica = await start(true);
  const cases = [
    ["/", 200],
    ["/posts", 200],
    ["/weeknotes", 200],
    ["/about", 200],
    [`/posts/${post.slug}`, 200],
    [`/weeknotes/${note.slug}`, 200],
    ["/posts/rss.xml", 200],
    ["/weeknotes/rss.xml", 200],
    ["/sitemap.xml", 200],
    [`/og/weeknotes/${note.slug}.png`, 200],
    ["/definitely-missing-replica-test", 404],
    ["/old-replica-test", 301],
  ];
  for (const [path, status] of cases) {
    const res = await fetch(`${replica.origin}${path}`, { redirect: "manual" });
    assert.equal(res.status, status, `${path}: ${await res.text()}`);
  }
  for (const [path, options] of [
    ["/_emdash/admin/", {}],
    ["/_emdash/api/auth/atproto/callback?code=fixture", {}],
    ["/", { headers: { cookie: "astro-session=fixture" } }],
    ["/weeknotes", { method: "POST" }],
    [`/weeknotes/${note.slug}?_preview=fixture`, {}],
  ]) {
    const res = await fetch(`${replica.origin}${path}`, {
      ...options,
      redirect: "manual",
    });
    assert.equal(
      res.headers.get("fly-replay"),
      "instance=fixture-primary",
      path,
    );
  }
  // Longer than the normal 60-second maintenance heartbeat; this is deliberately
  // not a unit-test fake timer, so a mistakenly started Node scheduler is caught.
  await delay(65_000);
  assert.equal(await digest(), before, "replica changed the database or WAL");
  assert.doesNotMatch(
    replica.logs,
    /read.?only|disk I\/O|Failed to|runtime init failed|middleware error/i,
  );
  const check = new DatabaseSync(database, { readOnly: true });
  assert.equal(
    check
      .prepare("SELECT status FROM ec_weeknotes WHERE id = ?")
      .get(scheduled.id).status,
    "scheduled",
  );
  assert.equal(
    check
      .prepare(
        "SELECT hits FROM _emdash_redirects WHERE id = 'replica-redirect'",
      )
      .get().hits,
    0,
  );
  check.close();
  console.log(
    `PASS: ${cases.length} public routes; 5 primary replays; unchanged database/WAL and pending scheduled entry after 65 seconds on enforced read-only replica.`,
  );
} finally {
  for (const child of children.reverse()) await stop(child);
  await rm(root, { recursive: true, force: true });
}
