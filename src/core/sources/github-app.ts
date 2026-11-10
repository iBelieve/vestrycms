/**
 * GitHub App authentication: a short-lived RS256 JWT signed with the app's
 * private key is exchanged for an installation access token (valid for an
 * hour), which the GitHub source then uses like any other token. WebCrypto
 * only, so it works in workerd as well as Node.
 */
import { base64Decode, base64Encode, SourceError } from "../source.js";

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
  const header = base64Url(
    new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })),
  );
  const payload = base64Url(
    new TextEncoder().encode(
      JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: appId }),
    ),
  );
  const key = await importRsaPrivateKey(privateKey);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${header}.${payload}`) as BufferSource,
  );
  return `${header}.${payload}.${base64Url(new Uint8Array(signature))}`;
}

// ----------------------------------------------------------- key handling

export async function importRsaPrivateKey(pem: string): Promise<CryptoKey> {
  const der = pemToPkcs8(normalizePem(pem));
  try {
    return await crypto.subtle.importKey(
      "pkcs8",
      der as BufferSource,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch (e) {
    throw new SourceError(
      `The GitHub App private key could not be imported: ${e instanceof Error ? e.message : String(e)}`,
      500,
      "github_app_key",
    );
  }
}

/** Accepts a PEM, a PEM with literal `\n`, or a base64-encoded PEM (handy for env vars). */
function normalizePem(value: string): string {
  let pem = value.trim().replace(/\\n/g, "\n");
  if (!pem.includes("-----BEGIN")) {
    try {
      pem = new TextDecoder().decode(base64Decode(pem)).trim();
    } catch {
      /* fall through to the error below */
    }
  }
  if (!pem.includes("-----BEGIN")) {
    throw new SourceError(
      "The GitHub App private key is not a PEM-encoded key.",
      500,
      "github_app_key",
    );
  }
  return pem;
}

/** PKCS#8 DER for the key, wrapping PKCS#1 (`RSA PRIVATE KEY`) when needed. */
function pemToPkcs8(pem: string): Uint8Array {
  const match = pem.match(
    /-----BEGIN ([A-Z ]+)-----([\s\S]+?)-----END \1-----/,
  );
  if (!match) {
    throw new SourceError(
      "The GitHub App private key PEM is malformed.",
      500,
      "github_app_key",
    );
  }
  const label = match[1]!;
  const body = base64Decode(match[2]!);
  if (label === "PRIVATE KEY") return body;
  if (label === "RSA PRIVATE KEY") return wrapPkcs1(body);
  throw new SourceError(
    `Unsupported private key type "${label}"; expected an RSA private key.`,
    500,
    "github_app_key",
  );
}

/**
 * PrivateKeyInfo ::= SEQUENCE { version INTEGER 0, algorithm
 * AlgorithmIdentifier { rsaEncryption, NULL }, privateKey OCTET STRING }
 */
function wrapPkcs1(pkcs1: Uint8Array): Uint8Array {
  const version = new Uint8Array([0x02, 0x01, 0x00]);
  const algorithm = new Uint8Array([
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01,
    0x01, 0x05, 0x00,
  ]);
  const octetString = der(0x04, pkcs1);
  return der(0x30, concat(version, algorithm, octetString));
}

function der(tag: number, content: Uint8Array): Uint8Array {
  const len = content.length;
  let lengthBytes: number[];
  if (len < 0x80) lengthBytes = [len];
  else {
    const bytes: number[] = [];
    let n = len;
    while (n > 0) {
      bytes.unshift(n & 0xff);
      n >>= 8;
    }
    lengthBytes = [0x80 | bytes.length, ...bytes];
  }
  return concat(new Uint8Array([tag, ...lengthBytes]), content);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function base64Url(bytes: Uint8Array): string {
  return base64Encode(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
