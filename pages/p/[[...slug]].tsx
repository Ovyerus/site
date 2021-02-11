/** @jsx jsx */
import { css, jsx } from '@emotion/react';
import { NextPage } from 'next';

import { Anchor } from '../../components';

const P: NextPage = () => (
  <main
    css={css`
      font-weight: 200;
      width: 60ch;
      margin: 6rem auto 4rem;
      font-variation-settings: 'MONO' 1;
    `}
  >
    <p>
      xxx <Anchor href="https://twitter.com/Ovyerus">❤️</Anchor>
    </p>
  </main>
);

export default P;
