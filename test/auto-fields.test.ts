/** "Now" in the editor's time zone: date defaults and auto-updated times. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fields } from "../src/config/index.js";
import {
  applyAutoFields,
  datetimeStorage,
  localDate,
  localDateTime,
} from "../src/core/values.js";

// 7:30 PM in Chicago, which is already the next day in UTC.
const evening = new Date("2026-11-18T01:30:15.000Z");

let tz: string | undefined;
beforeEach(() => {
  tz = process.env.TZ;
  process.env.TZ = "America/Chicago";
});
afterEach(() => {
  if (tz === undefined) delete process.env.TZ;
  else process.env.TZ = tz;
});

describe("local dates and times", () => {
  it("reads the calendar and the clock in the local time zone", () => {
    expect(localDate(evening)).toBe("2026-11-17");
    expect(localDateTime(evening)).toBe("2026-11-17T19:30");
  });

  it("pads single-digit months, days, hours and minutes", () => {
    expect(localDateTime(new Date(2026, 0, 5, 7, 4))).toBe("2026-01-05T07:04");
  });
});

describe("datetimeStorage", () => {
  it("stores wall-clock time unless told otherwise", () => {
    expect(datetimeStorage(fields.datetime())).toBe("local");
    expect(datetimeStorage(fields.datetime({ storage: "iso" }))).toBe("iso");
  });

  it("keeps an auto-updated time an instant by default, as it always was", () => {
    expect(datetimeStorage(fields.datetime({ autoUpdate: true }))).toBe("iso");
    expect(
      datetimeStorage(fields.datetime({ autoUpdate: true, storage: "local" })),
    ).toBe("local");
  });
});

describe("applyAutoFields", () => {
  it("keeps a wall-clock time from any time zone", () => {
    for (const touched of ["2026-11-17T10:31", "2026-11-18T16:29"])
      expect(
        applyAutoFields(
          { touched: fields.datetime({ autoUpdate: true, storage: "local" }) },
          { touched },
          evening,
          { keepWallClock: true },
        ).touched,
      ).toBe(touched);
  });

  const schema = {
    title: fields.text(),
    updated: fields.datetime({ autoUpdate: true }),
    touched: fields.datetime({ autoUpdate: true, storage: "local" }),
    when: fields.datetime({ storage: "local" }),
  };

  it("stamps each auto-updated field with now, in its own storage", () => {
    expect(
      applyAutoFields(
        schema,
        { title: "a", when: "2026-01-01T09:00" },
        evening,
      ),
    ).toEqual({
      title: "a",
      updated: "2026-11-18T01:30:15.000Z",
      touched: "2026-11-17T19:30",
      when: "2026-01-01T09:00",
    });
  });

  it("restamps over an earlier value", () => {
    const data = {
      updated: "2020-01-01T00:00:00.000Z",
      touched: "2020-01-01T00:00",
    };
    expect(applyAutoFields(schema, data, evening)).toMatchObject({
      updated: "2026-11-18T01:30:15.000Z",
      touched: "2026-11-17T19:30",
    });
  });

  it("keeps the wall-clock time the editor stamped, when asked to", () => {
    // The server runs in UTC, so it cannot tell the editor's local time.
    process.env.TZ = "UTC";
    const data = {
      updated: "2020-01-01T00:00:00.000Z",
      touched: "2026-11-17T19:30",
    };
    expect(
      applyAutoFields(schema, data, evening, { keepWallClock: true }),
    ).toMatchObject({
      // An instant is the same everywhere, so the server's is used.
      updated: "2026-11-18T01:30:15.000Z",
      touched: "2026-11-17T19:30",
    });
  });

  it("stamps a missing, malformed or old wall-clock time even when keeping", () => {
    process.env.TZ = "UTC";
    // The oldest kept is 15 hours from now, beyond any time zone's offset.
    const old = ["2020-01-01T00:00", "2026-11-17T10:29", "2026-11-18T16:31"];
    for (const touched of [undefined, "", "yesterday", "2026-11-17", ...old]) {
      expect(
        applyAutoFields(schema, { touched }, evening, { keepWallClock: true })
          .touched,
      ).toBe("2026-11-18T01:30");
    }
  });
});
