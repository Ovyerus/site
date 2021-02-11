import { css, Global } from '@emotion/react';
import { AppProps } from 'next/app';
import Head from 'next/head';
import { DefaultSeo } from 'next-seo';

import SEO from '../next-seo.config';

const App = ({ Component, pageProps }: AppProps) => (
  <>
    <DefaultSeo {...SEO} />
    <Global
      styles={css`
        :root {
          --fonts: Recursive, -apple-system, BlinkMacSystemFont, 'Segoe UI',
            Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue',
            sans-serif;
          font-family: var(--fonts);
          --bg: #000;
          --fg: #fff;
          --bg-filter: invert(0%) brightness(100%);
          --bg-filter-opposite: invert() brightness(300%);
        }

        *,
        *::after,
        *::before {
          box-sizing: border-box !important;
        }

        body {
          background: var(--bg);
          color: var(--fg);
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          min-height: 100vh;
        }

        #__next {
          flex: 1;
          display: flex;
        }
      `}
    />
    <Head>
      <link
        href="https://fonts.googleapis.com/css2?family=Recursive:slnt,wght,MONO@-15..0,300..800,0..1&display=swap"
        rel="stylesheet"
      />
    </Head>

    <Component {...pageProps} />
  </>
);

export default App;
