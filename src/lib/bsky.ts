import type {
  $type,
  Blob,
  InferInput,
  InferXRPCBodyOutput,
  LegacyBlob,
} from "@atcute/lexicons";
import type {
  AppBskyFeedDefs,
  AppBskyFeedGetPostThread,
  AppBskyFeedPost,
} from "@atcute/bluesky";
import { isBlob } from "@atcute/lexicons/interfaces";

export type ThreadView = $type.enforce<AppBskyFeedDefs.ThreadViewPost>;
export type BlueskyPost = AppBskyFeedPost.Main;

export const isThreadView = (thread: unknown): thread is ThreadView =>
  (thread as any)?.$type === "app.bsky.feed.defs#threadViewPost";
export const isBskyPost = (post: unknown): post is BlueskyPost =>
  (post as any)?.$type === "app.bsky.feed.post";

type GetPostThreadParams = InferInput<
  AppBskyFeedGetPostThread.mainSchema["params"]
>;
type GetPostThreadOutput = InferXRPCBodyOutput<
  AppBskyFeedGetPostThread.mainSchema["output"]
>;

export const fetchBskyThread = async (
  did: string,
  postCid: string,
): Promise<GetPostThreadOutput> => {
  const params: GetPostThreadParams = {
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

export const getBskyCdnLink = (
  did: string,
  blob: Blob<string> | LegacyBlob<string>,
  ext: string,
) =>
  `https://cdn.bsky.app/img/feed_fullsize/plain/${did}/${blobCid(blob)}@${ext}`;

export const blobCid = (blob: Blob<string> | LegacyBlob<string>) =>
  isBlob(blob) ? blob.ref.$link : blob.cid;
