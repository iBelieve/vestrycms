/**
 * Vestry configuration types.
 *
 * Everything here is plain, JSON-serializable data. The integration embeds the
 * config into the server bundle and ships it to the control panel over the
 * API, so field definitions cannot contain functions. Behaviour that would
 * normally be a callback (preview URLs, slug generation, default values) is
 * expressed as small templates or declarative options instead.
 */

export type FieldType =
  | "text"
  | "textarea"
  | "slug"
  | "number"
  | "boolean"
  | "date"
  | "datetime"
  | "select"
  | "multiselect"
  | "color"
  | "image"
  | "file"
  | "reference"
  | "object"
  | "array"
  | "markdown"
  | "code"
  | "json"
  | "crop"
  | "focalPoint"
  | "tree";

export interface FieldBase<T extends FieldType = FieldType> {
  type: T;
  /** Human label. Defaults to a title-cased version of the key. */
  label?: string;
  /** Help text rendered under the input. */
  description?: string;
  required?: boolean;
  /** Show in the sidebar rail of the entry editor instead of the main column. */
  sidebar?: boolean;
  /** Hide from the editor entirely (value is preserved on save). */
  hidden?: boolean;
  /** Make the input read-only in the editor. */
  readOnly?: boolean;
  /** Width in the main column: full width or half (two fields per row). */
  width?: "full" | "half" | "third";
}

export interface TextField extends FieldBase<"text"> {
  placeholder?: string;
  maxLength?: number;
  /** Validate against a regular expression (source string). */
  pattern?: string;
  default?: string;
}

export interface TextareaField extends FieldBase<"textarea"> {
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  default?: string;
}

export interface SlugField extends FieldBase<"slug"> {
  /** Field key the slug is generated from while the entry is new. */
  from?: string;
  default?: string;
}

export interface NumberField extends FieldBase<"number"> {
  min?: number;
  max?: number;
  step?: number;
  default?: number;
}

export interface BooleanField extends FieldBase<"boolean"> {
  default?: boolean;
}

export interface DateField extends FieldBase<"date"> {
  /** "now" defaults new entries to today, in the editor's time zone. */
  default?: "now";
  /**
   * Allow an optional wall-clock time. The value stays `YYYY-MM-DD` when no
   * time is set and becomes `YYYY-MM-DDTHH:mm` when one is.
   */
  time?: "optional";
  /** Hint shown next to the time input when it is empty, e.g. "defaults to 9:00 AM". */
  timeHint?: string;
  /**
   * Where the value is kept. With `"filename"` the date is the `YYYY-MM-DD-`
   * prefix of the entry's file name (`2026-03-01-title.mdx`) instead of a
   * frontmatter key, so there is one date and it sorts the folder. Changing
   * it in the editor renames the file, which also changes any URL built
   * from the slug. For collections with one file per entry, on a top-level
   * field, at most one per collection; `time` is not supported.
   */
  storeIn?: "frontmatter" | "filename";
}

export interface DatetimeField extends FieldBase<"datetime"> {
  /**
   * How the value is stored:
   * - "local": wall-clock ISO without zone, e.g. `2026-06-14T09:00`
   * - "iso": full ISO instant in UTC (`toISOString()`)
   *
   * Defaults to "local", or "iso" for an `autoUpdate` field. A wall-clock
   * time is the editor's own, from the browser's time zone.
   */
  storage?: "local" | "iso";
  /** "now" defaults new entries to the current time. */
  default?: "now";
  /**
   * Automatically set the field to the current time whenever the entry is
   * saved (e.g. `updatedDate`). The field is shown read-only.
   */
  autoUpdate?: boolean;
}

export interface SelectOption {
  label: string;
  value: string;
  /** Optional swatch colour for the option (used by the liturgical colour picker). */
  color?: string;
}

export interface SelectField extends FieldBase<"select"> {
  options: SelectOption[];
  default?: string;
  /** Allow clearing the value. */
  clearable?: boolean;
}

export interface MultiselectField extends FieldBase<"multiselect"> {
  options: SelectOption[];
  default?: string[];
}

export interface ColorField extends FieldBase<"color"> {
  default?: string;
}

