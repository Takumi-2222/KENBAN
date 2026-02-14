// PSDテキストレイヤー抽出ユーティリティ
// ag-psdを使用してPSDファイルから表示テキストレイヤーを抽出する

import { readPsd } from 'ag-psd';
import type { ExtractedTextLayer, DiffPart } from '../types';

/**
 * PSDバイナリからテキストレイヤーを抽出してマンガ読み順にソートする
 */
export function extractVisibleTextLayers(buffer: ArrayBuffer): {
  layers: ExtractedTextLayer[];
  psdWidth: number;
  psdHeight: number;
} {
  const psd = readPsd(buffer, {
    skipCompositeImageData: true,
    skipLayerImageData: true,
    skipThumbnail: true,
    useImageData: false,
  });

  const layers = collectVisibleTextLayers(psd.children || []);

  // マンガ読み順ソート: 上→下（行グループ）、右→左（同じ行内）
  const canvasHeight = psd.height || 1;
  const rowThreshold = canvasHeight * 0.08; // キャンバス高さの8%を行閾値とする

  const sorted = layers.sort((a, b) => {
    const rowA = Math.floor(a.y / rowThreshold);
    const rowB = Math.floor(b.y / rowThreshold);
    if (rowA !== rowB) return rowA - rowB; // 上から下
    return b.x - a.x; // 右から左
  });

  return {
    layers: sorted,
    psdWidth: psd.width || 0,
    psdHeight: psd.height || 0,
  };
}

/**
 * 再帰的に表示テキストレイヤーを収集する
 * ag-psdのレイヤー順序はbottom-to-topなのでreverseしてPhotoshop表示順にする
 */
function collectVisibleTextLayers(
  children: any[],
  parentVisible = true
): ExtractedTextLayer[] {
  const layers: ExtractedTextLayer[] = [];
  const reversed = [...children].reverse();

  for (const child of reversed) {
    const effectiveVisible = parentVisible && !child.hidden;

    if (child.text && effectiveVisible) {
      const text = child.text.text || '';
      if (text.trim()) {
        layers.push({
          text,
          layerName: child.name || '',
          x: ((child.left || 0) + (child.right || 0)) / 2,
          y: ((child.top || 0) + (child.bottom || 0)) / 2,
          visible: true,
          left: child.left || 0,
          top: child.top || 0,
          right: child.right || 0,
          bottom: child.bottom || 0,
        });
      }
    }

    if (child.children) {
      layers.push(...collectVisibleTextLayers(child.children, effectiveVisible));
    }
  }

  return layers;
}

/**
 * 抽出テキストレイヤーを比較用に結合する
 */
// チャンク区切りセンチネル（不可視セパレータ U+2063）
export const CHUNK_BREAK = '\u2063';

export function combineTextForComparison(layers: ExtractedTextLayer[]): string {
  return layers
    .map(l => l.text.trim())
    .filter(Boolean)
    .join('\n\n');
}

/**
 * 日本語でよく混同される Unicode 文字を統一する
 */
function normalizeConfusables(text: string): string {
  return text
    // 波ダッシュ / チルダ系 → 〜 (U+301C)
    .replace(/[\uFF5E\u223C\u223E]/g, '\u301C')
    // ダッシュ / ハイフン系 → ー (U+30FC)
    .replace(/[\u2014\u2015\u2012\u2013\uFF0D\u2500]/g, '\u30FC')
    // 中黒系 → ・ (U+30FB)
    .replace(/[\u2022\u2219\u00B7]/g, '\u30FB')
    // 三点リーダ … (U+2026) → ・・・ ではなく統一記号として保持
    // 全角スペース → 半角スペース
    .replace(/\u3000/g, ' ')
    // ゼロ幅文字・BOM・不可視文字を除去
    .replace(/[\u200B\u200C\u200D\uFEFF\u00AD\u2060]/g, '')
    // 全角英数 → 半角英数 (NFKC相当の部分適用)
    .replace(/[\uFF01-\uFF5A]/g, c =>
      String.fromCharCode(c.charCodeAt(0) - 0xFEE0)
    );
}

