import type { CollectionEntry } from "astro:content";
import {
  format,
  isAfter,
  isBefore,
  lastDayOfISOWeek,
  parseISO,
} from "date-fns";

// TODO: write tests to cover edge cases like crossing the year and shit
export const getWeeknoteStrings = (slug: string) => {
  const date = parseISO(slug.toUpperCase());
  const [year, week] = slug.replace("w", "").split("-");
  const writtenDate = lastDayOfISOWeek(date);

  return {
    createdAt: writtenDate,
    written: format(writtenDate, "MMMM do, yyyy"),
    title: `Weeknote ${week}, ${year}`,
    sentence: `week ${week} of ${year}`,
  };
};

export const sortWeeknotes = (weeknotes: CollectionEntry<"weeknotes">[]) =>
  weeknotes.toSorted(({ slug: slugA }, { slug: slugB }) => {
    const a = parseISO(slugA.toUpperCase());
    const b = parseISO(slugB.toUpperCase());

    // Conditions reversed to make it a descending list.
    if (isAfter(a, b)) return -1;
    else if (isBefore(a, b)) return 1;
    else return 0;
  });
