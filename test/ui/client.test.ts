// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  UNAUTHORIZED_EVENT,
  createClient,
} from "../../src/ui/api.js";
import { authErrorMessage } from "../../src/ui/auth-client.js";

describe("the API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A client whose requests get `response`; returns the requests made. */
  function client(response: () => Response) {
    const calls: [string, RequestInit][] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return response();
    });
    return { api: createClient("/admin/"), calls };
  }

  it("sends JSON and reads JSON", async () => {
    const { api, calls } = client(() => Response.json({ user: { id: "u" } }));
    expect(await api.updateUser("a/b c", { name: "N" })).toEqual({
      user: { id: "u" },
    });
    const [url, init] = calls[0];
    expect(url).toBe("/admin/api/users/a/b%20c");
    expect(init).toMatchObject({
      method: "PATCH",
      body: '{"name":"N"}',
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });
  });

  it("gives nothing for an empty response", async () => {
    expect(
      await client(() => new Response(null, { status: 204 })).api.status(),
    ).toBe(undefined);
    expect(await client(() => new Response("")).api.status()).toBe(null);
    expect(await client(() => new Response("not json")).api.status()).toBe(
      null,
    );
  });

  it("throws the API's error", async () => {
    const { api } = client(() =>
      Response.json(
        { error: { message: "Gone", code: "gone" } },
        { status: 410 },
      ),
    );
    await expect(api.listUsers()).rejects.toEqual(
      new ApiError("Gone", 410, "gone"),
    );
    const plain = client(() => new Response("oops", { status: 502 })).api;
    await expect(plain.config()).rejects.toMatchObject({
      message: "Request failed (502)",
      status: 502,
      code: "error",
    });
  });

  it("tells the app when the session has ended", async () => {
    const listener = vi.fn();
    window.addEventListener(UNAUTHORIZED_EVENT, listener);
    const unauthorized = (code: string) =>
      client(() =>
        Response.json({ error: { message: "No", code } }, { status: 401 }),
      ).api.status();
    await expect(unauthorized("setup")).rejects.toThrow("No");
    expect(listener).not.toHaveBeenCalled();
    await expect(unauthorized("unauthorized")).rejects.toThrow("No");
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(UNAUTHORIZED_EVENT, listener);
  });

  it("builds file addresses", () => {
    const { api } = client(() => new Response());
    expect(api.fileUrl("src/a b.png", "abc")).toBe(
      "/admin/api/file?path=src%2Fa%20b.png&v=abc",
    );
    expect(api.fileUrl("x.png")).toBe("/admin/api/file?path=x.png");
  });
});

describe("authErrorMessage", () => {
  it("explains the errors sign-in can give", () => {
    expect(authErrorMessage({ code: "INVALID_OTP" })).toMatch(/isn't right/);
    expect(authErrorMessage({ code: "OTP_EXPIRED" })).toMatch(/expired/);
    expect(authErrorMessage({ code: "TOO_MANY_ATTEMPTS" })).toMatch(
      /Too many incorrect/,
    );
    expect(authErrorMessage({ code: "INVALID_EMAIL" })).toMatch(/valid email/);
    expect(authErrorMessage({ message: "Too Many Requests" })).toMatch(
      /wait a minute/,
    );
    expect(authErrorMessage({ code: "toString", message: "Odd" })).toBe("Odd");
    expect(authErrorMessage(null)).toBe(
      "Something went wrong. Please try again.",
    );
    expect(authErrorMessage(undefined, "Fallback")).toBe("Fallback");
  });
});
