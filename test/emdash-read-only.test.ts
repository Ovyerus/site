import { execFileSync } from "node:child_process";
import { describe, expect, test } from "vitest";

// Exercise the shipped dependency in isolated Node processes: EmDash caches DBs
// globally and a machine's role is immutable until restart. Only Astro virtual
// modules are stubbed; SQLite, migrations, runtime, and middleware are real.
const setup = String.raw`
import assert from "node:assert/strict";
import { createRequire, registerHooks } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "virtual:emdash/config") return { url: "data:text/javascript,export default {i18n:{locales:['en-AU']}}", shortCircuit: true };
    if (specifier === "astro:middleware") return { url: "data:text/javascript,export const defineMiddleware = fn => fn", shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    const result = next(url, context);
    // Astro normally replaces this build-time constant in the server bundle.
    if (url.includes("/emdash/dist/") && result.format === "module") {
      return {...result, source: String(result.source).replaceAll("import.meta.env.DEV", "false")};
    }
    return result;
  }
});
const require = createRequire(import.meta.url);
const dist = dirname(require.resolve("emdash"));
const dep = createRequire(join(dist, "index.mjs"));
const { Kysely, sql } = await import(pathToFileURL(dep.resolve("kysely")).href);
const load = path => import(pathToFileURL(join(dist, path)).href);
const { createDialect } = await load("db/sqlite.mjs");
const dir = mkdtempSync(join(tmpdir(), "emdash-replica-"));
const file = join(dir, "cms.db");
const db = new Kysely({ dialect: createDialect({ url: file }) });
try {
`;

function check(body: string) {
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      setup +
        body +
        String.raw`
} finally {
  await db.destroy();
  rmSync(dir, { recursive: true, force: true });
}
console.log("ok");
`,
    ],
    { encoding: "utf8", env: { ...process.env, EMDASH_READ_ONLY: "false" } },
  );
  expect(output.trim().endsWith("ok")).toBe(true);
}

