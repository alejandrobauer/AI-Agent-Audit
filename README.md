# AI Agent Audit — Figma Plugin

> **The plugin is currently pending approval on the Figma Community.**
> Once approved it will be available at:
> [figma.com/community/plugin/1627649789128184247/ai-agent-audit](https://www.figma.com/community/plugin/1627649789128184247/ai-agent-audit)
>
> In the meantime you can install and use it locally by following the steps below.

---

## What it does

AI agents don't read designs the way humans do. They rely on token names, component descriptions, property structure, and semantic hierarchy to generate accurate code. When those are missing or messy, agents guess — and get it wrong.

**AI Agent Audit** scans your selected frame or component and generates a detailed report frame directly in your Figma file showing exactly what's blocking an agent from reading your design correctly:

- Hardcoded colors, spacing, and corner radius not bound to tokens
- Auto-generated or abbreviated layer names
- Components with no description
- Generic or undescribed component properties and slots (INSTANCE_SWAP)
- Raw typography not using text styles
- Absolute-positioned frames with no auto-layout
- Variable collections with generic names or missing descriptions
- Token efficiency rating with a plain-language summary

Each issue includes **why it matters for agents** and a **specific fix** with exact steps in Figma.

---

## Install locally (while pending approval)

1. Clone or download this repo
2. Open Figma desktop
3. Go to **Menu → Plugins → Development → Import plugin from manifest**
4. Select the `manifest.json` file from this folder
5. The plugin will appear under **Plugins → Development → AI Agent Audit**

---

## How to use

1. Select a **frame**, **auto-layout screen**, or **component** in your canvas
2. Open the plugin: **Plugins → Development → AI Agent Audit**
3. Choose a report theme (Light or Dark)
4. Click **Run Audit**
5. A report frame will appear next to your selection with all findings grouped by severity and category

---

## What gets audited

| Category | What it checks |
|---|---|
| **Naming** | Auto-generated names, abbreviations, appearance-based names |
| **Component** | Missing descriptions, generic property names, boolean prefixes, ambiguous variant values, slot names and descriptions, variant explosion |
| **Token** | Hardcoded fills, strokes, spacing, corner radius, primitive tokens used directly |
| **Style** | Text nodes without text styles, raw effects |
| **Structure** | Empty containers, absolute-positioned frames |
| **Variables** | Generic collection/mode/variable names, missing descriptions, flat (non-hierarchical) naming |

---

## Project structure

```
manifest.json   Plugin metadata and permissions
code.js         Audit engine + report builder (Figma plugin API)
ui.html         Plugin UI (vanilla HTML/CSS/JS, no build step)
```

---

## Contributing

Contributions are welcome! Some ideas for what could be improved:

- New audit rules (e.g. missing grid styles, inconsistent spacing scales)
- Better token efficiency scoring
- Support for FigJam
- Localization of report text

To contribute:
1. Fork the repo
2. Make your changes in `code.js` or `ui.html`
3. Test locally by importing the manifest into Figma
4. Open a pull request with a description of what you changed and why

---

## Built with

- [Figma Plugin API](https://www.figma.com/plugin-docs/)
- Vanilla JS — no build step, no dependencies
- DM Sans + DM Mono (Google Fonts) for the UI

---

## License

MIT — free to use, modify, and distribute.
