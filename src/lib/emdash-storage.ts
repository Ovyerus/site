import type { Storage } from "emdash";
import { createStorage as createLocalStorage } from "emdash/storage/local";
import { S3Storage } from "emdash/storage/s3";
import { blogStorage } from "./blog-storage";
import { splitStorage } from "./split-storage";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for B2 storage.`);
  return value;
}

function httpsOrigin(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an HTTPS origin.`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${name} must be an HTTPS origin.`);
  }
  return url.origin;
}

/** Resolve credentials at runtime, never while bundling Astro or building Nix. */
export function createStorage(): Storage {
  const backend = process.env.EMDASH_STORAGE ?? "local";
  if (backend === "local") {
    return createLocalStorage({
      directory: "./data/uploads",
      baseUrl: "/_emdash/api/media/file",
    });
  }
  if (backend !== "s3") throw new Error("EMDASH_STORAGE must be local or s3.");
  const endpoint = httpsOrigin(required("S3_ENDPOINT"), "S3_ENDPOINT");
  const region = required("S3_REGION");
  const bucket = required("S3_BUCKET");
  const accessKeyId = required("S3_ACCESS_KEY_ID");
  const secretAccessKey = required("S3_SECRET_ACCESS_KEY");
  const privateBucket = required("PRIVATE_S3_BUCKET");
  if (privateBucket.toLowerCase() === bucket.toLowerCase()) {
    throw new Error(
      "PRIVATE_S3_BUCKET must differ from the public media bucket.",
    );
  }
  if (process.env.PRIVATE_S3_PUBLIC_URL)
    throw new Error("Private storage must not have a public URL.");
  const publicUrl = process.env.S3_PUBLIC_URL
    ? `${httpsOrigin(process.env.S3_PUBLIC_URL, "S3_PUBLIC_URL")}/blog`
    : undefined;
  const media = new S3Storage({
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    publicUrl,
  });
  // Explicit constructor config avoids EmDash's S3_* env fallback: private
  // storage must never inherit public media credentials, bucket, or CDN URL.
  const privateStorage = new S3Storage({
    endpoint: httpsOrigin(
      process.env.PRIVATE_S3_ENDPOINT ?? endpoint,
      "PRIVATE_S3_ENDPOINT",
    ),
    region: process.env.PRIVATE_S3_REGION ?? region,
    bucket: privateBucket,
    accessKeyId: required("PRIVATE_S3_ACCESS_KEY_ID"),
    secretAccessKey: required("PRIVATE_S3_SECRET_ACCESS_KEY"),
  });
  return splitStorage(
    blogStorage(
      Object.assign(media, { getClientUploadOrigin: () => endpoint }),
    ),
    blogStorage(privateStorage),
  );
}
