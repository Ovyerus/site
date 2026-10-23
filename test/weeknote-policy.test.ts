import { describe, expect, test } from "vitest";
import policy from "~lib/emdash-weeknotes";

const hooks = policy.hooks;

describe("weeknote CMS policy", () => {
  test("rejects a nonexistent week when saving an admin title", async () => {
    await expect(
      hooks["content:beforeSave"]({
        collection: "weeknotes",
        content: { title: "2021-w53" },
        isNew: true,
      }),
    ).rejects.toMatchObject({ name: "ContentSaveRejectedError" });
  });

  test("blocks publishing a malformed slug even with a valid title", async () => {
    const decision = await hooks["content:beforePublish"]({
      collection: "weeknotes",
      content: { slug: "2026-w3", data: { title: "2026-w03" } },
      origin: { source: "system" },
    });
    expect(decision).toMatchObject({ cancel: true });
  });

  test("blocks scheduling a title that disagrees with the slug", async () => {
    const decision = await hooks["content:beforeSchedule"]({
      collection: "weeknotes",
      content: { slug: "2026-w43", data: { title: "2026-w42" } },
      origin: { source: "system" },
    });
    expect(decision).toMatchObject({ cancel: true });
  });

  test("allows the same genuine ISO week 53 in both fields", async () => {
    expect(
      await hooks["content:beforePublish"]({
        collection: "weeknotes",
        content: { slug: "2020-w53", data: { title: "2020-w53" } },
        origin: { source: "system" },
      }),
    ).toBeUndefined();
  });
});
