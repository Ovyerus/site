import {
  createReadStream,
  createWriteStream,
  statfsSync,
  constants,
} from "node:fs";
import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  stat,
  statfs,
  readdir,
  lstat,
  writeFile,
} from "node:fs/promises";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip, createGunzip } from "node:zlib";
import { DatabaseSync } from "node:sqlite";

export const BACKUP_PREFIX = "blog/backups/sqlite/v1/";
export const MAX_DATABASE_BYTES = 128 * 1024 * 1024;
export const MAX_ARCHIVE_BYTES = MAX_DATABASE_BYTES + 4 * 1024 * 1024;
export const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = 30 * BACKUP_INTERVAL_MS;
const MAGIC = Buffer.from("OVYDB01\n");
const HEADER_SIZE = MAGIC.length + 32 + 12;
const CONTEXT = "ovyerus/emdash.db/backup/v1";
const ROOT = "/data/backups";
const NAME =
  /^blog\/backups\/sqlite\/v1\/(\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.sqlite\.gz\.enc$/;

export function masterKey(env) {
  const match = /^emdash_enc_v1_([A-Za-z0-9_-]{43})$/.exec(
    env.EMDASH_ENCRYPTION_KEY ?? "",
  );
  if (!match)
    throw new Error("A valid existing EMDASH_ENCRYPTION_KEY is required");
  return Buffer.from(match[1], "base64url");
}

export function privateConfig(env) {
  const required = (key) => {
    if (!env[key]) throw new Error(`${key} is required for private backups`);
    return env[key];
  };
  const bucket = required("PRIVATE_S3_BUCKET");
  if (!env.S3_BUCKET || bucket.toLowerCase() === env.S3_BUCKET.toLowerCase())
    throw new Error("Backup storage must differ from public media storage");
  if (env.PRIVATE_S3_PUBLIC_URL)
    throw new Error("Private backups must not have a public URL");
  const endpoint = new URL(env.PRIVATE_S3_ENDPOINT || required("S3_ENDPOINT"));
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.pathname !== "/" ||
    endpoint.search ||
    endpoint.hash
  )
    throw new Error("Private backup endpoint must be an HTTPS origin");
  return {
    endpoint: endpoint.origin,
    region: env.PRIVATE_S3_REGION || required("S3_REGION"),
    bucket,
    credentials: {
      accessKeyId: required("PRIVATE_S3_ACCESS_KEY_ID"),
      secretAccessKey: required("PRIVATE_S3_SECRET_ACCESS_KEY"),
    },
  };
}

export function archiveDate(key) {
  const match = NAME.exec(key);
  if (!match) return null;
  const iso = match[1].replace(
    /T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z$/,
    "T$1:$2:$3.$4Z",
  );
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) && date.toISOString() === iso
    ? date
    : null;
}

export function archiveKey(date = new Date()) {
  return `${BACKUP_PREFIX}${date.toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.sqlite.gz.enc`;
}

function derive(key, salt, label) {
  return Buffer.from(hkdfSync("sha256", key, salt, `${CONTEXT}/${label}`, 32));
}

export function signedManifest(fields, key) {
  return {
    ...fields,
    mac: createHmac("sha256", derive(key, Buffer.alloc(0), "manifest"))
      .update(JSON.stringify(fields))
      .digest("hex"),
  };
}

export function validManifest(manifest, key, name) {
  if (!manifest || typeof manifest !== "object") return false;
  const { mac, ...fields } = manifest;
  const date = archiveDate(fields.key);
  if (
    !date ||
    name !== `${fields.key}.json` ||
    fields.version !== 1 ||
    fields.database !== "emdash.db" ||
    fields.createdAt !== date.toISOString() ||
    !/^[a-f0-9]{64}$/.test(fields.plaintextSha256) ||
    !/^[a-f0-9]{64}$/.test(fields.encryptedSha256) ||
    !Number.isSafeInteger(fields.plaintextSize) ||
    fields.plaintextSize < 1 ||
    fields.plaintextSize > MAX_DATABASE_BYTES ||
    !Number.isSafeInteger(fields.encryptedSize) ||
    fields.encryptedSize < HEADER_SIZE + 16 ||
    fields.encryptedSize > MAX_ARCHIVE_BYTES ||
    !/^[a-f0-9]{64}$/.test(mac ?? "")
  )
    return false;
  return timingSafeEqual(
    Buffer.from(mac, "hex"),
    Buffer.from(signedManifest(fields, key).mac, "hex"),
  );
}

