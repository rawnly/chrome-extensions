// Cleanup Web - Popup

const statusEl = document.getElementById("status");
const toggleBtn = document.getElementById("toggle");
const clearBtn = document.getElementById("clear");

let picking = false;
let currentTab = null;

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  if (!tab?.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) {
    statusEl.textContent = "Cannot run on this page.";
    toggleBtn.disabled = true;
    toggleBtn.style.opacity = "0.5";
    return;
  }

  const url = new URL(tab.url);
  const hostname = url.hostname;

  // Get rules count for this site
  chrome.runtime.sendMessage(
    { type: "get-rules-count", hostname },
    (res) => {
      const count = res?.count || 0;
      if (count > 0) {
        statusEl.textContent = count + " element" + (count > 1 ? "s" : "") + " hidden on " + hostname;
        clearBtn.style.display = "";
      } else {
        statusEl.textContent = "No hidden elements on " + hostname;
      }
    }
  );
}

toggleBtn.addEventListener("click", async () => {
  if (!currentTab) return;

  if (!picking) {
    picking = true;
    toggleBtn.textContent = "Stop picking";
    chrome.runtime.sendMessage({
      type: "start-picker",
      tabId: currentTab.id,
    });
  } else {
    picking = false;
    toggleBtn.textContent = "Start picking";
    chrome.runtime.sendMessage({
      type: "stop-picker",
      tabId: currentTab.id,
    });
  }
});

clearBtn.addEventListener("click", async () => {
  if (!currentTab?.url) return;
  const hostname = new URL(currentTab.url).hostname;

  chrome.runtime.sendMessage(
    { type: "clear-rules", hostname, tabId: currentTab.id },
    () => {
      statusEl.textContent = "Rules cleared! Reload to see changes.";
      clearBtn.style.display = "none";
    }
  );
});

init();
