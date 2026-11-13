import { createContext, useContext } from "react";
import type {
  ComponentConfig,
  TextStyleConfig,
} from "../../../config/types.js";

export interface EditorEnv {
  /** Components that may be inserted, keyed by name. */
  components: Record<string, ComponentConfig>;
  /** The site's text styles, offered in the Styles menu. */
  textStyles?: Record<string, TextStyleConfig>;
  /** Resolve an image/file reference in the document to a repository path. */
  toRepoPath: (src: string) => string | null;
  /** Repository path → reference to write into the document. */
  toDocPath: (repoPath: string) => string;
  /** Image directory for uploads from the body editor. */
  imageDirectory?: string;
  /** Resolve a document image src to a URL the browser can display. */
  resolveImage?: (src: string) => string;
}

export const EditorEnvContext = createContext<EditorEnv>({
  components: {},
  toRepoPath: () => null,
  toDocPath: (p) => p,
});

export function useEditorEnv() {
  return useContext(EditorEnvContext);
}
