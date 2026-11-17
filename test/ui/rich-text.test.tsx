// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import path from "node:path";
import { openPanel } from "./harness.js";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Editor } from "@tiptap/react";
import { describe, expect, it, vi } from "vitest";
import { collection, defineConfig, fields } from "../../src/config/index.js";
import type { ComponentConfig } from "../../src/config/types.js";
import type { EditorEnv } from "../../src/ui/components/editor/EditorContext.js";
import { RichTextEditor } from "../../src/ui/components/editor/RichTextEditor.js";

// CodeMirror needs a real browser; a textarea stands in for it.
vi.mock("../../src/ui/components/fields/CodeInput.js", () => ({
  CodeInput: (props: { value: string; onChange: (v: string) => void }) => (
    <textarea
      aria-label="Code"
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
    />
  ),
}));

const components: Record<string, ComponentConfig> = {
  Note: {
    label: "Note",
    icon: "info",
    description: "A boxed note",
    children: true,
  },
  Badge: { inline: true, children: "text" },
  Card: {
    description: "A card",
    props: {
      title: fields.text(),
      flag: fields.boolean(),
      hidden: fields.text({ hidden: true }),
    },
  },
  Gallery: { props: { items: fields.array(fields.text()) } },
};

const env: EditorEnv = {
  components,
  textStyles: { red: { label: "Red", class: "red", css: "color: red" } },
  toRepoPath: () => null,
  toDocPath: (p) => p,
};

/** Renders the editor on `value`; `output()` is the last MDX it reported. */
function open(
  value: string,
  props: Partial<Parameters<typeof RichTextEditor>[0]> = {},
) {
  const onChange = vi.fn();
  const view = render(
    <RichTextEditor value={value} onChange={onChange} env={env} {...props} />,
  );
  const editor = () =>
    (document.querySelector(".ProseMirror") as HTMLElement & { editor: Editor })
      .editor;
  return {
    view,
    onChange,
    editor,
    output: () => onChange.mock.lastCall?.[0] as string | undefined,
    /** Waits for the editor to report MDX matching `pattern`. */
    reports: (pattern: RegExp | string) =>
      waitFor(() => expect(onChange.mock.lastCall?.[0]).toMatch(pattern)),
  };
}

const tool = (label: string) => screen.getByRole("button", { name: label });

