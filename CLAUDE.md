# KENBAN

## プロジェクト概要
2つの画像ファイル（TIFF/PSD/PDF）を比較して差分を検出する検版支援デスクトップアプリ。
Tauri 2 + React + TypeScript + Rust で構成。

## v2.3.0 変更点（2026-05-14）
参照側 (`KENBAN-main`) からの機能ポート。比較モードを 5 → 7 種類に拡張。

### 新比較モード
- **psd-pdf**: PSDとPDF/画像の差分比較。スケール/オフセット手動調整 + 中心固定 5 段階自動位置合わせ（5ppm刻み）。多ページPDF + 単一PSD（または逆）は自動でページごとのペアに展開
- **color-mono**: カラー(RGB 350dpi)とモノクロ(Grayscale 600dpi)の差分比較。ITU-R BT.601 luma による色域正規化 + モノクロ濃部マスク（紙白・淡トーン除外）

### 追加 Rust コマンド
- `compute_diff_psd_pdf` / `check_diff_psd_pdf` — psd-pdf ヒートマップ差分（scale/offset/anchor/page/diff_style パラメータ）
- `auto_align_psd_pdf` — 中心固定 5 段階スケール探索（0.80〜1.20 → ±2% → ±0.5% → ±0.02% → ±0.005% / 5ppm刻み）+ フル解像度差分計算
- `compute_diff_color_mono` / `check_diff_color_mono` — color-mono ヒートマップ差分（dark_threshold 既定 200）

### 追加 Rust ヘルパー
- `PsdCacheEntry` / `decode_psd_cached` — PSD デコード結果のプロセス内 LRU (2エントリ、`(path, mtime)` キー)
- `diff_heatmap_core_masked` — マスク付き積分画像ベースのヒートマップ差分コア
- `prepare_color_mono` — 解像度正規化 + luma グレースケール変換 + モノクロ濃部マスク生成
- `decode_reference_for_psd_compare` — PDF/画像を PSD 寸法に合わせてレンダリング（PDFは pt 単位 viewport から DPI 算出）
- `render_aligned_to_canvas` — アスペクト比保持フィット + ユーザー指定オフセット/倍率で平行移動
- `score_overlap_only` / `make_scaled_mover_rgba` / `search_best_scale_centered` — auto_align のスコア計算と探索ロジック

### 追加 TypeScript / UI
- [src/types.ts](src/types.ts): `CompareMode` に `'psd-pdf'` / `'color-mono'` 追加、`FilePair.pdfPage?` 追加
- [src/App.tsx](src/App.tsx): `psdPdfScale/OffsetX/OffsetY/Anchor` state、多ページPDF自動展開 useEffect、`processPair`/`checkPair` 拡張（psdPdfOverride 引数追加）、`autoAlignPsdPdf` / `applyPsdPdfAlignment` / `processAllPsdPdf` 関数
- [src/components/DiffViewer.tsx](src/components/DiffViewer.tsx): 初期モード選択画面に「PSD↔PDF」「カラー/モノクロ」ボタン、ツールバーに位置調整ポップアップ（X/Y/倍率/基準切替/自動位置合わせ/リセット）
- [src/components/Sidebar.tsx](src/components/Sidebar.tsx): モード選択に「PSD↔PDF」「カラー/モノクロ」ボタン + アクセントカラー追加

### バージョン
- 2.2.20 → 2.3.0（package.json / Cargo.toml / tauri.conf.json）

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
- **psd-pdf**: PSDとPDF/画像の差分。スケール/オフセット手動調整＋自動位置合わせ (5段階探索、5ppm刻み) 機能付き。B側に多ページPDFが1ファイルだけある場合は自動でページごとのペアに展開（PSD#i ↔ PDF page i）
- **color-mono**: カラー(A=RGB 350dpi) × モノクロ(B=Grayscale 600dpi) のヒートマップ差分。解像度・色域差を正規化（ITU-R BT.601 luma）し、モノクロ濃部マスク（B側 luma ≤ 200 のみ比較対象）で紙色・淡いトーンを除外。表示はカラー/モノクロのオリジナルをそのまま見せる
- **テキスト照合**: PSDテキストレイヤーとメモテキストの写植照合

