/**
 * A matcher for gitignore-style patterns, as found in `.prettierignore`.
 * Supports comments, negation (`!`), root-anchored patterns (a leading or
 * inner `/`), directory patterns (a trailing `/`), `*`, `?` and `**`. As in
 * git, the last pattern that matches a path decides.
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
  return (path) => {
    const normalized = path.replace(/\\/g, "/").replace(/^\.?\/+/, "");
    let ignored = false;
    for (const rule of rules)
      if (rule.pattern.test(normalized)) ignored = !rule.negated;
    return ignored;
  };
}

function toRegExp(pattern: string): RegExp {
  let body = pattern.replace(/\/+$/, "");
  // A pattern with a slash (other than a trailing one) is relative to the root.
  const anchored = body.includes("/");
  body = body.replace(/^\/+/, "");
  let source = "";
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (char === "*") {
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
    } else {
      source += char.replace(/[\\^$.|+()[\]{}]/g, "\\$&");
    }
  }
  // Matching a directory ignores everything beneath it.
  return new RegExp(`^${anchored ? "" : "(?:.*/)?"}${source}(?:/.*)?$`);
}
