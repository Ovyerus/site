import type { Storage } from "emdash";

// Match EmDash 1.2's private media-route prefixes; re-audit on upgrades.
const PRIVATE_PREFIXES = ["backups/", "transfers/"];
type Bucket = "media" | "private";
type Cursor = { v: 1; prefix: string; bucket: Bucket; token?: string };

function bucketFor(key: string): Bucket {
  const lower = key.toLowerCase();
  // Bare namespace roots are not object keys. EmDash's public route denies
  // backups/ and transfers/, but not bare "backups" / "transfers" objects.
  if (PRIVATE_PREFIXES.some((prefix) => lower === prefix.slice(0, -1))) {
    throw new Error(
      "Storage object not found: private namespace requires a file key.",
    );
  }
  return PRIVATE_PREFIXES.some((prefix) => lower.startsWith(prefix))
    ? "private"
    : "media";
}

/** Route logical keys, never copying/retrying private operations into public storage. */
export function splitStorage(media: Storage, privateStorage: Storage): Storage {
  const stores = { media, private: privateStorage };
  const storageFor = (key: string) => stores[bucketFor(key)];

  return {
    async upload(options) {
      const result = await storageFor(options.key).upload(options);
      return bucketFor(options.key) === "private"
        ? { ...result, url: "" }
        : result;
    },
    download: (key, options) => storageFor(key).download(key, options),
    delete: (key) => storageFor(key).delete(key),
    exists: (key) => storageFor(key).exists(key),
    async list(options = {}) {
      const prefix = options.prefix ?? "";
      const lower = prefix.toLowerCase();
      // A root/partial-prefix list may span both buckets. Page through media,
      // then private objects; never fetch or buffer an entire bucket to merge it.
      const buckets: Bucket[] = PRIVATE_PREFIXES.some((value) =>
        lower.startsWith(value),
      )
        ? ["private"]
        : PRIVATE_PREFIXES.some((value) => value.startsWith(lower))
          ? ["media", "private"]
          : ["media"];
      let bucket = buckets[0]!;
      let token: string | undefined;
      if (options.cursor) {
        try {
          if (options.cursor.length > 16384) throw new Error();
          const cursor = JSON.parse(
            Buffer.from(options.cursor, "base64url").toString("utf8"),
          ) as Partial<Cursor> | null;
          if (
            !cursor ||
            cursor.v !== 1 ||
            cursor.prefix !== prefix ||
            !buckets.includes(cursor.bucket!) ||
            (cursor.token !== undefined && typeof cursor.token !== "string")
          )
            throw new Error();
          bucket = cursor.bucket!;
          token = cursor.token;
        } catch {
          throw new Error("Invalid split-storage list cursor.");
        }
      }
      const cursorFor = (bucket: Bucket, token?: string) =>
        Buffer.from(
          JSON.stringify({ v: 1, prefix, bucket, token } satisfies Cursor),
        ).toString("base64url");
      for (
        let index = buckets.indexOf(bucket);
        index < buckets.length;
        index++
      ) {
        const current = buckets[index]!;
        const result = await stores[current].list({
          ...options,
          prefix,
          cursor: token,
        });
        if (
          result.files.some(
            (file) =>
              !file.key.startsWith(prefix) || bucketFor(file.key) !== current,
          )
        ) {
          throw new Error(
            "Storage listed an object in the wrong bucket or prefix.",
          );
        }
        if (result.nextCursor)
          return {
            ...result,
            nextCursor: cursorFor(current, result.nextCursor),
          };
        const next = buckets[index + 1];
        if (!next) return { ...result, nextCursor: undefined };
        if (result.files.length)
          return { ...result, nextCursor: cursorFor(next) };
        // Only an empty, completed first bucket advances within this call.
        token = undefined;
      }
      throw new Error("Invalid split-storage list state.");
    },
    getSignedUploadUrl(options) {
      if (bucketFor(options.key) === "private")
        throw new Error("Private storage does not allow browser upload URLs.");
      return media.getSignedUploadUrl(options);
    },
    getPublicUrl(key) {
      if (bucketFor(key) === "private")
        throw new Error("Private storage has no public URL.");
      return media.getPublicUrl(key);
    },
    ...(media.getClientUploadOrigin
      ? { getClientUploadOrigin: () => media.getClientUploadOrigin!() }
      : {}),
  };
}
