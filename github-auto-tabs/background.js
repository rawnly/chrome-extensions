const ALARM_NAME = "github-review-poll";
const GROUP_TITLE = "Reviews";
const GROUP_COLOR = "blue";
const DEFAULT_INTERVAL = 5;

chrome.runtime.onInstalled.addListener(() => {
  setupAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  setupAlarm();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    pollAndReconcile();
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "poll-now") {
    pollAndReconcile().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === "save-settings") {
    chrome.storage.local.set(msg.settings, () => {
      setupAlarm(msg.settings.interval);
      sendResponse({ ok: true });
    });
    return true;
  }
  if (msg.type === "get-status") {
    chrome.storage.local.get(
      ["pat", "interval", "lastPoll", "lastError", "prCount"],
      (data) => sendResponse(data)
    );
    return true;
  }
});

async function setupAlarm(interval) {
  if (!interval) {
    const data = await chrome.storage.local.get("interval");
    interval = data.interval || DEFAULT_INTERVAL;
  }
  await chrome.alarms.clear(ALARM_NAME);
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: interval });
}

async function pollAndReconcile() {
  const { pat } = await chrome.storage.local.get("pat");
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
    throw new Error("Rate limited. Will retry at next interval.");
  }
  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status}`);
  }

  const data = await res.json();
  return data.items.map((item) => ({
    url: normalizeUrl(item.html_url),
    title: item.title,
    number: item.number,
  }));
}

function normalizeUrl(url) {
  return url.replace(/\/+$/, "");
}

async function reconcileTabs(prs) {
  const groupId = await getOrCreateGroup(prs);
  if (groupId === null) return;

  const prUrls = new Set(prs.map((pr) => pr.url));

  // Get current tabs in the group
  const allTabs = await chrome.tabs.query({});
  const groupTabs = allTabs.filter((t) => t.groupId === groupId);
  const groupUrls = new Map();
  for (const tab of groupTabs) {
    groupUrls.set(normalizeUrl(tab.url || ""), tab.id);
  }

  // Close tabs no longer in review list
  const toClose = [];
  for (const [url, tabId] of groupUrls) {
    if (!prUrls.has(url)) {
      toClose.push(tabId);
    }
  }
  if (toClose.length > 0) {
    await chrome.tabs.remove(toClose);
  }

  // Open tabs for new PRs
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
    // No PRs — clean up existing group if any
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

  // Validate existing group
  if (groupId != null) {
    try {
      await chrome.tabGroups.get(groupId);
      return groupId;
    } catch {
      // Group was closed/invalid, will recreate
    }
  }

  // Create new group: need at least one tab first
  const firstTab = await chrome.tabs.create({
    url: prs[0].url,
    active: false,
  });
  const newGroupId = await chrome.tabs.group({ tabIds: [firstTab.id] });
  await chrome.tabGroups.update(newGroupId, {
    title: GROUP_TITLE,
    color: GROUP_COLOR,
  });

  // Add remaining PR tabs
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

  // Return null to signal that reconcileTabs should skip its own open/close
  // since we just created all tabs fresh
  return null;
}

function updateBadge(text) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: "#3b82f6" });
}
