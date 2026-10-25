import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { statfsSync } from "node:fs";
import { requireLitefsMount } from "./start-fly.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

export function prepare(
  env = process.env,
  bootstrap = process.argv[2] === "--bootstrap",
  execute = spawnSync,
  path = "/litefs/emdash.db",
  statfs = statfsSync,
) {
  if (
    !env.PRIMARY_MACHINE_ID ||
    env.FLY_MACHINE_ID !== env.PRIMARY_MACHINE_ID ||
    env.EMDASH_READ_ONLY !== "false"
  )
    throw new Error("Database preparation requires the fixed writable primary");
  if (env.EMDASH_DATABASE_URL !== "file:/litefs/emdash.db")
    throw new Error(
      "Database preparation requires the mounted LiteFS database",
    );
  requireLitefsMount(statfs);
  const cli = join(root, "node_modules/emdash/dist/cli/index.mjs");
  const command = (args) => {
    const result = execute(process.execPath, [cli, ...args], {
      cwd: root,
      env,
      encoding: "utf8",
    });
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(
        `emdash ${args[0]} failed (${result.status}): ${result.stderr}`,
      );
    return result.stdout;
  };
  const args = [
    "migrate",
    "--manifest",
    join(root, ".emdash/migrations.json"),
    "--database",
    path,
  ];
  const status = JSON.parse(command([...args, "--status", "--json"]));
  if (
    status.target?.kind !== "sqlite" ||
    !/^[a-f0-9]{64}$/.test(status.target.fingerprint) ||
    status.unknownApplied?.length
  )
    throw new Error(
      "Unexpected migration target or unknown applied migrations",
    );
  const migrated = JSON.parse(
    command([
      ...args,
      "--json",
      "--expected-target-fingerprint",
      status.target.fingerprint,
    ]),
  );
  if (migrated.pending?.length || migrated.unknownApplied?.length)
    throw new Error("Migrations are not current");
  // The opt-in flag only seeds a pristine schema. Even if accidentally left set,
  // later boots cannot replay an archive over live content.
  const db = new DatabaseSync(path, { readOnly: true });
  let count;
  try {
    count = db.prepare("SELECT COUNT(*) AS n FROM _emdash_collections").get().n;
  } finally {
    db.close();
  }
  if (bootstrap && count === 0) {
    command([
      "seed",
      join(root, "seed/seed.json"),
      "--database",
      path,
      "--on-conflict",
      "skip",
      "--uploads-dir",
      "/tmp/emdash-bootstrap-uploads",
    ]);
  }
  // A partial/existing schema is never seeded, regardless of the flag.
  const ready = new DatabaseSync(path, { readOnly: true });
  try {
    for (const collection of ["posts", "weeknotes", "pages", "home"]) {
      if (
        !ready
          .prepare("SELECT id FROM _emdash_collections WHERE slug = ?")
          .get(collection)
      )
        throw new Error(
          `Unbootstrapped database: missing ${collection}; start the primary once with --bootstrap`,
        );
    }
  } finally {
    ready.close();
  }
  for (const script of [
    "migrate-weeknotes.mjs",
    "migrate-bluesky-announcements.mjs",
  ]) {
    const result = execute(
      process.execPath,
      [join(root, "scripts", script), path],
      { cwd: root, env, encoding: "utf8" },
    );
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(`${script} failed (${result.status}): ${result.stderr}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (
      process.argv.length > 3 ||
      (process.argv[2] && process.argv[2] !== "--bootstrap")
    )
      throw new Error("Usage: prepare-database.mjs [--bootstrap]");
    prepare();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