describe("patched EmDash replica runtime", () => {
  test("default and explicit primary remain writable; invalid role fails closed", () => {
    check(String.raw`
const { isReadOnly } = await load("read-only.mjs");
delete process.env.EMDASH_READ_ONLY;
assert.equal(isReadOnly(), false);
process.env.EMDASH_READ_ONLY = "false";
assert.equal(isReadOnly(), false);
await sql.raw("CREATE TABLE primary_write (value TEXT)").execute(db);
process.env.EMDASH_READ_ONLY = "typo";
assert.throws(() => createDialect({url:file}), /must be true or false/);
`);
  });

  test("stale redirect artifacts still serve local rules without repairs, hit counts, or 404 writes", () => {
    check(String.raw`
const { c: migrate } = await load("runner-wqt4BrIW.mjs");
await migrate(db);
await sql.raw("INSERT INTO _emdash_redirects (id, source, destination) VALUES ('probe', '/old', '/new')").execute(db);
const state = (await sql.raw("SELECT * FROM _emdash_redirect_state").execute(db)).rows;
const { onRequest } = await load("astro/middleware/redirect.mjs");
process.env.EMDASH_READ_ONLY = "true";
const ctx = path => ({
  url: new URL("https://example.test" + path),
  request: new Request("https://example.test" + path),
  locals:{emdash:{db}},
  redirect:(dest,status) => new Response(null,{status,headers:{location:dest}}),
});
const changedBefore = (await sql.raw("SELECT total_changes() AS count").execute(db)).rows[0].count;
const redirected = await onRequest(ctx("/old"), () => new Response(null,{status:404}));
assert.equal(redirected.status, 301);
assert.equal(redirected.headers.get("location"), "/new");
assert.equal((await onRequest(ctx("/missing"), () => new Response(null,{status:404}))).status, 404);
const tasks = globalThis[Symbol.for("emdash:deferred-tasks")];
if (tasks) await Promise.all([...tasks]);
assert.equal((await sql.raw("SELECT total_changes() AS count").execute(db)).rows[0].count, changedBefore);
assert.deepEqual((await sql.raw("SELECT * FROM _emdash_redirect_state").execute(db)).rows, state);
assert.equal((await sql.raw("SELECT hits FROM _emdash_redirects WHERE id = 'probe'").execute(db)).rows[0].hits, 0);
assert.equal((await sql.raw("SELECT COUNT(*) AS count FROM _emdash_404_log").execute(db)).rows[0].count, 0);
`);
  });
  test("runtime URL override and SQLite connection reject writes, even if query_only is cleared", () => {
    check(String.raw`
await sql.raw("CREATE TABLE proof (value TEXT)").execute(db);
await sql.raw("INSERT INTO proof VALUES ('primary')").execute(db);
process.env.EMDASH_DATABASE_URL = "file:" + file;
process.env.EMDASH_READ_ONLY = "true";
const replica = new Kysely({ dialect: createDialect({ url: "file:/does-not-exist", urlEnv: "EMDASH_DATABASE_URL" }) });
try {
  assert.equal((await sql.raw("SELECT * FROM proof").execute(replica)).rows[0].value, "primary");
  assert.equal((await sql.raw("PRAGMA query_only").execute(replica)).rows[0].query_only, 1);
  await assert.rejects(sql.raw("INSERT INTO proof VALUES ('replica')").execute(replica), /readonly/i);
  await sql.raw("PRAGMA query_only = OFF").execute(replica);
  await assert.rejects(sql.raw("INSERT INTO proof VALUES ('replica')").execute(replica), /readonly/i);
} finally { await replica.destroy(); }
`);
  });

  test("urlEnv is a name in the manifest, resolves executor env, and CLI override wins", () => {
    check(String.raw`
const { sqlite } = await load("db/index.mjs");
const { createMigrationExecutor } = await load("db/sqlite-migrations.mjs");
const descriptor = sqlite({ url: "file:default.db", urlEnv: "DB_PATH" });
assert.deepEqual(descriptor.migrations.manifestConfig, {url: "file:default.db", urlEnv: "DB_PATH"});
const context = {projectRoot: dir, env: {DB_PATH: "file:runtime.db"}};
const runtime = await createMigrationExecutor(descriptor.migrations.manifestConfig, context);
const override = await createMigrationExecutor(descriptor.migrations.manifestConfig, {...context, overrides:{database:"file:cli.db"}});
assert.notEqual(runtime.target.fingerprint, override.target.fingerprint);
assert.match(runtime.target.label, /runtime.db/);
assert.match(override.target.label, /cli.db/);
await runtime.dispose(); await override.dispose();
`);
  });

  test("replica cold start checks migrations, skips repairs/lifecycle/cron, reads pages and fails closed on writes", () => {
    check(String.raw`
const { c: migrate } = await load("runner-wqt4BrIW.mjs");
await migrate(db);
const before = (await sql.raw("SELECT COUNT(*) AS count FROM options").execute(db)).rows[0].count;
process.env.EMDASH_READ_ONLY = "true";
const { n: EmDashRuntime } = await load("emdash-runtime-C4oFeVpN.mjs");
const { sqlite } = await load("db/index.mjs");
const { C: definePlugin } = await load("menus-DL8IPIcm.mjs");
let lifecycle = 0, schedulers = 0;
const deps = {
 config:{database:sqlite({url:file})}, createDialect, plugins:[definePlugin({
   id:"replica-probe",version:"1.0.0",hooks:{
     "plugin:install":{handler:() => lifecycle++},
     "plugin:activate":{handler:() => lifecycle++},
   }
 })], sandboxEnabled:false, sandboxBypassed:false, sandboxedPluginEntries:[],
 createScheduler:() => {schedulers++; throw new Error("must not construct scheduler");},
};
const runtime = await EmDashRuntime.create(deps);
assert.equal(runtime.cronExecutor, null);
assert.equal(lifecycle, 0);
assert.equal(schedulers, 0);
await runtime.ensureSearchHealthy();
await assert.rejects(runtime.runScheduledTasks(), /read-only/);
const fence = await load("fence-vc3aHgRA.mjs");
await assert.rejects(fence[Object.keys(fence).find(k => fence[k].name === "assertSiteWriteAllowed")](runtime.db), /read-only/);
assert.equal((await sql.raw("SELECT COUNT(*) AS count FROM options").execute(db)).rows[0].count, before);
assert.equal((await sql.raw("SELECT COUNT(*) AS count FROM _plugin_state WHERE plugin_id = 'replica-probe'").execute(db)).rows[0].count, 0);
await runtime.db.destroy();
`);
  });

  test("a replica with pending migrations refuses startup rather than auto-migrating or skipping", () => {
    check(String.raw`
process.env.EMDASH_READ_ONLY = "true";
const { n: EmDashRuntime } = await load("emdash-runtime-C4oFeVpN.mjs");
const { sqlite } = await load("db/index.mjs");
await assert.rejects(EmDashRuntime.create({
 config:{database:sqlite({url:file})},createDialect,plugins:[],
 sandboxEnabled:false,sandboxBypassed:false,sandboxedPluginEntries:[],
}), /pending EmDash migrations/);
assert.equal((await sql.raw("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table'").execute(db)).rows[0].count, 0);
`);
  });
});
