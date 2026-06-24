#!/usr/bin/env node
/**
 * apply-hooks.mjs — insert the plugin-loader hooks into ClaudeClaw core.
 *
 * Run by install.sh from the ClaudeClaw OS root. Idempotent: each hook has a
 * `guard` string; if it's already present the hook is skipped. If an `anchor`
 * can't be found the script fails loudly (means upstream moved — report it
 * rather than silently corrupting a file, the exact failure mode of the old
 * sed installers this replaces).
 *
 * `node tools/apply-hooks.mjs --check` reports status without writing.
 * `node tools/apply-hooks.mjs --revert` removes the hooks (used by uninstall.sh).
 *
 * Every edit is additive and behavior-preserving until a plugin is present:
 * with no `plugins/` dir the loader logs "no plugins" and returns, the
 * middleware loop is empty, and the command aggregators add nothing.
 */
import fs from 'fs';

const CHECK = process.argv.includes('--check');
const REVERT = process.argv.includes('--revert');

const LOADER_IMPORT =
  "import { loadPlugins, shutdownPlugins, getPluginTelegramCommands, getPluginOwnedCommands, getResponseMiddleware } from './plugin-loader.js';";

/**
 * Each hook: file, guard (presence ⇒ already applied), and find/replace.
 * `find` is an exact substring (or RegExp); `replace` is what it becomes.
 */
const HOOKS = [
  // ── src/bot.ts ────────────────────────────────────────────────────
  {
    file: 'src/bot.ts',
    name: 'loader import',
    guard: './plugin-loader.js',
    find: "import { AgentError } from './errors.js';",
    replace: "import { AgentError } from './errors.js';\n" + LOADER_IMPORT,
  },
  {
    file: 'src/bot.ts',
    name: 'async createBot',
    guard: 'async function createBot',
    find: 'export function createBot(): Bot {',
    replace: 'export async function createBot(): Promise<Bot> {',
  },
  {
    file: 'src/bot.ts',
    name: 'loadPlugins call',
    guard: 'await loadPlugins(',
    find: '  // Register commands in the Telegram menu',
    replace:
      "  // Load plugins (discovers plugins/*/plugin.js, calls register() on each)\n" +
      "  await loadPlugins(bot, AGENT_ID === 'main');\n\n" +
      '  // Register commands in the Telegram menu',
  },
  {
    file: 'src/bot.ts',
    name: 'setMyCommands aggregation',
    guard: 'getPluginTelegramCommands()',
    find: '[...builtInCommands, ...skillCommands].slice(0, 100)',
    replace: '[...builtInCommands, ...getPluginTelegramCommands(), ...skillCommands].slice(0, 100)',
  },
  {
    file: 'src/bot.ts',
    name: 'OWN_COMMANDS aggregation',
    guard: 'getPluginOwnedCommands()',
    find: /(const OWN_COMMANDS = new Set\(\[[^\]]*\]\);\n)/,
    replace: '$1  for (const cmd of getPluginOwnedCommands()) OWN_COMMANDS.add(cmd);\n',
  },
  {
    file: 'src/bot.ts',
    name: 'response middleware',
    guard: 'pluginResponseText',
    find:
      "    // Send text response (if there's any left after stripping markers)\n" +
      "    const textWithFooter = responseText ? responseText + costFooter : '';",
    replace:
      "    // Plugin response middleware (e.g. Canvas marker rendering). Runs in\n" +
      "    // registration order; no-op when no plugin registers one.\n" +
      '    let pluginResponseText = responseText;\n' +
      '    for (const __mw of getResponseMiddleware()) {\n' +
      '      pluginResponseText = await __mw(pluginResponseText, ctx);\n' +
      '    }\n\n' +
      "    // Send text response (if there's any left after stripping markers)\n" +
      "    const textWithFooter = pluginResponseText ? pluginResponseText + costFooter : '';",
  },
  {
    file: 'src/bot.ts',
    name: 'export replyIfLocked',
    guard: 'export async function replyIfLocked',
    find: 'async function replyIfLocked',
    replace: 'export async function replyIfLocked',
  },
  {
    file: 'src/bot.ts',
    name: 'export canUseTelegramUrlButton',
    guard: 'export function canUseTelegramUrlButton',
    find: 'function canUseTelegramUrlButton',
    replace: 'export function canUseTelegramUrlButton',
  },
  // ── src/db.ts ─────────────────────────────────────────────────────
  {
    file: 'src/db.ts',
    name: 'getDb export',
    guard: 'export function getDb',
    find: 'let db: Database.Database;',
    replace:
      'let db: Database.Database;\n\n' +
      '/** Plugin loader access to the tenant database (added by claudeclaw-plugins). */\n' +
      'export function getDb(): Database.Database {\n  return db;\n}',
  },
  // ── src/index.ts ──────────────────────────────────────────────────
  {
    file: 'src/index.ts',
    name: 'shutdownPlugins import',
    guard: "shutdownPlugins } from './plugin-loader.js'",
    find: "import { createBot } from './bot.js';",
    replace:
      "import { createBot } from './bot.js';\n" +
      "import { shutdownPlugins } from './plugin-loader.js';",
  },
  {
    file: 'src/index.ts',
    name: 'await createBot',
    guard: 'await createBot()',
    find: 'const bot = createBot();',
    replace: 'const bot = await createBot();',
  },
  {
    file: 'src/index.ts',
    name: 'shutdownPlugins call',
    guard: 'await shutdownPlugins()',
    find: '    await bot.stop();',
    replace: '    await shutdownPlugins();\n    await bot.stop();',
  },
  // ── package.json ──────────────────────────────────────────────────
  {
    file: 'package.json',
    name: 'build script',
    guard: 'tsconfig.plugins.json',
    find: '"build": "vite build && tsc",',
    replace:
      '"build": "vite build && tsc && tsc -p tsconfig.plugins.json",\n' +
      '    "setup:plugins": "tsx src/cli/setup-plugins.ts",',
  },
];

