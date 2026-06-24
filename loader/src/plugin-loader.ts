import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import type { Bot } from 'grammy';

import { logger } from './logger.js';
import { getDb } from './db.js';
import type {
  ClaudeClawPlugin,
  McpServerDeclaration,
  PluginContext,
  PluginMigration,
  ResponseMiddleware,
  TelegramCommandEntry,
} from './plugin-context.js';

// Re-export types for plugin authors
export type { ClaudeClawPlugin, PluginContext } from './plugin-context.js';

// ── Internal state ──────────────────────────────────────────────────

const loadedPlugins: ClaudeClawPlugin[] = [];
const pluginTelegramCommands: TelegramCommandEntry[] = [];
const pluginOwnedCommands: string[] = [];
const pluginMcpServers: McpServerDeclaration[] = [];
const pluginResponseMiddleware: ResponseMiddleware[] = [];
const pluginEnvVars = new Set<string>();

// ── Public accessors ────────────────────────────────────────────────

/** Env var names declared by plugins (for introspection / docs). */
export function getPluginEnvVars(): ReadonlySet<string> {
  return pluginEnvVars;
}

/** Telegram command entries contributed by all plugins. */
export function getPluginTelegramCommands(): TelegramCommandEntry[] {
  return pluginTelegramCommands;
}

/** Slash commands owned by plugins (with leading /). */
export function getPluginOwnedCommands(): string[] {
  return pluginOwnedCommands;
}

/** MCP server declarations from all plugins. */
export function getPluginMcpServers(): McpServerDeclaration[] {
  return pluginMcpServers;
}

/** Outgoing-response transformers contributed by all plugins, in registration order. */
export function getResponseMiddleware(): ResponseMiddleware[] {
  return pluginResponseMiddleware;
}

// ── Plugin migration runner ─────────────────────────────────────────

function ensureMigrationTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS _plugin_migrations (
      id         TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);
}

function runPluginMigration(migration: PluginMigration): void {
  const db = getDb();
  const exists = db
    .prepare('SELECT 1 FROM _plugin_migrations WHERE id = ?')
    .get(migration.id);
  if (exists) return; // idempotent

  db.exec(migration.sql);
  db.prepare(
    'INSERT INTO _plugin_migrations (id, applied_at) VALUES (?, ?)',
  ).run(migration.id, Date.now());
}

// ── Plugin discovery + loading ──────────────────────────────────────

function getPluginsDir(): string {
  const __filename = fileURLToPath(import.meta.url);
  const projectRoot = path.resolve(path.dirname(__filename), '..');
  return path.join(projectRoot, 'plugins');
}

/**
 * Discover and load all plugins from `plugins/` at bot startup.
 *
 * Scans `plugins/<name>/dist/plugin.js` (built form).
 * Loads in alphabetical order of plugin directory name.
 * Plugins that fail to load are logged and skipped.
 */
export async function loadPlugins(bot: Bot, isMainProcess = false): Promise<void> {
  const pluginsDir = getPluginsDir();

  if (!fs.existsSync(pluginsDir)) {
    logger.info('No plugins/ directory found, skipping plugin loading');
    return;
  }

  const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
  const pluginDirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  if (pluginDirs.length === 0) {
    logger.info('No plugins found in plugins/');
    return;
  }

  // Ensure migration tracking table exists before any plugin registers migrations
  ensureMigrationTable();

  for (const dirName of pluginDirs) {
    const pluginDir = path.join(pluginsDir, dirName);

    // Resolve plugin entry point: dist/plugin.js (built form)
    const builtPath = path.join(pluginDir, 'dist', 'plugin.js');
    const directPath = path.join(pluginDir, 'plugin.js');
    let entryPath: string | undefined;

    if (fs.existsSync(builtPath)) {
      entryPath = builtPath;
    } else if (fs.existsSync(directPath)) {
      entryPath = directPath;
    }

    if (!entryPath) {
      logger.warn({ dir: dirName }, 'Plugin directory %s has no plugin.js, skipping', dirName);
      continue;
    }

    try {
      // Dynamic import with file:// URL for ESM compatibility
      const mod = await import(/* webpackIgnore: true */ `file://${entryPath}`);
      const plugin: ClaudeClawPlugin = mod.default;

      // Validate shape
      if (!plugin || typeof plugin.name !== 'string' || typeof plugin.version !== 'string' || typeof plugin.register !== 'function') {
        logger.error({ dir: dirName }, 'Plugin %s has invalid default export (missing name/version/register)', dirName);
        continue;
      }

      // Build the context for this plugin
      const ctx = buildPluginContext(bot, plugin.name, isMainProcess);

      // Call register
      await plugin.register(ctx);

      loadedPlugins.push(plugin);
      const desc = plugin.description ? ` — ${plugin.description}` : '';
      logger.info('[plugin] loaded %s@%s%s', plugin.name, plugin.version, desc);
    } catch (err) {
      logger.error({ err, dir: dirName }, 'Failed to load plugin %s', dirName);
    }
  }

  if (loadedPlugins.length > 0) {
    logger.info('Loaded %d plugin(s)', loadedPlugins.length);
  }
}

