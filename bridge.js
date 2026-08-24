(() => {
  if (window.__CHATGPT_ANNOTATIONS_BRIDGE__) return;
  window.__CHATGPT_ANNOTATIONS_BRIDGE__ = true;

  const CHANNEL = "chatgpt-annotations-extension";
  const START = "[[CHATGPT_ANNOTATIONS_V1]]";
  const END = "[[/CHATGPT_ANNOTATIONS_V1]]";
  const ZERO_WIDTH = "\u200B";

  let pending = null;

  function notify(type, extra = {}) {
    window.postMessage({
      source: CHANNEL,
      direction: "bridge-to-content",
      type,
      ...extra,
    }, "*");
  }

  function arm(data) {
    if (!data || typeof data.payload !== "string") return;
    pending = {
      token: String(data.token || ""),
      payload: data.payload,
      expiresAt: Date.now() + 15000,
    };
    notify("ARMED", { token: pending.token });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== CHANNEL || data.direction !== "content-to-bridge") return;

    if (data.type === "ARM_ANNOTATIONS") arm(data);
    if (data.type === "DISARM_ANNOTATIONS") pending = null;
  });

  // Synchronous isolated-world <-> main-world handoff. This matters because a
  // native ChatGPT click/keydown handler can issue fetch() in the same event turn.
  document.addEventListener("cga:arm", (event) => {
    try {
      arm(JSON.parse(String(event.detail || "{}")));
    } catch {
      // postMessage remains as a fallback transport.
    }
  }, true);

  document.addEventListener("cga:disarm", () => {
    pending = null;
  }, true);

  function isPending() {
    if (!pending) return false;
    if (Date.now() > pending.expiresAt) {
      pending = null;
      return false;
    }
    return true;
  }

  function cleanVisibleText(text) {
    return String(text || "")
      .replace(new RegExp(`^${ZERO_WIDTH}+`), "")
      .replace(new RegExp(`${ZERO_WIDTH}+$`), "");
  }

  function combine(originalText, payload) {
    const original = cleanVisibleText(originalText).trimEnd();
    if (!original.trim()) return payload;
    return `${original}\n\n${payload}`;
  }

  function patchMessage(message, payload) {
    if (!message || typeof message !== "object") return false;

    const role = message.author?.role || message.role || message.sender?.role;
    if (role && role !== "user") return false;

    const content = message.content;

    if (content && typeof content === "object") {
      if (Array.isArray(content.parts)) {
        for (let i = content.parts.length - 1; i >= 0; i -= 1) {
          if (typeof content.parts[i] === "string") {
            if (content.parts[i].includes(START)) return true;
            content.parts[i] = combine(content.parts[i], payload);
            return true;
          }
        }
        content.parts.push(payload);
        return true;
      }

      if (typeof content.text === "string") {
        if (content.text.includes(START)) return true;
        content.text = combine(content.text, payload);
        return true;
      }
    }

    if (typeof content === "string") {
      if (content.includes(START)) return true;
      message.content = combine(content, payload);
      return true;
    }

    if (typeof message.text === "string") {
      if (message.text.includes(START)) return true;
      message.text = combine(message.text, payload);
      return true;
    }

    return false;
  }

  function patchMessageArray(messages, payload) {
    if (!Array.isArray(messages) || !messages.length) return false;

    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const candidate = messages[i];
      const role = candidate?.author?.role || candidate?.role || candidate?.sender?.role;
      if (role === "user" && patchMessage(candidate, payload)) return true;
    }

    // Some ChatGPT request variants omit an explicit author on the outgoing message.
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (patchMessage(messages[i], payload)) return true;
    }

    return false;
  }

  function patchObject(root, payload) {
    if (!root || typeof root !== "object") return false;

    // Known/likely shapes first.
    if (patchMessageArray(root.messages, payload)) return true;
    if (root.message && patchMessage(root.message, payload)) return true;

    // Conservative recursive fallback for request-shape changes.
    const queue = [root];
    const seen = new Set();
    let depth = 0;

    while (queue.length && depth < 120) {
      depth += 1;
      const value = queue.shift();
      if (!value || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);

      if (Array.isArray(value.messages) && patchMessageArray(value.messages, payload)) return true;
      if (value.message && patchMessage(value.message, payload)) return true;

      for (const [key, child] of Object.entries(value)) {
        if (key === "messages" || key === "message") continue;
        if (child && typeof child === "object") queue.push(child);
      }
    }

    return false;
  }

  function candidateUrl(url) {
    const s = String(url || "");
    return /chatgpt\.com/i.test(s) && /(conversation|responses|backend-api|\/api\/)/i.test(s);
  }

  function patchJsonString(body) {
    if (!isPending() || typeof body !== "string") return null;
    if (!body.includes("message") && !body.includes("content")) return null;

    try {
      const parsed = JSON.parse(body);
      if (!patchObject(parsed, pending.payload)) return null;
      return JSON.stringify(parsed);
    } catch {
      return null;
    }
  }

  function consume() {
    if (!pending) return;
    const token = pending.token;
    pending = null;
    notify("PAYLOAD_CONSUMED", { token });
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async function patchedFetch(input, init) {
    if (!isPending()) return originalFetch(input, init);

    try {
      const requestUrl = typeof input === "string" || input instanceof URL ? String(input) : input?.url;
      const method = String(init?.method || input?.method || "GET").toUpperCase();
      if (method !== "POST" || !candidateUrl(requestUrl)) return originalFetch(input, init);

      if (typeof init?.body === "string") {
        const patched = patchJsonString(init.body);
        if (patched) {
          consume();
          return originalFetch(input, { ...init, body: patched });
        }
      }

      if (input instanceof Request) {
        const clone = input.clone();
        const contentType = clone.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const text = await clone.text();
          const patched = patchJsonString(text);
          if (patched) {
            consume();
            const replacement = new Request(input, {
              body: patched,
              method: input.method,
              headers: input.headers,
            });
            return originalFetch(replacement, init);
          }
        }
      }
    } catch (error) {
      notify("BRIDGE_ERROR", { message: String(error?.message || error) });
    }

    return originalFetch(input, init);
  };

  const NativeXHR = window.XMLHttpRequest;
  if (NativeXHR) {
    const originalOpen = NativeXHR.prototype.open;
    const originalSend = NativeXHR.prototype.send;

    NativeXHR.prototype.open = function patchedOpen(method, url, ...rest) {
      this.__cgaMethod = String(method || "GET").toUpperCase();
      this.__cgaUrl = String(url || "");
      return originalOpen.call(this, method, url, ...rest);
    };

    NativeXHR.prototype.send = function patchedSend(body) {
      try {
        if (isPending() && this.__cgaMethod === "POST" && candidateUrl(this.__cgaUrl) && typeof body === "string") {
          const patched = patchJsonString(body);
          if (patched) {
            consume();
            return originalSend.call(this, patched);
          }
        }
      } catch (error) {
        notify("BRIDGE_ERROR", { message: String(error?.message || error) });
      }
      return originalSend.call(this, body);
    };
  }

  notify("BRIDGE_READY", { start: START, end: END });
})();
