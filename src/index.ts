import type { AstroIntegration } from "astro";
import type { Plugin as VitePlugin } from "vite";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { loadEnv } from "vite";
import type { VestryConfig } from "./config/types.js";
import { createApi } from "./core/api.js";
import type { BuildIndex } from "./core/index-types.js";
import { buildIndex } from "./integration/build-index.js";
import { formatterModule } from "./integration/formatter.js";
import { nodeToFetchHandler } from "./integration/dev-middleware.js";
import { LocalSource } from "./core/sources/local.js";
import { consoleMailer } from "./core/mail.js";
import { clientDependencies } from "./integration/client-deps.js";

export type { VestryConfig } from "./config/types.js";
export {
  defineConfig,
  collection,
  singleton,
  component,
  assetContainer,
  fields,
} from "./config/index.js";

export interface VestryIntegrationOptions {
  /** URL path the control panel is served from. Defaults to `/admin`. */
  base?: string;
  /**
   * What `astro dev` does. `local` (the default) edits the project directory
   * with no sign-in. `auth` edits the project directory but requires sign-in,
   * with users and sessions kept in `.vestry/auth.sqlite` and emails printed to
   * the terminal, for working on the sign-in flow itself. `github` goes
   * through the repository with the GitHub App credentials, as production
   * does. `VESTRY_MODE` in the environment sets this too.
   */
  mode?: "local" | "auth" | "github";
}

const VIRTUAL = {
  config: "virtual:vestry/config",
  index: "virtual:vestry/index",
  runtime: "virtual:vestry/runtime",
  formatter: "virtual:vestry/formatter",
} as const;

export default function vestry(
  config: VestryConfig,
  options: VestryIntegrationOptions = {},
): AstroIntegration {
  const basePath = `/${(options.base ?? "/admin").replace(/^\/+|\/+$/g, "")}`;
  validateConfig(config);

  return {
    name: "vestry",
    hooks: {
      "astro:config:setup": ({
        command,
        config: astroConfig,
        injectRoute,
        updateConfig,
        addWatchFile,
        logger,
      }) => {
        const root = fileURLToPath(astroConfig.root);
        // The config arrives as an object, so Astro can't know which file it
        // came from. Watch the conventional file name so edits restart dev.
        for (const name of [
          "vestry.config.ts",
          "vestry.config.mts",
          "vestry.config.js",
          "vestry.config.mjs",
        ]) {
          const candidate = path.join(root, name);
          if (existsSync(candidate)) addWatchFile(candidate);
        }
        const isDev = command === "dev";
        const fileEnv = loadEnv(isDev ? "development" : "production", root, "");
        const readEnv = (key: string) => process.env[key] ?? fileEnv[key];
        const envMode = readEnv("VESTRY_MODE");
        const mode =
          options.mode ??
          (envMode === "github" || envMode === "auth"
            ? envMode
            : isDev
              ? "local"
              : "github");

        let indexPromise: Promise<BuildIndex> | null = null;
        const getIndex = () => (indexPromise ??= buildIndex(root, config));

        const plugin: VitePlugin = {
          name: "vestry",
          resolveId(id) {
            if (
              Object.values(VIRTUAL).includes(
                id as (typeof VIRTUAL)[keyof typeof VIRTUAL],
              )
            )
              return `\0${id}`;
            return null;
          },
          async load(id) {
            if (id === `\0${VIRTUAL.config}`)
              return `export default ${JSON.stringify(config)};`;
            if (id === `\0${VIRTUAL.runtime}`) {
              return `export const basePath = ${JSON.stringify(basePath)};\nexport const name = ${JSON.stringify(config.name ?? "Vestry")};`;
            }
            if (id === `\0${VIRTUAL.formatter}`) {
              return formatterModule(root, config.format !== false);
            }
            if (id === `\0${VIRTUAL.index}`) {
              // Dev edits bypass the index (the local source reads disk), so
              // an empty index keeps dev startup instant.
              const index = isDev
                ? { builtAt: "", files: {} }
                : await getIndex();
              return `export default ${JSON.stringify(index)};`;
            }
            return null;
          },
          configureServer(server) {
            if (!isDev) return;
            const localSource =
              mode === "github" ? undefined : new LocalSource(root);
            // Dev keeps users and sessions in a SQLite file and, unless a real
            // mail provider is configured, prints sign-in codes to the terminal.
            let auth: Parameters<typeof createApi>[0]["auth"];
            if (mode !== "local") {
              const dir = path.join(root, ".vestry");
              mkdirSync(dir, { recursive: true });
              // Loaded only here, so builds and plain local dev never touch
              // node:sqlite. A CJS require rather than import(): Astro runs
              // this file through Vite's module runner, which intercepts
              // dynamic imports and has already closed by the time this runs.
              const { DatabaseSync } = createRequire(import.meta.url)(
                "node:sqlite",
              ) as typeof import("node:sqlite");
              auth = {
                database: new DatabaseSync(path.join(dir, "auth.sqlite")),
                mailer:
                  config.mail?.provider === "resend" &&
                  readEnv("VESTRY_RESEND_API_KEY")
                    ? undefined
                    : consoleMailer((line) => logger.info(line)),
                required: true,
                dev: true,
              };
            }
            const api = createApi({
              config,
              index: { builtAt: "", files: {} },
              basePath,
              env: readEnv,
              localSource,
              auth,
            });
            const handler = nodeToFetchHandler(api.handle);
            server.middlewares.use((req, res, next) => {
              if (
                !req.url?.startsWith(`${api.apiPrefix}/`) &&
                req.url !== api.apiPrefix
              )
                return next();
              return handler(req, res, next);
            });
            logger.info(
              `Control panel at ${basePath} (${
                mode === "local"
                  ? "editing local files, no sign-in"
                  : mode === "auth"
                    ? "editing local files, sign-in required"
                    : `GitHub ${config.repo.owner}/${config.repo.name}`
              })`,
            );
          },
        };

        updateConfig({
          vite: {
            plugins: [plugin],
            optimizeDeps: {
              include: clientDependencies.map((dep) => `vestrycms > ${dep}`),
            },
          },
        });

        injectRoute({
          pattern: `${basePath}/api/[...path]`,
          entrypoint: "vestrycms/pages/api",
          prerender: false,
        });
        injectRoute({
          pattern: `${basePath}/[...path]`,
          entrypoint: "vestrycms/pages/admin.astro",
          prerender: false,
        });
      },
    },
  };
}

function validateConfig(config: VestryConfig) {
  if (!config.repo?.owner || !config.repo?.name) {
    throw new Error(
      "[vestry] config.repo.owner and config.repo.name are required",
    );
  }
  for (const [key, col] of Object.entries(config.collections ?? {})) {
    if (!col.path) throw new Error(`[vestry] collection "${key}" needs a path`);
    if (col.body) {
      for (const name of col.body.components ?? []) {
        if (!config.components?.[name]) {
          throw new Error(
            `[vestry] collection "${key}" references unknown component "${name}"`,
          );
        }
      }
    }
  }
  try {
    JSON.stringify(config);
  } catch {
    throw new Error("[vestry] config must be JSON-serializable (no functions)");
  }
}
