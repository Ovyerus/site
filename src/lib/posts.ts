import type { PostEntry } from "./content";
import { isAfter, isBefore } from "date-fns";

export const sortPosts = (posts: PostEntry[]) =>
  posts.toSorted(({ data: { createdAt: a } }, { data: { createdAt: b } }) => {
    // Conditions reversed to make it a descending list.
    if (isAfter(a, b)) return -1;
    else if (isBefore(a, b)) return 1;
    else return 0;
  });
