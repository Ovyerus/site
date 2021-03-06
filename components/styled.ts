import styled from '@emotion/styled';

import background from '../assets/bg.webp';

export const Title = styled.h1<{ smaller?: boolean }>`
  font-family: 'Helvetica Now', var(--fonts);
  font-size: ${({ smaller }) => (smaller ? '6rem' : '8rem')};
  font-weight: 900;
  margin: 0;
  text-transform: lowercase;
  filter: var(--bg-filter);
  transform: scaleX(120%);
  transform-origin: left;
  background: url(${background}), linear-gradient(to bottom, #fff0e5, #ffa46e);
  background-position: center center;
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;

  @media screen and (max-width: 500px) {
    font-size: 3rem;
    margin-bottom: 1rem;
  }
`;

export const Paragraph = styled.p`
  margin: 0;
  font-size: 2rem;

  @media screen and (max-width: 500px) {
    font-size: 1.5rem;
  }
`;

export const Paragraph2 = styled.p`
  margin: 0;
  font-size: 1.5rem;
  /* max-width: 40ch; */
  /* @media screen and (max-width: 500px) {
    font-size: 1rem;
  } */
`;

export const Anchor = styled.a`
  font-weight: 700;
  color: var(--fg);

  &:not([href^='mailto']) {
    background: url(${background}), linear-gradient(to bottom, #fff0e5, #ffa46e);
    background-position: center center;
    background-clip: text;
    -webkit-background-clip: text;
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
