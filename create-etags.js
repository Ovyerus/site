import { glob, readFile, writeFile } from "node:fs/promises";

for await (const file of glob("dist/**/*", {
  withFileTypes: true,
  exclude: ["**/*.etag"],
})) {
  if (!file.isFile()) continue;
  const inputPath = `${file.parentPath}/${file.name}`;
  const outputPath = `${inputPath}.etag`;
  const input = await readFile(inputPath);
  const digest = await crypto.subtle.digest("SHA-256", input);
  const hash = Buffer.from(digest).toString("hex");

  await writeFile(outputPath, hash, { encoding: "utf8" });
}
