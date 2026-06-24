# example plugin

A no-op reference plugin that ships with the plugin loader. It does nothing
useful on its own — it exists to demonstrate, in one file, every extension
point a ClaudeClaw plugin can use. Copy it as a starting point for a real
plugin.

See [`docs/PLUGINS.md`](../../docs/PLUGINS.md) for the full authoring guide and
[`docs/PLUGINS-MIGRATION.md`](../../docs/PLUGINS-MIGRATION.md) for migrating an
existing `src/`-copied module to plugin form.

## What it does

`plugin.ts` exports a single `ClaudeClawPlugin` whose `register(ctx)` exercises
the six extension points:

1. **Bot command** — registers `/plugin_example`, which replies
   `Hello from the example plugin!`.
2. **Owned commands** — `ctx.registerOwnedCommands(['plugin_example'])` so the
   message router treats it as a bot command and does not forward it to Claude.
3. **Telegram command list** — contributes `plugin_example` to the
   `setMyCommands` autocomplete list.
4. **Env vars** — declares `EXAMPLE_PLUGIN_TOKEN` so it shows up in
   `readEnvFile()` output.
5. **DB migration** — registers `example-001-noop`, which creates the
   `example_plugin_noop` table (idempotent; tracked in `_plugin_migrations`).
6. **MCP server** — shown commented-out in `register()`. Uncomment the
   `ctx.registerMcpServer({...})` block to have `npm run setup:plugins` write an
   `example` MCP server into each tenant's `.claude/settings.json`.

## Build & load

The plugin is TypeScript. `npm run build` compiles it in place (via
`tsc -p tsconfig.plugins.json`) to `plugin.js`, which the loader discovers at
bot startup. The compiled `.js`/`.js.map` are build artifacts and are
gitignored — only `plugin.ts` is committed.

Verify it loaded: send `/plugin_example` to the bot and look for the
`[plugin] loaded example@0.1.0` line in the startup log.
