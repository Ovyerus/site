/** @jsx jsx */
import { css, jsx } from '@emotion/react';
import { NextPage } from 'next';
import { NextSeo } from 'next-seo';

import { Layout, Title, Paragraph, Anchor } from '../components';

const IndexPage: NextPage = () => (
  <Layout mainPage>
    <NextSeo title="Ovyerus" titleTemplate="%s" />

    <Title>Ovyerus</Title>
    <Paragraph>Multifaceted creative. Frontend developer.</Paragraph>

    <Paragraph
      css={css`
        margin-top: 2rem;
        font-size: 1.5rem;
      `}
    >
      Contact/business enquiries:{' '}
      <Anchor href="mailto:michael@ovyerus.com">michael@ovyerus.com</Anchor>
    </Paragraph>
  </Layout>
);

export default IndexPage;
