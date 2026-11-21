import { describe, expect, it } from "vitest";
import { makeExcerpt } from "../src/core/excerpt.js";

describe("makeExcerpt", () => {
  it("leaves headings out so they don't run into the first paragraph", () => {
    expect(
      makeExcerpt(
        "## A New, Faithful Bible Translation\n\n# The EHV proclaims the gospel\n\nThe Evangelical Heritage Version (EHV) is new.\n",
      ),
    ).toBe("The Evangelical Heritage Version (EHV) is new.");
  });

  it("falls back to the headings when there is nothing else", () => {
    expect(makeExcerpt("# Hello\n\n## World\n")).toBe("Hello World");
  });

  it("keeps a link's text but not its address or title", () => {
    expect(
      makeExcerpt(
        'Order from [Northwestern Publishing House](https://online.nph.net/ehv "NPH") or [call](tel:800-662-6022). See [Wikipedia](https://en.wikipedia.org/wiki/Bible_(disambiguation)).',
      ),
    ).toBe("Order from Northwestern Publishing House or call. See Wikipedia.");
  });

  it("drops images, footnotes, reference definitions and imports", () => {
    expect(
      makeExcerpt(
        'import Figure from "@/components/Figure.astro";\n\n![A map](./map.png) The route[^1] went [north][n].\n\n[n]: https://example.org\n[^1]: Probably.\n',
      ),
    ).toBe("The route went north.");
  });

  it("drops hard-break backslashes, escapes, list and quote markers", () => {
    expect(
      makeExcerpt(
        "Won’t this foster antisemitic\\\nhatred?\n\n> Quoted\n\n- One\n- Two\n1. Three\n\n2\\. Not a list, 50\\% off\n",
      ),
    ).toBe(
      "Won’t this foster antisemitic hatred? Quoted One Two Three 2. Not a list, 50\\% off",
    );
  });

  it("strips tags and emphasis, keeps snake_case words, decodes entities", () => {
    expect(
      makeExcerpt(
        "Some *text* <b>here</b>. A _word_ in **bold**, my_var and ~~old~~.&#x20;&amp; more&nbsp;text\n",
      ),
    ).toBe("Some text here. A word in bold, my_var and old. & more text");
  });

  it("leaves out JSX comments and component markup", () => {
    expect(
      makeExcerpt(
        '{/* hidden */}\n\n<Download\n  title="Download"\n  links={[\n      { label: "Store" },\n    ]}\n/>\n\nThe app shows notes.\n',
      ),
    ).toBe("The app shows notes.");
  });

  it("is undefined for an empty body and cut at 200 characters", () => {
    expect(makeExcerpt("\n\n")).toBeUndefined();
    expect(makeExcerpt("word ".repeat(100))).toHaveLength(200);
  });
});
