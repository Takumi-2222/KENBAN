# KENBAN

## プロジェクト概要
2つの画像ファイル（TIFF/PSD/PDF）を比較して差分を検出する検版支援デスクトップアプリ。
Tauri 2 + React + TypeScript + Rust で構成。

## 速度最適化（2026-05-15、speed lab で検証後に移植）
`KENBAN\処理速度研究\psd-speed-lab` で計測・検証した PSD 差分高速化を本体へ移植。
PSD×PSD で **total ~1655ms → ~335ms（約5倍速）** を実測（4961×7016 / 70MB級）。

### 移植した3つの最適化（src-tauri/src/lib.rs）
1. **`fast_downscale_to_rgba`**（新ヘルパー）: `fast_image_resize`(SIMD) でリサイズ → `RgbaImage` を直接返す。元が Rgba8 ならゼロコピー参照。`image` crate の単スレッド Triangle/CatmullRom より実測 **8倍速**。filter 引数で品質選択（Bilinear≒Triangle / CatmullRom=psd-tiff 品質維持）
2. **A/B リサイズの並列化**: `compute_diff_simple` / `compute_diff_heatmap` / `compute_diff_color_mono` の resize 段を `rayon::join` で A/B 同時実行 + `fast_downscale_to_rgba` 使用。diff 後に `DynamicImage::ImageRgba8` へ move（コピーなし）でエンコード、full-res は早期 `drop`
3. **`decode_psd_fallback` の並列化**（全PSDモード共通で効く）:
   - RLE 展開: 全スキャンライン開始位置を prefix-sum で先に確定 → `par_chunks_mut(width)` で行並列展開（実測 ~70ms→~12ms）
   - RGBA 組立: CMYK/RGB 両パスを `par_chunks_mut(4)` で並列化（実測 ~210ms→~10ms、グレースケール大の最大ボトルネックだった）

### 依存追加
- `Cargo.toml`: `fast_image_resize = "5"` + `[profile.dev.package.fast_image_resize] opt-level=3`

### 計測の続き（speed lab 側、未移植）
speed lab には decode 各段の `[PERF-DEC]` 計測が入っている。残ボトルネックは
encode(~130ms, turbojpeg 化候補) と fs_read(~50ms, I/Oバウンド)。本体には計測 eprintln は
入れていない（速度研究は speed lab で継続し、確定した改善のみ本体へ移植する方針）。

## PDF差分・分割ビューアーの高速化（2026-05-15 追加移植）
speed lab で PDF×PDF を計測（13ページ/300dpi で **39.5s → 19.1s 約2倍速**）し、確定分を移植。

### `compute_pdf_diff_all` / `pdf_postprocess_page`（新規, src-tauri/src/lib.rs）
- PDF を A/B **各1回だけロード**（旧 `compute_pdf_diff` はページ毎に `load_pdf_from_file` で
  PDF 全体を再パースしていた無駄を除去）
- `std::thread::scope` でパイプライン化: PDFium レンダ（逐次・スレッド非安全なので caller
  スレッド）と後段 resize/diff/encode（純CPU）をワーカーへ逃がし、後段を次ページのレンダ裏に隠す
- 全ページ完了後に `Vec<DiffSimpleResult>` を一括返却（ストリーミング配信はしない＝
  ユーザー要望「1ページずつでなく最初にまとめて処理」に準拠）
- フロント [src/App.tsx] の pdf-pdf バックグラウンドプリレンダ（旧: 毎ページ `compute_pdf_diff`
  を while ループ）を `compute_pdf_diff_all` 1回呼び出しに置換。選択中ページは従来通り
  `processPair`(`compute_pdf_diff`) が即表示するので体感遅延なし。`pdfComputingPages` は
  batch化により常時空（ページ毎スピナー廃止）、`inFlightPagesRef` 削除

### 分割ビューアー（parallel-view）も同じ高速経路に統一
- `resize_and_write_to_temp`（`decode_and_resize_image` 経由＝分割ビューア表示用）の
  `image` crate 単スレッド resize を `fast_downscale_to_rgba`(SIMD並列) に置換
- 分割ビューアの PSD 表示（`parse_psd` → `decode_psd_robust` → `decode_psd_fallback`）は
  上記「decode_psd_fallback 並列化」を共有しているため自動的に高速化済み

### psd-pdf モードも高速経路へ（2026-05-15 段階移植・stage1）
- `render_aligned_to_canvas`（compute_diff_psd_pdf / check_diff_psd_pdf の本処理リサイズ実体。
  auto_align の最終フル解像度レンダでも使用）の `resize_exact(CatmullRom)` を
  `fast_downscale_to_rgba(.., FirFilter::CatmullRom)` に置換（失敗時のみ旧経路へフォールバック、
  シグネチャ不変＝呼び出し側無改変）。CatmullRom 同士で位置合わせ品質は従来同等
