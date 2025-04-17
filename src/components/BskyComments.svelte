<script lang="ts">
  import { fetchBskyThread, isThreadView } from "~lib/bsky";
  import BskyPost from "./BskyPost.svelte";

  interface Props {
    did: string;
    postCid: string;
    hideFirst?: boolean;
  }

  let { did, postCid, hideFirst = true }: Props = $props();

  const fetchThread = fetchBskyThread(did, postCid).then((res) => {
    if (isThreadView(res.thread)) return res.thread;
    else throw res;
  });
</script>

<div class="mt-6 flex flex-col gap-6">
  {#await fetchThread}
    Loading comments from Bluesky...
    <noscript>You need to turn on JavaScript to see comments.</noscript>
  {:then thread}
    <p class="text-base not-italic">
      Let me know any thoughts or questions over <a
        href={`https://bsky.app/profile/${thread.post.author.did}/post/${thread.post.uri.split("/").pop()}`}
        class="from-magenta to-cyan bg-gradient-to-r bg-clip-text underline hover:text-transparent"
      >
        on Bluesky.
      </a>
    </p>
    <BskyPost {thread} {hideFirst} />
  {:catch error}
    aw shucks {error.message}
  {/await}
</div>
