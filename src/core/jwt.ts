/**
 * RS256 JSON Web Tokens, signed with WebCrypto only so they work in workerd
 * as well as Node: GitHub App sign-in and Google service accounts.
 */
import { base64Decode, base64Encode } from "./source.js";

/** The private key could not be read; the message says which key. */
export class KeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyError";
  }
}

/**
 * A JWT with these claims, signed with an RSA private key (PEM: PKCS#1 or
 * PKCS#8, `\n`-escaped or base64-encoded PEM also accepted). `what` names
 * the key in errors; `keyId` goes in the header as `kid`.
 */
export async function signJwt(
  claims: Record<string, unknown>,
  privateKey: string,
  { what, keyId }: { what: string; keyId?: string },
): Promise<string> {
  const encode = (value: unknown) =>
    base64Url(new TextEncoder().encode(JSON.stringify(value)));
  const header = encode({
    alg: "RS256",
    typ: "JWT",
    ...(keyId ? { kid: keyId } : {}),
  });
  const payload = encode(claims);
  const key = await importRsaPrivateKey(privateKey, what);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${base64Url(new Uint8Array(signature))}`;
}

async function importRsaPrivateKey(
  pem: string,
  what: string,
): Promise<CryptoKey> {
  const der = pemToPkcs8(normalizePem(pem, what), what);
  try {
    return await crypto.subtle.importKey(
      "pkcs8",
      der as BufferSource,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch (e) {
    throw new KeyError(
      `${what} could not be imported: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/** Accepts a PEM, a PEM with literal `\n`, or a base64-encoded PEM (handy for env vars). */
function normalizePem(value: string, what: string): string {
  let pem = value.trim().replace(/\\n/g, "\n");
  if (!pem.includes("-----BEGIN")) {
    try {
      pem = new TextDecoder().decode(base64Decode(pem)).trim();
    } catch {
      /* fall through to the error below */
    }
  }
  if (!pem.includes("-----BEGIN")) {
    throw new KeyError(`${what} is not a PEM-encoded key.`);
  }
  return pem;
}

/** PKCS#8 DER for the key, wrapping PKCS#1 (`RSA PRIVATE KEY`) when needed. */
function pemToPkcs8(pem: string, what: string): Uint8Array {
  const match = pem.match(
    /-----BEGIN ([A-Z ]+)-----([\s\S]+?)-----END \1-----/,
  );
  if (!match) {
    throw new KeyError(`${what} PEM is malformed.`);
  }
  const label = match[1];
  let body: Uint8Array;
  try {
    body = base64Decode(match[2]);
  } catch {
    // `atob` (where there is no Buffer) refuses characters outside base64.
    throw new KeyError(`${what} PEM is malformed.`);
  }
  if (label === "PRIVATE KEY") return body;
  if (label === "RSA PRIVATE KEY") return wrapPkcs1(body);
  throw new KeyError(
    `${what} is an unsupported key type ("${label}"); expected an RSA private key.`,
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
