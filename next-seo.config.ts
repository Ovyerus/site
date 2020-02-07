import { NextSeoProps } from 'next-seo';

const description = 'Multifaceted creative - design, music, and code.';
const url = 'https://ovyerus.com';

export default {
  titleTemplate: '%s | Ovyerus',
  description,
  openGraph: {
    type: 'website',
    title: 'Ovyerus',
    url,
    description,
    site_name: 'Ovyerus'
  },
  twitter: {
    cardType: 'summary',
    handle: '@ovyerus',
    site: '@ovyerus'
  }
} as NextSeoProps;
