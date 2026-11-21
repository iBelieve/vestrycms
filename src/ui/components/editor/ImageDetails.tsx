import { isNodeSelection, type Editor } from "@tiptap/react";
import { useId, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Button, Modal } from "../ui.js";
import { useEditorEnv } from "./EditorContext.js";

/** The image whose details are being edited, by its position in the document. */
export interface ImageTarget {
  pos: number;
  /** Just inserted: the dialog asks for its description. */
  inserted?: boolean;
}

/** The position of the image the selection holds, or null. */
export function selectedImage(editor: Editor): number | null {
  const { selection } = editor.state;
  return isNodeSelection(selection) && selection.node.type.name === "image"
    ? selection.from
    : null;
}

/**
 * Inserts the image at `src` in place of the selection and selects it.
 * Returns its position, or null when it could not be inserted.
 */
export function insertImage(editor: Editor, src: string): number | null {
  let pos: number | null = null;
  editor
    .chain()
    .focus()
    .setImage({ src, alt: "" })
    .command(({ tr }) => {
      // The cursor lands just after the inserted image.
      const { $from } = tr.selection;
      if ($from.nodeBefore?.type.name !== "image") return true;
      pos = $from.pos - $from.nodeBefore.nodeSize;
      return true;
    })
    .run();
  if (pos !== null) editor.commands.setNodeSelection(pos);
  return pos;
}

/** The position of the image node drawn as `img`, or null for any other `<img>`. */
function imageAt(editor: Editor, img: Element): number | null {
  try {
    const pos = editor.view.posAtDOM(img, 0);
    return editor.state.doc.nodeAt(pos)?.type.name === "image" ? pos : null;
  } catch {
    return null;
  }
}

/**
 * Which image's details dialog is open, and a double-click handler for the
 * editor that opens it on the image clicked.
 */
export function useImageDetails(editor: Editor | null, enabled: boolean) {
  const [target, setTarget] = useState<ImageTarget | null>(null);
  const onDoubleClick = (e: MouseEvent) => {
    if (!editor || !enabled || !editor.isEditable) return;
    const img = (e.target as Element).closest?.("img");
    const pos = img ? imageAt(editor, img) : null;
    if (pos === null) return;
    e.preventDefault();
    editor.commands.setNodeSelection(pos);
    setTarget({ pos });
  };
  return {
    target,
    open: setTarget,
    close: () => setTarget(null),
    onDoubleClick,
  };
}

/** Collapses runs of whitespace (alt text is one line); empty → null. */
const clean = (text: string) => text.replace(/\s+/g, " ").trim() || null;

/** Edits the alt text and title of the image at `target.pos`. */
export function ImageDetailsDialog({
  editor,
  target,
  onClose,
}: {
  editor: Editor;
  target: ImageTarget;
  onClose: () => void;
}) {
  const env = useEditorEnv();
  const id = useId();
  const [node] = useState(() => editor.state.doc.nodeAt(target.pos));
  const [alt, setAlt] = useState(String(node?.attrs.alt ?? ""));
  const [title, setTitle] = useState(String(node?.attrs.title ?? ""));
  if (node?.type.name !== "image") return null;
  const src = String(node.attrs.src ?? "");

  const apply = () => {
    const pos = target.pos;
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        // The document may have changed under the dialog: only an image
        // still at that position is updated.
        const current = tr.doc.nodeAt(pos);
        if (current?.type.name !== "image") return false;
        tr.setNodeMarkup(pos, undefined, {
          ...current.attrs,
          alt: clean(alt),
          title: clean(title),
        });
        return true;
      })
      .setNodeSelection(pos)
      .run();
    onClose();
  };
  const onEnter = (e: KeyboardEvent) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    apply();
  };

  return (
    <Modal
      title={target.inserted ? "Describe the image" : "Image details"}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>
            {target.inserted ? "Skip" : "Cancel"}
          </Button>
          <Button variant="primary" onClick={apply}>
            {target.inserted ? "Done" : "Apply"}
          </Button>
        </>
      }
    >
      <div className="v-image-details">
        <img
          className="v-image-details__preview"
          src={env.resolveImage?.(src) ?? src}
          alt=""
        />
        <div className="v-fields">
          <div className="v-field">
            <label className="v-field__label" htmlFor={`${id}-alt`}>
              Alt text
            </label>
            <textarea
              id={`${id}-alt`}
              className="v-textarea"
              rows={3}
              autoFocus
              value={alt}
              placeholder="A short description of what the image shows"
              aria-describedby={`${id}-alt-hint`}
              onChange={(e) => setAlt(e.target.value)}
              onKeyDown={onEnter}
            />
            <div id={`${id}-alt-hint`} className="v-field__hint">
              Read aloud by screen readers, and shown if the image can't load.
              Leave it empty only for a purely decorative image.
            </div>
          </div>
          <div className="v-field">
            <label className="v-field__label" htmlFor={`${id}-title`}>
              Title
            </label>
            <input
              id={`${id}-title`}
              className="v-input"
              value={title}
              aria-describedby={`${id}-title-hint`}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={onEnter}
            />
            <div id={`${id}-title-hint`} className="v-field__hint">
              Optional. Browsers show it as a tooltip when the pointer rests on
              the image.
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
