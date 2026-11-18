import {
  ExternalLink,
  GitBranch,
  LayoutDashboard,
  LogOut,
  Users,
} from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Link, NavLink, useNavigate } from "react-router";
import { useVestry } from "../context.js";
import { Icon } from "./Icon.js";
import { Menu } from "./ui.js";
import { logoSrc } from "../lib/logo.js";
import { initials } from "../lib/utils.js";

export interface Crumb {
  label: string;
  to?: string;
}

/** Lets pages publish their breadcrumb trail into the dark top bar. */
const CrumbsContext = createContext<(crumbs: Crumb[]) => void>(() => {});

export function Shell({ children }: { children: ReactNode }) {
  const { client, config, name, api, authClient, refresh } = useVestry();
  const logo = logoSrc(config.logo, api);
  const navigate = useNavigate();
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const collections = Object.entries(config.collections ?? {});
  const singletons = Object.entries(config.singletons ?? {});
  const assets = Object.entries(config.assets ?? {});

  const groups =
    config.navigation ??
    ([
      collections.length && {
        label: "Collections",
        items: collections.map(([k]) => `collections.${k}`),
      },
      singletons.length && {
        label: "Globals",
        items: singletons.map(([k]) => `singletons.${k}`),
      },
      assets.length && {
        label: "Assets",
        items: assets.map(([k]) => `assets.${k}`),
      },
    ].filter(Boolean) as { label: string; items: string[] }[]);

  const itemFor = (ref: string) => {
    const [kind, key] = ref.split(".") as [
      "collections" | "singletons" | "assets",
      string,
    ];
    if (kind === "collections" && config.collections?.[key]) {
      return {
        to: `/collections/${key}`,
        label: config.collections[key].label,
        icon: config.collections[key].icon ?? "files",
      };
    }
    if (kind === "singletons" && config.singletons?.[key]) {
      return {
        to: `/singletons/${key}`,
        label: config.singletons[key].label,
        icon: config.singletons[key].icon ?? "settings-2",
      };
    }
    if (kind === "assets" && config.assets?.[key]) {
      return {
        to: `/assets/${key}`,
        label: config.assets[key].label,
        icon: config.assets[key].icon ?? "image",
      };
    }
    return null;
  };

  return (
    <div className="v-app">
      <header className="v-chrome">
        <Link to="/" className="v-chrome__brand" title={name}>
          {logo ? (
            <img className="v-chrome__logo" src={logo} alt={name} />
          ) : (
            <>
              <span className="v-chrome__mark">V</span>
              <span className="v-chrome__name">{name}</span>
            </>
          )}
        </Link>
        {crumbs.map((c, i) => (
          <span key={i} className="v-chrome__crumb">
            <span className="v-chrome__sep">/</span>
            {c.to ? <Link to={c.to}>{c.label}</Link> : <span>{c.label}</span>}
          </span>
        ))}
        <div className="v-chrome__spacer" />
        {client.source.url ? (
          <a
            className="v-chrome__chip"
            href={client.source.url}
            target="_blank"
            rel="noreferrer"
            title={client.source.label}
          >
            <GitBranch />
            <span>{client.source.branch ?? client.source.label}</span>
          </a>
        ) : (
          <span className="v-chrome__chip" title={client.source.label}>
            <GitBranch />
            <span>
              {client.mode === "local" ? "Local files" : client.source.label}
            </span>
          </span>
        )}
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
        {client.user && (
          <Menu
            align="right"
            trigger={({ toggle }) => (
              <button
                type="button"
                className="v-chrome__avatar"
                onClick={toggle}
                title={client.user!.name}
              >
                {initials(client.user!.name || client.user!.email || "?")}
              </button>
            )}
          >
            {(close) => (
              <>
                <div className="v-menu__heading">
                  {client.user!.name}
                  {client.user!.email && (
                    <span className="v-menu__sub">{client.user!.email}</span>
                  )}
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
        )}
      </header>
      <div className="v-shell">
        <aside className="v-sidebar">
          <nav className="v-nav">
            <div className="v-nav__group">
              <NavLink
                to="/"
                end
                className={({ isActive }) =>
                  `v-nav__link${isActive ? " is-active" : ""}`
                }
              >
                <LayoutDashboard /> Dashboard
              </NavLink>
            </div>
            {groups.map((g) => (
              <div key={g.label} className="v-nav__group">
                <h3 className="v-nav__heading">{g.label}</h3>
                {g.items.map((ref) => {
                  const item = itemFor(ref);
                  if (!item) return null;
                  return (
                    <NavLink
                      key={ref}
                      to={item.to}
                      className={({ isActive }) =>
                        `v-nav__link${isActive ? " is-active" : ""}`
                      }
                    >
                      <Icon name={item.icon} /> {item.label}
                    </NavLink>
                  );
                })}
              </div>
            ))}
            {client.auth && client.user?.role === "admin" && (
              <div className="v-nav__group">
                <h3 className="v-nav__heading">System</h3>
                <NavLink
                  to="/users"
                  className={({ isActive }) =>
                    `v-nav__link${isActive ? " is-active" : ""}`
                  }
                >
                  <Users /> Users
                </NavLink>
              </div>
            )}
          </nav>
        </aside>
        <div className="v-main">
          <CrumbsContext.Provider value={setCrumbs}>
            {children}
          </CrumbsContext.Provider>
        </div>
      </div>
    </div>
  );
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
  useEffect(() => {
    setCrumbs(crumbs ?? []);
    return () => setCrumbs([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, setCrumbs]);
  return (
    <header className="v-topbar">
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
