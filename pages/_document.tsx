import Document_, { Html, Head, Main, NextScript } from 'next/document';

class Document extends Document_ {
  render() {
    return (
      <Html lang="en-gb">
        <Head>
          <meta charSet="UTF-8" />
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1.0"
          />
          <meta httpEquiv="X-UA-Compatible" content="ie=edge" />

          <link
            rel="stylesheet"
            href="/dark.css"
            media="(prefers-color-scheme: dark)"
          />
          <link
            rel="stylesheet"
            href="/light.css"
            media="(prefers-color-scheme: no-preference), (prefers-color-scheme: light)"
          />
        </Head>
        <body>
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}
export default Document;
