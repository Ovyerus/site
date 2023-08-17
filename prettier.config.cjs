/** @type import('prettier').Config */
export default {
  plugins: [
    import("prettier-plugin-astro"),
    import("prettier-plugin-tailwindcss"),
  ],
  proseWrap: "always",
  overrides: [
    {
      files: "*.astro",
      options: { parser: "astro" },
    },
  ],
};
