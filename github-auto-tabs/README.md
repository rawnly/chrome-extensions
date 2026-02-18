# GitHub Auto Tabs

A Chrome extension that automatically manages a tab group for GitHub pull requests awaiting your review. It polls the GitHub Search API on a configurable interval and keeps a "Reviews" tab group in sync — opening new tabs for incoming PRs and closing tabs for PRs you've already reviewed.

## Features

- Automatic polling via `chrome.alarms` (1, 5, 10, or 30 minute intervals)
- Grouped tabs under a color-coded "Reviews" tab group
- Badge counter showing the number of pending reviews
- PAT encrypted at rest using AES-256-GCM
- Token validation against the GitHub API before saving
- Rate-limit backoff with automatic recovery

## Setup

1. **Generate a GitHub PAT** — go to [Settings > Developer settings > Personal access tokens](https://github.com/settings/tokens) and create a token with the `repo` scope (classic) or `read` access to pull requests (fine-grained)
2. **Install the extension**
   - Open `chrome://extensions`
   - Enable **Developer mode**
   - Click **Load unpacked** and select the `github-auto-tabs` directory
3. **Configure** — click the extension icon, paste your PAT, choose a poll interval, and hit Save

## How it works

1. On each alarm tick, the service worker calls the GitHub Search API:
   ```
   GET /search/issues?q=is:pr+is:open+review-requested:@me
   ```
2. PR URLs are validated against a strict pattern (`github.com/<owner>/<repo>/pull/<number>`)
3. The extension reconciles the current tab group with the API results:
   - Opens tabs for new PRs
   - Closes tabs for PRs no longer in the review queue
   - Creates or removes the tab group as needed

## Permissions

| Permission | Why |
|---|---|
| `tabs` | Create, query, and close tabs |
| `tabGroups` | Manage the "Reviews" tab group |
| `storage` | Persist encrypted PAT and settings |
| `alarms` | Schedule periodic polling |
| `https://api.github.com/*` | GitHub API access |

## Security

The PAT is encrypted before storage and never exposed to the popup UI. See [SECURITY.md](SECURITY.md) for full details on the threat model, implemented controls, and known limitations.
