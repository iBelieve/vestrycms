/**
 * Checks a Vestry config when the integration loads, so a mistake is an
 * error at startup rather than something the control panel quietly ignores.
 */
import {
  isSafeRepoPath,
  isSafeSlug,
  parsePathPattern,
  templateError,
} from "../core/paths.js";
import { ICON_NAMES, isIconName } from "./icons.js";
import { isLogoUrl } from "./logo.js";
import type {
  CollectionConfig,
  ComponentConfig,
  Field,
  GoogleAnalyticsConfig,
  LogoConfig,
  PlausibleAnalyticsConfig,
  Schema,
  VestryConfig,
} from "./types.js";

const fail = (message: string): never => {
  throw new Error(`[vestry] ${message}`);
};

/** Every field in a schema below the top level, with a readable path. */
function nestedFields(schema: Schema, prefix = ""): [string, Field][] {
  return Object.entries(schema).flatMap(([key, field]) => {
    const path = `${prefix}${key}`;
    const inner =
      field.type === "object" || field.type === "tree"
        ? field.fields
        : field.type === "array"
          ? { "[]": field.of }
          : null;
    if (!inner) return [];
    return [
      ...Object.entries(inner).map(([k, f]): [string, Field] => [
        `${path}.${k}`,
        f,
      ]),
      ...nestedFields(inner, `${path}.`),
    ];
  });
}

const isFilenameDate = (field: Field) =>
  field.type === "date" && field.storeIn === "filename";

/** `storeIn: "filename"` only works on one top-level date of a file-per-entry collection. */
function checkFilenameDates(
  what: string,
  schema: Schema,
  filePerEntry: boolean,
) {
  const nested = nestedFields(schema).find(([, field]) =>
    isFilenameDate(field),
  );
  if (nested) {
    fail(
      `${what}: "${nested[0]}" uses storeIn: "filename", which is only for a top-level field`,
    );
  }
  const keys = Object.keys(schema).filter((key) => isFilenameDate(schema[key]));
  if (!keys.length) return;
  if (!filePerEntry) {
    fail(
      `${what}: "${keys[0]}" uses storeIn: "filename", which needs a collection with one file per entry (a "*" in its path)`,
    );
  }
  if (keys.length > 1) {
    fail(
      `${what}: only one field can use storeIn: "filename" (found ${keys.join(", ")})`,
    );
  }
  const field = schema[keys[0]];
  if (field.type === "date" && field.time) {
    fail(
      `${what}: "${keys[0]}" uses storeIn: "filename", which cannot be combined with time`,
    );
  }
}

/**
 * A date's only default is "now". The control panel ignores any other value,
 * which a config the type check never sees (a `.js` one) can still set.
 */
function checkDateDefaults(what: string, schema: Schema) {
  for (const [key, field] of [
    ...Object.entries(schema),
    ...nestedFields(schema),
  ]) {
    if (field.type !== "date" && field.type !== "datetime") continue;
    const value: unknown = field.default;
    if (value !== undefined && value !== "now") {
      fail(
        `${what}: "${key}" has default ${JSON.stringify(value)}, but a ${field.type} field's default can only be "now"`,
      );
    }
  }
}

/**
 * `entries` names the entries a top-level field shows in, by slug; a
 * nested field shows wherever its parent does.
 */
function checkEntryFields(what: string, col: CollectionConfig) {
  for (const [key, field] of Object.entries(col.schema)) {
    if (field.entries === undefined) continue;
    checkSlugList(what, `"${key}" entries`, field.entries);
    if (!field.entries.length)
      fail(
        `${what}: "${key}" has entries: [], which shows it nowhere; name an entry or use hidden: true`,
      );
    const why = entriesIgnored(col, key, field);
    if (why) fail(`${what}: "${key}" sets entries, but ${why}`);
  }
  checkNoEntryFields(
    what,
    nestedFields(col.schema),
    "it is only for a top-level field",
  );
}

/**
 * Why a field is shown or written in every entry, whatever its `entries`
 * says, if it is: it has a control of its own, or saving sets it.
 */