## Rustコマンド (invoke)
- `parse_psd` - PSDファイルのデコード
- `decode_and_resize_image` - 画像デコード＋リサイズ（並列ビュー用）
- `preload_images` - 画像プリロード
- `render_pdf_page` - PDFium で 1 ページを RGBA→JPEG temp 出力（並列ビュー用、`high_quality=false`）
- `compute_pdf_diff` - PDFium で両ファイルをレンダリング+ rayon 並列差分計算（pdf-pdf 比較用、`high_quality=true`）
- `compute_diff_psd_pdf` / `check_diff_psd_pdf` - PSD ↔ PDF/画像 のヒートマップ差分。`scale`/`offset_x`/`offset_y`/`anchor` ('ref' or 'psd') で位置合わせ、`page` で PDF ページ指定、`diff_style` で 'heatmap' or 'simple' 切替
- `auto_align_psd_pdf` - PSD ↔ PDF/画像 の自動位置合わせ（5段階スケール探索: 2% → 0.5% → 0.05% → 0.002% → 0.0005% = 5ppm 刻み、中心固定）
- `compute_diff_color_mono` / `check_diff_color_mono` - カラー ↔ モノクロ のヒートマップ差分。`dark_threshold` (既定200) で濃部マスクの閾値を指定
- `get_pdf_page_count` - PDF の総ページ数取得
- `open_pdf_in_mojiq` - MojiQアプリでPDFを開く
- `open_file_in_photoshop` - 指定PSDをPhotoshop.exeで起動（path未指定なら自動探索）
- `open_file_in_comic_bridge` - 指定PSDを `comic-bridge.exe --shashoku <path>` 形式で起動（COMIC-Bridge側で写植関連ビューを自動オープン）
- `open_file_with_default_app` - デフォルトアプリで開く
- `list_files_in_folder` - フォルダ内ファイル一覧
- `save_screenshot` - スクリーンショット保存

## psd-pdf モードのアーキテクチャ
PSD と PDF/画像 (TIFF/JPG/PNG) を比較するモード。
- **多ページPDF対応**: B側が単一の多ページPDFの場合、`useEffect` で PDF ページ数 × PSD 数のペアに自動展開（`pdfPage` フィールド付き）
- **PSDデコードキャッシュ**: `decode_psd_cached` がプロセス内 LRU (2エントリ) で `(path, mtime)` 一致時はデコード結果を再利用 → 多ページPDFで同じPSDを何十回もデコードする無駄を回避
- **render_aligned_to_canvas**: アスペクト比保持で mover を canvas にフィット + ユーザー指定オフセット/倍率で平行移動
- **anchor**: 'ref' (既定) = PDF/画像が基準で PSD を動かす / 'psd' = PSD が基準で PDF/画像を動かす
- **auto_align_psd_pdf**: 中心固定の 5 段階スケール探索（重なり領域のみのSAD最小化）。サムネ最大1000pxで探索、フル解像度で最終差分計算
- **グローバル設定**: scale/offset/anchor は全ペアに反映。変更時は他のペアを invalidate して再処理
- **位置調整UI**: DiffViewer ツールバーの「位置調整」ポップアップ。X/Y オフセット (±1/±10px)、倍率 (±0.01)、基準切替、自動位置合わせ、リセットボタン

## color-mono モードのアーキテクチャ
カラー原稿 (RGB 350dpi) とモノクロ原稿 (Grayscale 600dpi) を比較するモード。
- **解像度正規化**: 両画像を max(wA, wB) × max(hA, hB) に CatmullRom 上スケール
- **色域正規化**: ITU-R BT.601 luma 式 (R\*299 + G\*587 + B\*114) / 1000 で R=G=B 置換（差分計算用、表示はオリジナルのまま）
- **モノクロ濃部マスク**: B側 luma ≤ `dark_threshold` (既定200) のピクセルのみを比較対象 → 紙の白部分や淡いトーンを除外、人物・吹き出し・ベタだけをチェック
- **差分計算**: `diff_heatmap_core_masked` (マスク付き積分画像 → 密度マップ → ヒートマップ着色)
- **表示**: A=カラー / B=モノクロ をオリジナルのまま、差分のみヒートマップ画像

