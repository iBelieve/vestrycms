/**
 * Editor commands for the inline marks, run against a headless Tiptap editor
 * and checked through the MDX they save as.
 */
import { Editor, getSchema } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { parseMdx, serializeMdx } from "../src/mdx/index.js";
import type { PMNode } from "../src/mdx/types.js";
import { editorExtensions } from "../src/ui/components/editor/schema.js";

function edit(source: string) {
  const editor = new Editor({
    element: null,
    extensions: editorExtensions(),
    content: parseMdx(source).doc,
  });
  return {
    editor,
    /** Select the first occurrence of `text` in the first paragraph. */
    select(text: string) {
      const from = editor.state.doc.textContent.indexOf(text) + 1;
      editor.commands.setTextSelection({ from, to: from + text.length });
    },
    /** Insert text at the cursor as typing does (`insertContent` needs a DOM). */
    type(text: string) {
      editor.commands.command(({ tr }) => {
        tr.insertText(text);
        return true;
      });
    },
    mdx: () => serializeMdx(editor.getJSON() as PMNode),
  };
}

describe("toolbar marks", () => {
  it("toggles underline and small", () => {
    const { editor, select, mdx } = edit("one two three\n");
    select("two");
    editor.commands.toggleUnderline();
    expect(mdx()).toBe("one <u>two</u> three\n");
    editor.commands.toggleSmall();
    expect(mdx()).toBe("one <u><small>two</small></u> three\n");
    editor.commands.toggleUnderline();
    expect(mdx()).toBe("one <small>two</small> three\n");
  });

  it("toggles a text style on the selection", () => {
    const { editor, select, mdx } = edit("one two three\n");
    select("two");
    editor.commands.toggleTextClass("text-red");
    expect(mdx()).toBe('one <span class="text-red">two</span> three\n');
    expect(editor.isActive("textClass", { class: "text-red" })).toBe(true);
    expect(editor.isActive("textClass", { class: "caps" })).toBe(false);
    editor.commands.toggleTextClass("text-red");
    expect(mdx()).toBe("one two three\n");
  });

  it("keeps other text styles when one is toggled", () => {
    const { editor, select, mdx } = edit(
      'one <span class="text-red">two three</span>\n',
    );
    select("three");
    editor.commands.toggleTextClass("caps");
    expect(mdx()).toBe(
      'one <span class="text-red">two <span class="caps">three</span></span>\n',
    );
    select("two three");
    editor.commands.toggleTextClass("text-red");
    expect(mdx()).toBe('one two <span class="caps">three</span>\n');
  });

  it("styles the text typed next when nothing is selected", () => {
    const { editor, type, mdx } = edit("one\n");
    editor.commands.setTextSelection(4);
    editor.commands.toggleTextClass("text-red");
    type(" two");
    expect(mdx()).toBe('one<span class="text-red"> two</span>\n');
  });
});

describe("styled spans in the editor", () => {
  const schema = getSchema(
    editorExtensions({
      textStyles: {
        red: { label: "Red", class: "text-red", css: "color: #dc2626" },
        caps: { label: "Small caps", class: "caps" },
      },
    }),
  );
  const render = (className: string) =>
    schema.marks.textClass.spec.toDOM?.(
      schema.marks.textClass.create({ class: className }),
      true,
    );

  it("previews a configured style with its css", () => {
    expect(render("text-red")).toEqual([
      "span",
      { "data-text-class": "text-red", title: "Red", style: "color: #dc2626" },
      0,
    ]);
  });

  it("outlines a style without css and a class the config does not list", () => {
    expect(render("caps")).toEqual([
      "span",
      { "data-text-class": "caps", title: "Small caps", class: "v-text-class" },
      0,
    ]);
    expect(render("other")).toEqual([
      "span",
      {
        "data-text-class": "other",
        title: 'class="other"',
        class: "v-text-class",
      },
      0,
    ]);
  });

  it("lets spans nest, and renders small and underline as their elements", () => {
    expect(schema.marks.textClass.spec.excludes).toBe("");
    expect(
      schema.marks.small.spec.toDOM?.(schema.marks.small.create(), true),
    ).toEqual(["small", {}, 0]);
    expect(
      schema.marks.underline.spec.toDOM?.(
        schema.marks.underline.create(),
        true,
      ),
    ).toEqual(["u", {}, 0]);
  });
});

describe("hard breaks", () => {
  it("takes the marks around it when typed inside marked text", () => {
    const { editor, type, mdx } = edit(
      '<span class="text-red">onetwo</span>\n',
    );
    editor.commands.setTextSelection(4);
    editor.commands.setMarkedHardBreak();
    expect(mdx()).toBe('<span class="text-red">one\\\ntwo</span>\n');
    // Text typed after the break is still styled.
    type("and ");
    expect(mdx()).toBe('<span class="text-red">one\\\nand two</span>\n');
  });

  it("is plain in plain text", () => {
    const { editor, mdx } = edit("onetwo\n");
    editor.commands.setTextSelection(4);
    editor.commands.setMarkedHardBreak();
    expect(mdx()).toBe("one\\\ntwo\n");
    expect(editor.getJSON().content?.[0].content?.[1]).toEqual({
      type: "hardBreak",
    });
  });

  it("leaves a code block instead of breaking the line", () => {
    const { editor, type, mdx } = edit("```\ncode\n```\n");
    editor.commands.setTextSelection(5);
    editor.commands.setMarkedHardBreak();
    type("after");
    expect(mdx()).toBe("```\ncode\n```\n\nafter\n");
  });
});
