import { createHash } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createStorage } from "~lib/emdash-storage";
// Installed EmDash 1.2.0 handlers, not reimplementations; re-audit on upgrade.
import {
  a as deleteBackupArchive,
  l as listBackupArchives,
} from "../node_modules/emdash/dist/backup-CZt5Mzwx.mjs";
import { t as TransferStage } from "../node_modules/emdash/dist/stage-DhzZuYaT.mjs";

beforeEach(() => {
  const env = {
    EMDASH_STORAGE: "s3",
    S3_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
    S3_REGION: "us-west-004",
    S3_BUCKET: "ovy-cdn",
    S3_ACCESS_KEY_ID: "media-fixture-id",
    S3_SECRET_ACCESS_KEY: "media-fixture-secret",
    S3_PUBLIC_URL: "https://cdn.ovy.cloud",
    PRIVATE_S3_BUCKET: "fixture-private",
    PRIVATE_S3_ACCESS_KEY_ID: "private-fixture-id",
    PRIVATE_S3_SECRET_ACCESS_KEY: "private-fixture-secret",
    PRIVATE_S3_ENDPOINT: undefined,
    PRIVATE_S3_REGION: undefined,
    PRIVATE_S3_PUBLIC_URL: undefined,
  };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// Only the SDK's network transport is replaced. Exercise real adapter commands,
// credentials, streaming conversion, and installed backup/transfer consumers.
function transport() {
  const objects = new Map<string, Uint8Array>();
  const calls: {
    bucket: string;
    key?: string;
    prefix?: string;
    cursor?: string;
    limit?: number;
    credential: string;
  }[] = [];
  const address = (bucket: string, key: string) => `${bucket}:${key}`;
  const put = (bucket: string, key: string, value = "fixture") =>
    objects.set(address(bucket, key), new TextEncoder().encode(value));
  const send = vi
    .spyOn(S3Client.prototype, "send")
    .mockImplementation(async function (this: S3Client, command) {
      const input = command.input as {
        Bucket: string;
        Key?: string;
        Prefix?: string;
        ContinuationToken?: string;
        MaxKeys?: number;
      };
      const credential = await (
        this.config.credentials as () => Promise<{ accessKeyId: string }>
      )();
      calls.push({
        bucket: input.Bucket,
        key: input.Key,
        prefix: input.Prefix,
        cursor: input.ContinuationToken,
        limit: input.MaxKeys,
        credential: credential.accessKeyId,
      });
      const key = address(input.Bucket, input.Key ?? "");
      if (command instanceof PutObjectCommand) {
        objects.set(key, new Uint8Array(command.input.Body as Uint8Array));
        return {};
      }
      if (command instanceof DeleteObjectCommand) {
        objects.delete(key);
        return {};
      }
      if (command instanceof HeadObjectCommand) {
        if (!objects.has(key))
          throw Object.assign(new Error("fixture missing"), {
            name: "NotFound",
          });
        return {};
      }
      if (command instanceof GetObjectCommand) {
        const body = objects.get(key);
        if (!body)
          throw Object.assign(new Error("fixture missing"), {
            name: "NoSuchKey",
          });
        return {
          Body: { transformToWebStream: () => new Response(body).body! },
          ContentLength: body.byteLength,
          ContentType: "application/json",
        };
      }
      if (command instanceof ListObjectsV2Command) {
        const start = Number(
          input.ContinuationToken?.slice("offset:".length) ?? 0,
        );
        const keys = [...objects.keys()]
          .filter((key) =>
            key.startsWith(address(input.Bucket, input.Prefix ?? "")),
          )
          .sort();
        const page = keys.slice(start, start + (input.MaxKeys ?? 1000));
        return {
          Contents: page.map((key) => ({
            Key: key.slice(input.Bucket.length + 1),
            Size: objects.get(key)!.byteLength,
            LastModified: new Date(0),
          })),
          NextContinuationToken:
            start + page.length < keys.length
              ? `offset:${start + page.length}`
              : undefined,
        };
      }
      throw new Error("Unexpected SDK command");
    });
  return { objects, calls, put, send, address };
}

describe("public media / private backup and transfer storage", () => {
  test.each([
    "PRIVATE_S3_BUCKET",
    "PRIVATE_S3_ACCESS_KEY_ID",
    "PRIVATE_S3_SECRET_ACCESS_KEY",
  ])("missing %s fails closed, never inherits public configuration", (name) => {
    const send = vi.spyOn(S3Client.prototype, "send");
    vi.stubEnv(name, undefined);
    expect(() => createStorage()).toThrow(name);
    expect(send).not.toHaveBeenCalled();
  });

  test("rejects shared buckets and a private CDN URL", () => {
    vi.stubEnv("PRIVATE_S3_BUCKET", "OVY-CDN");
    expect(() => createStorage()).toThrow("must differ");
    vi.stubEnv("PRIVATE_S3_BUCKET", "fixture-private");
    vi.stubEnv("PRIVATE_S3_PUBLIC_URL", "https://cdn.example.test");
    expect(() => createStorage()).toThrow("must not have a public URL");
  });

  test("Bunny serves only public keys; private objects have neither public nor browser upload URLs", async () => {
    const io = transport();
    const storage = createStorage();
    const media = await storage.upload({
      key: "image.png",
      body: new Uint8Array([1]),
      contentType: "image/png",
    });
    expect(media.url).toBe("https://cdn.ovy.cloud/blog/image.png");
    expect(storage.getPublicUrl("image.png")).toBe(media.url);
    for (const key of [
      "backups/secret.json",
      "transfers/imports/secret/file.json",
      "BACKUPS/secret.json",
    ]) {
      const result = await storage.upload({
        key,
        body: new Uint8Array([2]),
        contentType: "application/json",
      });
      expect(result.url).toBe("");
      expect(() => storage.getPublicUrl(key)).toThrow("Private");
      expect(() =>
        storage.getSignedUploadUrl({ key, contentType: "application/json" }),
      ).toThrow("Private");
    }
    expect(io.calls.map((call) => [call.bucket, call.credential])).toEqual([
      ["ovy-cdn", "media-fixture-id"],
      ["fixture-private", "private-fixture-id"],
      ["fixture-private", "private-fixture-id"],
      ["fixture-private", "private-fixture-id"],
    ]);
  });

  test("private upload/read/exists/delete stays private, including missing objects", async () => {
    const io = transport();
    const storage = createStorage();
    for (const key of [
      "backups/secret.json",
      "transfers/exports/secret/file.json",
    ]) {
      await storage.upload({
        key,
        body: new TextEncoder().encode("private"),
        contentType: "application/json",
      });
      expect(await storage.exists(key)).toBe(true);
      expect(
        await new Response((await storage.download(key)).body).text(),
      ).toBe("private");
      await storage.delete(key);
      // An accidentally present public copy must not be used as fallback.
      io.put("ovy-cdn", `blog/${key}`, "public must not be read");
      expect(await storage.exists(key)).toBe(false);
      await expect(storage.download(key)).rejects.toThrow("File not found");
    }
    expect(
      io.calls.every(
        (call) =>
          call.bucket === "fixture-private" &&
          call.credential === "private-fixture-id",
      ),
    ).toBe(true);
  });

  test("private endpoint/region overrides are separate from the public client", async () => {
    vi.stubEnv(
      "PRIVATE_S3_ENDPOINT",
      "https://s3.eu-central-003.backblazeb2.com",
    );
    vi.stubEnv("PRIVATE_S3_REGION", "eu-central-003");
    const io = transport();
    await createStorage().upload({
      key: "backups/fixture.json",
      body: new Uint8Array(),
      contentType: "application/json",
    });
    const client = io.send.mock.contexts[0]! as S3Client;
    expect(await client.config.region()).toBe("eu-central-003");
    expect((await client.config.endpoint!()).hostname).toBe(
      "s3.eu-central-003.backblazeb2.com",
    );
    expect(io.calls[0]!.credential).toBe("private-fixture-id");
  });

  test.each(["S3_ENDPOINT", "PRIVATE_S3_ENDPOINT", "S3_PUBLIC_URL"])(
    "rejects an unsafe %s without printing configuration values",
    (name) => {
      vi.stubEnv(name, "https://user:do-not-print@storage.example.test/path");
      let message = "";
      try {
        createStorage();
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain(`${name} must be an HTTPS origin`);
      expect(message).not.toContain("do-not-print");
    },
  );

  test("bare private namespace roots are not readable or writable objects", async () => {
    const { GET } = await import(
      "../node_modules/emdash/dist/astro/routes/api/media/file/_...key_.mjs"
    );
    const io = transport();
    const storage = createStorage();
    for (const key of ["backups", "transfers", "BACKUPS"]) {
      for (const operation of [
        async () =>
          storage.upload({
            key,
            body: new Uint8Array(),
            contentType: "application/json",
          }),
        async () => storage.download(key),
        async () => storage.exists(key),
        async () => storage.delete(key),
        async () =>
          storage.getSignedUploadUrl({ key, contentType: "application/json" }),
      ])
        await expect(operation()).rejects.toThrow("requires a file key");
      expect(() => storage.getPublicUrl(key)).toThrow("requires a file key");
      const response = await GET({
        params: { key },
        request: new Request(
          `https://ovyerus.com/_emdash/api/media/file/${key}`,
        ),
        locals: { emdash: { storage } },
      } as never);
      expect(response.status).toBe(404);
    }
    expect(io.calls).toHaveLength(0);
  });

  test("private write failure never retries to the public bucket", async () => {
    const send = vi
      .spyOn(S3Client.prototype, "send")
      .mockRejectedValue(new Error("fixture private backend unavailable"));
    await expect(
      createStorage().upload({
        key: "backups/secret.json",
        body: new Uint8Array(),
        contentType: "application/json",
      }),
    ).rejects.toThrow("Failed to upload");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].input).toEqual(
      expect.objectContaining({
        Bucket: "fixture-private",
        Key: "blog/backups/secret.json",
      }),
    );
  });

  test("root pagination crosses buckets without duplication, buffering, or losing opaque cursors", async () => {
    const io = transport();
    io.put("ovy-cdn", "blog/a.png");
    io.put("ovy-cdn", "blog/b.png");
    io.put("fixture-private", "blog/backups/a.json");
    io.put("fixture-private", "blog/transfers/a.json");
    const storage = createStorage();
    let cursor: string | undefined;
    const keys: string[] = [];
    for (let page = 0; page < 4; page++) {
      const listed = await storage.list({ limit: 1, cursor });
      expect(listed.files).toHaveLength(1);
      keys.push(listed.files[0]!.key);
      cursor = listed.nextCursor;
      if (page < 3) expect(cursor).toBeTruthy();
    }
    expect(cursor).toBeUndefined();
    expect(keys).toEqual([
      "a.png",
      "b.png",
      "backups/a.json",
      "transfers/a.json",
    ]);
    expect(
      io.calls.map((call) => [
        call.bucket,
        call.prefix,
        call.cursor,
        call.limit,
      ]),
    ).toEqual([
      ["ovy-cdn", "blog/", undefined, 1],
      ["ovy-cdn", "blog/", "offset:1", 1],
      ["fixture-private", "blog/", undefined, 1],
      ["fixture-private", "blog/", "offset:1", 1],
    ]);
  });

  test("partial prefixes span buckets; specific private prefixes never list public storage", async () => {
    const io = transport();
    io.put("ovy-cdn", "blog/backdrop.png");
    io.put("fixture-private", "blog/backups/a.json");
    const storage = createStorage();
    const first = await storage.list({ prefix: "back", limit: 1 });
    const second = await storage.list({
      prefix: "back",
      limit: 1,
      cursor: first.nextCursor,
    });
    expect([...first.files, ...second.files].map((file) => file.key)).toEqual([
      "backdrop.png",
      "backups/a.json",
    ]);
    const before = io.calls.length;
    expect((await storage.list({ prefix: "backups/" })).files[0]!.key).toBe(
      "backups/a.json",
    );
    expect(io.calls.slice(before).map((call) => call.bucket)).toEqual([
      "fixture-private",
    ]);
  });

  test("empty media bucket advances once to private storage within the same root-list call", async () => {
    const io = transport();
    io.put("fixture-private", "blog/backups/a.json");
    const result = await createStorage().list({ limit: 1 });
    expect(result.files.map((file) => file.key)).toEqual(["backups/a.json"]);
    expect(result.nextCursor).toBeUndefined();
    expect(io.calls).toHaveLength(2);
  });

  test("invalid or mismatched cursors fail before any SDK operation", async () => {
    const io = transport();
    const storage = createStorage();
    for (const cursor of [
      "bogus",
      "x".repeat(16385),
      Buffer.from(
        JSON.stringify({
          v: 1,
          prefix: "backups/",
          bucket: "private",
          token: "opaque",
        }),
      ).toString("base64url"),
    ]) {
      await expect(storage.list({ prefix: "photos/", cursor })).rejects.toThrow(
        "cursor",
      );
    }
    expect(io.calls).toHaveLength(0);
  });

  test("wrong-bucket or wrong-prefix results are rejected rather than exposed or deleted", async () => {
    const io = transport();
    io.put("ovy-cdn", "blog/backups/accidental-public.json");
    await expect(createStorage().list()).rejects.toThrow("wrong bucket");
    expect(
      io.objects.has(
        io.address("ovy-cdn", "blog/backups/accidental-public.json"),
      ),
    ).toBe(true);
    io.send.mockResolvedValue({ Contents: [{ Key: "blog/other.png" }] });
    await expect(createStorage().list({ prefix: "photos/" })).rejects.toThrow(
      "wrong bucket or prefix",
    );
  });

  test("installed archive listing/deletion only touches private storage, preserving public objects", async () => {
    const io = transport();
    const archive = "emdash-backup-2026-10-25T00-00-00-0123abcd.json";
    io.put("fixture-private", `blog/backups/${archive}`, "private archive");
    io.put(
      "ovy-cdn",
      `blog/backups/${archive}`,
      "unrelated existing public object",
    );
    io.put("ovy-cdn", "blog/photo.png");
    const storage = createStorage();
    const listed = await listBackupArchives(storage);
    if (!listed.success) throw new Error("Installed backup handler failed");
    expect(listed.data.map((item) => item.name)).toEqual([archive]);
    expect((await deleteBackupArchive(storage, archive)).success).toBe(true);
    expect(
      io.objects.has(io.address("fixture-private", `blog/backups/${archive}`)),
    ).toBe(false);
    expect(
      io.objects.has(io.address("ovy-cdn", `blog/backups/${archive}`)),
    ).toBe(true);
    expect(io.objects.has(io.address("ovy-cdn", "blog/photo.png"))).toBe(true);
    expect(io.calls.every((call) => call.bucket === "fixture-private")).toBe(
      true,
    );
  });

  test("installed transfer stage writes verified data and prunes only its private operation prefix", async () => {
    const io = transport();
    const prefix = "transfers/imports/01KABCDE-0123456789abcdef/";
    io.put(
      "ovy-cdn",
      `blog/${prefix}manifest.json`,
      "public object must survive",
    );
    io.put(
      "fixture-private",
      "blog/transfers/imports/other-operation/manifest.json",
    );
    const stage = new TransferStage(createStorage(), prefix);
    const bytes = new TextEncoder().encode("verified fixture");
    await stage.putVerified(
      "manifest.json",
      bytes,
      bytes.byteLength,
      createHash("sha256").update(bytes).digest("hex"),
    );
    await stage.putAux("plan", '{"private":true}');
    expect(
      new TextDecoder().decode(await stage.readBytes("manifest.json", 100)),
    ).toBe("verified fixture");
    expect(await stage.readAux("plan", 100)).toBe('{"private":true}');
    expect(await stage.deleteSome(1)).toBe(1);
    expect(await stage.deleteSome(1)).toBe(1);
    expect(await stage.deleteSome(1)).toBe(0);
    expect(
      io.objects.has(io.address("ovy-cdn", `blog/${prefix}manifest.json`)),
    ).toBe(true);
    expect(
      io.objects.has(
        io.address(
          "fixture-private",
          "blog/transfers/imports/other-operation/manifest.json",
        ),
      ),
    ).toBe(true);
    expect(io.calls.every((call) => call.bucket === "fixture-private")).toBe(
      true,
    );
  });
});
