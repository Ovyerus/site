import { describe, expect, test, vi } from "vitest";
import { getWeeknoteStrings } from "../src/lib/weeknotes";
import {
  buildDocument,
  createStandardClient,
  documentUri,
  makeStandardRkey,
  publicationRecord,
  publicationRkey,
  publicationUri,
  standardConfig,
  standardDid,
  type PublishedArticle,
} from "../src/lib/standard-site";
const collection = "site.standard.document";
const cid = "bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const rkey = makeStandardRkey("2026-10-01T00:00:00Z", "posts:one");
const uri = documentUri(rkey);
const config = { pdsUrl: "https://pds.example", password: "secret-password" };
const article = (data: Record<string, unknown> = {}): PublishedArticle => ({
  collection: "posts",
  entryId: "one",
  slug: "hello",
  publishedAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z",
  data: { title: "Hello", body: "A **fine** post.", ...data },
});
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
const auth = () => response({ did: standardDid, accessJwt: "secret-jwt" });
function fake(...replies: (Response | Error)[]) {
  return vi.fn<typeof fetch>(async () => {
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    if (!reply) throw new Error("unexpected request");
    return reply;
  });
}

describe("Standard.site record builders", () => {
  test("stable valid TIDs and publication identity", () => {
    expect(rkey).toMatch(
      /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/,
    );
    expect(publicationRkey).toMatch(
      /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/,
    );
    expect(makeStandardRkey("2026-10-01T00:00:00Z", "posts:one")).toBe(rkey);
    expect(makeStandardRkey("2026-10-01T00:00:00Z", "posts:two")).not.toBe(
      rkey,
    );
    expect(publicationUri).toBe(
      `at://${standardDid}/site.standard.publication/${publicationRkey}`,
    );
    expect(publicationRecord()).toMatchObject({
      $type: "site.standard.publication",
      url: "https://ovyerus.com",
    });
    expect(() => documentUri("self")).toThrow();
    expect(() => makeStandardRkey("invalid", "one")).toThrow();
    expect(() => makeStandardRkey("1960-01-01", "one")).toThrow();
  });
  test("post metadata follows website dates and only allowlisted live data", () => {
    const doc = buildDocument(
      article({
        written_at: "2025-02-01",
        modified_at: "2026-03-01",
        description: "Summary",
        tags: ["code"],
        teaser: "PRIVATE",
        comments: { bsky: { postCid: "actually-rkey" } },
        private: "secret",
      }),
    );
    expect(doc).toMatchObject({
      site: publicationUri,
      path: "/posts/hello",
      title: "Hello",
      publishedAt: "2025-02-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
      description: "Summary",
      tags: ["code"],
      textContent: "A fine post.",
    });
    expect(doc).not.toHaveProperty("teaser");
    expect(doc).not.toHaveProperty("bskyPostRef");
    expect(doc).not.toHaveProperty("private");
  });
  test("Unicode paths and article-relative links use the same canonical URL", () => {
    const doc = buildDocument({
      ...article({
        body: '[anchor](#heading) [relative](./other) [parent](../index) ![asset](./asset.png) <video src="./movie.mp4" poster="./poster.jpg"></video>',
      }),
      slug: "café-猫",
    });
    expect(doc.path).toBe("/posts/caf%C3%A9-%E7%8C%AB");
    expect(doc.textContent).toContain(
      "anchor (https://ovyerus.com/posts/caf%C3%A9-%E7%8C%AB#heading)",
    );
    expect(doc.textContent).toContain(
      "relative (https://ovyerus.com/posts/other)",
    );
    expect(doc.textContent).toContain("parent (https://ovyerus.com/index)");
    expect(doc.textContent).toContain("https://ovyerus.com/posts/asset.png");
    expect(doc.textContent).toContain("https://ovyerus.com/posts/movie.mp4");
    expect(doc.textContent).toContain("https://ovyerus.com/posts/poster.jpg");
  });
  test("weeknotes use shared title and ISO week ending", () => {
    const input = article({ title: "ignored", body: "Week!" });
    input.collection = "weeknotes";
    input.slug = "2026-w01";
    expect(buildDocument(input)).toMatchObject({
      title: "Weeknote 01, 2026",
      path: "/weeknotes/2026-w01",
      publishedAt: getWeeknoteStrings("2026-w01").createdAt.toISOString(),
    });
  });
  test("plaintext strips Markdown and active HTML but retains useful URLs", () => {
    const doc = buildDocument(
      article({
        body: '# Heading\n\n**Bold** and [link](/posts/other). ![cat](/cat.png)\n\n<div>HTML &amp; text<script>secret()</script><style>private</style></div>\n\n<video src="https://cdn.example/movie.mp4" poster="/poster.jpg"></video>\n\n```js\nconst n = 1;\n```'.replaceAll(
          "\\n",
          "\n",
        ),
      }),
    );
    expect(doc.textContent).toContain("Heading");
    expect(doc.textContent).toContain(
      "Bold and link (https://ovyerus.com/posts/other)",
    );
    expect(doc.textContent).toContain("cat https://ovyerus.com/cat.png");
    expect(doc.textContent).toContain("HTML & text");
    expect(doc.textContent).toContain("https://cdn.example/movie.mp4");
    expect(doc.textContent).toContain("https://ovyerus.com/poster.jpg");
    expect(doc.textContent).toContain("const n = 1;");
    expect(doc.textContent).not.toMatch(
      /<\/?(?:div|video|script)|secret\(\)|private|\*\*|```/,
    );
  });
  test.each([
    { title: "x".repeat(501) },
    { title: 5 },
    { description: "x".repeat(3001) },
    { tags: ["x".repeat(129)] },
    { tags: "tag" },
    { tags: [1] },
    { body: null },
    { written_at: "broken" },
    { modified_at: 123 },
    { title: "\ud800" },
  ])("rejects invalid or over-limit metadata %j", (data) => {
    expect(() => buildDocument(article(data))).toThrow();
  });
  test("graphemes and UTF8 bytes are separately constrained without truncation", () => {
    expect(buildDocument(article({ title: "👩‍💻".repeat(400) })).title).toBe(
      "👩‍💻".repeat(400),
    );
    expect(() =>
      buildDocument(
        article({ title: ("a" + "\u0301".repeat(30)).repeat(100) }),
      ),
    ).toThrow();
    expect(() => buildDocument(article({ body: "a".repeat(900_000) }))).toThrow(
      /900000/,
    );
  });
  test.each([
    "../secret",
    "..",
    "a?draft=true",
    "a#hash",
    "a\\b",
    "a b",
    "a%2Fb",
    "%2e%2e",
    "100%real",
  ])("rejects unsafe slug %s", (slug) => {
    expect(() => buildDocument({ ...article(), slug })).toThrow();
  });
});

test("plaintext preserves literal code escapes and decodes entities exactly once", () => {
  const body = ["```", String.raw`\* &amp; <b>`, "```"].join("\n");
  expect(buildDocument(article({ body })).textContent).toBe(
    String.raw`\* &amp; <b>`,
  );
});

describe("Standard.site deployment gates", () => {
  const enabled = {
    NODE_ENV: "production",
    STANDARD_SITE_ENABLED: "true",
    STANDARD_SITE_PDS_URL: config.pdsUrl,
    STANDARD_SITE_APP_PASSWORD: config.password,
  };
  test.each([
    {},
    { NODE_ENV: "test", STANDARD_SITE_ENABLED: "true" },
    { NODE_ENV: "production" },
    {
      NODE_ENV: "production",
      STANDARD_SITE_ENABLED: "true",
      EMDASH_READ_ONLY: "true",
    },
  ])("disabled/replica needs no secrets %j", (env) =>
    expect(standardConfig(env)).toBeNull(),
  );
  test("rejects malformed read-only gate even when disabled", () =>
    expect(() => standardConfig({ EMDASH_READ_ONLY: "yes" })).toThrow());
  test("writer requires secrets, supports Bluesky fallback, and isolates configuration", () => {
    expect(() =>
      standardConfig({ NODE_ENV: "production", STANDARD_SITE_ENABLED: "true" }),
    ).toThrow();
    expect(standardConfig(enabled)).toEqual(config);
    expect(
      standardConfig({
        NODE_ENV: "production",
        STANDARD_SITE_ENABLED: "true",
        BLUESKY_PDS_URL: config.pdsUrl,
        BLUESKY_APP_PASSWORD: config.password,
      }),
    ).toEqual(config);
  });
  test("Fly is fixed-primary only", () => {
    expect(
      standardConfig({
        ...enabled,
        FLY_MACHINE_ID: "replica",
        PRIMARY_MACHINE_ID: "writer",
      }),
    ).toBeNull();
    expect(() =>
      standardConfig({ ...enabled, FLY_APP_NAME: "site" }),
    ).toThrow();
    expect(
      standardConfig({
        ...enabled,
        FLY_MACHINE_ID: "writer",
        PRIMARY_MACHINE_ID: "writer",
      }),
    ).toEqual(config);
  });
  test.each([
    "http://pds.example",
    "https://user:secret@pds.example",
    "https://pds.example/path",
    "https://pds.example?token=x",
    "https://pds.example#fragment",
    "not-a-url",
  ])("rejects PDS origin %s without reflecting it", (pds) => {
    expect(() =>
      standardConfig({ ...enabled, STANDARD_SITE_PDS_URL: pds }),
    ).toThrow("HTTPS origin");
  });
});

describe("Standard.site XRPC client", () => {
  test("lazy auth is memoized and puts/deletes are CID compare-and-swap", async () => {
    const fetcher = fake(
      auth(),
      response({ uri, cid }),
      response({ uri, cid, value: { $type: collection } }),
      response({ uri, cid }),
      response({}),
    );
    const client = createStandardClient(config, fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    await client.put(collection, rkey, { $type: collection }, null);
    expect(await client.get(collection, rkey)).toEqual({
      uri,
      cid,
      value: { $type: collection },
    });
    await client.put(collection, rkey, { $type: collection }, cid);
    await client.delete(collection, rkey, cid);
    const bodies = fetcher.mock.calls.map(([, init]) =>
      init?.body ? JSON.parse(init.body as string) : null,
    );
    expect(bodies[1]).toMatchObject({ swapRecord: null });
    expect(bodies[1]).not.toHaveProperty("validate");
    expect(bodies[3]).not.toHaveProperty("validate");
    expect(bodies[3]).toMatchObject({ swapRecord: cid });
    expect(bodies[4]).toMatchObject({ swapRecord: cid });
    expect(
      fetcher.mock.calls.filter(([url]) =>
        String(url).includes("createSession"),
      ),
    ).toHaveLength(1);
    for (const [, init] of fetcher.mock.calls) {
      expect(init?.redirect).toBe("error");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });
  test("concurrent readers share one session", async () => {
    const fetcher = fake(
      auth(),
      response({ uri, cid, value: { $type: collection } }),
      response({ uri, cid, value: { $type: collection } }),
    );
    const client = createStandardClient(config, fetcher);
    await Promise.all([
      client.get(collection, rkey),
      client.get(collection, rkey),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  test.each([400, 404])(
    "only explicit RecordNotFound (%i) is absence",
    async (status) => {
      expect(
        await createStandardClient(
          config,
          fake(auth(), response({ error: "RecordNotFound" }, status)),
        ).get(collection, rkey),
      ).toBeNull();
    },
  );
  test.each([
    [500, "RecordNotFound"],
    [404, "OtherError"],
    [401, "RecordNotFound"],
  ])("other failure %i %s is not absence", async (status, error) => {
    await expect(
      createStandardClient(
        config,
        fake(
          auth(),
          response({ error, message: "secret-jwt" }, status as number),
        ),
      ).get(collection, rkey),
    ).rejects.toThrow("request failed");
  });
  test("wrong DID cannot write and secrets never escape server/transport errors", async () => {
    const fetcher = fake(
      response({ did: "did:plc:wrong", accessJwt: "secret-jwt" }),
    );
    await expect(
      createStandardClient(config, fetcher).put(
        collection,
        rkey,
        { $type: collection },
        null,
      ),
    ).rejects.toThrow("expected account");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const bad = fake(new Error("secret-password secret-jwt"));
    await expect(
      createStandardClient(config, bad).get(collection, rkey),
    ).rejects.toThrow(/^Standard.site PDS transport failed\.$/);
    const remote = fake(
      auth(),
      response({ error: "secret-password", message: "secret-jwt" }, 400),
    );
    await expect(
      createStandardClient(config, remote).get(collection, rkey),
    ).rejects.toThrow(/^Standard.site PDS request failed \(400\)\.$/);
  });
  test.each([
    { uri: "at://wrong", cid },
    { uri, cid: "not-a-cid" },
    { uri, cid, value: [] },
    { uri, cid, value: { $type: "app.bsky.feed.post" } },
  ])("rejects tampered get response %j", async (value) => {
    await expect(
      createStandardClient(config, fake(auth(), response(value))).get(
        collection,
        rkey,
      ),
    ).rejects.toThrow();
  });
  test("rejects tampered put reference", async () => {
    await expect(
      createStandardClient(
        config,
        fake(auth(), response({ uri: "at://wrong", cid })),
      ).put(collection, rkey, { $type: collection }, null),
    ).rejects.toThrow();
  });
  test("invalid address, record, or CAS never authenticates", async () => {
    const fetcher = fake();
    const client = createStandardClient(config, fetcher);
    await expect(client.get("app.bsky.feed.post", rkey)).rejects.toThrow();
    await expect(client.get(collection, "self")).rejects.toThrow();
    await expect(
      client.put(collection, rkey, { $type: "wrong" }, null),
    ).rejects.toThrow();
    await expect(
      client.put(collection, rkey, { $type: collection }, "bad-cid"),
    ).rejects.toThrow();
    await expect(client.delete(collection, rkey, "")).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  test("malformed and oversized responses are bounded/redacted", async () => {
    for (const reply of [
      new Response("secret-password"),
      response([]),
      response({ value: "x".repeat(1_000_001) }),
    ]) {
      await expect(
        createStandardClient(config, fake(reply)).get(collection, rkey),
      ).rejects.toThrow(/^Standard.site invalid or oversized PDS response\.$/);
    }
  });
  test("failed auth can retry, without memoizing a rejected promise", async () => {
    const fetcher = fake(
      response({ error: "no" }, 401),
      auth(),
      response({ error: "RecordNotFound" }, 404),
    );
    const client = createStandardClient(config, fetcher);
    await expect(client.get(collection, rkey)).rejects.toThrow();
    expect(await client.get(collection, rkey)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});

test("expired authorization is re-established on the next attempt", async () => {
  const fetcher = fake(
    auth(),
    response({ error: "ExpiredToken" }, 401),
    auth(),
    response({ error: "RecordNotFound" }, 400),
  );
  const client = createStandardClient(config, fetcher);
  await expect(client.get(collection, rkey)).rejects.toThrow();
  expect(await client.get(collection, rkey)).toBeNull();
  expect(
    fetcher.mock.calls.filter(([url]) => String(url).includes("createSession")),
  ).toHaveLength(2);
});
test.each(["", "bad\r\njwt", null, 3])(
  "invalid session token %j cannot write",
  async (accessJwt) => {
    const fetcher = fake(response({ did: standardDid, accessJwt }));
    await expect(
      createStandardClient(config, fetcher).put(
        collection,
        rkey,
        { $type: collection },
        null,
      ),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);
