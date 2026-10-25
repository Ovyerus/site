import { describe, expect, test } from "vitest";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  executablePath,
  flyRole,
  litefsConfig,
  requireLitefsMount,
} from "../scripts/start-fly.mjs";
import { prepare } from "../scripts/prepare-database.mjs";

const primary = {
  FLY_MACHINE_ID: "abc123",
  PRIMARY_MACHINE_ID: "abc123",
  FLY_APP_NAME: "site-test",
  EMDASH_READ_ONLY: "false",
  EMDASH_DATABASE_URL: "file:/litefs/emdash.db",
};
const fingerprint = "a".repeat(64);
const mounted = () => ({ type: 0x65735546 });

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "site-fly-test-"));
  const path = join(dir, "emdash.db");
  const db = new DatabaseSync(path);
  db.exec(
    "CREATE TABLE _emdash_collections (id INTEGER PRIMARY KEY, slug TEXT)",
  );
  db.close();
  const calls: string[][] = [];
  const execute = (_node: string, args: string[]) => {
    calls.push(args);
    if (args.includes("--status"))
      return {
        status: 0,
        stdout: JSON.stringify({
          target: { kind: "sqlite", fingerprint },
          unknownApplied: [],
        }),
      };
    if (args.includes("--expected-target-fingerprint"))
      return {
        status: 0,
        stdout: JSON.stringify({ pending: [], unknownApplied: [] }),
      };
    if (args.includes("seed")) {
      const database = new DatabaseSync(path);
      for (const slug of ["posts", "weeknotes", "pages", "home"])
        database
          .prepare("INSERT INTO _emdash_collections (slug) VALUES (?)")
          .run(slug);
      database.close();
    }
    return { status: 0, stdout: "" };
  };
  return {
    path,
    calls,
    execute,
    close: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe("fixed Fly primary startup", () => {
  test("resolves executable PATH and rejects invalid candidates before exec", () => {
    const root = mkdtempSync(join(tmpdir(), "site-exec-test-"));
    try {
      mkdirSync(join(root, "first", "tool"), { recursive: true });
      mkdirSync(join(root, "second"));
      const tool = join(root, "second", "tool");
      writeFileSync(tool, "#!/bin/sh\nexit 0\n");
      chmodSync(tool, 0o755);
      expect(executablePath("tool", { PATH: "first:second" }, root)).toBe(tool);
      expect(executablePath("second/tool", {}, root)).toBe(tool);
      chmodSync(tool, 0o644);
      expect(() => executablePath("tool", { PATH: "second" }, root)).toThrow(
        "not executable",
      );
      expect(() => executablePath("missing", { PATH: "" }, root)).toThrow(
        "not executable",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("replaces rather than supervises the server and retains its environment", () => {
    const module = new URL("../scripts/start-fly.mjs", import.meta.url).href;
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import { replaceProcess } from ${JSON.stringify(module)};
      console.log(process.pid);
      replaceProcess(process.execPath, ['-e', 'console.log(process.pid, process.env.EXEC_FIXTURE)'], { EXEC_FIXTURE: 'retained' });
    `,
      ],
      { encoding: "utf8", timeout: 10_000 },
    );
    expect(result.status, result.stderr).toBe(0);
    const [before, after] = result.stdout.trim().split("\n");
    expect(after).toBe(`${before} retained`);
  });

  test("requires explicit fixed machine ID and cannot elect a replica", () => {
    expect(() => flyRole({ ...primary, PRIMARY_MACHINE_ID: "" })).toThrow(
      "PRIMARY_MACHINE_ID",
    );
    const replica = flyRole({ ...primary, FLY_MACHINE_ID: "replica2" });
    const config = litefsConfig(replica);
    expect(config).toContain("candidate: false");
    expect(config).toContain("hostname: 'abc123'");
    expect(config).toContain(
      "advertise-url: 'http://abc123.vm.site-test.internal:20202'",
    );
    expect(config).toContain("addr: '[::]:20202'");
    expect(config).toContain("target: '127.0.0.1:8081'");
    expect(config).toContain("max-lag: 10s");
    expect(config).toContain("always-forward: ['/_emdash', '/_emdash/*']");
    expect(litefsConfig(flyRole(primary))).toContain("candidate: true");
    expect(() => requireLitefsMount(() => ({ type: 0xef53 }))).toThrow(
      "not a FUSE mount",
    );
  });

  test("direct prepare refuses an unmounted local database before migration", () => {
    const f = fixture();
    try {
      expect(() =>
        prepare(primary, false, f.execute, f.path, () => ({ type: 0xef53 })),
      ).toThrow("not a FUSE mount");
      expect(f.calls).toHaveLength(0);
    } finally {
      f.close();
    }
  });

  test("replicas cannot migrate or bootstrap", () => {
    const f = fixture();
    try {
      expect(() =>
        prepare(
          { ...primary, FLY_MACHINE_ID: "replica2", EMDASH_READ_ONLY: "true" },
          true,
          f.execute,
          f.path,
          mounted,
        ),
      ).toThrow("fixed writable primary");
      expect(f.calls).toHaveLength(0);
    } finally {
      f.close();
    }
  });

  test("empty database refuses app startup and requires explicit bootstrap", () => {
    const f = fixture();
    try {
      expect(() => prepare(primary, false, f.execute, f.path, mounted)).toThrow(
        "Unbootstrapped database",
      );
      expect(f.calls.some((args) => args.includes("seed"))).toBe(false);
      prepare(primary, true, f.execute, f.path, mounted);
      expect(f.calls.filter((args) => args.includes("seed"))).toHaveLength(1);
      expect(
        f.calls.some(
          (args) =>
            args.includes("--expected-target-fingerprint") &&
            args.includes(fingerprint),
        ),
      ).toBe(true);
      prepare(primary, true, f.execute, f.path, mounted);
      expect(f.calls.filter((args) => args.includes("seed"))).toHaveLength(1);
      const db = new DatabaseSync(f.path);
      db.exec("INSERT INTO _emdash_collections (slug) VALUES ('additional')");
      db.close();
      prepare(primary, true, f.execute, f.path, mounted);
      expect(f.calls.filter((args) => args.includes("seed"))).toHaveLength(1);
    } finally {
      f.close();
    }
  });

  test("partial schema cannot be reseeded; migration failures prevent boot", () => {
    const f = fixture();
    try {
      const db = new DatabaseSync(f.path);
      db.exec("INSERT INTO _emdash_collections (slug) VALUES ('posts')");
      db.close();
      expect(() => prepare(primary, true, f.execute, f.path, mounted)).toThrow(
        "Unbootstrapped database",
      );
      expect(f.calls.some((args) => args.includes("seed"))).toBe(false);
      expect(() =>
        prepare(
          primary,
          false,
          () => ({ status: 7, stderr: "migration failed" }),
          f.path,
          mounted,
        ),
      ).toThrow("migration failed");
    } finally {
      f.close();
    }
  });
});
