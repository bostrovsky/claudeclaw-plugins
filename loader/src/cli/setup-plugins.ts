#!/usr/bin/env tsx
/**
 * CLI: npm run setup:plugins
 *
 * Reads all plugin MCP server declarations and merges them into each
 * tenant's ~/.claudeclaw/<tenant>/.claude/settings.json.
 *
 * Idempotent: re-running produces no diff if nothing changed.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import { loadPluginDeclarations } from '../plugin-loader.js';

const CLAUDECLAW_CONFIG = process.env.CLAUDECLAW_CONFIG
  ? path.resolve(process.env.CLAUDECLAW_CONFIG)
  : path.join(os.homedir(), '.claudeclaw');

async function main(): Promise<void> {
  const declarations = await loadPluginDeclarations();

  if (declarations.length === 0) {
    console.log('No plugin MCP server declarations found.');
    return;
  }

  console.log('Found %d MCP server declaration(s) from plugins.', declarations.length);

  // Find tenant directories under ~/.claudeclaw/
  if (!fs.existsSync(CLAUDECLAW_CONFIG)) {
    console.log('No config directory found at %s', CLAUDECLAW_CONFIG);
    return;
  }

  const entries = fs.readdirSync(CLAUDECLAW_CONFIG, { withFileTypes: true });
  const tenantDirs = entries.filter(
    (e) => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_'),
  );

  if (tenantDirs.length === 0) {
    console.log('No tenant directories found in %s', CLAUDECLAW_CONFIG);
    return;
  }

  const updated: string[] = [];

  for (const tenant of tenantDirs) {
    const tenantDir = path.join(CLAUDECLAW_CONFIG, tenant.name);
    const settingsDir = path.join(tenantDir, '.claude');
    const settingsPath = path.join(settingsDir, 'settings.json');

    // Read existing settings or start fresh
    let settings: Record<string, any> = {};
    if (fs.existsSync(settingsPath)) {
      try {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      } catch {
        console.warn('  Warning: could not parse %s, starting fresh', settingsPath);
      }
    }

    if (!settings.mcpServers) {
      settings.mcpServers = {};
    }

    let changed = false;
    for (const decl of declarations) {
      // Interpolate ${TENANT_DIR} and ${TENANT_ID} in env values
      const env: Record<string, string> = {};
      if (decl.env) {
        for (const [k, v] of Object.entries(decl.env)) {
          env[k] = v
            .replace(/\$\{TENANT_DIR\}/g, tenantDir)
            .replace(/\$\{TENANT_ID\}/g, tenant.name);
        }
      }

      const serverConfig: Record<string, any> = {
        command: decl.command,
        args: decl.args,
      };
      if (Object.keys(env).length > 0) {
        serverConfig.env = env;
      }

      // Compare with existing to avoid unnecessary writes
      const existing = settings.mcpServers[decl.name];
      const newJson = JSON.stringify(serverConfig);
      if (existing && JSON.stringify(existing) === newJson) {
        continue;
      }

      settings.mcpServers[decl.name] = serverConfig;
      changed = true;
    }

    if (changed) {
      fs.mkdirSync(settingsDir, { recursive: true });
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
      updated.push(tenant.name);
    }
  }

  if (updated.length > 0) {
    console.log('Updated settings.json for tenants: %s', updated.join(', '));
  } else {
    console.log('All tenant settings already up to date.');
  }
}

main().catch((err) => {
  console.error('setup-plugins failed:', err);
  process.exit(1);
});
