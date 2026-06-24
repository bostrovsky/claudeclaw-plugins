/**
 * Example plugin demonstrating all six ClaudeClaw extension points.
 *
 * This is a no-op reference implementation. It registers a single command,
 * declares an env var, creates an empty table, and contributes to the
 * Telegram command list. Use it as a template for real plugins.
 */
import type { ClaudeClawPlugin } from '../../src/plugin-context.js';

const plugin: ClaudeClawPlugin = {
  name: 'example',
  version: '0.1.0',
  description: 'No-op plugin demonstrating the extension points',

  register(ctx) {
    // 1. Bot command registration (grammy API)
    ctx.bot.command('plugin_example', async (botCtx) => {
      await botCtx.reply('Hello from the example plugin!');
    });

    // 2. Owned commands (prevents routing to Claude)
    ctx.registerOwnedCommands(['plugin_example']);

    // 3. Telegram command-list contribution
    ctx.registerTelegramCommands([
      { command: 'plugin_example', description: 'Example plugin demo command' },
    ]);

    // 4. Env-var declaration
    ctx.registerEnvVars(['EXAMPLE_PLUGIN_TOKEN']);

    // 5. DB migration
    ctx.db.registerMigration({
      id: 'example-001-noop',
      sql: 'CREATE TABLE IF NOT EXISTS example_plugin_noop (id INTEGER PRIMARY KEY)',
    });

    // 6. MCP server declaration (no-op, just shows the API)
    // Uncomment to actually register:
    // ctx.registerMcpServer({
    //   name: 'example',
    //   command: 'node',
    //   args: ['dist/plugins/example/example-mcp.js'],
    //   env: { CLAUDECLAW_DATA_DIR: '${TENANT_DIR}' },
    // });
  },
};

export default plugin;
