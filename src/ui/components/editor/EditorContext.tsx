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
  /**
   * The repository path of the file the document is saved in. Given it,
   * the image and file props of components hold repository paths while
   * they are edited, and are written back in their fields' `storeAs` form;
   * without it they are edited as the document stores them.
   */
  filePath?: string;
  /** A repository path → a URL the browser can display. */
  assetUrl?: (repoPath: string) => string;
}

export const EditorEnvContext = createContext<EditorEnv>({
  components: {},
  toRepoPath: () => null,
  toDocPath: (p) => p,
});

export function useEditorEnv() {
  return useContext(EditorEnvContext);
}
