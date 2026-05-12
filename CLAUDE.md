# KENBAN

## プロジェクト概要
2つの画像ファイル（TIFF/PSD/PDF）を比較して差分を検出する検版支援デスクトップアプリ。
Tauri 2 + React + TypeScript + Rust で構成。

## 技術スタック
- **フロントエンド**: React + TypeScript + Tailwind CSS (Vite)
- **バックエンド**: Rust (Tauri 2)
- **画像処理**: `image` crate v0.25 (tiff/png/jpeg), `psd` crate v0.3 + フォールバックパーサー, `rayon` v1.10
- **PDF**: pdfjs-dist (JS側), pdf-lib, jsPDF

## ディレクトリ構成
- `src/App.tsx` - メインコンテナ、状態管理、モーダル
- `src/components/Header.tsx` - ヘッダーバー
- `src/components/Sidebar.tsx` - サイドバー（モード切替、ファイルリスト）
- `src/components/DiffViewer.tsx` - 差分ビューアー（ツールバー、ドロップゾーン、ビューア）
- `src/components/ParallelViewer.tsx` - 並列ビューアー
- `src/components/TextVerifyViewer.tsx` - テキスト照合ビューアー（PSD↔メモ差分、統合/分割/画像ビュー）
- `src/components/GDriveFolderBrowser.tsx` - Google Driveブラウザモーダル
- `src/components/ScreenshotEditor.tsx` - スクリーンショット指示エディタ
- `src/utils/textExtract.ts` - PSDテキスト抽出、差分計算（行セットマッチング、チャンク区切り）
- `src/utils/memoParser.ts` - メモテキストのページ分割・`<<X,YPage>>`パターン解析
- `src/utils/pdf.ts` - PDFキャッシュマネージャ、LRUキャッシュ、Worker起動ラッパ、`nextFrame`/`getOptimalPdfUrlCacheSize`
- `src/workers/pdfOptimize.worker.ts` - PDF最適化（pdf-lib による未参照リソース除去）Web Worker
- `src/workers/textExtractWorker.ts` - PSDテキスト抽出 + 差分計算の Web Worker
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
バージョンは以下の3箇所を同時に更新する:
- `package.json` の `version`
- `src-tauri/tauri.conf.json` の `version`
- `src-tauri/Cargo.toml` の `version`

## 比較モード
- **tiff-tiff**: TIFF同士の比較（シンプル差分）
- **psd-psd**: PSD同士の比較（シンプル差分）
- **pdf-pdf**: PDF同士の比較（ページ単位、JS側で差分計算）
- **psd-tiff (混合)**: PSD→TIFF出力の検証（ヒートマップ差分、JSON cropBounds必要）
- **テキスト照合**: PSDテキストレイヤーとメモテキストの写植照合

## Rustコマンド (invoke)
- `parse_psd` - PSDファイルのデコード
- `decode_and_resize_image` - 画像デコード＋リサイズ（並列ビュー用）
- `preload_images` - 画像プリロード
- `render_pdf_page` - PDFium で 1 ページを RGBA→JPEG temp 出力（並列ビュー用、`high_quality=false`）
- `compute_pdf_diff` - PDFium で両ファイルをレンダリング+ rayon 並列差分計算（pdf-pdf 比較用、`high_quality=true`）
- `get_pdf_page_count` - PDF の総ページ数取得
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
- productName は ASCII (`KENBAN`) でないと latest.json 生成が壊れる

## PSDデコード戦略
`psd` crate v0.3.5 はZIP圧縮や16bit深度でpanic（強制終了）するため、二段構えで対処:
1. **psd crate** を `catch_unwind` でラップして試行（レイヤー合成等の高機能）
2. 失敗/panic時は **フォールバックパーサー** (`decode_psd_fallback`) で再試行
   - PSD合成画像(Image Data Section)のみ読み取る軽量パーサー
   - Raw / RLE (PackBits) 圧縮、RGB / CMYK / Grayscale、PSB に対応
   - ZIP圧縮は未対応（エラー表示で止まる、クラッシュはしない）

対象関数: `parse_psd` (並列ビュー表示用) / `decode_psd_to_image` (差分比較用)

