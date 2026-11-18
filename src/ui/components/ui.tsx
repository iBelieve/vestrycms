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
  Check,
  CircleCheck,
  CircleExclamationPoint,
  Copy,
  Info,
  RotateCw,
  SearchX,
  TriangleExclamationPoint,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { describeError } from "../api.js";
import { cx, splitLinks } from "../lib/utils.js";

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

export function Loading({
  label = "Loading…",
  page,
}: {
  label?: string;
  /** Fill the window, for the screen shown before the control panel loads. */
  page?: boolean;
}) {
  return (
    <div className={cx("v-loading", page && "v-loading--page")}>
      <Spinner /> {label}
    </div>
  );
}

/** Plain text with any http(s) URLs in it rendered as links. */
function Linkify({ text }: { text: string }) {
  return (
    <>
      {splitLinks(text).map((part, i) =>
        part.url ? (
          <a key={i} href={part.url} target="_blank" rel="noreferrer">
            {part.text}
          </a>
        ) : (
          part.text
        ),
      )}
    </>
  );
}

/**
 * A screen-sized error: a centered card with a headline, a short
 * explanation, the error's own message and a way out (retry, or `actions`).
 * `page` fills the window for errors before the control panel has loaded;
 * otherwise it centers in the content panel.
 */
export function ErrorState({
  title,
  children,
  error,
  onRetry,
  retrying,
  actions,
  icon,
  tone = "danger",
  page,
}: {
  title: string;
  /** A plain-language explanation under the title. */
  children?: ReactNode;
  /** The underlying error, shown as details. */
  error?: unknown;
  onRetry?: () => void;
  retrying?: boolean;
  actions?: ReactNode;
  icon?: ReactNode;
  /** "neutral" for a missing page rather than a failure. */
  tone?: "danger" | "neutral";
  page?: boolean;
}) {
  const detail = error === undefined ? null : describeError(error);
  return (
    <div className={page ? "v-error-page" : "v-error-state"}>
      <div
        className={cx("v-card v-error-card", `v-error-card--${tone}`)}
        role={tone === "danger" ? "alert" : undefined}
      >
        <div className="v-error-card__icon">
          {icon ?? <TriangleExclamationPoint />}
        </div>
        {/* In the panel the card stands in for the page's TopBar and its h1. */}
        <h1 className="v-error-card__title">{title}</h1>
        {children && <div className="v-error-card__text">{children}</div>}
        {detail && <ErrorDetail detail={detail} />}
        <ErrorActions onRetry={onRetry} retrying={retrying}>
          {actions}
        </ErrorActions>
      </div>
    </div>
  );
}

/** The error's own message and metadata, with a button to copy them. */
function ErrorDetail({ detail }: { detail: ReturnType<typeof describeError> }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = async () => {
    const text = [...detail.meta, detail.message].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Clipboard access can be refused; the text is still selectable.
    }
  };
  const copyLabel = copied ? "Copied" : "Copy error details";
  return (
    <div className="v-error-card__detail">
      <div className="v-error-card__detail-head">
        <span>Details</span>
        {detail.meta.map((m) => (
          <code key={m}>{m}</code>
        ))}
        <Button
          variant="ghost"
          size="xs"
          icon
          className="v-error-card__copy"
          onClick={copy}
          aria-label={copyLabel}
          title={copyLabel}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
      <p>
        <Linkify text={detail.message} />
      </p>
    </div>
  );
}

/** The error card's way out: the caller's `actions`, then "Try again". */
function ErrorActions({
  onRetry,
  retrying,
  children,
}: {
  onRetry?: () => void;
  retrying?: boolean;
  children?: ReactNode;
}) {
  if (!onRetry && !children) return null;
  return (
    <div className="v-error-card__actions">
      {children}
      {onRetry && (
        <Button variant="primary" onClick={onRetry} disabled={retrying}>
          {retrying ? <Spinner /> : <RotateCw />}
          {retrying ? "Retrying…" : "Try again"}
        </Button>
      )}
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
      <div>
        {typeof children === "string" ? <Linkify text={children} /> : children}
      </div>
    </div>
  );
}

/** For a route naming a collection, global or container the config lacks. */
export function NotFoundState({
  title,
  children = "This site's Vestry configuration has nothing by that name. It may have been renamed or removed.",
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <ErrorState
      title={title}
      tone="neutral"
      icon={<SearchX />}
      actions={
        <Link className="v-btn" to="/">
          Back to dashboard
        </Link>
      }
    >
      {children}
    </ErrorState>
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
