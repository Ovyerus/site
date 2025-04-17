import type {
  AppBskyFeedDefs,
  AppBskyFeedGetPostThread,
  AppBskyFeedPost,
  Brand,
} from "@atcute/client/lexicons";

export type ThreadView = Brand.Union<AppBskyFeedDefs.ThreadViewPost>;
export type BlueskyPost = AppBskyFeedPost.Record;

export const isThreadView = (thread: unknown): thread is ThreadView =>
  (thread as any)?.$type === "app.bsky.feed.defs#threadViewPost";
export const isBskyPost = (post: unknown): post is BlueskyPost =>
  (post as any)?.$type === "app.bsky.feed.post";

export const fetchBskyThread = async (
  did: string,
  postCid: string,
): Promise<AppBskyFeedGetPostThread.Output> => {
  const params: AppBskyFeedGetPostThread.Params = {
    uri: `at://${did}/app.bsky.feed.post/${postCid}`,
    depth: 6,
  };
  const search = new URLSearchParams(params as Record<string, any>);
  const res = await fetch(
    `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?${search}`,
  );
  const body = await res.json();

  return body;
};

export const getBskyCdnLink = (did: string, cid: string, ext: string) =>
  `https://cdn.bsky.app/img/feed_fullsize/plain/${did}/${cid}@${ext}`;