/**
 * テキストを比較用に正規化する
 * - 紛らわしい Unicode 文字の統一
 * - |（パイプ）を改行に変換（メモの改行マーカー）
 * - \r\n → \n 統一
 * - 各行の前後空白を除去
 * - 空行を除去（preserveChunks=true 時は空行群を CHUNK_BREAK に変換）
 */
export function normalizeTextForComparison(text: string, preserveChunks = false): string {
  const lines = normalizeConfusables(text)
    .replace(/\|/g, '\n')           // | → 改行
    .replace(/\r\n/g, '\n')         // CRLF → LF
    .replace(/\r/g, '\n')           // CR → LF
    .split('\n')
    .map(line => line.trim());       // 各行trim

  if (!preserveChunks) {
    return lines.filter(line => line.length > 0).join('\n');
  }

  // 空行群を CHUNK_BREAK に変換（チャンク区切りを保持）
  const result: string[] = [];
  let prevBlank = false;
  for (const line of lines) {
    if (line.length === 0) {
      if (!prevBlank && result.length > 0) {
        result.push(CHUNK_BREAK);
        prevBlank = true;
      }
    } else {
      result.push(line);
      prevBlank = false;
    }
  }
  // 末尾の CHUNK_BREAK を除去
  if (result.length > 0 && result[result.length - 1] === CHUNK_BREAK) {
    result.pop();
  }
  return result.join('\n');
}

/**
 * LCSベースの類似度スコア (0-1)
 */
function similarity(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0 && n === 0) return 1;
  if (m === 0 || n === 0) return 0;
  let prev = new Uint16Array(n + 1);
  let curr = new Uint16Array(n + 1);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }
  return prev[n] / Math.max(m, n);
}

/**
 * 2行間の文字レベル差分を計算する (LCSバックトラック)
 * PSD側は removed、メモ側は added でマーク
 */
function computeCharDiff(psdLine: string, memoLine: string): { psd: DiffPart[]; memo: DiffPart[] } {
  const m = psdLine.length, n = memoLine.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = psdLine[i - 1] === memoLine[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);

  // バックトラックで編集操作列を取得
  const edits: Array<'equal' | 'delete' | 'insert'> = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && psdLine[i - 1] === memoLine[j - 1]) {
      edits.push('equal'); i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      edits.push('insert'); j--;
    } else {
      edits.push('delete'); i--;
    }
  }
  edits.reverse();

  // 連続する同種操作をグループ化して DiffPart[] を構築
  const psd: DiffPart[] = [];
  const memo: DiffPart[] = [];
  let psdBuf = '', psdRem = false;
  let memoBuf = '', memoAdd = false;
  let pi = 0, mi = 0;

  const flushPsd = () => { if (psdBuf) { psd.push(psdRem ? { value: psdBuf, removed: true } : { value: psdBuf }); psdBuf = ''; } };
  const flushMemo = () => { if (memoBuf) { memo.push(memoAdd ? { value: memoBuf, added: true } : { value: memoBuf }); memoBuf = ''; } };

  for (const op of edits) {
    if (op === 'equal') {
      if (psdRem) flushPsd();
      if (memoAdd) flushMemo();
      psdRem = false; memoAdd = false;
      psdBuf += psdLine[pi]; memoBuf += memoLine[mi];
      pi++; mi++;
    } else if (op === 'delete') {
      if (!psdRem) flushPsd();
      psdRem = true;
      psdBuf += psdLine[pi]; pi++;
    } else {
      if (!memoAdd) flushMemo();
      memoAdd = true;
      memoBuf += memoLine[mi]; mi++;
    }
  }
  flushPsd(); flushMemo();
  return { psd, memo };
}

