# Markdown Viewer

[Tauri v2](https://v2.tauri.app/) と TypeScript で構築した、シンプルなデスクトップ向け Markdown ビューアです。

[English](README.md)

## 機能

- **マルチタブ** — 複数の Markdown ファイルをタブで同時に開ける
- **Mermaid ダイアグラム** — フローチャート、シーケンス図、ER 図などを描画
- **ローカル画像の埋め込み** — 相対パスの画像を Base64 に変換してインライン表示
- **Markdown リンクナビゲーション** — `.md` ファイルへのリンクはアプリ内で追跡、外部 URL はシステムブラウザで開く
- **ドラッグ＆ドロップ** — `.md` ファイルをウィンドウにドロップして開ける
- **ダーク / ライトテーマ** — テーマを切り替え可能
- **キーボードショートカット** — `Ctrl+O` 開く、`Ctrl+W` タブを閉じる、`Ctrl+Tab` / `Ctrl+Shift+Tab` タブ切り替え
- **XSS 対策** — [DOMPurify](https://github.com/cure53/DOMPurify) による HTML サニタイズ

## 対応ファイル拡張子

`.md` `.markdown` `.mdown` `.mkd`

## インストール

### ソースからビルド

#### 前提条件

- [Node.js](https://nodejs.org/) 18 以上
- [Rust](https://www.rust-lang.org/tools/install)（stable）
- 各プラットフォームの [Tauri 前提条件](https://v2.tauri.app/start/prerequisites/)

#### 手順

```bash
git clone https://github.com/tagumasa/markdown-viewer.git
cd markdown-viewer
npm install
npm run build
```

ビルド成果物は `src-tauri/target/release/` に出力されます。

#### 開発モード

```bash
npm run dev:tauri
```

## 技術スタック

| 層 | 技術 |
|----|------|
| デスクトップシェル | [Tauri v2](https://v2.tauri.app/)（Rust） |
| フロントエンド | TypeScript + Vanilla JS |
| ビルドツール | [Vite v5](https://vitejs.dev/) |
| Markdown パーサー | [marked v12](https://marked.js.org/) |
| ダイアグラム | [Mermaid v11](https://mermaid.js.org/) |
| HTML サニタイズ | [DOMPurify v3](https://github.com/cure53/DOMPurify) |

## ライセンス

[MIT](LICENSE)
