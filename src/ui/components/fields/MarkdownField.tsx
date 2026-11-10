import { useMemo } from "react";
import { useVestry } from "../../context.js";
import { RichTextEditor } from "../editor/RichTextEditor.js";
import type { EditorEnv } from "../editor/EditorContext.js";

/** A Markdown-valued frontmatter field (e.g. a hero tagline) edited with the rich text editor. */
export function MarkdownField({
  value,
  onChange,
  components,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  components?: string[];
  placeholder?: string;
}) {
  const { config } = useVestry();
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
      toRepoPath: () => null,
      toDocPath: (p) => p,
    }),
    [components, config.components],
  );
  return (
    <RichTextEditor
      value={value}
      onChange={onChange}
      components={components ?? []}
      env={env}
      placeholder={placeholder}
      compact
    />
  );
}
