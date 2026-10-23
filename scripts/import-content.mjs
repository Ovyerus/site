import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { parse } from "yaml";
import { parseWeeknoteId, weeknoteIdPattern } from "../src/lib/iso-week.ts";

const field = (slug, label, type = "string", extra = {}) => ({
  slug,
  label,
  type,
  ...extra,
});
const body = field("body", "Body (Markdown)", "text", {
  required: true,
  options: { rows: 24 },
});
const description = field("description", "Description", "text");
const comments = field(
  "comments",
  "Bluesky thread (bsky: did, postCid)",
  "json",
);
const seed = {
  $schema: "https://emdashcms.com/seed.schema.json",
  version: "1",
  meta: {
    name: "Ovyerus",
    description: "Existing personal site content",
    author: "Ovyerus",
  },
  settings: {
    title: "Ovyerus",
    tagline: "Multifaceted creative, programmer of many things.",
    timezone: "Australia/Melbourne",
    url: "https://ovyerus.com",
  },
  collections: [
    {
      slug: "posts",
      label: "Posts",
      labelSingular: "Post",
      titleField: "title",
      dateField: "written_at",
      urlPattern: "/posts/{slug}",
      supports: ["drafts", "revisions", "preview", "scheduling"],
      fields: [
        field("title", "Title", "string", { required: true }),
        description,
        body,
        field("tags", "Tags", "multiSelect", { defaultValue: [] }),
        field("written_at", "Written at", "datetime", {
          required: true,
          indexed: true,
        }),
        field("modified_at", "Modified at", "datetime"),
        comments,
      ],
    },
    {
      slug: "weeknotes",
      label: "Weeknotes",
      labelSingular: "Weeknote",
      description:
        "Weeknote slugs and admin titles use YYYY-wWW (e.g. 2026-w41); the public title and date derive from the ISO week.",
      titleField: "title",
      urlPattern: "/weeknotes/{slug}",
      supports: ["drafts", "revisions", "preview", "scheduling"],
      fields: [
        field("title", "ISO week", "string", {
          required: true,
          validation: { pattern: weeknoteIdPattern },
        }),
        field("subtitle", "Subtitle"),
        description,
        body,
        comments,
      ],
    },
    {
      slug: "pages",
      label: "Pages",
      labelSingular: "Page",
      titleField: "title",
      urlPattern: "/{slug}",
      supports: ["drafts", "revisions", "preview"],
      fields: [
        field("title", "Title", "string", { required: true }),
        description,
        body,
      ],
    },
    {
      slug: "home",
      label: "Homepage",
      labelSingular: "Homepage",
      routable: false,
      titleField: "title",
      supports: ["drafts", "revisions"],
      fields: [
        field("title", "Title", "string", { required: true }),
        field("tagline", "Tagline", "string", { required: true }),
        field("email", "Contact email", "string", { required: true }),
        field("github", "GitHub", "url", { required: true }),
        field("mastodon", "Mastodon", "url", { required: true }),
        field("bluesky", "Bluesky", "url", { required: true }),
      ],
    },
  ],
  content: {
    posts: [],
    weeknotes: [],
    pages: [],
    home: [
      {
        id: "home",
        status: "published",
        data: {
          title: "Ovyerus",
          tagline: "Multifaceted creative, programmer of many things.",
          email: "ovy@ovyerus.com",
          github: "https://github.com/Ovyerus",
          mastodon: "https://aus.social/@ovyerus",
          bluesky: "https://bsky.app/profile/ovyerus.com",
        },
      },
    ],
  },
};

for (const collection of ["posts", "weeknotes", "pages"]) {
  const directory = new URL(`../src/content/${collection}/`, import.meta.url);
  for (const filename of (await readdir(directory)).sort()) {
    if (!filename.endsWith(".md") || filename.startsWith("_")) continue;
    const slug = filename.slice(0, -3);
    if (collection === "weeknotes") parseWeeknoteId(slug);
    const source = await readFile(new URL(filename, directory), "utf8");
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(
      source,
    );
    const metadata = match ? (parse(match[1]) ?? {}) : {};
    const data = { body: match ? match[2] : source, ...metadata };
    delete data.layout;
    delete data.navCurrent;
    if (collection === "posts") {
      data.written_at = new Date(metadata.createdAt).toISOString();
      if (metadata.modifiedAt)
        data.modified_at = new Date(metadata.modifiedAt).toISOString();
      delete data.createdAt;
      delete data.modifiedAt;
    } else if (collection === "weeknotes") {
      data.title = slug;
    }
    const allowedFields = new Set(
      seed.collections
        .find((entry) => entry.slug === collection)
        .fields.map((entry) => entry.slug),
    );
    for (const key of Object.keys(data)) {
      if (!allowedFields.has(key)) delete data[key];
    }
    seed.content[collection].push({
      id: `${collection}-${slug}`,
      slug,
      status: "published",
      data,
    });
  }
}

const tagField = seed.collections
  .find(({ slug }) => slug === "posts")
  .fields.find(({ slug }) => slug === "tags");
tagField.validation = {
  options: [
    ...new Set(seed.content.posts.flatMap(({ data }) => data.tags)),
  ].toSorted(),
};

await mkdir(new URL("../data/", import.meta.url), { recursive: true });
await mkdir(new URL("../seed/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../seed/seed.json", import.meta.url),
  JSON.stringify(seed, null, 2) + "\n",
);
console.log(
  Object.fromEntries(
    Object.entries(seed.content).map(([key, entries]) => [key, entries.length]),
  ),
);
