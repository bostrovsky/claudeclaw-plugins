# ClaudeClaw Plugin System

Plugins extend ClaudeClaw without modifying core files. Each plugin lives in `plugins/<name>/` and registers itself through seven extension points at bot startup.

## Quick start

1. Create `plugins/my-plugin/plugin.ts`
2. Export a default `ClaudeClawPlugin` object
3. Run `npm run build` (compiles plugins alongside core)
4. Restart the bot

## Plugin structure

```
plugins/
  my-plugin/
    plugin.ts          # Required: default export implements ClaudeClawPlugin
    web/               # Optional: static assets
    adapters/          # Optional: internal organization
    models/            # Optional: data files
```

## The ClaudeClawPlugin interface

```typescript
import type { ClaudeClawPlugin } from '../../src/plugin-context.js';

const plugin: ClaudeClawPlugin = {
  name: 'my-plugin',        // unique, matches directory name
  version: '1.0.0',         // semver, informational
  description: 'What it does', // shown in startup log

  register(ctx) {
    // Use ctx to register commands, migrations, env vars, etc.
  },

  shutdown() {
    // Optional: cleanup on bot shutdown (5s timeout)
  },
};

export default plugin;
```

## Seven extension points

### 1. Bot commands and callbacks

Register grammy handlers directly on the bot instance:

```typescript
ctx.bot.command('mycommand', async (botCtx) => {
  await botCtx.reply('Hello!');
});

ctx.bot.callbackQuery(/^my-prefix:/, async (botCtx) => {
  await botCtx.answerCallbackQuery({ text: 'Got it' });
});
```

### 2. Owned commands

Prevent slash commands from being routed to Claude (the AI agent):

```typescript
ctx.registerOwnedCommands(['mycommand', 'othercommand']);
```

Commands are auto-prefixed with `/` if missing.

### 3. Telegram command list

Add entries to the bot's `/setMyCommands` menu:

```typescript
ctx.registerTelegramCommands([
  { command: 'mycommand', description: 'Does the thing' },
]);
```

Commands are aggregated as: built-in first, then plugins, then skills. Telegram caps at 100 total. If the total exceeds 100, skill commands are truncated first.

### 4. Database migrations

Register SQL migrations that run idempotently at startup:

```typescript
ctx.db.registerMigration({
  id: 'my-plugin-001-create-table',
  sql: `CREATE TABLE IF NOT EXISTS my_plugin_data (
    id INTEGER PRIMARY KEY,
    value TEXT NOT NULL
  )`,
});
```

Rules:
- IDs must be unique across all plugins. Convention: `<plugin>-<NNN>-<short-desc>`
- Migrations are tracked in `_plugin_migrations` table. Re-running is a no-op.
- Never edit a released migration. Add a new one instead.
- Use `IF NOT EXISTS` / `IF EXISTS` in your SQL for safety.
- Migrations run before `register()` returns, so you can query your tables immediately.

### 5. Environment variables

Declare env vars your plugin reads from the tenant `.env`:

```typescript
ctx.registerEnvVars(['MY_PLUGIN_API_KEY', 'MY_PLUGIN_PORT']);
```

This extends the env-var registry so the system knows about your variables.

### 6. MCP server declaration

Declare MCP servers for tenant `settings.json`:

```typescript
ctx.registerMcpServer({
  name: 'my-plugin',
  command: 'node',
  args: ['dist/plugins/my-plugin/my-mcp.js'],
  env: {
    CLAUDECLAW_DATA_DIR: '${TENANT_DIR}',
    CLAUDECLAW_AGENT_ID: '${TENANT_ID}',
  },
});
```

After adding MCP declarations, run `npm run setup:plugins` to merge them into each tenant's `settings.json`. Interpolation variables:
- `${TENANT_DIR}` -- absolute path to the tenant directory
- `${TENANT_ID}` -- tenant name (e.g. `brian`, `jodie`)

### 7. Response middleware

Transform the bot's outgoing response before it's sent to Telegram. Each registered middleware receives the (possibly already-transformed) text plus the grammy context, performs any side effects (e.g. sending a photo), and returns the text that should still be sent. Return `''` to send nothing; return the input unchanged to pass through. Middlewares run in registration order.

```typescript
ctx.registerResponseMiddleware(async (text, botCtx) => {
  // e.g. detect structured content, render it to an image, send a photo,
  // and return the plain-text remainder for Telegram:
  if (!hasStructuredContent(text)) return text;
  await botCtx.replyWithPhoto(/* ... */);
  return stripStructuredContent(text);
});
```

This is the hook the `canvas` plugin uses to render `[CANVAS:...]` markers. With no middleware registered, the response is sent unchanged.

## Context properties

Besides the registration methods above, `ctx` carries:

- **`ctx.bot`** -- the grammy `Bot` instance (see extension point 1).
- **`ctx.isMainProcess`** -- `true` only in the main agent process. `register()` runs in *every* agent process (main + each sub-agent), so a plugin that owns a singleton resource (a background HTTP server, a shared port) must gate startup on this, or it boots once per process and fights over the port:

  ```typescript
  register(ctx) {
    if (ctx.isMainProcess) {
      this.server = startMyServer();   // main only
    }
  },
  shutdown() {
    this.server?.stop();
  },
  ```

## Loading behavior

- Plugins are discovered from `plugins/*/plugin.js` (compiled) at startup
- Loaded in alphabetical order of directory name
- If a plugin fails to load (import error, missing fields, `register` throws), it's logged and skipped. Other plugins still load. The bot does not crash.
- Plugins run in the bot process with full access. Only install plugins you trust.
- Restart required to add/remove plugins (no hot reload).

## Building

Plugins compile as part of `npm run build`. The build runs `tsc -p tsconfig.plugins.json` which compiles `plugins/**/*.ts` and outputs `.js` files alongside the source.

## Install flow for external plugins

```bash
cd /path/to/claudeclaw-os
git clone https://github.com/someone/claudeclaw-my-plugin.git plugins/my-plugin
npm run build
npm run setup:plugins   # if the plugin declares MCP servers
# restart the bot
```

No `sed` patches. No `install.sh`. No core file modifications.

## Reference

- `plugins/example/plugin.ts` -- minimal no-op example exercising the core extension points (commands, owned commands, Telegram list, migration, env vars).
- `plugins/canvas/plugin.ts` -- a real plugin that additionally uses response middleware, `ctx.isMainProcess` (to gate its HTTP server to the main process), a `web/` asset dir, and a `shutdown()` hook.
