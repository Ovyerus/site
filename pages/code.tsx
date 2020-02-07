/** @jsx jsx */
import { css, jsx } from '@emotion/core';
import { NextPage } from 'next';

import { Layout, Title, Paragraph2, Anchor } from '../components';
import { NextSeo } from 'next-seo';

const CodePage: NextPage = () => (
  <Layout>
    <NextSeo title="Code" />

    <Title smaller>Code</Title>
    <div
      css={css`
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        grid-gap: 1rem;
      `}
    >
      <Paragraph2>
        Work in progress. In the meanwhile, visit{' '}
        <Anchor href="https://github.com/ovyerus">github.com/Ovyerus</Anchor>{' '}
        for current experience.
      </Paragraph2>
    </div>
  </Layout>
);

export default CodePage;
