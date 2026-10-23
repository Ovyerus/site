import { ContentSaveRejectedError } from "emdash";
import type {
  ContentPolicyDecision,
  ContentPolicyEvent,
  SandboxedPlugin,
} from "emdash/plugin";
import { parseWeeknoteId } from "./iso-week.ts";

async function checkWeeknote({
  collection,
  content,
}: ContentPolicyEvent): Promise<ContentPolicyDecision> {
  if (collection !== "weeknotes") return;

  const slug = content.slug;
  if (typeof slug !== "string") {
    return { cancel: true, reason: "Weeknotes require a YYYY-wWW slug." };
  }
  try {
    parseWeeknoteId(slug);
  } catch (error) {
    return { cancel: true, reason: (error as Error).message };
  }

  const data = content.data as Record<string, unknown>;
  if (data.title !== slug) {
    return {
      cancel: true,
      reason: `The ISO week title must match the slug "${slug}".`,
    };
  }
}

export default {
  hooks: {
    "content:beforeSave": async ({ collection, content }) => {
      if (collection !== "weeknotes" || !Object.hasOwn(content, "title"))
        return;
      try {
        if (typeof content.title !== "string") {
          throw new Error("Weeknotes require a YYYY-wWW ISO week title.");
        }
        parseWeeknoteId(content.title);
      } catch (error) {
        throw new ContentSaveRejectedError((error as Error).message);
      }
    },
    "content:beforePublish": checkWeeknote,
    "content:beforeSchedule": checkWeeknote,
  },
} satisfies SandboxedPlugin;
