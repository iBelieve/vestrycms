import { splitFrontmatter } from "../core/entries.js";
import { parseMdx } from "./parse.js";
import { isRawExpression, type PMNode } from "./types.js";

/**
 * Prettier's MDX parser predates MDX 2. It reads a paragraph that begins
 * with a tag (`<u>Note:</u> …`, `<span class="lead">…</span>`) as a JSX
 * block, and prints it as one: a long element is spread over several lines,
 * which MDX then reads as a block element around a paragraph, and a Markdown
 * hard break inside becomes a stray backslash.
 *
 * So, given a file (frontmatter and body) and what a formatter made of it,
 * this returns the formatted file only if its body still parses to the same
 * document. Otherwise it returns the formatted frontmatter with the body as
 * it was.
 */
export function keepDocument(
  text: string,
  formatted: string,
  format: "md" | "mdx",
): string {
  if (formatted === text) return text;
  const body = splitFrontmatter(text).body;
  const formattedBody = splitFrontmatter(formatted).body;
  let before: string;
  try {
    before = comparable(parseMdx(body, { format }).doc);
  } catch {
    // Source the editor cannot parse either: nothing to compare against.
    return formatted;
  }
  try {
    if (comparable(parseMdx(formattedBody, { format }).doc) === before)
      return formatted;
  } catch {
    /* formatting broke the syntax */
  }
  console.warn(
    "[vestry] Prettier would change the content, so the body is kept as written",
  );
  return formatted.slice(0, formatted.length - formattedBody.length) + body;
}

/**
 * A document reduced to what formatting must not change: its structure and
 * text. Runs of whitespace count as one space, and code is left out, since
 * Prettier re-wraps text and formats code blocks, expressions and ESM.
 */
function comparable(doc: PMNode): string {
  return JSON.stringify(doc, (key, value: unknown) => {
    if (isRawExpression(value)) return "{…}";
    if (key === "value" || key === "spreads") return undefined;
    if (value && typeof value === "object" && "type" in value) {
      const node = value as PMNode;
      if (node.type === "text")
        return { ...node, text: (node.text ?? "").replace(/\s+/g, " ") };
      if (node.type === "codeBlock") return { ...node, content: undefined };
    }
    return value;
  });
}
