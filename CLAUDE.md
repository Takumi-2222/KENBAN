# KENBAN-viewer (検版ビューアー)

## プロジェクト概要
2つの画像ファイル（TIFF/PSD/PDF）を比較して差分を検出する検版支援デスクトップアプリ。
Tauri 2 + React + TypeScript + Rust で構成。

## 技術スタック
- **フロントエンド**: React + TypeScript + Tailwind CSS (Vite)
- **バックエンド**: Rust (Tauri 2)
- **画像処理**: `image` crate v0.25 (tiff/png/jpeg), `psd` crate v0.3, `rayon` v1.10
- **PDF**: pdfjs-dist (JS側), pdf-lib, jsPDF

## ディレクトリ構成
- `src/App.tsx` - メインコンテナ、状態管理、モーダル
- `src/components/Header.tsx` - ヘッダーバー
- `src/components/Sidebar.tsx` - サイドバー（モード切替、ファイルリスト）
- `src/components/DiffViewer.tsx` - 差分ビューアー（ツールバー、ドロップゾーン、ビューア）
- `src/components/ParallelViewer.tsx` - 並列ビューアー
- `src/components/GDriveFolderBrowser.tsx` - Google Driveブラウザモーダル
- `src/components/ScreenshotEditor.tsx` - スクリーンショット指示エディタ
- `src/index.css` - Tailwind CSS v4 @theme カラートークン、フォント、スクロールバー
- `src/App.css` - フルスクリーンアニメーション、ベーススタイル
- `src-tauri/src/lib.rs` - Rustバックエンド（Tauriコマンド）
- `src-tauri/Cargo.toml` - Rust依存関係

## ビルド・開発
```bash
npm install
npm run tauri dev      # 開発サーバー起動
npm run tauri build    # リリースビルド
cargo check            # Rustのみコンパイルチェック（src-tauri/内で実行）
```

## バージョン管理
バージョンは以下の2箇所を同時に更新する:
- `package.json` の `version`
- `src-tauri/tauri.conf.json` の `version`

## 比較モード
- **tiff-tiff**: TIFF同士の比較（シンプル差分）
- **psd-psd**: PSD同士の比較（シンプル差分）
- **pdf-pdf**: PDF同士の比較（ページ単位、JS側で差分計算）
- **psd-tiff (混合)**: PSD→TIFF出力の検証（ヒートマップ差分、JSON cropBounds必要）

## Rustコマンド (invoke)
- `parse_psd` - PSDファイルのデコード
- `decode_and_resize_image` - 画像デコード＋リサイズ（並列ビュー用）
- `preload_images` - 画像プリロード
- `open_pdf_in_mojiq` - MojiQアプリでPDFを開く
- `open_file_with_default_app` - デフォルトアプリで開く
- `list_files_in_folder` - フォルダ内ファイル一覧
- `save_screenshot` - スクリーンショット保存

## Cargo.toml最適化
- `[profile.dev] opt-level = 2` - dev buildでも画像処理を最適化
- `[profile.dev.package.image]` / `[profile.dev.package.psd]` に `opt-level = 3`
- release: `opt-level = 3`, `lto = "thin"`, `codegen-units = 1`

## UI設計 — "Quiet Authority"
デザインコンセプト: プロフェッショナルリファレンスモニターのマットブラックベゼルのように、存在するが画像の邪魔をしないUI。

### カラーシステム (Tailwind CSS v4 @theme)
- **ベース**: クールダーク `#0e0e10` (neutral-950) 〜 `#f0f0f4` (neutral-50)
- **サーフェス階層**: base → raised (#16161a) → overlay (#1c1c22) → elevated (#24242c) → interactive (#2c2c36)
- **ボーダー**: `rgba(255,255,255, 0.04〜0.16)` ベースの微ボーダー + シャドウで奥行き
- **テキスト**: primary #ececf0 / secondary #9898a4 / tertiary #5c5c6a
- **アクセント**: ティント＋ウォッシュ方式（低彩度テキスト + `rgba(color, 0.12)` 背景 + `rgba(color, 0.20)` ボーダー）
  - Blue: #7c9cc4 (TIFF) / Purple: #a48cc4 (PSD) / Rose: #c48c9c (PDF) / Orange: #c4a47c (混合)
- **セマンティック**: 成功 #7cb88c / エラー #c47c7c / アクション #6b8aff (`text-action`)
- **ガイド色**: シアン (#00e5ff / #00bcd4) — 差分マーカー用

### フォント
- `Inter` + `Noto Sans JP` (Google Fonts、index.html でロード)
- モノスペース: システムフォント

### コンポーネントパターン
- **セグメントコントロール**: `bg-neutral-950 rounded-lg p-0.5` + アクティブ `bg-neutral-700 shadow-sm`
- **ポップアップ**: `bg-neutral-800/95 backdrop-blur-md border border-white/[0.06] rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.5)]`
- **KBDバッジ**: `bg-white/[0.06] text-neutral-500 border border-white/[0.08]`
- **ドロップゾーン**: `border border-dashed border-white/[0.08] rounded-xl`
- **プログレスバー**: `bg-action` + `shadow-[0_0_8px_rgba(107,138,255,0.3)]`
- **スクロールバー**: 6px幅、`rgba(255,255,255,0.08)` サム

## 自動更新
- tauri-plugin-updater 使用
- GitHub Releases から latest.json を参照
- productName は ASCII (`KENBAN-viewer`) でないと latest.json 生成が壊れる

## 注意事項
- App.tsx が巨大なので編集時は行番号を確認すること
- `processingRef` → `processingCountRef` 等のリファクタリング時は参照箇所を全検索
- ファイルの `filePath` プロパティ (FileWithPath) はTauri経由のドロップ時のみ設定される
