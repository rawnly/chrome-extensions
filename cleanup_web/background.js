// Cleanup Web - Background Service Worker

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "hidden-count") {
    const text = msg.count > 0 ? String(msg.count) : "";
    chrome.action.setBadgeText({ text, tabId: sender.tab?.id });
    chrome.action.setBadgeBackgroundColor({ color: "#3b82f6" });
  }

  if (msg.type === "rule-added") {
    const text = msg.count > 0 ? String(msg.count) : "";
    if (sender.tab?.id) {
      chrome.action.setBadgeText({ text, tabId: sender.tab.id });
      chrome.action.setBadgeBackgroundColor({ color: "#3b82f6" });
    }
  }

  if (msg.type === "picker-closed") {
    // nothing extra needed, popup will query state
  }

  if (msg.type === "start-picker") {
    chrome.scripting.executeScript({
      target: { tabId: msg.tabId },
      files: ["content/picker.js"],
    });
  }

  if (msg.type === "stop-picker") {
    chrome.tabs.sendMessage(msg.tabId, { type: "stop-picker" });
  }

  if (msg.type === "clear-rules") {
    chrome.storage.local.get("rules", (data) => {
      const rules = data.rules || {};
      delete rules[msg.hostname];
      chrome.storage.local.set({ rules }, () => {
        // Notify the content script to un-hide elements
        chrome.tabs.sendMessage(msg.tabId, {
          type: "rules-cleared",
          hostname: msg.hostname,
        });
        // Clear badge
        chrome.action.setBadgeText({ text: "", tabId: msg.tabId });
        sendResponse({ ok: true });
      });
    });
    return true; // async sendResponse
  }

  if (msg.type === "get-rules-count") {
    chrome.storage.local.get("rules", (data) => {
      const rules = data.rules || {};
      const siteRules = rules[msg.hostname] || [];
      sendResponse({ count: siteRules.length });
    });
    return true;
  }
});
