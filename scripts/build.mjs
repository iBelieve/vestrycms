// Compiles src/ to dist/ with tsc and copies the files tsc doesn't emit: the
// admin.astro shell (its client script is pointed at the compiled UI), the
// control panel stylesheet and the ambient virtual-module declarations.
// It then checks that `clientDependencies` names every package the compiled
// control panel imports. `--watch` keeps tsc running afterwards, for working
// against a linked site.
import { spawn } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = path.join(root, "src");
const dist = path.join(root, "dist");
const watch = process.argv.includes("--watch");
// TypeScript 7's export map includes `./package.json` and not `./bin/tsc`.
// The `bin` field is the supported location of the compiler entry: a Node
// launcher that execs the native binary.
const manifestPath = createRequire(import.meta.url).resolve(
  "typescript/package.json",
);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (typeof manifest.bin?.tsc !== "string") {
  throw new Error("typescript package.json does not declare a tsc binary");
}
const tsc = path.resolve(path.dirname(manifestPath), manifest.bin.tsc);

function runTsc(extra = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [tsc, "-p", "tsconfig.build.json", ...extra],
      { cwd: root, stdio: "inherit" },
    );
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`tsc exited with ${code}`)),
    );
  });
}

async function copyAssets() {
  await mkdir(path.join(dist, "pages"), { recursive: true });
  await mkdir(path.join(dist, "ui"), { recursive: true });

  const admin = await readFile(path.join(src, "pages/admin.astro"), "utf8");
  const compiled = admin.replace('"../ui/main.tsx"', '"../ui/main.js"');
  if (compiled === admin) {
    throw new Error("admin.astro no longer imports ../ui/main.tsx");
  }
  await writeFile(path.join(dist, "pages/admin.astro"), compiled);
  await cp(path.join(src, "ui/styles.css"), path.join(dist, "ui/styles.css"));
  await cp(path.join(src, "env.d.ts"), path.join(dist, "env.d.ts"));
}

/** Bare specifiers reachable from `entry` through relative imports. */
async function bareImports(entry) {
  const seen = new Set();
  const found = new Set();
  const pattern =
    /(?:^|[;\s])(?:import|export)\s*(?:[^"';]*?\sfrom\s*)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
  async function walk(file) {
    if (seen.has(file)) return;
    seen.add(file);
    const text = await readFile(file, "utf8");
    for (const match of text.matchAll(pattern)) {
      const specifier = match[1] ?? match[2];
      if (specifier.startsWith(".")) {
        if (specifier.endsWith(".js")) {
          await walk(path.resolve(path.dirname(file), specifier));
        }
      } else if (!specifier.startsWith("virtual:")) {
        found.add(specifier);
      }
    }
  }
  await walk(entry);
  return found;
}

async function checkClientDependencies() {
  const { clientDependencies } = await import(
    pathToFileURL(path.join(dist, "integration/client-deps.js")).href
  );
  const listed = new Set(clientDependencies);
  const used = await bareImports(path.join(dist, "ui/main.js"));
  const missing = [...used].filter((dep) => !listed.has(dep));
  const unused = [...listed].filter((dep) => !used.has(dep));
  if (missing.length || unused.length) {
    throw new Error(
      `src/integration/client-deps.ts is out of date.` +
        (missing.length ? ` Add: ${missing.join(", ")}.` : "") +
        (unused.length ? ` Remove: ${unused.join(", ")}.` : ""),
    );
  }
}

await rm(dist, { recursive: true, force: true });
await runTsc();
await copyAssets();
await checkClientDependencies();
if (watch) await runTsc(["--watch", "--preserveWatchOutput"]);
