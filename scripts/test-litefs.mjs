import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { statfsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";

// Requires a working /dev/fuse. No Fly credentials, network services, or user data.
const binary = process.argv[2] ?? "litefs";
const root = await mkdtemp(join(tmpdir(), "site-litefs-test-"));
const children = [];
let primaryDb;
let replicaDb;

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  server.close();
  await once(server, "close");
  return port;
}

async function start(name, port, primaryPort, candidate) {
  const mount = join(root, name);
  const data = join(root, `${name}-data`);
  await Promise.all([mkdir(mount), mkdir(data)]);
  const config = join(root, `${name}.yml`);
  await writeFile(
    config,
    `fuse:
  dir: "${mount}"
data:
  dir: "${data}"
http:
  addr: "127.0.0.1:${port}"
lease:
  type: static
  hostname: primary
  candidate: ${candidate}
  advertise-url: "http://127.0.0.1:${primaryPort}"
`,
  );
  const child = spawn(binary, ["mount", "-config", config], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let logs = "";
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`LiteFS ${name} startup timeout: ${logs}`)),
      20_000,
    );
    const finish = (error) => {
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };
    const read = (chunk) => {
      logs = (logs + chunk.toString()).slice(-65_536);
      if (logs.includes("connected to cluster, ready")) finish();
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.once("error", finish);
    child.once("exit", (code) =>
      finish(new Error(`LiteFS ${name} exited (${code}): ${logs}`)),
    );
  });
  return mount;
}

async function waitFor(read, expected) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (read() === expected) return;
    await delay(25);
  }
  assert.equal(read(), expected, "replication did not catch up");
}

try {
  const primaryPort = await freePort();
  const replicaPort = await freePort();
  const primary = await start("primary", primaryPort, primaryPort, true);
  if (process.argv[3]) {
    const { prepare } = await import(
      pathToFileURL(join(process.argv[3], "scripts/prepare-database.mjs")).href
    );
    const env = {
      ...process.env,
      FLY_MACHINE_ID: "fixtureprimary",
      PRIMARY_MACHINE_ID: "fixtureprimary",
      EMDASH_READ_ONLY: "false",
      EMDASH_DATABASE_URL: "file:/litefs/emdash.db",
    };
    // Inject only the temporary mount location; the filesystem check and CLI,
    // seed, migrations, and packaged dependencies are real.
    prepare(env, true, spawnSync, join(primary, "emdash.db"), () =>
      statfsSync(primary),
    );
    const edited = new DatabaseSync(join(primary, "emdash.db"));
    edited.exec(
      "UPDATE ec_home SET tagline = 'Bootstrap must preserve this edit'",
    );
    edited.close();
    prepare(env, true, spawnSync, join(primary, "emdash.db"), () =>
      statfsSync(primary),
    );
    const verified = new DatabaseSync(join(primary, "emdash.db"), {
      readOnly: true,
    });
    assert.equal(
      verified.prepare("SELECT tagline FROM ec_home LIMIT 1").get().tagline,
      "Bootstrap must preserve this edit",
    );
    verified.close();
    console.log(
      "PASS: packaged primary bootstrap/migrations on real FUSE; subsequent boot preserves CMS edits.",
    );
  }
  primaryDb = new DatabaseSync(join(primary, "emdash.db"));
  primaryDb.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE probe (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO probe VALUES (1, 'seeded');",
  );
  const replica = await start("replica", replicaPort, primaryPort, false);
  replicaDb = new DatabaseSync(join(replica, "emdash.db"), { readOnly: true });
  const value = () =>
    replicaDb.prepare("SELECT value FROM probe WHERE id = 1").get().value;
  await waitFor(value, "seeded");
  primaryDb.prepare("UPDATE probe SET value = ? WHERE id = 1").run("published");
  await waitFor(value, "published");
  assert.throws(() => replicaDb.exec("UPDATE probe SET value = 'forbidden'"));
  assert.equal(
    primaryDb.prepare("SELECT value FROM probe WHERE id = 1").get().value,
    "published",
  );
  console.log(
    "PASS: real LiteFS seed replication, subsequent publish replication, and replica write rejection (WAL mode).",
  );
} finally {
  replicaDb?.close();
  primaryDb?.close();
  for (const child of children.reverse()) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    const kill = setTimeout(() => child.kill("SIGKILL"), 5_000);
    await exited;
    clearTimeout(kill);
  }
  await rm(root, { recursive: true, force: true });
}
