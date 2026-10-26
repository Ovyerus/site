import type { PluginContext } from "emdash/plugin";
import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  config: null as { pdsUrl: string; password: string } | null,
  readOnly: false,
  open: vi.fn(),
  track: vi.fn(),
  reconcile: vi.fn(),
  syncOne: vi.fn(),
  close: vi.fn(),
  createClient: vi.fn(),
  client: {},
}));
vi.mock("~lib/standard-site", () => ({
  standardConfig: () => state.config,
  createStandardClient: () => {
    state.createClient();
    return state.client;
  },
}));
vi.mock("~lib/deployment", () => ({ isReadOnlyReplica: () => state.readOnly }));
vi.mock("~lib/standard-site-store", () => ({
  StandardSiteStore: class {
    constructor() {
      state.open();
    }
    track = state.track;
    reconcile = state.reconcile;
    syncOne = state.syncOne;
    close = state.close;
  },
}));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  state.config = null;
  state.readOnly = false;
  state.syncOne.mockResolvedValue("synced");
});
function context() {
  const value = {
    cron: { list: vi.fn().mockResolvedValue([]), schedule: vi.fn() },
    log: { error: vi.fn() },
  };
  return { value, ctx: value as unknown as PluginContext };
}
test("activation schedules once while disabled; disabled/replica events cannot open the ledger", async () => {
  const { default: plugin, standardTaskName } = await import(
    "~lib/emdash-standard-site"
  );
  const { value, ctx } = context();
  await plugin.hooks["plugin:activate"]({} as never, ctx);
  expect(value.cron.schedule).toHaveBeenCalledWith(standardTaskName, {
    schedule: "* * * * *",
  });
  value.cron.list.mockResolvedValue([{ name: standardTaskName }] as never);
  await plugin.hooks["plugin:activate"]({} as never, ctx);
  expect(value.cron.schedule).toHaveBeenCalledTimes(1);
  state.readOnly = true;
  await plugin.hooks["plugin:activate"]({} as never, ctx);
  expect(value.cron.list).toHaveBeenCalledTimes(2);
  await plugin.hooks["content:afterPublish"](
    { collection: "posts", content: { id: "p1" } },
    ctx,
  );
  await plugin.hooks.cron.handler({ name: standardTaskName } as never, ctx);
  expect(state.open).not.toHaveBeenCalled();
  expect(state.createClient).not.toHaveBeenCalled();
});
test("hooks only queue; cron respects backfill, closes stores, reuses auth and redacts failures", async () => {
  const { default: plugin, standardTaskName } = await import(
    "~lib/emdash-standard-site"
  );
  const { value, ctx } = context();
  state.config = { pdsUrl: "https://pds.invalid", password: "fake" };
  await plugin.hooks["content:afterPublish"](
    { collection: "pages", content: { id: "ignored" } },
    ctx,
  );
  expect(state.open).not.toHaveBeenCalled();
  for (const name of [
    "content:afterPublish",
    "content:afterSave",
    "content:afterUnpublish",
  ] as const) {
    await plugin.hooks[name](
      { collection: "posts", content: { id: "p1" } } as never,
      ctx,
    );
  }
  await plugin.hooks["content:afterDelete"](
    { collection: "posts", id: "p1", permanent: true },
    ctx,
  );
  expect(state.track).toHaveBeenCalledTimes(4);
  expect(state.track).toHaveBeenLastCalledWith("posts", "p1");
  expect(state.syncOne).not.toHaveBeenCalled();
  expect(state.createClient).not.toHaveBeenCalled();
  await plugin.hooks.cron.handler({ name: "another-task" } as never, ctx);
  expect(state.syncOne).not.toHaveBeenCalled();
  const before = process.env.STANDARD_SITE_BACKFILL;
  try {
    process.env.STANDARD_SITE_BACKFILL = "true";
    await plugin.hooks.cron.handler({ name: standardTaskName } as never, ctx);
    expect(state.reconcile).toHaveBeenLastCalledWith(true);
    process.env.STANDARD_SITE_BACKFILL = "false";
    await plugin.hooks.cron.handler({ name: standardTaskName } as never, ctx);
    expect(state.reconcile).toHaveBeenLastCalledWith(false);
    expect(state.createClient).toHaveBeenCalledTimes(1);
    expect(state.syncOne).toHaveBeenLastCalledWith(state.client);
    state.syncOne.mockResolvedValue("failed");
    await plugin.hooks.cron.handler({ name: standardTaskName } as never, ctx);
    expect(value.log.error).toHaveBeenCalledWith(
      "Standard.site sync failed; retry scheduled",
    );
    state.config = { ...state.config!, password: "rotated-fake" };
    state.syncOne.mockRejectedValue(new Error("fixture failure"));
    await expect(
      plugin.hooks.cron.handler({ name: standardTaskName } as never, ctx),
    ).rejects.toThrow("fixture failure");
    expect(state.createClient).toHaveBeenCalledTimes(2);
    expect(state.close).toHaveBeenCalledTimes(state.open.mock.calls.length);
  } finally {
    if (before === undefined) delete process.env.STANDARD_SITE_BACKFILL;
    else process.env.STANDARD_SITE_BACKFILL = before;
  }
});
