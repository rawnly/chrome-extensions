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
  if (data.pat) patInput.value = data.pat;
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
  chrome.runtime.sendMessage(
    { type: "save-settings", settings: { pat, interval } },
    () => {
      saveBtn.textContent = "Saved!";
      setTimeout(() => (saveBtn.textContent = "Save"), 1500);
    }
  );
});

pollBtn.addEventListener("click", () => {
  pollBtn.disabled = true;
  pollBtn.textContent = "Polling...";
  chrome.runtime.sendMessage({ type: "poll-now" }, () => {
    pollBtn.disabled = false;
    pollBtn.textContent = "Poll Now";
    // Refresh status
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
