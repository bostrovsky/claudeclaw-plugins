#!/usr/bin/env bash
#
# claudeclaw-plugins — OPTIONAL rendering add-on.
#
# Installs the shared rendering engine into ClaudeClaw core:
#   - src/html-render.ts     HTML → PNG via a headless browser (Playwright)
#   - src/content-channel.ts in-memory channel that feeds the Telegram Mini App
#
# Plugins that render structured content (Canvas, Anki card previews) import
# these from core. This is a SEPARATE step from install.sh because it pulls in
# Playwright (~300MB Chromium) — the base loader stays dependency-light, and
# only installs that actually render anything take on the browser.
#
# Run from your ClaudeClaw OS root:
#   bash claudeclaw-plugins/install-rendering.sh
#
# Pass --no-build to skip the final `npm run build`.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAW_DIR="$(pwd)"
RENDER="$SCRIPT_DIR/render"

for f in src/logger.ts package.json; do
  if [ ! -f "$CLAW_DIR/$f" ]; then
    echo "Error: run this from your ClaudeClaw OS root directory (missing $f)."
    exit 1
  fi
done

echo "Installing the rendering add-on into $CLAW_DIR"

# ── 1. Copy the engine into core src/ ─────────────────────────────────
cp "$RENDER/src/content-channel.ts" "$CLAW_DIR/src/content-channel.ts"
cp "$RENDER/src/html-render.ts"     "$CLAW_DIR/src/html-render.ts"
echo "  Copied content-channel.ts + html-render.ts into src/"

# ── 2. Ensure Playwright + Chromium (the renderer needs a real browser) ─
if ! node -e "require.resolve('playwright')" 2>/dev/null; then
  echo "  Installing playwright..."
  npm install playwright
fi
echo "  Installing Chromium for Playwright (this can take a minute)..."
npx playwright install chromium

# ── 3. Build (unless skipped) ─────────────────────────────────────────
if [ "${1:-}" = "--no-build" ]; then
  echo ""
  echo "Skipped build (--no-build). Run 'npm run build' when ready."
else
  echo "  Building..."
  npm run build
fi

echo ""
echo "============================================================"
echo "  Rendering add-on installed."
echo "============================================================"
echo ""
echo "  Plugins can now import the shared engine from core:"
echo "    import { renderHtmlToPng } from '../../dist/html-render.js';"
echo "    import { emitContentEvent, getContentChannel } from '../../dist/content-channel.js';"
echo ""
echo "  Why Playwright? It renders HTML to a PNG (high-fidelity tables, code,"
echo "  charts) that gets sent into the Telegram chat. See docs/RENDERING.md."
