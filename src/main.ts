import { marked, type RendererObject } from "marked";
import DOMPurify from "dompurify";
import mermaid from "mermaid";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";

interface Tab {
  id: string;
  title: string;
  filePath: string;
  content: string;
}

const IMAGE_MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
  svg: "image/svg+xml",
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

class MarkdownViewer {
  private tabs: Tab[] = [];
  private activeTabId: string | null = null;
  private theme: "dark" | "light" = "dark";
  private mermaidCodes: Map<string, Map<number, string>> = new Map();
  private mermaidRenderGen = 0;

  constructor() {
    this.init().catch((error) => {
      console.error("Failed to initialize:", error);
      this.showToast(`Failed to initialize: ${String(error)}`);
    });
  }

  private showToast(message: string): void {
    let host = document.getElementById("toast-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "toast-host";
      host.style.cssText =
        "position:fixed;bottom:16px;right:16px;z-index:10000;display:flex;flex-direction:column;gap:8px;pointer-events:none;";
      document.body.appendChild(host);
    }
    const el = document.createElement("div");
    el.textContent = message;
    el.style.cssText =
      "background:var(--bg-tertiary);color:var(--text-primary);border:1px solid var(--border);border-radius:4px;padding:8px 12px;font-size:13px;box-shadow:0 2px 6px rgba(0,0,0,.3);pointer-events:auto;";
    host.appendChild(el);
    setTimeout(() => {
      el.remove();
    }, 4000);
  }

  private async init(): Promise<void> {
    this.applyTheme();
    this.setupMarkdownRenderer();
    this.setupEventListeners();
    this.setupMermaid();
    await this.setupTauriListeners();
  }

