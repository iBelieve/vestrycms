# Vestry CMS

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
  (`format: false` turns this off).

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
top bar, so a light or reverse variant works best.

### Sign-in and users

Sign-in runs on [Better Auth](https://www.better-auth.com) with its email OTP
and admin plugins. Editors sign in with a six-digit code emailed to them;
there are no passwords. `auth.admins` lists the addresses that are always
admins (they can sign in before anyone has invited them, which bootstraps the
user list). Admins invite everyone else from the **Users** page and choose a
role:

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
**Contents: read and write**. Commits are made by the app's bot, with the
editor credited as a co-author (`Co-authored-by: Name <email>`), so GitHub
shows both and the editor's account never needs push access.

| Variable                        | Purpose                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| `VESTRY_GITHUB_APP_ID`          | GitHub App id                                                                              |
| `VESTRY_GITHUB_INSTALLATION_ID` | The app's installation id on the repository                                                |
| `VESTRY_GITHUB_PRIVATE_KEY`     | The app's PEM private key (PKCS#1 as issued, PKCS#8, `\n`-escaped or base64 also accepted) |
| `VESTRY_RESEND_API_KEY`         | Resend API key (when `mail.provider` is `resend`)                                          |
| `VESTRY_SECRET`                 | Signs session cookies (`openssl rand -hex 32`); dev modes fall back to a fixed value       |
| `VESTRY_MODE`                   | `auth` or `github` to turn sign-in on in `astro dev`                                       |

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
├── integration/        Build-time index, formatter module, dev bridge, client deps
└── ui/                 React control panel (Tiptap, TanStack Query, react-router)
```

Routes injected into the site:

- `/admin/[...path]` – the control panel shell (on-demand, no auth needed to
  load the shell; data comes from the API).
- `/admin/api/[...path]` – JSON API. `config`, `status`, `collections/:key`,
  `collections/:key/entries/:slug`, `singletons/:key`, `assets/:container`,
  `file?path=`, `users` (admins), and `auth/*` (Better Auth's routes).

Virtual modules provided by the Vite plugin: `virtual:vestry/config`,
`virtual:vestry/runtime`, `virtual:vestry/index` (build-time frontmatter
index keyed by git blob SHA) and `virtual:vestry/formatter` (Prettier, when
installed).

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
  path).
- The body editor parses MDX into a ProseMirror document. JSX components
  become `mdxComponent` nodes with their attributes converted to JSON where
  they are literals (anything else is kept verbatim as an expression).
  Imports for known components are regenerated on save; other ESM is kept as
  a raw block.
- Saving composes the full file (YAML frontmatter + body) in the browser,
  formats it with Prettier when available, and sends it with the blob SHA
  the editor loaded. A changed SHA is reported as a conflict.
- Uploads chosen from an image/file field are committed together with the
  entry in one commit.

## URL and slug templates

`previewUrl` and `slug.template` fill `{field}` placeholders from the entry
(`{slug}` is always available in `previewUrl`). A placeholder can take a
filter, `{field|filter}`:

| Filter                 | Result                                     |
| ---------------------- | ------------------------------------------ |
| `year`, `month`, `day` | That part of a value starting `YYYY-MM-DD` |
| `nodate`               | The value without a leading `YYYY-MM-DD-`  |

So a collection whose files are named `2012-07-31-title.mdx` but whose pages
live at `/articles/2012/07/title` uses:

```ts
slug: { template: "{date}-{title}" },
previewUrl: "/articles/{slug|year}/{slug|month}/{slug|nodate}",
```

## Renaming entries and dates in file names

In a collection with one file per entry, the **Slug** box in the editor's
sidebar can be changed on an existing entry. Saving then moves the file: the
new file and the removal of the old one go in a single commit. Vestry refuses
a slug that another entry already has.

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
with it; add a redirect if the old address matters. On the site, read the
date from the entry id (`entry.id.slice(0, 10)`). One such field per
collection, at the top level of the schema, without `time`.

## Editor sections

By default the editor shows a "Details" card with every field, the content
editor, and a rail for fields marked `sidebar: true`. `sections` groups
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
not named by any section still fall into "Details" or the rail, and the
content editor renders after the sections unless `"body"` places it.

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

## Dashboard

Each collection gets a tile with its entry count. Collections whose `sort`
field is a date or datetime also get a "Recent …" list; set `recent: false`
to hide it, `recent: true` to show it for other collections, or a number to
change how many entries appear.

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

## Field types

`text`, `textarea`, `slug`, `number`, `boolean`, `date` (optional time),
`datetime` (optional `autoUpdate`), `select`, `multiselect`, `color`,
`image`, `file`, `reference`, `object`, `array`, `markdown`, `code`, `json`,
`crop`, `focalPoint`, `tree`.
Fields accept `label`, `description`, `required`, `sidebar`, `hidden`,
`readOnly` and `width` (`full` | `half` | `third`).

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
```

The package is published as compiled JavaScript in `dist/`; `src/` is not
shipped. `scripts/build.mjs` runs `tsc -p tsconfig.build.json`, copies the
files tsc doesn't emit (pointing `admin.astro`'s client script at the
compiled UI), and fails if `src/integration/client-deps.ts` doesn't list
exactly the packages the control panel imports in the browser. The
integration pre-bundles those through Vite's optimizer: an installed Astro
integration is excluded from it, and dev would otherwise serve CommonJS
dependencies such as `react/jsx-runtime` raw.

To work on Vestry against a site, run `pnpm dev` here (an initial build, then
`tsc --watch`) and link the package from the site:

```sh
pnpm link ../vestrycms
```

### Tests

Tests use [Vitest](https://vitest.dev). Files matching `test/**/*.test.ts`
run in CI; `pnpm typecheck` covers everything under `test/`.

```sh
pnpm test                    # run the suite once
pnpm test:watch              # re-run on change
pnpm test mdx                # only files whose path matches "mdx"
pnpm test -u                 # update snapshots after an intended change
```

- `test/auth.test.ts`: sign-in, users and guards over HTTP (memory adapter).
- `test/shared-database.test.ts`: `auth.tablePrefix` keeping sites apart in one
  database (`node:sqlite`, real migrations).
- `test/github-source.test.ts`: commit sequencing against a fake Git Data API.
- `test/github-app.test.ts`: GitHub App JWT and installation token cache.
- `test/templates.test.ts`: `{field|filter}` placeholders in URL and slug
  templates.
- `test/mdx.test.ts`: MDX round trips. Each file in `test/fixtures/mdx` must
  survive parse → serialize byte for byte, so write fixtures in the
  serializer's canonical style (`_emphasis_`, `-` bullets, blank lines around
  component children). Prettier skips that directory. Record a known gap as
  an `it.fails` test and move it into the fixtures once fixed.
- `test/editor-schema.test.ts`: the same fixtures pass through the editor's
  Tiptap schema (`src/ui/components/editor/schema.ts`) without losing node
  types or attributes, so a page saved from the editor matches its source.

The auth and GitHub source tests are ordered scenarios that build on shared
state, so filter them by file, not by test name (`-t`).

`test/manual` holds scripts that run outside the suite:

```sh
pnpm test:roundtrip path/to/file.mdx                       # round-trip a site's content through Prettier
GH_TOKEN=… node --import tsx/esm test/manual/github-read.ts path/to/site  # time the live read path
GH_TOKEN=… node --import tsx/esm test/manual/github-write.ts  # live commits on a throwaway branch
```

### Releasing

1. Bump `version` in `package.json` and commit.
2. Publish a GitHub release tagged `v<version>`. The **Publish** workflow
   checks the tag against `package.json`, runs the checks and publishes to
   npm with provenance through npm trusted publishing (configure it on
   npmjs.com for this repository and `publish.yml`).

The first release has to be published by hand, since npm only offers trusted
publishing for a package that exists: `pnpm publish` (which builds first via
`prepack`).
