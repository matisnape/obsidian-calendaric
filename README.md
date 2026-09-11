# Obsidian Sample Plugin

This is a sample plugin for Obsidian (https://obsidian.md).

This project uses TypeScript to provide type checking and documentation.
The repo depends on the latest plugin API (obsidian.d.ts) in TypeScript Definition format, which contains TSDoc comments describing what it does.

This sample plugin demonstrates some of the basic functionality the plugin API can do.
- Adds a ribbon icon, which shows a Notice when clicked.
- Adds a command "Open modal (simple)" which opens a Modal.
- Adds a plugin setting tab to the settings page.
- Registers a global click event and output 'click' to the console.
- Registers a global interval which logs 'setInterval' to the console.

## First time developing plugins?

Quick starting guide for new plugin devs:

- Check if [someone already developed a plugin for what you want](https://obsidian.md/plugins)! There might be an existing plugin similar enough that you can partner up with.
- Make a copy of this repo as a template with the "Use this template" button (login to GitHub if you don't see it).
- Clone your repo to a local development folder. For convenience, you can place this folder in your `.obsidian/plugins/your-plugin-name` folder.
- Install NodeJS, then run `npm i` in the command line under your repo folder.
- Run `npm run dev` to compile your plugin from `main.ts` to `main.js`.
- Make changes to `main.ts` (or create new `.ts` files). Those changes should be automatically compiled into `main.js`.
- Reload Obsidian to load the new version of your plugin.
- Enable plugin in settings window.
- For updates to the Obsidian API run `npm update` in the command line under your repo folder.

## Releasing new releases

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

`1.13.7` is the Obsidian version the maintainer actually runs, verified on her machine, and it
sits above all three requirements. The newest Obsidian at the time of writing is `1.14.1`; a
bump is expected once she updates.

One thing this does **not** buy you: `node_modules/obsidian` ships the `1.10.3` type
definitions, which is below `1.13.7`. Type-checking therefore cannot catch a call that needs
`1.11` or newer. Raising `minAppVersion` is a promise about the user's app, not a compiler
setting.

## Adding your plugin to the community plugin list

- Check the [plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines).
- Publish an initial version.
- Make sure you have a `README.md` file in the root of your repo.
- Make a pull request at https://github.com/obsidianmd/obsidian-releases to add your plugin.

## How to use

Node is pinned to the version in `mise.toml`. With only that installed, a clean checkout needs
exactly two commands:

```bash
npm ci          # also runs `prepare`, which builds — so main.js exists after this alone
npm run build   # tsc --noEmit, then esbuild
```

Both produce `main.js` at the repository root, next to the `manifest.json` and `styles.css`
that are checked in. Those three files are the release artefacts; nothing else is needed and
no manual step follows.

For day-to-day work:

- `npm run dev` — esbuild in watch mode.
- `npm run verify` — the three release gates: `typecheck`, `lint`, `test`. Reports every gate's
  verdict and fails if any one of them fails or cannot run.
- `npm run release-check` — the static manifest, `versions.json` and tag checks.

## Manually installing the plugin

- Copy over `main.js`, `styles.css`, `manifest.json` to your vault `VaultFolder/.obsidian/plugins/your-plugin-id/`.

## Improve code quality with eslint
- [ESLint](https://eslint.org/) is a tool that analyzes your code to quickly find problems. You can run ESLint against your plugin to find common bugs and ways to improve your code. 
- This project already has eslint preconfigured, you can invoke a check by running`npm run lint`
- Together with a custom eslint [plugin](https://github.com/obsidianmd/eslint-plugin) for Obsidan specific code guidelines.
- A GitHub action runs install, test and build on every pull request against `master`.
- That action does **not** run lint. eslint currently reports errors that already exist on `master`, so a lint gate would fail every pull request whatever it changed. Run `npm run lint` yourself and check that your own change adds no new errors.
- The **release** workflow does run lint, through `npm run verify`. Until the existing errors on `master` are cleaned up, a tagged release will fail at the lint gate. That is deliberate: `master`'s lint debt is allowed to block a release, it is not allowed to be hidden.

## Funding URL

You can include funding URLs where people who use your plugin can financially support it.

The simple way is to set the `fundingUrl` field to your link in your `manifest.json` file:

```json
{
    "fundingUrl": "https://buymeacoffee.com"
}
```

If you have multiple URLs, you can also do:

```json
{
    "fundingUrl": {
        "Buy Me a Coffee": "https://buymeacoffee.com",
        "GitHub Sponsor": "https://github.com/sponsors",
        "Patreon": "https://www.patreon.com/"
    }
}
```

## API Documentation

See https://docs.obsidian.md
