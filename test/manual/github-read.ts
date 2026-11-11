/**
 * Times the live read path against a site's GitHub repository: tree and blob
 * reads, then ContentService listings with a build-time index (which should
 * need no blob fetches for unchanged files). Usage:
 *
 *   GH_TOKEN=… node --import tsx/esm test/manual/github-read.ts path/to/site
 *
 * The site's vestry.config.ts names the repository, collections and assets.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { VestryConfig } from "../../src/config/types.js";
import { parsePathPattern } from "../../src/core/paths.js";
import { ContentService } from "../../src/core/service.js";
import { toText } from "../../src/core/source.js";
import { GitHubSource } from "../../src/core/sources/github.js";
import { buildIndex } from "../../src/integration/build-index.js";

const site = process.argv[2];
if (!site || !process.env.GH_TOKEN) {
  console.error(
    "Usage: GH_TOKEN=… node --import tsx/esm test/manual/github-read.ts path/to/site",
  );
  process.exit(1);
}
const root = path.resolve(site);
const config = (
  await import(pathToFileURL(path.join(root, "vestry.config.ts")).href)
).default as VestryConfig;

const time = async <T>(label: string, run: () => Promise<T>) => {
  const t = Date.now();
  const result = await run();
  console.log(label.padEnd(36), `${Date.now() - t}ms`);
  return result;
};

const src = new GitHubSource({
  owner: config.repo.owner,
  repo: config.repo.name,
  branch: config.repo.branch,
  token: process.env.GH_TOKEN,
});
console.log("head", await time("head", () => src.head()));

const index = await buildIndex(root, config);
const svc = new ContentService(config, src, index);
for (const [key, collection] of Object.entries(config.collections ?? {})) {
  const { directory } = parsePathPattern(collection.path);
  const files = await time(`list ${directory}`, () => src.list(directory));
  console.log(`  ${files.length} files`);
  const entries = await time(`listEntries ${key}`, () => svc.listEntries(key));
  await time(`listEntries ${key} (cached)`, () => svc.listEntries(key));
  const first = entries[0];
  if (!first) continue;
  console.log(`  ${entries.length} entries; first ${first.slug}`, first.title);
  const entry = await time(`getEntry ${key}/${first.slug}`, () =>
    svc.getEntry(key, first.slug),
  );
  const file = await src.read(first.path);
  console.log(
    "  sha matches the listing:",
    entry?.sha === first.sha && file?.sha === first.sha,
    JSON.stringify(toText(file!.bytes).slice(0, 40)),
  );
}
for (const key of Object.keys(config.assets ?? {})) {
  const assets = await time(`listAssets ${key}`, () => svc.listAssets(key));
  console.log(`  ${assets.items.length} items`, assets.items[0]?.path ?? "");
}
