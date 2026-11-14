import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  CircleCheck,
  CircleExclamationPoint,
  Info,
  TriangleExclamationPoint,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import { cx } from "../lib/utils.js";

// ---------------------------------------------------------------- Button
export function Button({
  variant = "default",
  size,
  icon,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "danger" | "ghost";
  size?: "sm" | "xs";
  icon?: boolean;
}) {
  return (
    <button
      type="button"
      className={cx(
        "v-btn",
        variant !== "default" && `v-btn--${variant}`,
        size && `v-btn--${size}`,
        icon && "v-btn--icon",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- Modal
export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="v-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={cx("v-modal", wide && "v-modal--wide")}
        role="dialog"
        aria-modal="true"
      >
        <div className="v-modal__header">
          <h2 className="v-modal__title">{title}</h2>
          <Button variant="ghost" icon onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </div>
        <div className="v-modal__body">{children}</div>
        {footer && <div className="v-modal__footer">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  danger,
  onConfirm,
  onCancel,
  busy,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? <Spinner /> : null}
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div style={{ margin: 0 }}>{message}</div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Toasts
interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  message: ReactNode;
}

const ToastContext = createContext<
  (kind: Toast["kind"], message: ReactNode) => void
>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], message: ReactNode) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(
      () => setToasts((t) => t.filter((x) => x.id !== id)),
      kind === "error" ? 8000 : 4000,
    );
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="v-toasts">
        {toasts.map((t) => (
          <div key={t.id} className={cx("v-toast", `v-toast--${t.kind}`)}>
            {t.kind === "success" ? (
              <CircleCheck />
            ) : t.kind === "error" ? (
              <CircleExclamationPoint />
            ) : (
              <Info />
            )}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

// ---------------------------------------------------------------- Misc
export function Spinner() {
  return <span className="v-spinner" aria-hidden="true" />;
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="v-loading">
      <Spinner /> {label}
    </div>
  );
}

export function Alert({
  kind = "info",
  children,
}: {
  kind?: "error" | "warning" | "info";
  children: ReactNode;
}) {
  return (
    <div
      className={cx("v-alert", `v-alert--${kind}`)}
      role={kind === "error" ? "alert" : undefined}
    >
      {kind === "error" ? (
        <CircleExclamationPoint />
      ) : kind === "warning" ? (
        <TriangleExclamationPoint />
      ) : (
        <Info />
      )}
      <div>{children}</div>
    </div>
  );
}

export function Badge({
  status,
  children,
}: {
  status?: "published" | "draft" | null;
  children?: ReactNode;
}) {
  if (!status)
    return <span className="v-badge v-badge--plain">{children}</span>;
  return (
    <span className={cx("v-badge", `v-badge--${status}`)}>
      {children ?? (status === "published" ? "Published" : "Draft")}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="v-empty">
      {icon}
      <h3>{title}</h3>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- Menu
export function Menu({
  trigger,
  children,
  align = "left",
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{
    top: number;
    left?: number;
    right?: number;
  } | null>(null);

  // The panel is portaled to <body> so table wrappers and scroll panes
  // (overflow: auto/clip) can't crop it; it's positioned from the trigger.
  const place = useCallback(() => {
    const anchor = ref.current;
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    setPos(
      align === "right"
        ? { top: r.bottom + 6, right: window.innerWidth - r.right }
        : { top: r.bottom + 6, left: r.left },
    );
  }, [align]);

  useEffect(() => {
    if (!open) return;
    place();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // A scroll or resize while open closes the menu rather than leaving it
    // floating away from its trigger.
    const onMove = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, place]);

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  const triggerNode = useMemo(
    () => trigger({ open, toggle }),
    [trigger, open, toggle],
  );
  return (
    <div className="v-menu" ref={ref}>
      {triggerNode}
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            className="v-menu__panel"
            style={{ top: pos.top, left: pos.left, right: pos.right }}
          >
            {children(close)}
          </div>,
          document.body,
        )}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={cx("v-toggle", checked && "is-on")}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="v-toggle__track" />
      {label && <span className="v-toggle__label">{label}</span>}
    </label>
  );
}
