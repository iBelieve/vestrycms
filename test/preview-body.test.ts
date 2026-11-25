import { describe, expect, it } from "vitest";
import { previewBody } from "../src/ui/lib/preview-body.js";

const mdx = (body: string, resolveImage = (src: string) => src) =>
  previewBody(body, { format: "mdx", resolveImage });

describe("previewBody", () => {
  it("is nothing for an empty body", () => {
    expect(mdx("  \n")).toEqual([]);
  });

  it("draws Markdown as MDX would, with ids on headings", () => {
    expect(
      mdx(
        "# Hello *world*\n\n## Hello world\n\nA [link](/x) and www.example.com.\n\n| a | b |\n| - | :-: |\n| 1 | 2 |",
      ),
    ).toEqual([
      '<h1 id="hello-world">Hello <em>world</em></h1>\n' +
        '<h2 id="hello-world-1">Hello world</h2>\n' +
        '<p>A <a href="/x">link</a> and <a href="http://www.example.com">www.example.com</a>.</p>\n' +
        "<table>\n<thead>\n<tr>\n<th>a</th>\n" +
        '<th align="center">b</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>1</td>\n' +
        '<td align="center">2</td>\n</tr>\n</tbody>\n</table>',
    ]);
  });

  it("adds the footnotes section", () => {
    const [html] = mdx("Text.[^1]\n\n[^1]: The note.") as string[];
    expect(html).toContain('href="#user-content-fn-1"');
    expect(html).toContain('<section data-footnotes class="footnotes">');
    expect(html).toContain("The note.");
  });

  it("cuts out components, with their props and children", () => {
    expect(
      mdx(
        'import Box from "@/Box.astro";\n\n<Box title="Hi" count={3} open data={{ a: [1] }} code={fn()} {...rest}>\n  Inside with <Badge tone="new" /> and **bold**.\n\n  <Box.Inner />\n</Box>\n\nAfter.',
      ),
    ).toEqual([
      {
        component: "Box",
        props: { title: "Hi", count: 3, open: true, data: { a: [1] } },
        children: [
          "<p>Inside with ",
          { component: "Badge", props: { tone: "new" }, children: null },
          " and <strong>bold</strong>.</p>",
          { component: "Box.Inner", props: {}, children: null },
        ],
      },
      "\n<p>After.</p>",
    ]);
  });

  // A line that starts with a tag and goes on is a paragraph, to MDX too.
  it("keeps HTML elements written as JSX, and leaves out expressions", () => {
    expect(
      mdx(
        'Text with <sup>1</sup> and <span class="red big">red</span> {1 + 1}.\n\n{"flow"}\n\n<div className="note" hidden>Note</div>',
      ),
    ).toEqual([
      '<p>Text with <sup>1</sup> and <span class="red big">red</span> .</p>\n<p><div class="note" hidden>Note</div></p>',
    ]);
  });

  it("shows images from where the editor has them", () => {
    expect(
      mdx('![A cat](./cat.jpg)\n\n<img src="./dog.jpg" alt="" />', (src) =>
        src.startsWith("./") ? `blob:${src.slice(2)}` : src,
      ),
    ).toEqual([
      '<p><img src="blob:cat.jpg" alt="A cat"></p>\n<img src="blob:dog.jpg" alt="">',
    ]);
  });

  it("keeps raw HTML in Markdown files", () => {
    expect(
      previewBody("<div>Hi</div>\n\n<Box />", {
        format: "md",
        resolveImage: (src) => src,
      }),
    ).toEqual(["<div>Hi</div>\n<Box />"]);
  });
});
