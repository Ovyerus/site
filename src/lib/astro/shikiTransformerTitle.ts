import type { ShikiTransformer } from "@shikijs/types";
import { h } from "hastscript";

export interface TransformerTitleOptions {
  titleClassName?: string;
  containerClassName?: string;
}

const titleMetaRe = /\btitle=(\S+)/;

export const transformerTitle = ({
  titleClassName = "shiki-title",
  containerClassName = "shiki-container",
}: TransformerTitleOptions = {}): ShikiTransformer => ({
  name: "ovyerus:title",
  root(node) {
    const pre = node.children[0];
    const container = h("div", { class: containerClassName }, [pre]);

    if (this.options.meta?.__raw) {
      const match = this.options.meta.__raw.match(titleMetaRe);

      if (match) {
        const title = h("span", { class: titleClassName }, match[1]);
        container.children.unshift(title);
      }
    }

    node.children = [container];
  },
});