- **auto_align の探索ループ（`make_scaled_mover_rgba`、サムネ≤1000px）は意図的に未変更**。
  精度敏感かつ既に高速なため。render_aligned_to_canvas 変更は探索精度に無影響
- これで全 7 モード + 分割ビューアーが新リサイズ方式に統一（PSDデコードも
  decode_psd_fallback 並列化を全モード共有）。残: auto_align 探索ループのみ旧 Triangle（意図的）

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
- **整列前は差分検知しない（差分2回計算の回避 / 2026-05-19）**: `psdPdfReady` ゲート。
  psd-pdf 入場時・多ページ展開時に `false`。`false` の間は「自動処理」useEffect の
  psd-pdf 分岐が return して**何も差分計算しない**（旧: 読込時に等倍 scale 1.0 で全ペア
  差分→自動位置合わせ後に再度全ペア差分＝2回）。`autoAlignPsdPdf` / `applyPsdPdfAlignment`
  / `processAllPsdPdf` で `true` にして以降の pending を処理。DiffViewer の「自動位置合わせ」
  ボタンは status=pending でも押せるよう disabled 条件を `!fileA||!fileB` のみに緩和
  （ゲート中はペアが pending のままなので、done/checked 条件だと押せず詰む）

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
- `[profile.dev.package.image]` / `[profile.dev.package.psd]` / `[profile.dev.package.fast_image_resize]` に `opt-level = 3`（fast_image_resize は SIMD なので最適化必須）
- release: `opt-level = 3`, `lto = "thin"`, `codegen-units = 1`

## 差分処理の高速化（speed lab で検証後に移植 / 2026-05-15）
PSD×PSD の処理速度を `KENBAN/処理速度研究/psd-speed-lab` で計測・検証し、効果を確認した3点を本体に移植済み。4961×7016 PSD で total ~1655ms → ~335ms（**約5倍速**）を実測。

### ① decode_psd_fallback の並列化（全PSDモード共通・最重要）
- **RLE展開**: スキャンライン開始位置を prefix-sum で先に確定し `ch_data.par_chunks_mut(width)` で行並列 PackBits 展開（カラー decomp ~70ms → ~12ms, 約6倍）
- **RGBA組立**: `for i in 0..pixel_count` のスカラーループ（グレースケールで ~210ms のボトルネック）を `rgba.par_chunks_mut(4).enumerate()` でピクセル並列化（~210ms → ~10ms, 約20倍）
- `decode_psd_fallback` は全 PSD デコード経路（parse_psd / decode_psd_cached / 全 compute_diff_*）が通るので全モードに効く

### ② fast_image_resize (SIMD) 化 + A/B 並列リサイズ
- `fast_downscale_to_rgba(img, w, h, filter)` ヘルパー追加。`image` crate の単スレッド `resize_exact` を SIMD の `fast_image_resize` に置換、戻り値を `RgbaImage` 直接にして後段 `to_rgba8()` の二度手間も解消。元が Rgba8 ならゼロコピー参照
- フィルタ: 通常 `Bilinear`(≒Triangle)、psd-tiff の PSD 側のみ `CatmullRom`（PSD→TIFF 出力検証の画質維持）
- `compute_diff_simple` / `compute_diff_heatmap` / `compute_diff_color_mono` の resize 段を `rayon::join` で A/B 並列＋fast 化（resize ~1050ms → ~131ms, 約8倍）。diff 後に `RgbaImage` を `DynamicImage::ImageRgba8(..)` へ move（コピーなし）してエンコード、full-res バッファは即 `drop`
- **Phase1 `check_diff_simple` / `check_diff_heatmap` / `check_diff_color_mono` にも同じ fast+並列リサイズを適用済み**（2026-05-15 修正）。本体は全ペアに Phase1 check を走らせるため、ここを旧 `downscale_if_needed` のままにすると compute 側を速くしても全体が倍以上遅くなる（speed lab は compute のみ呼ぶので顕在化しなかった罠）。`downscale_if_needed` は全置換され `#[allow(dead_code)]` で残置

### ③ PDF×PDF 高速化（pdf-pdf 専用 / 2026-05-15、speed lab 実測 39.5s→19.1s ≒2倍）
- `compute_pdf_diff_all(path_a, path_b, dpi, threshold) -> Vec<DiffSimpleResult>` を追加。
  従来 `compute_pdf_diff` はページ毎に `load_pdf_from_file()` で **PDF全体を毎回再パース**（12ページ=12回フルパース）していた無駄を、**A/B 各1回ロード**に削減