function entriesIgnored(
  col: CollectionConfig,
  key: string,
  field: Field,
): string | null {
  if (key === (col.titleField ?? "title") && field.type === "text")
    return "the title shows in every entry";
  if (key === col.status?.field)
    return "the publish switch shows in every entry";
  if (isFilenameDate(field)) return "every entry's file name holds its date";
  if (field.type === "datetime" && field.autoUpdate)
    return "saving any entry sets it";
  return null;
}

/** Fields where `entries` has nothing to choose between. */
function checkNoEntryFields(
  what: string,
  fields: [string, Field][],
  why: string,
) {
  const found = fields.find(([, field]) => field.entries !== undefined);
  if (found) fail(`${what}: "${found[0]}" sets entries, but ${why}`);
}

/** A `{field|filter}` placeholder must name a filter that exists. */
function checkTemplate(what: string, template: string | undefined) {
  const error = template ? templateError(template) : undefined;
  if (error) fail(`${what}: ${error}`);
}

export function validateConfig(config: VestryConfig) {
  if (!config.repo?.owner || !config.repo?.name) {
    fail("config.repo.owner and config.repo.name are required");
  }
  checkTemplate("commitMessage", config.commitMessage);
  checkLogo(config.logo);
  checkSignIn(config.signIn);
  checkDeploys(config.deploys);
  checkAnalytics(config.analytics);

  for (const [key, col] of Object.entries(config.collections ?? {}))
    checkCollection(config, `collection "${key}"`, col);

  for (const [key, container] of Object.entries(config.assets ?? {}))
    checkIcon(`asset container "${key}" icon`, container.icon);

  for (const [key, singleton] of Object.entries(config.singletons ?? {})) {
    const what = `singleton "${key}"`;
    checkIcon(`${what} icon`, singleton.icon);
    checkFilenameDates(what, singleton.schema, false);
    checkDateDefaults(what, singleton.schema);
    checkNoEntryFields(
      what,
      [...Object.entries(singleton.schema), ...nestedFields(singleton.schema)],
      "a singleton has one entry",
    );
    checkTemplate(`${what} previewUrl`, singleton.previewUrl);
    checkTemplate(`${what} commitMessage`, singleton.commitMessage);
  }

  for (const [name, component] of Object.entries(config.components ?? {}))
    checkComponent(name, component);

  checkForms(config.forms);

  try {
    JSON.stringify(config);
  } catch {
    fail("config must be JSON-serializable (no functions)");
  }
}

/** Each form has a URL-safe name, a label, and known icon and columns. */
function checkForms(forms: VestryConfig["forms"]) {
  if (forms === undefined) return;
  if (typeof forms !== "object" || forms === null || Array.isArray(forms))
    fail("forms must be an object of forms by name");
  for (const [name, form] of Object.entries(forms)) {
    const what = `form "${name}"`;
    if (!/^[a-z][a-z0-9_-]*$/.test(name))
      fail(
        `${what}: a form's name must be lowercase letters, digits, "-" and "_", starting with a letter`,
      );
    if (typeof form?.label !== "string" || !form.label.trim())
      fail(`${what} needs a label`);
    checkIcon(`${what} icon`, form.icon);
    if (
      form.columns !== undefined &&
      !(
        Array.isArray(form.columns) &&
        form.columns.every((c) => typeof c === "string" && c)
      )
    )
      fail(`${what} columns must be a list of field names`);
  }
}

/**
 * An absolute URL, or a path the API and the build can find: inside the
 * repository, without surrounding spaces, and not a protocol-relative URL
 * (`//cdn…`), which would read as a repository path.
 */
const isLogoPath = (value: unknown) =>
  typeof value === "string" &&
  value === value.trim() &&
  (isLogoUrl(value) || (!value.startsWith("//") && isSafeRepoPath(value)));

/** A path or URL, or `{ onDark, onLight }` with at least one of them. */
function checkLogo(logo: VestryConfig["logo"]) {
  // An empty string (or null, in a config the type check never sees) has
  // always meant no logo.
  if (logo === undefined || logo === null || logo === "") return;
  if (typeof logo === "string") {
    if (!isLogoPath(logo)) fail("logo must be a repository path or a URL");
    return;
  }
  if (typeof logo !== "object")
    fail("logo must be a path or URL, or { onDark, onLight }");
  checkLogoVariants(logo);
}

