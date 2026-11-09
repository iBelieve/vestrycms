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
  switch (node.type) {
    case "Program": {
      const body = (node as ES.Program).body;
      if (body.length !== 1 || body[0].type !== "ExpressionStatement")
        throw new NotLiteral();
      return literal(body[0].expression);
    }
    case "ExpressionStatement":
      return literal((node as ES.ExpressionStatement).expression);
    case "Literal": {
      const v = (node as ES.Literal).value;
      if (v instanceof RegExp) throw new NotLiteral();
      return v ?? null;
    }
    case "TemplateLiteral": {
      const t = node as ES.TemplateLiteral;
      if (t.expressions.length) throw new NotLiteral();
      return t.quasis.map((q) => q.value.cooked ?? q.value.raw).join("");
    }
    case "UnaryExpression": {
      const u = node as ES.UnaryExpression;
      const arg = literal(u.argument);
      if (u.operator === "-" && typeof arg === "number") return -arg;
      if (u.operator === "+" && typeof arg === "number") return arg;
      if (u.operator === "!") return !arg;
      throw new NotLiteral();
    }
    case "Identifier": {
      const name = (node as ES.Identifier).name;
      if (name === "undefined") return undefined;
      throw new NotLiteral();
    }
    case "ArrayExpression":
      return (node as ES.ArrayExpression).elements.map((el) => {
        if (!el || el.type === "SpreadElement") throw new NotLiteral();
        return literal(el);
      });
    case "ObjectExpression": {
      const out: Record<string, unknown> = {};
      for (const p of (node as ES.ObjectExpression).properties) {
        if (
          p.type !== "Property" ||
          p.kind !== "init" ||
          p.method ||
          p.computed
        )
          throw new NotLiteral();
        let key: string;
        if (p.key.type === "Identifier") key = p.key.name;
        else if (p.key.type === "Literal") key = String(p.key.value);
        else throw new NotLiteral();
        out[key] = literal(p.value as ES.Node);
      }
      return out;
    }
    default:
      throw new NotLiteral();
  }
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const PRINT_WIDTH = 80;

/**
 * Serialize a JSON value (or RawExpression) to JS source for a JSX attribute,
 * in the shape Prettier produces: multi-line objects and arrays with trailing
 * commas, bare identifier keys, double-quoted strings.
 */
export function valueToSource(value: unknown, indent = ""): string {
  const inner = `${indent}  `;
  if (isRawExpression(value)) return value.$raw.trim();
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    const simple = value.every((v) => isScalar(v));
    const items = value.map((v) => valueToSource(v, inner));
    if (simple) {
      const oneLine = `[${items.join(", ")}]`;
      if (oneLine.length + indent.length <= PRINT_WIDTH - 8) return oneLine;
    }
    return `[\n${items.map((i) => `${inner}${i},`).join("\n")}\n${indent}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => v !== undefined,
    );
    if (!entries.length) return "{}";
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
  return JSON.stringify(value) ?? "null";
}

function isScalar(v: unknown): boolean {
  return v === null || ["string", "number", "boolean"].includes(typeof v);
}

/** Whether a value can be written as a plain string attribute (`a="b"`) rather than an expression. */
export function isPlainString(value: unknown): value is string {
  return typeof value === "string" && !value.includes("\n");
}
