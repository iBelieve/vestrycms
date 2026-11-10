/**
 * Every package the control panel imports in the browser (from `ui/main`,
 * following relative imports). An installed integration is excluded from
 * Vite's dependency optimizer, and the optimizer then skips its imports too,
 * so dev would serve these raw: CommonJS ones such as `react/jsx-runtime`
 * fail to load. The integration pre-bundles them explicitly as
 * `vestry > dep`, which resolves each from this package. `pnpm build`
 * checks this list against the compiled UI's imports.
 */
export const clientDependencies = [
  "@codemirror/lang-markdown",
  "@codemirror/lang-yaml",
  "@codemirror/view",
  "@dnd-kit/core",
  "@dnd-kit/modifiers",
  "@dnd-kit/sortable",
  "@dnd-kit/utilities",
  "@tanstack/react-query",
  "@tiptap/core",
  "@tiptap/extension-image",
  "@tiptap/extension-subscript",
  "@tiptap/extension-superscript",
  "@tiptap/extension-table",
  "@tiptap/extensions",
  "@tiptap/react",
  "@tiptap/starter-kit",
  "@uiw/react-codemirror",
  "better-auth/client",
  "better-auth/client/plugins",
  "lucide-react",
  "mdast-util-from-markdown",
  "mdast-util-gfm",
  "mdast-util-mdx",
  "mdast-util-to-markdown",
  "micromark-extension-gfm",
  "micromark-extension-mdxjs",
  "react",
  "react-dom",
  "react-dom/client",
  "react-router",
  "react/jsx-runtime",
  "yaml",
] as const;