- さらに `std::thread::scope` で **PDFium レンダ(逐次・スレッド非安全)** と **後段 resize/diff/encode(純CPU=`pdf_postprocess_page`)** をパイプライン化。ページN の後段をワーカースレッドで実行しつつメインは N+1 のレンダへ進む
- 全ページ完了後に Vec を一括返却（ストリーミング配信はしない＝「最初にまとめて処理」）
- フロント: `App.tsx` の pdf-pdf 背景処理（`calculateAllPages`）を「ページ毎 `compute_pdf_diff` ループ」→「`compute_pdf_diff_all` 1回呼びで全ページ `diffCache` 一括投入」に置換。1ページ目だけ従来どおり `compute_pdf_diff` で即表示（UX維持）、残りを一括計算。`inFlightPagesRef`/`setPdfComputingPages`（ページ毎スピナー）は不要になり削除
- psd-pdf / 並列ビューの PDF（`render_pdf_page`, 150dpi 単ページ・オンデマンド）は用途が異なるため変更せず

### ④ 分割ビューアー（ParallelViewer）にも fast リサイズ適用
- `resize_and_write_to_temp`（`decode_and_resize_image` が使う表示画像リサイズ）の `image` crate 単スレッド `resize(Triangle)` を `fast_downscale_to_rgba`(SIMD, Bilinear≒Triangle) に置換。差分側と同じ高速経路
- 並列ビューの PSD は `parse_psd → decode_psd_robust`（①の `decode_psd_fallback` 並列化を共有）で自動的に高速化済み

### ⑤ PSD×PDF 高速化（psd-pdf 専用 / 2026-05-18、speed lab 実測 3761→1931ms ≒2倍）
**背景**: psd-pdf だけ `preview_long_edge` が未配線で、高速(1500)/標準(2500) を切替えても
PDF を常に PSDフル寸法相当の高DPIでレンダ＋フルPSDをJPEGエンコードしており「高速モードでも遅い」状態だった。

- **①preview解像度化（最大効果・speed lab実証）**:
  - `decode_reference_for_psd_compare` に `preview_long_edge: Option<u32>` を追加。preview指定時は
    `calc_preview_dims(psd_w,psd_h,preview)` 基準でPDFをレンダ（DPI下限を 150→36/72 に緩和、上限600）、
    画像参照も `fast_downscale_to_rgba` で縮小
  - `compute_diff_psd_pdf` / `check_diff_psd_pdf` に `preview_long_edge` 追加。PSDも preview 縮小版
    (`psd_use`) を src_a エンコード／anchor=psd キャンバスに使用。キャッシュキーに preview 長辺(`pv`)を付与
    （preview モード切替の stale 回避）
  - **`auto_align_psd_pdf` は意図的に `None`（フル寸法）で参照デコード**。preview縮小版で探索すると
    線画ディテールが落ちて適正スケールを取り損ねるため（探索精度優先）
  - フロント [src/App.tsx]: `compute_diff_psd_pdf` / `check_diff_psd_pdf` invoke に `previewLongEdge` を渡す
    （`previewLongEdgeByMode['psd-pdf']` 既定2500。値は既に存在したが未配線だった）
- **②多ページパイプライン**:
  - `compute_diff_psd_pdf_all`（新規）+ `psd_pdf_postprocess`（後段ヘルパー）。PSD を1回デコード
    （キャッシュ＋preview縮小をArc共有）＋ PDF を1回ロードし、`std::thread::scope` で
    PDFiumレンダ(逐次)と後段(位置合わせ/差分/encode、純CPU)をパイプライン化。全ページ Vec 一括返却。
    scale/offset/anchor は全ページ共通（本体グローバル設定と同一運用）
  - フロント: `processAllPsdPdf` 内に `tryBatchPsdPdf` を追加。全ペアが「同一PSD×同一PDFで
    pdfPage=0..N-1 連番」（=1PSD×多ページPDF展開）なら `compute_diff_psd_pdf_all` を1回呼び。
    条件に合わなければ従来の per-page `processPair` 逐次にフォールバック（無改変・無リスク）
- 旧 `decode_reference_for_psd_compare(...,page)` 3引数 → 4引数化。全呼び出し元更新済み

