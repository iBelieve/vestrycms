import { describe, expect, it } from "vitest";
import { ApiError, describeError } from "../src/ui/api.js";
import { splitLinks } from "../src/ui/lib/utils.js";

describe("splitLinks", () => {
  it("leaves text without URLs whole", () => {
    expect(splitLinks("Not found")).toEqual([{ text: "Not found" }]);
    expect(splitLinks("")).toEqual([]);
  });

  it("keeps sentence punctuation out of a URL", () => {
    expect(
      splitLinks("See https://developers.cloudflare.com/d1/platform/limits/."),
    ).toEqual([
      { text: "See " },
      {
        text: "https://developers.cloudflare.com/d1/platform/limits/",
        url: "https://developers.cloudflare.com/d1/platform/limits/",
      },
      { text: "." },
    ]);
  });

  it("drops a closing parenthesis the URL did not open", () => {
    expect(
      splitLinks("(see https://example.org/a.) and https://x.io/b_(c)"),
    ).toEqual([
      { text: "(see " },
      { text: "https://example.org/a", url: "https://example.org/a" },
      { text: ".) and " },
      { text: "https://x.io/b_(c)", url: "https://x.io/b_(c)" },
    ]);
  });

  it("keeps a URL's own brackets but not one more around it", () => {
    expect(splitLinks("(see https://en.wikipedia.org/wiki/Foo_(bar))")).toEqual(
      [
        { text: "(see " },
        {
          text: "https://en.wikipedia.org/wiki/Foo_(bar)",
          url: "https://en.wikipedia.org/wiki/Foo_(bar)",
        },
        { text: ")" },
      ],
    );
    expect(splitLinks("[https://x.io/a]")).toEqual([
      { text: "[" },
      { text: "https://x.io/a", url: "https://x.io/a" },
      { text: "]" },
    ]);
  });

  it("keeps closing curly quotes and ellipses out of a URL", () => {
    expect(splitLinks("Open “https://x.io/a”…")).toEqual([
      { text: "Open “" },
      { text: "https://x.io/a", url: "https://x.io/a" },
      { text: "”…" },
    ]);
  });

  it("does not link other schemes", () => {
    expect(splitLinks("javascript:alert(1) ftp://x")).toEqual([
      { text: "javascript:alert(1) ftp://x" },
    ]);
  });
});

describe("describeError", () => {
  it("separates a platform code from the message", () => {
    const err = new ApiError(
      "D1_ERROR: Your account has exceeded D1's free tier daily row write limit.",
      500,
      "internal",
    );
    expect(describeError(err)).toEqual({
      message:
        "Your account has exceeded D1's free tier daily row write limit.",
      meta: ["HTTP 500", "D1_ERROR"],
    });
  });

  it("keeps a specific API code", () => {
    expect(describeError(new ApiError("Bad gateway", 502, "github"))).toEqual({
      message: "Bad gateway",
      meta: ["HTTP 502", "github"],
    });
  });

  it("leaves out an empty API code", () => {
    expect(describeError(new ApiError("Nope", 400, "")).meta).toEqual([
      "HTTP 400",
    ]);
  });

  it("handles plain errors and strings", () => {
    expect(describeError(new TypeError("Failed to fetch"))).toEqual({
      message: "Failed to fetch",
      meta: [],
    });
    expect(describeError("No configuration")).toEqual({
      message: "No configuration",
      meta: [],
    });
    expect(describeError(null).message).toBe("Unknown error");
  });

  it("does not take an ordinary leading word for a code", () => {
    expect(describeError(new Error("Note: x")).meta).toEqual([]);
    expect(describeError(new Error("HTTP: x")).meta).toEqual([]);
  });
});
