#!/usr/bin/env bash
#
# claudeclaw-plugins — remove the plugin loader from a ClaudeClaw OS checkout.
#
# Reverts the core hooks and deletes the loader source files. Leaves your
# plugins/ directory and docs in place. Run from your ClaudeClaw OS root.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAW_DIR="$(pwd)"
LOADER="$SCRIPT_DIR/loader"

for f in src/bot.ts src/index.ts src/db.ts; do
  if [ ! -f "$CLAW_DIR/$f" ]; then
    echo "Error: run this from your ClaudeClaw OS root directory (missing $f)."
    exit 1
  fi
done

echo "Removing the ClaudeClaw plugin loader from $CLAW_DIR"

# ── 1. Revert the core hooks ──────────────────────────────────────────
node "$LOADER/tools/apply-hooks.mjs" --revert

# ── 2. Remove loader source files ─────────────────────────────────────
rm -f "$CLAW_DIR/src/plugin-loader.ts" \
      "$CLAW_DIR/src/plugin-context.ts" \
      "$CLAW_DIR/src/cli/setup-plugins.ts" \
      "$CLAW_DIR/tsconfig.plugins.json"

echo ""
echo "Reverted core hooks and removed loader files."
echo "Left in place: plugins/ (your plugins), docs/PLUGINS*.md, .gitignore entries."
echo "Run 'npm run build' to rebuild without the loader."
