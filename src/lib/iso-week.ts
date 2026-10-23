import { format, isValid, parseISO } from "date-fns";

export const weeknoteIdPattern = "^[0-9]{4}-w(0[1-9]|[1-4][0-9]|5[0-3])$";
const weeknoteIdRegex = new RegExp(weeknoteIdPattern);

export function parseWeeknoteId(id: string): Date {
  if (weeknoteIdRegex.test(id)) {
    const date = parseISO(id.toUpperCase());
    if (isValid(date) && format(date, "RRRR-'w'II") === id) return date;
  }
  throw new Error(
    `Invalid ISO week "${id}". Use YYYY-wWW for an existing ISO week, e.g. 2026-w43.`,
  );
}
