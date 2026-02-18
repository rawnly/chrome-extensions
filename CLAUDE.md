# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A collection of independent Chrome extensions (Manifest V3), each in its own directory. No build system, no bundler, no package manager — plain vanilla JavaScript throughout.

## Extensions

- **cleanup_web** — Hide distracting elements from webpages via point-and-click selector picker
- **github-auto-tabs** — Auto-manage a tab group for GitHub PRs awaiting your review (alarm-based polling)
- **redirecto** — Declarative URL redirect rules (no runtime code, purely `declarativeNetRequest`)

## Development

There is no build step. To test an extension:
1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" and select the extension's directory

After editing files, click the reload button on the extension card (or Ctrl+R on the extensions page). Service worker changes require a full reload; popup/content script changes often take effect on next open/navigation.

## Conventions

- **No build tools or transpilers** — write ES2020+ that Chrome supports natively
- **Manifest V3** — service workers (not background pages), `chrome.storage.local` for persistence
- **Folder structure**: each extension has `manifest.json`, `background.js`, `popup/popup.html` + `popup/popup.js`, `icons/` (16/48/128 PNG)
- **Messaging**: `chrome.runtime.onMessage` with `{ type: "..." }` string-based dispatch
- **Popup styling**: inline `<style>` in HTML, system-ui font stack, ~280px width, slate color palette (#1e293b dark, #64748b muted, #3b82f6 primary blue), dark mode via `@media (prefers-color-scheme: dark)`
- **Button classes**: `.btn` base, `.btn--primary` (blue), `.btn--danger` (red) — border-radius 6px, 8px padding
- **No shared code** between extensions — each is fully standalone
