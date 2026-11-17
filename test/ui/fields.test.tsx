// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { openPanel, pickFiles } from "./harness.js";
import { collection, defineConfig, fields } from "../../src/config/index.js";

const config = defineConfig({
  name: "Test Site",
  repo: { owner: "o", name: "r", branch: "main" },
  assets: { images: { label: "Images", directory: "public/images" } },
  collections: {
    people: collection({
      label: "People",
      path: "src/content/people/*.json",
      schema: { title: fields.text() },
    }),
    things: collection({
      label: "Things",
      singular: "thing",
      path: "src/content/things/*.json",
      schema: {
        title: fields.text({ required: true }),
        code: fields.slug({ from: "title" }),
        summary: fields.textarea({ description: "A few words" }),
        count: fields.number(),
        featured: fields.boolean(),
        day: fields.date(),
        start: fields.date({ time: "optional", timeHint: "7 PM" }),
        at: fields.datetime(),
        atIso: fields.datetime({ storage: "iso" }),
        kind: fields.select({
          clearable: true,
          options: [
            { label: "Red", value: "red", color: "#f00" },
            { label: "Blue", value: "blue" },
          ],
        }),
        tags: fields.multiselect({
          options: [
            { label: "A", value: "a", color: "#0f0" },
            { label: "B", value: "b" },
          ],
        }),
        tint: fields.color(),
        photo: fields.image({ directory: "public/images" }),
        attachment: fields.file({ directory: "public/files" }),
        person: fields.reference({ collection: "people" }),
        meta: fields.object({ author: fields.text() }),
        extra: fields.object({ note: fields.text() }, { inline: true }),
        links: fields.array(fields.text(), { max: 2 }),
        steps: fields.array(fields.object({ name: fields.text() }), {
          addLabel: "Add step",
        }),
      },
    }),
  },
});

const files = {
  "src/content/people/ann.json": '{ "title": "Ann" }\n',
  "public/images/a.png": "a",
  "public/images/sub/b.png": "b",
};

const read = async (root: string, file: string) =>
  JSON.parse(await readFile(path.join(root, file), "utf8"));
/** The field labelled `label`. */
const field = (label: string) =>
  screen
    .getByText(label, { selector: "label" })
    .closest(".v-field") as HTMLElement;
const input = (label: string) =>
  screen.getByLabelText(label) as HTMLInputElement;

