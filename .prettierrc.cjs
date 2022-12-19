/** @type import('prettier').Config */
module.exports = {
  plugins: [require.resolve("prettier-plugin-astro")],
  proseWrap: "always",
  overrides: [
    {
      files: "*.astro",
      options: { parser: "astro" },
    },
  ],
};
