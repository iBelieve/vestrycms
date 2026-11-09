import {
  Document as YamlDocument,
  parse as parseYaml,
  stringify as stringifyYaml,
  visit as visitYaml,
} from "yaml";
import type { EntryFormat } from "../config/types.js";

export interface ParsedEntry {
  data: Record<string, unknown>;
  body: string;
}

const FRONTMATTER_RE = /^(?:﻿)?---\r?\n([\s\S]*?)\r?\n?---(?:\r?\n|$)/;

/** Split a Markdown/MDX file into YAML frontmatter and body. */
export function splitFrontmatter(text: string): {
  data: Record<string, unknown>;
  body: string;
  hasFrontmatter: boolean;
} {
  const m = text.match(FRONTMATTER_RE);
  if (!m) return { data: {}, body: text, hasFrontmatter: false };
  const yaml = m[1];
  const body = text.slice(m[0].length);
  let data: unknown = {};
  if (yaml.trim()) {
    data = parseYaml(yaml, { strict: false });
  }
  if (data === null || typeof data !== "object" || Array.isArray(data))
    data = {};
  return { data: data as Record<string, unknown>, body, hasFrontmatter: true };
}

export function parseEntry(format: EntryFormat, text: string): ParsedEntry {
  switch (format) {
    case "md":
    case "mdx": {
      const { data, body } = splitFrontmatter(text);
      return { data, body: body.replace(/^\r?\n/, "") };
    }
    case "yaml": {
      const data = parseYaml(text) ?? {};
      return { data: asRecord(data), body: "" };
    }
    case "json": {
      const data = text.trim() ? JSON.parse(text) : {};
      return { data: asRecord(data), body: "" };
    }
  }
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/**
 * Strings that YAML 1.1 parsers (js-yaml, which Astro uses for frontmatter)
 * would turn into something other than a string: timestamps become Dates,
 * `y`/`n`/`yes`/`no`/`on`/`off` become booleans, leading-zero digits become
 * octal numbers. These are written double-quoted so they survive a round trip.
 */
const YAML11_UNSAFE = [
  /^\d{4}-\d{1,2}-\d{1,2}([Tt ]|$)/,
  /^(y|n|yes|no|on|off|true|false|null|~)$/i,
  /^0\d+$/,
  /^[+-]?\d+(:\d+)+(\.\d+)?$/,
  /^[+-]?\.(inf|nan)$/i,
];

export function needsYamlQuotes(value: string): boolean {
  return YAML11_UNSAFE.some((re) => re.test(value));
}

export function stringifyFrontmatter(data: Record<string, unknown>): string {
  const clean = stripUndefined(data);
  if (Object.keys(clean).length === 0) return "";
  const doc = new YamlDocument(clean);
  visitYaml(doc, {
    Scalar(_key, node) {
      if (typeof node.value === "string" && needsYamlQuotes(node.value))
        node.type = "QUOTE_DOUBLE";
    },
  });
  return doc
    .toString({
      lineWidth: 0,
      defaultStringType: "PLAIN",
      defaultKeyType: "PLAIN",
    })
    .replace(/\n$/, "");
}

export function serializeEntry(
  format: EntryFormat,
  entry: ParsedEntry,
): string {
  switch (format) {
    case "md":
    case "mdx": {
      const fm = stringifyFrontmatter(entry.data);
      const body = entry.body.replace(/\s+$/, "");
      if (!fm) return body ? `${body}\n` : "";
      return body ? `---\n${fm}\n---\n\n${body}\n` : `---\n${fm}\n---\n`;
    }
    case "yaml":
      return stringifyYaml(stripUndefined(entry.data), { lineWidth: 0 });
    case "json":
      return `${JSON.stringify(stripUndefined(entry.data), null, 2)}\n`;
  }
}

/** Single-file collections hold an array of records. */
export function parseEntryList(
  format: EntryFormat,
  text: string,
): Record<string, unknown>[] {
  const value =
    format === "json"
      ? text.trim()
        ? JSON.parse(text)
        : []
      : (parseYaml(text) ?? []);
  if (Array.isArray(value))
    return value.filter((v) => v && typeof v === "object");
  if (value && typeof value === "object") {
    // Allow `{ id: {...}, id2: {...} }` keyed objects too.
    return Object.entries(value as Record<string, Record<string, unknown>>).map(
      ([id, v]) => ({
        id,
        ...v,
      }),
    );
  }
  return [];
}

export function serializeEntryList(
  format: EntryFormat,
  items: Record<string, unknown>[],
): string {
  const clean = items.map(stripUndefined);
  return format === "json"
    ? `${JSON.stringify(clean, null, 2)}\n`
    : stringifyYaml(clean, { lineWidth: 0 });
}

export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripUndefined) as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}
