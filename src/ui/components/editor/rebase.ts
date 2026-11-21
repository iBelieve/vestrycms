import type { ComponentConfig } from "../../../config/types.js";
import { dirname, relativePath, resolveRelative } from "../../../core/paths.js";
import { walkValues } from "../../../core/values.js";
import { parseMdx, serializeMdx } from "../../../mdx/index.js";
import type { PMNode } from "../../../mdx/types.js";
import { componentRegistry, mapComponentProps } from "./component-props.js";

export interface RebaseOptions {
  format: "md" | "mdx";
  /** The file the document was written for, and the one it moves to. */
  from: string;
  to: string;
  /** The components the document may use, whose image and file props move too. */
  components: Record<string, ComponentConfig>;
}

/**
 * `source` (Markdown or MDX) moved from one file to another: each relative
 * reference to an image (a Markdown image, or a component's image or file
 * prop, Markdown props included) is made relative to the new file's
 * folder, so it still names the same file. Anything else in the document,
 * and the document itself when nothing needs to change or it doesn't
 * parse, is kept as it was.
 */
export function rebaseMarkdown(source: string, options: RebaseOptions): string {
  const fromDir = dirname(options.from);
  const toDir = dirname(options.to);
  if (fromDir === toDir || !source) return source;
  let parsed: ReturnType<typeof parseMdx>;
  try {
    parsed = parseMdx(source, { format: options.format });
  } catch {
    return source;
  }
  let changed = false;
  const rebase = (value: string) => {
    if (!value.startsWith(".")) return value;
    const moved = relativePath(toDir, resolveRelative(fromDir, value));
    if (moved !== value) changed = true;
    return moved;
  };
  const images = (node: PMNode): PMNode => {
    const src = node.attrs?.src;
    const next =
      node.type === "image" && typeof src === "string"
        ? { ...node, attrs: { ...node.attrs, src: rebase(src) } }
        : node;
    return next.content ? { ...next, content: next.content.map(images) } : next;
  };
  const doc = mapComponentProps(
    images(parsed.doc),
    options.components,
    (schema, props) =>
      walkValues(schema, props, (field, value) => {
        if (typeof value !== "string") return value;
        if (field.type === "image" || field.type === "file")
          return rebase(value);
        if (field.type !== "markdown") return value;
        const moved = rebaseMarkdown(value, {
          ...options,
          format: "mdx",
          components: pick(options.components, field.components),
        });
        if (moved !== value) changed = true;
        return moved;
      }),
  );
  if (!changed) return source;
  return serializeMdx(doc, {
    format: options.format,
    components: componentRegistry(options.components),
    existingImports: parsed.imports,
  });
}

/** The components named, of those configured. */
export function pick(
  components: Record<string, ComponentConfig> | undefined,
  names: string[] | undefined,
): Record<string, ComponentConfig> {
  return Object.fromEntries(
    (names ?? [])
      .map((n) => [n, components?.[n]] as const)
      .filter((e): e is [string, ComponentConfig] => Boolean(e[1])),
  );
}
