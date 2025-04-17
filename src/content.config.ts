import { glob } from "astro/loaders";
import { defineCollection, z } from "astro:content";

const comments = z.object({
  bsky: z
    .object({
      did: z.string(),
      postCid: z.string(),
    })
    .optional(),
});

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
    comments: comments.optional(),
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
    comments: comments.optional(),
  }),
});

export const collections = {
  posts: postsCollection,
  weeknotes: weeknotesCollection,
};
