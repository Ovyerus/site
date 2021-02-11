import { css, jsx } from '@emotion/react';
import Icon from '@mdi/react';
import React from 'react';
import dribbble from 'simple-icons/icons/dribbble';
import github from 'simple-icons/icons/github';
import keybase from 'simple-icons/icons/keybase';
import linkedin from 'simple-icons/icons/linkedin';

const media = [
  {
    path: github.path,
    href: 'https://github.com/ovyerus',
    label: 'Visit my profile on GitHub.'
  },
  {
    path: dribbble.path,
    href: 'https://dribbble.com/ovyerus',
    label: 'Visit my profile on Dribbble.'
  },
  {
    path: keybase.path,
    href: 'https://keybase.io/ovyerus',
    label: 'Visit my other miscellaneous social media linked on Keybase.'
  },
  {
    path: linkedin.path,
    href: 'https://www.linkedin.com/in/ovyerus',
    label: 'Visit my profile on LinkedIn.'
  }
];

const Footer: React.FC = () => (
  <footer
    css={css`
      padding: 24px;
      position: absolute;
      bottom: 0;
      width: 100%;
    `}
  >
    <ul
      css={css`
        list-style: none;
        display: flex;
        padding: 0;
        margin: 0;

        & > li {
          margin-right: 24px;
        }
      `}
    >
      {media.map(({ href, path, label }) => (
        <li key={href}>
          <a href={href} aria-label={label}>
            <Icon color="var(--fg)" path={path} size={1.5} />
          </a>
        </li>
      ))}
    </ul>
  </footer>
);

export const Layout: React.FC<{ mainPage?: boolean }> = ({
  mainPage,
  children
}) => (
  <>
    <main
      css={css`
        flex: 1;
        display: flex;
        flex-direction: column;
        ${mainPage &&
          css`
            justify-content: center;
          `};
        margin: 4rem;

        @media screen and (max-width: 500px) {
          margin: 2rem;
        }
      `}
    >
      {children}
    </main>

    {mainPage && <Footer />}
  </>
);
