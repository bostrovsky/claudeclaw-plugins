# The rendering add-on

Some plugins turn structured content into a **styled image** instead of plain
Telegram text — Canvas renders agent replies (tables, code, comparisons), and
Anki renders flashcard previews. That capability is **shared platform
infrastructure**, not part of any one plugin. This add-on installs it.

## What it installs

| File (into core `src/`) | What it is | Dependencies |
|---|---|---|
| `html-render.ts` | `renderHtmlToPng(html)` — HTML → PNG | **Playwright** (headless Chromium) |
| `content-channel.ts` | in-memory channel that streams content to the Telegram Mini App (`emitContentEvent`, `getContentChannel`) | none (pure Node) |

```bash
cd /path/to/claudeclaw-os
bash claudeclaw-plugins/install-rendering.sh
```

It's a **separate step from `install.sh`** on purpose: the renderer pulls in
Playwright (~300MB Chromium). The base loader stays dependency-light, and only
installs that actually render anything take on the browser.

## Why Playwright?

Telegram's own text rendering is poor — markdown is inconsistent, there are no
real tables, no CSS, no charts. So instead of sending text, these plugins build
**styled HTML** and render it to a **pixel-perfect PNG** that looks identical on
every device. Doing that with full CSS + Chart.js fidelity needs a real browser
engine, which is what Playwright drives (a headless Chromium).

Lighter HTML-to-image approaches exist (e.g. Satori, which goes HTML/CSS → SVG →
PNG) but they support only a subset of CSS and can't render arbitrary charts —
so for fidelity, a real browser is the right tool. That weight is exactly why
it's optional.

## How it's used

```
agent/plugin produces styled HTML
        │
        ├─ renderHtmlToPng(html)  ──►  PNG  ──►  sent into the Telegram chat
        │     (Playwright: launch Chromium, load HTML, screenshot)
        │
        └─ emitContentEvent(chatId, { type:'html', content: html })
              └─►  Mini App content channel  ──►  (if the Canvas Mini App
                   server is installed) live interactive view in Telegram
```

The **PNG path** (the renderer) is what needs Playwright. The **Mini App path**
(the channel) is pure Node — the interactive view renders HTML in Telegram's
built-in WebView and needs no browser on the server. A plugin can use either or
both.

## Graceful degradation

`renderHtmlToPng` returns `null` if the browser fails (or Playwright isn't
installed), so a well-written plugin falls back to text. Anki, for example, sends
a text preview when the renderer is unavailable. So a plugin that renders should
treat this add-on as a soft dependency: nicer output when present, still
functional without.

## Who needs it

- **Canvas** — yes (its whole job is rendering).
- **Anki** — for PNG card previews; without it, previews are text-only and the
  rest of Anki still works.
- A plugin that only adds commands / data / an MCP server — no.

Install it once; every rendering plugin shares the same engine. No plugin
bundles its own copy, and no plugin depends on another plugin for it.