function checkLogoVariants(logo: LogoConfig) {
  const unknown = Object.keys(logo).find(
    (key) => key !== "onDark" && key !== "onLight",
  );
  if (unknown)
    fail(`logo has an unknown key "${unknown}"; use onDark and onLight`);
  for (const key of ["onDark", "onLight"] as const) {
    if (logo[key] !== undefined && !isLogoPath(logo[key]))
      fail(`logo.${key} must be a repository path or a URL`);
  }
  if (logo.onDark === undefined && logo.onLight === undefined)
    fail("logo needs onDark, onLight or both");
}

function checkSignIn(signIn: VestryConfig["signIn"]) {
  if (signIn === undefined) return;
  if (typeof signIn !== "object" || signIn === null || Array.isArray(signIn))
    fail("signIn must be an object");
  const unknown = Object.keys(signIn).find((key) => key !== "showName");
  if (unknown) fail(`signIn has an unknown key "${unknown}"; use showName`);
  if (signIn.showName !== undefined && typeof signIn.showName !== "boolean")
    fail("signIn.showName must be true or false");
}

function checkDeploys(deploys: VestryConfig["deploys"]) {
  if (deploys === undefined || deploys === false) return;
  if (typeof deploys !== "object" || deploys === null)
    fail("deploys must be false or an object");
  if (
    deploys.check !== undefined &&
    (typeof deploys.check !== "string" || !deploys.check.trim())
  )
    fail("deploys.check must be a check run name (or the start of one)");
}

function checkAnalytics(analytics: VestryConfig["analytics"]) {
  if (analytics === undefined) return;
  if (typeof analytics !== "object" || analytics === null)
    fail("analytics must be an object");
  if (analytics.provider === "plausible") return checkPlausible(analytics);
  if (analytics.provider === "google-analytics")
    return checkGoogleAnalytics(analytics);
  fail(
    `analytics.provider must be "plausible" or "google-analytics" (got ${JSON.stringify((analytics as { provider?: unknown }).provider)})`,
  );
}

function checkPlausible(analytics: PlausibleAnalyticsConfig) {
  if (typeof analytics.siteId !== "string" || !analytics.siteId.trim())
    fail("analytics.siteId must be the site's domain in Plausible");
  if (analytics.host !== undefined && !isServerUrl(analytics.host))
    fail(
      `analytics.host must be the Plausible server's URL, e.g. https://plausible.io, with no query or #fragment; plain http only for localhost (got ${JSON.stringify(analytics.host)})`,
    );
}

function checkGoogleAnalytics(analytics: GoogleAnalyticsConfig) {
  if (
    typeof analytics.propertyId !== "string" ||
    !/^(properties\/)?\d+$/.test(analytics.propertyId.trim())
  )
    fail(
      `analytics.propertyId must be the Google Analytics 4 property ID, a number such as "123456789" (not the G-… measurement ID; got ${JSON.stringify(analytics.propertyId)})`,
    );
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * An https URL that paths can be added to. Plain http would send the API
 * key in the clear, so it is only for a server on this machine.
 */
function isServerUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    if (url.search || url.hash || url.username || url.password) return false;
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" && LOOPBACK.has(url.hostname))
    );
  } catch {
    return false;
  }
}

function checkCollection(
  config: VestryConfig,
  what: string,
  col: CollectionConfig,
) {
  if (!col.path) fail(`${what} needs a path`);
  checkIcon(`${what} icon`, col.icon);
  for (const name of col.body ? (col.body.components ?? []) : []) {
    if (!config.components?.[name]) {
      fail(`${what} references unknown component "${name}"`);
    }
  }
  checkFilenameDates(what, col.schema, !parsePathPattern(col.path).single);
  checkDateDefaults(what, col.schema);
  checkEntryFields(what, col);
  checkTemplate(`${what} previewUrl`, col.previewUrl);
  checkTemplate(`${what} slug.template`, col.slug?.template);
  // A `*` path lists only the files directly in its directory, so entries
  // created in subfolders would never show up again.
  if (col.slug?.template?.includes("/") && !parsePathPattern(col.path).deep) {
    fail(
      `${what} slug.template contains "/", which needs a "**" wildcard in its path`,
    );
  }
  // The tree nests entries by the folders in their slugs: a `*` path has
  // none, and a single file's ids need not be unique paths at all.
  if (col.tree && !parsePathPattern(col.path).deep) {
    fail(`${what} sets tree, which needs a "**" wildcard in its path`);
  }
  checkTemplate(`${what} commitMessage`, col.commitMessage);
  checkEditing(what, col);
  checkRecent(what, col);
}