// ファジーマッチの閾値
const FUZZY_THRESHOLD_LONG = 0.4;   // 6文字以上
const FUZZY_THRESHOLD_SHORT = 0.2;  // 5文字以下

/**
 * PSD行をメモ行に貪欲マッチする共通ヘルパー
 * memoUsed: 既に消費済みのメモ行インデックス（呼び出し間で共有可能）
 */
function greedyMatch(
  psdLines: string[],
  memoLines: string[],
  memoUsed: Set<number>,
): {
  exactPsdToMemo: Map<number, number>;
  fuzzyPsdToMemo: Map<number, number>;
  charDiffs: Map<number, { psd: DiffPart[]; memo: DiffPart[] }>;
} {
  // Pass 1: 完全一致
  const exactPsdToMemo = new Map<number, number>();
  for (let i = 0; i < psdLines.length; i++) {
    for (let j = 0; j < memoLines.length; j++) {
      if (!memoUsed.has(j) && psdLines[i] === memoLines[j]) {
        exactPsdToMemo.set(i, j);
        memoUsed.add(j);
        break;
      }
    }
  }

  // Pass 2: ファジーマッチ
  const unmatchedPsd = psdLines.map((_, i) => i).filter(i => !exactPsdToMemo.has(i));
  const fuzzyPsdToMemo = new Map<number, number>();

  for (const pi of unmatchedPsd) {
    let bestMj = -1, bestScore = 0;
    for (let j = 0; j < memoLines.length; j++) {
      if (memoUsed.has(j)) continue;
      const s = similarity(psdLines[pi], memoLines[j]);
      if (s > bestScore) { bestScore = s; bestMj = j; }
    }
    if (bestMj >= 0) {
      const minLen = Math.min(psdLines[pi].length, memoLines[bestMj].length);
      const threshold = minLen <= 5 ? FUZZY_THRESHOLD_SHORT : FUZZY_THRESHOLD_LONG;
      if (bestScore >= threshold) {
        fuzzyPsdToMemo.set(pi, bestMj);
        memoUsed.add(bestMj);
      }
    }
  }

  // 文字レベル差分を事前計算
  const charDiffs = new Map<number, { psd: DiffPart[]; memo: DiffPart[] }>();
  for (const [pi, mj] of fuzzyPsdToMemo) {
    charDiffs.set(pi, computeCharDiff(psdLines[pi], memoLines[mj]));
  }

  return { exactPsdToMemo, fuzzyPsdToMemo, charDiffs };
}

/**
 * 行単位のセットマッチングで差分を計算する
 * Pass 1: 完全一致、Pass 2: ファジーマッチ（類似行の文字レベル差分）
 * PSD側とメモ側それぞれの表示用DiffPart[]を返す
 */
