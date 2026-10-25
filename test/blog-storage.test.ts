import type { APIContext } from "astro";
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
import { GET } from "../node_modules/emdash/dist/astro/routes/api/media/file/_...key_.mjs";

beforeEach(() => {
  vi.stubEnv("EMDASH_STORAGE", "s3");
  vi.stubEnv("S3_ENDPOINT", "https://s3.us-west-004.backblazeb2.com");
  vi.stubEnv("S3_REGION", "us-west-004");
  vi.stubEnv("S3_BUCKET", "ovy-cdn");
  vi.stubEnv("S3_ACCESS_KEY_ID", "fixture-id");
  vi.stubEnv("S3_SECRET_ACCESS_KEY", "fixture-secret");
  vi.stubEnv("S3_PUBLIC_URL", undefined);
  vi.stubEnv("PRIVATE_S3_BUCKET", "fixture-private");
  vi.stubEnv("PRIVATE_S3_ACCESS_KEY_ID", "fixture-private-id");
  vi.stubEnv("PRIVATE_S3_SECRET_ACCESS_KEY", "fixture-private-secret");
  vi.stubEnv("PRIVATE_S3_ENDPOINT", undefined);
  vi.stubEnv("PRIVATE_S3_REGION", undefined);
  vi.stubEnv("PRIVATE_S3_PUBLIC_URL", undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("B2 blog namespace", () => {
  test("real SDK signs a prefixed PUT while public URLs retain logical keys", async () => {
    const storage = createStorage();
    const signed = await storage.getSignedUploadUrl({
      key: "example/image.png",
      contentType: "image/png",
      size: 3,
      expiresIn: 60,
    });
    const url = new URL(signed.url);
    expect(url.origin).toBe("https://s3.us-west-004.backblazeb2.com");
    expect(url.pathname).toBe("/ovy-cdn/blog/example/image.png");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[a-f0-9]{64}$/);
    expect(storage.getPublicUrl("example/image.png")).toBe(
      "/_emdash/api/media/file/example/image.png",
    );
    expect(storage.getClientUploadOrigin?.()).toBe(url.origin);
    expect(signed.method).toBe("PUT");
  });

  test("real S3 adapter prefixes every operation and returns portable keys, sizes and ranges", async () => {
    const send = vi
      .spyOn(S3Client.prototype, "send")
      .mockImplementation(async (command) => {
        if (command instanceof GetObjectCommand)
          return {
            Body: { transformToWebStream: () => new Response("PN").body! },
            ContentType: "image/png",
            ContentLength: 2,
            ContentRange: "bytes 0-1/3",
          };
        if (command instanceof ListObjectsV2Command) {
          if (command.input.Prefix === "blog/")
            return { Contents: [{ Key: "blog/image.png" }] };
          return {
            Contents: [
              {
                Key: "blog/backups/fixture.zip",
                Size: 3,
                LastModified: new Date(0),
              },
            ],
            NextContinuationToken: "next-opaque-cursor",
          };
        }
        return {};
      });
    const storage = createStorage();
    const uploaded = await storage.upload({
      key: "photo.png",
      body: new Uint8Array([80, 78, 71]),
      contentType: "image/png",
      cacheControl: "max-age=60",
    });
    expect(uploaded).toEqual({
      key: "photo.png",
      url: "/_emdash/api/media/file/photo.png",
      size: 3,
    });
    const download = await storage.download("photo.png", {
      range: { offset: 0, length: 2 },
    });
    expect(await new Response(download.body).text()).toBe("PN");
    expect(download.size).toBe(3);
    expect(download.range).toEqual({ offset: 0, length: 2 });
    expect(await storage.exists("photo.png")).toBe(true);
    await storage.delete("photo.png");
    const listed = await storage.list({
      prefix: "backups/",
      cursor: Buffer.from(
        JSON.stringify({
          v: 1,
          prefix: "backups/",
          bucket: "private",
          token: "opaque-cursor",
        }),
      ).toString("base64url"),
      limit: 2,
    });
    expect(listed.files[0]?.key).toBe("backups/fixture.zip");
    expect(
      JSON.parse(Buffer.from(listed.nextCursor!, "base64url").toString()).token,
    ).toBe("next-opaque-cursor");
    await storage.delete(listed.files[0]!.key);
    await storage.list();
    const commands = send.mock.calls.map(([command]) => command);
    expect(commands.map((command) => command.constructor)).toEqual([
      PutObjectCommand,
      GetObjectCommand,
      HeadObjectCommand,
      DeleteObjectCommand,
      ListObjectsV2Command,
      DeleteObjectCommand,
      ListObjectsV2Command,
    ]);
    expect(commands.map((command) => command.input)).toEqual([
      expect.objectContaining({
        Bucket: "ovy-cdn",
        Key: "blog/photo.png",
        CacheControl: "max-age=60",
      }),
      expect.objectContaining({
        Bucket: "ovy-cdn",
        Key: "blog/photo.png",
        Range: "bytes=0-1",
      }),
      expect.objectContaining({ Bucket: "ovy-cdn", Key: "blog/photo.png" }),
      expect.objectContaining({ Bucket: "ovy-cdn", Key: "blog/photo.png" }),
      expect.objectContaining({
        Bucket: "fixture-private",
        Prefix: "blog/backups/",
        MaxKeys: 2,
        ContinuationToken: "opaque-cursor",
      }),
      expect.objectContaining({
        Bucket: "fixture-private",
        Key: "blog/backups/fixture.zip",
      }),
      expect.objectContaining({ Bucket: "ovy-cdn", Prefix: "blog/" }),
    ]);
  });

  test("rejects traversal before accessing the bucket", async () => {
    const send = vi.spyOn(S3Client.prototype, "send");
    const storage = createStorage();
    for (const key of [
      "",
      "../other.png",
      "a/../../other.png",
      "/other.png",
      "a/./other.png",
      "a\\other.png",
      "a?other",
      "a#other",
      "a\u0000b",
    ]) {
      for (const operation of [
        async () =>
          storage.upload({
            key,
            body: new Uint8Array(),
            contentType: "image/png",
          }),
        async () => storage.download(key),
        async () => storage.delete(key),
        async () => storage.exists(key),
        async () =>
          storage.getSignedUploadUrl({ key, contentType: "image/png" }),
      ])
        await expect(operation()).rejects.toThrow("blog namespace");
      expect(() => storage.getPublicUrl(key)).toThrow("blog namespace");
      if (key)
        await expect(storage.list({ prefix: key })).rejects.toThrow(
          "blog namespace",
        );
    }
    expect(send).not.toHaveBeenCalled();
  });

  test("will not return an out-of-namespace list result", async () => {
    vi.spyOn(S3Client.prototype, "send").mockResolvedValue({
      Contents: [{ Key: "unrelated/private.txt" }],
    });
    await expect(createStorage().list()).rejects.toThrow(
      "outside the blog namespace",
    );
  });

  test("a root folder marker is ignored and continuation is preserved", async () => {
    vi.spyOn(S3Client.prototype, "send").mockResolvedValue({
      Contents: [{ Key: "blog/" }, { Key: "blog/image.png" }],
      NextContinuationToken: "next",
    });
    const result = await createStorage().list();
    expect(result.files.map((file) => file.key)).toEqual(["image.png"]);
    expect(
      JSON.parse(Buffer.from(result.nextCursor!, "base64url").toString()).token,
    ).toBe("next");
  });

  test("installed public media handler serves a logical URL from the prefixed S3 object", async () => {
    const send = vi.spyOn(S3Client.prototype, "send").mockResolvedValue({
      Body: { transformToWebStream: () => new Response("PNG").body! },
      ContentType: "image/png",
      ContentLength: 3,
    });
    const storage = createStorage();
    const response = await GET({
      params: { key: "image.png" },
      locals: { emdash: { storage } },
      request: new Request(
        "https://ovyerus.com/_emdash/api/media/file/image.png",
      ),
    } as unknown as APIContext);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("PNG");
    expect(send.mock.calls[0]?.[0].input).toEqual(
      expect.objectContaining({ Bucket: "ovy-cdn", Key: "blog/image.png" }),
    );
  });

  test("installed EmDash public media handler still refuses private prefixes before touching storage", async () => {
    const storage = createStorage();
    const download = vi.spyOn(storage, "download");
    for (const key of [
      "backups/private.zip",
      "transfers/exports/private.zip",
      "%62ackups/private.zip",
      "BACKUPS/private.zip",
    ]) {
      const response = await GET({
        params: { key },
        locals: { emdash: { storage } },
        request: new Request("https://ovyerus.com/_emdash/api/media/file/test"),
      } as unknown as APIContext);
      expect(response.status).toBe(404);
    }
    expect(download).not.toHaveBeenCalled();
  });
});
