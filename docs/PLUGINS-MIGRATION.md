# Migrating an existing module to plugin form

This guide covers how to take a module that was installed by copying files into `src/` (the old `install.sh` pattern) and restructure it as a ClaudeClaw plugin.

## Overview

The old install pattern:
1. Copy `.ts` files into `src/`
2. `sed`-patch `bot.ts`, `config.ts`, `index.ts`, `db.ts`
3. Run `npm run build`

The new plugin pattern:
1. Put files in `plugins/<name>/`
2. Export a `register()` function that uses the seven extension points
3. Run `npm run build`

> Worked example: the `canvas` plugin (`plugins/canvas/`) is a full migration of a module that had 8 core touch-points and a separate HTTP server. Read it alongside this guide.

## Step-by-step migration

### 1. Create the plugin directory

```
plugins/
  my-module/
    plugin.ts           # new: plugin entry point
    my-feature.ts       # moved from src/my-feature.ts
    my-other-file.ts    # moved from src/my-other-file.ts
    web/                # if applicable
```

### 2. Write plugin.ts

Map each `sed` patch to the corresponding extension point:

| Old pattern (sed patch) | New pattern (extension point) |
|---|---|
| Add `bot.command(...)` to bot.ts | `ctx.bot.command(...)` in register() |
| Add `bot.callbackQuery(...)` to bot.ts | `ctx.bot.callbackQuery(...)` in register() |
| Add command to `OWN_COMMANDS` set | `ctx.registerOwnedCommands([...])` |
| Add entry to `builtInCommands` array | `ctx.registerTelegramCommands([...])` |
| Add env vars to `readEnvFile()` list | `ctx.registerEnvVars([...])` |
| Add `CREATE TABLE` to db.ts | `ctx.db.registerMigration({ id, sql })` |
| Add a response transform to bot.ts's `handleMessage` send path | `ctx.registerResponseMiddleware(fn)` |
| Add server startup to index.ts (guarded by `AGENT_ID === 'main'`) | Start server inside `register()` gated on `ctx.isMainProcess`; stop it in `shutdown()` |
| Add MCP config via jq to settings.json | `ctx.registerMcpServer({ ... })` |
| Add import to bot.ts | Import within your plugin files directly |
| Set a menu button after `setMyCommands` | `ctx.bot.api.setChatMenuButton(...)` in `register()` |

### 3. Update imports

Plugin files import from each other using relative paths within the plugin directory. For core ClaudeClaw utilities (logger, db, config), import from the compiled dist:

```typescript
// Within plugin files, import core utilities like this:
import { logger } from '../../dist/logger.js';
import { getDb } from '../../dist/db.js';
```

For type-only imports (erased at compile time):
```typescript
import type { ClaudeClawPlugin } from '../../src/plugin-context.js';
```

### 4. Handle database tables

If your module added `CREATE TABLE` statements to `createSchema()` in db.ts, convert them to plugin migrations:

```typescript
ctx.db.registerMigration({
  id: 'my-module-001-initial-schema',
  sql: `
    CREATE TABLE IF NOT EXISTS my_table (
      id INTEGER PRIMARY KEY,
      ...
    );
    CREATE INDEX IF NOT EXISTS idx_my_table_foo ON my_table(foo);
  `,
});
```

For existing installs where the tables already exist, `CREATE TABLE IF NOT EXISTS` ensures the migration is a no-op.

### 5. Remove the old install

After confirming the plugin works:
1. Delete the copied files from `src/` (e.g. `src/my-feature.ts`)
2. Revert the `sed` patches from `bot.ts`, `config.ts`, `index.ts`
3. Run `npm run build` to verify no broken imports

### 6. Update the module's repo

- Update `README.md` with the new install instructions (clone into `plugins/`)
- Keep `install.sh` as a legacy fallback but mark it deprecated
- Add a note pointing to `docs/PLUGINS.md` for the plugin architecture

## Shared code: what must stay in core

The hard rule of the plugin system: **core (always loaded) must never import from a plugin (optional, may be absent).** If any core module — or another module not yet migrated — depends on something in the module you're migrating, that shared piece **cannot** move into your plugin. Leave it in `src/` and have the plugin consume it from `dist/` like any other core utility.

This came up migrating Canvas: core Anki (`anki-pending.ts`) uses Canvas's content channel (`emitCanvasEvent`), its Playwright renderer (`renderHtmlToPng`), and `CANVAS_URL`. Those three stayed in core as shared infrastructure; only the Canvas *feature surface* (server, transform, middleware, command, menu button, web assets) became the plugin. They drop to plugin ownership later, when the last core dependent is itself migrated.

How to find the shared pieces before you move anything:

```bash
# Which non-module files import from the module you're migrating?
grep -rnE "from '\./(my-feature|my-other-file)" src --include='*.ts' | grep -vE "src/my-"
```

Anything that turns up is a shared dependency — keep it in core until its consumers migrate too.

> Why `dist/` and not `src/` for core imports (recap): the plugin runs from `plugins/<name>/`, where `src/*.js` does not exist (only `dist/*.js` is built). Importing from `dist/` also guarantees the plugin shares core's **module singletons** — e.g. the Canvas server must see pushes made through core's `emitCanvasEvent`; a second copy imported via a different path would have its own, empty channel registry.

## Compatibility notes

- The plugin system is purely additive. Old `src/`-based installs continue to work alongside plugins.
- You can migrate modules one at a time. Canvas and Anki can coexist as both old-style and plugin-style during the transition.
- Once migrated, upstream ClaudeClaw updates no longer risk breaking your module since you're not patching core files.