export function computeLineSetDiff(
  psdText: string,
  memoText: string,
): { psd: DiffPart[]; memo: DiffPart[] } {
  const psdLines = psdText.split('\n').filter(l => l.length > 0);
  const memoLines = memoText.split('\n').filter(l => l.length > 0);

  const memoUsed = new Set<number>();
  const { exactPsdToMemo, fuzzyPsdToMemo, charDiffs } = greedyMatch(psdLines, memoLines, memoUsed);

  // 逆マップ: メモindex → PSD index
  const memoToExactPsd = new Map<number, number>();
  for (const [pi, mj] of exactPsdToMemo) memoToExactPsd.set(mj, pi);
  const memoToFuzzyPsd = new Map<number, number>();
  for (const [pi, mj] of fuzzyPsdToMemo) memoToFuzzyPsd.set(mj, pi);

  // --- PSD側出力（メモ順） ---
  const psd: DiffPart[] = [];
  for (let j = 0; j < memoLines.length; j++) {
    if (memoToExactPsd.has(j)) {
      psd.push({ value: psdLines[memoToExactPsd.get(j)!] + '\n' });
    } else if (memoToFuzzyPsd.has(j)) {
      const pi = memoToFuzzyPsd.get(j)!;
      const diff = charDiffs.get(pi)!;
      const psdHasRemoved = diff.psd.some(p => p.removed);
      // PSD側にremoved部が無い場合、ゼロ幅マーカーで「変更あり」を保証
      if (!psdHasRemoved) psd.push({ value: '', removed: true });
      psd.push(...diff.psd);
      psd.push({ value: '\n' });
    }
  }
  // 完全アンマッチのPSD行を末尾に追加
  for (let i = 0; i < psdLines.length; i++) {
    if (!exactPsdToMemo.has(i) && !fuzzyPsdToMemo.has(i)) {
      psd.push({ value: psdLines[i] + '\n', removed: true });
    }
  }

  // --- メモ側出力（元の順序） ---
  const memo: DiffPart[] = [];
  for (let j = 0; j < memoLines.length; j++) {
    if (memoUsed.has(j)) {
      if (memoToExactPsd.has(j)) {
        memo.push({ value: memoLines[j] + '\n' });
      } else if (memoToFuzzyPsd.has(j)) {
        const pi = memoToFuzzyPsd.get(j)!;
        const diff = charDiffs.get(pi)!;
        const memoHasAdded = diff.memo.some(p => p.added);
        // メモ側にadded部が無い場合、ゼロ幅マーカーで「変更あり」を保証
        if (!memoHasAdded) memo.push({ value: '', added: true });
        memo.push(...diff.memo);
        memo.push({ value: '\n' });
      }
    } else {
      memo.push({ value: memoLines[j] + '\n', added: true });
    }
  }

  return { psd, memo };
}

/**
 * 2ページ共有メモ用: 複数PSDテキストとメモを2フェーズでマッチし、ページごとのdiffを返す
 *
 * Phase 1: 全ページの完全一致をページ順に実行（ファジーマッチによるメモ行横取りを防止）
 * Phase 2: 全ページのファジーマッチをページ順に実行（ページ1が先にメモを消費、残りをページ2へ）
 * - 全ページ未マッチのメモ行は最後のページに「メモのみ」として追加
 */
