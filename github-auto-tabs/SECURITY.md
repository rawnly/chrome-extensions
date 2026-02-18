# Security — GitHub Auto Tabs

## Threat model

This extension handles a GitHub Personal Access Token (PAT) with repo/read scope. The primary threats are:

1. **Token exfiltration** — an attacker reading the PAT from storage or in transit
2. **Token abuse** — unauthorized use of the PAT via the extension's messaging API
3. **Malicious input** — crafted API responses leading to XSS or navigation to attacker-controlled URLs

## Implemented controls

### PAT encryption at rest (AES-256-GCM)

The PAT is never stored in plaintext. Before writing to `chrome.storage.local`, it is encrypted using AES-256-GCM via the Web Crypto API.

- A random 16-byte salt and 12-byte IV are generated per encryption
- An AES-256-GCM key is derived via PBKDF2 (100,000 iterations, SHA-256) from `chrome.runtime.id` + salt
- The stored object (`patEncrypted`) contains base64-encoded `salt`, `iv`, and `ciphertext`
- The key is never persisted — it is re-derived on every access

**Limitation:** The derivation input (`chrome.runtime.id`) is a fixed, public value. This protects against bulk storage dumps and casual disk access but not a targeted attacker who knows the extension ID and can read `chrome.storage.local` directly. A user-supplied passphrase would be stronger but impractical for an always-on polling extension.

### PAT never sent to popup

The `get-status` message handler returns only:
- `hasPat` (boolean) — whether a token is configured
- `patMasked` (string) — e.g. `ghp_••••ab3f`

The full token never leaves the service worker context via messaging.

### Token validation on save

Before storing a new PAT, the extension calls `GET https://api.github.com/user` with the token. If the response is 401 or 403, the token is rejected and not stored. The authenticated username is returned to the popup for confirmation.

### PR URL validation

URLs returned by the GitHub Search API are filtered against:

```
/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/
```

Any URL not matching this pattern is silently discarded, preventing the extension from opening tabs to unexpected destinations.

### Minimal permissions

| Permission | Reason |
|---|---|
| `tabs` | Create, query, and remove tabs in the review group |
| `tabGroups` | Create and manage the "Reviews" tab group |
| `storage` | Persist encrypted PAT, interval, and poll state |
| `alarms` | Schedule periodic polling |
| `https://api.github.com/*` | Fetch review requests and validate tokens |

`https://github.com/*` is **not** requested — `chrome.tabs.create({ url })` does not require host permissions.

### Input sanitization

- `save-settings` destructures only `pat` and `interval` from the message payload; all other fields are ignored
- `interval` is validated against an allowlist (`[1, 5, 10, 30]`); invalid values fall back to the default (5 minutes)
- All DOM writes in the popup use `.textContent`, never `.innerHTML`

### Rate-limit backoff

On HTTP 403 or 429 responses, the extension reads the `Retry-After` or `X-RateLimit-Reset` header and stores a `backoffUntil` timestamp in memory. Subsequent poll cycles are skipped until the backoff expires, preventing token revocation due to excessive requests.

## Known limitations

- **Encryption key is deterministic** — see the limitation note above under PAT encryption
- **No pagination** — the search query uses `per_page=50`; users with more than 50 pending reviews will see a truncated list
- **Service worker lifecycle** — Chrome may terminate the service worker between alarms; in-memory state (`backoffUntil`) resets on restart, which is acceptable since backoff durations are short

## Reporting vulnerabilities

If you discover a security issue, please open a private report via the repository's GitHub Security Advisories tab rather than a public issue.
