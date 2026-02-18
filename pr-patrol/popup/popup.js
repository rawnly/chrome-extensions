const patInput = document.getElementById("pat");
const intervalSelect = document.getElementById("interval");
const saveBtn = document.getElementById("save-btn");
const pollBtn = document.getElementById("poll-btn");
const prCountEl = document.getElementById("pr-count");
const lastPollEl = document.getElementById("last-poll");
const errorEl = document.getElementById("error");

// Load current state
chrome.runtime.sendMessage({ type: "get-status" }, (data) => {
  if (!data) return;
  if (data.hasPat) patInput.placeholder = data.patMasked || "••••••••";
  if (data.interval) intervalSelect.value = String(data.interval);
  if (data.prCount != null) prCountEl.textContent = data.prCount;
  if (data.lastPoll) lastPollEl.textContent = formatTime(data.lastPoll);
  if (data.lastError) {
    errorEl.textContent = data.lastError;
    errorEl.hidden = false;
  }
});

saveBtn.addEventListener("click", () => {
  const pat = patInput.value.trim();
  const interval = Number(intervalSelect.value);

  saveBtn.disabled = true;
  saveBtn.textContent = pat ? "Validating..." : "Saving...";
  errorEl.hidden = true;

  chrome.runtime.sendMessage(
    { type: "save-settings", settings: { pat, interval } },
    (res) => {
      saveBtn.disabled = false;
      if (!res) {
        saveBtn.textContent = "Save";
        return;
      }
      if (res.ok) {
        const label = res.username
          ? `Saved! (@${res.username})`
          : "Saved!";
        saveBtn.textContent = label;
        if (pat) {
          patInput.value = "";
          patInput.placeholder = pat.slice(0, 4) + "••••" + pat.slice(-4);
        }
        setTimeout(() => (saveBtn.textContent = "Save"), 2000);
      } else {
        saveBtn.textContent = "Save";
        errorEl.textContent = res.error;
        errorEl.hidden = false;
      }
    }
  );
});

pollBtn.addEventListener("click", () => {
  pollBtn.disabled = true;
  pollBtn.textContent = "Polling...";
  chrome.runtime.sendMessage({ type: "poll-now" }, () => {
    pollBtn.disabled = false;
    pollBtn.textContent = "Poll Now";
    chrome.runtime.sendMessage({ type: "get-status" }, (data) => {
      if (!data) return;
      if (data.prCount != null) prCountEl.textContent = data.prCount;
      if (data.lastPoll) lastPollEl.textContent = formatTime(data.lastPoll);
      if (data.lastError) {
        errorEl.textContent = data.lastError;
        errorEl.hidden = false;
      } else {
        errorEl.hidden = true;
      }
    });
  });
});

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
