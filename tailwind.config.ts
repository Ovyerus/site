import type { Config } from "tailwindcss";
import type { PluginAPI } from "tailwindcss/types/config";
import defaultTheme from "tailwindcss/defaultTheme";

export default {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  theme: {
    fontFamily: {
      sans: ["Montserrat", ...defaultTheme.fontFamily.sans],
      mono: ["Iosevka", ...defaultTheme.fontFamily.mono],
    },
    extend: {
      typography: (theme: PluginAPI["theme"]) => ({
        invert: {
          css: {
            "--tw-prose-invert-bullets": "#0ff",
            "--tw-prose-invert-counters": "#0ff",
            "--tw-prose-invert-quote-borders": "transparent",
            hr: {
              borderTopWidth: "0",
              height: "1px",
              background: "linear-gradient(to right, #f0f, #0ff)",
            },
            "a:hover": {
              background: "linear-gradient(to bottom right, #f0f, #0ff)",
              backgroundClip: "text",
              color: "transparent",
            },
            pre: {
              fontStyle: "normal",
            },
            code: {
              position: "relative",
              background: "linear-gradient(to right, #f0f, #0ff)",
              backgroundClip: "text",
              color: "transparent",
              paddingTop: theme("padding[1]"),
              paddingRight: theme("padding[1.5]"),
              paddingBottom: theme("padding[1]"),
              paddingLeft: theme("padding[1.5]"),
              fontSize: theme("fontSize.base"),
            },
            blockquote: {
              position: "relative",
            },
            "blockquote::before": {
              content: "''",
              display: "block",
              position: "absolute",
              background: "linear-gradient(to bottom, #f0f, #0ff)",
              width: "0.25rem",
              left: "0",
              top: "0",
              bottom: "0",
            },
            figure: {
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            },
            figcaption: {
              fontStyle: "italic",
              color: "white",
              opacity: "0.75",
              maxWidth: "500px",
              textAlign: "center",
              width: "100%",
            },
            "figure img": {
              maxHeight: "500px",
              width: "auto",
              height: "100%",
              borderRadius: theme("borderRadius.md"),
            },
            "figure video": {
              maxHeight: "500px",
              width: "auto",
              height: "100%",
              borderRadius: theme("borderRadius.md"),
              margin: 0,
            },
          },
        },
      }),
    },
  },
  plugins: [require("@tailwindcss/typography")],
} satisfies Config;
