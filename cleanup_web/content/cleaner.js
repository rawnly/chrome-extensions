// Cleanup Web - Auto-cleaner
// Runs on every page load. Hides elements that were previously removed by the user.

(function () {
  "use strict";

  const hostname = location.hostname;
  let hiddenCount = 0;
  let rules = [];

  function hideElement(el) {
    if (el.getAttribute("data-cw-hidden") != null) return false;
    el.style.setProperty("display", "none", "important");
    el.setAttribute("data-cw-hidden", "");
    return true;
  }

  function applyRules() {
    let count = 0;
    for (const rule of rules) {
      try {
        const els = document.querySelectorAll(rule.selector);
        for (const el of els) {
          if (hideElement(el)) count++;
        }
      } catch {
        // Invalid selector, skip
      }
    }
    if (count > 0) {
      hiddenCount += count;
      updateBadge();
    }
  }

  function updateBadge() {
    chrome.runtime.sendMessage({
      type: "hidden-count",
      hostname,
      count: hiddenCount,
    }).catch(() => {});
  }

  async function init() {
    const data = await chrome.storage.local.get("rules");
    const allRules = data.rules || {};
    rules = allRules[hostname] || [];

    if (rules.length === 0) return;

    // Apply immediately
    applyRules();

    // Watch for dynamic content (SPAs, lazy-loaded ads)
    const observer = new MutationObserver((mutations) => {
      let hasNewNodes = false;
      for (const m of mutations) {
        if (m.addedNodes.length > 0) {
          hasNewNodes = true;
          break;
        }
      }
      if (hasNewNodes) applyRules();
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  // Listen for new rules added while on the page
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "rules-cleared" && msg.hostname === hostname) {
      // Un-hide all elements
      const hidden = document.querySelectorAll("[data-cw-hidden]");
      for (const el of hidden) {
        el.style.removeProperty("display");
        el.removeAttribute("data-cw-hidden");
        el.classList.remove("cw-removing");
      }
      hiddenCount = 0;
      rules = [];
      updateBadge();
    }
  });

  init();
})();