export function computeSharedGroupDiff(
  psdTexts: string[],
  memoText: string,
): Array<{ psd: DiffPart[]; memo: DiffPart[] }> {
  const memoLines = memoText.split('\n').filter(l => l.length > 0);
  const memoUsed = new Set<number>();

  const allPsdLines = psdTexts.map(t => t.split('\n').filter(l => l.length > 0));

  // ===== Phase 1: 全ページの完全一致をページ順に実行 =====
  // 先に全ページの完全一致を処理することで、後ページのファジーが前ページの完全一致を奪うのを防ぐ
  const pageExact: Map<number, number>[] = allPsdLines.map(() => new Map());
  for (let p = 0; p < allPsdLines.length; p++) {
    const psdLines = allPsdLines[p];
    for (let i = 0; i < psdLines.length; i++) {
      for (let j = 0; j < memoLines.length; j++) {
        if (!memoUsed.has(j) && psdLines[i] === memoLines[j]) {
          pageExact[p].set(i, j);
          memoUsed.add(j);
          break;
        }
      }
    }
  }

  // ===== Phase 2: 全ページのファジーマッチをページ順に実行 =====
  // ページ順に処理して前ページが優先的にメモ行を消費（残りが後ページへ）
  const pageFuzzy: Map<number, number>[] = allPsdLines.map(() => new Map());
  const pageCharDiffs: Map<number, { psd: DiffPart[]; memo: DiffPart[] }>[] =
    allPsdLines.map(() => new Map());

  for (let p = 0; p < allPsdLines.length; p++) {
    const psdLines = allPsdLines[p];
    const unmatchedPsd = psdLines.map((_, i) => i).filter(i => !pageExact[p].has(i));

    for (const pi of unmatchedPsd) {
      let bestMj = -1, bestScore = 0;
      for (let j = 0; j < memoLines.length; j++) {
        if (memoUsed.has(j)) continue;
        const s = similarity(psdLines[pi], memoLines[j]);
        if (s > bestScore) { bestScore = s; bestMj = j; }
      }
      if (bestMj >= 0) {
        const minLen = Math.min(psdLines[pi].length, memoLines[bestMj].length);
        const threshold = minLen <= 5 ? FUZZY_THRESHOLD_SHORT : FUZZY_THRESHOLD_LONG;
        if (bestScore >= threshold) {
          pageFuzzy[p].set(pi, bestMj);
          memoUsed.add(bestMj);
        }
      }
    }

    // 文字レベル差分を事前計算
    for (const [pi, mj] of pageFuzzy[p]) {
      pageCharDiffs[p].set(pi, computeCharDiff(psdLines[pi], memoLines[mj]));
    }
  }

  // ===== 各ページのdiff出力を生成 =====
  const results: Array<{ psd: DiffPart[]; memo: DiffPart[] }> = [];

  for (let p = 0; p < allPsdLines.length; p++) {
    const psdLines = allPsdLines[p];
    const exactPsdToMemo = pageExact[p];
    const fuzzyPsdToMemo = pageFuzzy[p];
    const charDiffs = pageCharDiffs[p];
    const isLastPage = p === allPsdLines.length - 1;

    // PSD側出力（PSD順）
    const psd: DiffPart[] = [];
    for (let i = 0; i < psdLines.length; i++) {
      if (exactPsdToMemo.has(i)) {
        psd.push({ value: psdLines[i] + '\n' });
      } else if (fuzzyPsdToMemo.has(i)) {
        const cd = charDiffs.get(i)!;
        const psdHasRemoved = cd.psd.some(p => p.removed);
        if (!psdHasRemoved) psd.push({ value: '', removed: true });
        psd.push(...cd.psd);
        psd.push({ value: '\n' });
      } else {
        psd.push({ value: psdLines[i] + '\n', removed: true });
      }
    }

    // メモ側出力（PSD順で対応するメモ行）
    const memo: DiffPart[] = [];
    for (let i = 0; i < psdLines.length; i++) {
      if (exactPsdToMemo.has(i)) {
        const mj = exactPsdToMemo.get(i)!;
        memo.push({ value: memoLines[mj] + '\n' });
      } else if (fuzzyPsdToMemo.has(i)) {
        const cd = charDiffs.get(i)!;
        const memoHasAdded = cd.memo.some(p => p.added);
        if (!memoHasAdded) memo.push({ value: '', added: true });
        memo.push(...cd.memo);
        memo.push({ value: '\n' });
      }
      // PSDのみの行 → メモ側には出力しない
    }

    // 最後のページのみ: 全ページ未マッチのメモ行を「メモのみ」として追加
    if (isLastPage) {
      for (let j = 0; j < memoLines.length; j++) {
        if (!memoUsed.has(j)) {
          memo.push({ value: memoLines[j] + '\n', added: true });
        }
      }
    }

    results.push({ psd, memo });
  }

  return results;
}

/**
 * PSD抽出テキストに最もマッチするメモセクションを返す
 * ファイル名ベースの割り当てが間違っている場合にコンテンツベースで修正する
 */
