import { isEqual } from "date-fns";
import { describe, expect, test } from "vitest";
import { getWeeknoteStrings } from "~lib/weeknotes";

// TODO: fuzzing would probably be nice at some point
describe("getWeeknoteStrings", () => {
  test("handles a date in the middle of a year", () => {
    const strings = getWeeknoteStrings("2024-w36");

    expect(isEqual(strings.createdAt, new Date(2024, 8, 8))).toBe(true);
    expect(strings.written).toBe("September 8th, 2024");
    expect(strings.title).toBe("Weeknote 36, 2024");
    expect(strings.sentence).toBe("week 36 of 2024");
  });

  test("handles the 1st week of the year", () => {
    const strings = getWeeknoteStrings("2025-w01");

    expect(isEqual(strings.createdAt, new Date(2025, 0, 5))).toBe(true);
    expect(strings.written).toBe("January 5th, 2025");
    expect(strings.title).toBe("Weeknote 01, 2025");
    expect(strings.sentence).toBe("week 01 of 2025");
  });

  test("handles the 52nd week of the year, when that is the last week of the year", () => {
    const strings = getWeeknoteStrings("2024-w52");

    expect(isEqual(strings.createdAt, new Date(2024, 11, 29))).toBe(true);
    expect(strings.written).toBe("December 29th, 2024");
    expect(strings.title).toBe("Weeknote 52, 2024");
    expect(strings.sentence).toBe("week 52 of 2024");
  });

  test("handles the 53rd week of the year, when that is the last week of the year", () => {
    const strings = getWeeknoteStrings("2004-w53");

    expect(isEqual(strings.createdAt, new Date(2005, 0, 2))).toBe(true);
    expect(strings.written).toBe("January 2nd, 2005");
    expect(strings.title).toBe("Weeknote 53, 2004");
    expect(strings.sentence).toBe("week 53 of 2004");
  });
});