describe("the rich text editor", () => {
  it("formats text with the toolbar", { timeout: 30_000 }, async () => {
    const user = userEvent.setup();
    const ed = open("Hello world\n");
    await screen.findByText("Hello world");
    expect((tool("Undo") as HTMLButtonElement).disabled).toBe(true);

    act(() => void ed.editor().commands.selectAll());
    await user.click(tool("Bold"));
    await ed.reports("**Hello world**");
    expect(tool("Bold").classList.contains("is-active")).toBe(true);
    await user.click(tool("Bold"));
    for (const [label, mdx] of [
      ["Italic", "_Hello world_"],
      ["Strikethrough", "~~Hello world~~"],
      ["Underline", "<u>Hello world</u>"],
      ["Small text", "<small>Hello world</small>"],
      ["Superscript", "<sup>Hello world</sup>"],
      ["Subscript", "<sub>Hello world</sub>"],
      ["Inline code", "`Hello world`"],
    ] as const) {
      await user.click(tool(label));
      await ed.reports(mdx);
      await user.click(tool(label));
    }

    for (const [label, mdx] of [
      ["Heading 1", /^# Hello/],
      ["Heading 2", /^## Hello/],
      ["Heading 3", /^### Hello/],
      ["Bullet list", /^- Hello/],
      ["Numbered list", /^1\. Hello/],
      ["Quote", /^> Hello/],
      ["Code block", /^```\nHello/],
    ] as const) {
      await user.click(tool(label));
      await ed.reports(mdx);
      await user.click(tool("Undo"));
      await ed.reports(/^Hello world\n$/);
    }

    await user.click(tool("Divider"));
    await ed.reports("---");
    await user.click(tool("Undo"));
    await ed.reports(/^Hello world\n$/);
    await user.click(tool("Redo"));
    await ed.reports("---");
  });

  it("links text, and styles it", async () => {
    const user = userEvent.setup();
    const ed = open("Hello world\n");
    await screen.findByText("Hello world");
    act(() => void ed.editor().commands.selectAll());

    await user.click(tool("Link"));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(tool("Link"));
    await user.type(screen.getByLabelText("URL"), " /visit {Enter}");
    await ed.reports("[Hello world](/visit)");
    expect(tool("Remove link").classList.contains("is-active")).toBe(true);
    await user.click(tool("Remove link"));
    await ed.reports(/^Hello world\n$/);
    // An empty address takes a link away.
    act(() => void ed.editor().commands.selectAll());
    await user.click(tool("Link"));
    expect((screen.getByLabelText("URL") as HTMLInputElement).value).toBe("");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.queryByLabelText("URL")).toBeNull();

    act(() => void ed.editor().commands.selectAll());
    await user.click(screen.getByRole("button", { name: /Styles/ }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Red" }));
    await ed.reports('<span class="red">Hello world</span>');
    await user.click(screen.getByRole("button", { name: /Styles/ }));
    expect(
      screen
        .getByRole("menuitemcheckbox", { name: "Red" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("inserts and edits tables", async () => {
    const user = userEvent.setup();
    const ed = open("Hello\n");
    await screen.findByText("Hello");
    await user.click(tool("Table"));
    expect(screen.queryByRole("button", { name: "Delete table" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Insert table" }));
    await ed.reports("| ");
    for (const item of [
      "Add row below",
      "Add column after",
      "Delete row",
      "Delete column",
      "Delete table",
    ]) {
      await user.click(tool("Table"));
      await user.click(screen.getByRole("button", { name: item }));
    }
    await ed.reports(/^Hello\n$/);
  });

  it("inserts components and edits their settings", async () => {
    const user = userEvent.setup();
    const ed = open("Hello\n", {
      components: ["Note", "Badge", "Card", "Gallery", "Missing"],
    });
    await screen.findByText("Hello");
    const insert = async (label: string) => {
      await user.click(screen.getByRole("button", { name: /Insert/ }));
      await user.click(
        screen.getByRole("button", { name: new RegExp(`^${label}`) }),
      );
    };

    await insert("Card");
    // A few simple settings start open.
    const card = await screen.findByText("Card", {
      selector: ".v-block__name",
    });
    const block = card.closest(".v-block") as HTMLElement;
    expect(within(block).getByText("A card")).toBeTruthy();
    await user.type(within(block).getByLabelText("Title"), "Hi");
    await ed.reports('<Card flag={false} title="Hi" />');
    await user.click(within(block).getByTitle("Hide settings"));
    expect(within(block).getByText('flag=false · title="Hi"')).toBeTruthy();
    await user.click(within(block).getByTitle("Edit settings"));
    await user.click(within(block).getByTitle("Remove block"));
    await ed.reports(/^Hello\n$/);

    // A list setting starts closed.
    await insert("Gallery");
    const gallery = (
      await screen.findByText("Gallery", { selector: ".v-block__name" })
    ).closest(".v-block") as HTMLElement;
    expect(gallery.classList.contains("is-collapsed")).toBe(true);

    await insert("Note");
    await ed.reports("<Note />");
    expect(
      screen.getByText("Note", { selector: ".v-block__name" }),
    ).toBeTruthy();

    await insert("Missing");
    await ed.reports("<Missing />");
    expect(screen.getByText("Unknown component with no props.")).toBeTruthy();

    await insert("Badge");
    await ed.reports("<Badge>text</Badge>");
    const badge = document.querySelector(".v-inline-component") as HTMLElement;
    fireEvent.doubleClick(badge);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Badge settings")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    fireEvent.doubleClick(badge);
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /Remove/,
      }),
    );
    await waitFor(() => expect(ed.output()).not.toContain("<Badge>"));
  });

  it("edits an item of a list setting", async () => {
    const ed = open('<Gallery items={["a"]} />\n');
    const gallery = (
      await screen.findByText("Gallery", { selector: ".v-block__name" })
    ).closest(".v-block") as HTMLElement;
    fireEvent.click(within(gallery).getByTitle("Edit settings"));
    fireEvent.change(within(gallery).getByDisplayValue("a"), {
      target: { value: "b" },
    });
    await ed.reports('<Gallery items={["b"]} />');
  });

  it("edits code it cannot show", async () => {
    const user = userEvent.setup();
    const ed = open(
      'export const x = 1\n\n<Mystery a="b" n={1 + 1} />\n\n{1 + 1}\n',
    );
    await screen.findByText("Module code");
    expect(screen.getByText("{1 + 1}")).toBeTruthy();

    // An unknown component's props are edited as code.
    const mystery = screen
      .getByText("Mystery", { selector: ".v-block__name" })
      .closest(".v-block") as HTMLElement;
    await user.click(within(mystery).getByTitle("Edit settings"));
    expect(within(mystery).getByText("unknown prop")).toBeTruthy();
    expect(within(mystery).getByText("expression")).toBeTruthy();
    const [a] = within(mystery).getAllByLabelText("Code");
    fireEvent.change(a, { target: { value: '"c"' } });
    await ed.reports('<Mystery a={"c"} n={1 + 1} />');

    // A raw expression opens to a text box.
    const expression = screen
      .getByText("Expression")
      .closest(".v-block") as HTMLElement;
    await user.click(within(expression).getByTitle("Edit"));
    fireEvent.change(within(expression).getByRole("textbox"), {
      target: { value: "2 + 2" },
    });
    await ed.reports("{2 + 2}");
    await user.click(within(expression).getByTitle("Collapse"));
    expect(within(expression).getByText("{2 + 2}")).toBeTruthy();
    await user.click(within(expression).getByTitle("Remove"));
    await waitFor(() => expect(ed.output()).not.toContain("{2 + 2}"));
  });

  it("switches to the source and back", async () => {
    const user = userEvent.setup();
    const ed = open("Hello\n");
    await screen.findByText("Hello");
    act(() => void ed.editor().commands.selectAll());
    await user.click(tool("Bold"));
    // Switching straight away reports the pending edit.
    await user.click(screen.getByTitle("Edit MDX source"));
    expect(ed.output()).toBe("**Hello**\n");
    await user.click(screen.getByTitle("Edit MDX source"));
    expect((tool("Bold") as HTMLButtonElement).disabled).toBe(true);
    ed.view.rerender(
      <RichTextEditor value="<Broken" onChange={ed.onChange} env={env} />,
    );
    await user.click(screen.getByTitle("Visual editor"));
    expect(screen.getByText(/Could not parse MDX/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Code"), {
      target: { value: "Fixed\n" },
    });
    expect(ed.output()).toBe("Fixed\n");
    ed.view.rerender(
      <RichTextEditor value={"Fixed\n"} onChange={ed.onChange} env={env} />,
    );
    await user.click(screen.getByTitle("Visual editor"));
    expect(await screen.findByText("Fixed")).toBeTruthy();
    await user.click(screen.getByTitle("Visual editor"));
  });

  it("takes in a new value from outside", async () => {
    const ed = open("Before\n");
    await screen.findByText("Before");
    ed.view.rerender(
      <RichTextEditor value={"After\n"} onChange={ed.onChange} env={env} />,
    );
    expect(await screen.findByText("After")).toBeTruthy();
    // A value that does not parse is left alone.
    ed.view.rerender(
      <RichTextEditor value="<Broken" onChange={ed.onChange} env={env} />,
    );
    expect(screen.getByText("After")).toBeTruthy();
  });

  it("leaves out what plain Markdown cannot hold", async () => {
    open("Hello\n", { format: "md" });
    await screen.findByText("Hello");
    expect(screen.queryByRole("button", { name: "Underline" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Insert/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Styles/ })).toBeNull();
    expect((tool("Image") as HTMLButtonElement).disabled).toBe(true);
  });

  it("inserts images in an entry's body", async () => {
    const user = userEvent.setup();
    const config = defineConfig({
      name: "Test Site",
      repo: { owner: "o", name: "r", branch: "main" },
      assets: { images: { label: "Images", directory: "public/images" } },
      components: {
        Hero: {
          props: { image: fields.image({ directory: "public/images" }) },
        },
      },
      collections: {
        pages: collection({
          label: "Pages",
          path: "src/content/pages/*.mdx",
          body: {
            images: { directory: "public/images" },
            components: ["Hero"],
          },
          schema: { title: fields.text() },
        }),
      },
    });
    const { root } = await openPanel(config, {
      url: "/collections/pages/home",
      files: {
        "src/content/pages/home.mdx":
          '---\ntitle: Home\n---\n\n<Hero image="/images/a.png" />\n',
        "public/images/a.png": "a",
      },
    });
    const hero = (
      await screen.findByText("Hero", { selector: ".v-block__name" })
    ).closest(".v-block") as HTMLElement;
    expect(hero.querySelector("img.v-thumb")?.getAttribute("src")).toContain(
      "a.png",
    );

    await user.click(tool("Image"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Insert image")).toBeTruthy();
    await user.dblClick(
      await within(dialog).findByRole("button", { name: /a\.png/ }),
    );
    await waitFor(() =>
      expect(document.querySelector(".ProseMirror img")).not.toBeNull(),
    );
    await waitFor(() =>
      expect(screen.getByText("Unsaved changes")).toBeTruthy(),
    );
    await user.click(screen.getByRole("button", { name: /^Save/ }));
    await screen.findByText("Saved to disk");
    expect(
      await readFile(path.join(root, "src/content/pages/home.mdx"), "utf8"),
    ).toContain("![](/images/a.png)");
  });
});
