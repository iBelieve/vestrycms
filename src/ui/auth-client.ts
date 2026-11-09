import { createAuthClient } from "better-auth/client";
import { emailOTPClient } from "better-auth/client/plugins";

/**
 * Better Auth's browser client, mounted where the API serves `auth/*`. Only
 * sign-in and sign-out go through it; users are managed via Vestry's API.
 */
export function createVestryAuthClient(basePath: string) {
  return createAuthClient({
    baseURL: `${window.location.origin}${basePath.replace(/\/$/, "")}/api/auth`,
    plugins: [emailOTPClient()],
  });
}

export type VestryAuthClient = ReturnType<typeof createVestryAuthClient>;

/** Turns a Better Auth client error into something to show the user. */
export function authErrorMessage(
  error: { code?: string; message?: string } | null | undefined,
  fallback = "Something went wrong. Please try again.",
): string {
  switch (error?.code) {
    case "INVALID_OTP":
      return "That code isn't right. Check the email and try again.";
    case "OTP_EXPIRED":
      return "That code has expired. Request a new one.";
    case "TOO_MANY_ATTEMPTS":
      return "Too many incorrect codes. Request a new one.";
    case "INVALID_EMAIL":
      return "Enter a valid email address.";
    default:
      if (error?.message?.toLowerCase().includes("too many requests"))
        return "Too many sign-in attempts. Please wait a minute and try again.";
      return error?.message || fallback;
  }
}
