# Changelog

Notable changes to Vestry. Versions follow [semantic versioning](https://semver.org);
while Vestry is below 1.0, a minor version may change behaviour.

## Unreleased

### Changed

- **A date or datetime field's `default` is `"now"` or nothing.** The type
  used to accept any string, which hid `"now"` from editor autocomplete;
  a fixed date was never a useful default.

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
- **Copying a file's path says so only when it worked.** The Assets page
  reported "Path copied" even when the browser refused clipboard access; it
  now shows an error instead.
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