/**
 * How an asset reference is written into the content file.
 *
 * - "relative": path relative to the entry file (`../../assets/covers/x.jpg`).
 *   This is what Astro's `image()` schema helper expects.
 * - "filename": the bare file name (`x.jpg`). Useful when the site resolves
 *   assets itself with `import.meta.glob`.
 * - "public": the URL path under `public/` (`/bulletins/x.pdf`).
 * - "repo": the repository-relative path (`src/assets/covers/x.jpg`).
 */
export type AssetStorage = "relative" | "filename" | "public" | "repo";

export interface AssetFieldOptions {
  /** Repository directory that holds the files, e.g. `src/assets/covers`. */
  directory: string;
  /** How the chosen file is referenced from the content. Defaults to "relative" under src/, "public" under public/. */
  storeAs?: AssetStorage;
  /** Accepted extensions (without the dot). */
  accept?: string[];
  /** Allow uploading new files from the editor. Defaults to true. */
  upload?: boolean;
}

export interface ImageField extends FieldBase<"image">, AssetFieldOptions {
  default?: string;
}

export interface FileField extends FieldBase<"file">, AssetFieldOptions {
  default?: string;
}

export interface ReferenceField extends FieldBase<"reference"> {
  /** Collection key to pick from. */
  collection: string;
  default?: string;
}

export interface ObjectField extends FieldBase<"object"> {
  fields: Record<string, Field>;
  /** Render inline instead of as a collapsible group. */
  inline?: boolean;
}

export interface ArrayField extends FieldBase<"array"> {
  /** Shape of each item. */
  of: Field;
  /** Field key (for object items) to use as each item's title in the list. */
  itemLabel?: string;
  min?: number;
  max?: number;
  /** Label used on the "Add" button, e.g. "Add item". */
  addLabel?: string;
}

export interface MarkdownField extends FieldBase<"markdown"> {
  /** Component names (from `config.components`) that may be inserted. */
  components?: string[];
  /** Height hint for the editor in rows. */
  rows?: number;
  default?: string;
}

export interface CodeField extends FieldBase<"code"> {
  language?: "markdown" | "yaml" | "json" | "javascript" | "text";
  rows?: number;
  default?: string;
}

export interface JsonField extends FieldBase<"json"> {
  default?: unknown;
}

/**
 * A crop rectangle for a sibling image field, stored in the image's natural
 * pixel coordinates as `{ x, y, width, height }`.
 */
export interface CropField extends FieldBase<"crop"> {
  /** Key of the image field (at the same level) this crop applies to. */
  image: string;
  /** Lock the rectangle to an aspect ratio, e.g. `16 / 9` or `8 / 9`. */
  aspect?: number;
  /** Smallest allowed width/height in pixels. Defaults to 16. */
  minSize?: number;
}

/**
 * A focal point for a sibling image field, stored as percentages
 * `{ x, y }` (0–100) suitable for CSS `object-position`.
 */
export interface FocalPointField extends FieldBase<"focalPoint"> {
  /** Key of the image field (at the same level) this focal point applies to. */
  image: string;
  /** Aspect ratios previewed next to the picker, e.g. `["16:9", "1:1"]`. */
  previews?: string[];
}

/**
 * A tree of nodes (e.g. a navigation menu). Each node has the given fields
 * plus a `children` array (the key is configurable) holding nested nodes.
 * The editor supports collapsing, inline editing, adding children, and
 * drag-and-drop to reorder or re-parent (drag sideways to change depth).
 */
export interface TreeField extends FieldBase<"tree"> {
  /** Fields of each node (excluding the children array). */
  fields: Schema;
  /** Key that holds nested nodes. Defaults to "children". */
  childrenKey?: string;
  /** Maximum nesting depth; 1 means a flat list. Defaults to unlimited. */
  maxDepth?: number;
  /** Field shown as each node's label. Defaults to "title". */
  itemLabel?: string;
  /** Field shown in muted text after the label, e.g. "url". */
  itemDetail?: string;
  /** Label for the add button. */
  addLabel?: string;
}

export type Field =
  | TextField
  | TextareaField
  | SlugField
  | NumberField
  | BooleanField
  | DateField
  | DatetimeField
  | SelectField
  | MultiselectField
  | ColorField
  | ImageField
  | FileField
  | ReferenceField
  | ObjectField
  | ArrayField
  | MarkdownField
  | CodeField
  | JsonField
  | CropField
  | FocalPointField
  | TreeField;

