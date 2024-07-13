import { defineCollection, z } from "astro:content";

const infoCollection = defineCollection({
  schema: z.object({
    title: z.string(),
    description: z.string(),
    navCurrent: z.string().startsWith("/"),
    premable: z.string().optional(),
  }),
});

const postsCollection = defineCollection({
  schema: z.object({
    title: z.string(),
    description: z.string(),
    tags: z.string().array(),
    createdAt: z.date(),
    modifiedAt: z.date().optional(),
  }),
});

const weeknotesCollection = defineCollection({
  schema: z.object({}),
});

export const collections = {
  info: infoCollection,
  posts: postsCollection,
  weeknotes: weeknotesCollection,
};
