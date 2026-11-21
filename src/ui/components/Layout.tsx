import {
  ChartLine,
  ChevronLeft,
  ExternalLink,
  GitBranch,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  Users,
  X,
} from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router";
import { useVestry } from "../context.js";
import { DeployStatus } from "./DeployStatus.js";
import { Icon } from "./Icon.js";
import { Menu } from "./ui.js";
import { logoSrc } from "../lib/logo.js";
import { VestryMark } from "./VestryMark.js";
import { cx, initials } from "../lib/utils.js";
import type { ClientConfig, PublicUser } from "../api.js";
import type { NavigationGroup, VestryConfig } from "../../config/types.js";

export interface Crumb {
  label: string;
  to?: string;
}

/** Lets pages publish their breadcrumb trail into the dark top bar. */
const CrumbsContext = createContext<(crumbs: Crumb[]) => void>(() => {});

export function Shell({ children }: { children: ReactNode }) {
  const { client, config, name, api } = useVestry();
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const nav = useNavDrawer();
  return (
    <div className="v-app">
      <header className="v-chrome">
        <button
          type="button"
          ref={nav.buttonRef}
          className="v-chrome__menu"
          aria-label={nav.open ? "Close menu" : "Open menu"}
          aria-expanded={nav.open}
          aria-controls="v-sidebar"
          onClick={nav.toggle}
        >
          {nav.open ? <X /> : <MenuIcon />}
        </button>
        <Brand logo={logoSrc(config.logo, api)} name={name} />
        {crumbs.map((c, i) => (
          <span key={i} className="v-chrome__crumb">
            <span className="v-chrome__sep">/</span>
            {c.to ? <Link to={c.to}>{c.label}</Link> : <span>{c.label}</span>}
          </span>
        ))}
        <div className="v-chrome__spacer" />
        {client.user && <DeployStatus />}
        <SourceChip client={client} />
        {config.siteUrl && (
          <a
            className="v-chrome__chip"
            href={config.siteUrl}
            target="_blank"
            rel="noreferrer"
            title="Open the site"
          >
            <ExternalLink />
            <span>View site</span>
          </a>
        )}
        {client.user && <AccountMenu user={client.user} />}
      </header>
      <div className="v-shell">
        <Sidebar
          config={config}
          showUsers={client.auth && client.user?.role === "admin"}
          open={nav.open}
          sidebarRef={nav.sidebarRef}
        />
        {nav.open && <div className="v-sidebar-backdrop" onClick={nav.close} />}
        <div className="v-main" inert={nav.open}>
          <CrumbsContext.Provider value={setCrumbs}>
            {children}
          </CrumbsContext.Provider>
        </div>
      </div>
    </div>
  );
}

/** The width below which the sidebar is a drawer, as in styles.css. */
const DRAWER_MEDIA = "(max-width: 860px)";

/**
 * The sidebar as a drawer on narrow screens, where the top bar's menu button
 * opens it over the page (on wider screens the CSS ignores `open`). Any
 * change of page (one of its links, the logo, the browser's back button),
 * tapping outside, Escape or widening the window past the breakpoint closes
 * it; the page beneath doesn't scroll and can't be tabbed into while it's
 * open.
 */
function useNavDrawer() {
  // The Shell stays mounted from page to page, so the drawer remembers the
  // page it was opened on and is shut on any other. Forgetting it there
  // keeps the back button from reopening it on the way back.
  const { key } = useLocation();
  const [openOn, setOpenOn] = useState<string | null>(null);
  if (openOn !== null && openOn !== key) setOpenOn(null);
  const open = openOn === key;
  const setOpen = (next: boolean) => setOpenOn(next ? key : null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    root.classList.add("v-nav-open");
    focusCurrentLink(sidebarRef.current);
    const onKey = (e: KeyboardEvent) => {
      // An open menu in the top bar (above the drawer) takes Escape first.
      if (e.key !== "Escape" || document.querySelector(".v-menu__panel"))
        return;
      setOpenOn(null);
      buttonRef.current?.focus();
    };
    // A tablet turned to landscape shows the sidebar beside the page again;
    // left open, the drawer would come back when it's turned back.
    const narrow = window.matchMedia?.(DRAWER_MEDIA);
    const onWiden = () => {
      if (!narrow?.matches) setOpenOn(null);
    };
    document.addEventListener("keydown", onKey);
    narrow?.addEventListener("change", onWiden);
    return () => {
      root.classList.remove("v-nav-open");
      document.removeEventListener("keydown", onKey);
      narrow?.removeEventListener("change", onWiden);
    };
  }, [open]);
  return {
    open,
    buttonRef,
    sidebarRef,
    toggle: () => setOpen(!open),
    close: () => setOpen(false),
  };
}

/**
 * Starts keyboard users on the current page's link, scrolled into view in a
 * drawer longer than the screen.
 */
function focusCurrentLink(sidebar: HTMLElement | null) {
  const link =
    sidebar?.querySelector<HTMLElement>("a.is-active") ??
    sidebar?.querySelector<HTMLElement>("a");
  link?.focus({ preventScroll: true });
  // jsdom has no scrollIntoView.
  link?.scrollIntoView?.({ block: "nearest" });
}

/** The top bar's home link: the site's logo, or Vestry's mark and the name. */
function Brand({ logo, name }: { logo: string | null; name: string }) {
  return (
    <Link to="/" className="v-chrome__brand" title={name}>
      {logo ? (
        <img className="v-chrome__logo" src={logo} alt={name} />
      ) : (
        <>
          <VestryMark className="v-chrome__mark" />
          <span className="v-chrome__name">{name}</span>
        </>
      )}
    </Link>
  );
}