  private setupMarkdownRenderer(): void {
    const renderer: RendererObject = {
      image({ href, title, text }) {
        return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}" title="${escapeHtml(title || "")}">`;
      },
      link({ href, title, tokens }) {
        const escapedHref = escapeHtml(href);
        const text = this.parser.parseInline(tokens);
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
        const isExternal =
          href.startsWith("http://") || href.startsWith("https://");
        const pathOnly = href.split(/[?#]/)[0];
        if (/\.(md|markdown|mdown|mkd)$/i.test(pathOnly)) {
          return `<a href="${escapedHref}" class="md-link" data-file="${escapeHtml(pathOnly)}"${titleAttr}>${text}</a>`;
        }
        return `<a href="${escapedHref}"${titleAttr} ${isExternal ? 'target="_blank"' : ""} rel="noopener noreferrer">${text}</a>`;
      },
    };

    marked.use({ renderer });
  }

  private setupMermaid(): void {
    mermaid.initialize({
      startOnLoad: false,
      theme: this.theme === "dark" ? "dark" : "default",
      securityLevel: "strict",
      sequence: {
        diagramMarginX: 20,
        diagramMarginY: 20,
        actorMargin: 50,
        width: 150,
        height: 65,
        boxMargin: 10,
        boxTextMargin: 5,
        noteMargin: 10,
        messageMargin: 35,
        mirrorActors: true,
        bottomMarginAdj: 1,
        useMaxWidth: true,
      },
    });
  }

  private async openFileDialog(): Promise<void> {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: "Markdown",
            extensions: ["md", "markdown", "mdown", "mkd"],
          },
        ],
      });

      if (selected && typeof selected === "string") {
        const content = await invoke<string>("read_text_file", {
          path: selected,
        });
        this.openTab(selected, content);
      }
    } catch (error) {
      console.error("Failed to open file:", error);
      this.showToast(`Failed to open file: ${String(error)}`);
    }
  }

  private setupEventListeners(): void {
    document.getElementById("open-btn")?.addEventListener("click", () => {
      this.openFileDialog();
    });

    document.getElementById("theme-btn")?.addEventListener("click", () => {
      this.toggleTheme();
    });

    document.addEventListener("keydown", (e) => {
      const isMac = /mac/i.test(navigator.userAgent);
      const modifier = isMac ? e.metaKey : e.ctrlKey;

      if (modifier && e.key === "o") {
        e.preventDefault();
        this.openFileDialog();
      }

      if (modifier && e.key === "w") {
        e.preventDefault();
        this.closeActiveTab();
      }

      if (modifier && e.key === "Tab") {
        e.preventDefault();
        if (e.shiftKey) {
          this.selectPrevTab();
        } else {
          this.selectNextTab();
        }
      }
    });
  }

  private async setupTauriListeners(): Promise<void> {
    await getCurrentWebview().onDragDropEvent(async (event) => {
      const body = document.body;
      if (event.payload.type === "enter" || event.payload.type === "over") {
        body.classList.add("drag-over");
      } else if (event.payload.type === "leave") {
        body.classList.remove("drag-over");
      } else if (event.payload.type === "drop") {
        body.classList.remove("drag-over");
        const mdFiles = event.payload.paths.filter((p) =>
          /\.(md|markdown|mdown|mkd)$/i.test(p),
        );
        for (const filePath of mdFiles) {
          try {
            const content = await invoke<string>("read_text_file", {
              path: filePath,
            });
            this.openTab(filePath, content);
          } catch (error) {
            console.error("Failed to read dropped file:", filePath, error);
            this.showToast(`Failed to read dropped file: ${filePath}`);
          }
        }
      }
    });
  }

  private openTab(filePath: string, content: string): void {
    const existingTab = this.tabs.find((t) => t.filePath === filePath);
    if (existingTab) {
      this.activateTab(existingTab.id);
      return;
    }

    const id = crypto.randomUUID();
    const fileName = filePath.split(/[/\\]/).pop() || "Untitled";
    const title =
      fileName.length > 20 ? fileName.substring(0, 17) + "..." : fileName;

    const tab: Tab = { id, title, filePath, content };
    this.tabs.push(tab);
    this.renderTabs();
    this.activateTab(id);
  }

  private closeTab(tabId: string): void {
    const index = this.tabs.findIndex((t) => t.id === tabId);
    if (index === -1) return;

    this.tabs.splice(index, 1);
    this.mermaidCodes.delete(tabId);
    this.renderTabs();

    if (this.activeTabId === tabId) {
      if (this.tabs.length > 0) {
        const newIndex = Math.min(index, this.tabs.length - 1);
        this.activateTab(this.tabs[newIndex].id);
      } else {
        this.activeTabId = null;
        this.showWelcome();
      }
    }
  }

  private closeActiveTab(): void {
    if (this.activeTabId) {
      this.closeTab(this.activeTabId);
    }
  }

  private activateTab(tabId: string): void {
    this.activeTabId = tabId;
    this.renderTabs();
    this.renderContent();
  }

  private selectNextTab(): void {
    if (this.tabs.length <= 1) return;
    const currentIndex = this.tabs.findIndex((t) => t.id === this.activeTabId);
    if (currentIndex === -1) return;
    const nextIndex = (currentIndex + 1) % this.tabs.length;
    this.activateTab(this.tabs[nextIndex].id);
  }

  private selectPrevTab(): void {
    if (this.tabs.length <= 1) return;
    const currentIndex = this.tabs.findIndex((t) => t.id === this.activeTabId);
    if (currentIndex === -1) return;
    const prevIndex = (currentIndex - 1 + this.tabs.length) % this.tabs.length;
    this.activateTab(this.tabs[prevIndex].id);
  }

  private renderTabs(): void {
    const container = document.getElementById("tabs-container");
    if (!container) return;

    container.textContent = "";
    for (const tab of this.tabs) {
      const tabEl = document.createElement("div");
      tabEl.className = tab.id === this.activeTabId ? "tab active" : "tab";

      const titleEl = document.createElement("span");
      titleEl.className = "tab-title";
      titleEl.title = tab.filePath;
      titleEl.textContent = tab.title;

      const closeEl = document.createElement("button");
      closeEl.className = "tab-close";
      closeEl.textContent = "×";

      tabEl.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).classList.contains("tab-close")) {
          this.closeTab(tab.id);
        } else {
          this.activateTab(tab.id);
        }
      });

      tabEl.append(titleEl, closeEl);
      container.appendChild(tabEl);
    }
  }

  private async renderContent(): Promise<void> {
    const content = document.getElementById("content");
    const welcome = document.getElementById("welcome-message");
    if (!content) return;

    if (!this.activeTabId) {
      this.showWelcome();
      return;
    }

    const tab = this.tabs.find((t) => t.id === this.activeTabId);
    if (!tab) return;

    if (welcome) welcome.style.display = "none";

    const html = await this.parseMarkdown(tab.id, tab.content);
    content.innerHTML = `<div class="markdown-body">${html}</div>`;

    await this.setupContentHandlers();
    await this.renderMermaidDiagrams(tab.id);
  }

  private showWelcome(): void {
    const content = document.getElementById("content");
    if (!content) return;
    content.innerHTML = `
      <div id="welcome-message">
        <h1>Markdown Viewer</h1>
        <p>Press <kbd>Ctrl</kbd>+<kbd>O</kbd> to open a file</p>
        <p>Or drag and drop a markdown file here</p>
      </div>
    `;
  }

  private async parseMarkdown(tabId: string, content: string): Promise<string> {
    const perTab = this.mermaidCodes.get(tabId) ?? new Map<number, string>();
    this.mermaidCodes.set(tabId, perTab);
    perTab.clear();

    const processed = this.replaceMermaidBlocks(content, perTab);

    const html = await marked.parse(processed);
    return DOMPurify.sanitize(html, {
      ADD_ATTR: ["target", "data-file", "data-mermaid-index"],
    });
  }

  private replaceMermaidBlocks(
    content: string,
    perTab: Map<number, string>,
  ): string {
    const lines = content.split(/\r?\n/);
    const out: string[] = [];
    let diagramIndex = 0;
    let i = 0;

    while (i < lines.length) {
      const open = lines[i].match(/^\s*(`{3,}|~{3,})(.*)$/);

      if (open && open[1] === "```" && open[2].trim() === "mermaid") {
        const codeLines: string[] = [];
        let j = i + 1;
        while (j < lines.length && !this.closesFence(lines[j], open[1])) {
          codeLines.push(lines[j]);
          j += 1;
        }
        if (j < lines.length) {
          perTab.set(diagramIndex, codeLines.join("\n").trim());
          out.push(
            `<div class="mermaid" data-mermaid-index="${diagramIndex}"></div>`,
          );
          diagramIndex += 1;
          i = j + 1;
          continue;
        }
      }

      if (open) {
        let j = i + 1;
        while (j < lines.length && !this.closesFence(lines[j], open[1])) {
          j += 1;
        }
        out.push(...lines.slice(i, Math.min(j + 1, lines.length)));
        i = j + 1;
        continue;
      }

      out.push(lines[i]);
      i += 1;
    }

    return out.join("\n");
  }

  private closesFence(line: string, open: string): boolean {
    const close = line.match(/^\s*(`{3,}|~{3,})\s*$/);
    return (
      close !== null &&
      close[1][0] === open[0] &&
      close[1].length >= open.length
    );
  }

  private readAsDataUrl(
    contents: Uint8Array<ArrayBuffer>,
    mimeType: string,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(reader.result as string));
      reader.addEventListener("error", () =>
        reject(reader.error ?? new Error("failed to read image data")),
      );
      reader.readAsDataURL(new Blob([contents], { type: mimeType }));
    });
  }

  private async setupContentHandlers(): Promise<void> {
    const mdLinks = document.querySelectorAll<HTMLAnchorElement>("a.md-link");
    for (const link of Array.from(mdLinks)) {
      link.addEventListener("click", async (e) => {
        e.preventDefault();
        const filePath = link.dataset.file;
        if (!filePath) return;

        const currentTab = this.tabs.find((t) => t.id === this.activeTabId);
        if (currentTab) {
          const resolvedPath = this.resolveRelativePath(
            currentTab.filePath,
            filePath,
          );
          try {
            const content = await invoke<string>("read_text_file", {
              path: resolvedPath,
            });
            this.openTab(resolvedPath, content);
          } catch (error) {
            console.error("Failed to read markdown file:", error);
            this.showToast(`Failed to read markdown file: ${resolvedPath}`);
          }
        }
      });
    }

    const anchors = document.querySelectorAll<HTMLAnchorElement>("a[href]");
    for (const link of Array.from(anchors)) {
      if (link.classList.contains("md-link")) continue;
      const href = link.getAttribute("href");
      // fragment-only links fall through to the default no-op hash change
      if (!href || href.startsWith("#")) continue;

      link.addEventListener("click", async (e) => {
        e.preventDefault();
        if (!/^(https?:|mailto:|tel:|ftp:)/i.test(href)) {
          this.showToast(`Unsupported link: ${href}`);
          return;
        }
        try {
          await openUrl(href);
        } catch (error) {
          console.error("Failed to open URL:", error);
          this.showToast(`Failed to open URL: ${href}`);
        }
      });
    }

    const images = document.querySelectorAll("img");
    // The loop awaits below, so pin the base to the tab being rendered
    // instead of re-reading the active tab each iteration.
    const currentTab = this.tabs.find((t) => t.id === this.activeTabId);
    if (!currentTab) return;

    for (const img of Array.from(images)) {
      const src = img.getAttribute("src");
      if (!src || /^(data:|file:|https?:)/.test(src)) continue;

      const fullPath = this.resolveRelativePath(currentTab.filePath, src);
      const ext = fullPath.split(".").pop()?.toLowerCase() || "";
      const mimeType = IMAGE_MIME_TYPES[ext];
      if (!mimeType) continue;

      try {
        const bytes = await invoke<ArrayBuffer>("read_binary_file", {
          path: fullPath,
        });
        if (this.activeTabId !== currentTab.id) return;
        img.src = await this.readAsDataUrl(new Uint8Array(bytes), mimeType);
      } catch (error) {
        if (this.activeTabId !== currentTab.id) return;
        console.error("Failed to load image:", fullPath, error);
        this.showToast(`Failed to load image: ${fullPath}`);
      }
    }
  }

  private resolveRelativePath(baseFilePath: string, relative: string): string {
    let path = relative;
    if (path.startsWith("file://")) {
      try {
        path = decodeURIComponent(new URL(path).pathname);
      } catch {
        path = path.slice("file://".length);
      }
      // file:///C:/... → C:/... on Windows
      if (/^\/[a-zA-Z]:/.test(path)) {
        path = path.slice(1);
      }
    } else {
      try {
        path = decodeURIComponent(path);
      } catch {
        // keep the raw path when it has no valid percent-encoding
      }
    }

    if (path.startsWith("/") || /^[a-zA-Z]:/.test(path)) {
      return path;
    }
    const baseDir = baseFilePath.replace(/[\\/][^\\/]+$/, "");
    const sep =
      baseFilePath.includes("\\") && !baseFilePath.includes("/") ? "\\" : "/";
    return baseDir ? `${baseDir}${sep}${path}` : path;
  }

  private async renderMermaidDiagrams(tabId: string): Promise<void> {
    const myGen = ++this.mermaidRenderGen;
    const perTab = this.mermaidCodes.get(tabId);
    if (!perTab) return;

    const mermaidDivs = document.querySelectorAll(".mermaid");
    for (const div of Array.from(mermaidDivs)) {
      if (this.mermaidRenderGen !== myGen) return;
      const indexStr = div.getAttribute("data-mermaid-index");
      if (indexStr === null) continue;
      const index = parseInt(indexStr, 10);
      const code = perTab.get(index);
      if (!code) continue;
      try {
        const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
        const { svg } = await mermaid.render(id, code);
        if (this.mermaidRenderGen !== myGen) return;
        div.innerHTML = svg;
      } catch (error) {
        if (this.mermaidRenderGen !== myGen) return;
        const pre = document.createElement("pre");
        pre.className = "mermaid-error";
        pre.textContent = String(error);
        div.textContent = "";
        div.appendChild(pre);
      }
    }
  }

  private async toggleTheme(): Promise<void> {
    this.theme = this.theme === "dark" ? "light" : "dark";
    this.applyTheme();
    this.setupMermaid();
    if (this.activeTabId) {
      await this.renderContent();
    }
  }

  private applyTheme(): void {
    document.documentElement.setAttribute("data-theme", this.theme);
    const themeIcon = document.getElementById("theme-icon");
    if (themeIcon) {
      themeIcon.textContent = this.theme === "dark" ? "🌙" : "☀️";
    }
  }
}

new MarkdownViewer();