export type Schema = Record<string, Field>;

/** File formats Vestry knows how to read and write. */
export type EntryFormat = "mdx" | "md" | "yaml" | "json";

export interface StatusConfig {
  /** Boolean field that controls published state. */
  field: string;
  /** Value of `field` that means "published". Defaults to `true`. */
  publishedWhen?: boolean;
}

export interface SortConfig {
  field: string;
  direction?: "asc" | "desc";
}

export interface ListColumn {
  /** Field key, or "slug" / "status" / "updated". */
  field: string;
  label?: string;
}

export interface BodyConfig {
  /** Component names (from `config.components`) that may be inserted into the body. */
  components?: string[];
  /** Where images inserted into the body are stored and how they're referenced. */
  images?: AssetFieldOptions;
  /** Label for the body editor. */
  label?: string;
  /** Placeholder shown when empty. */
  placeholder?: string;
}

/**
 * A titled group of fields in the entry editor. Sections in the main column
 * render as cards in the order given; `sidebar: true` puts the card in the
 * rail. The string `"body"` places the content editor among the sections.
 * Fields not named by any section fall into a "Details" card (or the rail,
 * for fields with `sidebar: true`).
 */
export interface FieldSection {
  label: string;
  description?: string;
  fields: string[];
  sidebar?: boolean;
}

export type EditorSection = FieldSection | "body";

export interface CollectionConfig {
  label: string;
  /** Singular label, e.g. "Sermon". */
  singular?: string;
  /**
   * Where entries live, relative to the project root. Exactly one `*` (or
   * `**`) stands in for the entry slug:
   *
   * - `src/content/sermons/*.mdx`   one file per entry
   * - `src/content/posts/** /index.md` nested folders, folder-per-entry
   * - `src/content/preachers.json`  no wildcard: a single JSON/YAML file holding an array of entries
   */
  path: string;
  /** Defaults to the file extension of `path`. */
  format?: EntryFormat;
  schema: Schema;
  /**
   * Body configuration for `md`/`mdx` collections. Set to `false` to hide the
   * body editor (e.g. for data-only collections).
   */
  body?: BodyConfig | false;
  /** Field used as the entry title in listings and the editor header. Defaults to "title". */
  titleField?: string;
  /** Group fields into titled cards in the editor. */
  sections?: EditorSection[];
  /** For single-file collections: the field holding the entry id. Defaults to "id". */
  idField?: string;
  /** How slugs are generated for new entries. */
  slug?: {
    /** Field key the slug is derived from; defaults to the title field. */
    from?: string;
    /**
     * Template, e.g. `{date}-{title}` or `{date|year}/{date|month}/{title}`.
     * Field values are slugified; the rest is kept, so a `/` makes folders
     * (which needs a `**` path). `|year`, `|month` and `|day` take the parts
     * of a date.
     */
    template?: string;
  };
  status?: StatusConfig;
  sort?: SortConfig;
  /**
   * Columns of the entry list, in order. The title always shows, as the
   * entry's link with its subtitle or excerpt under it; listing the title
   * field here only sets its place and label. Defaults to the sort field.
   */
  columns?: (string | ListColumn)[];
  /**
   * Show the entry list as a tree, nesting entries by the folders in their
   * slugs (`a/b` under `a`), for a `**` path. `true` adds a Tree/List
   * toggle that opens on the tree; `"only"` shows the tree with no toggle.
   * A search or status filter always lists its matches flat.
   */
  tree?: boolean | "only";
  /** Fields searched by the list filter. Defaults to the title field. */
  searchFields?: string[];
  /**
   * Preview URL template, e.g. `/sermons/{slug}`. Any schema field may be
   * referenced in braces, with the same filters as `slug.template`
   * (`/{date|year}/{slug}`).
   */
  previewUrl?: string;
  /** Lucide icon name used in navigation. */
  icon?: string;
  /** Commit message template. Supports `{action}`, `{collection}`, `{slug}`, `{title}`. */
  commitMessage?: string;
  /**
   * Show a "Recent …" list on the dashboard, and a New button for the
   * collection in the dashboard's top bar (unless the collection is
   * `fixedEntries` or `readOnly`). Defaults to true when `sort` points at a
   * date/datetime field. A number sets how many entries to show. The list
   * is newest first by the sort field's date, or else by the first date
   * column's, and in the sort order when there is neither.
   */
  recent?: boolean | number;
  /**
   * `false` leaves the collection off the dashboard: no tile, no "Recent …"
   * list and no New button there. It stays in the sidebar. For collections
   * editors rarely open, such as categories, authors or generated entries.
   */
  dashboard?: boolean;
  /**
   * `true` keeps the set of entries as the site has it: their fields and
   * bodies can be edited, but entries can't be created, deleted or renamed
   * in the control panel. For entries the site depends on one by one, see
   * `reservedSlugs`.
   */
  fixedEntries?: boolean;
  /**
   * `true` makes the collection read-only in the control panel, for entries
   * a script or another tool writes: they can be opened and viewed, but
   * nothing can be saved, created, renamed or deleted.
   */
  readOnly?: boolean;
  /**
   * Slugs the site depends on, such as pages kept at fixed routes
   * (`["index", "404"]`) or names its other routes already use. An entry
   * at one can't be renamed or deleted, and no other entry can be created
   * at or renamed to one, or, in a collection with folders (`**`), to a
   * slug under one (`sermons/index`).
   */
  reservedSlugs?: string[];
  /**
   * The collection's special entries, such as its home and 404 pages,
   * listed first, above a divider, in this order, whatever the sort, view
   * or folder. Each is a slug, or a slug with the name of an icon shown
   * before its title: `[{ slug: "index", icon: "house" }, "404"]`.
   * Defaults, in a collection of a file per entry, to the home page,
   * `index`, and in `src/pages/` also to the error pages, `404` and `500`,
   * each with an icon. `[]` pins none.
   */
  pinned?: (string | PinnedEntry)[];
}

