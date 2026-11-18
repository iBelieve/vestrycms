// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { openPanel, signIn } from "./harness.js";
import { defineConfig } from "../../src/config/index.js";

const config = defineConfig({
  name: "Test Site",
  repo: { owner: "o", name: "r", branch: "main" },
  auth: { admins: ["owner@example.org"] },
});

/** Opens the panel with sign-in, and signs in as the config's admin. */
async function signedIn(url = "/users") {
  const user = userEvent.setup();
  const auth = signIn();
  await openPanel(config, { url, api: { auth: auth.options } });
  await user.type(
    await screen.findByPlaceholderText("you@example.org"),
    "owner@example.org",
  );
  await user.click(screen.getByRole("button", { name: /Email me a code/ }));
  await user.type(
    await screen.findByPlaceholderText("123456"),
    auth.lastCode(),
  );
  await user.click(screen.getByRole("button", { name: /Sign in/ }));
  return { user, auth };
}

const row = (name: string) =>
  screen
    .getByText(name, { selector: ".v-table__title, .v-table__title *" })
    .closest("tr")!;
async function action(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  item: string,
) {
  await user.click(within(row(name)).getByTitle("Actions"));
  await user.click(screen.getByRole("button", { name: item }));
}

describe("sign-in", () => {
  it("asks for an email, then the code sent to it", async () => {
    const user = userEvent.setup();
    const auth = signIn();
    await openPanel(config, { url: "/users", api: { auth: auth.options } });
    const email = await screen.findByPlaceholderText("you@example.org");
    expect(screen.getByText("T")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Test Site" })).toBeTruthy();
    await user.type(email, " owner@example.org ");
    await user.click(screen.getByRole("button", { name: /Email me a code/ }));
    expect(await screen.findByText("owner@example.org")).toBeTruthy();
    const first = auth.lastCode();

    // A wrong code, a new code, and a different address.
    const code = screen.getByPlaceholderText<HTMLInputElement>("123456");
    expect(document.activeElement).toBe(code);
    await user.type(code, "12a3 4567");
    expect(code.value).toBe("123456");
    await user.click(screen.getByRole("button", { name: /Sign in/ }));
    expect(
      await screen.findByText(
        "That code isn't right. Check the email and try again.",
      ),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Send a new code" }));
    expect(await screen.findByText("We sent a new code.")).toBeTruthy();
    expect(auth.lastCode()).not.toBe(first);
    await user.click(
      screen.getByRole("button", { name: /Use a different email/ }),
    );
    await user.click(screen.getByRole("button", { name: /Email me a code/ }));

    await user.clear(await screen.findByPlaceholderText("123456"));
    await user.type(screen.getByPlaceholderText("123456"), auth.lastCode());
    await user.click(screen.getByRole("button", { name: /Sign in/ }));
    // Signed in, the panel goes where it was headed.
    expect(
      await screen.findByText("owner@example.org", {
        selector: ".v-table__sub",
      }),
    ).toBeTruthy();
  });

  it("starts over after too many wrong codes", async () => {
    const user = userEvent.setup();
    const auth = signIn();
    await openPanel(config, { api: { auth: auth.options } });
    await user.type(
      await screen.findByPlaceholderText("you@example.org"),
      "owner@example.org",
    );
    await user.click(screen.getByRole("button", { name: /Email me a code/ }));
    const code = await screen.findByPlaceholderText("123456");
    const wrong = auth.lastCode() === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) {
      await user.clear(code);
      await user.type(code, wrong);
      await user.click(screen.getByRole("button", { name: /Sign in/ }));
      await screen.findByRole("alert");
      await waitFor(() =>
        expect(
          screen
            .queryByRole("button", { name: /Sign in/ })
            ?.querySelector(".v-spinner"),
        ).toBeFalsy(),
      );
    }
    await user.clear(code);
    await user.type(code, wrong);
    await user.click(screen.getByRole("button", { name: /Sign in/ }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "Too many incorrect codes. Request a new one.",
      ),
    );
    expect(screen.getByPlaceholderText("you@example.org")).toBeTruthy();
  });

  it("explains a bad address", async () => {
    const user = userEvent.setup();
    const auth = signIn();
    await openPanel(config, { api: { auth: auth.options } });
    const email = await screen.findByPlaceholderText("you@example.org");
    await user.type(email, "not-an-address");
    // The browser would stop the form; submit it anyway.
    email.closest("form")!.noValidate = true;
    await user.click(screen.getByRole("button", { name: /Email me a code/ }));
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("signs out", async () => {
    const { user } = await signedIn("/");
    await screen.findByText("Users");
    await user.click(document.querySelector(".v-chrome__avatar")!);
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByPlaceholderText("you@example.org")).toBeTruthy();
  });
});

describe("the users page", () => {
  it("invites, edits and removes users", async () => {
    const { user, auth } = await signedIn();
    const me = await screen.findByText("owner@example.org", {
      selector: ".v-table__sub",
    });
    const mine = me.closest("tr")!;
    expect(within(mine).getByText("(you)")).toBeTruthy();
    expect(within(mine).getByText(/config/)).toBeTruthy();
    expect(within(mine).getByText("Active")).toBeTruthy();

    // Invite someone.
    await user.click(screen.getByRole("button", { name: /Invite user/ }));
    let dialog = screen.getByRole("dialog");
    const send = within(dialog).getByRole<HTMLButtonElement>("button", {
      name: "Send invitation",
    });
    expect(send.disabled).toBe(true);
    await user.type(
      within(dialog).getByPlaceholderText("colleague@example.org"),
      "ed@example.org",
    );
    await user.type(within(dialog).getByPlaceholderText("Optional"), "Ed");
    await user.click(within(dialog).getByRole("radio", { name: /Admin/ }));
    await user.click(send);
    expect(
      await screen.findByText("Invitation sent to ed@example.org."),
    ).toBeTruthy();
    expect(auth.mailer.sent.at(-1)!.to).toBe("ed@example.org");
    expect(
      await within(await waitFor(() => row("Ed"))).findByText("Invited"),
    ).toBeTruthy();
    expect(within(row("Ed")).getByText("Admin")).toBeTruthy();
    expect(within(row("Ed")).getByText("—")).toBeTruthy();

    // Inviting the same address again fails in the form.
    await user.click(screen.getByRole("button", { name: /Invite user/ }));
    dialog = screen.getByRole("dialog");
    await user.type(
      within(dialog).getByPlaceholderText("colleague@example.org"),
      "ed@example.org",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Send invitation" }),
    );
    expect(await within(dialog).findByRole("alert")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await action(user, "Ed", "Re-send invitation");
    expect(
      await screen.findByText("Invitation re-sent to ed@example.org."),
    ).toBeTruthy();

    await action(user, "Ed", "Edit name and role");
    dialog = screen.getByRole("dialog");
    const name = within(dialog).getByDisplayValue("Ed");
    await user.clear(name);
    await user.type(name, "Edward");
    await user.click(within(dialog).getByRole("radio", { name: /Editor/ }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("User updated.")).toBeTruthy();
    expect(
      within(await waitFor(() => row("Edward"))).getByText("Editor"),
    ).toBeTruthy();

    // Removing asks first.
    await action(user, "Edward", "Remove");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await action(user, "Edward", "Remove");
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Remove",
      }),
    );
    expect(await screen.findByText("Edward was removed.")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Edward")).toBeNull());
  });

  it("keeps a config admin's role, and has no remove for yourself", async () => {
    const { user } = await signedIn();
    const me = await screen.findByText("owner@example.org", {
      selector: ".v-table__sub",
    });
    await user.click(within(me.closest("tr")!).getByTitle("Actions"));
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Re-send invitation" }),
    ).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Edit name and role" }),
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/always an admin/)).toBeTruthy();
    expect(
      within(dialog).getByRole<HTMLInputElement>("radio", { name: /Editor/ })
        .disabled,
    ).toBe(true);
    await user.type(within(dialog).getByRole("textbox"), "Owner");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("User updated.")).toBeTruthy();
    expect(
      await screen.findByText("Owner", { selector: ".v-table__title" }),
    ).toBeTruthy();
  });

  it("explains that local mode has no users", async () => {
    await openPanel(config, { url: "/users" });
    expect(
      await screen.findByText(/Sign-in is off in local mode/),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Invite user/ })).toBeNull();
  });
});
