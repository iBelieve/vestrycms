/**
 * The start of an entry's Markdown or MDX body as plain text, shown under
 * its title in lists when it has no subtitle. Headings are left out (they
 * would run into the next paragraph as one sentence), unless the body has
 * nothing else; links keep their text but not their address, and images,
 * imports and exports, code blocks, footnotes, comments, rules and
 * hard-break backslashes are dropped.
 */
export function makeExcerpt(body: string): string | undefined {
  const text = hideEscapes(
    body
      .replace(/\r\n?/g, "\n")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
      .replace(/<!--[\s\S]*?-->/g, " "),
  );
  // Tags go before the lines are read, so that the `>` closing a tag
  // written over several lines is not taken for a quote.
  const lines = proseLines(text.split("\n"))
    .join("\n")
    .replace(/<[^>]+>/g, " ")
    .split("\n")
    .map((line) => line.replace(/^\s*(>\s?)+/, "").replace(/\\$/, ""));
  const prose = lines.filter(
    (line, i) => !RULE.test(line) && !isHeading(line, lines[i + 1]),
  );
  const plain =
    plainText(prose) ?? plainText(lines.filter((line) => !RULE.test(line)));
  return plain && cut(plain, 200);
}

/** A thematic break, or the `===`/`---` under a setext heading. */
const RULE = /^\s{0,3}(?:=+|-+|([*_-])(?:[ \t]*\1){2,})[ \t]*$/;
const ATX_HEADING = /^\s{0,3}#{1,6}(?:\s+(.*?))?(?:\s+#+)?\s*$/;
const BLANK = /^\s*$/;

function isHeading(line: string, next = ""): boolean {
  return (
    ATX_HEADING.test(line) ||
    (!BLANK.test(line) && /^\s{0,3}(=+|-+)\s*$/.test(next))
  );
}

/**
 * The lines that may hold prose: without ESM (an `import` or `export`
 * starting a block runs to the next blank line, as MDX reads it), fenced
 * code, footnote definitions and link reference definitions.
 */
function proseLines(lines: string[]): string[] {
  const out: string[] = [];
  let end: RegExp | undefined;
  let blockStart = true;
  for (const line of lines) {
    if (end) {
      if (end.test(line)) end = undefined;
    } else {
      end = skipUntil(line, blockStart);
      if (!end && !/^\s{0,3}\[[^\]]+\]:/.test(line)) out.push(line);
    }
    blockStart = BLANK.test(line);
  }
  return out;
}

/** The line that ends a block starting at `line` that is not prose, if it starts one. */
function skipUntil(line: string, blockStart: boolean): RegExp | undefined {
  if (blockStart && /^(import|export)\s/.test(line)) return BLANK;
  if (/^\s{0,3}\[\^[^\]]+\]:/.test(line)) return BLANK;
  const fence = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
  return fence
    ? new RegExp(`^\\s{0,3}${fence[1][0]}{${fence[1].length},}\\s*$`)
    : undefined;
}

function plainText(lines: string[]): string | undefined {
  const text = showEscapes(
    lines
      .map((line) =>
        line.replace(ATX_HEADING, "$1").replace(/^\s*([-*+]|\d+[.)])\s+/, ""),
      )
      .join("\n")
      // Images go; a link keeps its text, without the address or title.
      .replace(/!\[[^\]]*\]\((?:[^()]|\([^()]*\))*\)/g, " ")
      .replace(/!\[[^\]]*\]\[[^\]]*\]/g, " ")
      .replace(/\]\((?:[^()]|\([^()]*\))*\)/g, "]")
      .replace(/\]\[[^\]]*\]/g, "]")
      .replace(/\[\^[^\]]+\]/g, "")
      .replace(/[*`[\]]|~~/g, "")
      .replace(/(^|[^\p{L}\p{N}])_+|_+(?=[^\p{L}\p{N}]|$)/gu, "$1")
      .replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z\d]*);/gi, entity),
  )
    .replace(/\s+/g, " ")
    .replace(/ ([.,;:!?])(?= |$)/g, "$1")
    .trim();
  return text || undefined;
}

/**
 * Backslash escapes (any ASCII punctuation, as in CommonMark), as
 * private-use stand-ins that no markup rule above touches, so `\*` and
 * `\_` stay as written; `showEscapes` puts the characters back.
 */
function hideEscapes(text: string): string {
  return text.replace(/\\([!-/:-@[-`{-~])/g, (_, c: string) =>
    String.fromCharCode(0xe000 + c.charCodeAt(0)),
  );
}

function showEscapes(text: string): string {
  return text.replace(/[\ue021-\ue07e]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xe000),
  );
}

/** The first `max` characters, without half of one written as two (an emoji). */
function cut(text: string, max: number): string {
  const start = text.slice(0, max);
  return /[\ud800-\udbff]$/.test(start) ? start.slice(0, -1) : start;
}

const ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  middot: "·",
  bull: "•",
  times: "×",
};

function entity(match: string, name: string): string {
  const lower = name.toLowerCase();
  if (lower.startsWith("#")) {
    const code = lower.startsWith("#x")
      ? parseInt(lower.slice(2), 16)
      : parseInt(lower.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  }
  return Object.hasOwn(ENTITIES, lower) ? ENTITIES[lower] : match;
}
