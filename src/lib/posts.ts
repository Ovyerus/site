import type { CollectionEntry } from "astro:content";
import { isAfter, isBefore } from "date-fns";

export const sortPosts = (posts: CollectionEntry<"posts">[]) =>
  posts.toSorted(({ data: { createdAt: a } }, { data: { createdAt: b } }) => {
    // Conditions reversed to make it a descending list.
    if (isAfter(a, b)) return -1;
    else if (isBefore(a, b)) return 1;
    else return 0;
  });
