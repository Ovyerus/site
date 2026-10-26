import { randomBytes } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import {
  archiveDate,
  archiveKey,
  backupDue,
  byteLimit,
  createPrivateStore,
  decryptFile,
  encryptFile,
  fileDigest,
  inspectDatabase,
  masterKey,
  privateConfig,
  pruneBackups,
  readBackupState,
  runBackup,
  signedManifest,
  validManifest,
} from "../scripts/backup-database.mjs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const folders: string[] = [];
const date = new Date("2026-10-25T12:00:00.000Z");
const env = {
  EMDASH_ENCRYPTION_KEY: `emdash_enc_v1_${Buffer.alloc(32, 17).toString("base64url")}`,
  FLY_MACHINE_ID: "fixture-primary",
  PRIMARY_MACHINE_ID: "fixture-primary",
  EMDASH_READ_ONLY: "false",
  S3_BUCKET: "public-fixture",
  S3_ENDPOINT: "https://s3.example.invalid",
  S3_REGION: "fixture-region",
  PRIVATE_S3_BUCKET: "private-fixture",
  PRIVATE_S3_ACCESS_KEY_ID: "private-key",
  PRIVATE_S3_SECRET_ACCESS_KEY: "private-secret",
};
function folder() {
  const root = mkdtempSync(join(tmpdir(), "backup-test-"));
  folders.push(root);
  return root;
}
afterEach(() => {
  for (const root of folders.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function snapshot(root: string, invalidFk = false) {
  const path = join(root, `snapshot-${randomBytes(4).toString("hex")}.sqlite`);
  const db = new DatabaseSync(path);
  try {
    db.exec(
      "CREATE TABLE options (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE users (id INTEGER PRIMARY KEY); CREATE TABLE oauth_accounts (user_id INTEGER REFERENCES users(id)); INSERT INTO users VALUES (1); INSERT INTO options VALUES ('site', 'fixture');",
    );
    if (invalidFk)
      db.exec(
        "PRAGMA foreign_keys=OFF; INSERT INTO oauth_accounts VALUES (404)",
      );
  } finally {
    db.close();
  }
  return readFileSync(path);
}
class Store {
  objects = new Map<string, Buffer | object>();
  events: string[] = [];
  fail: string | null = null;
  async list() {
    this.events.push("list");
    return [...this.objects.keys()];
  }
  async putFile(name: string, path: string) {
    this.events.push("putFile");
    if (this.fail === "putFile") throw Error("fixture failure");
    this.objects.set(name, readFileSync(path));
  }
  async putManifest(name: string, value: object) {
    this.events.push("putManifest");
    if (this.fail === "putManifest") throw Error("fixture failure");
    this.objects.set(name, structuredClone(value));
  }
  async download(name: string, path: string) {
    this.events.push("download");
    if (this.fail === "download") throw Error("fixture failure");
    const value = this.objects.get(name);
    if (!Buffer.isBuffer(value)) throw Error("missing archive");
    writeFileSync(path, value);
  }
  async readManifest(name: string) {
    this.events.push("readManifest");
    if (this.fail === "readManifest") throw Error("fixture failure");
    const value = this.objects.get(name);
    if (!value || Buffer.isBuffer(value)) throw Error("missing manifest");
    return structuredClone(value);
  }
  async remove(name: string) {
    this.events.push(`remove:${name}`);
    if (this.fail === "remove-archive" && !name.endsWith(".json"))
      throw Error("fixture failure");
    this.objects.delete(name);
  }
}
function options(
  root: string,
  store: Store,
  bytes: Buffer,
  extra: Record<string, unknown> = {},
) {
  return {
    root: join(root, "scratch"),
    env,
    store,
    now: () => date,
    checkMount: () => ({ type: 0x65735546 }),
    exportSnapshot: async () => new Response(bytes),
    log: () => {},
    ...extra,
  };
}
async function realBackup(store: Store, root: string, name: string) {
  const plain = join(root, `plain-${randomBytes(4).toString("hex")}.sqlite`);
  const encrypted = join(
    root,
    `encrypted-${randomBytes(4).toString("hex")}.enc`,
  );
  const bytes = snapshot(root);
  writeFileSync(plain, bytes);
  await encryptFile(plain, encrypted, masterKey(env), name);
  const archive = readFileSync(encrypted);
  store.objects.set(name, archive);
  store.objects.set(
    `${name}.json`,
    signedManifest(
      {
        version: 1,
        database: "emdash.db",
        key: name,
        createdAt: archiveDate(name)!.toISOString(),
        plaintextSize: bytes.length,
        plaintextSha256: await fileDigest(plain),
        encryptedSize: archive.length,
        encryptedSha256: await fileDigest(encrypted),
      },
      masterKey(env),
    ),
  );
  return archive;
}
function manifest(name: string) {
  return signedManifest(
    {
      version: 1,
      database: "emdash.db",
      key: name,
      createdAt: archiveDate(name)!.toISOString(),
      plaintextSize: 100,
      plaintextSha256: "a".repeat(64),
      encryptedSize: 100,
      encryptedSha256: "b".repeat(64),
    },
    masterKey(env),
  );
}

describe("private SQLite backup", () => {
  test("requires independent private credentials, private origin, fixed primary, and LiteFS", async () => {
    for (const change of [
      { PRIVATE_S3_BUCKET: "PUBLIC-FIXTURE" },
      { PRIVATE_S3_ACCESS_KEY_ID: "" },
      { PRIVATE_S3_PUBLIC_URL: "https://cdn.example.invalid" },
      { PRIVATE_S3_ENDPOINT: "http://s3.example.invalid" },
      { PRIVATE_S3_ENDPOINT: "https://s3.example.invalid/other" },
    ]) {
      expect(() => privateConfig({ ...env, ...change })).toThrow();
    }
    expect(privateConfig(env)).toMatchObject({
      bucket: "private-fixture",
      endpoint: env.S3_ENDPOINT,
      credentials: { accessKeyId: "private-key" },
    });
    expect(() => masterKey({ EMDASH_ENCRYPTION_KEY: "invalid" })).toThrow();
    const root = folder(),
      store = new Store(),
      bytes = snapshot(root);
    await expect(
      runBackup(
        options(root, store, bytes, {
          env: { ...env, FLY_MACHINE_ID: "replica" },
        }),
      ),
    ).rejects.toThrow(/primary/);
    await expect(
      runBackup(
        options(root, store, bytes, { checkMount: () => ({ type: 0 }) }),
      ),
    ).rejects.toThrow(/LiteFS/);
    expect(store.events).toEqual([]);
  });

  test("streams encrypted roundtrip and rejects altered header, ciphertext, tag, name, or key without opening plaintext", async () => {
    const root = folder(),
      source = join(root, "source.sqlite"),
      encrypted = join(root, "archive.enc"),
      output = join(root, "restored.sqlite");
    const bytes = snapshot(root);
    writeFileSync(source, bytes);
    const name = archiveKey(date),
      key = masterKey(env);
    await encryptFile(source, encrypted, key, name);
    expect(readFileSync(encrypted).includes(bytes.subarray(0, 24))).toBe(false);
    await decryptFile(encrypted, output, key, name);
    expect(readFileSync(output)).toEqual(bytes);
    rmSync(output);
    const original = readFileSync(encrypted);
    for (const position of [0, 8, 45, original.length - 1]) {
      const damaged = Buffer.from(original);
      damaged[position] ^= 1;
      writeFileSync(encrypted, damaged);
      await expect(decryptFile(encrypted, output, key, name)).rejects.toThrow();
      expect(
        readdirSync(root).some((entry) => entry.startsWith("restored.sqlite")),
      ).toBe(false);
    }
    writeFileSync(encrypted, original);
    await expect(
      decryptFile(encrypted, output, Buffer.alloc(32, 5), name),
    ).rejects.toThrow();
    await expect(
      decryptFile(encrypted, output, key, archiveKey(date)),
    ).rejects.toThrow();
    expect(
      readdirSync(root).some((entry) => entry.startsWith("restored.sqlite")),
    ).toBe(false);
    writeFileSync(output, "existing restored output must remain untouched");
    await expect(decryptFile(encrypted, output, key, name)).rejects.toThrow();
    expect(readFileSync(output, "utf8")).toBe(
      "existing restored output must remain untouched",
    );
    expect(
      readdirSync(root).some(
        (entry) =>
          entry.startsWith("restored.sqlite.") && entry.endsWith(".gz"),
      ),
    ).toBe(false);
    expect(await fileDigest(encrypted)).toMatch(/^[a-f0-9]{64}$/);
    await expect(
      pipeline(
        Readable.from([Buffer.alloc(3), Buffer.alloc(3)]),
        byteLimit(5),
        async function* (source) {
          for await (const chunk of source) yield chunk;
        },
      ),
    ).rejects.toThrow(/size limit/);
  });

  test("authenticates manifest identity, timestamp, sizes and hashes; rejects invalid calendar dates", () => {
    const name = archiveKey(date),
      key = masterKey(env),
      signed = manifest(name);
    expect(validManifest(signed, key, `${name}.json`)).toBe(true);
    for (const change of [
      { plaintextSha256: "0".repeat(64) },
      { createdAt: "2026-10-26T12:00:00.000Z" },
      { plaintextSize: 0 },
      { encryptedSize: 0 },
      { mac: "0".repeat(64) },
    ]) {
      expect(validManifest({ ...signed, ...change }, key, `${name}.json`)).toBe(
        false,
      );
    }
    expect(validManifest(signed, key, `${archiveKey(date)}.json`)).toBe(false);
    expect(validManifest(signed, Buffer.alloc(32, 0), `${name}.json`)).toBe(
      false,
    );
    expect(archiveDate(name.replace("10-25", "02-30"))).toBeNull();
  });

  test("uploads, verifies remote archive and SQLite before committing manifest/state, then skips until due", async () => {
    const root = folder(),
      store = new Store(),
      bytes = snapshot(root);
    const result = await runBackup(
      options(root, store, bytes, {
        onlyIfDue: true,
        onVerified: (path: string) => {
          expect(readFileSync(path)).toEqual(bytes);
          expect(store.events).not.toContain("putManifest");
        },
      }),
    );
    expect(result.inspected).toMatchObject({ users: 1 });
    expect(store.events.slice(0, 5)).toEqual([
      "list",
      "putFile",
      "download",
      "putManifest",
      "readManifest",
    ]);
    expect(
      validManifest(
        result.manifest,
        masterKey(env),
        `${result.manifest.key}.json`,
      ),
    ).toBe(true);
    expect(await readBackupState(join(root, "scratch"))).toMatchObject({
      key: result.manifest.key,
      lastVerifiedAt: date.toISOString(),
    });
    expect(await backupDue(join(root, "scratch"), date.getTime())).toBe(false);
    expect(
      await runBackup(options(root, store, bytes, { onlyIfDue: true })),
    ).toEqual({ skipped: "not-due" });
    expect(store.objects.size).toBe(2);
    expect(
      readdirSync(join(root, "scratch")).filter((entry) =>
        entry.startsWith(".work-"),
      ),
    ).toEqual([]);
  });

  test.each([
    "export",
    "invalid-fk",
    "putFile",
    "download",
    "putManifest",
    "readManifest",
  ])("failure at %s never prunes or records success", async (step) => {
    const root = folder(),
      store = new Store(),
      bytes = snapshot(root, step === "invalid-fk");
    if (!["export", "invalid-fk"].includes(step)) store.fail = step;
    const old = archiveKey(new Date("2026-08-01T00:00:00.000Z"));
    store.objects.set(old, Buffer.from("old"));
    store.objects.set(`${old}.json`, manifest(old));
    const opt = options(
      root,
      store,
      bytes,
      step === "export"
        ? { exportSnapshot: async () => new Response("oops", { status: 500 }) }
        : {},
    );
    await expect(runBackup(opt)).rejects.toThrow();
    expect(await readBackupState(join(root, "scratch"))).toBeNull();
    const removals = store.events.filter((entry) =>
      entry.startsWith("remove:"),
    );
    expect(
      removals.every(
        (entry) => entry !== `remove:${old}` && entry !== `remove:${old}.json`,
      ),
    ).toBe(true);
    expect(removals).toHaveLength(
      ["putFile", "download"].includes(step) ? 1 : 0,
    );
    expect(store.objects.has(old)).toBe(true);
    expect(
      readdirSync(join(root, "scratch")).filter((entry) =>
        entry.startsWith(".work-"),
      ),
    ).toEqual([]);
  });

  test("invalid or malformed local state is due rather than suppressing backups", async () => {
    const root = folder(),
      state = join(root, "state.json"),
      name = archiveKey(date);
    expect(await backupDue(root, date.getTime())).toBe(true);
    for (const value of [
      "{broken",
      JSON.stringify({
        version: 2,
        key: name,
        lastVerifiedAt: date.toISOString(),
      }),
      JSON.stringify({
        version: 1,
        key: "other-key",
        lastVerifiedAt: date.toISOString(),
      }),
    ]) {
      writeFileSync(state, value);
      expect(await backupDue(root, date.getTime())).toBe(true);
    }
  });

  test("private SDK adapter refuses non-owner ACL and deletes only exact-key versions", async () => {
    const calls: { type: string; input: Record<string, unknown> }[] = [];
    let destroyed = 0;
    let publicGrant = true;
    const command = (type: string) =>
      class {
        type = type;
        constructor(public input: Record<string, unknown>) {}
      };
    const fakeSdk = {
      GetBucketAclCommand: command("acl"),
      ListObjectVersionsCommand: command("versions"),
      DeleteObjectCommand: command("delete"),
      S3Client: class {
        constructor(public config: Record<string, unknown>) {
          expect(config).toMatchObject({
            bucket: "private-fixture",
            credentials: {
              accessKeyId: "private-key",
              secretAccessKey: "private-secret",
            },
            forcePathStyle: true,
          });
          expect(JSON.stringify(config)).not.toContain("public-fixture");
        }
        async send(command: { type: string; input: Record<string, unknown> }) {
          calls.push({ type: command.type, input: command.input });
          if (command.type === "acl")
            return {
              Owner: { ID: "owner" },
              Grants: [
                { Grantee: { ID: "owner" }, Permission: "FULL_CONTROL" },
                ...(publicGrant
                  ? [{ Grantee: { URI: "all-users" }, Permission: "READ" }]
                  : []),
              ],
            };
          if (command.type === "versions")
            return {
              Versions: [
                {
                  Key: command.input.Prefix,
                  VersionId: "v1",
                  LastModified: date,
                },
                {
                  Key: `${command.input.Prefix}neighbor`,
                  VersionId: "foreign",
                  LastModified: date,
                },
              ],
              DeleteMarkers: [
                {
                  Key: command.input.Prefix,
                  VersionId: "marker",
                  LastModified: date,
                },
              ],
            };
          return {};
        }
        destroy() {
          destroyed++;
        }
      },
    };
    await expect(createPrivateStore(env, async () => fakeSdk)).rejects.toThrow(
      /owner-only/,
    );
    expect(destroyed).toBe(1);
    expect(calls.map((call) => call.type)).toEqual(["acl"]);
    publicGrant = false;
    const store = await createPrivateStore(env, async () => fakeSdk);
    const name = archiveKey(date);
    await expect(store.remove("blog/backups/not-owned")).rejects.toThrow(
      /namespace/,
    );
    await store.remove(name);
    const deletes = calls.filter((call) => call.type === "delete");
    expect(
      deletes.map((call) => [call.input.Key, call.input.VersionId]),
    ).toEqual([
      [name, "v1"],
      [name, "marker"],
    ]);
    expect(calls.filter((call) => call.type === "versions")).toHaveLength(1);
    expect(
      calls.filter((call) => call.type === "versions")[0].input,
    ).toMatchObject({ Bucket: "private-fixture", Prefix: name });
    store.close();
    expect(destroyed).toBe(2);
  });

  test("post-commit retention error preserves the new verified backup and state", async () => {
    const root = folder(),
      store = new Store(),
      bytes = snapshot(root),
      logs: string[] = [];
    const old = archiveKey(new Date("2026-08-01T00:00:00.000Z"));
    store.objects.set(old, Buffer.from("old archive"));
    store.objects.set(`${old}.json`, manifest(old));
    store.fail = "remove-archive";
    const result = await runBackup(
      options(root, store, bytes, {
        log: (message: string) => logs.push(message),
      }),
    );
    expect(result.retentionFailed).toBe(true);
    expect(store.objects.has(result.manifest.key)).toBe(true);
    expect(store.objects.has(`${result.manifest.key}.json`)).toBe(true);
    expect(store.objects.has(`${old}.json`)).toBe(true);
    expect(await readBackupState(join(root, "scratch"))).toMatchObject({
      key: result.manifest.key,
    });
    expect(logs.map((line) => JSON.parse(line).event)).toEqual([
      "backup-verified",
      "backup-retention-failed",
    ]);
  });

  test("SQLite lock makes concurrent attempts skip busy while first snapshot waits", async () => {
    const root = folder(),
      store = new Store(),
      bytes = snapshot(root);
    let release!: (value: Response) => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const first = runBackup(
      options(root, store, bytes, {
        exportSnapshot: () => {
          entered();
          return new Promise<Response>((resolve) => {
            release = resolve;
          });
        },
      }),
    );
    await started;
    expect(await runBackup(options(root, store, bytes))).toEqual({
      skipped: "busy",
    });
    release(new Response(bytes));
    await first;
    expect(store.objects.size).toBe(2);
  });

  test("only explicit NoSuchKey 404 permits aged orphan archive purge", async () => {
    const root = folder(),
      keeper = archiveKey(date),
      orphan = archiveKey(new Date("2026-08-01T00:00:00.000Z"));
    class OrphanStore extends Store {
      explicitMissing = false;
      async readManifest(name: string) {
        if (name === `${orphan}.json`) {
          if (this.explicitMissing) {
            const error = Object.assign(new Error("missing"), {
              name: "NoSuchKey",
              $metadata: { httpStatusCode: 404 },
            });
            throw error;
          }
          throw new Error("ambiguous manifest read failure");
        }
        return super.readManifest(name);
      }
    }
    const store = new OrphanStore();
    await realBackup(store, root, keeper);
    store.objects.set(orphan, Buffer.from("old uncommitted archive"));
    expect(
      await pruneBackups(
        store,
        masterKey(env),
        date,
        keeper,
        await store.list(),
        root,
      ),
    ).toBe(0);
    expect(store.objects.has(orphan)).toBe(true);
    expect(store.events).not.toContain(`remove:${orphan}`);
    store.explicitMissing = true;
    expect(
      await pruneBackups(
        store,
        masterKey(env),
        date,
        keeper,
        await store.list(),
        root,
      ),
    ).toBe(1);
    expect(store.objects.has(orphan)).toBe(false);
    expect(store.objects.has(keeper)).toBe(true);
    expect(store.objects.has(`${keeper}.json`)).toBe(true);
  });

  test("retention deletes only expired authenticated pairs; preserves latest, new, foreign, orphan and tampered entries", async () => {
    const store = new Store(),
      key = masterKey(env),
      now = date,
      root = folder();
    const old = archiveKey(new Date("2026-08-01T00:00:00.000Z"));
    const latest = archiveKey(new Date("2026-09-01T00:00:00.000Z"));
    const recent = archiveKey(new Date("2026-10-24T00:00:00.000Z"));
    const tampered = archiveKey(new Date("2026-08-02T00:00:00.000Z"));
    const future = archiveKey(new Date("2026-11-01T00:00:00.000Z"));
    const orphan = archiveKey(new Date("2026-08-03T00:00:00.000Z"));
    for (const name of [old, latest, recent, tampered, future]) {
      store.objects.set(name, Buffer.from("opaque"));
      store.objects.set(
        `${name}.json`,
        name === tampered
          ? { ...manifest(name), plaintextSize: 999 }
          : manifest(name),
      );
    }
    await realBackup(store, root, latest);
    store.objects.set(orphan, Buffer.from("opaque"));
    const manifestOnly = archiveKey(new Date("2026-08-04T00:00:00.000Z"));
    store.objects.set(`${manifestOnly}.json`, manifest(manifestOnly));
    store.objects.set("blog/backups/elsewhere", Buffer.from("foreign"));
    const keys = await store.list();
    expect(await pruneBackups(store, key, now, latest, keys, root)).toBe(1);
    expect(store.objects.has(old)).toBe(false);
    for (const name of [
      latest,
      recent,
      tampered,
      future,
      orphan,
      `${manifestOnly}.json`,
      "blog/backups/elsewhere",
    ])
      expect(store.objects.has(name)).toBe(true);
    const failing = new Store();
    failing.objects.set(old, Buffer.from("opaque"));
    failing.objects.set(`${old}.json`, manifest(old));
    await realBackup(failing, root, latest);
    failing.fail = "remove-archive";
    await expect(
      pruneBackups(failing, key, now, "", await failing.list(), root),
    ).rejects.toThrow();
    expect(failing.objects.has(`${old}.json`)).toBe(true);
    const damaged = new Store();
    damaged.objects.set(old, Buffer.from("opaque"));
    damaged.objects.set(`${old}.json`, manifest(old));
    const archive = await realBackup(damaged, root, latest);
    const corrupt = Buffer.from(archive);
    corrupt[corrupt.length - 1] ^= 1;
    damaged.objects.set(latest, corrupt);
    await expect(
      pruneBackups(damaged, key, now, "", await damaged.list(), root),
    ).rejects.toThrow();
    expect(damaged.events.some((entry) => entry.startsWith("remove:"))).toBe(
      false,
    );
    expect(damaged.objects.has(old)).toBe(true);
  });
});