/** A pinned entry's slug, and the icon shown before its title. */
export interface PinnedEntry {
  slug: string;
  /** An icon name, as for a collection's `icon`. */
  icon?: string;
}

export interface SingletonConfig {
  label: string;
  path: string;
  format?: EntryFormat;
  schema: Schema;
  body?: BodyConfig | false;
  /** Group fields into titled cards in the editor. */
  sections?: EditorSection[];
  previewUrl?: string;
  icon?: string;
  commitMessage?: string;
}

export interface ComponentConfig {
  /** Label shown in the insert menu. Defaults to the component name. */
  label?: string;
  description?: string;
  /** Lucide icon name. */
  icon?: string;
  /**
   * Import specifier written at the top of the MDX file when the component
   * is used, e.g. `@/components/blocks/Highlights.astro`. Omit for components
   * provided globally (MDX `components` prop) or plain HTML tags.
   */
  import?: string;
  /** Named import instead of default. */
  namedImport?: boolean;
  /** Props editable in the control panel. */
  props?: Schema;
  /**
   * Whether the component wraps rich text children. `true` gives a nested
   * editor; `"text"` restricts children to inline content; `false` (default)
   * is self-closing.
   */
  children?: boolean | "text";
  /** Render inline (within a paragraph) rather than as a block. */
  inline?: boolean;
}

/** A named inline style for rich text: a class on a `<span>`. */
export interface TextStyleConfig {
  /** Shown in the editor's Styles menu. */
  label: string;
  /** Class written to the span, e.g. `text-red` for `<span class="text-red">`. */
  class: string;
  /**
   * CSS declarations that preview the style in the editor, e.g.
   * `color: #dc2626`. The site styles the class itself; without a preview
   * the editor outlines the text.
   */
  css?: string;
}

export interface AssetContainerConfig {
  label: string;
  /** Repository directory, e.g. `src/assets/images` or `public/bulletins`. */
  directory: string;
  /** Accepted extensions (without the dot). Defaults to common image types. */
  accept?: string[];
  icon?: string;
}

export interface NavigationGroup {
  label: string;
  /** Collection, singleton or asset container keys, prefixed: `collections.sermons`, `singletons.site`, `assets.images`. */
  items: string[];
}

export interface RepoConfig {
  /** GitHub owner (user or organisation). */
  owner: string;
  /** Repository name. */
  name: string;
  /** Branch that commits go to. Defaults to the repository default branch. */
  branch?: string;
}