### ⑥ psd-pdf「整列まで差分検知しない」+ 並列ビュー高速化/UI改修（2026-05-19）
- **psd-pdf 整列ゲート（差分2回計算の回避）**: `psdPdfReady` state。psd-pdf 入場/多ページ展開で
  `false`、`false` の間は「自動処理」useEffect の psd-pdf 分岐 + `diffDetectionState`
  オーバーレイ + Sidebar 進捗バー/`isProcessing` を全て抑止（読込時の等倍差分→整列後再差分の
  二重計算を排除）。`autoAlignPsdPdf`/`applyPsdPdfAlignment`/`processAllPsdPdf` で `true`。
  Sidebar/DiffViewer に `psdPdfAwaitingAlignment` prop で「位置合わせ待ち」表示。
  DiffViewer 位置調整ポップアップ: 自動位置合わせを最下部へ移動し OK 化（押下＝整列＋差分検知開始）
- **#2 並列ビュー PDF 一括レンダ**: `render_pdf_pages_batch(path,dpi,requests:[{page,splitSide}])`
  新設（`PdfPageImage` を Vec 返却）。PDF を1回ロード→ユニークページのみ1回レンダ（pdfium 逐次）
  →crop/encode は rayon 並列。cache キーは `render_pdf_page` と同一で再利用。フロントの
  並列ビュー背景プリレンダを「ページ毎 `render_pdf_page`（毎回 PDF 開き直し）」→「PDFパス毎
  `render_pdf_pages_batch` 1回」に置換
- **#3 並列ビュー「PDF構成」ドロップダウン**: 旧「単ページ化」ボタン＋hover「1P単独」を
  3モード選択（①表紙だけ単独+見開き分割 ②見開きを左右分割 ③そのまま表示）＋「A/B両方に適用」
  ＋「展開後 N→M表示」へ置換（[ParallelViewer.tsx] `renderPdfLayoutControl`）。内部状態は
  従来の `spreadSplitMode{A,B}`/`firstPageSingle{A,B}` 据え置き（モードから導出/設定）。
  `expandPdfToParallelEntries` に `forceFirstSingle` 引数追加（モード変更を stale なく即適用）。
  既定を①に変更（`spreadSplitMode{A,B}` 初期値 false→true）

### ⑦ encode 高速化（jpeg-encoder / 2026-05-19）
- `encode_to_jpeg_temp`（[src-tauri/src/lib.rs] 全モードの src_a/src_b/processed_a 生成）の
  `image` crate JPEG エンコーダを **`jpeg-encoder`（純Rust + ランタイムSIMD）** に置換。
  `Cargo.toml`: `jpeg-encoder = "0.6"` ＋ `[profile.dev.package.jpeg-encoder] opt-level=3`
- turbojpeg は libjpeg-turbo の C ビルド（cmake/nasm）が必要で当環境に無いため不採用。
  jpeg-encoder は C 依存なし＝ネイティブビルド破損リスクなし。speed lab にも同適用済み
- `encode_rgba_to_png_temp`（差分 PNG）は対象外（PNG のまま）

### ⑧ 並列ビュー 同期/非同期トグル修正（2026-05-19）
- 旧: 非同期→「同期」押下で再同期ポップアップ。ポータル内ツールバーの重なり/クリップで
  表示・クリックできず「同期に戻れない」不具合 → 暫定で即・ページ揃え固定にしたが
  「ずらした現在を基準」が選べない退行
- 確定: 元の2択を **`document.body` への `createPortal`**（help パネルと同じ
  `getBoundingClientRect` 方式、`syncBtnRef`/`syncAnchor`）で確実表示に。選択肢を
  「**ページを揃える**（左右同ページ）」「**ずらした現在を基準にする**（ページ差を保持）」へ
  文言明確化。キーボードは従来どおり S=維持同期 / Shift+S=揃えて同期

### 計測・今後
`psd-speed-lab`（`KENBAN/処理速度研究/psd-speed-lab`）は PSD×PSD / PDF×PDF / PSD×PDF 対応。段階別 ms を UI と stderr `[PERF]`/`[PERF-DEC]`/`[PERF-PDF]`/`[PERF-PSDPDF]` に出す。本体へは speed lab で実測確認してから移植する運用（jpeg-encoder は当環境のネイティブビルド事情からユーザー承認で本体直接適用）。**差分↔並列 横断の高速化候補（未着手）**: A=`parse_psd` も `decode_psd_cached` 経由に統一＋容量拡大 / B=`transferDiffToParallelView` で差分側の生成済み画像を再利用 / C=(path,mtime,page,dpi) キーの PDF ページラスタ共有キャッシュ / D=共通プリフェッチワーカー。残 encode 候補は `turbojpeg`（要 cmake+nasm）。

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
