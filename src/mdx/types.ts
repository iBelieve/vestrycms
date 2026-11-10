/** Minimal ProseMirror JSON shapes, shared by the converter and the editor. */
export interface PMMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  marks?: PMMark[];
  text?: string;
}

/** A non-literal JSX attribute value, kept verbatim as source. */
export interface RawExpression {
  $raw: string;
}

export function isRawExpression(v: unknown): v is RawExpression {
  return (
    typeof v === "object" &&
    v !== null &&
    "$raw" in v &&
    typeof (v as RawExpression).$raw === "string"
  );
}

export type PropValue = unknown;

export interface ImportSpec {
  /** Local identifier, e.g. `Highlights`. */
  name: string;
  /** Module specifier. */
  from: string;
  /** Default or named import. */
  named?: boolean;
}

export interface ParsedDocument {
  doc: PMNode;
  /** Imports found in the source, keyed by local name. */
  imports: Record<string, ImportSpec>;
}

export interface ComponentRegistry {
  /** Component name → import spec to emit when it is used. */
  [name: string]: {
    import?: string;
    namedImport?: boolean;
    inline?: boolean;
    children?: boolean | "text";
  };
}
