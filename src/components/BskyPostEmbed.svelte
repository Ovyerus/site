<script lang="ts">
  import type {
    AppBskyEmbedExternal,
    AppBskyEmbedImages,
  } from "@atcute/client/lexicons";
  import { ExternalLink } from "@lucide/svelte";
  import { type BlueskyPost, getBskyCdnLink } from "~lib/bsky";

  interface Props {
    did: string;
    embed: Exclude<BlueskyPost["embed"], undefined>;
  }

  const { did, embed }: Props = $props();
</script>

{#snippet images(images: AppBskyEmbedImages.Image[])}
  {#snippet popoverImage(
    cid: string,
    alt: string,
    buttonClass: any,
    imageClass: any,
  )}
    <button class={buttonClass} popovertarget={cid}>
      <img {alt} src={getBskyCdnLink(did, cid, "jpeg")} class={imageClass} />
    </button>

    <div
      id={cid}
      class="fixed inset-0 m-auto bg-transparent text-white backdrop:bg-black/50"
      popover
    >
      <!-- TODO: figure out better sizing so that the alt text can fit in below it as a paragraph... -->
      <img
        {alt}
        src={getBskyCdnLink(did, cid, "png")}
        loading="lazy"
        class="max-h-[calc(100vh-var(--spacing)*20)] max-w-[calc(100vw-var(--spacing)*20)] object-contain object-center"
      />
    </div>
  {/snippet}

  {#if images.length === 1}
    {@const { alt, image } = images[0]!}
    {@render popoverImage(
      image.ref.$link,
      alt,
      "max-h-96 max-w-96 cursor",
      "rounded-lg",
    )}
  {:else}
    <div
      class="grid h-96 grid-cols-2 grid-rows-2 gap-2 overflow-hidden rounded-lg"
    >
      {#each images as { alt, image }, i}
        {@render popoverImage(
          image.ref.$link,
          alt,
          [
            "bg-dolch-900 flex cursor-pointer items-center justify-center",
            {
              // First item when 3 or less items, or the second item when 2 items.
              "row-span-2":
                (images.length <= 3 && i === 0) ||
                (images.length === 2 && i === 1),
              "col-span-2": images.length === 1,
            },
          ],
          "h-full w-full object-contain object-center",
        )}
      {/each}
    </div>
  {/if}
{/snippet}

{#snippet external({
  description,
  title,
  thumb,
  uri,
}: AppBskyEmbedExternal.External)}
  <a
    href={uri}
    rel="noopener nofollow"
    class="border-dolch-800 hover:border-dolch-600 flex max-w-96 cursor-pointer flex-col overflow-hidden rounded-lg border p-2"
  >
    {#if thumb}
      <img
        alt={title}
        src={getBskyCdnLink(did, thumb.ref.$link, "jpeg")}
        class="mb-2 rounded"
      />
    {/if}
    <h3
      class="text-dolch-50 flex gap-1 text-wrap break-words break-all not-italic"
    >
      {title}
      <div class="mt-1">
        <ExternalLink size={16} class="text-dolch-200" />
      </div>
    </h3>
    <p class="text-dolch-200 text-sm">{description}</p>
  </a>
{/snippet}

{#if embed.$type === "app.bsky.embed.images"}
  {@render images(embed.images)}
{:else if embed.$type === "app.bsky.embed.external"}
  {@render external(embed.external)}
{:else}
  <div>
    Embed type <code class="bg-dolch-800 rounded px-1">{embed.$type}</code>
    not yet implemented.
  </div>
{/if}
