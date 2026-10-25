import type { Storage } from "emdash";

const PREFIX = "blog/";

/** Physical B2 namespace only: CMS keys and URLs stay portable and unchanged. */
export function blogStorage(storage: Storage): Storage {
  function physicalKey(key: string, allowEmpty = false): string {
    if (
      (!allowEmpty && !key) ||
      key.startsWith("/") ||
      /[\\?#\u0000-\u001f\u007f]/.test(key) ||
      key.split("/").some((part) => part === "." || part === "..")
    ) {
      throw new Error(
        "Invalid storage key: must stay within the blog namespace.",
      );
    }
    return PREFIX + key;
  }

  return {
    async upload(options) {
      const result = await storage.upload({
        ...options,
        key: physicalKey(options.key),
      });
      return {
        ...result,
        key: options.key,
        url: storage.getPublicUrl(options.key),
      };
    },
    download: (key, options) => storage.download(physicalKey(key), options),
    delete: (key) => storage.delete(physicalKey(key)),
    exists: (key) => storage.exists(physicalKey(key)),
    async list(options = {}) {
      const result = await storage.list({
        ...options,
        prefix: physicalKey(options.prefix ?? "", true),
      });
      return {
        ...result,
        files: result.files
          .filter((file) => file.key !== PREFIX)
          .map((file) => {
            if (!file.key.startsWith(PREFIX))
              throw new Error(
                "Storage listed an object outside the blog namespace.",
              );
            const key = file.key.slice(PREFIX.length);
            physicalKey(key);
            return { ...file, key };
          }),
      };
    },
    getSignedUploadUrl: (options) =>
      storage.getSignedUploadUrl({ ...options, key: physicalKey(options.key) }),
    getPublicUrl(key) {
      physicalKey(key);
      return storage.getPublicUrl(key);
    },
    ...(storage.getClientUploadOrigin
      ? { getClientUploadOrigin: () => storage.getClientUploadOrigin!() }
      : {}),
  };
}
