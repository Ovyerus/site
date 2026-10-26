import type { PluginContext, SandboxedPlugin } from "emdash/plugin";
import { isReadOnlyReplica } from "./deployment";
import {
  createStandardClient,
  standardConfig,
  type StandardCollection,
  type StandardClient,
  type StandardConfig,
} from "./standard-site";
import { StandardSiteStore } from "./standard-site-store";

export const standardTaskName = "sync-standard-site";
let cached: { config: StandardConfig; client: StandardClient } | undefined;
function clientFor(config: StandardConfig): StandardClient {
  if (
    !cached ||
    cached.config.pdsUrl !== config.pdsUrl ||
    cached.config.password !== config.password
  ) {
    cached = { config, client: createStandardClient(config) };
  }
  return cached.client;
}
function collection(value: string): value is StandardCollection {
  return value === "posts" || value === "weeknotes";
}
async function schedule(ctx: PluginContext) {
  if (isReadOnlyReplica()) return;
  if (!ctx.cron)
    throw new Error("Standard.site requires EmDash's cron scheduler");
  if (!(await ctx.cron.list()).some((task) => task.name === standardTaskName)) {
    await ctx.cron.schedule(standardTaskName, { schedule: "* * * * *" });
  }
}
async function changed(kind: string, id: unknown, ctx: PluginContext) {
  if (!collection(kind) || !standardConfig()) return;
  await schedule(ctx);
  const store = new StandardSiteStore();
  try {
    if (typeof id === "string") store.track(kind, id);
    store.reconcile();
  } finally {
    store.close();
  }
}

export default {
  hooks: {
    // Schedule even while disabled: enabling secrets after restart must not
    // depend on a second installation event. No PDS calls or ledger until enabled.
    "plugin:activate": async (_, ctx) => {
      await schedule(ctx);
    },
    "content:afterPublish": async ({ collection, content }, ctx) => {
      await changed(collection, content.id, ctx);
    },
    "content:afterSave": async ({ collection, content }, ctx) => {
      await changed(collection, content.id, ctx);
    },
    "content:afterUnpublish": async ({ collection, content }, ctx) => {
      await changed(collection, content.id, ctx);
    },
    "content:afterDelete": async ({ collection, id }, ctx) => {
      await changed(collection, id, ctx);
    },
    cron: {
      timeout: 90_000,
      handler: async ({ name }, ctx) => {
        if (name !== standardTaskName) return;
        const config = standardConfig();
        if (!config) return;
        const store = new StandardSiteStore();
        try {
          store.reconcile(process.env.STANDARD_SITE_BACKFILL === "true");
          const result = await store.syncOne(clientFor(config));
          if (result === "failed")
            ctx.log.error("Standard.site sync failed; retry scheduled");
        } finally {
          store.close();
        }
      },
    },
  },
} satisfies SandboxedPlugin;
