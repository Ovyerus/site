import { defineCollection, z } from "astro:content";

const dateRe = /^[0-9]{4}-[0-9]{2}-[0-9]{2}Z$/;

const infoCollection = defineCollection({
  schema: z.object({
    title: z.string(),
    description: z.string(),
    modifiedAt: z.string().regex(dateRe).optional(),
    navCurrent: z.string().startsWith("/"),
    premable: z.string().optional(),
  }),
});

const postsCollection = defineCollection({
  schema: z.object({
    title: z.string(),
    description: z.string(),
    tags: z.string().array(),
    createdAt: z.string().regex(dateRe),
    modifiedAt: z.string().regex(dateRe).optional(),
  }),
});

export const collections = {
  info: infoCollection,
  posts: postsCollection,
};
