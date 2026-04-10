import { marked } from 'marked';
import DOMPurify from 'dompurify';
import mermaid from 'mermaid';
import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile, readFile } from '@tauri-apps/plugin-fs';
import { openUrl } from '@tauri-apps/plugin-opener';

interface Tab {
  id: string;
  title: string;
  filePath: string;
  content: string;
}

interface TauriAPI {
  openFileDialog: () => Promise<{ filePath: string; content: string } | null>;
  readImageAsBase64: (filePath: string) => Promise<{ success: boolean; data?: string; error?: string }>;
  fetchExternalImage: (url: string) => Promise<{ success: boolean; data?: string; error?: string }>;
  getTheme: () => Promise<'dark' | 'light'>;
  openNewTab: (data: { filePath: string; content: string }) => void;
  onFileOpened: (callback: (data: { filePath: string; content: string }) => void) => void;
  onCloseCurrentTab: (callback: () => void) => void;
  emit: (event: string, data?: any) => void;
  listen: (event: string, callback: (data: any) => void) => Promise<() => void>;
}

declare global {
  interface Window {
    tauriAPI?: TauriAPI;
  }
}

class MarkdownViewer {
  private tabs: Tab[] = [];
  private activeTabId: string | null = null;
  private theme: 'dark' | 'light' = 'dark';
  private listeners: (() => void)[] = [];
  private mermaidCodes: Map<number, string> = new Map();

  constructor() {
    this.init();
  }

  private async init(): Promise<void> {
    this.theme = 'dark';
    this.applyTheme();
    this.setupEventListeners();
    this.setupMermaid();
    this.setupTauriListeners();
  }

