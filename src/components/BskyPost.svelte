<script lang="ts">
  import {
    ArrowRight,
    Heart,
    Reply,
    Repeat2,
    type Icon as IconType,
  } from "@lucide/svelte";
  import { format, parseJSON } from "date-fns";
  import { isBskyPost, type ThreadView } from "~lib/bsky";
  import BskyPost from "./BskyPost.svelte";
  import BskyPostEmbed from "./BskyPostEmbed.svelte";

  interface Props {
    thread: ThreadView;
    depth?: number;
    hideFirst?: boolean;
  }

  const { thread, depth = 0, hideFirst }: Props = $props();

  const shouldHide = depth === 0 && hideFirst;
  const {
    post: { author, record, likeCount, repostCount, replyCount, ...post },
  } = thread;
  const replies =
    thread.replies?.filter(
      (r) => r.$type === "app.bsky.feed.defs#threadViewPost",
    ) || [];
  const bskyPost = isBskyPost(record) ? record : null;
  const authorLink = `https://bsky.app/profile/${author.did}`;
  const bskyLink = `https://bsky.app/profile/${author.did}/post/${post.uri.split("/").pop()}`;
  const date = parseJSON(bskyPost?.createdAt || post.indexedAt);
</script>

{#snippet engagement(Icon: typeof IconType, value = 0)}
  <span class="text-dolch-200 flex items-center gap-1">
    <Icon size={16} />
    {value}
  </span>
{/snippet}

<div
  class="flex flex-col gap-4"
  style={depth !== 0 ? `margin-left: calc(var(--spacing) * 4)` : undefined}
>
  {#if !shouldHide}
    <article
      class={[
        "bg-dolch-950 relative flex flex-col gap-4 rounded-lg p-4 text-base",
      ]}
    >
      <header class="flex items-center gap-4 overflow-hidden">
        <img
          width="48"
          height="48"
          alt=""
          src={author.avatar}
          class="rounded-full"
        />
        <div class="text-dolch-100 flex w-full flex-1 flex-col text-sm">
          <a
            href={authorLink}
            rel="noopener nofollow"
            class="break-words break-all whitespace-break-spaces not-italic hover:underline"
          >
            {author.displayName}
          </a>
          <a
            href={authorLink}
            rel="noopener nofollow"
            class="break-words break-all whitespace-break-spaces hover:underline"
          >
            @{author.handle}
          </a>
        </div>
      </header>

      <p class="not-italic">{bskyPost?.text}</p>
      {#if bskyPost?.embed}
        <BskyPostEmbed embed={bskyPost.embed} did={author.did} />
      {/if}

      <footer class="flex flex-col gap-1">
        <div class="text-dolch-200 text-xs">
          {format(date, "yyyy-MM-dd 'at' HH:mm")}
        </div>
        <div class="flex items-center gap-4">
          {@render engagement(Heart, likeCount)}
          {@render engagement(Repeat2, repostCount)}
          {@render engagement(Reply, replyCount)}

          <div class="flex-1"></div>

          <a
            href={bskyLink}
            rel="noopener nofollow"
            class="flex items-center gap-1 hover:underline"
          >
            Go to post <ArrowRight size={20} />
          </a>
        </div>
      </footer>
    </article>
  {/if}

  {#if replies?.length}
    <div
      class={[
        "border-dolch-800 flex flex-col gap-4",
        { "border-l": shouldHide ? depth > 0 : true },
      ]}
    >
      {#each replies as reply}
        <!-- TODO: take care of non-public posts -->
        <BskyPost thread={reply} depth={shouldHide ? 0 : depth + 1} />
      {/each}
    </div>
  {/if}
</div>
