import { css, Global } from '@emotion/core';
import { ThemeProvider } from 'emotion-theming';
import { AppProps } from 'next/app';
import { useEffect, useState } from 'react';

import { LocalStorageEventDetail, storage, Theme } from '../utils';

const App = ({ Component, pageProps }: AppProps) => {
  const [isDark, setDark] = useState(true);
  const theme: Theme = isDark
    ? {
        background: '#000',
        foreground: '#fff',
        filter: 'invert(0%) brightness(100%)',
        filterInvert: 'invert() brightness(300%)',
        __type: 'dark'
      }
    : {
        background: '#fff',
        foreground: '#000',
        filter: 'invert()',
        filterInvert: 'invert() brightness(300%)',
        __type: 'light'
      };

  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)');
    const theme = storage.get('theme');

    const storageListener = ({
      detail: e
    }: CustomEvent<LocalStorageEventDetail>) =>
      e.key === 'theme' && setDark(e.newValue === 'dark');
    const queryListener = (e: MediaQueryListEvent) =>
      !storage.get('theme') && setDark(e.matches);

    if (theme) setDark(theme === 'dark');
    else setDark(query.matches);

    window.addEventListener('localStorage', storageListener);
    query.addListener(queryListener);

    return () => {
      window.removeEventListener('localStorage', storageListener);
      query.removeListener(queryListener);
    };
  }, []);

  return (
    <ThemeProvider theme={theme}>
      <Global
        styles={css`
          :root {
            color-scheme: light dark;
            --fonts: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI',
              Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue',
              sans-serif;
            font-family: var(--fonts);
          }

          *,
          *::after,
          *::before {
            box-sizing: border-box !important;
          }

          body {
            background-color: ${theme.background};
            color: ${theme.foreground};
            margin: 0;
            padding: 0;
            display: flex;
            flex-direction: column;
            min-height: 100vh;
            overflow: hidden;
          }

          body,
          svg > path {
            transition: background-color 0.2s ease-out, color 0.2s ease-out,
              fill 0.2s ease-out;
          }

          #__next {
            flex: 1;
            display: flex;
          }
        `}
      />
      <Component {...pageProps} />
    </ThemeProvider>
  );
};

export default App;
