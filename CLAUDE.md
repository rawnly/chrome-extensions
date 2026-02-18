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
- **Messaging**: `chrome.runtime.onMessage` with `{ type: "..." }` string-based dispatch; return `true` from listener for async `sendResponse`
- **Popup styling**: inline `<style>` in HTML, system-ui font stack, ~280px width, slate color palette (#1e293b dark, #64748b muted, #3b82f6 primary blue), dark mode via `@media (prefers-color-scheme: dark)`
- **Button classes**: `.btn` base, `.btn--primary` (blue), `.btn--danger` (red) — border-radius 6px, 8px padding
- **DOM writes**: always use `.textContent`, never `.innerHTML` — prevents XSS
- **No shared code** between extensions — each is fully standalone

## Architecture

### cleanup_web

Three-layer architecture: **popup** (UI) → **background** (service worker hub) → **content scripts** (page manipulation).

- `content/cleaner.js` is always injected (`document_idle` via manifest) — applies stored hide rules and watches for dynamic content via `MutationObserver`
- `content/picker.js` is injected on-demand via `chrome.scripting.executeScript` when the user enters pick mode — generates CSS selectors (ID → class combo → nth-of-type path) and stores them under the hostname key in `chrome.storage.local`
- `background.js` is a pure message router — coordinates popup↔content and manages badge counts
- Storage shape: `{ rules: { "example.com": [{ selector, created }] } }`

### github-auto-tabs

Single service worker with four subsystems:

1. **Crypto** — AES-256-GCM encryption of PAT via Web Crypto API; key derived with PBKDF2 from `chrome.runtime.id` + random salt; key is never stored
2. **GitHub API** — polls `GET /search/issues?q=is:pr+is:open+review-requested:@me`, validates tokens via `GET /user`, handles rate-limit backoff
3. **Tab reconciliation** — maintains a "Reviews" tab group; opens/closes tabs to match current review queue; validates PR URLs against strict regex
4. **Settings** — interval allowlist `[1, 5, 10, 30]`, encrypted PAT storage, migration from legacy plaintext format

Storage keys: `patEncrypted` (object with salt/iv/ciphertext), `interval`, `groupId`, `lastPoll`, `lastError`, `prCount`

### redirecto

Purely declarative — no JavaScript runtime. `rules.json` defines regex-based redirects processed by `declarativeNetRequest`. Currently redirects npmjs.com → npmx.dev and google.com → kagi.com.
