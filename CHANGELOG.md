# Changelog

Notable changes to Vestry. Versions follow [semantic versioning](https://semver.org);
while Vestry is below 1.0, a minor version may change behaviour.

## 0.3.0

### Changed

- **The Slug box can be edited on existing entries.** In collections with one
  file per entry, changing it and saving renames the file. Before, the slug
  was fixed once an entry was created.
- **Plain-text web addresses stay plain text.** The parser no longer turns an
  escaped address (`www\.example.com`) into a link, which used to rewrite it
  as a link the first time the entry was saved.
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
- **Template filters.** `previewUrl` and `slug.template` placeholders accept
  `{field|year}`, `{field|month}`, `{field|day}` and `{field|nodate}`.
- **`format: false`** turns off formatting with the project's Prettier on
  save.
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
