import styled from '@emotion/styled';

import { Theme } from '../utils';

import background from '../assets/bg.webp';

type Props = { theme?: Theme };

export const Title = styled.h1<Props>`
  font-family: 'Helvetica Now', var(--fonts);
  font-size: 8rem;
  font-weight: 900;
  background-image: url(${background}),
    linear-gradient(to bottom, #fff0e5, #ffa46e);
  background-position: center center;
  background-clip: text;
  color: transparent;
  margin: 0;
  text-transform: lowercase;
  filter: ${({ theme }) => theme.filter};
  transform: scaleX(120%);
  transform-origin: left;
  transition: filter 0.2s ease-out;
`;

export const Paragraph = styled.p`
  margin: 0;
  font-size: 2rem;
`;

export const Anchor = styled.a<Props>`
  font-weight: 700;
  color: var(--fg);

  &:not([href^='mailto']) {
    background-image: url(${background}),
      linear-gradient(to bottom, #fff0e5, #ffa46e);
    background-position: center center;
    background-clip: text;
    color: transparent;
    filter: ${({ theme }) => theme.filter};
    transition: filter 0.2s ease-out;

    &:hover {
      filter: ${({ theme }) => theme.filterInvert};
    }
  }

  &[href^='mailto'] {
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }
`;
