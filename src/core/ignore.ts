/**
 * A matcher for gitignore-style patterns, as found in `.prettierignore`.
 * Supports comments, negation (`!`), root-anchored patterns (a leading or
 * inner `/`), directory patterns (a trailing `/`), `*`, `?`, `**`, character
 * classes (`[a-z]`) and backslash escapes. As in git, the last pattern that
 * matches a path decides, and nothing inside an ignored directory can be
 * included again.
 */
export function ignoreMatcher(source: string): (path: string) => boolean {
  const rules = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const negated = line.startsWith("!");
      return { negated, pattern: toRegExp(negated ? line.slice(1) : line) };
    });
  const decide = (path: string) => {
    let ignored = false;
    for (const rule of rules)
      if (rule.pattern.test(path)) ignored = !rule.negated;
    return ignored;
  };
  return (path) => {
    const segments = path
      .replace(/\\/g, "/")
      .replace(/^\.?\/+/, "")
      .split("/");
    // From the top down: once a directory is ignored, so is all it holds.
    for (let depth = 1; depth <= segments.length; depth++)
      if (decide(segments.slice(0, depth).join("/"))) return true;
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
  for (let i = 0; i < body.length; i++) {
    const char = body[i]!;
    if (char === "\\" && i + 1 < body.length) {
      source += escapeChar(body[++i]!);
    } else if (char === "*") {
      if (body[i + 1] === "*") {
        i++;
        if (body[i + 1] === "/") {
          i++;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else if (char === "[") {
      // A character class, `[a-z]` or `[!a-z]`; an unclosed `[` is literal.
      const close = body.indexOf("]", i + 2);
      if (close === -1) {
        source += "\\[";
      } else {
        const negated = body[i + 1] === "!" || body[i + 1] === "^";
        const members = body
          .slice(i + (negated ? 2 : 1), close)
          .replace(/[\\\]^]/g, "\\$&");
        source += `[${negated ? "^/" : ""}${members}]`;
        i = close;
      }
    } else {
      source += escapeChar(char);
    }
  }
  // Matching a directory ignores everything beneath it.
  return new RegExp(`^${anchored ? "" : "(?:.*/)?"}${source}(?:/.*)?$`);
}
