import type * as ES from "estree";
import { isRawExpression, type RawExpression } from "./types.js";

/**
 * Convert a parsed JSX attribute expression to a plain JSON value when it is
 * made only of literals; otherwise return a RawExpression holding the source.
 */
export function estreeToValue(
  node: ES.Node | undefined,
  source: string,
): unknown {
  if (!node) return { $raw: source } satisfies RawExpression;
  try {
    return literal(node);
  } catch {
    return { $raw: source } satisfies RawExpression;
  }
}

class NotLiteral extends Error {}

function literal(node: ES.Node): unknown {
  const read = LITERALS[node.type] as ((node: ES.Node) => unknown) | undefined;
  if (!read) throw new NotLiteral();
  return read(node);
}

/** How to read each kind of node that can be a literal value. */
const LITERALS: {
  [Type in ES.Node["type"]]?: (
    node: Extract<ES.Node, { type: Type }>,
  ) => unknown;
} = {
  Program: ({ body }) => {
    if (body.length !== 1 || body[0].type !== "ExpressionStatement")
      throw new NotLiteral();
    return literal(body[0]);
  },
  ExpressionStatement: ({ expression }) => literal(expression),
  // A regular expression or a BigInt has no JSON value (`value` may even be
  // null where the runtime cannot build one), so it stays source.
  Literal: (node) => {
    if ("regex" in node || "bigint" in node) throw new NotLiteral();
    return node.value ?? null;
  },
  TemplateLiteral: ({ expressions, quasis }) => {
    if (expressions.length) throw new NotLiteral();
    return quasis.map((q) => q.value.cooked ?? q.value.raw).join("");
  },
  UnaryExpression: ({ operator, argument }) => {
    const arg = literal(argument);
    if (operator === "-" && typeof arg === "number") return -arg;
    if (operator === "+" && typeof arg === "number") return arg;
    if (operator === "!") return !arg;
    throw new NotLiteral();
  },
  Identifier: ({ name }) => {
    if (name === "undefined") return undefined;
    throw new NotLiteral();
  },
  ArrayExpression: ({ elements }) =>
    elements.map((el) => {
      if (!el || el.type === "SpreadElement") throw new NotLiteral();
      return literal(el);
    }),
  // `fromEntries` defines a `__proto__` key as a property rather than
  // setting the object's prototype, as assigning it would.
  ObjectExpression: ({ properties }) =>
    Object.fromEntries(properties.map(propertyEntry)),
};

/** A plain `key: value` property of an object literal. */
function propertyEntry(p: ES.Property | ES.SpreadElement): [string, unknown] {
  if (p.type !== "Property" || p.kind !== "init" || p.method || p.computed)
    throw new NotLiteral();
  return [propertyKey(p.key), literal(p.value)];
}

function propertyKey(key: ES.Property["key"]): string {
  if (key.type === "Identifier") return key.name;
  if (key.type === "Literal") return String(key.value);
  throw new NotLiteral();
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const PRINT_WIDTH = 80;

/**
 * Serialize a JSON value (or RawExpression) to JS source for a JSX attribute,
 * in the shape Prettier produces: multi-line objects and arrays with trailing
 * commas, bare identifier keys, double-quoted strings.
 */
export function valueToSource(value: unknown, indent = ""): string {
  if (isRawExpression(value)) return value.$raw.trim();
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return arraySource(value, indent);
  if (typeof value === "object")
    return objectSource(value as Record<string, unknown>, indent);
  return JSON.stringify(value) ?? "null";
}

function arraySource(value: unknown[], indent: string): string {
  if (!value.length) return "[]";
  const inner = `${indent}  `;
  const items = value.map((v) => valueToSource(v, inner));
  if (value.every(isScalar)) {
    const oneLine = `[${items.join(", ")}]`;
    if (oneLine.length + indent.length <= PRINT_WIDTH - 8) return oneLine;
  }
  return `[\n${items.map((i) => `${inner}${i},`).join("\n")}\n${indent}]`;
}

function objectSource(value: Record<string, unknown>, indent: string): string {
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  if (!entries.length) return "{}";
  const inner = `${indent}  `;
  const keyOf = (k: string) => (IDENT.test(k) ? k : JSON.stringify(k));
  // Like Prettier: a flat object that fits on one line stays on one line.
  if (entries.every(([, v]) => isScalar(v))) {
    const oneLine = `{ ${entries.map(([k, v]) => `${keyOf(k)}: ${valueToSource(v)}`).join(", ")} }`;
    if (oneLine.length + indent.length <= PRINT_WIDTH - 2) return oneLine;
  }
  const lines = entries.map(
    ([k, v]) => `${inner}${keyOf(k)}: ${valueToSource(v, inner)},`,
  );
  return `{\n${lines.join("\n")}\n${indent}}`;
}

function isScalar(v: unknown): boolean {
  return v === null || ["string", "number", "boolean"].includes(typeof v);
}

/** Whether a value can be written as a plain string attribute (`a="b"`) rather than an expression. */
export function isPlainString(value: unknown): value is string {
  return typeof value === "string" && !value.includes("\n");
}
