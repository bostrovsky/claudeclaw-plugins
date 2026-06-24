import type { Bot, Context } from 'grammy';
import type Database from 'better-sqlite3';

// ── Public types ────────────────────────────────────────────────────

export interface TelegramCommandEntry {
  command: string;
  description: string;
}

/**
 * Transforms an outgoing bot response before it is sent to Telegram.
 *
 * Runs in `handleMessage()` after file markers and before the text send.
 * Each registered middleware receives the (possibly already-transformed)
 * response text plus the grammy context, performs any side effects
 * (e.g. sending a photo), and returns the text that should still be sent
 * as a Telegram message. Return `''` to send nothing; return the input
 * unchanged to pass through. Middlewares run in registration order.
 */
export type ResponseMiddleware = (
  responseText: string,
  ctx: Context,
) => Promise<string> | string;

export interface McpServerDeclaration {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface PluginMigration {
  id: string;
  sql: string;
}

/**
 * The context object passed to each plugin's `register()` function.
 * Provides access to the bot instance and all six extension-point APIs.
 */
export interface PluginContext {
  /** The grammy Bot instance. Call bot.command() / bot.callbackQuery() directly. */
  bot: Bot;

  /**
   * True only in the main agent process. Plugins that own a singleton
   * resource (a background HTTP server, a shared port) should gate startup
   * on this so they don't boot once per sub-agent process.
   */
  isMainProcess: boolean;

  /** Register slash commands that the bot owns (prevents routing to Claude). */
  registerOwnedCommands(commands: string[]): void;

  /**
   * Register a transformer for outgoing bot responses. Runs before the
   * text is sent to Telegram; see {@link ResponseMiddleware}.
   */
  registerResponseMiddleware(fn: ResponseMiddleware): void;

  /** Contribute entries to the Telegram /setMyCommands menu. */
  registerTelegramCommands(commands: TelegramCommandEntry[]): void;

  /** Declare env vars this plugin reads from the tenant .env. */
  registerEnvVars(vars: string[]): void;

  /** Declare an MCP server for tenant settings.json. */
  registerMcpServer(server: McpServerDeclaration): void;

  /** Database extension points. */
  db: {
    /** Register an idempotent SQL migration. Runs before register() returns. */
    registerMigration(migration: PluginMigration): void;
  };
}

/**
 * The shape every plugin must export as its default export.
 */
export interface ClaudeClawPlugin {
  /** Unique name, used as the plugin directory name. */
  name: string;
  /** Semver-style version string. Informational. */
  version: string;
  /** Optional one-line description. Shown in startup log. */
  description?: string;
  /** Called once at bot startup. */
  register(ctx: PluginContext): Promise<void> | void;
  /** Optional shutdown hook. Called when the bot shuts down. */
  shutdown?(): Promise<void> | void;
}
