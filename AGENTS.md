# AGENTS.md

Guidance for coding agents (Claude Code, OpenAI Codex, etc.) working in this
repository.

## Project

**Vestry** (Vestry CMS) is a git-backed CMS built as an Astro integration
(React control panel, Tiptap MDX editor, GitHub backend, Better Auth sign-in
over D1). The repository is `iBelieve/vestrycms`, and it is published to npm
as **`vestrycms`**; sites import `vestrycms` and `vestrycms/config`.
`README.md` documents the configuration, architecture and field types. It was
extracted from `iBelieve/mluther.org` (`packages/vestry`), which remains its
main consumer; keep it free of site-specific code.

## Commands

- `pnpm build` – `scripts/build.mjs`: `tsc -p tsconfig.build.json` into
  `dist/`, copy `pages/admin.astro` (client script rewritten to
  `../ui/main.js`), `ui/styles.css` and `env.d.ts`, then check
  `src/integration/client-deps.ts` against the compiled UI's bare imports.
- `pnpm dev` – build, then `tsc --watch` (for a site linked with
  `pnpm link`).
- `pnpm typecheck`, `pnpm test`, `pnpm format:check` – what CI
  (`.github/workflows/ci.yml`) runs, plus `pnpm build` and `npm pack --dry-run`.
- `test/github-read.ts` and `test/github-write.ts` need `GH_TOKEN` (push
  access for the write test) and cannot run through the sandbox proxy.

## Conventions

- Only `dist/` is published. Exports: `.`, `./config`, `./core`,
  `./pages/admin.astro`, `./pages/api`. The integration injects its routes
  by package specifier (`vestrycms/pages/...`), so the package name and
  these exports must stay in step.
- Relative imports use `.js` extensions so tsc output runs as-is.
- When the control panel gains or drops a browser dependency, update
  `src/integration/client-deps.ts`; the build fails until it matches. The
  integration feeds that list to Vite's `optimizeDeps.include` as
  `vestrycms > dep`, because Astro excludes installed integrations from the
  optimizer and dev would otherwise serve CommonJS deps raw.
- `zod` is a direct dependency only so declaration emit can name Better
  Auth's zod types (TS2883); keep its range in line with `better-auth`'s.
- Product-facing names stay "Vestry": the integration name, `virtual:vestry/*`
  modules, `VESTRY_*` variables and the `vestry` cookie prefix. Renaming any
  of these breaks existing sites.
- Releases: bump `version`, publish a GitHub release tagged `v<version>`;
  `.github/workflows/publish.yml` publishes with provenance via npm trusted
  publishing.
- `pnpm-workspace.yaml` holds pnpm settings (7-day `minimumReleaseAge`,
  `allowBuilds`); this is not a monorepo.

## Keep in sync

Update this file and `README.md` in the same change when commands, exports,
the build or the release process change.
