(() => {
  if (window.__CHATGPT_ANNOTATIONS_CONTENT__) return;
  window.__CHATGPT_ANNOTATIONS_CONTENT__ = true;

  const CHANNEL = "chatgpt-annotations-extension";
  const EXT_VERSION = "0.4.0";
  const START = "[[CHATGPT_ANNOTATIONS_V1]]";
  const END = "[[/CHATGPT_ANNOTATIONS_V1]]";
  const ZERO_WIDTH = "\u200B";
  const STORAGE_PREFIX = "cga:v1:";
  const SETTINGS_KEY = "cga:settings:v1";
  const DEFAULT_SETTINGS = {
    prompt: "These items are user annotations attached to exact excerpts from earlier messages. Treat selected_text as the referenced excerpt and annotation as the user's comment or instruction about that excerpt.",
    accent: "#2563eb",
    surface: "#303030",
    text: "#f5f5f5",
    highlight: "#4c84ff",
  };

  const state = {
    conversationKey: conversationKey(),
    annotations: [],
    draftId: null,
    newDraftId: null,
    currentSelection: null,
    actionRect: null,
    panelOpen: false,
    panelPinned: false,
    suppressPillHover: false,
    sendToken: null,
    bridgeReady: false,
    composer: null,
    lastUrl: location.href,
    toast: null,
    voiceRecognition: null,
    voiceTargetId: null,
    settings: { ...DEFAULT_SETTINGS },
    sentReceipts: new Map(),
    sentOpenKey: null,
    pendingSendReceipt: null,
    lastConsumedReceipt: null,
    sendBaselineKeys: null,
  };

  const host = document.createElement("div");
  host.id = "cga-extension-root";
  host.dataset.version = EXT_VERSION;
  host.style.setProperty("position", "fixed", "important");
  host.style.setProperty("inset", "0", "important");
  host.style.setProperty("width", "100vw", "important");
  host.style.setProperty("height", "100vh", "important");
  host.style.setProperty("z-index", "2147483647", "important");
  host.style.setProperty("pointer-events", "none", "important");

  // A separate light-DOM root is used for the one control that absolutely must
  // remain visible over ChatGPT's own selection popover. This removes Shadow DOM
  // and stacking-context uncertainty from the Add to chat button.
  const directRoot = document.createElement("div");
  directRoot.id = "cga-direct-root";
  directRoot.dataset.version = EXT_VERSION;
  directRoot.style.setProperty("position", "fixed", "important");
  directRoot.style.setProperty("inset", "0", "important");
  directRoot.style.setProperty("z-index", "2147483647", "important");
  directRoot.style.setProperty("pointer-events", "none", "important");

  function mountRoots() {
    const parent = document.body || document.documentElement;
    if (!parent) return false;
    if (!host.isConnected) parent.appendChild(host);
    if (!directRoot.isConnected) parent.appendChild(directRoot);
    document.documentElement?.setAttribute("data-cga-annotations-version", EXT_VERSION);
    return true;
  }

  mountRoots();
  if (!host.isConnected || !directRoot.isConnected) {
    document.addEventListener("DOMContentLoaded", mountRoots, { once: true });
  }
  console.info(`[ChatGPT Annotations ${EXT_VERSION}] content script loaded at document_start`);

  const pageStyle = document.createElement("style");
  pageStyle.id = "cga-page-style";
  pageStyle.textContent = `
    .cga-sent-receipt {
      display: block !important;
      width: 100% !important;
      margin-top: 8px !important;
      padding-top: 7px !important;
      border-top: 1px solid color-mix(in srgb, var(--cga-text, #f5f5f5) 14%, transparent) !important;
      font: 500 12px/1.35 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif !important;
      color: var(--cga-text, #f5f5f5) !important;
      user-select: text !important;
    }
    .cga-sent-receipt__toggle,
    .cga-sent-receipt__settings {
      all: unset !important;
      box-sizing: border-box !important;
      cursor: pointer !important;
    }
    .cga-sent-receipt__toggle {
      display: inline-flex !important;
      align-items: center !important;
      gap: 6px !important;
      min-height: 27px !important;
      padding: 4px 8px !important;
      border-radius: 999px !important;
      background: color-mix(in srgb, var(--cga-accent, #2563eb) 18%, transparent) !important;
      color: var(--cga-text, #f5f5f5) !important;
      font: 600 11.5px/1 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif !important;
    }
    .cga-sent-receipt__toggle:hover { background: color-mix(in srgb, var(--cga-accent, #2563eb) 28%, transparent) !important; }
    .cga-sent-receipt__toggle svg { width: 13px !important; height: 13px !important; color: var(--cga-accent, #2563eb) !important; }
    .cga-sent-receipt__chevron { margin-inline-start: 1px !important; opacity: .65 !important; font-size: 13px !important; transform: translateY(-1px) !important; }
    .cga-sent-receipt__panel {
      display: block !important;
      margin-top: 8px !important;
      padding: 8px !important;
      border: 1px solid color-mix(in srgb, var(--cga-text, #f5f5f5) 12%, transparent) !important;
      border-radius: 12px !important;
      background: color-mix(in srgb, var(--cga-surface, #303030) 92%, transparent) !important;
      color: var(--cga-text, #f5f5f5) !important;
      box-shadow: 0 8px 24px rgba(0,0,0,.16) !important;
    }
    .cga-sent-receipt__head {
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      gap: 8px !important;
      padding: 2px 3px 6px !important;
      opacity: .82 !important;
      font-size: 10.5px !important;
      font-weight: 650 !important;
    }
    .cga-sent-receipt__settings {
      display: grid !important;
      width: 26px !important;
      height: 26px !important;
      place-items: center !important;
      border-radius: 7px !important;
      color: var(--cga-text, #f5f5f5) !important;
      opacity: .72 !important;
    }
    .cga-sent-receipt__settings:hover { background: color-mix(in srgb, var(--cga-text, #f5f5f5) 9%, transparent) !important; opacity: 1 !important; }
    .cga-sent-receipt__settings svg { width: 14px !important; height: 14px !important; }
    .cga-sent-receipt__item {
      display: grid !important;
      grid-template-columns: 22px minmax(0,1fr) !important;
      gap: 7px !important;
      padding: 7px 4px !important;
      border-top: 1px solid color-mix(in srgb, var(--cga-text, #f5f5f5) 8%, transparent) !important;
    }
    .cga-sent-receipt__index { opacity: .55 !important; text-align: right !important; font-size: 10.5px !important; padding-top: 1px !important; }
    .cga-sent-receipt__body { min-width: 0 !important; }
    .cga-sent-receipt__label { opacity: .56 !important; font-size: 9.5px !important; margin-bottom: 2px !important; }
    .cga-sent-receipt__annotation-label { margin-top: 6px !important; }
    .cga-sent-receipt__quote,
    .cga-sent-receipt__comment {
      overflow-wrap: anywhere !important;
      white-space: pre-wrap !important;
      font-size: 11.5px !important;
      line-height: 1.35 !important;
    }
    .cga-sent-receipt__quote { opacity: .95 !important; }
    .cga-sent-receipt__comment { opacity: .78 !important; }
  `;
  function mountPageStyle() {
    const parent = document.head || document.documentElement;
    if (!parent) return false;
    if (!pageStyle.isConnected) parent.appendChild(pageStyle);
    return true;
  }
  if (!mountPageStyle()) document.addEventListener("DOMContentLoaded", mountPageStyle, { once: true });

  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
        position: fixed !important;
        inset: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        z-index: 2147483647 !important;
        pointer-events: none !important;
      }
      *, *::before, *::after { box-sizing: border-box; }
      .ui {
        position: fixed;
        inset: 0;
        pointer-events: none;
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: var(--cga-text, #f4f4f5);
      }
      button, textarea { font: inherit; }
      button { -webkit-tap-highlight-color: transparent; }
      .floating-action {
        position: fixed;
        z-index: 2147483647;
        pointer-events: auto;
        border: 1px solid rgba(255,255,255,.13);
        background: var(--cga-surface, #303030);
        color: var(--cga-text, #f5f5f5);
        border-radius: 999px;
        min-height: 34px;
        padding: 0 13px;
        display: flex;
        align-items: center;
        gap: 7px;
        font-size: 13px;
        font-weight: 500;
        box-shadow: 0 10px 30px rgba(0,0,0,.26);
        cursor: pointer;
      }
      .floating-action:hover { background: #3a3a3a; }
      .floating-action svg { width: 15px; height: 15px; opacity: .9; }

      .selection-overlay {
        position: fixed;
        background: color-mix(in srgb, var(--cga-highlight, #4c84ff) 20%, transparent);
        outline: 1px solid color-mix(in srgb, var(--cga-highlight, #4c84ff) 28%, transparent);
        border-radius: 2px;
        pointer-events: none;
      }
      .selection-overlay.active {
        background: color-mix(in srgb, var(--cga-highlight, #4c84ff) 28%, transparent);
        outline-color: color-mix(in srgb, var(--cga-highlight, #4c84ff) 46%, transparent);
      }
      .number-badge {
        position: fixed;
        width: 24px;
        height: 24px;
        border-radius: 999px;
        display: grid;
        place-items: center;
        color: white;
        background: var(--cga-accent, #2563eb);
        border: 2px solid rgba(255,255,255,.92);
        box-shadow: 0 2px 8px rgba(0,0,0,.30);
        font-size: 12px;
        font-weight: 700;
        line-height: 1;
        pointer-events: none;
      }

      .editor {
        position: fixed;
        z-index: 2147483647;
        width: min(300px, calc(100vw - 24px));
        background: var(--cga-surface, #303030);
        border: 1px solid color-mix(in srgb, var(--cga-text, #f5f5f5) 10%, transparent);
        border-radius: 18px;
        box-shadow: 0 18px 50px rgba(0,0,0,.38);
        overflow: hidden;
        pointer-events: auto;
      }
      .editor textarea {
        width: 100%;
        min-height: 82px;
        max-height: 180px;
        resize: vertical;
        border: 0;
        outline: 0;
        padding: 16px 16px 8px;
        color: var(--cga-text, #f2f2f2);
        background: transparent;
        font-size: 14px;
        line-height: 1.42;
      }
      .editor textarea::placeholder { color: #888; }
      .editor-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px 10px;
      }
      .editor-spacer { flex: 1; }
      .icon-btn, .text-btn {
        border: 0;
        cursor: pointer;
        color: var(--cga-text, #e7e7e7);
        background: transparent;
      }
      .icon-btn {
        width: 32px;
        height: 32px;
        border-radius: 9px;
        display: grid;
        place-items: center;
      }
      .icon-btn:hover { background: rgba(255,255,255,.07); }
      .icon-btn svg { width: 17px; height: 17px; }
      .text-btn {
        min-height: 32px;
        padding: 0 12px;
        border-radius: 999px;
        font-size: 13px;
        border: 1px solid rgba(255,255,255,.11);
        background: #383838;
      }
      .text-btn:hover { background: #414141; }
      .text-btn.primary {
        color: #fff;
        background: var(--cga-accent, #2563eb);
        border-color: transparent;
      }
      .text-btn.primary:hover { filter: brightness(1.08); }
      .icon-btn.listening { background: #434343; }

      .pill {
        position: fixed;
        z-index: 2147483647;
        pointer-events: auto;
        height: 34px;
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 0 11px;
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,.12);
        background: var(--cga-surface, #353535);
        color: var(--cga-text, #dedede);
        box-shadow: 0 8px 25px rgba(0,0,0,.16);
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
      }
      .pill:hover { filter: brightness(1.08); }
      .pill svg { width: 14px; height: 14px; opacity: .83; }

      .panel {
        position: fixed;
        z-index: 2147483647;
        width: min(380px, calc(100vw - 24px));
        max-height: min(420px, 60vh);
        overflow: auto;
        pointer-events: auto;
        padding: 8px;
        border-radius: 16px;
        border: 1px solid rgba(255,255,255,.08);
        background: var(--cga-surface, #303030);
        color: var(--cga-text, #f5f5f5);
        box-shadow: 0 18px 60px rgba(0,0,0,.38);
      }
      .panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 5px 7px 8px;
        color: color-mix(in srgb, var(--cga-text, #f5f5f5) 72%, transparent);
        font-size: 11px;
        font-weight: 650;
        letter-spacing: .02em;
      }
      .settings-btn {
        width: 28px;
        height: 28px;
        display: grid;
        place-items: center;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: color-mix(in srgb, var(--cga-text, #f5f5f5) 70%, transparent);
        cursor: pointer;
      }
      .settings-btn:hover {
        color: var(--cga-text, #f5f5f5);
        background: color-mix(in srgb, var(--cga-text, #f5f5f5) 8%, transparent);
      }
      .settings-btn svg { width: 15px; height: 15px; }

      .annotation-item {
        display: grid;
        grid-template-columns: 28px 1fr auto;
        gap: 9px;
        padding: 9px 8px;
        border-radius: 11px;
      }
      .annotation-item + .annotation-item { margin-top: 3px; }
      .annotation-item:hover { background: rgba(255,255,255,.045); }
      .annotation-index {
        color: #aaa;
        font-size: 12px;
        padding-top: 2px;
        text-align: right;
      }
      .annotation-body { min-width: 0; }
      .annotation-label { color: #9f9f9f; font-size: 11px; margin-bottom: 2px; }
      .annotation-quote, .annotation-comment {
        color: var(--cga-text, #e7e7e7);
        font-size: 13px;
        line-height: 1.35;
        overflow: hidden;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        word-break: break-word;
      }
      .annotation-comment { color: #c9c9c9; margin-top: 5px; }
      .annotation-tools { display: flex; align-items: flex-start; gap: 2px; }
      .annotation-tools button {
        width: 28px;
        height: 28px;
        display: grid;
        place-items: center;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: #aaa;
        cursor: pointer;
      }
      .annotation-tools button:hover { color: #eee; background: rgba(255,255,255,.06); }
      .annotation-tools svg { width: 14px; height: 14px; }
      .panel-empty { padding: 14px; color: #999; font-size: 13px; }

      .toast {
        position: fixed;
        z-index: 2147483647;
        left: 50%;
        bottom: 24px;
        transform: translateX(-50%);
        pointer-events: none;
        padding: 9px 12px;
        border-radius: 10px;
        background: var(--cga-surface, #2f2f2f);
        border: 1px solid rgba(255,255,255,.09);
        color: var(--cga-text, #ececec);
        font-size: 12px;
        box-shadow: 0 10px 30px rgba(0,0,0,.28);
      }
    </style>
    <div class="ui" id="ui"></div>
  `;

  const ui = shadow.getElementById("ui");

  const icons = {
    add: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 5v14M5 12h14" stroke-linecap="round"/></svg>`,
    bubble: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M7 18.5 3.8 21l.9-4.2A8 8 0 0 1 3 12c0-4.4 4-8 9-8s9 3.6 9 8-4 8-9 8c-1.8 0-3.5-.5-5-1.5Z"/><path d="M8 11h8M8 14h5" stroke-linecap="round"/></svg>`,
    edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m4 20 4.3-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z"/><path d="m13.8 7.5 3 3"/></svg>`,
    trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    mic: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" stroke-linecap="round"/></svg>`,
    close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m7 7 10 10M17 7 7 17" stroke-linecap="round"/></svg>`,
    gear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z"/><path d="M19.4 13a7.8 7.8 0 0 0 .05-2l2-1.55-2-3.45-2.5 1a7.7 7.7 0 0 0-1.75-1L14.8 3h-4l-.4 3a7.7 7.7 0 0 0-1.75 1l-2.5-1-2 3.45 2 1.55a7.8 7.8 0 0 0 .05 2l-2.05 1.55 2 3.45 2.5-1a7.7 7.7 0 0 0 1.75 1l.4 3h4l.4-3a7.7 7.7 0 0 0 1.75-1l2.5 1 2-3.45L19.4 13Z" stroke-linejoin="round"/></svg>`,
    check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 12 4 4L19 6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  };

  function conversationKey() {
    const match = location.pathname.match(/\/c\/([^/?#]+)/);
    return match ? `conversation:${match[1]}` : `path:${location.pathname}${location.search}`;
  }

  function storageKey(key = state.conversationKey) {
    return `${STORAGE_PREFIX}${key}`;
  }

  function validColor(value, fallback) {
    return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  }

  function sanitizeSettings(value) {
    const raw = value && typeof value === "object" ? value : {};
    return {
      prompt: typeof raw.prompt === "string" && raw.prompt.trim() ? raw.prompt.trim() : DEFAULT_SETTINGS.prompt,
      accent: validColor(raw.accent, DEFAULT_SETTINGS.accent),
      surface: validColor(raw.surface, DEFAULT_SETTINGS.surface),
      text: validColor(raw.text, DEFAULT_SETTINGS.text),
      highlight: validColor(raw.highlight, DEFAULT_SETTINGS.highlight),
    };
  }

  function applySettings() {
    const values = {
      "--cga-accent": state.settings.accent,
      "--cga-surface": state.settings.surface,
      "--cga-text": state.settings.text,
      "--cga-highlight": state.settings.highlight,
    };
    for (const [name, value] of Object.entries(values)) {
      host.style.setProperty(name, value);
      directRoot.style.setProperty(name, value);
    }
    renderSentReceipts();
  }

  async function loadSettings() {
    try {
      const result = await chrome.storage.sync.get(SETTINGS_KEY);
      state.settings = sanitizeSettings(result[SETTINGS_KEY]);
    } catch {
      state.settings = { ...DEFAULT_SETTINGS };
    }
    applySettings();
  }

  function openSettings() {
    try {
      window.open(chrome.runtime.getURL("options.html"), "_blank", "noopener");
    } catch {
      showToast("Open the extension options from chrome://extensions.");
    }
  }

  async function loadState() {
    try {
      const result = await chrome.storage.local.get(storageKey());
      const saved = result[storageKey()];
      state.annotations = Array.isArray(saved?.annotations) ? saved.annotations : [];
    } catch {
      state.annotations = [];
    }
    render();
  }

  async function saveState() {
    try {
      await chrome.storage.local.set({
        [storageKey()]: {
          annotations: state.annotations,
          updatedAt: Date.now(),
        },
      });
    } catch {
      // Storage failure should not break the UI.
    }
  }

  function postToBridge(type, extra = {}) {
    const packet = {
      source: CHANNEL,
      direction: "content-to-bridge",
      type,
      ...extra,
    };

    // CustomEvent reaches the main world synchronously. Keep detail JSON-only
    // across isolated worlds. Avoid a second asynchronous ARM message, which
    // could otherwise re-arm a payload after fetch() has already consumed it.
    if (type === "ARM_ANNOTATIONS") {
      document.dispatchEvent(new CustomEvent("cga:arm", {
        detail: JSON.stringify({ token: packet.token, payload: packet.payload }),
      }));
      return;
    }
    if (type === "DISARM_ANNOTATIONS") {
      document.dispatchEvent(new CustomEvent("cga:disarm"));
      return;
    }

    window.postMessage(packet, "*");
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== CHANNEL || data.direction !== "bridge-to-content") return;

    if (data.type === "BRIDGE_READY") state.bridgeReady = true;
    if (data.type === "PAYLOAD_CONSUMED" && data.token && data.token === state.sendToken) {
      const token = state.sendToken;
      state.sendToken = null;
      state.lastConsumedReceipt = state.pendingSendReceipt;
      state.pendingSendReceipt = null;
      scheduleConsumedReceiptAttach();
      waitForComposerClear(token);
    }
    if (data.type === "BRIDGE_ERROR") showToast("Annotation transport failed. Message was not modified.");
  });

  function uuid() {
    return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function normalizeText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function messageRole(root) {
    if (!root) return "unknown";
    const direct = root.getAttribute?.("data-message-author-role");
    if (direct === "assistant" || direct === "user") return direct;
    const turn = root.getAttribute?.("data-turn");
    return turn === "assistant" || turn === "user" ? turn : "unknown";
  }

  function closestMessage(node) {
    const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    if (!el) return null;

    // Current ChatGPT DOM (Aug 2026) uses this on the actual message body.
    const message = el.closest('[data-message-author-role="assistant"], [data-message-author-role="user"]');
    if (message) return message;

    // Fallback to the enclosing conversation turn if OpenAI changes/removes
    // the nested message marker. This matches section[data-turn="..."] in the
    // live DOM supplied for debugging.
    return el.closest('section[data-turn="assistant"], section[data-turn="user"]');
  }

  function messageNodes() {
    const direct = [...document.querySelectorAll('[data-message-author-role="assistant"], [data-message-author-role="user"]')];
    if (direct.length) return direct;
    return [...document.querySelectorAll('section[data-turn="assistant"], section[data-turn="user"]')];
  }

  function textOffset(root, node, offset) {
    const range = document.createRange();
    range.selectNodeContents(root);
    range.setEnd(node, offset);
    return range.toString().length;
  }

  function rectObject(rect) {
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  }

  function unionRects(rects) {
    const left = Math.min(...rects.map((r) => r.left));
    const top = Math.min(...rects.map((r) => r.top));
    const right = Math.max(...rects.map((r) => r.right));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  function collectSelection() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

    const range = selection.getRangeAt(0).cloneRange();
    const startEl = range.startContainer?.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer?.parentElement;
    const endEl = range.endContainer?.nodeType === Node.ELEMENT_NODE ? range.endContainer : range.endContainer?.parentElement;
    if (startEl?.closest?.(".cga-sent-receipt") || endEl?.closest?.(".cga-sent-receipt")) return null;
    const startRoot = closestMessage(range.startContainer);
    const endRoot = closestMessage(range.endContainer);
    if (!startRoot || !endRoot || startRoot !== endRoot) return null;

    const quote = range.toString();
    if (!normalizeText(quote)) return null;

    let start;
    let end;
    try {
      start = textOffset(startRoot, range.startContainer, range.startOffset);
      end = textOffset(startRoot, range.endContainer, range.endOffset);
    } catch {
      return null;
    }

    const fullText = startRoot.textContent || "";
    const clientRects = [...range.getClientRects()].filter((rect) => rect.width > 1 && rect.height > 1);
    if (!clientRects.length) return null;

    // The native ChatGPT selection menu is above the selection. Keep our action
    // anchored to the complete selected block and render it below its lowest line.
    const rect = unionRects(clientRects);
    const messages = messageNodes();
    const messageIndex = messages.indexOf(startRoot);

    return {
      quote,
      role: messageRole(startRoot),
      start,
      end,
      prefix: fullText.slice(Math.max(0, start - 80), start),
      suffix: fullText.slice(end, end + 80),
      messageIndex,
      messageHint: normalizeText(fullText).slice(0, 180),
      rect,
      firstRect: rectObject(clientRects[0]),
      lastRect: rectObject(clientRects[clientRects.length - 1]),
    };
  }

  function applySelection(found) {
    if (!found) return false;
    state.currentSelection = found;
    state.actionRect = found.rect;
    render();
    return true;
  }

  let selectionFrame = 0;
  let selectionRetryTimer = 0;

  function captureSelectionNow() {
    return applySelection(collectSelection());
  }

  function onSelectionFinished() {
    // Capture synchronously in the capture phase, before ChatGPT's own selection
    // UI has a chance to alter focus/selection state.
    if (captureSelectionNow()) return;

    cancelAnimationFrame(selectionFrame);
    selectionFrame = requestAnimationFrame(() => {
      if (state.currentSelection) return;
      if (captureSelectionNow()) return;
      clearTimeout(selectionRetryTimer);
      selectionRetryTimer = setTimeout(() => {
        if (!state.currentSelection) captureSelectionNow();
      }, 40);
    });
  }

  // Listen on window, not document. ChatGPT installs its own selection handlers
  // on document; a document-level stopImmediatePropagation can prevent later
  // extension listeners from ever seeing pointerup. Window is earlier in the
  // capture path, and this script is now injected at document_start.
  window.addEventListener("pointerup", (event) => {
    if (event.composedPath().includes(host) || event.composedPath().includes(directRoot)) return;
    onSelectionFinished();
  }, true);

  window.addEventListener("mouseup", (event) => {
    if (event.composedPath().includes(host) || event.composedPath().includes(directRoot)) return;
    onSelectionFinished();
  }, true);

  document.addEventListener("selectionchange", () => {
    cancelAnimationFrame(selectionFrame);
    selectionFrame = requestAnimationFrame(() => {
      // Never erase a valid captured selection merely because ChatGPT collapses
      // the browser Selection while mounting its own popover.
      captureSelectionNow();
    });
  }, true);

  window.addEventListener("keyup", (event) => {
    if (event.key.startsWith("Arrow") || event.key === "Shift") onSelectionFinished();
  }, true);

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    let changed = false;
    if (state.panelOpen) {
      state.panelOpen = false;
      state.panelPinned = false;
      state.suppressPillHover = false;
      changed = true;
    }
    if (state.sentOpenKey) {
      state.sentOpenKey = null;
      changed = true;
    }
    if (changed) render();
  }, true);

  window.addEventListener("pointerdown", (event) => {
    const path = event.composedPath();
    const insidePanelUi = path.some((node) =>
      node instanceof Element &&
      (node.classList?.contains("pill") || node.classList?.contains("panel"))
    );

    // A clicked-open annotation list behaves like a normal popover: clicking
    // anywhere outside the pill/list closes it. Do this before the early return
    // for extension UI so clicks on other extension controls also dismiss it.
    if (state.panelOpen && !insidePanelUi) {
      state.panelOpen = false;
      state.panelPinned = false;
      state.suppressPillHover = false;
      // Remove only the list here. Re-rendering the whole extension during
      // pointerdown would replace the control the user is currently clicking
      // (for example the editor), preventing its later click event.
      shadow.querySelector(".panel")?.remove();
    }

    const receiptUi = event.target instanceof Element ? event.target.closest(".cga-sent-receipt") : null;
    if (state.sentOpenKey && !receiptUi) {
      state.sentOpenKey = null;
      renderSentReceipts();
    }

    if (path.includes(host) || path.includes(directRoot) || receiptUi) return;

    // A fresh pointer interaction means the user is starting a new selection or
    // leaving the previous one. The next selectionchange/pointerup will repopulate it.
    state.currentSelection = null;
    state.actionRect = null;
    render();
  }, true);

  function annotationFromSelection(sel) {
    return {
      id: uuid(),
      quote: sel.quote,
      comment: "",
      role: sel.role,
      anchor: {
        start: sel.start,
        end: sel.end,
        prefix: sel.prefix,
        suffix: sel.suffix,
        messageIndex: sel.messageIndex,
        messageHint: sel.messageHint,
      },
      createdAt: Date.now(),
    };
  }

  function addCurrentSelection() {
    if (!state.currentSelection) return;
    const annotation = annotationFromSelection(state.currentSelection);
    state.annotations.push(annotation);
    state.draftId = annotation.id;
    state.newDraftId = annotation.id;
    state.currentSelection = null;
    state.actionRect = null;
    saveState();
    ensureComposerPlaceholder();
    render();
    requestAnimationFrame(() => shadow.querySelector(".editor textarea")?.focus());
  }

  function getMessages() {
    return messageNodes();
  }

  function resolveMessage(annotation) {
    const messages = getMessages();
    const anchor = annotation.anchor || {};
    const indexed = messages[anchor.messageIndex];
    if (indexed) {
      const role = messageRole(indexed);
      const text = normalizeText(indexed.textContent || "");
      if (role === annotation.role && (!anchor.messageHint || text.includes(anchor.messageHint.slice(0, 80)))) return indexed;
    }

    const quoteNeedle = normalizeText(annotation.quote).slice(0, 100);
    return messages.find((message) => {
      const role = messageRole(message);
      if (role !== annotation.role) return false;
      return normalizeText(message.textContent || "").includes(quoteNeedle);
    }) || null;
  }

  function locateRange(annotation) {
    const root = resolveMessage(annotation);
    if (!root) return null;

    const full = root.textContent || "";
    let start = annotation.anchor?.start ?? -1;
    let end = annotation.anchor?.end ?? -1;

    if (start < 0 || end <= start || full.slice(start, end) !== annotation.quote) {
      const exact = full.indexOf(annotation.quote);
      if (exact >= 0) {
        start = exact;
        end = exact + annotation.quote.length;
      } else {
        const normalizedQuote = normalizeText(annotation.quote);
        if (!normalizedQuote) return null;
        const normalizedFull = normalizeText(full);
        const nIndex = normalizedFull.indexOf(normalizedQuote);
        if (nIndex < 0) return null;

        // Exact DOM offsets are unavailable after whitespace normalization.
        // Fall back to first exact non-normalized phrase fragment.
        const fragment = annotation.quote.trim().slice(0, Math.min(80, annotation.quote.trim().length));
        const fIndex = full.indexOf(fragment);
        if (fIndex < 0) return null;
        start = fIndex;
        end = Math.min(full.length, fIndex + annotation.quote.length);
      }
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let pos = 0;
    let startNode = null;
    let endNode = null;
    let startOffset = 0;
    let endOffset = 0;
    let node;

    while ((node = walker.nextNode())) {
      const len = node.nodeValue?.length || 0;
      if (!startNode && start >= pos && start <= pos + len) {
        startNode = node;
        startOffset = Math.max(0, start - pos);
      }
      if (end >= pos && end <= pos + len) {
        endNode = node;
        endOffset = Math.max(0, end - pos);
        break;
      }
      pos += len;
    }

    if (!startNode || !endNode) return null;
    const range = document.createRange();
    try {
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
    } catch {
      return null;
    }
    return { root, range };
  }

  function editorPosition(annotation) {
    const located = locateRange(annotation);
    const rect = located?.range.getBoundingClientRect();
    const width = 300;
    const margin = 10;
    let left = rect ? rect.left + Math.min(rect.width / 2, 110) : window.innerWidth / 2 - width / 2;
    let top = rect ? rect.bottom + 10 : 80;

    left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
    if (top + 190 > window.innerHeight) top = rect ? Math.max(12, rect.top - 195) : 12;
    return { left, top };
  }

  function saveDraft() {
    state.draftId = null;
    state.newDraftId = null;
    saveState();
    render();
  }

  function cancelDraft() {
    if (state.newDraftId) {
      state.annotations = state.annotations.filter((a) => a.id !== state.newDraftId);
      saveState();
      ensureComposerPlaceholder();
    }
    state.draftId = null;
    state.newDraftId = null;
    render();
  }

  function deleteAnnotation(id) {
    state.annotations = state.annotations.filter((a) => a.id !== id);
    if (state.draftId === id) state.draftId = null;
    if (state.newDraftId === id) state.newDraftId = null;
    saveState();
    ensureComposerPlaceholder();
    render();
  }

  function editAnnotation(id) {
    state.draftId = id;
    state.newDraftId = null;
    state.panelOpen = false;
    scrollToAnnotation(id);
    render();
    requestAnimationFrame(() => shadow.querySelector(".editor textarea")?.focus());
  }

  function updateComment(id, comment) {
    const annotation = state.annotations.find((a) => a.id === id);
    if (!annotation) return;
    annotation.comment = comment;
    saveState();
  }

  function scrollToAnnotation(id) {
    const annotation = state.annotations.find((a) => a.id === id);
    if (!annotation) return;
    const located = locateRange(annotation);
    if (!located) {
      showToast("The original selection could not be located on this page.");
      return;
    }
    located.root.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(render, 260);
  }

  function annotationPayloadObject() {
    return {
      type: "chatgpt_annotations",
      version: 1,
      instruction: state.settings.prompt,
      items: state.annotations.map((a, index) => ({
        index: index + 1,
        source_role: a.role,
        selected_text: a.quote,
        annotation: a.comment || "",
      })),
    };
  }

  function annotationPayload(payload = annotationPayloadObject()) {
    return `${START}\n${JSON.stringify(payload, null, 2)}\n${END}`;
  }

  function findComposer() {
    const direct = document.querySelector("#prompt-textarea");
    if (direct) return direct;

    const candidates = [...document.querySelectorAll('textarea, [contenteditable="true"]')];
    return candidates.find((el) => {
      if (!el.isConnected) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width < 180 || rect.height < 20) return false;
      const form = el.closest("form");
      return form && findSendButton(form);
    }) || null;
  }

  function findSendButton(scope = document) {
    return scope.querySelector(
      'button[data-testid="send-button"], button[aria-label*="Send" i], button[aria-label*="Wyślij" i]'
    );
  }

  function composerText(el = state.composer || findComposer()) {
    if (!el) return "";
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return el.value || "";
    return el.innerText || el.textContent || "";
  }

  function setComposerText(text, el = state.composer || findComposer()) {
    if (!el) return false;
    el.focus();

    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const prototype = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      setter?.call(el, text);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      return true;
    }

    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand("insertText", false, text);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      return true;
    } catch {
      return false;
    }
  }

  function ensureComposerPlaceholder() {
    state.composer = findComposer();
    const composer = state.composer;
    if (!composer) return;

    const text = composerText(composer);
    const onlyZeroWidth = text.replaceAll(ZERO_WIDTH, "").trim() === "";

    if (state.annotations.length > 0 && onlyZeroWidth && !text.includes(ZERO_WIDTH)) {
      setComposerText(ZERO_WIDTH, composer);
    }

    if (state.annotations.length === 0 && text === ZERO_WIDTH) {
      setComposerText("", composer);
    }
  }

  function armForSend() {
    if (!state.annotations.length || state.sendToken) return;
    ensureComposerPlaceholder();
    state.sendToken = uuid();
    state.pendingSendReceipt = annotationPayloadObject();
    state.sendBaselineKeys = new Set(userMessageRoots().map(messageKey));
    postToBridge("ARM_ANNOTATIONS", {
      token: state.sendToken,
      payload: annotationPayload(state.pendingSendReceipt),
    });
  }

  function disarm() {
    if (!state.sendToken) return;
    postToBridge("DISARM_ANNOTATIONS");
    state.sendToken = null;
    state.pendingSendReceipt = null;
    state.lastConsumedReceipt = null;
    state.sendBaselineKeys = null;
  }

  document.addEventListener("pointerdown", (event) => {
    if (!state.annotations.length) return;
    const button = event.target?.closest?.('button[data-testid="send-button"], button[aria-label*="Send" i], button[aria-label*="Wyślij" i]');
    if (!button) return;
    armForSend();
  }, true);

  document.addEventListener("keydown", (event) => {
    if (!state.annotations.length || event.isComposing) return;
    if (event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    const composer = findComposer();
    if (!composer) return;
    if (event.target !== composer && !composer.contains(event.target)) return;
    armForSend();
  }, true);

  async function waitForComposerClear(token) {
    const started = Date.now();
    while (Date.now() - started < 8000) {
      await new Promise((resolve) => setTimeout(resolve, 120));
      const composer = findComposer();
      const text = composerText(composer).replaceAll(ZERO_WIDTH, "").trim();
      if (!text) {
        state.annotations = [];
        state.draftId = null;
        state.newDraftId = null;
        state.panelOpen = false;
        state.panelPinned = false;
        state.suppressPillHover = false;
        await saveState();
        ensureComposerPlaceholder();
        render();
        return;
      }
    }

    // The bridge consumed the payload, but the composer never cleared. Keep annotations
    // so the user can retry without losing them.
    if (!state.sendToken || state.sendToken === token) {
      state.sendToken = null;
      showToast("Annotations were attached, but send completion was not detected.");
    }
  }

  function composerPillPosition() {
    const composer = state.composer || findComposer();
    if (!composer) return null;
    const form = composer.closest("form") || composer.parentElement;
    const rect = (form || composer).getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      left: Math.max(12, rect.left + 12),
      top: Math.max(8, rect.top - 39),
      width: rect.width,
    };
  }

  function panelPosition(pillPos) {
    const width = Math.min(380, window.innerWidth - 24);
    let left = pillPos.left;
    if (left + width > window.innerWidth - 12) left = window.innerWidth - width - 12;
    const estimatedHeight = Math.min(420, 62 + state.annotations.length * 86);
    let top = pillPos.top - estimatedHeight - 8;
    if (top < 8) top = pillPos.top + 42;
    return { left, top };
  }

  function showToast(text) {
    state.toast = text;
    render();
    setTimeout(() => {
      if (state.toast === text) {
        state.toast = null;
        render();
      }
    }, 2600);
  }

  function startVoice(id) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showToast("Voice dictation is not available in this browser.");
      return;
    }

    if (state.voiceRecognition) {
      state.voiceRecognition.stop();
      state.voiceRecognition = null;
      state.voiceTargetId = null;
      render();
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = document.documentElement.lang || navigator.language || "en-US";
    recognition.interimResults = false;
    recognition.continuous = false;
    state.voiceRecognition = recognition;
    state.voiceTargetId = id;
    render();

    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript || "";
      const annotation = state.annotations.find((a) => a.id === id);
      if (annotation && transcript) {
        annotation.comment = `${annotation.comment ? `${annotation.comment} ` : ""}${transcript}`;
        saveState();
      }
    };
    recognition.onend = () => {
      state.voiceRecognition = null;
      state.voiceTargetId = null;
      render();
    };
    recognition.onerror = () => {
      state.voiceRecognition = null;
      state.voiceTargetId = null;
      render();
    };
    recognition.start();
  }

  function renderHighlights() {
    state.annotations.forEach((annotation, index) => {
      const located = locateRange(annotation);
      if (!located) return;
      const rects = [...located.range.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
      rects.forEach((rect) => {
        if (rect.bottom < 0 || rect.top > window.innerHeight) return;
        const overlay = document.createElement("div");
        overlay.className = `selection-overlay${state.draftId === annotation.id ? " active" : ""}`;
        overlay.style.left = `${rect.left}px`;
        overlay.style.top = `${rect.top}px`;
        overlay.style.width = `${rect.width}px`;
        overlay.style.height = `${rect.height}px`;
        ui.appendChild(overlay);
      });

      if (rects[0]) {
        const badge = document.createElement("div");
        badge.className = "number-badge";
        badge.textContent = String(index + 1);
        badge.style.left = `${Math.max(4, rects[0].left + rects[0].width / 2 - 12)}px`;
        badge.style.top = `${Math.max(4, rects[0].top - 30)}px`;
        ui.appendChild(badge);
      }
    });
  }

  let directActionButton = null;

  function removeDirectActionButton() {
    if (directActionButton) directActionButton.remove();
    directActionButton = null;
  }

  function renderFloatingAction() {
    removeDirectActionButton();
    if (!state.actionRect || !state.currentSelection) return;
    mountRoots();

    const button = document.createElement("button");
    directActionButton = button;
    button.id = "cga-add-to-chat-button";
    button.type = "button";
    button.setAttribute("data-cga-selection-action", "true");
    button.innerHTML = `${icons.add}<span>Add to chat</span>`;

    const width = 116;
    const height = 36;
    const gap = 8;
    const rect = state.actionRect;
    let left = rect.left + rect.width / 2 - width / 2;
    let top = rect.bottom + gap;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    if (top + height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - height - gap);
    }

    const important = (name, value) => button.style.setProperty(name, value, "important");
    important("all", "initial");
    important("position", "fixed");
    important("left", `${Math.round(left)}px`);
    important("top", `${Math.round(top)}px`);
    important("z-index", "2147483647");
    important("pointer-events", "auto");
    important("display", "flex");
    important("align-items", "center");
    important("gap", "7px");
    important("min-height", "36px");
    important("padding", "0 13px");
    important("border", "1px solid rgba(255,255,255,.18)");
    important("border-radius", "999px");
    important("background", state.settings.accent);
    important("color", state.settings.text);
    important("box-shadow", "0 10px 30px rgba(0,0,0,.45)");
    important("font", "600 13px/1 ui-sans-serif,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif");
    important("cursor", "pointer");
    important("white-space", "nowrap");

    button.querySelector("svg")?.style.setProperty("width", "15px", "important");
    button.querySelector("svg")?.style.setProperty("height", "15px", "important");

    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    }, true);
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    }, true);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      addCurrentSelection();
    }, true);
    directRoot.appendChild(button);
  }

  function renderEditor() {
    const annotation = state.annotations.find((a) => a.id === state.draftId);
    if (!annotation) return;
    const pos = editorPosition(annotation);

    const editor = document.createElement("div");
    editor.className = "editor";
    editor.style.left = `${pos.left}px`;
    editor.style.top = `${pos.top}px`;
    editor.innerHTML = `
      <textarea placeholder="Add an optional comment..."></textarea>
      <div class="editor-actions">
        <button class="icon-btn" data-action="delete" title="Delete">${icons.trash}</button>
        <div class="editor-spacer"></div>
        <button class="icon-btn${state.voiceTargetId === annotation.id ? " listening" : ""}" data-action="voice" title="Dictate">${icons.mic}</button>
        <button class="text-btn" data-action="cancel">Cancel</button>
        <button class="text-btn primary" data-action="save">Save</button>
      </div>
    `;
    const textarea = editor.querySelector("textarea");
    textarea.value = annotation.comment || "";
    textarea.addEventListener("input", () => updateComment(annotation.id, textarea.value));
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Escape") cancelDraft();
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") saveDraft();
    });
    editor.querySelector('[data-action="delete"]').addEventListener("click", () => deleteAnnotation(annotation.id));
    editor.querySelector('[data-action="voice"]').addEventListener("click", () => startVoice(annotation.id));
    editor.querySelector('[data-action="cancel"]').addEventListener("click", cancelDraft);
    editor.querySelector('[data-action="save"]').addEventListener("click", saveDraft);
    ui.appendChild(editor);
  }

  function maybeClosePanel() {
    setTimeout(() => {
      if (!state.panelOpen || state.panelPinned) return;
      const hovering = shadow.querySelector(".pill:hover, .panel:hover");
      if (!hovering) {
        state.panelOpen = false;
        render();
      }
    }, 170);
  }

  function renderPillAndPanel() {
    if (!state.annotations.length) return;
    const pos = composerPillPosition();
    if (!pos) return;

    const pill = document.createElement("button");
    pill.className = "pill";
    pill.style.left = `${pos.left}px`;
    pill.style.top = `${pos.top}px`;
    pill.innerHTML = `${icons.bubble}<span>${state.annotations.length} ${state.annotations.length === 1 ? "annotation" : "annotations"}</span>`;
    pill.addEventListener("click", (event) => {
      event.stopPropagation();
      if (state.panelPinned) {
        // Closing by clicking the pill must not immediately reopen from the
        // mouseenter fired on the freshly rendered pill under the same cursor.
        state.panelPinned = false;
        state.panelOpen = false;
        state.suppressPillHover = true;
      } else {
        state.panelPinned = true;
        state.panelOpen = true;
      }
      render();
    });
    pill.addEventListener("mouseenter", () => {
      if (state.suppressPillHover) return;
      if (!state.panelOpen) {
        state.panelOpen = true;
        render();
      }
    });
    pill.addEventListener("mouseleave", () => {
      state.suppressPillHover = false;
      maybeClosePanel();
    });
    ui.appendChild(pill);

    if (!state.panelOpen) return;
    const panelPos = panelPosition(pos);
    const panel = document.createElement("div");
    panel.className = "panel";
    panel.style.left = `${panelPos.left}px`;
    panel.style.top = `${panelPos.top}px`;
    panel.addEventListener("mouseenter", () => {});
    panel.addEventListener("mouseleave", maybeClosePanel);

    const panelHeader = document.createElement("div");
    panelHeader.className = "panel-header";
    panelHeader.innerHTML = `<span>Pending annotations</span><button class="settings-btn" type="button" title="Annotation settings" aria-label="Annotation settings">${icons.gear}</button>`;
    panelHeader.querySelector("button").addEventListener("click", (event) => {
      event.stopPropagation();
      openSettings();
    });
    panel.appendChild(panelHeader);

    state.annotations.forEach((annotation, index) => {
      const item = document.createElement("div");
      item.className = "annotation-item";
      item.innerHTML = `
        <div class="annotation-index">${index + 1}.</div>
        <div class="annotation-body">
          <div class="annotation-label">Selected text:</div>
          <div class="annotation-quote"></div>
          ${annotation.comment ? `<div class="annotation-label" style="margin-top:7px">Annotation:</div><div class="annotation-comment"></div>` : ""}
        </div>
        <div class="annotation-tools">
          <button data-action="edit" title="Edit">${icons.edit}</button>
          <button data-action="delete" title="Delete">${icons.close}</button>
        </div>
      `;
      item.querySelector(".annotation-quote").textContent = annotation.quote;
      if (annotation.comment) item.querySelector(".annotation-comment").textContent = annotation.comment;
      item.querySelector('[data-action="edit"]').addEventListener("click", () => editAnnotation(annotation.id));
      item.querySelector('[data-action="delete"]').addEventListener("click", () => deleteAnnotation(annotation.id));
      panel.appendChild(item);
    });

    ui.appendChild(panel);
  }

  function renderToast() {
    if (!state.toast) return;
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = state.toast;
    ui.appendChild(toast);
  }

  function render() {
    removeDirectActionButton();
    ui.replaceChildren();
    state.composer = findComposer();
    renderHighlights();
    renderFloatingAction();
    renderPillAndPanel();
    renderEditor();
    renderToast();
    renderSentReceipts();
  }

  function userMessageRoots() {
    const direct = [...document.querySelectorAll('[data-message-author-role="user"]')];
    if (direct.length) return direct;
    return [...document.querySelectorAll('section[data-turn="user"]')];
  }

  function messageKey(root) {
    if (!root) return "";
    return root.getAttribute("data-message-id")
      || root.closest?.("section[data-turn-id]")?.getAttribute("data-turn-id")
      || root.getAttribute("data-turn-id")
      || `user:${userMessageRoots().indexOf(root)}`;
  }

  function extractPayload(text) {
    const source = String(text || "");
    const start = source.indexOf(START);
    if (start < 0) return null;
    const end = source.indexOf(END, start + START.length);
    if (end < 0) return null;
    const raw = source.slice(start + START.length, end).trim();
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.type !== "chatgpt_annotations" || !Array.isArray(parsed.items)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function registerSentReceipt(root, payload) {
    const key = messageKey(root);
    if (!key || !payload) return;
    state.sentReceipts.set(key, payload);
  }

  function findUserBubble(root) {
    if (!root) return null;
    return root.querySelector(".user-message-bubble-color")
      || root.querySelector("[class*='user-message-bubble-color']")
      || root.querySelector(".whitespace-pre-wrap")?.parentElement
      || root;
  }

  function receiptSignature(key, payload) {
    const source = JSON.stringify(payload?.items || []);
    let hash = 0;
    for (let i = 0; i < source.length; i += 1) hash = ((hash << 5) - hash + source.charCodeAt(i)) | 0;
    return `${key}:${hash}:${state.sentOpenKey === key}:${state.settings.accent}:${state.settings.surface}:${state.settings.text}`;
  }

  function setReceiptTheme(wrapper) {
    wrapper.style.setProperty("--cga-accent", state.settings.accent);
    wrapper.style.setProperty("--cga-surface", state.settings.surface);
    wrapper.style.setProperty("--cga-text", state.settings.text);
  }

  function renderSentReceipt(root, key, payload) {
    const bubble = findUserBubble(root);
    if (!bubble) return;
    const signature = receiptSignature(key, payload);
    let wrapper = bubble.querySelector(`:scope > .cga-sent-receipt[data-cga-message-key="${CSS.escape(key)}"]`);
    if (wrapper?.dataset.cgaSignature === signature) return;
    wrapper?.remove();

    wrapper = document.createElement("div");
    wrapper.className = "cga-sent-receipt";
    wrapper.dataset.cgaMessageKey = key;
    wrapper.dataset.cgaSignature = signature;
    setReceiptTheme(wrapper);

    const count = payload.items.length;
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "cga-sent-receipt__toggle";
    toggle.setAttribute("aria-expanded", state.sentOpenKey === key ? "true" : "false");
    toggle.innerHTML = `${icons.check}<span>${count} ${count === 1 ? "annotation" : "annotations"} attached</span><span class="cga-sent-receipt__chevron">⌄</span>`;
    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      state.sentOpenKey = state.sentOpenKey === key ? null : key;
      renderSentReceipts();
    });
    wrapper.appendChild(toggle);

    if (state.sentOpenKey === key) {
      const panel = document.createElement("div");
      panel.className = "cga-sent-receipt__panel";

      const head = document.createElement("div");
      head.className = "cga-sent-receipt__head";
      head.innerHTML = `<span>Attached annotations</span><button type="button" class="cga-sent-receipt__settings" title="Annotation settings" aria-label="Annotation settings">${icons.gear}</button>`;
      head.querySelector("button").addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openSettings();
      });
      panel.appendChild(head);

      payload.items.forEach((item, index) => {
        const row = document.createElement("div");
        row.className = "cga-sent-receipt__item";
        const idx = document.createElement("div");
        idx.className = "cga-sent-receipt__index";
        idx.textContent = `${index + 1}.`;
        const body = document.createElement("div");
        body.className = "cga-sent-receipt__body";
        const qLabel = document.createElement("div");
        qLabel.className = "cga-sent-receipt__label";
        qLabel.textContent = "Selected text:";
        const quote = document.createElement("div");
        quote.className = "cga-sent-receipt__quote";
        quote.textContent = item.selected_text || "";
        body.append(qLabel, quote);
        if (item.annotation) {
          const aLabel = document.createElement("div");
          aLabel.className = "cga-sent-receipt__label cga-sent-receipt__annotation-label";
          aLabel.textContent = "Annotation:";
          const comment = document.createElement("div");
          comment.className = "cga-sent-receipt__comment";
          comment.textContent = item.annotation;
          body.append(aLabel, comment);
        }
        row.append(idx, body);
        panel.appendChild(row);
      });
      wrapper.appendChild(panel);
    }

    bubble.appendChild(wrapper);
  }

  function renderSentReceipts() {
    for (const root of userMessageRoots()) {
      const key = messageKey(root);
      const payload = state.sentReceipts.get(key);
      if (payload) renderSentReceipt(root, key, payload);
    }
  }

  function tryAttachConsumedReceipt() {
    if (!state.lastConsumedReceipt || !state.sendBaselineKeys) return false;
    const candidates = userMessageRoots().filter((root) => !state.sendBaselineKeys.has(messageKey(root)));
    const root = candidates[candidates.length - 1];
    if (!root) return false;
    registerSentReceipt(root, state.lastConsumedReceipt);
    state.lastConsumedReceipt = null;
    state.sendBaselineKeys = null;
    renderSentReceipts();
    return true;
  }

  let receiptAttachTimer = 0;
  function scheduleConsumedReceiptAttach() {
    clearTimeout(receiptAttachTimer);
    let attempts = 0;
    const tick = () => {
      if (tryAttachConsumedReceipt()) return;
      attempts += 1;
      if (attempts < 30) receiptAttachTimer = setTimeout(tick, 120);
    };
    tick();
  }

  function stripPayload(text) {
    const start = text.indexOf(START);
    if (start < 0) return text;
    const end = text.indexOf(END, start);
    if (end < 0) return text;
    return `${text.slice(0, start)}${text.slice(end + END.length)}`.replace(/\n{3,}/g, "\n\n").trim();
  }

  function concealStoredPayloads() {
    userMessageRoots().forEach((root) => {
      const text = root.textContent || "";
      if (!text.includes(START)) return;
      const payload = extractPayload(text);
      if (payload) registerSentReceipt(root, payload);
        const candidates = [...root.querySelectorAll("p, pre, .whitespace-pre-wrap, [class*='whitespace-pre-wrap']")]
        .filter((el) => el.textContent?.includes(START))
        .sort((a, b) => (a.textContent?.length || 0) - (b.textContent?.length || 0));

      const target = candidates[0];
      if (target) {
        target.textContent = stripPayload(target.textContent || "");
        root.dataset.cgaSanitized = "1";
      }
    });
    tryAttachConsumedReceipt();
    renderSentReceipts();
  }

  function mutationIsExtensionOwned(mutation) {
    const target = mutation.target;
    if (target === directRoot || directRoot.contains(target)) return true;
    if (target instanceof Element && target.closest?.(".cga-sent-receipt")) return true;
    const changed = [...mutation.addedNodes, ...mutation.removedNodes];
    return changed.length > 0 && changed.every((node) =>
      node instanceof Element && (node.matches?.(".cga-sent-receipt") || node.closest?.(".cga-sent-receipt"))
    );
  }

  const observer = new MutationObserver((mutations) => {
    const externalMutation = mutations.some((mutation) => !mutationIsExtensionOwned(mutation));
    if (!externalMutation) return;
    concealStoredPayloads();
    tryAttachConsumedReceipt();
    state.composer = findComposer();
    ensureComposerPlaceholder();
    render();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  let renderFrame = 0;
  function scheduleRender() {
    cancelAnimationFrame(renderFrame);
    renderFrame = requestAnimationFrame(render);
  }
  window.addEventListener("scroll", scheduleRender, true);
  window.addEventListener("resize", scheduleRender);

  setInterval(() => {
    if (location.href !== state.lastUrl) {
      disarm();
      state.lastUrl = location.href;
      state.conversationKey = conversationKey();
      state.draftId = null;
      state.newDraftId = null;
      state.currentSelection = null;
      state.actionRect = null;
      state.sentOpenKey = null;
      state.pendingSendReceipt = null;
      state.lastConsumedReceipt = null;
      state.sendBaselineKeys = null;
      loadState();
    }
    state.composer = findComposer();
    ensureComposerPlaceholder();
  }, 450);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      concealStoredPayloads();
      ensureComposerPlaceholder();
      render();
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync" || !changes[SETTINGS_KEY]) return;
    state.settings = sanitizeSettings(changes[SETTINGS_KEY].newValue);
    applySettings();
    render();
  });

  (async () => {
    await loadSettings();
    await loadState();
    concealStoredPayloads();
    ensureComposerPlaceholder();
    render();
  })();
})();
