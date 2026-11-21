/**
 * GitHub App authentication: a short-lived RS256 JWT signed with the app's
 * private key is exchanged for an installation access token (valid for an
 * hour), which the GitHub source then uses like any other token. WebCrypto
 * only, so it works in workerd as well as Node.
 */
import { KeyError, signJwt } from "../jwt.js";
import { SourceError } from "../source.js";

export interface GitHubAppCredentials {
  appId: string;
  installationId: string;
  /** PEM private key (PKCS#1 as GitHub issues it, or PKCS#8), `\n`-escaped or base64-encoded PEM also accepted. */
  privateKey: string;
  apiBase?: string;
}

export type TokenProvider = (() => Promise<string>) & {
  /** Forget the cached token, e.g. after GitHub rejected it. */
  invalidate(): void;
};

interface CachedToken {
  token: string;
  expiresAt: number;
}

interface CacheEntry {
  /** Infinity while the mint is in flight, so concurrent callers share it. */
  expiresAt: number;
  promise: Promise<CachedToken>;
}

const tokenCache = new Map<string, CacheEntry>();

/**
 * Returns a provider that mints (and caches) installation tokens for the
 * app. Concurrent callers share one in-flight mint; a failed mint is
 * forgotten so the next caller retries; tokens are renewed a minute early.
 */
export function installationTokenProvider(
  creds: GitHubAppCredentials,
): TokenProvider {
  const cacheKey = `${creds.apiBase ?? ""}|${creds.appId}:${creds.installationId}`;
  const provider = async () => {
    const entry = tokenCache.get(cacheKey);
    if (entry && entry.expiresAt - Date.now() > 60_000) {
      return (await entry.promise).token;
    }
    const fresh: CacheEntry = {
      expiresAt: Infinity,
      promise: mintInstallationToken(creds),
    };
    tokenCache.set(cacheKey, fresh);
    try {
      const minted = await fresh.promise;
      fresh.expiresAt = minted.expiresAt;
      return minted.token;
    } catch (e) {
      if (tokenCache.get(cacheKey) === fresh) tokenCache.delete(cacheKey);
      throw e;
    }
  };
  provider.invalidate = () => {
    tokenCache.delete(cacheKey);
  };
  return provider;
}

export async function mintInstallationToken(
  creds: GitHubAppCredentials,
): Promise<CachedToken> {
  const apiBase = (creds.apiBase ?? "https://api.github.com").replace(
    /\/$/,
    "",
  );
  const jwt = await signAppJwt(creds.appId, creds.privateKey);
  const res = await fetch(
    `${apiBase}/app/installations/${encodeURIComponent(creds.installationId)}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "vestry",
      },
    },
  );
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) detail = `${body.message} (${res.status})`;
    } catch {
      /* ignore */
    }
    throw new SourceError(
      `Could not get a GitHub App installation token: ${detail}`,
      502,
      "github_app",
    );
  }
  const data = (await res.json()) as { token: string; expires_at: string };
  return { token: data.token, expiresAt: Date.parse(data.expires_at) };
}

/** A GitHub App JWT: issued a minute ago (clock skew), valid for nine more. */
export async function signAppJwt(
  appId: string,
  privateKey: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  try {
    return await signJwt(
      { iat: now - 60, exp: now + 9 * 60, iss: appId },
      privateKey,
      { what: "The GitHub App private key" },
    );
  } catch (e) {
    if (e instanceof KeyError)
      throw new SourceError(e.message, 500, "github_app_key");
    throw e;
  }
}
