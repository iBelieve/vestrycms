import { Suspense, lazy } from "react";

const CodeMirrorInput = lazy(() => import("./CodeMirrorInput.js"));

export interface CodeInputProps {
  value: string;
  onChange: (v: string) => void;
  language?: "markdown" | "yaml" | "json" | "javascript" | "text";
  rows?: number;
  readOnly?: boolean;
  minHeight?: string;
}

/** Code editor (CodeMirror, loaded on demand) with a textarea fallback while it loads. */
export function CodeInput(props: CodeInputProps) {
  const fallback = (
    <textarea
      className="v-textarea v-input--mono"
      rows={props.rows ?? 6}
      value={props.value}
      readOnly={props.readOnly}
      onChange={(e) => props.onChange(e.target.value)}
      spellCheck={false}
    />
  );
  return (
    <Suspense fallback={fallback}>
      <CodeMirrorInput {...props} />
    </Suspense>
  );
}
