/**
 * An environment variable or secret: Cloudflare's (nodejs_compat populates
 * process.env), Node adapters', or anything else that exposes a process.env
 * object.
 */
export function readEnv(key: string): string | undefined {
  const fromProcess = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env?.[key];
  if (fromProcess !== undefined) return fromProcess;
  const fromMeta = (
    import.meta as unknown as { env?: Record<string, string | undefined> }
  ).env?.[key];
  return fromMeta;
}
