import { useEffect, useState } from "react";
import { cx, initials } from "../lib/utils.js";

/**
 * A user's picture from Gravatar, or Gravatar's initials on a colour of its
 * own when they have none (`d=initials`, from their name). Our own initials
 * sit underneath, so they show while the picture loads, and stay when the
 * browser can't hash (an insecure origin) or reach Gravatar.
 */
export function Avatar({
  name,
  email,
  size,
  className,
}: {
  name?: string;
  email?: string;
  /** The rendered size in CSS pixels; the picture is fetched at twice that. */
  size: number;
  className?: string;
}) {
  const src = useGravatar(email, name, size * 2);
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span className={cx("v-avatar", className)} aria-hidden>
      {initials(name || email || "?")}
      {src && failed !== src && (
        <img
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailed(src)}
        />
      )}
    </span>
  );
}

function useGravatar(
  email: string | undefined,
  name: string | undefined,
  pixels: number,
): string | null {
  // The URL is kept with the inputs it was made for, so a changed address
  // never shows the last one's picture while the new hash is computed.
  const key = `${email ?? ""}\n${name ?? ""}\n${pixels}`;
  const [found, setFound] = useState<{ key: string; url: string | null }>();
  useEffect(() => {
    let live = true;
    if (email) {
      void gravatarUrl(email, name, pixels).then(
        (url) => live && setFound({ key, url }),
        () => {},
      );
    }
    return () => {
      live = false;
    };
  }, [key, email, name, pixels]);
  return found?.key === key ? found.url : null;
}

/**
 * The Gravatar URL for an address: the SHA-256 of the trimmed, lower-cased
 * address, with `name` for the initials fallback. Null where Web Crypto is
 * unavailable (pages served over plain HTTP from anywhere but localhost).
 */
export async function gravatarUrl(
  email: string,
  name: string | undefined,
  pixels: number,
): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  const address = email.trim().toLowerCase();
  if (!subtle || !address) return null;
  const digest = await subtle.digest(
    "SHA-256",
    new TextEncoder().encode(address),
  );
  const hash = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const params = new URLSearchParams({ s: String(pixels), d: "initials" });
  // Gravatar reads initials from a name; for an address alone, send ours.
  if (name?.trim()) params.set("name", name.trim());
  else params.set("initials", initials(address));
  return `https://gravatar.com/avatar/${hash}?${params}`;
}
