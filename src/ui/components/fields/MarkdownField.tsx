import { useMemo } from "react";
import { useVestry } from "../../context.js";
import { RichTextEditor } from "../editor/RichTextEditor.js";
import { useEditorEnv, type EditorEnv } from "../editor/EditorContext.js";

/** A Markdown-valued frontmatter field (e.g. a hero tagline) edited with the rich text editor. */
export function MarkdownField({
  value,
  onChange,
  components,
  placeholder,
  readOnly,
  filePath,
}: {
  value: string;
  onChange: (v: string) => void;
  components?: string[];
  placeholder?: string;
  readOnly?: boolean;
  /** The entry's file; inside a component's settings, the body's. */
  filePath?: string;
}) {
  const { config, api } = useVestry();
  const parent = useEditorEnv();
  const file = filePath ?? parent.filePath;
  const env = useMemo<EditorEnv>(
    () => ({
      components: Object.fromEntries(
        (components ?? [])
          .map((n) => [n, config.components?.[n]])
          .filter(([, c]) => c) as [
          string,
          NonNullable<typeof config.components>[string],
        ][],
      ),
      textStyles: config.textStyles,
      toRepoPath: () => null,
      toDocPath: (p) => p,
      filePath: file,
      assetUrl: api.fileUrl,
    }),
    [components, config.components, config.textStyles, file, api.fileUrl],
  );
  return (
    <RichTextEditor
      value={value}
      onChange={onChange}
      components={components ?? []}
      env={env}
      placeholder={placeholder}
      readOnly={readOnly}
      compact
    />
  );
}