export function byteLimit(max) {
  let size = 0;
  return new Transform({
    transform(chunk, _encoding, done) {
      size += chunk.length;
      done(
        size > max ? new Error("Backup exceeds its size limit") : null,
        chunk,
      );
    },
  });
}

export async function fileDigest(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function encryptFile(input, output, key, name) {
  if (!archiveDate(name)) throw new Error("Invalid backup archive name");
  const salt = randomBytes(32),
    nonce = randomBytes(12);
  const header = Buffer.concat([MAGIC, salt, nonce]);
  const cipher = createCipheriv(
    "aes-256-gcm",
    derive(key, salt, "archive"),
    nonce,
  );
  cipher.setAAD(Buffer.concat([header, Buffer.from(name)]));
  await writeFile(output, header, { flag: "wx", mode: 0o600 });
  try {
    await pipeline(
      createReadStream(input),
      byteLimit(MAX_DATABASE_BYTES),
      createGzip(),
      cipher,
      createWriteStream(output, { flags: "a", mode: 0o600 }),
    );
    await appendFile(output, cipher.getAuthTag());
  } catch (error) {
    await rm(output, { force: true });
    throw error;
  }
}

export async function decryptFile(input, output, key, name) {
  const size = (await stat(input)).size;
  if (!archiveDate(name) || size < HEADER_SIZE + 16 || size > MAX_ARCHIVE_BYTES)
    throw new Error("Invalid encrypted backup");
  const handle = await open(input, "r");
  const header = Buffer.alloc(HEADER_SIZE),
    tag = Buffer.alloc(16);
  try {
    await handle.read(header, 0, header.length, 0);
    await handle.read(tag, 0, tag.length, size - tag.length);
  } finally {
    await handle.close();
  }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC))
    throw new Error("Unknown backup format");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    derive(key, header.subarray(MAGIC.length, MAGIC.length + 32), "archive"),
    header.subarray(MAGIC.length + 32),
  );
  decipher.setAAD(Buffer.concat([header, Buffer.from(name)]));
  decipher.setAuthTag(tag);
  const compressed = `${output}.${randomUUID()}.gz`;
  let createdOutput = false;
  try {
    // GCM can emit unauthenticated bytes. Do not decompress/open them until final() succeeds.
    await pipeline(
      createReadStream(input, { start: HEADER_SIZE, end: size - 17 }),
      decipher,
      createWriteStream(compressed, { flags: "wx", mode: 0o600 }),
    );
    const destination = await open(output, "wx", 0o600);
    createdOutput = true;
    await pipeline(
      createReadStream(compressed),
      createGunzip(),
      byteLimit(MAX_DATABASE_BYTES),
      destination.createWriteStream(),
    );
  } catch (error) {
    if (createdOutput) await rm(output, { force: true });
    throw error;
  } finally {
    await rm(compressed, { force: true });
  }
}

export function inspectDatabase(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const integrity = db.prepare("PRAGMA integrity_check").all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== "ok")
      throw new Error("Restored database failed integrity check");
    if (db.prepare("PRAGMA foreign_key_check").get())
      throw new Error("Restored database has foreign key violations");
    const tables = db
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")
      .all()
      .map((row) => row.name);
    if (
      !["users", "options", "oauth_accounts"].every((table) =>
        tables.includes(table),
      )
    )
      throw new Error("Snapshot is not the production EmDash database");
    return {
      tables: tables.length,
      users: db.prepare("SELECT count(*) AS n FROM users").get().n,
    };
  } finally {
    db.close();
  }
}

