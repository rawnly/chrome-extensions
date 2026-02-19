# PR Patrol

A Chrome extension that automatically manages tab groups for GitHub pull requests awaiting your review. It polls the GitHub Search API on a configurable interval and keeps color-coded tab groups in sync — opening new tabs for incoming PRs and closing tabs for PRs you've already reviewed. Supports multiple groups with custom names, colors, and search queries.

## Features

- **Multiple groups** — define as many tab groups as you need, each with its own name, color, and GitHub search query
- Automatic polling via `chrome.alarms` (1, 5, 10, or 30 minute intervals)
- Badge counter showing the total number of pending reviews across all groups
- PAT encrypted at rest using AES-256-GCM
- Token validation against the GitHub API before saving
- Rate-limit backoff with automatic recovery
- Dedicated options page for managing PAT, interval, and groups
- Popup shows a quick status dashboard with per-group PR counts

## Setup

1. **Generate a GitHub PAT** — go to [Settings > Developer settings > Personal access tokens](https://github.com/settings/tokens) and create a token with the `repo` scope (classic) or `read` access to pull requests (fine-grained)
2. **Install the extension**
   - Open `chrome://extensions`
   - Enable **Developer mode**
   - Click **Load unpacked** and select the `pr-patrol` directory
3. **Configure** — click the extension icon, then the gear icon to open settings. Paste your PAT, choose a poll interval, and configure your groups.

## Architecture

```mermaid
flowchart TB
    subgraph User["User Interaction"]
        Popup["Popup<br/><i>Status dashboard</i>"]
        Options["Options Page<br/><i>PAT / Interval / Groups</i>"]
    end

    subgraph BG["Service Worker (background.js)"]
        Msgs["Message Router"]
        Crypto["Crypto<br/><i>AES-256-GCM encrypt/decrypt</i>"]
        Poll["pollAndReconcile()"]
        Reconcile["reconcileTabsForGroup()"]
        Migrate["migrateStorage()"]
    end

    subgraph External["External"]
        GitHub["GitHub Search API"]
        Storage["chrome.storage.local"]
        Tabs["Chrome Tabs & Tab Groups"]
        Alarm["chrome.alarms"]
    end

    Popup -- "get-status" --> Msgs
    Popup -- "poll-now" --> Msgs
    Popup -- "openOptionsPage()" --> Options
    Options -- "save-settings<br/><i>(PAT + interval)</i>" --> Msgs
    Options -- "save-groups / delete-group" --> Msgs
    Options -- "get-groups / get-status" --> Msgs

    Msgs --> Crypto
    Msgs --> Poll

    Alarm -- "tick" --> Poll

    Poll -- "per group" --> GitHub
    GitHub -- "PRs[]" --> Poll
    Poll -- "per group" --> Reconcile

    Reconcile -- "open / close tabs<br/>create / update group" --> Tabs
    Crypto -- "read / write PAT" --> Storage
    Poll -- "save runtime state" --> Storage
    Migrate -- "legacy keys → groups[]" --> Storage

    style User fill:#f0f4ff,stroke:#3b82f6,color:#1e293b
    style BG fill:#f0fdf4,stroke:#22c55e,color:#1e293b
    style External fill:#fefce8,stroke:#eab308,color:#1e293b
```

### Polling & Reconciliation Flow

```mermaid
sequenceDiagram
    participant A as chrome.alarms
    participant SW as Service Worker
    participant GH as GitHub API
    participant T as Chrome Tabs

    A->>SW: alarm tick
    SW->>SW: check backoff / PAT

    loop For each group
        SW->>GH: GET /search/issues?q={group.query}
        GH-->>SW: PR list

        alt PRs found
            SW->>T: close tabs not in PR list
            SW->>T: open tabs for new PRs
            SW->>T: create/update tab group<br/>(name + color)
        else No PRs
            SW->>T: close all tabs in group
            SW->>T: remove tab group
        end

        Note over SW: update group.prCount,<br/>group.lastError,<br/>group.chromeGroupId
    end

    SW->>SW: badge = total PR count
    SW->>SW: save groups + lastPoll to storage
```

### Storage Schema

```mermaid
erDiagram
    STORAGE {
        object patEncrypted "salt + iv + ciphertext"
        number interval "1 | 5 | 10 | 30"
        number lastPoll "epoch ms"
    }
    GROUP {
        string id "crypto.randomUUID()"
        string name "e.g. Reviews"
        string color "grey|blue|red|yellow|green|pink|purple|cyan"
        string query "GitHub search query"
        number chromeGroupId "ephemeral Chrome ID"
        number prCount "runtime"
        string lastError "runtime"
    }
    STORAGE ||--o{ GROUP : "groups[]"
```

## Permissions

| Permission | Why |
|---|---|
| `tabs` | Create, query, and close tabs |
| `tabGroups` | Manage color-coded tab groups |
| `storage` | Persist encrypted PAT, settings, and groups |
| `alarms` | Schedule periodic polling |
| `https://api.github.com/*` | GitHub API access |

## Security

The PAT is encrypted before storage and never exposed to the popup UI. See [SECURITY.md](SECURITY.md) for full details on the threat model, implemented controls, and known limitations.
