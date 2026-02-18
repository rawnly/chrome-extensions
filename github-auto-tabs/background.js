const ALARM_NAME = "github-review-poll";
const GROUP_TITLE = "Reviews";
const GROUP_COLOR = "blue";
const DEFAULT_INTERVAL = 5;
const VALID_INTERVALS = [1, 5, 10, 30];
const PR_URL_PATTERN = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/;

let backoffUntil = 0;

// --- Crypto helpers (AES-256-GCM via Web Crypto) ---

async function deriveKey(salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(chrome.runtime.id),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptPat(pat) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(pat)
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
    c.charCodeAt(0)
  );
  const key = await deriveKey(salt);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
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

// --- Migration: encrypt raw PAT from older versions ---

async function migrateRawPat() {
  const { pat, patEncrypted } = await chrome.storage.local.get([
    "pat",
    "patEncrypted",
  ]);
  if (pat && !patEncrypted) {
    const envelope = await encryptPat(pat);
    await chrome.storage.local.set({ patEncrypted: envelope });
    await chrome.storage.local.remove("pat");
  }
}

// --- Lifecycle ---

chrome.runtime.onInstalled.addListener(() => {
  migrateRawPat().then(() => setupAlarm());
});

chrome.runtime.onStartup.addListener(() => {
  migrateRawPat().then(() => setupAlarm());
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    pollAndReconcile();
  }
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
});

async function handleSaveSettings(settings) {
  const { pat, interval } = settings || {};

  // Validate interval
  const safeInterval = VALID_INTERVALS.includes(Number(interval))
    ? Number(interval)
    : DEFAULT_INTERVAL;

  // Validate and encrypt PAT if provided
  if (pat && pat.trim()) {
    try {
      const username = await validateToken(pat.trim());
      const envelope = await encryptPat(pat.trim());
      await chrome.storage.local.set({
        patEncrypted: envelope,
        interval: safeInterval,
      });
      // Remove legacy raw pat if it exists
      await chrome.storage.local.remove("pat");
      setupAlarm(safeInterval);
      return { ok: true, username };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  // No PAT change — just update interval
  await chrome.storage.local.set({ interval: safeInterval });
  setupAlarm(safeInterval);
  return { ok: true };
}

async function handleGetStatus() {
  const data = await chrome.storage.local.get([
    "patEncrypted",
    "interval",
    "lastPoll",
    "lastError",
    "prCount",
  ]);
  const pat = await getStoredPat();
  return {
    hasPat: !!pat,
    patMasked: pat ? maskPat(pat) : null,
    interval: data.interval,
    lastPoll: data.lastPoll,
    lastError: data.lastError,
    prCount: data.prCount,
  };
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

async function pollAndReconcile() {
  if (Date.now() < backoffUntil) return;

  const pat = await getStoredPat();
  if (!pat) {
    updateBadge("");
    return;
  }

  let prs;
  try {
    prs = await fetchReviewRequests(pat);
  } catch (err) {
    await chrome.storage.local.set({
      lastError: err.message,
      lastPoll: Date.now(),
    });
    return;
  }

  backoffUntil = 0;

  await chrome.storage.local.set({
    lastError: null,
    lastPoll: Date.now(),
    prCount: prs.length,
  });

  await reconcileTabs(prs);
  updateBadge(prs.length > 0 ? String(prs.length) : "");
}

async function fetchReviewRequests(pat) {
  const url =
    "https://api.github.com/search/issues?q=is:pr+is:open+review-requested:@me&per_page=50";
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

async function reconcileTabs(prs) {
  const groupId = await getOrCreateGroup(prs);
  if (groupId === null) return;

  const prUrls = new Set(prs.map((pr) => pr.url));

  const allTabs = await chrome.tabs.query({});
  const groupTabs = allTabs.filter((t) => t.groupId === groupId);
  const groupUrls = new Map();
  for (const tab of groupTabs) {
    groupUrls.set(normalizeUrl(tab.url || ""), tab.id);
  }

  const toClose = [];
  for (const [url, tabId] of groupUrls) {
    if (!prUrls.has(url)) {
      toClose.push(tabId);
    }
  }
  if (toClose.length > 0) {
    await chrome.tabs.remove(toClose);
  }

  const existingUrls = new Set(groupUrls.keys());
  const toOpen = prs.filter((pr) => !existingUrls.has(pr.url));
  if (toOpen.length > 0) {
    const newTabIds = [];
    for (const pr of toOpen) {
      const tab = await chrome.tabs.create({ url: pr.url, active: false });
      newTabIds.push(tab.id);
    }
    await chrome.tabs.group({ tabIds: newTabIds, groupId });
  }
}

async function getOrCreateGroup(prs) {
  if (prs.length === 0) {
    const { groupId } = await chrome.storage.local.get("groupId");
    if (groupId != null) {
      try {
        const allTabs = await chrome.tabs.query({});
        const groupTabs = allTabs.filter((t) => t.groupId === groupId);
        if (groupTabs.length > 0) {
          await chrome.tabs.remove(groupTabs.map((t) => t.id));
        }
      } catch {
        // group already gone
      }
      await chrome.storage.local.remove("groupId");
    }
    return null;
  }

  const { groupId } = await chrome.storage.local.get("groupId");

  if (groupId != null) {
    try {
      await chrome.tabGroups.get(groupId);
      return groupId;
    } catch {
      // Group was closed/invalid, will recreate
    }
  }

  const firstTab = await chrome.tabs.create({
    url: prs[0].url,
    active: false,
  });
  const newGroupId = await chrome.tabs.group({ tabIds: [firstTab.id] });
  await chrome.tabGroups.update(newGroupId, {
    title: GROUP_TITLE,
    color: GROUP_COLOR,
  });

  if (prs.length > 1) {
    const moreTabIds = [];
    for (let i = 1; i < prs.length; i++) {
      const tab = await chrome.tabs.create({
        url: prs[i].url,
        active: false,
      });
      moreTabIds.push(tab.id);
    }
    await chrome.tabs.group({ tabIds: moreTabIds, groupId: newGroupId });
  }

  await chrome.storage.local.set({ groupId: newGroupId });
  return null;
}

function updateBadge(text) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: "#3b82f6" });
}
