import Montserrat400 from "@fontsource/montserrat/files/montserrat-latin-400-normal.woff";
import MontserratItalic400 from "@fontsource/montserrat/files/montserrat-latin-400-italic.woff";
import MontserratItalic700 from "@fontsource/montserrat/files/montserrat-latin-700-italic.woff";
import { Resvg } from "@resvg/resvg-js";
import { getArticle } from "~lib/content";
import satori from "satori";
import type { APIRoute } from "astro";
import { formatISO } from "date-fns";
import { getWeeknoteStrings } from "~lib/weeknotes";
import wordmarkData from "~assets/wordmark-gradient.svg?raw";

const wordmark =
  "data:image/svg+xml;base64," + Buffer.from(wordmarkData).toString("base64");

interface JSXNode {
  type: string;
  props: {
    children: string | Array<JSXNode | null | string>;
    [x: string]: any;
  };
}

const h =
  (type: string) =>
  (
    props: Record<string, any> = {},
    children: JSXNode["props"]["children"] | JSXNode = [],
  ): JSXNode => ({
    type,
    props: {
      ...props,
      children:
        !Array.isArray(children) && typeof children === "object"
          ? [children]
          : children,
    },
  });

const div = h("div");
const span = h("span");
const h1 = h("h1");
const h2 = h("h2");
const img = h("img");

interface Props {
  overline: string;
  title: string;
  description: string;
  createdAt: Date;
}

export const GET: APIRoute = async ({ params }) => {
  const [collection, ...slugParts] = params.slug?.split("/") ?? [];
  const slug = slugParts.join("/");

  let imageProps: Props;
  if (collection === "posts") {
    const post = slug ? await getArticle("posts", slug) : undefined;
    if (!post) return new Response(null, { status: 404 });

    imageProps = {
      overline: post.data.tags.join(", "),
      title: post.data.title,
      description: post.data.description,
      createdAt: post.data.createdAt,
    };
  } else if (collection === "weeknotes") {
    const weeknote = slug ? await getArticle("weeknotes", slug) : undefined;
    if (!weeknote) return new Response(null, { status: 404 });

    const { createdAt, title, sentence } = getWeeknoteStrings(weeknote.id);
    imageProps = {
      overline: weeknote.data.subtitle
        ? `Weeknotes: ${title.replace("Weeknote", "Week")}`
        : "Weeknotes",
      title: weeknote.data.subtitle || title,
      description:
        weeknote.data.description ||
        `My weekly journal-ish entry for ${sentence}.`,
      createdAt,
    };
  } else {
    return new Response(null, { status: 404 });
  }

  const { title, overline, description, createdAt } = imageProps;
  const date = formatISO(createdAt, { representation: "date" });

  const out = div(
    {
      tw: "flex h-full w-full p-[20px] text-white italic",
      style: {
        backgroundImage: "linear-gradient(to bottom right, #f0f, #0ff)",
      },
    },
    [
      div(
        {
          tw: "flex h-full w-full flex-col p-[40px] bg-black",
        },
        [
          span({ tw: "text-3xl opacity-50" }, overline),
          // div({ tw: "flex-1 flex" }, [span()]),
          h1({ tw: "text-7xl font-bold" }, title),
          h2({ tw: "opacity-75 font-normal text-3xl not-italic" }, description),
          // div({ tw: "flex-1 flex" }, [span()]),
        ],
      ),
      img({
        src: wordmark,
        width: 992 / 3,
        height: 128 / 3,
        tw: "absolute bottom-[60px] left-[60px]",
      }),
      span(
        {
          tw: "absolute bottom-[60px] right-[60px] text-right text-4xl opacity-50",
        },
        date,
      ),
    ],
  );

  let svg = await satori(out, {
    fonts: [
      {
        name: "Montserrat",
        data: Buffer.from(Montserrat400),
        weight: 400,
        style: "normal",
      },
      {
        name: "Montserrat",
        data: Buffer.from(MontserratItalic400),
        weight: 400,
        style: "italic",
      },
      {
        name: "Montserrat",
        data: Buffer.from(MontserratItalic700),
        weight: 700,
        style: "italic",
      },
    ],
    height: 630,
    width: 1200,
  });
  const resvg = new Resvg(svg, {
    fitTo: {
      mode: "width",
      value: 800,
    },
  });
  const image = resvg.render();
  return new Response(image.asPng(), {
    headers: {
      "Content-Type": "image/png",
    },
  });
};