export function findBestMemoSection(
  normalizedPsdText: string,
  sections: Array<{ pageNums: number[]; text: string }>,
): { pageNums: number[]; text: string; matchRatio: number } | null {
  if (sections.length === 0) return null;

  const psdLines = normalizedPsdText.split('\n').filter(l => l.length > 0 && l !== CHUNK_BREAK);
  if (psdLines.length === 0) return null;

  let bestSection: (typeof sections)[0] | null = null;
  let bestCount = 0;

  const scores: { pageNums: number[]; exactCount: number; psdLineCount: number }[] = [];

  for (const section of sections) {
    const normMemo = normalizeTextForComparison(section.text);
    const memoLines = normMemo.split('\n').filter(l => l.length > 0 && l !== CHUNK_BREAK);
    if (memoLines.length === 0) continue;

    const memoUsed = new Set<number>();
    let exactCount = 0;

    for (const psdLine of psdLines) {
      for (let j = 0; j < memoLines.length; j++) {
        if (!memoUsed.has(j) && psdLine === memoLines[j]) {
          exactCount++;
          memoUsed.add(j);
          break;
        }
      }
    }

    scores.push({ pageNums: section.pageNums, exactCount, psdLineCount: psdLines.length });

    if (exactCount > bestCount) {
      bestCount = exactCount;
      bestSection = section;
    }
  }

  return bestSection && bestCount > 0
    ? { ...bestSection, matchRatio: bestCount / psdLines.length }
    : null;
}

/**
 * 統合ビュー用: PSD/Memo の DiffPart[] を行単位でインターリーブする
 */
export interface UnifiedDiffEntry {
  type: 'match' | 'diff' | 'linebreak' | 'separator';
  text?: string;                // match 時のテキスト
  psdParts?: DiffPart[];        // diff 時の PSD 行パーツ
  memoParts?: DiffPart[];       // diff 時の Memo 行パーツ
  psdText?: string;             // linebreak 時の PSD テキスト（改行付き）
  memoText?: string;            // linebreak 時の Memo テキスト（改行付き）
}

function splitPartsIntoLines(parts: DiffPart[]): { parts: DiffPart[]; changed: boolean }[] {
  const lines: { parts: DiffPart[]; changed: boolean }[] = [];
  let cur: DiffPart[] = [];
  let hasChange = false;
  for (const p of parts) {
    if (p.value.endsWith('\n')) {
      cur.push({ ...p, value: p.value.replace(/\n$/, '') });
      if (p.added || p.removed) hasChange = true;
      lines.push({ parts: cur, changed: hasChange });
      cur = [];
      hasChange = false;
    } else {
      cur.push(p);
      if (p.added || p.removed) hasChange = true;
    }
  }
  if (cur.length > 0) lines.push({ parts: cur, changed: hasChange });
  return lines;
}

export function buildUnifiedDiff(
  psdParts: DiffPart[],
  memoParts: DiffPart[],
): UnifiedDiffEntry[] {
  const pLines = splitPartsIntoLines(psdParts);
  const mLines = splitPartsIntoLines(memoParts);

  const result: UnifiedDiffEntry[] = [];
  let pi = 0, mi = 0;

  while (pi < pLines.length || mi < mLines.length) {
    // 一致行を収集
    const matchBuf: string[] = [];
    while (
      pi < pLines.length && !pLines[pi].changed &&
      mi < mLines.length && !mLines[mi].changed
    ) {
      matchBuf.push(pLines[pi].parts.map(p => p.value).join(''));
      pi++; mi++;
    }
    if (matchBuf.length > 0) {
      result.push({ type: 'match', text: matchBuf.join('\n') });
    }

    // PSD 側の差分行を収集
    const pDiff: DiffPart[][] = [];
    while (pi < pLines.length && pLines[pi].changed) {
      pDiff.push(pLines[pi].parts);
      pi++;
    }
    // Memo 側の差分行を収集
    const mDiff: DiffPart[][] = [];
    while (mi < mLines.length && mLines[mi].changed) {
      mDiff.push(mLines[mi].parts);
      mi++;
    }

    // 片方の非changed行が残っている場合（行数不一致の安全弁）
    // → match として出力して進める
    if (pDiff.length === 0 && mDiff.length === 0) {
      if (pi < pLines.length && !pLines[pi].changed) {
        result.push({ type: 'match', text: pLines[pi].parts.map(p => p.value).join('') });
        pi++;
        continue;
      }
      if (mi < mLines.length && !mLines[mi].changed) {
        result.push({ type: 'match', text: mLines[mi].parts.map(p => p.value).join('') });
        mi++;
        continue;
      }
    }

    // 改行のみの差分を検出: PSD行とメモ行の結合テキストが一致するかチェック
    if (pDiff.length > 0 && mDiff.length > 0) {
      const pJoined = pDiff.map(parts => parts.map(p => p.value).join('')).join('');
      const mJoined = mDiff.map(parts => parts.map(p => p.value).join('')).join('');
      if (pJoined === mJoined && pJoined.length > 0) {
        result.push({
          type: 'linebreak',
          psdText: pDiff.map(parts => parts.map(p => p.value).join('')).join('\n'),
          memoText: mDiff.map(parts => parts.map(p => p.value).join('')).join('\n'),
        });
        continue;
      }
    }

    // ペアごとに diff エントリを生成（fuzzy match は 1:1 ペア）
    const maxLen = Math.max(pDiff.length, mDiff.length);
    for (let i = 0; i < maxLen; i++) {
      result.push({
        type: 'diff',
        psdParts: i < pDiff.length ? pDiff[i] : undefined,
        memoParts: i < mDiff.length ? mDiff[i] : undefined,
      });
    }
  }

  return postProcessChunkBreaks(result);
}

