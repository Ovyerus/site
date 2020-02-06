/** @jsx jsx */
import { css, jsx } from '@emotion/core';
import { mdiBrightness2, mdiBrightness4 } from '@mdi/js';
import Icon from '@mdi/react';
import { useTheme } from 'emotion-theming';

import { isDarkTheme, storage, Theme } from '../utils';

export const ThemeToggle = () => {
  const toggle = () =>
    isDarkTheme()
      ? storage.set('theme', 'light')
      : storage.set('theme', 'dark');

  const theme = useTheme<Theme>();
  const path = theme.__type == 'dark' ? mdiBrightness4 : mdiBrightness2;

  return (
    <button
      css={css`
        appearance: none;
        background: none;
        border: none;
        cursor: pointer;
        padding: 0;
        position: fixed;
        top: 16px;
        right: 16px;
      `}
      onClick={toggle}
    >
      <Icon color={theme.foreground} path={path} size={1.5} />
    </button>
  );
};
