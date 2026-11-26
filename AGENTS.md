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
- `pnpm typecheck`, `pnpm test`, `pnpm format:check`, `pnpm lint`,
  `pnpm fallow`, `pnpm check:deps` – what CI (`.github/workflows/ci.yml`) runs, plus
  `pnpm build` and `npm pack --dry-run`. CI runs the tests as
  `pnpm test:coverage` and then `pnpm health`.
- `pnpm check:deps` (latest-or-bust, also in CI) fails if a dependency the
  branch adds or changes since `origin/master` isn't the newest release the
  7-day `minimumReleaseAge` allows. Add dependencies at their newest
  release; to hold one back on purpose, exempt it in `latest-or-bust.json`
  with the reason. latest-or-bust is our own package, so it's in
  `minimumReleaseAgeExclude` and Dependabot's cooldown `exclude`.
- `pnpm health` (Fallow's `health --complexity`, reading `coverage/` from
  `pnpm test:coverage`) fails on any function with cyclomatic complexity
  over 20, cognitive complexity over 15 (Fallow also counts JSX
  conditionals, many hooks and many props) or a CRAP score of 30 or more.
  There is no baseline: split the function (smaller components, a custom
  hook, a pure helper) or, for CRAP, test it.
- `pnpm lint` runs oxlint (`.oxlintrc.json`: the correctness rules plus the
  React hooks and promise rules) with type-aware rules on (`options.typeAware`).
  The type-aware backend is `tsrs`, pinned to an exact beta version; it is a
  drop-in for `oxlint-tsgolint` if it ever misbehaves. `pnpm lint --fix`
  applies the safe fixes. Disable a rule on one line with
  `// oxlint-disable-next-line <rule> -- why`, as in `Login.tsx`. `tsc` stays
  the type check (`pnpm typecheck`).
- `pnpm fallow` (Fallow's `dead-code`) fails on unused files, exports and
  dependencies, and on import cycles. Remove what is really unused, or record a
  deliberate exception in `.fallowrc.json` or with a
  `// fallow-ignore-next-line <rule>` comment that says why (see the
  recursive field rendering in `TreeInput.tsx`).
- `pnpm test` runs Vitest over `test/**/*.test.{ts,tsx}`; `pnpm test:watch`
  re-runs on change, `pnpm test -u` updates snapshots. `pnpm typecheck`
  covers everything under `test/`.
- `test/ui/*.test.tsx` (marked `// @vitest-environment jsdom`) render the
  control panel with Testing Library. `test/ui/harness.tsx` opens it on a
  temporary project with `fetch` routed to `createApi`'s handler, so a test
  clicks through the real API and reads back the files it saved; `signIn()`
  adds sign-in on Better Auth's memory adapter. jsdom loads no images and
  lays nothing out, so the image tool and tree tests stub `Image` and element
  sizes, and CodeMirror is mocked where a test types code.
  `virtual:vestry/formatter` resolves to `test/ui/formatter-stub.ts` and
  `virtual:vestry/logo` to `test/ui/logo-stub.ts` (no bundled logos, so the
  panel loads them through the API) (`vitest.config.ts`).
- `test/fixtures/mdx` files must round-trip byte for byte, so Prettier skips
  them; write them in the serializer's canonical style.
- The fixtures also pass through the editor schema
  (`test/editor-schema.test.ts`), and `test/editor-commands.test.ts` runs
  editor commands on a headless Tiptap editor (`element: null`; there is no
  DOM, so insert text with `tr.insertText`, not `insertContent`).
- `test/*.property.test.ts` are fast-check property tests: editor
  documents must save and reload unchanged, and the path, slug and
  frontmatter helpers must read back what they write. They run 200 cases
  each; `FC_RUNS=10000 pnpm test` searches harder. A failure prints a
  shrunk counterexample and a seed. Cases marked `KNOWN` are upstream
  quirks the generators steer around.
- `test/manual/*` are scripts outside the suite. `github-read.ts` (given a
  site checkout) and `github-write.ts` need `GH_TOKEN` (push access for the
  write test) and cannot run through the sandbox proxy.

## Conventions

- Only `dist/` is published. Exports: `.`, `./config`, `./core`, `./mdx`
  (the MDX ⇄ editor document converter, for migration scripts), `./forms`
  (`saveSubmission`, for a site's form handlers; it must not import Better
  Auth or anything else heavy), `./pages/admin.astro`, `./pages/api`. The integration injects its routes
  by package specifier (`vestrycms/pages/...`), so the package name and
  these exports must stay in step.
- Relative imports use `.js` extensions so tsc output runs as-is.
- When the control panel gains or drops a browser dependency, update
  `src/integration/client-deps.ts`; the build fails until it matches. The
  integration feeds that list to Vite's `optimizeDeps.include` as
  `vestrycms > dep`, because Astro excludes installed integrations from the
  optimizer and dev would otherwise serve CommonJS deps raw.
- An inline mark lives in three places that must agree: `MARK_TAGS` in
  `src/mdx/parse.ts` (element → mark), `MARK_TAGS`/`MARK_ORDER` in
  `src/mdx/serialize.ts` (mark → element, and the canonical nesting) and
  the Tiptap schema in `src/ui/components/editor/schema.ts`. Parsing never
  consults the site config (`textStyles` only drives the editor's menu and
  preview), so any file round-trips.
- A line that begins with a tag is a hazard: MDX reads a line of only tags
  as a block, and Prettier's MDX parser does so for any such line. The
  serializer writes `<br />` instead of a Markdown hard break before one,
  and `keepDocument` (`src/mdx/format.ts`) discards Prettier's body when
  it would parse differently.
- `zod` is a direct dependency only so declaration emit can name Better
  Auth's zod types (TS2883); keep its range in line with `better-auth`'s.
- Product-facing names stay "Vestry": the integration name, `virtual:vestry/*`
  modules, `VESTRY_*` variables and the `vestry` cookie prefix. Renaming any
  of these breaks existing sites.
- Releases: bump `version`, add the release to `CHANGELOG.md`, publish a
  GitHub release tagged `v<version>`;
  `.github/workflows/publish.yml` stages it on npm with provenance via npm
  trusted publishing (`npm stage publish`), and a maintainer approves the
  staged version with 2FA before it is live.
- `pnpm-workspace.yaml` holds pnpm settings (7-day `minimumReleaseAge`,
  `allowBuilds`); this is not a monorepo.

## Keep in sync

Update this file and `README.md` in the same change when commands, exports,
the build or the release process change.
