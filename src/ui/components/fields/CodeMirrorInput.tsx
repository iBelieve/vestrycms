import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { EditorView } from "@codemirror/view";
import { useMemo } from "react";
import type { CodeInputProps } from "./CodeInput.js";

const theme = EditorView.theme({
  "&": {
    fontSize: "13px",
    border: "1px solid var(--v-border-strong)",
    borderRadius: "6px",
    background: "#fff",
  },
  "&.cm-focused": {
    outline: "none",
    borderColor: "var(--v-primary)",
    boxShadow: "0 0 0 3px var(--v-primary-ring)",
  },
  ".cm-scroller": { fontFamily: "var(--v-mono)", lineHeight: "1.55" },
  ".cm-gutters": {
    background: "#f9fafb",
    borderRight: "1px solid var(--v-border)",
    color: "#9ca3af",
  },
  ".cm-activeLineGutter": { background: "#f3f4f6" },
  ".cm-activeLine": { background: "rgba(37, 99, 235, 0.04)" },
  ".cm-content": { padding: "8px 0" },
});

export default function CodeMirrorInput({
  value,
  onChange,
  language = "text",
  rows,
  readOnly,
  minHeight,
}: CodeInputProps) {
  const extensions = useMemo(() => {
    const ext = [theme, EditorView.lineWrapping];
    if (language === "markdown") ext.push(markdown());
    if (language === "yaml") ext.push(yaml());
    return ext;
  }, [language]);
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={extensions}
      readOnly={readOnly}
      editable={!readOnly}
      minHeight={minHeight ?? (rows ? `${rows * 1.55 * 13 + 16}px` : "120px")}
      basicSetup={{
        lineNumbers: language !== "text",
        foldGutter: false,
        highlightActiveLine: true,
        autocompletion: false,
      }}
    />
  );
}