export interface AuthConfig {
  /**
   * Email addresses that are always admins. They can sign in before anyone
   * has invited them (the first admin bootstraps the user list) and cannot
   * be removed or demoted from the control panel.
   */
  admins?: string[];
  /**
   * Prefix for the sign-in tables (`user`, `session`, `account`,
   * `verification`, `rateLimit`), e.g. `mysite_` for `mysite_user`. Lets
   * several sites share one D1 database, each with its own users and
   * sessions. Lowercase letters, digits and underscores, starting with a
   * letter (table names ignore case, so `Site_` would clash with `site_`).
   * Changing it on a live site starts it with an empty user list.
   */
  tablePrefix?: string;
}

export interface DeploysConfig {
  /**
   * The check run that reports the site's build and deploy: runs whose name
   * starts with this. Defaults to Cloudflare's, `Workers Builds` (Workers
   * Builds names its runs `Workers Builds: <worker>`) and `Cloudflare Pages`.
   * Name one Worker, e.g. `Workers Builds: website`, when a repository
   * builds several.
   */
  check?: string;
}

/**
 * Site analytics, shown on the Analytics page and the dashboard. One
 * provider for now; each is a variant of this union, told apart by
 * `provider`.
 */
export type AnalyticsConfig = PlausibleAnalyticsConfig;

export interface PlausibleAnalyticsConfig {
  provider: "plausible";
  /** The site's domain as Plausible knows it, e.g. `example.org`. */
  siteId: string;
  /**
   * The Plausible server, for a self-hosted one, e.g.
   * `https://analytics.example.org`. Defaults to `https://plausible.io`.
   * Vestry reads it with the Stats API key in `VESTRY_PLAUSIBLE_API_KEY`.
   */
  host?: string;
}

export interface MailConfig {
  /**
   * `resend` sends through Resend (API key in `VESTRY_RESEND_API_KEY`);
   * `console` prints emails to the server log (development only).
   */
  provider: "resend" | "console";
  /** The From address, e.g. `Vestry <vestry@example.org>`. */
  from: string;
}

export interface VestryConfig {
  /** Display name for the control panel. */
  name?: string;
  /**
   * Logo shown in the control panel's top bar instead of the name: a
   * repository path (e.g. `src/assets/logo.svg`, bundled into the build, or
   * served through Vestry when the file is not there at build time) or an
   * absolute URL. The bar is dark, so use a light/reverse variant.
   */
  logo?: string;
  /** Public site URL, used for preview links. */
  siteUrl?: string;
  repo: RepoConfig;
  collections?: Record<string, CollectionConfig>;
  singletons?: Record<string, SingletonConfig>;
  components?: Record<string, ComponentConfig>;
  /**
   * Inline styles offered in the rich text editor's Styles menu, keyed by a
   * name of your choosing. Each wraps the selection in a `<span>` with the
   * style's class.
   */
  textStyles?: Record<string, TextStyleConfig>;
  assets?: Record<string, AssetContainerConfig>;
  /** Optional navigation grouping; defaults to Collections / Singletons / Assets. */
  navigation?: NavigationGroup[];
  /** Default commit message template. */
  commitMessage?: string;
  /**
   * Format files with the project's Prettier before saving, when Prettier is
   * installed. Defaults to true. Set to false if Prettier does not format
   * your content safely: its MDX support predates MDX 2 and can break, for
   * example, a blockquote that contains inline HTML. Files are then saved
   * exactly as the editor serialises them, so add the content directories to
   * `.prettierignore`.
   */
  format?: boolean;
  /** Sign-in: who may edit. Users sign in with a code emailed to them. */
  auth?: AuthConfig;
  /** Outbound email for sign-in codes and invitations. Required in production. */
  mail?: MailConfig;
  /**
   * Show the build and deploy status of recent saves, read from the check
   * runs the host posts on each commit (the GitHub App needs Checks: read).
   * On by default; `false` turns it off.
   */
  deploys?: false | DeploysConfig;
  /**
   * Show visitor numbers from the site's analytics on an Analytics page and
   * the dashboard. Off unless set.
   */
  analytics?: AnalyticsConfig;
}
