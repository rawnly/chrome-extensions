const ALARM_NAME = "github-review-poll";
const DEFAULT_INTERVAL = 5;
const VALID_INTERVALS = [1, 5, 10, 30];
const PR_URL_PATTERN =
  /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(pull|issue)s?\/\d+$/;
const CHROME_COLORS = [
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
];
const DEFAULT_GROUP = {
  name: "Reviews",
  color: "blue",
  query: "is:pr is:open review-requested:@me",
};

let backoffUntil = 0;

// --- Crypto helpers (AES-256-GCM via Web Crypto) ---

async function deriveKey(salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(chrome.runtime.id),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptPat(pat) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(pat),
  );
  return {
    salt: btoa(String.fromCharCode(...salt)),
    iv: btoa(String.fromCharCode(...iv)),
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
  };
}

async function decryptPat(envelope) {
  const salt = Uint8Array.from(atob(envelope.salt), (c) => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(envelope.iv), (c) => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(envelope.ciphertext), (c) =>
    c.charCodeAt(0),
  );
  const key = await deriveKey(salt);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext,
  );
  return new TextDecoder().decode(plaintext);
}

async function getStoredPat() {
  const { patEncrypted } = await chrome.storage.local.get("patEncrypted");
  if (!patEncrypted) return null;
  try {
    return await decryptPat(patEncrypted);
  } catch {
    return null;
  }
}

function maskPat(pat) {
  if (!pat || pat.length < 8) return "••••••••";
  return pat.slice(0, 4) + "••••" + pat.slice(-4);
}

// --- PAT validation ---

