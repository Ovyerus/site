import type { CollectionEntry } from "astro:content";
import {
  addDays,
  format,
  isAfter,
  isBefore,
  lastDayOfWeek,
  parseISO,
} from "date-fns";

export const getDayWeeknoteWasWritten = (slug: string) => {
  const date = parseISO(slug.toUpperCase());
  return addDays(lastDayOfWeek(date), 1);
};

export const getWeeknoteTitle = (slug: string) => {
  const date = parseISO(slug.toUpperCase());
  return format(date, "'Weeknote' ww, yyyy");
};

export const getWeeknoteTitleForSentence = (slug: string) => {
  const date = parseISO(slug.toUpperCase());
  return format(date, "'week' ww 'of' yyyy");
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
