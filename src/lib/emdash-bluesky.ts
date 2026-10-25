import { ContentSaveRejectedError } from "emdash";
import type { PluginContext, SandboxedPlugin } from "emdash/plugin";
import {
  announcementConfig,
  announcementDid,
  announcementText,
  publishAnnouncement,
} from "./bluesky-announcement";
import { AnnouncementStore } from "./bluesky-announcement-store";
import { isReadOnlyReplica } from "./deployment";

const taskName = "announce-weeknotes";

async function schedule(ctx: PluginContext) {
  if (isReadOnlyReplica()) return;
  if (!ctx.cron)
    throw new Error("Bluesky announcements require EmDash's cron scheduler.");
  if (!(await ctx.cron.list()).some((task) => task.name === taskName)) {
    await ctx.cron.schedule(taskName, { schedule: "* * * * *" });
  }
}

export default {
  hooks: {
    "plugin:activate": async (_, ctx) => {
      // Keep the schedule even when posting is disabled; enabling credentials
      // after a restart must not depend on another activation event.
      await schedule(ctx);
    },
    "content:beforeSave": async ({ collection, content }) => {
      if (collection !== "weeknotes" || content.bluesky_announcement == null)
        return;
      try {
        if (typeof content.bluesky_announcement !== "string") {
          throw new Error("Bluesky announcement must be plain text.");
        }
        if (content.bluesky_announcement.trim()) {
          // Every ISO week identifier has the same length, including staged slugs.
          announcementText(content.bluesky_announcement, "2000-w01");
        }
      } catch (error) {
        throw new ContentSaveRejectedError((error as Error).message);
      }
    },
    "content:afterPublish": async ({ collection }, ctx) => {
      if (collection !== "weeknotes" || !announcementConfig()) return;
      await schedule(ctx);
      const store = new AnnouncementStore();
      try {
        store.reconcile();
      } finally {
        store.close();
      }
    },
    cron: {
      timeout: 90_000,
      handler: async ({ name }, ctx) => {
        if (name !== taskName) return;
        const config = announcementConfig();
        if (!config) return;
        const store = new AnnouncementStore();
        let entryId: string | undefined;
        try {
          store.reconcile();
          const job = store.claim();
          if (!job) return;
          entryId = job.entryId;
          if (!job.uri) {
            const post = await publishAnnouncement(job, config);
            store.recordPost(job.entryId, post.uri, post.cid);
          }
          store.complete(job.entryId, announcementDid, job.rkey);
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Bluesky announcement failed.";
          if (entryId) store.fail(entryId, message);
          ctx.log.error(message);
          throw error;
        } finally {
          store.close();
        }
      },
    },
  },
} satisfies SandboxedPlugin;
