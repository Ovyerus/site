/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />
/// <reference types="@atcute/bluesky/lexicons" />

declare module "*.txt" {
  export const plainText: string;
}
