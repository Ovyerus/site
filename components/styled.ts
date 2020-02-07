import styled from '@emotion/styled';

import background from '../assets/bg.webp';

export const Title = styled.h1<{ smaller?: boolean }>`
  font-family: 'Helvetica Now', var(--fonts);
  font-size: ${({ smaller }) => (smaller ? '6rem' : '8rem')};
  font-weight: 900;
  background: url(${background});
  background-position: center center;
  background-clip: text;
  color: transparent;
  margin: 0;
  text-transform: lowercase;
  filter: var(--bg-filter);
  transform: scaleX(120%);
  transform-origin: left;
`;

export const Paragraph = styled.p`
  margin: 0;
  font-size: 2rem;
`;

export const Paragraph2 = styled.p`
  margin: 0;
  font-size: 1.5rem;
  /* max-width: 40ch; */
`;

export const Anchor = styled.a`
  font-weight: 700;
  color: var(--fg);

  &:not([href^='mailto']) {
    background: url(${background});
    background-position: center center;
    background-clip: text;
    color: transparent;
    filter: var(--bg-filter);
    transition: filter 0.2s ease-out;

    &:hover {
      filter: var(--bg-filter-opposite);
    }
  }

  &[href^='mailto'] {
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }
`;