/**
 * CHUNK_BREAK センチネルを separator エントリに変換し、連続する separator を1つにまとめる
 */
function postProcessChunkBreaks(entries: UnifiedDiffEntry[]): UnifiedDiffEntry[] {
  const result: UnifiedDiffEntry[] = [];

  for (const entry of entries) {
    if (entry.type === 'match' && entry.text != null) {
      // match テキスト内の CHUNK_BREAK を分割して separator を挿入
      const lines = entry.text.split('\n');
      const buf: string[] = [];
      for (const line of lines) {
        if (line === CHUNK_BREAK) {
          if (buf.length > 0) {
            result.push({ type: 'match', text: buf.join('\n') });
            buf.length = 0;
          }
          result.push({ type: 'separator' });
        } else {
          buf.push(line);
        }
      }
      if (buf.length > 0) {
        result.push({ type: 'match', text: buf.join('\n') });
      }
      continue;
    }

    if (entry.type === 'diff') {
      const psdIsChunk = entry.psdParts && entry.psdParts.every(p => p.value === CHUNK_BREAK || p.value === '');
      const memoIsChunk = entry.memoParts && entry.memoParts.every(p => p.value === CHUNK_BREAK || p.value === '');
      if (psdIsChunk && memoIsChunk) {
        result.push({ type: 'separator' });
        continue;
      }
      if (psdIsChunk && !entry.memoParts) {
        result.push({ type: 'separator' });
        continue;
      }
      if (memoIsChunk && !entry.psdParts) {
        result.push({ type: 'separator' });
        continue;
      }
      // 片方がチャンク区切りで他方がコンテンツの場合: コンテンツのdiffのみ残す
      if (psdIsChunk && entry.memoParts) {
        result.push({ type: 'diff', memoParts: entry.memoParts });
        continue;
      }
      if (memoIsChunk && entry.psdParts) {
        result.push({ type: 'diff', psdParts: entry.psdParts });
        continue;
      }
    }

    result.push(entry);
  }

  // 連続 separator を1つにまとめ、先頭・末尾の separator を除去
  const collapsed: UnifiedDiffEntry[] = [];
  for (const entry of result) {
    if (entry.type === 'separator' && collapsed.length > 0 && collapsed[collapsed.length - 1].type === 'separator') {
      continue;
    }
    collapsed.push(entry);
  }
  if (collapsed.length > 0 && collapsed[0].type === 'separator') collapsed.shift();
  if (collapsed.length > 0 && collapsed[collapsed.length - 1].type === 'separator') collapsed.pop();
  return collapsed;
}