function findIn(content, find) {
  if (find instanceof RegExp) return find.test(content);
  return content.includes(find);
}

let applied = 0, skipped = 0, missing = 0;
const byFile = new Map();
for (const h of HOOKS) {
  if (!byFile.has(h.file)) byFile.set(h.file, fs.existsSync(h.file) ? fs.readFileSync(h.file, 'utf8') : null);
}

for (const h of HOOKS) {
  let content = byFile.get(h.file);
  if (content == null) {
    console.error(`  ✗ ${h.file} not found — is this a ClaudeClaw OS root?`);
    process.exit(2);
  }
  const has = content.includes(h.guard);

  if (REVERT) {
    if (!has) { skipped++; continue; }
    // Reverse the replace (swap find/replace). For regex hooks, revert is the
    // captured-group form; rebuild from replace→find.
    const fwd = h.replace instanceof RegExp ? null : h.replace;
    if (h.find instanceof RegExp) {
      // OWN_COMMANDS: drop the inserted aggregation line.
      content = content.replace('  for (const cmd of getPluginOwnedCommands()) OWN_COMMANDS.add(cmd);\n', '');
    } else {
      content = content.replace(fwd, h.find);
    }
    byFile.set(h.file, content);
    applied++;
    continue;
  }

  if (has) { console.log(`  • ${h.file}: ${h.name} (already applied)`); skipped++; continue; }
  if (!findIn(content, h.find)) {
    console.error(`  ✗ ${h.file}: ${h.name} — anchor not found (upstream may have changed). Aborting; no files written.`);
    missing++;
    continue;
  }
  if (!CHECK) {
    content = content.replace(h.find, h.replace);
    byFile.set(h.file, content);
  }
  console.log(`  ✓ ${h.file}: ${h.name}`);
  applied++;
}

if (missing > 0) process.exit(3);

if (!CHECK) {
  for (const [file, content] of byFile) if (content != null) fs.writeFileSync(file, content);
}

console.log(
  `\n${REVERT ? 'Reverted' : CHECK ? 'Would apply' : 'Applied'} ${applied} hook(s), ${skipped} already ${REVERT ? 'absent' : 'present'}.`,
);
