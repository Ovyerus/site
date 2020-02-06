/** @jsx jsx */
import { css, jsx } from '@emotion/core';
import { NextPage } from 'next';
import Link_, { LinkProps } from 'next/link';
import React from 'react';

import { Layout, Title, Paragraph, Anchor, ThemeToggle } from '../components';

const Link: React.FC<LinkProps> = ({ children, ...props }) => (
  <Link_ {...props} passHref>
    <Anchor>{children}</Anchor>
  </Link_>
);

const IndexPage: NextPage = () => (
  <Layout withFooter>
    <ThemeToggle />
    <Title>Ovyerus</Title>
    <Paragraph>
      Multifaceted creative
      <br />- <Anchor href="https://dribbble.com/ovyerus">design</Anchor>,{' '}
      {/* <Link href="/music">music</Link> */} music, and{' '}
      <Link href="/code">code</Link>.
    </Paragraph>

    <Paragraph
      css={css`
        margin-top: 2rem;
        font-size: 1.5rem;
      `}
    >
      Contact/business enquiries:{' '}
      <Anchor href="mailto:me@ovyerus.com">me@ovyerus.com</Anchor>
    </Paragraph>
  </Layout>
);

export default IndexPage;
