import { marked } from "marked";
import DOMPurify from "dompurify";
import mermaid from "mermaid";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile, readFile } from "@tauri-apps/plugin-fs";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";

interface Tab {
  id: string;
  title: string;
  filePath: string;
  content: string;
}

class MarkdownViewer {
  private tabs: Tab[] = [];
  private activeTabId: string | null = null;
  private theme: "dark" | "light" = "dark";
  private listeners: (() => void)[] = [];
  private mermaidCodes: Map<string, Map<number, string>> = new Map();
  private mermaidRenderGen = 0;

  constructor() {
    this.init();
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
    this.theme = "dark";
    this.applyTheme();
    this.setupEventListeners();
    this.setupMermaid();
    this.setupTauriListeners();
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
        const content = await readTextFile(selected);
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
      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
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
    const unlistenClose = await this.listen("close-current-tab", () => {
      this.closeActiveTab();
    });
    this.listeners.push(unlistenClose);

    const unlistenDrop = await getCurrentWebview().onDragDropEvent(
      async (event) => {
        const body = document.body;
        if (event.payload.type === "enter" || event.payload.type === "over") {
          body.classList.add("drag-over");
        } else if (event.payload.type === "leave") {
          body.classList.remove("drag-over");
        } else if (event.payload.type === "drop") {
          body.classList.remove("drag-over");
          const mdFiles = event.payload.paths.filter((p) =>
            p.match(/\.(md|markdown|mdown|mkd)$/i),
          );
          for (const filePath of mdFiles) {
            try {
              const content = await readTextFile(filePath);
              this.openTab(filePath, content);
            } catch (error) {
              console.error("Failed to read dropped file:", filePath, error);
              this.showToast(`Failed to read dropped file: ${filePath}`);
            }
          }
        }
      },
    );
    this.listeners.push(unlistenDrop);
  }

  private async listen(
    event: string,
    callback: (data: any) => void,
  ): Promise<() => void> {
    const unlisten = await listen(event, (e) => callback(e.payload));
    return unlisten;
  }

  private openTab(filePath: string, content: string): void {
    const existingTab = this.tabs.find((t) => t.filePath === filePath);
    if (existingTab) {
      this.activateTab(existingTab.id);
      return;
    }

    const id = `tab-${Date.now()}`;
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

    container.innerHTML = this.tabs
      .map(
        (tab) => `
      <div class="tab ${tab.id === this.activeTabId ? "active" : ""}" data-tab-id="${tab.id}">
        <span class="tab-title" title="${tab.filePath}">${tab.title}</span>
        <button class="tab-close" data-tab-id="${tab.id}">&times;</button>
      </div>
    `,
      )
      .join("");

    container.querySelectorAll(".tab").forEach((tabEl) => {
      tabEl.addEventListener("click", (e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains("tab-close")) {
          const tabId = target.dataset.tabId;
          if (tabId) this.closeTab(tabId);
        } else {
          const tabId = tabEl.getAttribute("data-tab-id");
          if (tabId) this.activateTab(tabId);
        }
      });
    });
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
    let perTab = this.mermaidCodes.get(tabId);
    if (!perTab) {
      perTab = new Map();
      this.mermaidCodes.set(tabId, perTab);
    }
    perTab.clear();
    let index = 0;

    let processed = content.replace(
      /```mermaid\r?\n([\s\S]*?)```/g,
      (_, code) => {
        const currentIndex = index++;
        perTab!.set(currentIndex, code.trim());
        return `<div class="mermaid" data-mermaid-index="${currentIndex}"></div>`;
      },
    );

    const renderer = new marked.Renderer();
    renderer.image = (href: string, title: string | null, text: string) => {
      return `<img src="${href}" alt="${text}" title="${title || ""}">`;
    };