/**
 * Shut down all loaded plugins in reverse load order.
 * Each plugin gets 5 seconds before timeout.
 */
export async function shutdownPlugins(): Promise<void> {
  for (const plugin of [...loadedPlugins].reverse()) {
    if (typeof plugin.shutdown !== 'function') continue;
    try {
      await Promise.race([
        Promise.resolve(plugin.shutdown()),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 5000),
        ),
      ]);
      logger.info('[plugin] %s shut down', plugin.name);
    } catch (err) {
      logger.error({ err, plugin: plugin.name }, 'Plugin %s shutdown failed', plugin.name);
    }
  }
}

// ── Stub context for CLI tools (setup-plugins) ─────────────────────

/**
 * Load all plugins in "declaration-only" mode (no bot, no DB).
 * Used by the setup-plugins CLI to collect MCP declarations.
 */
export async function loadPluginDeclarations(): Promise<McpServerDeclaration[]> {
  const pluginsDir = getPluginsDir();
  const declarations: McpServerDeclaration[] = [];

  if (!fs.existsSync(pluginsDir)) return declarations;

  const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
  const pluginDirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  for (const dirName of pluginDirs) {
    const pluginDir = path.join(pluginsDir, dirName);
    const builtPath = path.join(pluginDir, 'dist', 'plugin.js');
    const directPath = path.join(pluginDir, 'plugin.js');
    let entryPath: string | undefined;

    if (fs.existsSync(builtPath)) {
      entryPath = builtPath;
    } else if (fs.existsSync(directPath)) {
      entryPath = directPath;
    }

    if (!entryPath) continue;

    try {
      const mod = await import(/* webpackIgnore: true */ `file://${entryPath}`);
      const plugin: ClaudeClawPlugin = mod.default;
      if (!plugin || typeof plugin.register !== 'function') continue;

      // Stub context that only collects MCP declarations. The bot is a no-op
      // proxy so a plugin's register() can run through its bot.command()/on()/
      // api.* wiring without throwing (any access/call returns the proxy).
      const mcpCollector: McpServerDeclaration[] = [];
      const noopBot: unknown = new Proxy(function () {}, {
        get: () => noopBot,
        apply: () => noopBot,
      });
      const stubCtx: PluginContext = {
        bot: noopBot as Bot,
        isMainProcess: false,
        registerOwnedCommands: () => {},
        registerResponseMiddleware: () => {},
        registerTelegramCommands: () => {},
        registerEnvVars: () => {},
        registerMcpServer: (server) => mcpCollector.push(server),
        db: { registerMigration: () => {} },
      };

      // registerMcpServer runs before any wiring, so the collector is populated
      // even if a later step throws on the stub. Keep declarations regardless.
      try {
        await plugin.register(stubCtx);
      } catch {
        // register may do real bot wiring / side effects that fail on the stub;
        // we only need the MCP declarations it recorded before failing.
      }
      declarations.push(...mcpCollector);
    } catch {
      // Skip plugins that fail to import
    }
  }

  return declarations;
}

// ── Internal: build the PluginContext for a plugin ──────────────────

function buildPluginContext(bot: Bot, pluginName: string, isMainProcess: boolean): PluginContext {
  return {
    bot,
    isMainProcess,

    registerOwnedCommands(commands: string[]) {
      for (const cmd of commands) {
        const normalized = cmd.startsWith('/') ? cmd : `/${cmd}`;
        pluginOwnedCommands.push(normalized);
      }
    },

    registerResponseMiddleware(fn: ResponseMiddleware) {
      pluginResponseMiddleware.push(fn);
    },

    registerTelegramCommands(commands: TelegramCommandEntry[]) {
      pluginTelegramCommands.push(...commands);
    },

    registerEnvVars(vars: string[]) {
      for (const v of vars) {
        pluginEnvVars.add(v);
      }
    },

    registerMcpServer(server: McpServerDeclaration) {
      pluginMcpServers.push(server);
    },

    db: {
      registerMigration(migration: PluginMigration) {
        runPluginMigration(migration);
      },
    },
  };
}