## PDFパフォーマンスアーキテクチャ
PDF読み込み・表示で UI フリーズや過剰なメモリ消費を起こさないため、以下のポリシーで設計されている (MojiQ アーキテクチャを参考に移植)。

### レンダリングDPI ポリシー
- **並列ビュー表示用** (`render_pdf_page`): **150 DPI** + `use_print_quality(false)` — 速度優先、表示に充分
- **pdf-pdf 差分計算用** (`compute_pdf_diff`): **300 DPI** + `use_print_quality(true)` — 差分検出精度を優先
- 切り替えは `render_pdf_page_pdfium(..., high_quality: bool)` の第5引数で行う

### キャッシュ戦略
- **`pdfUrlCacheRef`** (App.tsx): 並列ビューの PDF ページ URL を保持する LRU。サイズは `getOptimalPdfUrlCacheSize()` で `performance.memory.jsHeapSizeLimit` / `navigator.deviceMemory` から動的決定 (20〜60)
- **`pdfCache.bitmapCache`** (pdf.ts): pdf-pdf 比較で使う ImageBitmap LRU (60 上限、evict 時に `bitmap.close()` でGPUメモリ解放)
- **`diffCache`** (App.tsx): pdf-pdf 差分結果の DataURL キャッシュ (現状無制限、ファイル/インデックス切替で再生成)

### バックグラウンド事前レンダリング (進捗バー付き)
PDF読み込み時に全ページを直列バックグラウンドで処理し、`globalOptimizeProgress` で N/M 進捗を画面中央バナーに表示する。各 useEffect は `AbortController` 付きで、ファイル切り替え時に前ジョブを即停止する。
- **並列ビュー**: `render_pdf_page` (DPI 150) を 1 ページずつ実行、各ページ後に `nextFrame()` + 30ms 待機で UI 圧迫を回避
- **pdf-pdf 比較**: `compute_pdf_diff` (DPI 300) を 1 ページずつ実行、50ms 待機で GC 機会を確保
- 完了時に「完了」メッセージで `optimizeProgress` を発火 → [App.tsx] の自動非表示ロジックで 1 秒後に消える

### PDF最適化 (`optimizePdfResources`)
- pdf-lib による未参照リソース除去。10MB 〜 500MB の PDF に適用
- **Web Worker** (`src/workers/pdfOptimize.worker.ts`) で実行 → メインスレッドを完全に解放
- ArrayBuffer は Transferable で受け渡し (コピーなし)
- 500MB 超は別経路で `compressPdfViaCanvas` (pdfjs + jsPDF で Canvas 再構築)

### ページ未完了時のフォールバック表示
- **並列ビュー**: `parallelPdfImageA/B` が null の間、A 側は青、B 側は緑の `Loader2` スピナーを表示 ([ParallelViewer.tsx])
- **pdf-pdf 比較**: 既存の `isLoadingPage` フラグで小スピナーを表示

### Canvas描画
- `ParallelViewer.drawToCanvasWithScale`: `dpr = Math.min(2, devicePixelRatio)` で頭打ち。150DPI 出力に対して 3 倍 dpr は過剰なため

## テキスト照合アーキテクチャ
- `extractVisibleTextLayers` (ag-psd) → レイヤー単位テキスト抽出 → マンガ読み順ソート
- `combineTextForComparison` でレイヤー間を `\n\n` 結合（チャンク境界）
- `normalizeTextForComparison(text, preserveChunks?)` で正規化。`preserveChunks=true` 時、空行を `CHUNK_BREAK` (U+2063) に変換
- `computeLineSetDiff` / `computeSharedGroupDiff` で行セットマッチング（完全一致→ファジーマッチ）
- `buildUnifiedDiff` で統合ビュー用エントリ生成（match / diff / linebreak / separator）
- `postProcessChunkBreaks` で CHUNK_BREAK → separator エントリ変換
- `layerDiffMap` (TextVerifyViewer) でPSD画像上のSVGハイライト位置計算

## 注意事項
- App.tsx が巨大なので編集時は行番号を確認すること
- `processingRef` → `processingCountRef` 等のリファクタリング時は参照箇所を全検索
- ファイルの `filePath` プロパティ (FileWithPath) はTauri経由のドロップ時のみ設定される
