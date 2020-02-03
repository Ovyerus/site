/** @jsx jsx */
import { css, jsx } from '@emotion/core';
import React from 'react';

export const Layout: React.FC<{ withFooter?: boolean }> = ({
  withFooter,
  children
}) => (
  <>
    <main
      css={css`
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: center;
        margin: 4rem;
      `}
    >
      {children}
    </main>

    {withFooter && (
      <footer
        css={css`
          padding: 1rem;
          position: absolute;
          bottom: 0;
          width: 100%;
        `}
      >
        <ul
          css={css`
            list-style: none;
            display: flex;

            & > li {
              margin-right: 0.5rem;
            }
          `}
        >
          <li></li>
          <li></li>
          <li></li>
          <li></li>
        </ul>
      </footer>
    )}
  </>
);
