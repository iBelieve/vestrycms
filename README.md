<h1>
  <img src="assets/icon.svg" alt="" width="48" align="absmiddle" />
  Vestry CMS
</h1>

A git-backed CMS for [Astro](https://astro.build), built as an Astro
integration. Content, assets and configuration live in your repository;
content needs no database and there is no external asset storage. The control panel is a
React app served from your site at `/admin`, and every save is a commit.

- **Astro-native content.** Collections map onto the files Astro already
  reads: Markdown/MDX with frontmatter, JSON and YAML, one file per entry or
  one file holding many. Images are referenced the way Astro's `image()`
  schema helper and `public/` expect.
- **MDX with components.** A Tiptap rich text editor reads and writes MDX.
  Astro components you register show up in an "Insert" menu and are edited
  as blocks with a form for their props (Statamic's Bard sets, for MDX). A
  Source tab exposes the raw MDX.
- **GitHub backend, swappable.** Reads and writes go through a small
  `ContentSource` interface. The GitHub implementation uses the Git Data API
  with ETag revalidation, per-SHA caching and a build-time index, so the
  panel stays snappy; the only database is the small one sign-in needs. `astro dev` edits your working
  copy directly.
- **Prettier-clean commits.** When the project has Prettier installed, files
  are formatted with the project's own config before they are committed
  (`format: false` turns this off, and files in `.prettierignore` are left
  as written).

## Setup

Vestry needs Astro 6 or 7 and Node 22.12 or later. On Cloudflare, use Astro
7.3.4 or later: earlier 7.x releases streamed on-demand pages in workerd as
`[object Object]`, which breaks the `/admin` shell.

```sh
pnpm add vestrycms
```

```ts
// vestry.config.ts
import { collection, component, defineConfig, fields } from "vestrycms/config";

export default defineConfig({
  name: "My Site",
  siteUrl: "https://example.com",
  repo: { owner: "me", name: "my-site", branch: "main" },
  collections: {
    posts: collection({
      label: "Posts",
      path: "src/content/posts/*.mdx",
      titleField: "title",
      sort: { field: "date", direction: "desc" },
      status: { field: "draft", publishedWhen: false },
      previewUrl: "/posts/{slug}",
      schema: {
        title: fields.text({ required: true }),
        date: fields.date({ sidebar: true, default: "now" }),
        cover: fields.image({ directory: "src/assets/covers" }),
        draft: fields.boolean({ default: false }),
      },
      body: { components: ["Callout"] },
    }),
  },
  components: {
    Callout: component({
      import: "@/components/Callout.astro",
      children: true,
      props: {
        tone: fields.select({ options: [{ label: "Info", value: "info" }] }),
      },
    }),
  },
  textStyles: {
    red: { label: "Red", class: "text-red", css: "color: #dc2626" },
  },
  assets: {
    covers: { label: "Covers", directory: "src/assets/covers" },
  },
});
```

```js
// astro.config.mjs
import vestry from "vestrycms";
import vestryConfig from "./vestry.config";

export default defineConfig({
  integrations: [vestry(vestryConfig, { base: "/admin" })],
});
```

The config is plain data (it is serialised into the server bundle and sent to
the browser), so it cannot contain functions.

`name` titles the control panel; `logo` (a repository path such as
`src/assets/logo-reverse.svg`, or an absolute URL) replaces it in the dark
top bar (a warm brown-grey, `#2d2622`), so a light or reverse variant works
best. A repository logo is bundled into the build, so the sign-in page shows
it even before the GitHub App is set up.

### Sign-in and users

Sign-in runs on [Better Auth](https://www.better-auth.com) with its email OTP
and admin plugins. Editors sign in with a six-digit code emailed to them;
there are no passwords. `auth.admins` lists the addresses that are always
admins (they can sign in before anyone has invited them, which bootstraps the
user list). The **Users** page lists them before their first sign-in too,
named from their address, so an admin can rename them or send them an
invitation. That listing gives each address its account, so taking an
address out of `auth.admins` later leaves it an ordinary admin: remove it on
the **Users** page as well. Admins invite everyone else from the **Users**
page and choose a role:

| Role     | Can                                                          |
| -------- | ------------------------------------------------------------ |
| `editor` | Create, edit, publish and delete content; upload assets      |
| `admin`  | Everything an editor can, plus invite, edit and remove users |

Users, sessions (30 days) and pending codes live in a SQL database that
Better Auth accepts directly: a Cloudflare D1 binding named `VESTRY_DB` in
production, a `node:sqlite` file in dev, its memory adapter in tests. The
tables are created on first use with Better Auth's migrator, so there is no
migration step. Codes expire after 10 minutes and are burned after five
wrong guesses; Better Auth rate-limits the sign-in routes per IP (counters in
the database, so they hold across Worker isolates). Emails go through
`config.mail` (`resend`, with the key in `VESTRY_RESEND_API_KEY`, or `console`
for development). Vestry adds invitations, the config-listed admins, a
`lastLoginAt` field and the last-admin guards on top of the plugins.

Commits are made through a GitHub App installed on the repository with
**Contents: read and write**, plus **Checks: read-only** for the
[build status](#build-status). Commits are made by the app's bot, with the
editor credited as a co-author (`Co-authored-by: Name <email>`), so GitHub
shows both and the editor's account never needs push access.

| Variable                              | Purpose                                                                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `VESTRY_GITHUB_APP_ID`                | GitHub App id                                                                                                    |
| `VESTRY_GITHUB_INSTALLATION_ID`       | The app's installation id on the repository                                                                      |
| `VESTRY_GITHUB_PRIVATE_KEY`           | The app's PEM private key (PKCS#1 as issued, PKCS#8, `\n`-escaped or base64 also accepted)                       |
| `VESTRY_RESEND_API_KEY`               | Resend API key (when `mail.provider` is `resend`)                                                                |
| `VESTRY_SECRET`                       | Signs session cookies (`openssl rand -hex 32`); dev modes fall back to a fixed value                             |
| `VESTRY_PLAUSIBLE_API_KEY`            | Plausible Stats API key (when [analytics](#analytics) uses Plausible)                                            |
| `VESTRY_GOOGLE_ANALYTICS_CREDENTIALS` | A Google service account's JSON key, or that base64-encoded (when [analytics](#analytics) uses Google Analytics) |
| `VESTRY_MODE`                         | `auth` or `github` to turn sign-in on in `astro dev`                                                             |

```jsonc
// wrangler.jsonc
"d1_databases": [{ "binding": "VESTRY_DB", "database_name": "my-site-vestry" }]
```

Several sites can share one D1 database (handy on the free plan's database
limit): give each a different `auth.tablePrefix` (lowercase, e.g. `"mysite_"`), and bind
the same `database_id` as `VESTRY_DB` in each site's `wrangler.jsonc`. Each
site then gets its own tables (`mysite_user`, `mysite_session`, …), so users,
roles and sessions stay separate. Without a prefix the tables keep Better
Auth's plain names, so don't let two sites share a database unprefixed: they
would share one user list, and anyone invited to one could sign in to both.
Changing the prefix on a live site starts it with an empty user list (config
admins can still sign in and invite everyone again).

In `astro dev` no sign-in is needed by default: the panel edits the project
directory and you commit with git. `VESTRY_MODE=auth` keeps the local source
but requires sign-in, with users in git-ignored `.vestry/auth.sqlite`, for
working on the flow itself. Emails print to the terminal unless
`mail.provider` is `resend` and `VESTRY_RESEND_API_KEY` is set, in which case
they are really sent. `VESTRY_MODE=github` additionally commits through the
GitHub App.

## How it works

```
src
├── index.ts            Astro integration: routes, Vite plugin, dev middleware
├── config/             defineConfig / collection / component / fields
├── core/
│   ├── source.ts       ContentSource interface + git blob hashing
│   ├── sources/        LocalSource (fs), GitHubSource (Git Data API), GitHub App tokens
│   ├── cache.ts        Cache interface, MemoryCache, kvCache adapter
│   ├── service.ts      Collections → entries, singletons, assets
│   ├── api.ts          HTTP API (runtime-agnostic Request → Response)
│   ├── auth.ts         Better Auth setup (email OTP + admin), invitations, bootstrap admins
│   ├── roles.ts        Role list and the PublicUser shape shared with the UI
│   ├── mail.ts         Mailer interface, Resend + console adapters
│   └── values.ts       Asset path normalisation, auto fields
├── mdx/                MDX ⇄ ProseMirror document conversion
├── pages/              Injected routes: admin.astro shell, api.ts endpoint
├── integration/        Build-time index, formatter and logo modules, dev bridge, client deps
└── ui/                 React control panel (Tiptap, TanStack Query, react-router)
```

Routes injected into the site:

- `/admin/[...path]` – the control panel shell (on-demand, no auth needed to
  load the shell; data comes from the API).
- `/admin/api/[...path]` – JSON API. `config`, `status`, `deploys`, `dashboard`, `analytics?period=`, `collections/:key`,
  `collections/:key/entries/:slug`, `collections/:key/references?slug=`,
  `singletons/:key`, `assets/:container?dir=` (`&all=1` for every file below it),
  `file?path=`, `users` (admins), and `auth/*` (Better Auth's routes).

Virtual modules provided by the Vite plugin: `virtual:vestry/config`,
`virtual:vestry/runtime`, `virtual:vestry/index` (build-time frontmatter
index keyed by git blob SHA), `virtual:vestry/formatter` (Prettier, when
installed) and `virtual:vestry/logo` (the logo's build asset URL, or `null`).

The index is bundled into the server, so it holds only what entry lists
show: nested and long-form fields (`array`, `object`, `tree`, `markdown`,
`code`, `json`) are left out unless the collection's title, status, sort,
columns, search fields or preview URL name them, or they hold references
(which a rename looks up). A collection of large data
files therefore costs little.

### Dev vs production

With the Cloudflare adapter, on-demand routes run inside workerd even in
`astro dev`, where Node's `fs` is unavailable. The integration therefore
serves the API from a Vite dev-server middleware (Node) in development, and
from the injected Astro endpoint in production. Both call the same
`createApi()`.

### Editing model

- Entry values are normalised for the editor: image/file fields always hold
  repository paths; on save they are written back in the configured form
  (`relative` to the entry file, bare `filename`, `public` URL or `repo`
  path). Image and file props of a configured component in the body (or in
  a `markdown` field) are handled the same way: repository paths while the
  editor holds the document, written back in their `storeAs` form whenever
  it serializes the document. A prop nobody changed is written back as the
  document had it, while it still names the same file. A value starting
  with `/` is the URL of a file in `public/` (or a repository path written
  with a leading slash).
- The body editor resolves relative references against the file the entry
  was opened from. A save that moves the entry to another folder rewrites
  the relative image references in its body and Markdown fields, and the
  relative imports of an MDX body, for the new file.
- The body editor parses MDX into a ProseMirror document. JSX components
  become `mdxComponent` nodes with their attributes converted to JSON where
  they are literals (anything else is kept verbatim as an expression).
  Imports for known components are regenerated on save; other ESM is kept as
  a raw block.
- Inline formatting that Markdown has no syntax for is written as plain
  HTML elements and edited as marks: `<sup>`, `<sub>`, `<u>`, `<small>` and
  `<span class="…">` (see [Text styles](#text-styles)).
- A line break is a Markdown hard break (a backslash before the line ending)
  wherever that works, and a `<br />` element where it doesn't: in table
  cells and headings, at the end of a paragraph, and before a line that
  would begin with a tag. `<br />` in the source is read as a line break.
- Saving composes the full file (YAML frontmatter + body) in the browser,
  formats it with Prettier when available, and sends it with the blob SHA
  the editor loaded. A changed SHA is reported as a conflict. If Prettier
  would change what the body says (see [Prettier and MDX](#prettier-and-mdx)),
  the body is saved as Vestry wrote it.
- Uploads chosen from an image/file field are committed together with the
  entry in one commit.

## Templates

`slug.template`, `previewUrl` and `commitMessage` are templates with
`{field}` placeholders (`{meta.kind}` reaches into an object). A filter
after a `|` takes part of a value:

| Placeholder      | Result                                             |
| ---------------- | -------------------------------------------------- |
| `{date}`         | The value, `2026-11-13`                            |
| `{date\|year}`   | Four-digit year, `2026`                            |
| `{date\|month}`  | Zero-padded month, `11`                            |
| `{date\|day}`    | Zero-padded day of month, `13`                     |
| `{slug\|nodate}` | The value without its file name's date, `my-title` |

The date filters read the parts as written at the start of the value
(`2026-11-13`, `2026-11-13T23:30:00-06:00`, or a slug such as
`2026-11-13-my-title`), without converting between time zones, and give
nothing for a value that isn't a date. An unknown filter is a config error.

A collection whose files are named `2012-07-31-title.mdx` but whose pages
live at `/articles/2012/07/title` uses:

```ts
slug: { template: "{date}-{title}" },
previewUrl: "/articles/{slug|year}/{slug|month}/{slug|nodate}",
```

and one that keeps its entries in dated folders:

```ts
articles: collection({
  path: "src/content/articles/**.mdx",
  slug: { template: "{date|year}/{date|month}/{title}" },
  previewUrl: "/articles/{slug}",
  // …
}),
```

In `slug.template` each inserted value is slugified and the rest is kept as
written, so with the second example a new entry titled "My Title" and dated
13 November 2026 is created at `src/content/articles/2026/11/my-title.mdx`.
A slug with a `/` needs a `**` wildcard in `path`; `*` matches one file
name.

`previewUrl` also has `{slug}`; `commitMessage` has `{action}`,
`{collection}`, `{slug}`, `{title}`, `{label}` and `{singular}`.

## Renaming entries and dates in file names

In a collection with one file per entry, the **Slug** box in the editor's
sidebar can be changed on an existing entry. Saving then moves the file: the
new file and the removal of the old one go in a single commit. Vestry refuses
a slug that another entry already has, and checks the slug as it is typed.

`reference` fields store the slug of the entry they point at, so a rename
also updates every entry and singleton that refers to the renamed one, in
the same commit. The editor lists them and asks before saving. Those files
are rewritten from their parsed contents without passing through Prettier,
and references inside MDX component props are not found.

In a collection kept as a list in one file, an entry's slug is its id field
(`idField`, `id` by default), so changing that field renames the entry in
the same way: the editor asks first, and references to it, in the list and
in other files, are updated in the same commit.

Deleting an entry that others refer to asks first, naming them, since
their references would then point at nothing.

`fixedEntries: true` keeps a collection's set of entries as the site has
it: their fields and bodies can still be edited, but entries can't be
created, deleted or renamed. `readOnly: true` goes further, for entries a
script or another tool writes: they can be opened and viewed, with every
field and the body shown read-only, but there is no Save, New or Delete
button, and the API refuses any save, creation, rename or deletion. (A
rename elsewhere still updates references to the renamed entry inside a
read-only collection's files, in the same commit.)

```ts
lectionaries: collection({
  path: "src/content/lectionaries/**.yaml",
  readOnly: true, // written by `pnpm lectionary`
  …
}),
```

For individual entries, `reservedSlugs` names slugs the site depends on,
such as pages kept at fixed routes or names its other routes already use:

```ts
pages: collection({
  path: "src/pages/*.mdx",
  reservedSlugs: ["index", "404", "sermons"],
  …
}),
```

An entry at a reserved slug can't be renamed or deleted (its Slug box is
read-only and it has no Delete button), and no other entry can be created at
or renamed to one, in any letter case. In a collection with nested folders,
no new entry can go under one either (`sermons/index` or `sermons/page/2`
under `sermons`), since its route would be the reserved one or sit below
it. Entries already there can still be edited and deleted, and renamed to a
slug outside it; a rename that stays under it (changing a date kept in the
file name is one) is refused like a new entry. The API refuses the same.

A date field can live in the file name instead of the frontmatter:

```ts
posts: collection({
  path: "src/content/posts/*.mdx",
  slug: { template: "{date}-{title}" },
  sort: { field: "date", direction: "desc" },
  schema: {
    title: fields.text({ required: true }),
    date: fields.date({ storeIn: "filename", default: "now" }),
  },
}),
```

The entry is saved as `2026-03-01-title.mdx` and its file holds no `date`
key. The editor still shows a date picker, and lists sort and display by it.
Changing the date renames the file, so a URL built from the slug changes
with it; add a redirect if the old address matters. The Slug box then holds
only the part after the date. With a `previewUrl`, the page's address
shows under the entry's title, and the Slug box notes where an edit to
the slug or date would move it. A slug
template that leaves the date out still gets it as a prefix. On the site, read the
date from the entry id (`entry.id.slice(0, 10)`). One such field per
collection, at the top level of the schema, without `time`.

## Editor sections

By default the editor shows a card with every field, the title first
(with the page's address under it), the content editor, and a rail for
fields marked `sidebar: true`. `sections` groups
fields into titled cards instead:

```ts
sections: [
  { label: "Hero", fields: ["heroImage", "heroFocalPoint", "heroTitle"] },
  "body", // the content editor goes here
  {
    label: "Events",
    description: "Shown as structured data.",
    fields: ["events"],
  },
  {
    label: "Search engines",
    sidebar: true,
    fields: ["seoTitle", "seoDescription"],
  },
];
```

Sections render in order; `sidebar: true` puts a card in the rail. Fields
not named by any section still fall into the fields card or the rail,
and the content editor renders after the sections unless `"body"` places
it. When a section of the main column (or the placed body) comes first,
the title gets a card of its own above it, and the fields card after the
sections is headed "Details"; otherwise the title heads the fields card.

## Text styles

Besides Markdown's own formatting, the rich text editor (the body editor and
`fields.markdown`) has underline, small text, superscript and subscript, and
a **Styles** menu for the inline styles a site defines:

```ts
textStyles: {
  red: { label: "Red", class: "text-red", css: "color: #dc2626" },
  caps: { label: "Small caps", class: "small-caps", css: "font-variant: small-caps" },
},
```

| Option  | Purpose                                                               |
| ------- | --------------------------------------------------------------------- |
| `label` | Name shown in the Styles menu                                         |
| `class` | Class written to the span                                             |
| `css`   | Declarations that preview the style in the editor (the menu and text) |

Choosing a style toggles it on the selection; text can carry several. The
site's own stylesheet gives the class its look on the published page: `css`
is only the editor's preview, and without it the styled text is outlined.

These are written to MDX as plain inline HTML, which needs no component or
import:

| Format      | MDX                                  |
| ----------- | ------------------------------------ |
| Underline   | `<u>text</u>`                        |
| Small       | `<small>text</small>`                |
| Superscript | `<sup>text</sup>`                    |
| Subscript   | `<sub>text</sub>`                    |
| Text style  | `<span class="text-red">text</span>` |

Reading does not depend on the config: any `<span>` whose only attribute is
a `class` becomes a styled span, whether or not `textStyles` lists the class
(unlisted ones are outlined in the editor and saved unchanged). An element
with other attributes (`<span class="a" id="b">`, `<u title="…">`), a spread
or no children stays an inline component, so nothing is lost on save.

Where marks cover the same text they nest in one order, outermost first:
link, superscript, subscript, bold, italic, strikethrough, text style,
underline, small, code. So bold underlined text is `**<u>text</u>**`.

In `.md` files the same tags are raw HTML: they are kept as written, but
edited as HTML snippets rather than marks, so the toolbar offers these
formats for MDX only.

### Prettier and MDX

Prettier's MDX parser predates MDX 2. A paragraph or list item that _begins_
with a tag (`<u>Note:</u> …`, `<span class="lead">…</span>`) is a JSX block
to it: an element longer than the print width is spread over several lines,
which MDX then reads as a block element wrapped around a paragraph, and a
Markdown hard break inside becomes a stray backslash. Vestry therefore
checks Prettier's output before saving, and if the body no longer parses to
the same document it keeps Prettier's frontmatter and its own body. Such a
file fails `prettier --check`, and `prettier --write` would damage it, so
list those content files in `.prettierignore`.

Vestry honours `.prettierignore` when it saves: a file the project tells
Prettier to ignore is written exactly as the editor serializes it. Ignoring
the content directory is the simplest setup for content with a lot of inline
tags, and keeps `prettier --check` and the control panel in agreement.

## Trees (menus)

`fields.tree` edits nested data such as a navigation menu. Each node has the
given fields plus a `children` array (configurable via `childrenKey`):

```ts
navigation: singleton({
  label: "Navigation",
  path: "src/data/navigation.json",
  body: false,
  schema: {
    main: fields.tree({
      maxDepth: 2,
      itemDetail: "url",
      fields: {
        title: fields.text({ required: true }),
        url: fields.text({ required: true }),
        external: fields.boolean(),
      },
    }),
  },
});
```

The editor shows an indented tree with collapse toggles, inline editing of a
node's fields, "add child" and remove actions, and drag-and-drop that both
reorders and re-parents: drag a node up or down to move it and sideways to
change its depth, within `maxDepth`. A dashed slot shows where it will land
and descendants travel with their parent.

## Entry lists

A collection's list shows the title (with its subtitle or excerpt under it)
and the fields named in `columns`; naming the title field there only sets
where the title column goes. A collection kept in nested folders (a `**`
path) can show its entries as a tree instead, nested by the folders in their
slugs (`cw21/1year` under `cw21`), with a child's title shortened by the
part it repeats from its parent's:

```ts
pages: collection({ path: "src/content/pages/**.mdx", tree: true, … }),
lectionaries: collection({ path: "…/**.yaml", tree: "only", … }),
```

`tree: true` adds a Tree/List toggle that opens on the tree; `"only"` shows
the tree with no toggle. Each editor's choice and expanded rows are kept in
their browser. A search or status filter lists its matches flat.

Entries, and siblings in the tree, follow the collection's `sort`. Entries
without a value for the sort field come last, and entries with the same
value (or none) go by title. Sorting pages by an `order` field that only
some of them set lists those first, in order, then the rest alphabetically.
A collection kept as a list in one file lists its entries in the file's
order.

A collection's special entries are listed first, above a divider, whatever
the sort or view, so the home page is easy to find whatever its title. In a
collection of a file per entry (`*.mdx`, or `**.mdx` with folders), that
is the home page, `index` (with a house icon), when there is one, and in
`src/pages/` itself, where Astro reads them, the error pages `404` and `500`
too. `pinned` names them instead, in order, each a slug or a slug with an
icon shown before its title (a name from the panel's icon set, as for a
collection's `icon`; any other name is an error at startup that lists
them):

```ts
pages: collection({
  path: "src/content/pages/**.mdx",
  pinned: [{ slug: "home", icon: "house" }, "search"],
  …
}),
```

`pinned` replaces the defaults, and `pinned: []` pins nothing. In the
tree, a pinned entry leaves its folder, and shows its slug after its title
when it sits in one (`resources/lectionaries`); one with entries under it
also stays in the tree, at the head of its folder. A search or filter keeps
matching pinned entries at the top.

## Icons

Collections, singletons, asset containers and components each take an
`icon`, shown beside them in the sidebar (collections: also on the
dashboard; components: in the insert menu and on the block). It is a
[Lucide](https://lucide.dev) name from the panel's own set, `ICON_NAMES` in
`src/config/icons.ts`, which is kept small to keep the control panel light.
Three keep Lucide's older names: `triangle-alert`, `book-marked` and
`music` (lucide.dev's `triangle-exclamation-point`, `book-bookmark` and
`eighth-notes`). Any other name, including Lucide's other older names
(`circle-help` for `circle-question-mark`), is an error at startup that
lists the set. Give each sidebar item its own icon, so editors can tell
them apart at a glance. To use one that isn't there yet, add it to
`ICON_NAMES` and `Icon.tsx`.

## Dashboard

Each collection gets a tile with its entry count (unless it is
`dashboard: false`, below). Collections whose `sort`
field is a date or datetime also get a "Recent …" list; set `recent: false`
to hide it, `recent: true` to show it for other collections, or a number to
change how many entries appear. The list shows the newest entries by the
sort field's date, or else by the first date field in `columns` (so
`recent: true` on FAQs sorted by `number` lists the latest by date, not the
highest numbers), and in the collection's sort order when it has neither. The dashboard's top bar has a **New …** button
for each collection with a recent list, unless it is `fixedEntries` or
`readOnly`. `dashboard: false` on a collection leaves it off the dashboard
altogether (no tile, list or button, and the dashboard request doesn't list
it), for collections editors rarely open such as categories, authors or
generated entries; it stays in the sidebar. Setting `recent` on such a
collection is an error at startup, as is a `recent` that is not true, false
or a number.

The dashboard loads with one request (`GET /admin/api/dashboard`) that
returns each collection's counts and recent entries, rather than one full
listing per collection: on a Worker every request pays the sign-in check
and the framework's start-up again. A collection that fails to list shows
"Couldn't load" on its tile, and the rest still load.

## Analytics

Set `analytics` and the panel shows the site's visitor numbers: a
**Visitors, last 7 days** card at the top of the dashboard (visitors and
pageviews against the week before, people on the site right now, a chart
and the top five pages) and an **Analytics** page in the sidebar with
visitors, visits, pageviews, bounce rate and visit duration for today, 7
or 30 days, 6 or 12 months, each compared with the period before, a chart
of visitors or pageviews, and the top pages, sources, countries and
devices. Every signed-in user sees them.

There are two providers, Plausible and Google Analytics 4.

### Plausible

```ts
analytics: {
  provider: "plausible",
  siteId: "example.org", // the site's domain in Plausible
  host: "https://analytics.example.org", // self-hosted; default https://plausible.io
},
```

`host` must be https (plain http only for `localhost`, since the key
travels with every request).

Plausible is read through its
[Stats API](https://plausible.io/docs/stats-api) with a Stats API key in
the `VESTRY_PLAUSIBLE_API_KEY` secret (`pnpm wrangler secret put
VESTRY_PLAUSIBLE_API_KEY`; on plausible.io the Stats API needs a Business
plan, Community Edition has it). A report takes eight requests, and
Plausible allows 600 an hour per key.

### Google Analytics

```ts
analytics: {
  provider: "google-analytics",
  propertyId: "123456789", // Admin › Property details; not the G-… measurement ID
},
```

Google Analytics 4 is read through the
[Data API](https://developers.google.com/analytics/devguides/reporting/data/v1)
as a service account. To set one up:

1. In the [Google Cloud console](https://console.cloud.google.com/), pick
   or create a project and enable the **Google Analytics Data API** for it.
2. Under **IAM & Admin › Service accounts**, create a service account (it
   needs no roles in the project). On its **Keys** tab, add a JSON key; the
   browser downloads it.
3. In Google Analytics, open **Admin › Property access management** for
   the property and add the service account's email
   (`…@….iam.gserviceaccount.com`) with the **Viewer** role.
4. Copy the **Property ID** from **Admin › Property details** into
   `propertyId`.
5. Store the key as a secret:
   `pnpm wrangler secret put VESTRY_GOOGLE_ANALYTICS_CREDENTIALS < key.json`
   (for `astro dev`, put it in `.env` on one line, or base64-encoded),
   then delete the downloaded file.

Vestry signs a JWT with the key (WebCrypto, so it runs in workerd), trades
it for an access token (kept for its hour), and sends eight requests per
report. The page and the card show the same things as with Plausible, in
GA4's terms: visitors are active users, visits are sessions, and the
bounce rate is the share of sessions that weren't engaged (GA4 counts a
session as engaged when it lasted ten seconds, saw two pages or converted),
not of one-page visits. "Right now" covers the last 30 minutes, not five.
Dates are counted in the property's time zone. The month periods run to
today instead of the end of the month.

### Both

Without the secret admins see a note naming it. The key stays on the
server: the panel asks Vestry, and Vestry asks the provider, caching each
period's report for five minutes. Other providers can be added as variants
of `analytics`, each implementing the report in `src/core/analytics/`.

## Caching

The GitHub source keeps what it reads in an in-memory cache that lives as
long as the Worker isolate: the branch head (trusted for 20 seconds, then
revalidated with its ETag, which costs no rate limit), the file tree by tree
SHA and file contents up to 2 MB by blob SHA (both immutable), and the
recent commits behind the build status (5 seconds); analytics reports are
kept there for five minutes too. Concurrent requests
share one fetch of the head and tree. The cache holds at most 2,000 entries
and about 32 MB, evicting the least recently used, because a Worker isolate
has 128 MB in all. A host that calls `createApi` itself can pass `cache`
(a `MemoryCache` with other limits, or `kvCache` over a KV namespace).

Files the panel shows from an asset listing are requested as
`file?path=…&v=<blob SHA>`; those responses are `private, immutable`, so
the browser does not ask again. Other file URLs (a field's image preview,
the logo) revalidate with an ETag.

## Build status

Every save is a commit, and a site that builds from its repository (such as
Cloudflare Workers Builds) is live only once that commit's build deploys.
The top bar shows where the latest saves are: **Publishing** while a build
is coming or running, **Live** once it has deployed, **Couldn't publish** if the
newest build failed, and **Not live** if its build was cancelled or never
reported, or an older build deployed after it. It opens the last ten
commits on the branch in sections: **Waiting to publish** (queued, or going
out with a newer build that hasn't started), **Publishing now** (building, or
going out with a build that is running; with a progress bar timed from
recent builds), **Not published** (a build that failed, was cancelled or
never ran, or was replaced by an older one) and **On the site**. Each links
to its build log. Toasts say when changes you watched publishing go live.

The status is read from the check runs the host posts on each commit
(Workers Builds names them `Workers Builds: <worker>`, Pages
`Cloudflare Pages`), with one GitHub GraphQL request that is cached for five
seconds, so it survives a reload and includes saves made elsewhere. The
panel asks every five seconds while something is publishing and every
minute otherwise. It needs no Cloudflare credentials, but the GitHub App
needs the **Checks: read-only** permission; without it admins see "Build
status off" and nobody else sees anything.

Every build deploys the whole tree, so a live commit makes every commit
before it live too. Workers Builds skips a queued build when a newer one is
queued, so saves in quick succession are shown as going out with the newer
build. When builds run side by side and finish out of order, the one that
deployed last is the one on the site.

```ts
deploys: { check: "Workers Builds: website" }, // a repository with several Workers
deploys: false, // off
```

`check` matches check runs whose name starts with it; by default any
`Workers Builds` or `Cloudflare Pages` run counts. In `astro dev` nothing is
built, so the status is hidden.

## Image crop and focal point

Two fields edit _how_ a sibling image field is displayed, so the site keeps
one original file in git and decides the framing in templates:

```ts
cover: fields.image({ directory: "src/assets/covers" }),
coverCrop: fields.crop({ image: "cover", aspect: 8 / 9 }),
hero: fields.image({ directory: "src/assets/images", storeAs: "filename" }),
heroFocalPoint: fields.focalPoint({ image: "hero", previews: ["16:9", "1:1"] }),
```

- `crop` stores `{ x, y, width, height }` in the image's natural pixel
  coordinates. The editor shows a draggable, resizable rectangle (with the
  aspect ratio locked when `aspect` is set), keyboard nudging, and a "Fit"
  button for the largest centred crop. Use it with sharp's `extract()` or a
  CSS transform.
- `focalPoint` stores `{ x, y }` as percentages (0–100) for CSS
  `object-position`. The editor shows a crosshair you click or drag, plus
  small previews at a few aspect ratios so you can see what survives a crop.

Both read the sibling field named by `image` at the same level of the
schema (top level, or inside the same object/array item), and preview
freshly uploaded images before they are committed.

## Forms

Vestry can keep what people send with a form on the site, such as a contact
form, for admins to read in the control panel. Name each form in the
config:

```ts
forms: {
  contact: { label: "Contact form", columns: ["name", "email", "subject"] },
},
```

and save each submission from the site's own handler (an Astro action, an
endpoint), after its own checks, into the sign-in database:

```ts
import { env } from "cloudflare:workers";
import { saveSubmission } from "vestrycms/forms";
import vestryConfig from "../vestry.config";

await saveSubmission({
  config: vestryConfig,
  database: env.VESTRY_DB,
  form: "contact",
  data: { name, email, subject, message },
});
```

Each form gets a page under **Forms** in the sidebar, for admins: its
submissions newest first, unread ones in bold, with the form's `columns`
(by default the first three fields). A submission's page shows every field
and has Reply (when it has an `email` field) and Delete. They are kept in a
`submission` table in the D1 database, after `auth.tablePrefix`, created on
first use, until an admin deletes them. In local mode (`astro dev` without
`VESTRY_MODE=auth`) the page has no database to read; in `astro dev` the
site's handler writes to Wrangler's local D1, not `.vestry/auth.sqlite`.

## Field types

`text`, `textarea`, `slug`, `number`, `boolean`, `date` (optional time),
`datetime` (optional `autoUpdate`), `select`, `multiselect`, `color`,
`image`, `file`, `reference`, `object`, `array`, `markdown`, `code`, `json`,
`crop`, `focalPoint`, `tree`.
Fields accept `label`, `description`, `required`, `sidebar`, `hidden`,
`readOnly` and `width` (`full` | `half` | `third`).

A collection's top-level field can be for some entries only: `entries`
lists their slugs, and the editor shows the field in those entries alone.

```ts
tagline: fields.textarea({ entries: ["index"] }), // the home page's
```

Elsewhere it is hidden and not required, as with `hidden: true`, and any
value it has stays in the file. The editor goes by the slug the entry will
be saved under, so renaming an entry to one of them shows the field. New
entries don't take its `default`, and saving another entry doesn't check
its value. A nested field, a singleton's or a component prop can't set
`entries`, and nor can a field every entry has: the title, the status
field, a date kept in the file name or an `autoUpdate` datetime.

`fields.array` takes the item field and then its options,
`fields.array(fields.text(), { addLabel: "Add tag" })`, or a single options
object like the other builders: `fields.array({ of: fields.text(), addLabel:
"Add tag" })`.

## MDX conversion

`vestrycms/mdx` exports the converter the editor uses: `parseMdx(source)`
turns MDX into a ProseMirror document and `serializeMdx(doc)` writes one back
out. Use it to produce files in exactly the form the control panel saves,
for example when migrating content from another CMS.

## Development

```sh
pnpm install
pnpm build       # src/ → dist/ (tsc, plus admin.astro, styles.css, env.d.ts)
pnpm typecheck
pnpm test
pnpm format:check
pnpm lint        # oxlint, with type-aware rules
pnpm fallow      # unused files, exports and dependencies; import cycles
pnpm test:coverage
pnpm health      # complexity, and CRAP scores from that coverage
```

The package is published as compiled JavaScript in `dist/`; `src/` is not
shipped. `scripts/build.mjs` runs `tsc -p tsconfig.build.json`, copies the
files tsc doesn't emit (pointing `admin.astro`'s client script at the
compiled UI), and fails if `src/integration/client-deps.ts` doesn't list
exactly the packages the control panel imports in the browser. The
integration pre-bundles those through Vite's optimizer: an installed Astro
integration is excluded from it, and dev would otherwise serve CommonJS
dependencies such as `react/jsx-runtime` raw.

`pnpm lint` runs [oxlint](https://oxc.rs/docs/guide/usage/linter) with
its type-aware rules, which CI enforces; `.oxlintrc.json` holds the rules and
why each one that is off is off. The type information comes from
[tsrs](https://github.com/oxc-project/tsrs), a Rust port of the TypeScript
compiler.

`pnpm fallow` runs [Fallow](https://fallow.tools/docs/)'s dead-code check,
which CI enforces; `.fallowrc.json` holds its exceptions.

`pnpm health` fails on any function over Fallow's complexity limits:
cyclomatic complexity 20, cognitive complexity 15, or a CRAP score
(complexity weighed against test coverage) of 30. The CRAP score needs the
coverage that `pnpm test:coverage` writes to `coverage/`. There is no
baseline: fix a finding by splitting the function (in the control panel,
usually into smaller components or hooks) or, for CRAP, by testing it.
`npx fallow dupes` reports duplication and is not enforced.

To work on Vestry against a site, run `pnpm dev` here (an initial build, then
`tsc --watch`) and link the package from the site:

```sh
pnpm link ../vestrycms
```

### Tests

Tests use [Vitest](https://vitest.dev). Files matching
`test/**/*.test.{ts,tsx}` run in CI; `pnpm typecheck` covers everything under
`test/`.

```sh
pnpm test                    # run the suite once
pnpm test:watch              # re-run on change
pnpm test mdx                # only files whose path matches "mdx"
pnpm test -u                 # update snapshots after an intended change
FC_RUNS=10000 pnpm test      # property tests with 10,000 cases each (default 200)
```

- `test/auth.test.ts`: sign-in, users and guards over HTTP (memory adapter).
- `test/shared-database.test.ts`: `auth.tablePrefix` keeping sites apart in one
  database (`node:sqlite`, real migrations).
- `test/github-source.test.ts`: commit sequencing against a fake Git Data API.
- `test/github-app.test.ts`: GitHub App JWT and installation token cache.
- `test/google-analytics.test.ts`: the Google Analytics provider against a fake
  Google (`test/google-fake.ts`: the token endpoint checks the service
  account's JWT; the Data API answers with canned numbers).
- `test/templates.test.ts`: `{field|filter}` placeholders in URL and slug
  templates.
- `test/config-validate.test.ts`: the mistakes the config check reports at
  startup.
- `test/filename-date.test.ts`: dates kept in the file name, renaming on
  save and the references a rename updates (local source, temporary
  directory).
- `test/mdx.test.ts`: MDX round trips. Each file in `test/fixtures/mdx` must
  survive parse → serialize byte for byte, so write fixtures in the
  serializer's canonical style (`_emphasis_`, `-` bullets, blank lines around
  component children). Prettier skips that directory. Record a known gap as
  an `it.fails` test and move it into the fixtures once fixed.
- `test/mdx.property.test.ts`: [fast-check](https://fast-check.dev) property
  tests. Generated editor documents must save and reload with every block,
  character and mark, and a saved file must save back unchanged. A failure
  prints a shrunk counterexample and a seed; cases marked `KNOWN` are
  upstream quirks the generators steer around.
- `test/core.property.test.ts`: paths, slugs, date prefixes, asset references
  and frontmatter read back what they write.
- `test/editor-schema.test.ts`: the same fixtures pass through the editor's
  Tiptap schema (`src/ui/components/editor/schema.ts`) without losing node
  types or attributes, so a page saved from the editor matches its source.
- `test/editor-commands.test.ts`: the editor's own commands (text styles,
  line breaks) on a headless Tiptap editor, checked through the MDX they
  save as.
- `test/format.test.ts`: saving keeps the body as written where Prettier
  would change the document.
- `test/paths.test.ts`: template placeholders and filters, and the config
  errors for them.
- `test/service.test.ts`: `ContentService` on the local source in a
  temporary directory (entries with nested slugs).
- `test/ui/*.test.tsx`: the control panel, rendered in jsdom with Testing
  Library. `test/ui/harness.tsx` opens it on a temporary project with `fetch`
  routed to the real API, so a test clicks through it and reads back the
  files it saved. `test/ui/*.test.ts` cover the panel's logic apart from
  React (the API client, crop geometry, tree moves, the entry editor's
  helpers).

The auth and GitHub source tests are ordered scenarios that build on shared
state, so filter them by file, not by test name (`-t`).

`test/manual` holds scripts that run outside the suite:

```sh
pnpm test:roundtrip path/to/file.mdx                       # round-trip a site's content through Prettier
GH_TOKEN=… node --import tsx/esm test/manual/github-read.ts path/to/site  # time the live read path
GH_TOKEN=… node --import tsx/esm test/manual/github-write.ts  # live commits on a throwaway branch
```

### Releasing

1. Bump `version` in `package.json`, add the release to `CHANGELOG.md` and
   commit.
2. Publish a GitHub release tagged `v<version>`. The **Publish** workflow
   checks the tag against `package.json`, runs the checks and stages the
   version on npm, with provenance, through npm trusted publishing.
3. Approve the staged version, which takes 2FA: on npmjs.com under
   **Staged Packages**, or with `npm stage list vestrycms` and
   `npm stage approve <stage-id>`. Until then it cannot be installed.
   `npm stage download <stage-id>` fetches the tarball to look at first.

The trusted publisher is set up on npmjs.com, in the package's settings: this
repository, workflow `publish.yml`, no environment, and direct `npm publish`
left off, so nothing reaches the registry without that approval. npm expires
a new trusted publisher that has not published within two days, and an
expired one has to be deleted and added again.

The first release has to be published by hand, since npm only offers trusted
publishing for a package that exists: `pnpm publish` (which builds first via
`prepack`).
