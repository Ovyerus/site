import { defineMiddleware } from "astro:middleware";
import { replayToPrimary } from "./primary-routing";

export const onRequest = defineMiddleware((context, next) => {
  return replayToPrimary(context.request) ?? next();
});
