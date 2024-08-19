import type { CollectionEntry } from "astro:content";
import { format, isAfter, isBefore, nextSunday, parseISO } from "date-fns";

export const getDayWeeknoteWasWritten = (slug: string) => {
  // I write weeknotes on Sundays, but date-fns uses Monday-Sunday weeks and
  // parses ISO weeks as the Monday, so need to shift it.
  const date = parseISO(slug.toUpperCase());
  return nextSunday(date);
};

export const getWeeknoteTitle = (date: Date) =>
  format(date, "'Weeknote' ww, yyyy");

export const sortWeeknotes = (weeknotes: CollectionEntry<"weeknotes">[]) =>
  weeknotes.toSorted(({ slug: slugA }, { slug: slugB }) => {
    const a = parseISO(slugA.toUpperCase());
    const b = parseISO(slugB.toUpperCase());

    // Conditions reversed to make it a descending list.
    if (isAfter(a, b)) return -1;
    else if (isBefore(a, b)) return 1;
    else return 0;
  });
