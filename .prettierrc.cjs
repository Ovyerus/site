/** @type import('prettier').Config */
module.exports = {
  plugins: [
    require.resolve("prettier-plugin-astro"),
    require.resolve("prettier-plugin-tailwindcss"),
  ],
  pluginSearchDirs: false,
  proseWrap: "always",
  overrides: [
    {
      files: "*.astro",
      options: { parser: "astro" },
    },
  ],
};
