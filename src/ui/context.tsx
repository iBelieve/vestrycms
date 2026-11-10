import { createContext, useContext } from "react";
import type { VestryConfig } from "../config/types.js";
import type { ApiClient, ClientConfig } from "./api.js";
import type { VestryAuthClient } from "./auth-client.js";

export interface VestryContextValue {
  basePath: string;
  name: string;
  api: ApiClient;
  /** Better Auth's browser client (sign-in, sign-out). */
  authClient: VestryAuthClient;
  client: ClientConfig;
  config: VestryConfig;
  refresh: () => Promise<void>;
}

export const VestryContext = createContext<VestryContextValue | null>(null);

export function useVestry(): VestryContextValue {
  const ctx = useContext(VestryContext);
  if (!ctx)
    throw new Error("useVestry must be used inside <VestryContext.Provider>");
  return ctx;
}

/** Build a control-panel URL. */
export function useHref() {
  const { basePath } = useVestry();
  return (path: string) =>
    `${basePath.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}
