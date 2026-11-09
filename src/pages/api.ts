/// <reference path="../env.d.ts" />
import type { APIRoute } from "astro";
import config from "virtual:vestry/config";
import index from "virtual:vestry/index";
import { basePath } from "virtual:vestry/runtime";
import { createApi } from "../core/api.js";

export const prerender = false;

function readEnv(key: string): string | undefined {
  // Cloudflare (nodejs_compat populates process.env), Node adapters, and
  // anything else that exposes a process.env object.
  const fromProcess = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env?.[key];
  if (fromProcess !== undefined) return fromProcess;
  const fromMeta = (
    import.meta as unknown as { env?: Record<string, string | undefined> }
  ).env?.[key];
  return fromMeta;
}

const api = createApi({ config, index, basePath, env: readEnv });

/**
 * Cloudflare bindings (the D1 database) come from `cloudflare:workers`; the
 * adapter's `locals.runtime.env` was removed in Astro 6 and now throws.
 * Imported lazily and by variable so other runtimes just get no bindings.
 */
async function bindings(): Promise<Record<string, unknown> | undefined> {
  try {
    const specifier = "cloudflare:workers";
    const mod = (await import(/* @vite-ignore */ specifier)) as {
      env?: Record<string, unknown>;
    };
    return mod.env;
  } catch {
    return undefined;
  }
}

export const ALL: APIRoute = async ({ request }) =>
  api.handle(request, { bindings: await bindings() });