/** Where content is saved: a link to the branch, or the local working copy. */
function SourceChip({ client }: { client: ClientConfig }) {
  const { source } = client;
  if (source.url) {
    return (
      <a
        className="v-chrome__chip"
        href={source.url}
        target="_blank"
        rel="noreferrer"
        title={source.label}
      >
        <GitBranch />
        <span>{source.branch ?? source.label}</span>
      </a>
    );
  }
  return (
    <span className="v-chrome__chip" title={source.label}>
      <GitBranch />
      <span>{client.mode === "local" ? "Local files" : source.label}</span>
    </span>
  );
}

/** The signed-in user's avatar, opening their name, the source and sign-out. */
function AccountMenu({ user }: { user: PublicUser }) {
  const { client, authClient, refresh } = useVestry();
  const navigate = useNavigate();
  return (
    <Menu
      align="right"
      trigger={({ toggle }) => (
        <button
          type="button"
          className="v-chrome__avatar"
          onClick={toggle}
          title={user.name}
        >
          {initials(user.name || user.email || "?")}
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="v-menu__heading">
            {user.name}
            {user.email && <span className="v-menu__sub">{user.email}</span>}
          </div>
          <div className="v-menu__item v-menu__item--static">
            <GitBranch />
            <span>
              {client.mode === "local"
                ? "Editing local files"
                : client.source.label}
            </span>
          </div>
          {client.auth && (
            <button
              className="v-menu__item"
              onClick={async () => {
                close();
                await authClient.signOut();
                await refresh();
                await navigate("/login");
              }}
            >
              <LogOut />
              <span>Sign out</span>
            </button>
          )}
        </>
      )}
    </Menu>
  );
}

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cx("v-nav__link", isActive && "is-active");

function Sidebar({
  config,
  showUsers,
  open,
  sidebarRef,
}: {
  config: VestryConfig;
  showUsers: boolean;
  /** The drawer is open (narrow screens only). */
  open: boolean;
  sidebarRef: RefObject<HTMLElement | null>;
}) {
  return (
    <aside
      id="v-sidebar"
      ref={sidebarRef}
      className={cx("v-sidebar", open && "is-open")}
    >
      <nav className="v-nav">
        <div className="v-nav__group">
          <NavLink to="/" end className={navLinkClass}>
            <LayoutDashboard /> Dashboard
          </NavLink>
          {config.analytics && (
            <NavLink to="/analytics" className={navLinkClass}>
              <ChartLine /> Analytics
            </NavLink>
          )}
        </div>
        {navGroups(config).map((g) => (
          <div key={g.label} className="v-nav__group">
            <h3 className="v-nav__heading">{g.label}</h3>
            {g.items.map((ref) => {
              const item = navItem(config, ref);
              if (!item) return null;
              return (
                <NavLink key={ref} to={item.to} className={navLinkClass}>
                  <Icon name={item.icon} /> {item.label}
                </NavLink>
              );
            })}
          </div>
        ))}
        {showUsers && (
          <div className="v-nav__group">
            <h3 className="v-nav__heading">System</h3>
            <NavLink to="/users" className={navLinkClass}>
              <Users /> Users
            </NavLink>
          </div>
        )}
      </nav>
    </aside>
  );
}

type NavKind = "collections" | "singletons" | "assets";

/** The sidebar's sections, in order, with each one's default label and icon. */
const NAV_KINDS: { kind: NavKind; label: string; icon: string }[] = [
  { kind: "collections", label: "Collections", icon: "files" },
  { kind: "singletons", label: "Globals", icon: "settings-2" },
  { kind: "assets", label: "Assets", icon: "image" },
];

/**
 * `config.navigation`, or by default one group per kind of content that the
 * config has, listing all of it.
 */
function navGroups(config: VestryConfig): NavigationGroup[] {
  if (config.navigation) return config.navigation;
  return NAV_KINDS.map(({ kind, label }) => ({
    label,
    items: Object.keys(config[kind] ?? {}).map((k) => `${kind}.${k}`),
  })).filter((g) => g.items.length > 0);
}

/** The link for a `kind.key` navigation item, or null when it names nothing. */
function navItem(
  config: VestryConfig,
  ref: string,
): { to: string; label: string; icon: string } | null {
  const [kind, key] = ref.split(".");
  const meta = NAV_KINDS.find((k) => k.kind === kind);
  const target = meta && config[meta.kind]?.[key];
  if (!meta || !target) return null;
  return {
    to: `/${meta.kind}/${key}`,
    label: target.label,
    icon: target.icon ?? meta.icon,
  };
}

export function TopBar({
  title,
  crumbs,
  actions,
  status,
}: {
  title: ReactNode;
  crumbs?: Crumb[];
  actions?: ReactNode;
  /** Shows a status dot before the title. */
  status?: "published" | "draft" | null;
}) {
  const setCrumbs = useContext(CrumbsContext);
  const key = JSON.stringify(crumbs ?? []);
  // Phones hide the breadcrumbs in the dark bar; the nearest linked one
  // becomes a back link above the title instead.
  const back = crumbs?.findLast((c) => c.to);
  useEffect(() => {
    setCrumbs(crumbs ?? []);
    return () => setCrumbs([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, setCrumbs]);
  return (
    <header className="v-topbar">
      {back?.to && (
        <Link to={back.to} className="v-topbar__back">
          <ChevronLeft />
          {back.label}
        </Link>
      )}
      <h1 className="v-topbar__title">
        {status && (
          <span
            className={`v-status-dot v-status-dot--${status}`}
            title={status === "published" ? "Published" : "Draft"}
          />
        )}
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </span>
      </h1>
      {actions && <div className="v-topbar__actions">{actions}</div>}
    </header>
  );
}