/**
 * `recent` is a flag or a count, and a collection off the dashboard
 * (`dashboard: false`) has no "Recent …" list for it to ask for.
 */
function checkRecent(what: string, col: CollectionConfig) {
  const { recent } = col;
  if (recent === undefined) return;
  if (
    typeof recent !== "boolean" &&
    !(typeof recent === "number" && Number.isFinite(recent))
  )
    fail(`${what} recent must be true, false or a number of entries`);
  if (col.dashboard === false && (recent === true || Number(recent) > 0))
    fail(
      `${what} sets recent, but dashboard: false leaves it off the dashboard; remove one of them`,
    );
}

const KEEP_ENTRIES =
  "set fixedEntries: true to keep entries from being created, deleted or renamed";

/** What to do instead of each earlier setting that `fixedEntries` replaced. */
const REPLACED: Record<string, string> = {
  create: KEEP_ENTRIES,
  delete: `remove it, since deleting an entry that others refer to now asks first, or ${KEEP_ENTRIES}`,
  editable: `${KEEP_ENTRIES} (editable: false), or remove it (editable: true)`,
};

/**
 * `fixedEntries`, `readOnly` (and the settings they replaced), `dashboard`,
 * `reservedSlugs` and `pinned`.
 */
function checkEditing(what: string, col: CollectionConfig) {
  for (const [old, instead] of Object.entries(REPLACED))
    if (old in col)
      fail(`${what} sets ${old}, which Vestry replaced: ${instead}`);
  for (const flag of ["fixedEntries", "readOnly", "dashboard"] as const)
    if (col[flag] !== undefined && typeof col[flag] !== "boolean")
      fail(`${what} ${flag} must be true or false`);
  checkSlugList(what, "reservedSlugs", col.reservedSlugs);
  checkPinned(what, col.pinned);
}

/** Every slug in the list must be a slug (a hole or `undefined` included). */
function checkSlugList(what: string, key: string, slugs: unknown) {
  if (slugs === undefined) return;
  if (!Array.isArray(slugs)) fail(`${what} ${key} must be a list of slugs`);
  for (const slug of slugs as unknown[]) checkSlug(what, key, slug);
}

function checkSlug(what: string, key: string, slug: unknown) {
  if (typeof slug !== "string" || !isSafeSlug(slug))
    fail(
      `${what} ${key} has ${JSON.stringify(slug) ?? "undefined"}, which is not a slug`,
    );
}

/** Each pinned entry is a slug, or `{ slug, icon? }`. */
function checkPinned(what: string, pinned: unknown) {
  if (pinned === undefined) return;
  if (!Array.isArray(pinned))
    fail(`${what} pinned must be a list of slugs or { slug, icon }`);
  for (const item of pinned as unknown[]) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      checkSlug(what, "pinned", item);
      continue;
    }
    const { slug, icon } = item as { slug?: unknown; icon?: unknown };
    checkSlug(what, "pinned", slug);
    checkIcon(`${what} pinned icon for "${String(slug)}"`, icon);
  }
}

/** An icon, if given, must be one the panel draws, not a stand-in file. */
function checkIcon(what: string, icon: unknown) {
  if (icon === undefined) return;
  if (typeof icon !== "string") return fail(`${what} must be an icon name`);
  if (!isIconName(icon))
    fail(
      `${what} is ${JSON.stringify(icon)}, which is not one of the panel's icons (${ICON_NAMES.join(", ")})`,
    );
}

function checkComponent(name: string, component: ComponentConfig) {
  checkIcon(`component "${name}" icon`, component.icon);
  const props = component.props ?? {};
  const dated = [...Object.entries(props), ...nestedFields(props)].find(
    ([, field]) => isFilenameDate(field),
  );
  if (dated) {
    fail(
      `component "${name}": "${dated[0]}" uses storeIn: "filename", which is only for collection fields`,
    );
  }
  checkDateDefaults(`component "${name}"`, props);
  checkNoEntryFields(
    `component "${name}"`,
    [...Object.entries(props), ...nestedFields(props)],
    "it is only for a collection's top-level fields",
  );
}
