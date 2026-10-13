# site

Source code for my personal website, [ovyerus.com](https://ovyerus.com)

## Development

Use Node.js 24 or newer and pnpm 12.9.0. The Nix shell provides both plus the
native libraries used by the build:

```sh
nix develop
pnpm install --frozen-lockfile
pnpm dev
```

Run `pnpm build` for production output, then `pnpm preview` to serve it locally.
Run `pnpm test --run --exclude '.direnv/**'` for the test suite without picking
up Nix source copies. `nix build .#site` and `nix build .#container` build the
offline site package and deployment image.

## License

The source code in this repository is licensed under the
[zlib License](./LICENSE), but post content - `./src/content/posts/*.md` and
`./src/content/weeknotes/*.md` - is licensed under a
[Creative Commons CC-BY-NC-SA 4.0 International License](https://creativecommons.org/licenses/by-nc-sa/4.0/)
