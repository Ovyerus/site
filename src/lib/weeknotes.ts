import type { WeeknoteEntry } from "./content";
import { format, lastDayOfISOWeek } from "date-fns";
import { parseWeeknoteId } from "./iso-week";

export const getWeeknoteStrings = (id: string) => {
  const date = parseWeeknoteId(id);
  const [year, week] = id.replace("w", "").split("-");
  const writtenDate = lastDayOfISOWeek(date);

  return {
    createdAt: writtenDate,
    written: format(writtenDate, "MMMM do, yyyy"),
    title: `Weeknote ${week}, ${year}`,
    sentence: `week ${week} of ${year}`,
  };
};

export const sortWeeknotes = (weeknotes: WeeknoteEntry[]) => {
  for (const { id } of weeknotes) parseWeeknoteId(id);
  return weeknotes.toSorted(({ id: a }, { id: b }) =>
    a < b ? 1 : a > b ? -1 : 0,
  );
};
