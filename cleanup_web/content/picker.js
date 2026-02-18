// Cleanup Web - Element Picker
// Injected on-demand when user activates pick mode.

(function () {
  "use strict";

  // Guard against double-injection
  if (window.__cwPickerActive) return;
  window.__cwPickerActive = true;

  const OVERLAY_CLASS = "cw-overlay";
  const LABEL_CLASS = "cw-overlay-label";
  const CW_ATTR = "data-cw";

  let currentTarget = null;

  // --- Overlay element ---
  const overlay = document.createElement("div");
  overlay.className = OVERLAY_CLASS;
  overlay.setAttribute(CW_ATTR, "");
  const label = document.createElement("div");
  label.className = LABEL_CLASS;
  label.setAttribute(CW_ATTR, "");
  overlay.appendChild(label);
  document.documentElement.appendChild(overlay);

  // --- Helpers ---

  function isCwElement(el) {
    return el && (el.hasAttribute?.(CW_ATTR) || el.closest?.(`[${CW_ATTR}]`));
  }

  function getElementUnderCursor(x, y) {
    overlay.style.display = "none";
    const els = document.elementsFromPoint(x, y);
    overlay.style.display = "";
    for (const el of els) {
      if (
        !isCwElement(el) &&
        el !== document.documentElement &&
        el !== document.body
      ) {
        return el;
      }
    }
    return null;
  }

  function positionOverlay(el) {
    const rect = el.getBoundingClientRect();
    overlay.style.top = rect.top + "px";
    overlay.style.left = rect.left + "px";
    overlay.style.width = rect.width + "px";
    overlay.style.height = rect.height + "px";
    overlay.style.display = "";
  }

  function selectorLabel(el) {
    let s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    else if (el.className && typeof el.className === "string") {
      const classes = el.className
        .trim()
        .split(/\s+/)
        .filter((c) => !c.startsWith("cw-"))
        .slice(0, 3);
      if (classes.length) s += "." + classes.join(".");
    }
    return s;
  }

  // --- CSS Selector Generation ---

  function generateSelector(el) {
    // 1. ID-based
    if (el.id) {
      const sel = "#" + CSS.escape(el.id);
      if (isUnique(sel)) return sel;
    }

    // 2. Tag + class combination
    const tagSel = tryTagClassSelector(el);
    if (tagSel) return tagSel;

    // 3. Build nth-of-type path
    return buildNthPath(el);
  }

  function isUnique(selector) {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  }

  function tryTagClassSelector(el) {
    if (!el.className || typeof el.className !== "string") return null;
    const tag = el.tagName.toLowerCase();
    const classes = el.className
      .trim()
      .split(/\s+/)
      .filter(
        (c) => c && !c.startsWith("cw-") && !/^[\d]/.test(c) && c.length < 80
      );

    // Try tag + all classes
    if (classes.length > 0) {
      const sel = tag + "." + classes.map(CSS.escape).join(".");
      if (isUnique(sel)) return sel;
    }

    // Try tag + individual classes
    for (const cls of classes) {
      const sel = tag + "." + CSS.escape(cls);
      if (isUnique(sel)) return sel;
    }

    // Try just classes without tag
    if (classes.length > 0) {
      const sel = "." + classes.map(CSS.escape).join(".");
      if (isUnique(sel)) return sel;
    }

    return null;
  }

  function buildNthPath(el) {
    const parts = [];
    let current = el;

    while (current && current !== document.documentElement) {
      const tag = current.tagName.toLowerCase();
      const parent = current.parentElement;

      if (current.id) {
        parts.unshift("#" + CSS.escape(current.id));
        break;
      }

      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (s) => s.tagName === current.tagName
        );
        if (siblings.length > 1) {
          const idx = siblings.indexOf(current) + 1;
          parts.unshift(tag + ":nth-of-type(" + idx + ")");
        } else {
          parts.unshift(tag);
        }
      } else {
        parts.unshift(tag);
      }

      current = parent;

      // Check if accumulated path is already unique
      const candidate = parts.join(" > ");
      if (isUnique(candidate)) return candidate;
    }

    return parts.join(" > ");
  }

  // --- Toast notification ---

  function showToast(message) {
    const existing = document.querySelector(".cw-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.className = "cw-toast";
    toast.setAttribute(CW_ATTR, "");
    toast.textContent = message;
    document.documentElement.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add("cw-toast--visible");
    });

    setTimeout(() => {
      toast.classList.add("cw-toast--exit");
      setTimeout(() => toast.remove(), 200);
    }, 1500);
  }

  // --- Storage ---

  async function storeRule(selector) {
    const hostname = location.hostname;
    const data = await chrome.storage.local.get("rules");
    const rules = data.rules || {};
    const siteRules = rules[hostname] || [];

    // Avoid duplicates
    if (siteRules.some((r) => r.selector === selector)) return;

    siteRules.push({ selector, created: Date.now() });
    rules[hostname] = siteRules;
    await chrome.storage.local.set({ rules });

    // Notify background to update badge
    chrome.runtime.sendMessage({
      type: "rule-added",
      hostname,
      count: siteRules.length,
    });
  }

  // --- Event handlers ---

  function onMouseMove(e) {
    const el = getElementUnderCursor(e.clientX, e.clientY);
    if (!el || el === currentTarget) return;
    currentTarget = el;
    positionOverlay(el);
    label.textContent = selectorLabel(el);
  }

  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    if (!currentTarget || isCwElement(currentTarget)) return;

    const el = currentTarget;
    const selector = generateSelector(el);

    // Animate removal
    el.classList.add("cw-removing");
    el.addEventListener(
      "animationend",
      () => {
        el.style.display = "none";
        el.setAttribute("data-cw-hidden", "");
      },
      { once: true }
    );

    // Reset overlay
    overlay.style.display = "none";
    currentTarget = null;

    // Store rule
    storeRule(selector);
    showToast("Element hidden — " + selector);
  }

  function onKeyDown(e) {
    if (e.key === "Escape") {
      teardown();
    }
  }

  // Prevent normal interactions while picking
  function onClickCapture(e) {
    if (!isCwElement(e.target)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  // --- Setup / Teardown ---

  document.documentElement.classList.add("cw-picker-active");

  document.addEventListener("mousemove", onMouseMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);
  // Block links, buttons, etc.
  document.addEventListener("mousedown", onClickCapture, true);
  document.addEventListener("mouseup", onClickCapture, true);

  showToast("Pick mode — click an element to hide it. Esc to exit.");

  function teardown() {
    window.__cwPickerActive = false;
    document.documentElement.classList.remove("cw-picker-active");
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("mousedown", onClickCapture, true);
    document.removeEventListener("mouseup", onClickCapture, true);
    overlay.remove();
    showToast("Pick mode exited.");
    chrome.runtime.sendMessage({ type: "picker-closed" });
  }

  // Listen for teardown message from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "stop-picker") {
      teardown();
    }
  });
})();
