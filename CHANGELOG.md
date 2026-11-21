# Changelog

Notable changes to Vestry. Versions follow [semantic versioning](https://semver.org);
while Vestry is below 1.0, a minor version may change behaviour.

## Unreleased

### Added

- **Fields for some entries.** `entries: ["index"]` on a collection's
  top-level field shows it only in those entries' editors, such as fields
  for the home page alone. Other entries keep any value it has, and don't
  require it.
- **Google Analytics.** With `provider: "google-analytics"` and a
  `propertyId`, `analytics` reads a GA4 property through the Data API as a
  service account, with its JSON key in the
  `VESTRY_GOOGLE_ANALYTICS_CREDENTIALS` secret. The dashboard card and the
  Analytics page show the same numbers as with Plausible (visitors are
  GA4's active users, visits its sessions).
- **`dashboard: false`** on a collection leaves it off the dashboard: no
  tile, "Recent …" list or New button, and the dashboard request no
  longer lists it. It stays in the sidebar. For collections editors
  rarely open, such as categories, authors or generated entries. Asking
  such a collection for a recent list (`recent: true` or a count) is an
  error at startup.
- **Assets list and search.** The Assets page shows files as a list as well
  as tiles: each file's whole name with a preview, its type and size,
  sortable by any of them, and on phones as stacked rows. The choice is
  remembered for each asset folder; a folder that accepts only documents
  (say, `accept: ["pdf"]`) opens as a list. A search box finds files by
  name in the folder shown and every folder inside it, naming the folder
  each match sits in. The assets API takes `all=1` for that recursive
  listing.
- Hidden folders in an asset folder (`.cache`, say) no longer show up as
  folders, as hidden files already didn't.
- **More icons**: `book-down`, `book-marked`, `circle-question-mark`,
  `columns-4`, `diamond`, `download`, `feather`, `grid-3x3`, `library`,
  `list-indent-increase`, `music`, `notebook-pen`, `shopping-cart`,
  `square`, `sun`, `tags` and `text-align-center`. `book-marked` and
  `music` keep Lucide's older names; lucide.dev now lists them as
  `book-bookmark` and `eighth-notes`.

### Changed

- **Config admins are listed before they sign in.** Each address in
  `auth.admins` gets its account when an admin opens the Users page, as
  their first sign-in would, so they can be renamed or sent an invitation
  before then. Taking an address out of `auth.admins` afterwards leaves its
  account as an ordinary admin, to remove on the Users page. Entries that
  aren't addresses get no account.
- **Unknown icons are an error at startup** on collections, singletons,
  asset containers and components, as they already were on pinned entries,
  instead of quietly showing a file icon. The message lists the names the
  panel draws. Lucide's older names aren't in the set (except
  `triangle-alert`, `book-marked` and `music`): use
  `circle-question-mark` for `circle-help`, `text-align-center` for
  `align-center`, `text-align-start` for `align-left` or `text`, and
  `list-indent-increase` for `indent-increase`.
- **Phones and narrow screens.** Below 860 px the sidebar is a drawer,
  opened from a menu button in the top bar, instead of a block stacked
  above every page. The page itself scrolls under a sticky top bar (so
  phone browsers can tuck their address bar away), and on phones a link
  above the title leads back to the breadcrumb's page, such as an entry's
  collection, including one not in the sidebar.
- **Editing on a phone.** The editor's heading (back, title, View, Delete,
  Save) stays under the top bar on narrow screens, so Save is always in
  reach, and the body's toolbar is one row that scrolls sideways and
  sticks below it. Side-by-side fields take the full width on phones, the
  title wraps instead of running out of sight, and touch screens get 16px
  fields so iOS no longer zooms in on one.
- **Lists on a phone.** Entry and user lists show each row stacked (the
  title and its View link, then the other columns as short facts beneath,
  empty ones left out) instead of a table that scrolls sideways; the
  column headers become a row of sort buttons, and the search box takes
  the full width.
- On phones the dashboard's collection tiles sit two to a row, the asset
  grid and picker fit more images to a row, a tree field's item
  (a menu item's URL) goes under its label instead of cutting both short,
  and a card's note goes under its title. Touch-screen phones leave out
  the "Drop files here" box, keeping the Upload button (the picker lists
  the accepted file types instead).
- **The title is a field like the others.** It is labelled, the size of
  other fields (the page heading shows it large) and the first field of
  the fields card, which then needs no "Details" heading. When a section
  of the main column comes first, the title keeps a card of its own above
  it. A read-only entry's title shows as plain text, and the title takes
  its field's `readOnly`, `description`, `placeholder` and `maxLength`.
- **The page's address under the title.** With a `previewUrl`, the
  editor shows the entry's address on the site under its title, the way
  a permalink is shown, linked to the live page (a new entry's address
  shows, unlinked, as it will be).
- **The Slug box holds only the slug.** Where the date field sets the
  file name's date, the date is no longer shown, fixed, in front of the
  box (it repeated the Date field and took the box's width on phones).
  Under the box a note appears only when an edit (to the slug, the date or
  another field the `previewUrl` names) would move the page ("Moves to
  /articles/2026/11/title"), or rename the file without moving it. A new
  entry with no title box to show its address under names its file there.
- `recent` must be true, false or a number: anything else (a string in a
  `.js` config, say) is an error at startup instead of quietly falling
  back to the default.
- `importRsaPrivateKey` is no longer exported from `vestrycms/core`: the
  RS256 key handling moved to an internal module that the GitHub App and
  Google Analytics sign-ins share.

### Fixed

- The View button opens the page where it is, not where an unsaved
  edit to its slug or date would move it.
- View links put one slash between `siteUrl` and the `previewUrl`, so a
  `siteUrl` ending in `/` no longer gives `//` in the entry list's links.
- The editor no longer runs off the right edge of a narrow window when a
  body holds components (a 1fr column grew to its widest field).
- Choosing another period on the Analytics page keeps the page in place:
  the title, the period buttons and the last period's numbers (dimmed) stay
  on screen while the new numbers load.
- The line under an entry's title in lists reads as text: it starts after
  the headings (which ran into the first paragraph, "A New Translation The
  EHV proclaims…"), links keep their words but not their addresses, and
  images, code blocks, footnotes and the backslashes of hard line breaks
  are left out.
- A menu item's name stays whole beside a long link ("Donate
  https://www.paypal.com/…", not "Do…").
- A file field shows a file icon, not a picture's, beside a PDF or while
  empty.
- An `index` entry's View link opens its folder's page (`/`, or
  `/guides` for `guides/index`) instead of `/index`.

## 0.7.0

### Added

- **Analytics.** `analytics: { provider: "plausible", siteId, host? }`
  adds a visitors card to the dashboard and an Analytics page (totals
  compared with the period before, a chart, top pages, sources, countries
  and devices), read from Plausible's Stats API, including self-hosted
  Plausible, with the key in the `VESTRY_PLAUSIBLE_API_KEY` secret. Built
  so other providers can be added.
- **New entry from the dashboard.** The dashboard's top bar has a
  **New …** button for each collection with a "Recent …" list (not for
  `fixedEntries` or `readOnly` collections).
- A "Recent …" list for a collection not sorted by a date
  (`recent: true`) shows the first date field in its `columns`, and lists
  its newest entries by that date rather than the first in its sort.
- **Alt text and titles for images in the body.** Inserting an image into
  a body now asks for its alt text. Double-click an image in a body or
  Markdown field, or select it and press **Image details** in the
  toolbar, to edit its alt text and title later; they are written as
  `![alt](src "title")`.
  Dialogs are now labelled by their titles for screen readers, and Escape
  closes only the innermost one when one dialog opens from another.

### Changed

- **The dashboard loads with one request.** `GET /api/dashboard` returns
  every collection's entry and draft counts and its recent entries, in
  place of a full listing per collection (six requests on a site with six
  collections, each paying the sign-in check and, on a cold Worker, 50 ms
  or more of CPU). A collection that fails to list shows "Couldn't load"
  while the others load.
- Asset grid images (`file?path=…&v=<blob SHA>`) are cached by the browser
  as `private, immutable`, so reopening the assets page or picker no longer
  revalidates every image through the Worker.
- `MemoryCache` is bounded by approximate size as well as entry count (32
  MB by default, `new MemoryCache({ maxEntries, maxBytes })`; a bare number
  still sets `maxEntries`). Before, up to 2,000 cached files of up to 2 MB
  each could outgrow a Worker isolate's 128 MB.
- Concurrent requests share one GitHub fetch of the branch head and file
  tree instead of each making their own.
- Dependencies: better-auth 1.7.23 (its tables are unchanged, so existing
  databases need no migration). The other ranges are unchanged; this
  release is tested with Tiptap 3.34 and the other dependencies' latest
  minor and patch versions.

### Fixed

- **A URL is read as the public file it names.** A `/…` value of an image
  or file field outside the field's directory (`/images/x.png` on a
  `public/shots` field) was read as the file of that name inside the
  directory, so the preview showed another file and a save rewrote the
  reference to it. It now names `public/images/x.png`, and is written back
  as it was (a frontmatter field stored `relative` writes it as a relative
  path to that file). A `filename` field no longer writes a file outside
  its directory as a bare name, which named another file; a
  protocol-relative URL (`//cdn…`) is kept as a URL; and a field whose
  directory is `public` itself stores URLs by default, like its folders.

- **Moving an entry keeps its body's images.** Relative image references
  in the body (Markdown images, and components' image and file props) and
  in Markdown fields, and relative imports in an MDX body, were written
  for the folder the entry was in, so a save that moved the entry to
  another folder (a slug change in a `**` collection) left them pointing
  at the wrong place. The editor now writes them for the file it opened,
  and a save that moves the entry rewrites them for the new one; a body
  with nothing to move is saved as it was.

- **Text with the same marks saves back the same.** Two runs of text with
  the same marks (in a different order) were written as separate pieces,
  which could escape a character the file then lost on the next save
  (`\]\(` became `\](`). They are now written as one, and so are runs of a
  link whose attributes differ only where the file cannot tell (a
  `target`), runs that a mark the serializer doesn't write split in two,
  and runs around empty text, which also left an empty `****` behind.

- **Image props of components preview with any `storeAs`.** A component's
  image and file props were edited as the MDX stores them, so only a
  `repo` path previewed: with `filename`, `relative` or `public` the
  settings showed a broken image (and, for `relative`, so did the block's
  thumbnail), and a newly chosen file was written as a repository path
  whatever `storeAs` said. They now hold repository paths while the editor
  has the document, like frontmatter fields, and are written in their
  `storeAs` form. A prop nobody changed is written back as the file had
  it, so editing one part of a page does not rewrite the others' images;
  a site dropping a `storeAs: "repo"` workaround keeps its existing
  references in repository form until they are replaced.

- **Editor sidebar reaches its bottom.** The editor's sidebar is sized to
  the visible part of the panel as the page scrolls, so its last fields
  can be scrolled into view while the page heading is still showing.
  Scrolling past either end of the sidebar now carries on to the page
  (before, scrolling over the sidebar never moved the page), and in the
  one-column layout below 1100px the sidebar follows the main fields
  instead of scrolling inside its own box.

- Replacing a key in a full `MemoryCache` no longer evicts another entry.
- Labels set mid-sentence ("All FAQs", "Search FAQs…", "Create the first
  FAQ") keep their acronyms instead of becoming "faqs".
- **Phones.** The top bar's breadcrumbs no longer run under the site's
  logo: below 600px they are hidden (the sidebar above the page has the
  same links), and a logo too wide for the bar shrinks. Tables leave the
  title less room before scrolling, so the date beside it shows, and the
  dashboard's recent lists put each entry's date and status under its
  title instead of cutting them off.

## 0.6.0

### Added

- **Special pages first.** A collection's special entries are listed
  first, above a divider, whatever the sort or view. In a collection of a
  file per entry named by its slug (`*.mdx`, or `**.mdx` with folders),
  that is the home page, `index`, with a house icon, so a site's home page
  is at the top of Pages whatever its title, and in `src/pages/` also
  Astro's error pages, `404` and `500`. **`pinned`** on a collection names
  them instead, each a slug or `{ slug, icon }`
  (`pinned: [{ slug: "home", icon: "house" }]`), and `pinned: []` turns
  them off. A pinned entry's icon must be one the panel draws; any other
  name fails at startup. In a tree they leave their folder and show
  their slug, and one with entries under it also stays at the head of its
  folder.
- The `house`, `file-question-mark` and `triangle-alert` icons.
- **`readOnly: true`** on a collection makes it read-only in the control
  panel, for entries a script or another tool writes. Entries open with
  every field and the body read-only and a notice saying so, with no Save,
  New or Delete button, and the API refuses any save, creation, rename or
  deletion.

### Changed

- **`fixedEntries: true` replaces `editable: false`.** It does the same
  thing (entries can't be created, deleted or renamed, but their content
  can be edited), under a name that doesn't read as "read-only". A config
  that still sets `editable` fails at startup with a message saying what to
  use instead.

### Fixed

- `readOnly: true` on a `markdown` field now takes no typing and shows no
  toolbar, and on an `array` or `tree` field keeps its rows from being
  dragged.

## 0.5.0

### Added

- **`reservedSlugs`** on a collection names slugs the site depends on, such
  as `["index", "404"]` for pages at fixed routes, or the names of its other
  routes. An entry at one can't be renamed or deleted, and no other entry
  can be created at or renamed to one, or, in a collection with folders, to
  a slug under one (`sermons/index` under `sermons`), in any letter case.
- **Build status in the top bar.** After a save, the panel shows whether
  it is publishing, live, or failed to build, and lists recent saves with
  their builds and which one is on the site. It reads the check runs
  Cloudflare Workers Builds and Pages post on each commit, so it survives a
  reload and handles several saves in quick succession. The GitHub App needs
  the **Checks: read-only** permission; `deploys` in the config picks the
  check (`{ check: "Workers Builds: website" }`) or turns it off (`false`).

### Changed

- **`editable: false` replaces `create: false` and `delete: false`,** and
  stops renames too. Since 0.3 the Slug box renamed entries even in a
  collection that didn't allow creating or deleting them, which could move
  a site's home or 404 page off its route. In a collection that isn't
  editable, the Slug box is read-only, there is no New or Delete button, and
  the API refuses a new entry, a rename or a deletion, including a save to
  a slug that has no entry yet. (The API used to accept a new entry; only
  the panel hid the button.) A config that still sets `create` or `delete`
  fails at startup with a message saying what to use instead.
- **Deleting an entry that others refer to asks first,** naming them (as a
  rename already did). `delete: false` was the way to protect such entries;
  the warning replaces it.
- **Entries without a sort value come last,** and entries with the same
  value go by title. A collection sorted by `order` used to list the entries
  without one first, ties in slug order. Clicking a column header sorts the
  same way, and now compares numbers as numbers (`9` before `10`).

### Fixed

- **Scrolling inside a long menu no longer closes it.** A menu closes when
  the page scrolls, so that it doesn't float away from its button, but
  scrolling the menu itself closed it too, so the end of a long Insert menu
  (a site with many components) couldn't be reached. Scrolling past a
  menu's end no longer scrolls the page behind it either.

## 0.4.0

### Added

- **Entry lists can show a tree.** A collection kept in nested folders can
  set `tree: true` (a Tree/List toggle, opening on the tree) or
  `tree: "only"` to nest its entries by folder, with collapsible rows and
  each child's title shortened by what it repeats from its parent's.

### Changed

- **A date or datetime field's `default` is `"now"` or nothing.** The type
  used to accept any string, which hid `"now"` from editor autocomplete;
  a fixed date was never a useful default. Any other value is now an error
  when the integration loads, instead of being ignored.
- **Vestry has a logo.** The control panel's top bar shows it when the site
  sets no `logo`, the browser tab uses it as the favicon, and the README
  carries it. `assets/` holds the light (`logo.svg`, brown-grey `#2d2622`
  with an orange `#ff791b` sparkle), dark-background (`logo-reverse.svg`)
  and square (`icon.svg`) versions.
- **The panel takes its colours from the logo.** The top bar, the tile
  behind the site logo on the sign-in page, and toasts move from navy slate
  (`#0f172a` and `#1e293b`) to a warm brown-grey on the sparkle's hue
  (`#2d2622`), and the page backgrounds and hover greys warm to match.
  Buttons, links, the selected sidebar item, the active editor tools, focus
  rings and the invitation email's button turn from blue to burnt orange
  (`#c2410c`, the logo's orange darkened until white text on it passes WCAG
  AA). Info alerts stay blue. Drafts, warnings and raw MDX blocks move from
  amber to a yellower gold (`#a16207`) so they don't read as actions; draft
  text contrast rises from 3.1:1 to 4.8:1.

### Fixed

- **Menus use the control panel's font.** Row and account menus (and the
  preview dragged in a list or tree) render outside the panel's root, so
  they fell back to the browser's serif font. They now share its base
  styles.
- **Entry lists keep their titles readable.** Naming the title field in a
  collection's `columns` now places the title column (labelled as that
  column or field is) instead of adding a second copy of the title, which
  took most of the width and squeezed the real title to a word per line.
  The same goes for a collection without `columns` sorted by its title
  field (its list showed the title, then the same name again).
  The title column also keeps at least 260px, scrolling the table sideways
  when needed, and other columns cut a long value short instead of
  crowding it. In a collection whose `titleField` is not `title`, a column
  for a field named `title` now sorts by its own value, not the title's.
- **List columns show what a list holds.** A list of references shows the
  titles it refers to and a list of values shows the values, instead of
  "1 items": option labels, formatted dates, Yes or No, and file names. A
  `multiselect` column shows its option labels, and a list of objects
  counts them in proper English.
- **Sorting a collection by its Status column works.** It sorted by a
  `status` value the entries don't have, so the order never changed.
- **Uploading the same file again after a failed upload works.** The
  upload buttons now clear their file choice, and an empty choice is
  ignored instead of reporting a rejected file type or uploading nothing.
- **"Copy path" says when copying fails** instead of claiming the path was
  copied.
- **The asset picker keeps showing its files when a refresh fails**, with
  the error above them.
- **A crop or focal point shows the image it was given.** Switching images
  quickly could let the previous image finish loading last and set the
  editor's size from it.
- **The logo shows before the GitHub App is set up.** A logo kept in the
  repository is now bundled into the build instead of fetched from GitHub,
  so the sign-in page no longer shows a broken image while the
  `VESTRY_GITHUB_*` variables are missing. It also loads without a request
  to the worker.
- **Two crops seeding at once both keep their crop.** When an entry with two
  crop fields opened on an image neither had cropped yet, only the second
  default survived. Fields now change the form's values as they stand, so
  changes made at the same moment no longer overwrite each other.
- **Edits made while a new or renamed entry saves are kept.** The editor at
  the entry's new address opens with them (slug box included), marked
  unsaved, as an existing entry's editor already did.
- **Renaming a list entry updates the entries that refer to it.** Changing
  the id of an entry in a collection kept as one file now asks first, like a
  file rename, and repoints references in the same list and in other files
  in the same commit. References to a number id (`id: 1`) are found too,
  and a number id and its references stay numbers.
- **A list entry whose id has a space, `?` or `#` opens.** Links to it now
  encode the id, which used to end the address early.
- **"Now" is the editor's own date and time.** A date field defaulting to
  `"now"` gave UTC's date, which in the Americas is already tomorrow by the
  evening, and a wall-clock datetime gave UTC's time. Auto-updated
  wall-clock times keep the time the editor stamped rather than the
  server's UTC one, if it is within a time zone of the server's clock. A
  datetime field without `storage` now defaults to wall-clock time, which is
  what its input always wrote.

## 0.3.1

### Changed

- **Error screens are a designed card.** When the control panel can't load its
  configuration, it shows a centered card with an explanation, the error's
  details (codes split out, links clickable, a copy button) and a Try again
  button, instead of a bare alert in the corner. Entries and globals that fail
  to load use the same card with a retry, and unknown collections, globals,
  asset folders and deleted entries get a "not found" card with a way back to
  the dashboard.
- **A failed background reload keeps the open entry.** Before, it replaced the
  editor, and any unsaved edits, with an error.
- **Links in error messages are clickable** in alerts across the panel.

## 0.3.0

### Changed

- **The Slug box can be edited on existing entries.** In collections with one
  file per entry, changing it and saving renames the file. Before, the slug
  was fixed once an entry was created.
- **Plain-text web addresses stay plain text.** The parser no longer turns an
  escaped address (`www\.example.com`) into a link, which used to rewrite it
  as a link the first time the entry was saved.
- **Prettier can no longer damage MDX.** Prettier's MDX formatter reflows a
  paragraph that begins with a tag, which turns Markdown line breaks into
  stray backslashes. If formatting would change what a document says, the
  body is saved as the editor wrote it.
- **Entry lists carry less.** Lists and the build-time index hold only the
  fields a list can show (plus references), so collections of large data
  files no longer inflate the server bundle.
- **Config mistakes are errors at startup.** An unknown filter in a URL or
  slug template, or `storeIn: "filename"` where it cannot work, now stops the
  integration with a message instead of being ignored.

### Added

- **Renaming entries.** Saving an entry under a different slug writes the
  new file and removes the old one in one commit. Entries and singletons
  whose `reference` fields point at the renamed entry are updated in the
  same commit, after the editor lists them for confirmation. A slug that
  another entry has is refused, and the slug is checked as it is typed.
- **Dates in file names.** `fields.date({ storeIn: "filename" })` keeps a
  date as the `YYYY-MM-DD-` prefix of the entry's file name instead of in
  frontmatter. Changing the date renames the file.
- **Template filters.** `previewUrl`, `slug.template` and `commitMessage`
  placeholders accept `{field|year}`, `{field|month}`, `{field|day}` and
  `{field|nodate}`. A slug template may contain `/` for collections with a
  `**` path.
- **Underline, small text and text styles.** The editor has underline and
  small-text buttons and, when the config lists `textStyles`, a Styles menu.
  They are written as `<u>`, `<small>` and `<span class="…">` in MDX, and
  any such tags in existing files are edited as formatting rather than as
  inline components.
- **Line breaks where Markdown has none.** `<br />` is read as a line break,
  and breaks in table cells and headings, at the end of a paragraph or
  before a tag are written as `<br />` instead of being lost.
- **`format: false`** turns off formatting with the project's Prettier on
  save, and files matched by `.prettierignore` are saved as written.
- **`vestrycms/mdx`** exports the Markdown/MDX converter the editor uses
  (`parseMdx`, `serializeMdx`).
- **`fields.array({ of, … })`** is accepted alongside `fields.array(of, …)`.
- The prompt before leaving a page with unsaved changes also covers a
  pending rename.

## 0.2.0

- `auth.tablePrefix` lets several sites share one D1 database.
- Fixes for content lost in the Markdown/MDX round trip, and the editor
  schema to match.
- Tests moved to Vitest, with round-trip fixtures.

## 0.1.0

- First release, extracted from mluther.org.