async function validateToken(pat) {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error("Invalid or expired token");
  }
  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status}`);
  }
  const user = await res.json();
  return user.login;
}

// --- Storage helpers ---

async function getGroups() {
  const { groups } = await chrome.storage.local.get("groups");
  return groups || [];
}

async function saveGroups(groups) {
  await chrome.storage.local.set({ groups });
}

// --- Migration ---

async function migrateStorage() {
  const data = await chrome.storage.local.get([
    "pat",
    "patEncrypted",
    "groups",
    "groupId",
    "prCount",
    "lastError",
  ]);

  // Step 1: encrypt raw PAT from older versions
  if (data.pat && !data.patEncrypted) {
    const envelope = await encryptPat(data.pat);
    await chrome.storage.local.set({ patEncrypted: envelope });
    await chrome.storage.local.remove("pat");
  }

  // Step 2: migrate flat keys to groups array
  if (!data.groups) {
    const defaultGroup = {
      id: crypto.randomUUID(),
      ...DEFAULT_GROUP,
      chromeGroupId: data.groupId ?? null,
      prCount: data.prCount ?? 0,
      lastError: data.lastError ?? null,
    };
    await chrome.storage.local.set({ groups: [defaultGroup] });
    await chrome.storage.local.remove(["groupId", "prCount", "lastError"]);
  }
}

// --- Lifecycle ---

chrome.runtime.onInstalled.addListener(() => {
  migrateStorage().then(() => setupAlarm());
});

chrome.runtime.onStartup.addListener(() => {
  migrateStorage().then(() => setupAlarm());
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    pollAndReconcile();
  }
});

// When a new window opens, re-poll so groups are recreated immediately
// (Chrome destroys tab groups when their window closes)
chrome.windows.onCreated.addListener(() => {
  pollAndReconcile();
});

// --- Message handlers ---

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "poll-now") {
    pollAndReconcile().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === "save-settings") {
    handleSaveSettings(msg.settings).then(sendResponse);
    return true;
  }

  if (msg.type === "get-status") {
    handleGetStatus().then(sendResponse);
    return true;
  }

  if (msg.type === "get-groups") {
    getGroups().then((groups) => sendResponse({ groups }));
    return true;
  }

  if (msg.type === "save-groups") {
    handleSaveGroups(msg.groups).then(sendResponse);
    return true;
  }

  if (msg.type === "delete-group") {
    handleDeleteGroup(msg.groupId).then(sendResponse);
    return true;
  }
});

async function handleSaveSettings(settings) {
  const { pat, interval } = settings || {};

  const safeInterval = VALID_INTERVALS.includes(Number(interval))
    ? Number(interval)
    : DEFAULT_INTERVAL;

  if (pat && pat.trim()) {
    try {
      const username = await validateToken(pat.trim());
      const envelope = await encryptPat(pat.trim());
      await chrome.storage.local.set({
        patEncrypted: envelope,
        interval: safeInterval,
      });
      await chrome.storage.local.remove("pat");
      setupAlarm(safeInterval);
      return { ok: true, username };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  await chrome.storage.local.set({ interval: safeInterval });
  setupAlarm(safeInterval);
  return { ok: true };
}

async function handleGetStatus() {
  const data = await chrome.storage.local.get([
    "patEncrypted",
    "interval",
    "lastPoll",
  ]);
  const pat = await getStoredPat();
  const groups = await getGroups();
  return {
    hasPat: !!pat,
    patMasked: pat ? maskPat(pat) : null,
    interval: data.interval,
    lastPoll: data.lastPoll,
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      color: g.color,
      prCount: g.prCount ?? 0,
      lastError: g.lastError ?? null,
    })),
  };
}

async function handleSaveGroups(incoming) {
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return { ok: false, error: "At least one group is required" };
  }

  for (const g of incoming) {
    if (!g.name || !g.name.trim()) {
      return { ok: false, error: "Group name cannot be empty" };
    }
    if (!g.query || !g.query.trim()) {
      return { ok: false, error: "Group query cannot be empty" };
    }
    if (!CHROME_COLORS.includes(g.color)) {
      return { ok: false, error: `Invalid color: ${g.color}` };
    }
  }

  const existing = await getGroups();
  const existingById = new Map(existing.map((g) => [g.id, g]));
  const incomingIds = new Set(incoming.map((g) => g.id));

  // Close Chrome tab groups for removed entries
  for (const old of existing) {
    if (!incomingIds.has(old.id) && old.chromeGroupId != null) {
      try {
        const allTabs = await chrome.tabs.query({});
        const groupTabs = allTabs.filter(
          (t) => t.groupId === old.chromeGroupId,
        );
        if (groupTabs.length > 0) {
          await chrome.tabs.remove(groupTabs.map((t) => t.id));
        }
      } catch {
        // group already gone
      }
    }
  }

  // Determine which groups need a fresh poll:
  // - new groups (no previous entry)
  // - groups whose query changed
  const dirtyIds = new Set();
  for (const g of incoming) {
    const prev = existingById.get(g.id);
    if (!prev || prev.query !== g.query.trim()) {
      dirtyIds.add(g.id);
    }
  }

  // Build new groups array, merging runtime state for surviving entries
  const newGroups = incoming.map((g) => {
    const prev = existingById.get(g.id);
    const queryChanged = !prev || prev.query !== g.query.trim();
    return {
      id: g.id,
      name: g.name.trim(),
      color: g.color,
      query: g.query.trim(),
      // Reset chromeGroupId if query changed — old tabs are stale
      chromeGroupId: queryChanged ? null : (prev ? prev.chromeGroupId : null),
      prCount: queryChanged ? 0 : (prev ? prev.prCount : 0),
      lastError: queryChanged ? null : (prev ? prev.lastError : null),
    };
  });

  await saveGroups(newGroups);

  // Close stale Chrome tab groups for groups whose query changed
  for (const g of incoming) {
    const prev = existingById.get(g.id);
    if (prev && prev.query !== g.query.trim() && prev.chromeGroupId != null) {
      try {
        const allTabs = await chrome.tabs.query({});
        const groupTabs = allTabs.filter(
          (t) => t.groupId === prev.chromeGroupId,
        );
        if (groupTabs.length > 0) {
          await chrome.tabs.remove(groupTabs.map((t) => t.id));
        }
      } catch {
        // group already gone
      }
    }
  }

  // Poll only the changed/new groups in the background
  if (dirtyIds.size > 0) {
    pollAndReconcile(dirtyIds);
  }

  return { ok: true };
}

async function handleDeleteGroup(groupId) {
  if (!groupId) return { ok: false, error: "Missing group ID" };

  const groups = await getGroups();
  const target = groups.find((g) => g.id === groupId);
  if (!target) return { ok: false, error: "Group not found" };

  // Close its Chrome tab group
  if (target.chromeGroupId != null) {
    try {
      const allTabs = await chrome.tabs.query({});
      const groupTabs = allTabs.filter(
        (t) => t.groupId === target.chromeGroupId,
      );
      if (groupTabs.length > 0) {
        await chrome.tabs.remove(groupTabs.map((t) => t.id));
      }
    } catch {
      // group already gone
    }
  }

  const remaining = groups.filter((g) => g.id !== groupId);
  await saveGroups(remaining);
  return { ok: true };
}

// --- Alarm ---

async function setupAlarm(interval) {
  if (!interval) {
    const data = await chrome.storage.local.get("interval");
    interval = data.interval || DEFAULT_INTERVAL;
  }
  await chrome.alarms.clear(ALARM_NAME);
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: interval });
}

// --- Polling ---

// onlyGroupIds: optional Set of group IDs to poll.
// If null/undefined, polls all groups.
async function pollAndReconcile(onlyGroupIds) {
  if (Date.now() < backoffUntil) return;

  const pat = await getStoredPat();
  if (!pat) {
    updateBadge("");
    return;
  }

  const groups = await getGroups();
  if (groups.length === 0) {
    updateBadge("");
    await chrome.storage.local.set({ lastPoll: Date.now() });
    return;
  }

  let rateLimited = false;

  for (const group of groups) {
    // Skip groups not in the filter (if a filter is set)
    if (onlyGroupIds && !onlyGroupIds.has(group.id)) continue;

    if (rateLimited) {
      group.lastError = "Skipped — rate limited";
      continue;
    }

    try {
      const prs = await fetchPRsForQuery(pat, group.query);
      group.prCount = prs.length;
      group.lastError = null;

      const updatedChromeGroupId = await reconcileTabsForGroup(prs, group);
      group.chromeGroupId = updatedChromeGroupId;
    } catch (err) {
      group.lastError = err.message;
      if (err.message.includes("Rate limited")) {
        rateLimited = true;
      }
    }
  }

  // Badge always reflects total across ALL groups
  const totalPrCount = groups.reduce((sum, g) => sum + (g.prCount ?? 0), 0);

  await saveGroups(groups);
  await chrome.storage.local.set({ lastPoll: Date.now() });
  updateBadge(totalPrCount > 0 ? String(totalPrCount) : "");
}

async function fetchPRsForQuery(pat, query) {
  const encoded = encodeURIComponent(query);
  const url = `https://api.github.com/search/issues?q=${encoded}&per_page=50`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: "application/vnd.github+json",
    },
  });

  if (res.status === 401) {
    throw new Error("Authentication failed. Check your PAT.");
  }
  if (res.status === 403 || res.status === 429) {
    const retryAfter = res.headers.get("Retry-After");
    const rateLimitReset = res.headers.get("X-RateLimit-Reset");
    if (retryAfter) {
      backoffUntil = Date.now() + Number(retryAfter) * 1000;
    } else if (rateLimitReset) {
      backoffUntil = Number(rateLimitReset) * 1000;
    } else {
      backoffUntil = Date.now() + 60_000;
    }
    throw new Error("Rate limited. Will retry after backoff.");
  }
  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status}`);
  }

  const data = await res.json();
  return data.items
    .map((item) => ({
      url: normalizeUrl(item.html_url),
      title: item.title,
      number: item.number,
    }))
    .filter((pr) => PR_URL_PATTERN.test(pr.url));
}

function normalizeUrl(url) {
  return url.replace(/\/+$/, "");
}

// --- Tab reconciliation ---

async function getLastFocusedWindowId() {
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
    return win.id;
  } catch {
    const allWindows = await chrome.windows.getAll({ windowTypes: ["normal"] });
    return allWindows.length > 0 ? allWindows[0].id : undefined;
  }
}

async function reconcileTabsForGroup(prs, groupConfig) {
  const prUrls = new Set(prs.map((pr) => pr.url));

  // --- Resolve Chrome tab group: stored ID → name+color scan → null ---
  let groupId = groupConfig.chromeGroupId;
  let groupWindowId = null;

  if (groupId != null) {
    try {
      const tg = await chrome.tabGroups.get(groupId);
      groupWindowId = tg.windowId;
    } catch {
      groupId = null;
    }
  }

  // Stored ID was stale — find by name+color (Chrome reassigns IDs across windows)
  if (groupId == null) {
    try {
      const found = await chrome.tabGroups.query({
        title: groupConfig.name,
        color: groupConfig.color,
      });
      if (found.length > 0) {
        groupId = found[0].id;
        groupWindowId = found[0].windowId;
      }
    } catch {
      // query unavailable
    }
  }

  // --- No PRs: tear down ---
  if (prs.length === 0) {
    if (groupId != null) {
      try {
        const tabs = await chrome.tabs.query({});
        const ids = tabs.filter((t) => t.groupId === groupId).map((t) => t.id);
        if (ids.length > 0) await chrome.tabs.remove(ids);
      } catch { /* already gone */ }
    }
    return null;
  }

  // --- Group exists: reconcile tabs ---
  if (groupId != null) {
    const allTabs = await chrome.tabs.query({ windowId: groupWindowId });
    const groupTabs = allTabs.filter((t) => t.groupId === groupId);
    const groupUrls = new Map();
    for (const tab of groupTabs) {
      groupUrls.set(normalizeUrl(tab.url || ""), tab.id);
    }

    // Close tabs no longer in PR list
    const toClose = [];
    for (const [url, tabId] of groupUrls) {
      if (!prUrls.has(url)) toClose.push(tabId);
    }
    if (toClose.length > 0) {
      try { await chrome.tabs.remove(toClose); } catch { /* gone */ }
    }

    // Open new PR tabs
    const existingUrls = new Set(groupUrls.keys());
    const toOpen = prs.filter((pr) => !existingUrls.has(pr.url));
    if (toOpen.length > 0) {
      try {
        const newIds = [];
        for (const pr of toOpen) {
          const tab = await chrome.tabs.create({
            url: pr.url, active: false, windowId: groupWindowId,
          });
          newIds.push(tab.id);
        }
        await chrome.tabs.group({ tabIds: newIds, groupId });
      } catch { /* window/group closed mid-reconcile */ }
    }

    // Sync title/color
    try {
      await chrome.tabGroups.update(groupId, {
        title: groupConfig.name, color: groupConfig.color,
      });
    } catch { /* gone */ }

    return groupId;
  }

  // --- No group found: create, reusing any existing tabs with matching URLs ---
  const windowId = await getLastFocusedWindowId();
  const allTabs = await chrome.tabs.query({});
  const existingByUrl = new Map();
  for (const tab of allTabs) {
    const url = normalizeUrl(tab.url || "");
    if (prUrls.has(url)) existingByUrl.set(url, tab.id);
  }

  const tabIds = [];
  for (const pr of prs) {
    if (existingByUrl.has(pr.url)) {
      tabIds.push(existingByUrl.get(pr.url));
    } else {
      const tab = await chrome.tabs.create({
        url: pr.url, active: false, windowId,
      });
      tabIds.push(tab.id);
    }
  }

  groupId = await chrome.tabs.group({ tabIds });
  await chrome.tabGroups.update(groupId, {
    title: groupConfig.name, color: groupConfig.color,
  });

  return groupId;
}

function updateBadge(text) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: "#3b82f6" });
}
