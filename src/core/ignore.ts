/**
 * A matcher for gitignore-style patterns, as found in `.prettierignore`.
 * Supports comments, negation (`!`), root-anchored patterns (a leading or
 * inner `/`), directory patterns (a trailing `/`), `*`, `?`, `**`, character
 * classes (`[a-z]`) and backslash escapes. As in git, the last pattern that
 * matches a path decides, and nothing inside an ignored directory can be
 * included again. The paths it is given are files.
 */
export function ignoreMatcher(source: string): (path: string) => boolean {
  const rules = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const negated = line.startsWith("!");
      const pattern = negated ? line.slice(1) : line;
      // A trailing `/` matches directories only.
      const directory = pattern.endsWith("/");
      return { negated, directory, pattern: toRegExp(pattern) };
    });
  const decide = (path: string, isDirectory: boolean) => {
    let ignored = false;
    for (const rule of rules)
      if ((isDirectory || !rule.directory) && rule.pattern.test(path))
        ignored = !rule.negated;
    return ignored;
  };
  return (path) => {
    const segments = path
      .replace(/\\/g, "/")
      .replace(/^\.?\/+/, "")
      .split("/");
    // From the top down: once a directory is ignored, so is all it holds.
    for (let depth = 1; depth <= segments.length; depth++)
      if (decide(segments.slice(0, depth).join("/"), depth < segments.length))
        return true;
    return false;
  };
}

const escapeChar = (char: string) =>
  char.replace(/[\\^$.|+()[\]{}*?]/g, "\\$&");

function toRegExp(pattern: string): RegExp {
  let body = pattern.replace(/\/+$/, "");
  // A pattern with a slash (other than a trailing one) is relative to the root.
  const anchored = body.includes("/");
  body = body.replace(/^\/+/, "");
  let source = "";
  for (let i = 0; i < body.length;) {
    const [part, next] = translate(body, i);
    source += part;
    i = next;
  }
  // Matching a directory ignores everything beneath it.
  return new RegExp(`^${anchored ? "" : "(?:.*/)?"}${source}(?:/.*)?$`);
}

/**
 * The regular expression for the pattern's token at `i`, and where the
 * next token starts.
 */
function translate(body: string, i: number): [string, number] {
  const char = body[i]!;
  if (char === "\\" && i + 1 < body.length)
    return [escapeChar(body[i + 1]!), i + 2];
  if (char === "*") return star(body, i);
  if (char === "?") return ["[^/]", i + 1];
  if (char === "[") return characterClass(body, i);
  return [escapeChar(char), i + 1];
}

/** `*` within a segment, `**` across them, `**\/` for any directories. */
function star(body: string, i: number): [string, number] {
  if (body[i + 1] !== "*") return ["[^/]*", i + 1];
  if (body[i + 2] === "/") return ["(?:.*/)?", i + 3];
  return [".*", i + 2];
}

/** A character class, `[a-z]` or `[!a-z]`; an unclosed `[` is literal. */
function characterClass(body: string, i: number): [string, number] {
  const close = body.indexOf("]", i + 2);
  if (close === -1) return ["\\[", i + 1];
  const negated = body[i + 1] === "!" || body[i + 1] === "^";
  const members = body
    .slice(i + (negated ? 2 : 1), close)
    .replace(/[\\\]^]/g, "\\$&");
  return [`[${negated ? "^/" : ""}${members}]`, close + 1];
}
