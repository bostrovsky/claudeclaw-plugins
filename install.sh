#!/usr/bin/env bash
#
# claudeclaw-plugins — install the plugin loader into a ClaudeClaw OS checkout.
#
# Run from your ClaudeClaw OS root:
#   git clone https://github.com/bostrovsky/claudeclaw-plugins.git
#   bash claudeclaw-plugins/install.sh
#
# Idempotent and reversible (see uninstall.sh). Every core edit is additive and
# behavior-preserving until a plugin is present. Pass --no-build to skip the
# final `npm run build`.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAW_DIR="$(pwd)"
LOADER="$SCRIPT_DIR/loader"

# ── Verify we're in a ClaudeClaw OS root ──────────────────────────────
for f in src/bot.ts src/index.ts src/db.ts package.json; do
  if [ ! -f "$CLAW_DIR/$f" ]; then
    echo "Error: run this from your ClaudeClaw OS root directory (missing $f)."
    echo "  cd /path/to/claudeclaw-os && bash $SCRIPT_DIR/install.sh"
    exit 1
  fi
done

echo "Installing the ClaudeClaw plugin loader into $CLAW_DIR"

# ── 1. Copy loader source + reference plugin + docs ───────────────────
echo "  Copying loader files..."
cp "$LOADER/src/plugin-loader.ts"      "$CLAW_DIR/src/plugin-loader.ts"
cp "$LOADER/src/plugin-context.ts"     "$CLAW_DIR/src/plugin-context.ts"
mkdir -p "$CLAW_DIR/src/cli"
cp "$LOADER/src/cli/setup-plugins.ts"  "$CLAW_DIR/src/cli/setup-plugins.ts"
cp "$LOADER/tsconfig.plugins.json"     "$CLAW_DIR/tsconfig.plugins.json"
mkdir -p "$CLAW_DIR/plugins/example"
cp "$LOADER/plugins/example/plugin.ts" "$CLAW_DIR/plugins/example/plugin.ts"
cp "$LOADER/plugins/example/README.md" "$CLAW_DIR/plugins/example/README.md"
mkdir -p "$CLAW_DIR/docs"
cp "$SCRIPT_DIR/docs/PLUGINS.md"           "$CLAW_DIR/docs/PLUGINS.md"
cp "$SCRIPT_DIR/docs/PLUGINS-MIGRATION.md" "$CLAW_DIR/docs/PLUGINS-MIGRATION.md"

# ── 2. Apply the core hooks (idempotent; aborts if upstream drifted) ──
echo "  Applying core hooks..."
node "$LOADER/tools/apply-hooks.mjs"

# ── 3. Ignore compiled plugin artifacts (keep web/ assets) ────────────
if [ -f "$CLAW_DIR/.gitignore" ] && ! grep -q "plugins/\*\*/\*.js" "$CLAW_DIR/.gitignore"; then
  {
    echo ""
    echo "# Compiled plugin artifacts (claudeclaw-plugins)"
    echo "plugins/**/*.js"
    echo "plugins/**/*.js.map"
    echo "!plugins/**/web/**"
  } >> "$CLAW_DIR/.gitignore"
  echo "  Updated .gitignore"
fi

# ── 4. Build (unless skipped) ─────────────────────────────────────────
if [ "${1:-}" = "--no-build" ]; then
  echo ""
  echo "Skipped build (--no-build). Run 'npm run build' when ready."
else
  echo "  Building..."
  npm run build
fi

echo ""
echo "============================================================"
echo "  Plugin loader installed."
echo "============================================================"
echo ""
echo "  - Reference plugin:   plugins/example/"
echo "  - How to write one:   docs/PLUGINS.md"
echo "  - Migrate a module:   docs/PLUGINS-MIGRATION.md"
echo ""
echo "  Restart your bot, then look for '[plugin] loaded example@0.1.0'"
echo "  in the log. To remove: bash $SCRIPT_DIR/uninstall.sh"