export async function createPrivateStore(
  env,
  loadS3 = () => import("@aws-sdk/client-s3"),
  signal = AbortSignal.timeout(20 * 60 * 1000),
) {
  const config = privateConfig(env);
  const sdk = await loadS3();
  const client = new sdk.S3Client({
    ...config,
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const send = (Command, input) =>
    client.send(new Command({ Bucket: config.bucket, ...input }), {
      abortSignal: AbortSignal.any([
        signal,
        AbortSignal.timeout(5 * 60 * 1000),
      ]),
    });
  try {
    const acl = await send(sdk.GetBucketAclCommand, {});
    if (
      !acl.Owner?.ID ||
      !acl.Grants?.length ||
      acl.Grants.some(
        (grant) =>
          grant.Grantee?.ID !== acl.Owner.ID ||
          grant.Permission !== "FULL_CONTROL",
      )
    )
      throw new Error("Backup bucket ACL is not owner-only");
  } catch (error) {
    client.destroy();
    throw error;
  }
  return {
    async list() {
      const keys = [];
      let continuation,
        pages = 0;
      do {
        if (++pages > 8) throw new Error("Backup listing page limit exceeded");
        const response = await send(sdk.ListObjectsV2Command, {
          Prefix: BACKUP_PREFIX,
          MaxKeys: 100,
          ContinuationToken: continuation,
        });
        for (const object of response.Contents ?? [])
          if (object.Key?.startsWith(BACKUP_PREFIX)) keys.push(object.Key);
        if (keys.length > 510)
          throw new Error(
            "Backup namespace needs operator cleanup (object limit)",
          );
        continuation = response.IsTruncated
          ? response.NextContinuationToken
          : undefined;
        if (response.IsTruncated && !continuation)
          throw new Error("Invalid backup listing cursor");
      } while (continuation);
      return keys;
    },
    async putFile(name, path) {
      await send(sdk.PutObjectCommand, {
        Key: name,
        Body: createReadStream(path),
        ContentLength: (await stat(path)).size,
        ContentType: "application/octet-stream",
        CacheControl: "private, no-store",
      });
    },
    async putManifest(name, manifest) {
      await send(sdk.PutObjectCommand, {
        Key: name,
        Body: JSON.stringify(manifest),
        ContentType: "application/json",
        CacheControl: "private, no-store",
      });
    },
    async download(name, path) {
      const response = await send(sdk.GetObjectCommand, { Key: name });
      await pipeline(
        response.Body,
        byteLimit(MAX_ARCHIVE_BYTES),
        createWriteStream(path, { flags: "wx", mode: 0o600 }),
      );
    },
    async readManifest(name) {
      const response = await send(sdk.GetObjectCommand, { Key: name });
      const chunks = [];
      let length = 0;
      for await (const chunk of response.Body) {
        length += chunk.length;
        if (length > 16384) {
          response.Body.destroy();
          throw new Error("Oversize backup manifest");
        }
        chunks.push(chunk);
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    },
    async remove(name) {
      if (
        !archiveDate(name) &&
        !(name.endsWith(".json") && archiveDate(name.slice(0, -5)))
      )
        throw new Error("Refusing deletion outside the backup namespace");
      // B2's unversioned DELETE hides objects. Purge only this exact owned key's
      // versions, oldest first, so 30-day retention also releases stored bytes.
      const versions = [];
      let keyMarker,
        versionMarker,
        pages = 0;
      do {
        if (++pages > 8)
          throw new Error("Backup version listing page limit exceeded");
        const page = await send(sdk.ListObjectVersionsCommand, {
          Prefix: name,
          MaxKeys: 100,
          KeyMarker: keyMarker,
          VersionIdMarker: versionMarker,
        });
        for (const object of [
          ...(page.Versions ?? []),
          ...(page.DeleteMarkers ?? []),
        ]) {
          if (object.Key === name && object.VersionId) versions.push(object);
        }
        if (versions.length > 128)
          throw new Error("Backup version count needs operator cleanup");
        keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
        versionMarker = page.IsTruncated ? page.NextVersionIdMarker : undefined;
        if (page.IsTruncated && !keyMarker)
          throw new Error("Invalid backup version cursor");
      } while (keyMarker);
      versions.sort(
        (a, b) =>
          new Date(a.LastModified).getTime() -
          new Date(b.LastModified).getTime(),
      );
      for (const version of versions)
        await send(sdk.DeleteObjectCommand, {
          Key: name,
          VersionId: version.VersionId,
        });
    },
    close() {
      client.destroy();
    },
  };
}

export async function verifyStoredBackup(
  store,
  manifest,
  key,
  directory,
  onVerified,
) {
  if (!validManifest(manifest, key, `${manifest?.key}.json`))
    throw new Error("Invalid backup manifest authentication");
  const encrypted = join(directory, `${randomUUID()}.enc`),
    restored = join(directory, `${randomUUID()}.sqlite`);
  try {
    await store.download(manifest.key, encrypted);
    if (
      (await stat(encrypted)).size !== manifest.encryptedSize ||
      (await fileDigest(encrypted)) !== manifest.encryptedSha256
    )
      throw new Error("Encrypted backup checksum mismatch");
    await decryptFile(encrypted, restored, key, manifest.key);
    if (
      (await stat(restored)).size !== manifest.plaintextSize ||
      (await fileDigest(restored)) !== manifest.plaintextSha256
    )
      throw new Error("Restored backup checksum mismatch");
    const result = inspectDatabase(restored);
    if (onVerified) await onVerified(restored, manifest);
    return result;
  } finally {
    await rm(encrypted, { force: true });
    await rm(restored, { force: true });
  }
}

export async function pruneBackups(
  store,
  key,
  now,
  keepKey,
  keys,
  scratchRoot = tmpdir(),
) {
  const manifests = [];
  for (const name of keys) {
    if (!name.endsWith(".json") || !archiveDate(name.slice(0, -5))) continue;
    const manifest = await store.readManifest(name);
    if (validManifest(manifest, key, name)) manifests.push(manifest);
  }
  const available = manifests.filter((m) => keys.includes(m.key));
  const keeper = keepKey
    ? available.find((m) => m.key === keepKey)
    : available.sort(
        (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
      )[0];
  if (!keeper) return 0;
  const scratch = await mkdtemp(join(scratchRoot, ".verify-retention-"));
  try {
    await verifyStoredBackup(store, keeper, key, scratch);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  const latest = keeper.key;
  let removed = 0;
  for (const m of manifests) {
    if (
      !keys.includes(m.key) ||
      m.key === keepKey ||
      m.key === latest ||
      Date.parse(m.createdAt) >= now.getTime() - RETENTION_MS
    )
      continue;
    // Delete the signed commit marker last; retrying archive deletion is idempotent.
    await store.remove(m.key);
    await store.remove(`${m.key}.json`);
    removed++;
  }
  // Failed pre-commit uploads have no manifest. Only an explicit authenticated
  // NoSuchKey (not a list/read/network failure) proves absence; keep 30 days of
  // grace and verify a completed keeper before purging these owned orphan keys.
  for (const name of keys) {
    const date = archiveDate(name);
    if (
      !date ||
      name === latest ||
      keys.includes(`${name}.json`) ||
      date.getTime() >= now.getTime() - RETENTION_MS
    )
      continue;
    try {
      await store.readManifest(`${name}.json`);
    } catch (error) {
      if (
        error.name === "NoSuchKey" &&
        error.$metadata?.httpStatusCode === 404
      ) {
        await store.remove(name);
        removed++;
      } else {
        // Unknown errors are not proof of absence. Keep this and remaining orphans.
        break;
      }
    }
  }
  return removed;
}

export async function readBackupState(root = ROOT) {
  try {
    return JSON.parse(await readFile(join(root, "state.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function backupDue(root = ROOT, now = Date.now()) {
  const state = await readBackupState(root);
  const last = Date.parse(state?.lastVerifiedAt ?? "");
  if (state?.version !== 1 || !archiveDate(state?.key)) return true;
  return (
    !Number.isFinite(last) || now < last || now - last >= BACKUP_INTERVAL_MS
  );
}

async function writeState(root, state) {
  const path = join(root, `state-${randomUUID()}.tmp`);
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(state) + "\n");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(path, join(root, "state.json"));
  } finally {
    await rm(path, { force: true });
  }
}

export async function scavengeScratch(root, now) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const directory =
      entry.isDirectory() && /^\.work-[A-Za-z0-9]{6}$/.test(entry.name);
    const file =
      entry.isFile() && /^state-[a-f0-9-]{36}\.tmp$/.test(entry.name);
    if (!directory && !file) continue;
    const path = join(root, entry.name);
    if (now - (await lstat(path)).mtimeMs > 10 * 60 * 1000)
      await rm(path, { recursive: directory, force: true });
  }
}

export async function runBackup({
  env = process.env,
  root = ROOT,
  store: suppliedStore,
  loadS3,
  checkMount = statfsSync,
  exportSnapshot,
  now = () => new Date(),
  onlyIfDue = false,
  onVerified,
  log = console.log,
} = {}) {
  if (
    !env.FLY_MACHINE_ID ||
    env.FLY_MACHINE_ID !== env.PRIMARY_MACHINE_ID ||
    env.EMDASH_READ_ONLY === "true"
  )
    throw new Error("Only the fixed primary may create database backups");
  if (checkMount("/litefs").type !== 0x65735546)
    throw new Error("Database backup requires the real LiteFS mount");
  privateConfig(env);
  const key = masterKey(env);
  await mkdir(root, { recursive: true, mode: 0o700 });
  if (!(await lstat(root)).isDirectory())
    throw new Error("Invalid backup scratch directory");
  await chmod(root, 0o700);
  // Independent coordination DB only: SQLite's OS lock is released on crash/restart.
  const coordPath = join(root, "coordination.sqlite");
  const coordFile = await open(
    coordPath,
    constants.O_CREAT |
      constants.O_APPEND |
      constants.O_WRONLY |
      constants.O_NOFOLLOW,
    0o600,
  );
  await coordFile.close();
  if (!(await lstat(coordPath)).isFile())
    throw new Error("Invalid backup coordination file");
  await chmod(coordPath, 0o600);
  const coordination = new DatabaseSync(coordPath);
  let store,
    directory,
    attemptedArchive,
    manifestMayExist = false,
    locked = false;
  try {
    coordination.exec(
      "PRAGMA busy_timeout = 100; CREATE TABLE IF NOT EXISTS backup_lock (id INTEGER PRIMARY KEY)",
    );
    try {
      coordination.exec("BEGIN IMMEDIATE");
      locked = true;
    } catch (error) {
      if (error.errcode === 5 || error.errcode === 6)
        return { skipped: "busy" };
      throw error;
    }
    await scavengeScratch(root, now().getTime());
    if (onlyIfDue && !(await backupDue(root, now().getTime())))
      return { skipped: "not-due" };
    store = suppliedStore ?? (await createPrivateStore(env, loadS3));
    const existing = await store.list();
    if (existing.length > 510)
      throw new Error("Backup namespace object limit reached");
    const space = await statfs(root);
    if (space.bavail * space.bsize < 5 * MAX_ARCHIVE_BYTES + 32 * 1024 * 1024)
      throw new Error("Insufficient backup scratch disk space");
    directory = await mkdtemp(join(root, ".work-"));
    await chmod(directory, 0o700);
    const exported = join(directory, "export.sqlite"),
      encrypted = join(directory, "archive.enc");
    const date = now(),
      name = archiveKey(date);
    const response = exportSnapshot
      ? await exportSnapshot()
      : await fetch("http://127.0.0.1:20202/export?name=emdash.db", {
          signal: AbortSignal.timeout(5 * 60 * 1000),
        });
    if (response.status !== 200 || !response.body)
      throw new Error("LiteFS snapshot export failed");
    await pipeline(
      Readable.fromWeb(response.body),
      byteLimit(MAX_DATABASE_BYTES),
      createWriteStream(exported, { flags: "wx", mode: 0o600 }),
    );
    inspectDatabase(exported);
    await encryptFile(exported, encrypted, key, name);
    const manifest = signedManifest(
      {
        version: 1,
        database: "emdash.db",
        key: name,
        createdAt: date.toISOString(),
        plaintextSize: (await stat(exported)).size,
        plaintextSha256: await fileDigest(exported),
        encryptedSize: (await stat(encrypted)).size,
        encryptedSha256: await fileDigest(encrypted),
      },
      key,
    );
    attemptedArchive = name;
    await store.putFile(name, encrypted);
    const inspected = await verifyStoredBackup(
      store,
      manifest,
      key,
      directory,
      onVerified,
    );
    manifestMayExist = true;
    await store.putManifest(`${name}.json`, manifest);
    const committed = await store.readManifest(`${name}.json`);
    if (
      !validManifest(committed, key, `${name}.json`) ||
      committed.mac !== manifest.mac
    )
      throw new Error("Backup commit readback failed");
    await writeState(root, {
      version: 1,
      key: name,
      lastVerifiedAt: now().toISOString(),
    });
    log(
      JSON.stringify({
        event: "backup-verified",
        key: name,
        bytes: manifest.encryptedSize,
        ...inspected,
      }),
    );
    let removed = 0,
      retentionFailed = false;
    try {
      removed = await pruneBackups(
        store,
        key,
        now(),
        name,
        [...existing, name, `${name}.json`],
        directory,
      );
    } catch {
      retentionFailed = true;
      log(JSON.stringify({ event: "backup-retention-failed", key: name }));
    }
    return { manifest, inspected, removed, retentionFailed };
  } catch (error) {
    if (attemptedArchive && !manifestMayExist) {
      try {
        await store.remove(attemptedArchive);
      } catch {
        log(
          JSON.stringify({
            event: "backup-orphan-cleanup-failed",
            key: attemptedArchive,
          }),
        );
      }
    }
    throw error;
  } finally {
    try {
      if (directory) await rm(directory, { recursive: true, force: true });
    } finally {
      if (!suppliedStore) store?.close();
      if (locked) coordination.exec("ROLLBACK");
      coordination.close();
    }
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.length !== 2)
    throw new Error(
      "Usage: node scripts/backup-database.mjs (fixed primary only)",
    );
  try {
    await runBackup();
  } catch (error) {
    console.error(
      JSON.stringify({ event: "backup-failed", error: error.name }),
    );
    process.exitCode = 1;
  }
}
