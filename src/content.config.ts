import { glob } from "astro/loaders";
import { defineCollection, z } from "astro:content";

const postsCollection = defineCollection({
  loader: glob({
    pattern: "**/[^_]*.{md,mdx}",
    base: "./src/content/posts",
  }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    tags: z.string().array(),
    createdAt: z.date(),
    modifiedAt: z.date().optional(),
  }),
});

const weeknotesCollection = defineCollection({
  loader: glob({
    pattern: "**/[^_]*.{md,mdx}",
    base: "./src/content/weeknotes",
  }),
  schema: z.object({
    subtitle: z.string().optional(),
    description: z.string().optional(),
  }),
});

export const collections = {
  posts: postsCollection,
  weeknotes: weeknotesCollection,
};
