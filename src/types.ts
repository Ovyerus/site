export interface PostFrontmatter {
  title: string;
  createdAt: string;
  modifiedAt?: string;
  description?: string;
  navCurrent?: string;
  comments?: boolean;
  preamble?: string;
  tags?: string[];
}
