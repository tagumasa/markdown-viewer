# Markdown Viewer

A simple desktop Markdown viewer built with [Tauri v2](https://v2.tauri.app/) and TypeScript.

[日本語](README_ja.md)

## Features

- **Multi-tab support** — Open multiple Markdown files simultaneously in tabs
- **Mermaid diagrams** — Render flowcharts, sequence diagrams, ER diagrams, and more
- **Local image embedding** — Resolves relative image paths and embeds them as Base64
- **Markdown link navigation** — Follow `.md` file links within the app; external URLs open in the system browser
- **Drag & drop** — Drop `.md` files directly onto the window to open them
- **Dark / Light theme** — Toggle between dark and light modes
- **Keyboard shortcuts** — `Ctrl+O` open, `Ctrl+W` close tab, `Ctrl+Tab` / `Ctrl+Shift+Tab` switch tabs
- **XSS protection** — HTML output is sanitised with [DOMPurify](https://github.com/cure53/DOMPurify)

## Supported File Extensions

`.md` `.markdown` `.mdown` `.mkd`

## Installation

### Build from Source

#### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/tools/install) (stable)
- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform

#### Steps

```bash
git clone https://github.com/tgms/markdown-viewer.git
cd markdown-viewer
npm install
npm run build
```

The built application will be in `src-tauri/target/release/`.

#### Development

```bash
npm run dev:tauri
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop shell | [Tauri v2](https://v2.tauri.app/) (Rust) |
| Frontend | TypeScript + Vanilla JS |
| Build tool | [Vite v5](https://vitejs.dev/) |
| Markdown parser | [marked v12](https://marked.js.org/) |
| Diagrams | [Mermaid v11](https://mermaid.js.org/) |
| HTML sanitization | [DOMPurify v3](https://github.com/cure53/DOMPurify) |

## License

[MIT](LICENSE)
