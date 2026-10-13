import { getEmDashCollection, getEmDashEntry } from "emdash";
import type { CommentsProp } from "./types";

interface ArticleData {
  body: string;
  description?: string;
  comments?: CommentsProp;
}
interface PostData extends ArticleData {
  title: string;
  description: string;
  tags: string[];
  written_at: Date;
  modified_at?: Date;
}
interface WeeknoteData extends ArticleData {
  subtitle?: string;
}
interface ArticleEntry<D> {
  id: string;
  body: string;
  data: D;
}
export type PostEntry = ArticleEntry<
  PostData & { createdAt: Date; modifiedAt?: Date }
>;
export type WeeknoteEntry = ArticleEntry<WeeknoteData>;
type Articles = { posts: PostEntry; weeknotes: WeeknoteEntry };
type StoredData = { posts: PostData; weeknotes: WeeknoteData };

function article<C extends keyof Articles>(
  collection: C,
  entry: { id: string; data: StoredData[C] },
): Articles[C] {
  const data = entry.data;
  if (collection === "posts") {
    const post = data as PostData;
    return {
      id: entry.id,
      body: post.body,
      data: {
        ...post,
        createdAt: new Date(post.written_at),
        modifiedAt: post.modified_at ? new Date(post.modified_at) : undefined,
      },
    } as Articles[C];
  }
  return { id: entry.id, body: data.body, data } as Articles[C];
}

export async function getArticles<C extends keyof Articles>(
  collection: C,
): Promise<Articles[C][]> {
  const { entries, error } = await getEmDashCollection<C, StoredData[C]>(
    collection,
  );
  if (error) throw error;
  return entries.map((entry) => article(collection, entry));
}

export async function getArticle<C extends keyof Articles>(
  collection: C,
  slug: string,
): Promise<Articles[C] | undefined> {
  const { entry, error } = await getEmDashEntry<C, StoredData[C]>(
    collection,
    slug,
  );
  if (error) throw error;
  return entry ? article(collection, entry) : undefined;
}