  private setupMermaid(): void {
    mermaid.initialize({
      startOnLoad: false,
      theme: this.theme === 'dark' ? 'dark' : 'default',
      securityLevel: 'loose',
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
        useMaxWidth: true
      }
    });
  }

  private async openFileDialog(): Promise<void> {
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: 'Markdown',
          extensions: ['md', 'markdown', 'mdown', 'mkd']
        }]
      });

      if (selected && typeof selected === 'string') {
        const content = await readTextFile(selected);
        this.openTab(selected, content);
      }
    } catch (error) {
      console.error('Failed to open file:', error);
    }
  }

  private setupEventListeners(): void {
    document.getElementById('open-btn')?.addEventListener('click', () => {
      this.openFileDialog();
    });

    document.getElementById('theme-btn')?.addEventListener('click', () => {
      this.toggleTheme();
    });

    document.addEventListener('keydown', (e) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modifier = isMac ? e.metaKey : e.ctrlKey;

      if (modifier && e.key === 'o') {
        e.preventDefault();
        this.openFileDialog();
      }

      if (modifier && e.key === 'w') {
        e.preventDefault();
        this.closeActiveTab();
      }

      if (modifier && e.key === 'Tab') {
        e.preventDefault();
        if (e.shiftKey) {
          this.selectPrevTab();
        } else {
          this.selectNextTab();
        }
      }
    });

    document.addEventListener('drop', (e) => {
      e.preventDefault();
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        const file = files[0];
        if (file.name.match(/\.(md|markdown|mdown|mkd)$/i)) {
          this.readDroppedFile(file);
        }
      }
    });

    document.addEventListener('dragover', (e) => {
      e.preventDefault();
    });
  }

  private async setupTauriListeners(): Promise<void> {
    const unlistenClose = await this.listen('close-current-tab', () => {
      this.closeActiveTab();
    });
    this.listeners.push(unlistenClose);
  }

  private async listen(event: string, callback: (data: any) => void): Promise<() => void> {
    const { listen } = await import('@tauri-apps/api/event');
    const unlisten = await listen(event, (e) => callback(e.payload));
    return unlisten;
  }

  private async readDroppedFile(file: File): Promise<void> {
    const content = await file.text();
    const filePath = (file as any).path || file.name;
    this.openTab(filePath, content);
  }

  private openTab(filePath: string, content: string): void {
    const existingTab = this.tabs.find(t => t.filePath === filePath);
    if (existingTab) {
      this.activateTab(existingTab.id);
      return;
    }

    const id = `tab-${Date.now()}`;
    const fileName = filePath.split(/[/\\]/).pop() || 'Untitled';
    const title = fileName.length > 20 ? fileName.substring(0, 17) + '...' : fileName;

    const tab: Tab = { id, title, filePath, content };
    this.tabs.push(tab);
    this.renderTabs();
    this.activateTab(id);
  }

  private closeTab(tabId: string): void {
    const index = this.tabs.findIndex(t => t.id === tabId);
    if (index === -1) return;

    this.tabs.splice(index, 1);
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
    const currentIndex = this.tabs.findIndex(t => t.id === this.activeTabId);
    if (currentIndex === -1) return;
    const nextIndex = (currentIndex + 1) % this.tabs.length;
    this.activateTab(this.tabs[nextIndex].id);
  }

  private selectPrevTab(): void {
    if (this.tabs.length <= 1) return;
    const currentIndex = this.tabs.findIndex(t => t.id === this.activeTabId);
    if (currentIndex === -1) return;
    const prevIndex = (currentIndex - 1 + this.tabs.length) % this.tabs.length;
    this.activateTab(this.tabs[prevIndex].id);
  }

  private renderTabs(): void {
    const container = document.getElementById('tabs-container');
    if (!container) return;

    container.innerHTML = this.tabs.map(tab => `
      <div class="tab ${tab.id === this.activeTabId ? 'active' : ''}" data-tab-id="${tab.id}">
        <span class="tab-title" title="${tab.filePath}">${tab.title}</span>
        <button class="tab-close" data-tab-id="${tab.id}">&times;</button>
      </div>
    `).join('');

    container.querySelectorAll('.tab').forEach(tabEl => {
      tabEl.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('tab-close')) {
          const tabId = target.dataset.tabId;
          if (tabId) this.closeTab(tabId);
        } else {
          const tabId = tabEl.getAttribute('data-tab-id');
          if (tabId) this.activateTab(tabId);
        }
      });
    });
  }

  private async renderContent(): Promise<void> {
    const content = document.getElementById('content');
    const welcome = document.getElementById('welcome-message');
    if (!content) return;

    if (!this.activeTabId) {
      this.showWelcome();
      return;
    }

    const tab = this.tabs.find(t => t.id === this.activeTabId);
    if (!tab) return;

    if (welcome) welcome.style.display = 'none';

    const html = await this.parseMarkdown(tab.content);
    content.innerHTML = `<div class="markdown-body">${html}</div>`;

    await this.setupContentHandlers();
    await this.renderMermaidDiagrams();
  }

  private showWelcome(): void {
    const content = document.getElementById('content');
    if (!content) return;
    content.innerHTML = `
      <div id="welcome-message">
        <h1>Markdown Viewer</h1>
        <p>Press <kbd>Ctrl</kbd>+<kbd>O</kbd> to open a file</p>
        <p>Or drag and drop a markdown file here</p>
      </div>
    `;
  }

  private async parseMarkdown(content: string): Promise<string> {
    this.mermaidCodes.clear();
    let index = 0;

    let processed = content.replace(/```mermaid\r?\n([\s\S]*?)```/g, (_, code) => {
      const currentIndex = index++;
      this.mermaidCodes.set(currentIndex, code.trim());
      return `<div class="mermaid" data-mermaid-index="${currentIndex}"></div>`;
    });

    const renderer = new marked.Renderer();
    renderer.image = (href: string, title: string | null, text: string) => {
      return `<img src="${href}" alt="${text}" title="${title || ''}">`;
    };

    renderer.link = (href: string, title: string | null | undefined, text: string) => {
      const isExternal = href.startsWith('http://') || href.startsWith('https://');
      const isMarkdown = href.match(/\.(md|markdown|mdown|mkd)$/i);
      if (isMarkdown) {
        return `<a href="${href}" class="md-link" data-file="${href}">${text}</a>`;
      }
      return `<a href="${href}" ${isExternal ? 'target="_blank"' : ''} rel="noopener noreferrer">${text}</a>`;
    };

    marked.use({ renderer });

    let html = await marked.parse(processed);
    html = DOMPurify.sanitize(html, {
      ADD_ATTR: ['target', 'data-file', 'data-mermaid-index'],
      ADD_TAGS: ['div']
    });

    return html;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private async setupContentHandlers(): Promise<void> {
    const mdLinks = document.querySelectorAll('a.md-link');
    for (const link of Array.from(mdLinks)) {
      link.addEventListener('click', async (e) => {
        e.preventDefault();
        const filePath = (link as HTMLAnchorElement).dataset.file;
        if (!filePath) return;

        const currentTab = this.tabs.find(t => t.id === this.activeTabId);
        if (currentTab) {
          let resolvedPath = filePath;
          if (!resolvedPath.startsWith('/') && !resolvedPath.match(/^[a-zA-Z]:/)) {
            const lastSlash = Math.max(
              currentTab.filePath.lastIndexOf('/'),
              currentTab.filePath.lastIndexOf('\\')
            );
            const dirPath = lastSlash > 0 ? currentTab.filePath.substring(0, lastSlash) : '';
            const separator = currentTab.filePath.includes('\\') ? '\\' : '/';
            resolvedPath = dirPath ? `${dirPath}${separator}${resolvedPath}` : resolvedPath;
          }
          try {
            const content = await readTextFile(resolvedPath);
            this.openTab(resolvedPath, content);
          } catch (error) {
            console.error('Failed to read markdown file:', error);
          }
        }
      });
    }

    const externalLinks = document.querySelectorAll('a[target="_blank"]');
    for (const link of Array.from(externalLinks)) {
      link.addEventListener('click', async (e) => {
        e.preventDefault();
        const href = (link as HTMLAnchorElement).getAttribute('href');
        if (href) {
          try {
            await openUrl(href);
          } catch (error) {
            console.error('Failed to open URL:', error);
          }
        }
      });
    }

    const images = document.querySelectorAll('img');
    for (const img of Array.from(images)) {
      const src = img.getAttribute('src');
      if (!src) continue;

      if (src.startsWith('data:') || src.startsWith('file:')) {
        continue;
      }

      if (src.startsWith('http://') || src.startsWith('https://')) {
        continue;
      }

      const currentTab = this.tabs.find(t => t.id === this.activeTabId);
      if (currentTab) {
        let fullPath = src;
        if (!fullPath.startsWith('/') && !fullPath.match(/^[a-zA-Z]:/)) {
          const lastSlash = Math.max(
            currentTab.filePath.lastIndexOf('/'),
            currentTab.filePath.lastIndexOf('\\')
          );
          const dirPath = lastSlash > 0 ? currentTab.filePath.substring(0, lastSlash) : '';
          const separator = currentTab.filePath.includes('\\') ? '\\' : '/';
          fullPath = dirPath ? `${dirPath}${separator}${src}` : src;
        }
        try {
          const ext = fullPath.split('.').pop()?.toLowerCase() || '';
          if (ext === 'svg') {
            const content = await readTextFile(fullPath);
            const encoded = btoa(unescape(encodeURIComponent(content)));
            img.src = `data:image/svg+xml;base64,${encoded}`;
          } else {
            const contents = await readFile(fullPath);
            const base64 = btoa(Array.from(contents).map(b => String.fromCharCode(b)).join(''));
            const mimeType = ext === 'jpg' ? 'jpeg' : ext;
            img.src = `data:image/${mimeType};base64,${base64}`;
          }
        } catch (error) {
          console.error('Failed to load image:', fullPath, error);
        }
      }
    }
  }

  private async renderMermaidDiagrams(): Promise<void> {
    const mermaidDivs = document.querySelectorAll('.mermaid');
    for (const div of Array.from(mermaidDivs)) {
      const indexStr = div.getAttribute('data-mermaid-index');
      if (indexStr === null) continue;
      const index = parseInt(indexStr, 10);
      const code = this.mermaidCodes.get(index);
      if (!code) continue;
      try {
        const id = `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const { svg } = await mermaid.render(id, code);
        div.innerHTML = svg;
      } catch (error) {
        div.innerHTML = `<pre class="mermaid-error">${String(error)}</pre>`;
      }
    }
  }

  private async toggleTheme(): Promise<void> {
    this.theme = this.theme === 'dark' ? 'light' : 'dark';
    this.applyTheme();
    this.setupMermaid();
    if (this.activeTabId) {
      await this.renderContent();
    }
  }

  private applyTheme(): void {
    document.documentElement.setAttribute('data-theme', this.theme);
    const themeIcon = document.getElementById('theme-icon');
    if (themeIcon) {
      themeIcon.textContent = this.theme === 'dark' ? '🌙' : '☀️';
    }
  }
}

new MarkdownViewer();