    renderer.link = (
      href: string,
      title: string | null | undefined,
      text: string,
    ) => {
      const isExternal =
        href.startsWith("http://") || href.startsWith("https://");
      const isMarkdown = href.match(/\.(md|markdown|mdown|mkd)$/i);
      if (isMarkdown) {
        return `<a href="${href}" class="md-link" data-file="${href}">${text}</a>`;
      }
      return `<a href="${href}" ${isExternal ? 'target="_blank"' : ""} rel="noopener noreferrer">${text}</a>`;
    };

    marked.use({ renderer });

    let html = await marked.parse(processed);
    html = DOMPurify.sanitize(html, {
      ADD_ATTR: ["target", "data-file", "data-mermaid-index"],
      ADD_TAGS: ["div"],
    });

    return html;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  private async setupContentHandlers(): Promise<void> {
    const mdLinks = document.querySelectorAll("a.md-link");
    for (const link of Array.from(mdLinks)) {
      link.addEventListener("click", async (e) => {
        e.preventDefault();
        const filePath = (link as HTMLAnchorElement).dataset.file;
        if (!filePath) return;

        const currentTab = this.tabs.find((t) => t.id === this.activeTabId);
        if (currentTab) {
          const resolvedPath = this.resolveRelativePath(
            currentTab.filePath,
            filePath,
          );
          try {
            const content = await readTextFile(resolvedPath);
            this.openTab(resolvedPath, content);
          } catch (error) {
            console.error("Failed to read markdown file:", error);
            this.showToast(`Failed to read markdown file: ${resolvedPath}`);
          }
        }
      });
    }

    const externalLinks = document.querySelectorAll('a[target="_blank"]');
    for (const link of Array.from(externalLinks)) {
      link.addEventListener("click", async (e) => {
        e.preventDefault();
        const href = (link as HTMLAnchorElement).getAttribute("href");
        if (href) {
          try {
            await openUrl(href);
          } catch (error) {
            console.error("Failed to open URL:", error);
            this.showToast(`Failed to open URL: ${href}`);
          }
        }
      });
    }

    const images = document.querySelectorAll("img");
    for (const img of Array.from(images)) {
      const src = img.getAttribute("src");
      if (!src) continue;

      if (src.startsWith("data:") || src.startsWith("file:")) {
        continue;
      }

      if (src.startsWith("http://") || src.startsWith("https://")) {
        continue;
      }

      const currentTab = this.tabs.find((t) => t.id === this.activeTabId);
      if (currentTab) {
        const fullPath = this.resolveRelativePath(currentTab.filePath, src);
        try {
          const ext = fullPath.split(".").pop()?.toLowerCase() || "";
          if (ext === "svg") {
            const content = await readTextFile(fullPath);
            const encoded = btoa(
              new TextEncoder()
                .encode(content)
                .reduce((s, b) => s + String.fromCharCode(b), ""),
            );
            img.src = `data:image/svg+xml;base64,${encoded}`;
          } else {
            const contents = await readFile(fullPath);
            const chunkSize = 8192;
            let binary = "";
            for (let i = 0; i < contents.length; i += chunkSize) {
              binary += String.fromCharCode(
                ...contents.subarray(
                  i,
                  Math.min(i + chunkSize, contents.length),
                ),
              );
            }
            const base64 = btoa(binary);
            const mimeType = ext === "jpg" ? "jpeg" : ext;
            img.src = `data:image/${mimeType};base64,${base64}`;
          }
        } catch (error) {
          console.error("Failed to load image:", fullPath, error);
          this.showToast(`Failed to load image: ${fullPath}`);
        }
      }
    }
  }

  private resolveRelativePath(baseFilePath: string, relative: string): string {
    if (relative.startsWith("/") || /^[a-zA-Z]:/.test(relative)) {
      return relative;
    }
    const baseDir = baseFilePath.replace(/[\\/][^\\/]+$/, "");
    const sep =
      baseFilePath.includes("\\") && !baseFilePath.includes("/") ? "\\" : "/";
    return baseDir ? `${baseDir}${sep}${relative}` : relative;
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
        div.innerHTML = `<pre class="mermaid-error">${String(error)}</pre>`;
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
