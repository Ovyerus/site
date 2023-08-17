/** @type import('prettier').Config */
module.exports = {
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
