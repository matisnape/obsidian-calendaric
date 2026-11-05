# Calendaric

Calendaric is an Obsidian plugin that shows a month calendar in the sidebar and creates one note per day, week, month or year. It replaces the Calendar plugin, the Periodic Notes plugin and the core Daily Notes plugin with one plugin.

- **Status:** feature work is done. There is no published release yet, so you install it from source.
- **Platform:** desktop only, Obsidian 1.13.7 or later.

## Install

You need Node.js. The pinned version is in `mise.toml`.

1. Clone this repository.
2. Run `npm ci`. It also runs the build, so `main.js` exists afterwards.
3. Create `<your vault>/.obsidian/plugins/obsidian-calendaric/`.
4. Copy `main.js`, `manifest.json` and `styles.css` into it.
5. In Obsidian, switch on **Calendaric** under **Settings → Community plugins**.

The [user manual's quick start](docs/user-manual.md#quick-start) covers the first daily note, including the step for vaults where the core Daily Notes plugin is still on.

## Documentation

- [User manual](docs/user-manual.md): every feature, setting and command, with what you should see.
- [Format and template guide](docs/guide.md): format tokens, week rules and template variables. The settings screen links to it.
- [Code map](docs/code-map.md): what each module does, how a click becomes a file, and where each backlog epic lives.
- [API reference](http://anks.pl/obsidian-calendaric/): every module's functions, classes and types, generated from the doc comments by TypeDoc. See [Build the API docs](#build-the-api-docs).
- [Backlog](docs/backlog/README.md): the user stories and acceptance criteria. Run `python3 docs/backlog/report.py` for progress.

## Development

```bash
npm ci               # install and build
npm run build        # type-check, then bundle src/main.ts into main.js
npm run dev          # rebuild on every change
npm test             # vitest, once
npm run verify       # the release gates: typecheck, lint, test
npm run check:ac     # every passing acceptance criterion is backed by a test
npm run release-check  # manifest.json, versions.json and tag checks
npm run docs         # API reference into dist/docs/
```

To try a change, copy the fresh `main.js` into the vault's plugin folder and reload Obsidian.

### Build the API docs

1. Run `npm run docs`. TypeDoc reads the settings in `typedoc.json`.
2. Open `dist/docs/index.html` in a browser.

- The output folder is gitignored. Never commit it.
- Any TypeDoc warning fails the command, for example a `{@link}` to a name that does not exist.
- `.github/workflows/docs.yml` runs the same command on every push to `master` that changes the source or the docs config, and publishes the result to <http://anks.pl/obsidian-calendaric/> through GitHub Pages.

### Linting

- `npm run lint` runs eslint with the Obsidian plugin rules.
- The pull-request workflow (`.github/workflows/ci.yml`) runs install, test, build and `npm run check:ac` on every pull request, whatever its base branch. It does **not** run lint yet. The workflow was written while `master` still had lint errors, and its closing comment records that reason (decision DEC-26).
- `master` now lints with 0 errors. Warnings remain, and they do not fail `npm run lint`. Run it yourself before you open a pull request, and check that your change adds no error.
- The **release** workflow does run lint, through `npm run verify`. A lint error fails the release.

## Releasing

1. Update `minAppVersion` in `manifest.json` by hand if this release uses newer Obsidian APIs.
   See **Why `minAppVersion` is what it is** below before changing it.
2. Run `npm version patch` (or `minor`, or `major`). That bumps `package.json`, copies the
   version into `manifest.json`, adds the `"version": "minAppVersion"` row to `versions.json`,
   and creates a git tag. `.npmrc` sets `tag-version-prefix=""`, so the tag has no leading `v`.
3. Run `npm run release-check`. With no arguments it reads the tag pointing at `HEAD` — the
   one step 2 just created — and checks it against `manifest.json` and `versions.json`. If no
   tag points at `HEAD` it says so and checks only the manifest and `versions.json`.
   To check a different tag, the separator is required: `npm run release-check -- --tag 0.2.0`.
   Without `--`, npm consumes `--tag` as its own flag and the script never sees it.
4. Push the tag. `.github/workflows/release.yml` then runs the release checks, `npm run verify`
   and the build, and opens a **draft** GitHub release with `main.js`, `manifest.json` and
   `styles.css` attached.
5. Publish the draft yourself once you are happy with it.

Every one of those workflow steps can stop the release. A tag that does not match
`manifest.json`'s version, a `versions.json` row that disagrees with `minAppVersion`, a type
error, a lint error or a failing test all fail the run before anything is published.

### Why `minAppVersion` is what it is

`manifest.json` declares `minAppVersion: "1.13.7"`. That number is not arbitrary, and it is not
the default it looks like.

The value before it, `0.15.0`, was inherited from an old copy of the upstream sample plugin. It
was never chosen for this project, and it was false: the code already calls Obsidian APIs that
did not exist in 0.15.0. Two of them set the real floor, both found during earlier reviews:

| API | Needs | Verified against |
|---|---|---|
| `Workspace.revealLeaf` returning a promise you can await | **1.7.2** | `obsidian.d.ts` at `obsidianmd/obsidian-api` commit `6933c622` ("Update to v1.7.2") changes the signature to `revealLeaf(leaf: WorkspaceLeaf): Promise<void>`; at `9be65a7d` (v1.1.7) it still returns `void`. Found during the US-CMD-01 review. |
| `Plugin.registerHoverLinkSource` | **1.1.0** | Present in `obsidian.d.ts` at commit `32fe4c3f` ("Update to v1.1.0"); absent at `6b2138aa` (v0.16.0). Found during the US-CAL-03 review. |
| `Workspace.getLeaf("tab")` / `getLeaf("split")` | **0.16.0** | The `PaneType` overload arrives at commit `6b2138aa` ("Update for v0.16.0"); every release through `ff121cd4` (v0.15.9) declares only `getLeaf(newLeaf?: boolean, direction?: SplitDirection)`. |

`1.13.7` is the newest **public** Obsidian release, and it sits above all three requirements.
Checked against `obsidianmd/obsidian-releases`, `desktop-releases.json`, which is the release
channel the app itself reads: `latestVersion` is `1.13.7`, `beta.latestVersion` is `1.14.1`,
`minimumVersion` is `1.1.9`. The 1.14.x line is Catalyst early access, not a public release, so
it is deliberately not a target — naming it here would lock the plugin out of every
non-Catalyst install. No bump is pending. Read that JSON before raising this floor; the
changelog page and third-party summaries both lag it.

One thing this does **not** buy you: `node_modules/obsidian` ships the `1.10.3` type
definitions, which is below `1.13.7`. Type-checking therefore cannot catch a call that needs
`1.11` or newer. Raising `minAppVersion` is a promise about the user's app, not a compiler
setting.