describe("the field inputs", () => {
  it("edit each type of value", async () => {
    const user = userEvent.setup();
    const { root } = await openPanel(config, {
      url: "/collections/things/new",
      files,
    });
    await user.type(
      await screen.findByPlaceholderText("Title…"),
      "Hello World",
    );

    // A slug suggested from another field.
    await user.click(
      within(field("Code")).getByRole("button", { name: "Generate" }),
    );
    expect(input("Code").value).toBe("hello-world");
    expect(within(field("Code")).queryByRole("button")).toBeNull();

    await user.type(input("Summary"), "Short");
    expect(screen.getByText("A few words")).toBeTruthy();
    await user.type(input("Count"), "5");
    await user.click(screen.getByRole("checkbox", { name: "Featured" }));
    fireEvent.change(input("Day"), { target: { value: "2026-11-17" } });

    // A date with an optional time.
    const start = field("Start");
    const time = start.querySelector('input[type="time"]') as HTMLInputElement;
    fireEvent.change(time, { target: { value: "19:00" } });
    expect(time.value).toBe("");
    fireEvent.change(input("Start"), { target: { value: "2026-11-17" } });
    expect(within(start).getByText("Time: 7 PM")).toBeTruthy();
    fireEvent.change(time, { target: { value: "19:00" } });
    expect(within(start).queryByText("Time: 7 PM")).toBeNull();
    fireEvent.change(input("Start"), { target: { value: "2026-11-18" } });
    expect(time.value).toBe("19:00");

    fireEvent.change(input("At"), { target: { value: "2026-11-17T09:30" } });
    fireEvent.change(input("At Iso"), {
      target: { value: "2026-11-17T09:30" },
    });
    expect(input("At Iso").value).toBe("2026-11-17T09:30");

    // A select with a colour, which can be cleared.
    expect(field("Kind").querySelector(".v-swatch")).toBeNull();
    await user.selectOptions(input("Kind"), "red");
    expect(field("Kind").querySelector(".v-swatch")).not.toBeNull();

    for (const tag of ["A", "B", "A"])
      await user.click(
        within(field("Tags")).getByRole("button", { name: tag }),
      );

    await user.type(input("Tint"), "#123456");

    // A file field with no asset container to browse.
    await user.click(
      within(field("Attachment")).getByRole("button", { name: "Choose" }),
    );
    const missing = await screen.findByRole("dialog");
    expect(within(missing).getByText(/No asset container covers/)).toBeTruthy();
    await user.click(within(missing).getByRole("button", { name: "Cancel" }));

    // A reference lists the other collection's entries.
    await within(field("Person")).findByRole("option", { name: "Ann" });
    await user.selectOptions(input("Person"), "ann");

    await user.type(input("Author"), "Bob");
    await user.type(input("Note"), "Inline");

    // A list of values, up to its maximum.
    const links = field("Links");
    const add = within(links).getByRole("button", { name: /Add item/ });
    await user.click(add);
    await user.click(add);
    expect((add as HTMLButtonElement).disabled).toBe(true);
    const rows = () =>
      Array.from(
        links.querySelectorAll<HTMLInputElement>(".v-list__row input"),
      );
    await user.type(rows()[0], "one");
    await user.type(rows()[1], "two");
    await user.click(
      within(links).getAllByRole("button", { name: "Move down" })[0],
    );
    expect(rows().map((r) => r.value)).toEqual(["two", "one"]);
    await user.click(
      within(links).getAllByRole("button", { name: "Move up" })[1],
    );
    expect(rows().map((r) => r.value)).toEqual(["one", "two"]);
    await user.click(
      within(links).getAllByRole("button", { name: "Remove" })[1],
    );
    expect(rows().map((r) => r.value)).toEqual(["one"]);

    // A list of objects: each opens to its fields.
    const steps = field("Steps");
    await user.click(within(steps).getByRole("button", { name: /Add step/ }));
    await user.type(within(steps).getByLabelText("Name"), "Mix");
    expect(
      within(steps).getByText("Mix", { selector: ".v-list__title" }),
    ).toBeTruthy();
    await user.click(within(steps).getByRole("button", { name: "Duplicate" }));
    expect(
      within(steps).getAllByText("Mix", { selector: ".v-list__title" }),
    ).toHaveLength(2);
    await user.click(
      within(steps).getAllByRole("button", { name: "Remove" })[1],
    );
    await user.click(within(steps).getByRole("button", { name: /Add step/ }));
    expect(within(steps).getByText("Item 2")).toBeTruthy();
    // The header opens and closes an item.
    await user.click(within(steps).getByText("Mix"));
    expect(within(steps).getAllByLabelText("Name")).toHaveLength(1);
    await user.click(within(steps).getByText("Mix"));
    expect(within(steps).queryAllByLabelText("Name")).toHaveLength(0);
    await user.click(
      within(steps).getAllByRole("button", { name: "Remove" })[1],
    );

    await user.click(screen.getByRole("button", { name: /^Create/ }));
    await screen.findByText("Saved to disk");
    expect(await read(root, "src/content/things/hello-world.json")).toEqual({
      title: "Hello World",
      code: "hello-world",
      summary: "Short",
      count: 5,
      featured: true,
      day: "2026-11-17",
      start: "2026-11-18T19:00",
      at: "2026-11-17T09:30",
      atIso: new Date("2026-11-17T09:30").toISOString(),
      kind: "red",
      tags: ["b"],
      tint: "#123456",
      person: "ann",
      meta: { author: "Bob" },
      extra: { note: "Inline" },
      links: ["one"],
      steps: [{ name: "Mix" }],
    });
  });

  it("clear values back to empty", async () => {
    const user = userEvent.setup();
    await openPanel(config, {
      url: "/collections/things/x",
      files: {
        ...files,
        "src/content/things/x.json": JSON.stringify({
          title: "X",
          count: 3,
          start: "2026-11-17T19:00",
          at: "2026-11-17T09:30",
          atIso: "not a date",
          kind: "blue",
          person: "gone",
        }),
      },
    });
    await screen.findByDisplayValue("X");
    expect(input("At Iso").value).toBe("");
    await user.clear(input("Count"));
    expect(input("Count").value).toBe("");
    const time = field("Start").querySelector(
      'input[type="time"]',
    ) as HTMLInputElement;
    expect(time.value).toBe("19:00");
    fireEvent.change(time, { target: { value: "" } });
    expect(input("Start").value).toBe("2026-11-17");
    fireEvent.change(input("At"), { target: { value: "" } });
    expect(input("At").value).toBe("");
    await user.selectOptions(input("Kind"), "");
    expect(input("Kind").value).toBe("");
    // A reference to an entry that is gone keeps its value.
    expect(
      within(field("Person")).getByRole("option", { name: "gone" }),
    ).toBeTruthy();
  });

  it("choose, clear and upload images", async () => {
    const user = userEvent.setup();
    const { root } = await openPanel(config, {
      url: "/collections/things/x",
      files: { ...files, "src/content/things/x.json": '{ "title": "X" }' },
    });
    await screen.findByDisplayValue("X");
    const photo = () => field("Photo");
    expect(within(photo()).getByText("No file selected")).toBeTruthy();

    // Browse into a folder and back, then choose a file.
    await user.click(within(photo()).getByRole("button", { name: "Choose" }));
    let dialog = await screen.findByRole("dialog");
    await user.click(
      await within(dialog).findByRole("button", { name: /sub/ }),
    );
    await user.click(
      await within(dialog).findByRole("button", { name: /b\.png/ }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Choose" }));
    expect(within(photo()).getByText("b.png")).toBeTruthy();
    expect(photo().querySelector("img")?.getAttribute("src")).toContain(
      "public%2Fimages%2Fsub%2Fb.png",
    );

    await user.click(within(photo()).getByRole("button", { name: /Clear/ }));
    expect(within(photo()).getByText("No file selected")).toBeTruthy();

    // A double-click chooses at once.
    await user.click(within(photo()).getByRole("button", { name: "Choose" }));
    dialog = await screen.findByRole("dialog");
    await user.dblClick(
      await within(dialog).findByRole("button", { name: /a\.png/ }),
    );
    expect(within(photo()).getByText("a.png")).toBeTruthy();

    // An upload of the wrong type is refused; a new image waits for the save.
    await user.click(within(photo()).getByRole("button", { name: "Replace" }));
    dialog = await screen.findByRole("dialog");
    const upload = dialog.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    pickFiles(upload, new File(["x"], "notes.txt"));
    expect(
      await screen.findByText("That file type isn't accepted here."),
    ).toBeTruthy();
    pickFiles(
      upload,
      new File(["png"], "New Photo.png", { type: "image/png" }),
    );
    await waitFor(() =>
      expect(within(photo()).getByText("new-photo.png")).toBeTruthy(),
    );
    expect(photo().querySelector("img")?.getAttribute("src")).toMatch(/^blob:/);
    expect(screen.getByText(/1 new file/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /^Save/ }));
    await screen.findByText("Saved to disk");
    expect(await read(root, "src/content/things/x.json")).toMatchObject({
      photo: "/images/new-photo.png",
    });
    expect(
      await readFile(path.join(root, "public/images/new-photo.png"), "utf8"),
    ).toBe("png");
  });
});
