# claudeclaw-plugins

A small **plugin loader for [ClaudeClaw OS](https://github.com/earlyaidopters/claudeclaw-os)** so extensions (Canvas, Anki, anything) install by dropping a folder into `plugins/` instead of copying files into `src/` and `sed`-patching core. Core upgrades stop clobbering extensions, because extensions no longer touch core.

This exists because of a real maintenance trap: every extension that installs by patching `bot.ts`/`config.ts`/`index.ts` breaks silently when an upstream line moves. The fix is to patch core **once** — add a loader — and then have every extension register through stable APIs.

## Two ways to use it

**A. Integrate into core (recommended).** The loader is ~11 small, additive edits across `bot.ts`, `db.ts`, `index.ts`, and `package.json`, plus a few new files. A maintainer can fold these into ClaudeClaw directly; then every install ships with plugin support and nothing is ever patched again. See [What it changes](#what-it-changes) — it's designed to be trivial to adopt.

**B. Self-install (works today, no maintainer needed).**

```bash
cd /path/to/claudeclaw-os
git clone https://github.com/bostrovsky/claudeclaw-plugins.git
bash claudeclaw-plugins/install.sh
# restart your bot
```

Honest tradeoff: the self-installer still patches core **once** (to add the loader). So it doesn't make core-patching disappear — it collapses it from *N patch-sets, one per extension* down to *one, for the loader*. After that, every plugin is a clean drop-in that touches core zero times. Only path A is fully patch-free; path B is the stopgap until then.

The installer is **idempotent** (safe to re-run), **reversible** (`bash claudeclaw-plugins/uninstall.sh` restores core byte-for-byte), and **fails loud** — if an upstream anchor has moved it aborts without writing, instead of silently corrupting a file like the old `sed` installers.

## Once installed

Extensions become drop-in plugins:

```bash
git clone https://github.com/you/some-claudeclaw-plugin.git plugins/some-plugin
npm run build && # restart
```

Write your own — see **[docs/PLUGINS.md](docs/PLUGINS.md)**. Convert an existing `src/`-copied module — see **[docs/PLUGINS-MIGRATION.md](docs/PLUGINS-MIGRATION.md)**. A working reference plugin ships in `loader/plugins/example/` (and is installed to `plugins/example/`).

### The seven extension points

Bot commands/callbacks · owned commands (don't route to Claude) · Telegram command list · DB migrations (idempotent, tracked in `_plugin_migrations`) · env vars · MCP servers (merged into tenant `settings.json` by `npm run setup:plugins`) · **response middleware** (transform outgoing messages — e.g. render `[CANVAS:…]` markers). Plus `ctx.isMainProcess` so a plugin can gate a singleton (a background server) to the main process.

## What it changes

The installer (`loader/tools/apply-hooks.mjs`) makes exactly these additive edits — all behavior-preserving until a plugin is present (with no `plugins/` dir the loader logs "no plugins" and returns, the middleware loop is empty, the command aggregators add nothing):

| File | Edit |
|---|---|
| `src/bot.ts` | import the loader; `createBot` becomes `async`; `await loadPlugins(bot, isMain)` before `setMyCommands`; aggregate plugin commands into `setMyCommands` + `OWN_COMMANDS`; run `getResponseMiddleware()` in the send path |
| `src/db.ts` | export `getDb()` (hands the loader the tenant DB for `_plugin_migrations`) |
| `src/index.ts` | `await createBot()`; `await shutdownPlugins()` on shutdown |
| `package.json` | add `tsc -p tsconfig.plugins.json` to `build`; add `setup:plugins` script |
| new files | `src/plugin-loader.ts`, `src/plugin-context.ts`, `src/cli/setup-plugins.ts`, `tsconfig.plugins.json`, `plugins/example/`, `docs/PLUGINS*.md` |

No `config.ts` edit — the loader keeps its env-var registry internal.

## Optional: the rendering add-on

Some plugins turn structured content into a **styled PNG** instead of plain text (Canvas renders agent replies; Anki renders flashcard previews). That's shared platform infrastructure, not part of any one plugin, so it installs separately:

```bash
bash claudeclaw-plugins/install-rendering.sh
```

It copies `html-render.ts` (HTML→PNG) and `content-channel.ts` (the Telegram Mini App content channel) into core, so every rendering plugin shares one engine — no plugin bundles its own, none depends on another for it. It's a separate step because the renderer pulls in **Playwright** (~300MB Chromium); the base loader stays dependency-light, and only installs that actually render take on the browser. Plugins treat it as a soft dependency (render when present, fall back to text when not). See **[docs/RENDERING.md](docs/RENDERING.md)** for why Playwright and how it's used.

## Validated against vanilla

Tested against upstream `claudeclaw-os` (`9f15b5d`): all hooks apply, the patched core typechecks, plugins compile, the install is idempotent, and uninstall restores `bot.ts`/`db.ts`/`index.ts`/`package.json` identical to vanilla.

## Status

v0. Built to be evaluated for upstream adoption. Feedback and a maintainer's "I'll bake this into core" both welcome — that's the goal.
