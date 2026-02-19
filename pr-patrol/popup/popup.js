const pollBtn = document.getElementById("poll-btn");
const lastPollEl = document.getElementById("last-poll");
const errorEl = document.getElementById("error");
const groupsList = document.getElementById("groups-list");
const gearBtn = document.getElementById("gear-btn");

function renderGroups(groups) {
  groupsList.textContent = "";

  if (!groups || groups.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No groups configured";
    groupsList.appendChild(empty);
    return;
  }

  for (const group of groups) {
    const row = document.createElement("div");
    row.className = "group-row";

    const dot = document.createElement("span");
    dot.className = `color-dot color-dot--${group.color}`;
    row.appendChild(dot);

    const name = document.createElement("span");
    name.className = "group-name";
    name.textContent = group.name;
    row.appendChild(name);

    const count = document.createElement("span");
    count.className = "group-count";
    count.textContent = group.prCount ?? 0;
    row.appendChild(count);

    groupsList.appendChild(row);

    if (group.lastError) {
      const err = document.createElement("div");
      err.className = "group-error";
      err.textContent = group.lastError;
      groupsList.appendChild(err);
    }
  }
}

function loadStatus() {
  chrome.runtime.sendMessage({ type: "get-status" }, (data) => {
    if (!data) return;
    renderGroups(data.groups);
    if (data.lastPoll) lastPollEl.textContent = formatTime(data.lastPoll);
    if (!data.hasPat) {
      errorEl.textContent = "No PAT configured — open Settings";
      errorEl.hidden = false;
    } else {
      errorEl.hidden = true;
    }
  });
}

loadStatus();

gearBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

pollBtn.addEventListener("click", () => {
  pollBtn.disabled = true;
  pollBtn.textContent = "Polling...";
  chrome.runtime.sendMessage({ type: "poll-now" }, () => {
    pollBtn.disabled = false;
    pollBtn.textContent = "Poll Now";
    loadStatus();
  });
});

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
