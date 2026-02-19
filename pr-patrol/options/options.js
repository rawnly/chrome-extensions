const CHROME_COLORS = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan"];

const patInput = document.getElementById("pat");
const patHint = document.getElementById("pat-hint");
const savePatBtn = document.getElementById("save-pat-btn");
const patFeedback = document.getElementById("pat-feedback");
const intervalSelect = document.getElementById("interval");
const saveIntervalBtn = document.getElementById("save-interval-btn");
const intervalFeedback = document.getElementById("interval-feedback");
const groupsContainer = document.getElementById("groups-container");
const addGroupBtn = document.getElementById("add-group-btn");
const saveGroupsBtn = document.getElementById("save-groups-btn");
const groupsFeedback = document.getElementById("groups-feedback");

let groupsState = [];

// --- Init ---

chrome.runtime.sendMessage({ type: "get-status" }, (status) => {
  if (!status) return;
  if (status.hasPat) {
    patHint.textContent = `Current: ${status.patMasked}`;
  }
  if (status.interval) {
    intervalSelect.value = String(status.interval);
  }
});

chrome.runtime.sendMessage({ type: "get-groups" }, (res) => {
  if (!res || !res.groups) return;
  groupsState = res.groups;
  renderGroups();
});

// --- PAT ---

savePatBtn.addEventListener("click", () => {
  const pat = patInput.value.trim();
  if (!pat) {
    showFeedback(patFeedback, "Enter a token first", false);
    return;
  }

  savePatBtn.disabled = true;
  savePatBtn.textContent = "Validating...";
  patFeedback.textContent = "";

  chrome.runtime.sendMessage(
    { type: "save-settings", settings: { pat, interval: Number(intervalSelect.value) } },
    (res) => {
      savePatBtn.disabled = false;
      savePatBtn.textContent = "Save Token";
      if (!res) return;
      if (res.ok) {
        const msg = res.username ? `Saved! (@${res.username})` : "Saved!";
        showFeedback(patFeedback, msg, true);
        patInput.value = "";
        patHint.textContent = `Current: ${pat.slice(0, 4)}••••${pat.slice(-4)}`;
      } else {
        showFeedback(patFeedback, res.error, false);
      }
    }
  );
});

// --- Interval ---

saveIntervalBtn.addEventListener("click", () => {
  saveIntervalBtn.disabled = true;
  intervalFeedback.textContent = "";

  chrome.runtime.sendMessage(
    { type: "save-settings", settings: { interval: Number(intervalSelect.value) } },
    (res) => {
      saveIntervalBtn.disabled = false;
      if (!res) return;
      if (res.ok) {
        showFeedback(intervalFeedback, "Saved!", true);
      } else {
        showFeedback(intervalFeedback, res.error, false);
      }
    }
  );
});

// --- Groups ---

function renderGroups() {
  groupsContainer.textContent = "";
  for (let i = 0; i < groupsState.length; i++) {
    groupsContainer.appendChild(createGroupCard(groupsState[i], i));
  }
}

function createGroupCard(group, index) {
  const card = document.createElement("div");
  card.className = "group-card";

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "btn btn--danger btn--sm delete-btn";
  deleteBtn.textContent = "Delete";
  deleteBtn.addEventListener("click", () => {
    const id = group.id;
    groupsState.splice(index, 1);
    renderGroups();
    // Immediately tell background to close the tab group and persist removal
    if (id) {
      chrome.runtime.sendMessage({ type: "delete-group", groupId: id });
    }
  });
  card.appendChild(deleteBtn);

  const nameLabel = document.createElement("label");
  nameLabel.textContent = "Name";
  card.appendChild(nameLabel);
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = group.name;
  nameInput.placeholder = "Group name";
  nameInput.addEventListener("input", () => {
    groupsState[index].name = nameInput.value;
  });
  card.appendChild(nameInput);

  const colorLabel = document.createElement("label");
  colorLabel.textContent = "Color";
  card.appendChild(colorLabel);
  const colorSelect = document.createElement("select");
  for (const c of CHROME_COLORS) {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    if (c === group.color) opt.selected = true;
    colorSelect.appendChild(opt);
  }
  colorSelect.addEventListener("change", () => {
    groupsState[index].color = colorSelect.value;
  });
  card.appendChild(colorSelect);

  const queryLabel = document.createElement("label");
  queryLabel.textContent = "GitHub Search Query";
  card.appendChild(queryLabel);
  const queryInput = document.createElement("input");
  queryInput.type = "text";
  queryInput.className = "mono";
  queryInput.value = group.query;
  queryInput.placeholder = "is:pr is:open review-requested:@me";
  queryInput.addEventListener("input", () => {
    groupsState[index].query = queryInput.value;
  });
  card.appendChild(queryInput);

  return card;
}

addGroupBtn.addEventListener("click", () => {
  groupsState.push({
    id: crypto.randomUUID(),
    name: "",
    color: "blue",
    query: "",
  });
  renderGroups();
});

saveGroupsBtn.addEventListener("click", () => {
  groupsFeedback.textContent = "";

  for (const g of groupsState) {
    if (!g.name || !g.name.trim()) {
      showFeedback(groupsFeedback, "Group name cannot be empty", false);
      return;
    }
    if (!g.query || !g.query.trim()) {
      showFeedback(groupsFeedback, "Group query cannot be empty", false);
      return;
    }
  }

  saveGroupsBtn.disabled = true;
  saveGroupsBtn.textContent = "Saving...";

  chrome.runtime.sendMessage({ type: "save-groups", groups: groupsState }, (res) => {
    saveGroupsBtn.disabled = false;
    saveGroupsBtn.textContent = "Save Groups";
    if (!res) return;
    if (res.ok) {
      showFeedback(groupsFeedback, "Saved!", true);
    } else {
      showFeedback(groupsFeedback, res.error, false);
    }
  });
});

// --- Helpers ---

function showFeedback(el, message, success) {
  el.textContent = message;
  el.className = success ? "feedback feedback--ok" : "feedback feedback--err";
  if (success) {
    setTimeout(() => { el.textContent = ""; }, 3000);
  }
}
