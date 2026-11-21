import { describe, expect, it } from "vitest";
import { fields } from "../src/config/index.js";
import type { ComponentConfig } from "../src/config/types.js";
import { rebaseMarkdown } from "../src/ui/components/editor/rebase.js";

const components: Record<string, ComponentConfig> = {
  Shot: {
    import: "@/components/Shot.astro",
    props: {
      src: fields.image({ directory: "src/assets" }),
      files: fields.array(fields.file({ directory: "public/files" })),
      note: fields.markdown({ components: ["Shot"] }),
    },
  },
};

const move = (source: string, from: string, to: string) =>
  rebaseMarkdown(source, { format: "mdx", from, to, components });

describe("rebaseMarkdown", () => {
  it("moves relative images, component props and Markdown props", () => {
    const source = [
      "![A](../../assets/a.png)",
      "",
      `<Shot src="../../assets/b.png" files={["./c.pdf", "/files/d.pdf"]} note='<Shot src="../../assets/e.png" />' />`,
      "",
    ].join("\n");
    const moved = move(
      source,
      "src/content/docs/guides/intro.mdx",
      "src/content/docs/intro.mdx",
    );
    expect(moved).toContain("![A](../assets/a.png)");
    expect(moved).toContain('src="../assets/b.png"');
    expect(moved).toContain('"./guides/c.pdf"');
    expect(moved).toContain('"/files/d.pdf"');
    expect(moved).toMatch(/note=.*<Shot src=\\?"\.\.\/assets\/e\.png\\?"/);
  });

  it("keeps a document as written when nothing in it moves", () => {
    // Written unlike the serializer would write it.
    const source = "Some  *text*\n\n![A](/images/a.png)\n\n* one\n* two\n";
    expect(move(source, "a/b/c.mdx", "a/c.mdx")).toBe(source);
    const relative = "Some  *text*\n\n![A](./a.png)\n";
    expect(move(relative, "a/b/c.mdx", "a/b/d.mdx")).toBe(relative);
  });

  it("keeps a document that does not parse", () => {
    const source = "<Broken\n\n![A](./a.png)\n";
    expect(move(source, "a/b/c.mdx", "a/c.mdx")).toBe(source);
  });
});
