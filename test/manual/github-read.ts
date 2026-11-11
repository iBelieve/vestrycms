import { GitHubSource } from "../../src/core/sources/github.ts";
import { ContentService } from "../../src/core/service.ts";
import { buildIndex } from "../../src/integration/build-index.ts";
import config from "../../../../vestry.config.ts";
import { toText } from "../../src/core/source.ts";

const src = new GitHubSource({
  owner: "iBelieve",
  repo: "mluther.org",
  branch: "master",
  token: process.env.GH_TOKEN!,
});
let t = Date.now();
console.log("head", await src.head(), `${Date.now() - t}ms`);
t = Date.now();
const files = await src.list("src/content/sermons");
console.log("tree entries under sermons:", files.length, `${Date.now() - t}ms`);
t = Date.now();
const f = await src.read("src/content/sermons/2026-10-25.mdx");
console.log(
  "read sha",
  f?.sha,
  "bytes",
  f?.bytes.length,
  `${Date.now() - t}ms`,
  toText(f!.bytes).slice(0, 40).replace(/\n/g, "\\n"),
);

// Service with a build-time index: listing should need no blob fetches for unchanged files.
const index = await buildIndex(
  new URL("../../../../", import.meta.url).pathname,
  config,
);
const svc = new ContentService(config, src, index);
t = Date.now();
const entries = await svc.listEntries("sermons");
console.log(
  "listEntries",
  entries.length,
  `${Date.now() - t}ms`,
  entries[0].slug,
  entries[0].title,
  entries[0].status,
);
t = Date.now();
const again = await svc.listEntries("sermons");
console.log("listEntries (cached)", again.length, `${Date.now() - t}ms`);
const e = await svc.getEntry("sermons", "2026-10-25");
console.log(
  "getEntry",
  e?.title,
  e?.data.artwork,
  e?.data.bulletin,
  e?.sha === f?.sha,
);
const pr = await svc.listEntries("preachers");
console.log("preachers", pr.map((p) => p.slug).join(","));
const assets = await svc.listAssets("covers");
console.log("covers", assets.items.length, assets.items[0]?.path);
