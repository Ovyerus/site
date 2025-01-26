import type { CollectionEntry } from "astro:content";
import {
  format,
  isAfter,
  isBefore,
  lastDayOfISOWeek,
  parseISO,
} from "date-fns";

// TODO: write tests to cover edge cases like crossing the year and shit
export const getWeeknoteStrings = (id: string) => {
  const date = parseISO(id.toUpperCase());
  const [year, week] = id.replace("w", "").split("-");
  const writtenDate = lastDayOfISOWeek(date);

  return {
    createdAt: writtenDate,
    written: format(writtenDate, "MMMM do, yyyy"),
    title: `Weeknote ${week}, ${year}`,
    sentence: `week ${week} of ${year}`,
  };
};

export const sortWeeknotes = (weeknotes: CollectionEntry<"weeknotes">[]) =>
  weeknotes.toSorted(({ id: idA }, { id: idB }) => {
    const a = parseISO(idA.toUpperCase());
    const b = parseISO(idB.toUpperCase());

    // Conditions reversed to make it a descending list.
    if (isAfter(a, b)) return -1;
    else if (isBefore(a, b)) return 1;
    else return 0;
  });
