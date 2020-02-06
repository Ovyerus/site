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
        filterInvert: 'invert(100%) brightness(150%)',
        stroke: 'none',
        __type: 'dark'
      }
    : {
        background: '#fff',
        foreground: '#000',
        filter: 'contrast(115%)',
        filterInvert: 'invert(100%) brightness(150%)',
        stroke: '1px rgba(0, 0, 0, 0.75)',
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

  // useEffect(() => {
  //   const docData = document.documentElement.dataset;
  //   const listener = ({ detail: e }: CustomEvent<LocalStorageEventDetail>) => {
  //     if (e.key === 'theme') docData.theme = e.newValue;
  //     setDarkMode(isDarkTheme());
  //   };

  //   const theme = storage.get('theme');
  //   if (theme) docData.theme = theme;
  //   else
  //     docData.theme = matchMedia('(prefers-color-scheme: dark)').matches
  //       ? 'dark'
  //       : 'light';

  //   window.addEventListener('localStorage', listener);
  //   return () => window.removeEventListener('localStorage', listener);
  // });

  // useEffect(() => {
  //   const docData = document.documentElement.dataset;
  //   const query = matchMedia('(prefers-color-scheme: dark)');
  //   const listener = (e: MediaQueryListEvent) => {
  //     if (!storage.get('theme')) docData.theme = e.matches ? 'dark' : 'light';
  //     setDarkMode(isDarkTheme());
  //   };

  //   query.addListener(listener);
  //   return () => query.removeListener(listener);
  // });

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
            background: ${theme.background};
            color: ${theme.foreground};
            margin: 0;
            padding: 0;
            display: flex;
            flex-direction: column;
            min-height: 100vh;
            overflow: hidden;
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
