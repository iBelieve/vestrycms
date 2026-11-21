/**
 * The start of an entry's Markdown or MDX body as plain text, shown under
 * its title in lists when it has no subtitle. Headings are left out (they
 * would run into the next paragraph as one sentence), unless the body has
 * nothing else; links keep their text but not their address, and images,
 * imports, comments and hard-break backslashes are dropped.
 */
export function makeExcerpt(body: string): string | undefined {
  const lines = body
    .replace(/\r\n?/g, "\n")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .split("\n")
    .filter(
      (line) =>
        !/^(import|export)\s/.test(line) &&
        !/^\s*(```|~~~)/.test(line) &&
        !/^\s{0,3}\[[^\]]+\]:\s/.test(line),
    );
  const heading = /^\s{0,3}#{1,6}(\s|$)/;
  const text =
    plainText(lines.filter((line) => !heading.test(line))) ?? plainText(lines);
  return text?.slice(0, 200);
}

function plainText(lines: string[]): string | undefined {
  const text = lines
    .map((line) =>
      line
        .replace(/\\$/, "")
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s*(>\s?)+/, "")
        .replace(/^\s*([-*+]|\d+[.)])\s+/, ""),
    )
    .join("\n")
    // Images go; a link keeps its text, without the address or title.
    .replace(/!\[[^\]]*\]\((?:[^()]|\([^()]*\))*\)/g, " ")
    .replace(/\]\((?:[^()]|\([^()]*\))*\)/g, "]")
    .replace(/\]\[[^\]]*\]/g, "]")
    .replace(/\[\^[^\]]+\]/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\\([\\`*_{}[\]()#+\-.!<>|~])/g, "$1")
    .replace(/[*`[\]]|~~/g, "")
    .replace(/(^|[^\p{L}\p{N}])_+|_+(?=[^\p{L}\p{N}]|$)/gu, "$1")
    .replace(/&(#x[0-9a-f]+|#\d+|nbsp|amp|lt|gt|quot|apos);/gi, entity)
    .replace(/\s+/g, " ")
    .replace(/ ([.,;:!?])(?= |$)/g, "$1")
    .trim();
  return text || undefined;
}

const ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function entity(match: string, name: string): string {
  const lower = name.toLowerCase();
  if (lower.startsWith("#")) {
    const code = lower.startsWith("#x")
      ? parseInt(lower.slice(2), 16)
      : parseInt(lower.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  }
  return ENTITIES[lower] ?? match;
}