## 外部アプリ起動ボタン（PSDモード時）
PSDが選択可能な場面（テキスト照合 / 差分ビュー / 並列ビュー）で `Photoshop` ボタンの隣に表示:
- **Photoshop / Ps**: そのまま PSD を Photoshop で開く（[P] キー）
- **CB写植**: COMIC-Bridge を `--shashoku <psd_path>` で起動 → COMIC-Bridge 側が写植関連ビュー（typesetting）を自動表示
  - 対応バージョン: COMIC-Bridge v1.9.12 以降（古い版だと CLI フラグが無視されホーム画面で開く）
  - パス探索: `%LocalAppData%\Comic-Bridge\comic-bridge.exe` を優先、なければ Program Files

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

## 並列ビュー UIアーキテクチャ
並列ビュー (`appMode === 'parallel-view'`) のツールバー / パネル内ボタン構成は次のとおり。

### Header.tsx スロットへの portal 統合
- `Header.tsx` に `<div id="header-toolbar-slot" />` のスロットがあり、ViewerはそれぞれのツールバーJSXを `createPortal(toolbarContent, document.getElementById('header-toolbar-slot'))` で差し込む（DiffViewer と同じパターン）
- ParallelViewer 内には独立した `bg-neutral-800/80 ... h-12` 系のローカルヘッダー / 二段目ツールバーは **存在しない**。Photoshop / CB写植 / MojiQ / フォルダ / 同期⇔非同期 / 更新 / 閲覧(F11) / ハンバーガー(?) のボタンはすべて Header スロットに portal される
- スロットを useEffect 内 `requestAnimationFrame` ループで遅延探索することで、Headerマウント順に依存しない
- レイアウト: `justify-between` で 左=操作系ボタン、右=閲覧+ハンバーガー
- ハンバーガーのヘルプパネルは `getBoundingClientRect()` ベースで `document.body` に portal、ボタン直下に出る

### 初期モード選択 → 並列ビュー遷移時の sidebar 表示
`initialModeSelect=true` のときサイドバーは `w-0` で隠れる（[Sidebar.tsx]）。`initialModeSelect` をクリアし忘れると並列ビューに入ってもサイドバーが消えたままになる。以下3箇所すべてで `setInitialModeSelect(false)` を呼ぶ必要がある:
- ホーム画面 [DiffViewer.tsx] の「分割ビューアー」ボタン (`setSidebarCollapsed(false)` も合わせて)
- [Sidebar.tsx] のモード切替「並列」ボタン
- [App.tsx] の V キーによる `diff-check ↔ parallel-view` 切替

### パネル内アクションボタン (指示エディタ + ファイル再読み込み)
A/B 各パネルの右下 (`absolute bottom-6 right-2`) に、`Eye` トグル + 横並び2ボタンの構成で表示:
- **読み込み (緑 `bg-green-600/90`)**: PDFパネルなら `handleSelectParallelPdf(side)`、画像/フォルダパネルなら `handleSelectParallelFolder(side)` を呼んでファイルピッカーを開く。`e.stopPropagation()` で親パネルへの伝播を阻止しないとパネル切替だけ起きてピッカーが開かない
- **指示 (青 `bg-blue-600/90`)**: 現在の画像URLを `setParallelCapturedImage{A|B}` に渡して ScreenshotEditor を起動
- サイズは `px-2 py-1.5 text-xs`, アイコン `size={12}`, `rounded-md`（標準の指示ボタンより約30%小さい）
- A 側パネルでも B 側パネルでも「左から緑→青」で統一

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
