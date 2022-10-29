import tailwind from "@astrojs/tailwind";
import prefetch from "@astrojs/prefetch";
import { defineConfig } from "astro/config";
import compress from "astro-compress";

// https://astro.build/config
export default defineConfig({
  integrations: [tailwind(), prefetch(), compress()],
  site: "https://ovyerus.com",
});
