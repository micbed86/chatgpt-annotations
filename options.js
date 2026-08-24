(() => {
  const SETTINGS_KEY = "cga:settings:v1";
  const DEFAULTS = {
    prompt: "These items are user annotations attached to exact excerpts from earlier messages. Treat selected_text as the referenced excerpt and annotation as the user's comment or instruction about that excerpt.",
    accent: "#2563eb",
    surface: "#303030",
    text: "#f5f5f5",
    highlight: "#4c84ff",
  };

  const $ = (id) => document.getElementById(id);
  const fields = ["accent", "surface", "text", "highlight"];

  function validColor(value, fallback) {
    return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  }

  function normalize(raw = {}) {
    return {
      prompt: typeof raw.prompt === "string" && raw.prompt.trim() ? raw.prompt.trim() : DEFAULTS.prompt,
      accent: validColor(raw.accent, DEFAULTS.accent),
      surface: validColor(raw.surface, DEFAULTS.surface),
      text: validColor(raw.text, DEFAULTS.text),
      highlight: validColor(raw.highlight, DEFAULTS.highlight),
    };
  }

  function render(settings) {
    $("prompt").value = settings.prompt;
    for (const field of fields) {
      $(field).value = settings[field];
      $(`${field}Value`).textContent = settings[field];
    }
    const preview = $("preview");
    preview.style.setProperty("--accent", settings.accent);
    preview.style.setProperty("--surface", settings.surface);
    preview.style.setProperty("--text", settings.text);
  }

  function current() {
    return normalize({
      prompt: $("prompt").value,
      accent: $("accent").value,
      surface: $("surface").value,
      text: $("text").value,
      highlight: $("highlight").value,
    });
  }

  function flash(text) {
    const status = $("status");
    status.textContent = text;
    clearTimeout(flash.timer);
    flash.timer = setTimeout(() => { status.textContent = ""; }, 2200);
  }

  chrome.storage.sync.get(SETTINGS_KEY).then((result) => {
    render(normalize(result[SETTINGS_KEY]));
  });

  for (const field of fields) {
    $(field).addEventListener("input", () => render(current()));
  }

  $("save").addEventListener("click", async () => {
    const settings = current();
    await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
    render(settings);
    flash("Saved. Open ChatGPT tabs update automatically.");
  });

  $("reset").addEventListener("click", () => {
    render({ ...DEFAULTS });
    flash("Defaults restored locally. Click Save to apply.");
  });
})();
