# ChatGPT Annotations v0.4.0

Codex-style inline annotations for `chatgpt.com` in Chromium-based browsers.

Created by **[micbed86](https://github.com/micbed86)**.

## What it does

- Select text in a user or assistant message and use **Add to chat**.
- Add an optional comment to each selected excerpt.
- Keep multiple pending annotations above the composer and inspect/edit/delete them before sending.
- Send annotations as a structured payload attached to the next ChatGPT message without cluttering the visible composer.
- Hide the technical annotation payload from the normal rendered user message.
- Show a compact **annotation receipt inside the sent user bubble** (`1 annotation attached`, `2 annotations attached`, etc.).
- Click that receipt to expand the exact selected excerpts and their annotation comments. Click again, click elsewhere, or press Escape to close it.
- Reconstruct annotation receipts for older messages when their stored payload is present in the conversation.

## Settings

Open **Annotation settings** from the gear button in an annotation panel, or open the extension's Options page from Chromium.

The settings page lets you change:

- the instruction/prompt sent to the LLM with every annotation bundle;
- accent color;
- panel/surface color;
- text color;
- selection highlight color.

Settings are stored with `chrome.storage.sync` and open ChatGPT tabs react to changes automatically.

## Installation

1. Unzip the extension.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the `chatgpt-annotations-v0.4.0` folder.
5. Reload `chatgpt.com`.

When upgrading an unpacked installation, replace the folder contents, click **Reload** on the extension card, and reload ChatGPT.

## Files

- `manifest.json` - Manifest V3 declaration.
- `content.js` - selection UI, annotation editor/list, sent-message receipts, settings integration, and local state.
- `bridge.js` - MAIN-world request bridge that attaches annotation payloads to outgoing ChatGPT requests.
- `options.html`, `options.css`, `options.js` - settings page.

## Annotation transport

The bundle remains wrapped in:

```text
[[CHATGPT_ANNOTATIONS_V1]]
{ ... }
[[/CHATGPT_ANNOTATIONS_V1]]
```

The `instruction` field now comes from the editable settings page. Existing historical messages keep whatever instruction was actually sent with them; changing the setting affects future annotation bundles.

## Author

**micbed86** — https://github.com/micbed86
