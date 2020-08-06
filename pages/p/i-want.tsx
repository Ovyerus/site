/** @jsx jsx */
import { css, jsx } from '@emotion/core';
import { NextPage } from 'next';

// import { promises as fs, existsSync } from 'fs';
// import path from 'path';

import { Anchor } from '../../components';

const P: NextPage = () => (
  <main
    css={css`
      display: flex;
      flex-direction: column;
      font-weight: 200;
      width: 60ch;
      margin: 6rem auto 4rem;
      font-variation-settings: 'MONO' 1;

      & p {
        margin: 0.25em 1em;
      }
    `}
  >
    <h1>i want</h1>
    <p>i want to run away sometimes.</p>

    <p>i want to escape this lifestyle.</p>
    <p>i want to define myself.</p>
    <p>i want to create.</p>
    <p>
      i want to create many things.
      <br />
      &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;in so many different ways.
    </p>

    <div
      css={css`
        margin-bottom: 1.5em;
      `}
    />

    <p>i want to learn.</p>
    <p>i want to be well.</p>
    <p>i want to be happy with myself.</p>
    <p>i want time to do everything.</p>
    <p>i want to understand.</p>
    <p>i want to feel.</p>
    <p>i want to love.</p>

    <div
      css={css`
        margin-bottom: 1.5em;
      `}
    />

    <p>
      i want quiet.
      <br />
      &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;and the loudest sounds.
    </p>
    <p>
      i want everything.
      <br />
      &nbsp;&nbsp;&nbsp;&nbsp;
      <span
        css={css`
          font-size: smaller;
        `}
      >
        and nothing at all.
      </span>
    </p>
    <p>i want to be vulnerable.</p>
    <p>i want to defensive.</p>
    <p>i want to experience.</p>

    <div
      css={css`
        margin-bottom: 1.5em;
      `}
    />

    <p>i want to understand myself.</p>

    <p
      css={css`
        margin-top: 2em !important;
        color: #1a1a1a;
      `}
    >
      <em>
        i feel like this world wants me to be one thing, but that's not who i
        am.
      </em>
      <p>
        <em>i wish i was told earlier.</em>
        <p>
          <em>
            a way out? a guiding light?
            <span
              css={css`
                margin-left: 2ch;
                color: var(--fg);
              `}
            >
              perhaps
            </span>
          </em>
        </p>
      </p>
    </p>
  </main>
);

// async function* walk(dir: string): AsyncGenerator<string, void> {
//   for await (const d of await fs.opendir(dir)) {
//     const entry = path.join(dir, d.name);

//     if (d.isDirectory()) yield* walk(entry);
//     else if (d.isFile()) yield entry;
//   }
// }

// export async function getStaticPaths() {
//   const paths = [];

//   for await (const p of walk(path.resolve(process.cwd(), './assets/p')))
//     if (p.endsWith('.md')) {
//       const slug = p.slice(0, -3).split(path.sep);
//       paths.push({ params: { slug } });
//     }

//   return { paths, fallback: false };
// }

// export async function getStaticProps({ params: { slug } }) {
//   const path = `../../assets/p/${slug.join('/')}.md`;
//   const data = existsSync(path)
//     ? await fs.readFile(path, { encoding: 'utf-8' })
//     : '';

//   if (!data) return { props: { title: null, body: null } };
//   else {
//     const [title, ...body] = data.split('\n');
//     return {
//       title: (title.startsWith('#') ? title.slice(1) : title).trim(),
//       body: body.join('\n'),
//     };
//   }
// }

export default P;
