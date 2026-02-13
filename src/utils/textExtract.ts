// PSDテキストレイヤー抽出ユーティリティ
// ag-psdを使用してPSDファイルから表示テキストレイヤーを抽出する

import { readPsd } from 'ag-psd';
import type { ExtractedTextLayer, DiffPart } from '../types';

/**
 * PSDバイナリからテキストレイヤーを抽出してマンガ読み順にソートする
 */
export function extractVisibleTextLayers(buffer: ArrayBuffer): ExtractedTextLayer[] {
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

  return layers.sort((a, b) => {
    const rowA = Math.floor(a.y / rowThreshold);
    const rowB = Math.floor(b.y / rowThreshold);
    if (rowA !== rowB) return rowA - rowB; // 上から下
    return b.x - a.x; // 右から左
  });
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
export function combineTextForComparison(layers: ExtractedTextLayer[]): string {
  return layers
    .map(l => l.text.trim())
    .filter(Boolean)
    .join('\n');
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
 * - 空行を除去
 */
export function normalizeTextForComparison(text: string): string {
  return normalizeConfusables(text)
    .replace(/\|/g, '\n')           // | → 改行
    .replace(/\r\n/g, '\n')         // CRLF → LF
    .replace(/\r/g, '\n')           // CR → LF
    .split('\n')
    .map(line => line.trim())        // 各行trim
    .filter(line => line.length > 0) // 空行除去
    .join('\n');
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

  // --- Pass 1: 完全一致 ---
  const exactMemoUsed = new Set<number>();
  const exactPsdToMemo = new Map<number, number>();

  for (let i = 0; i < psdLines.length; i++) {
    for (let j = 0; j < memoLines.length; j++) {
      if (!exactMemoUsed.has(j) && psdLines[i] === memoLines[j]) {
        exactPsdToMemo.set(i, j);
        exactMemoUsed.add(j);
        break;
      }
    }
  }

  // --- Pass 2: ファジーマッチ（類似行の文字レベル差分） ---
  // 短い行（…っ vs ・・・っ 等）にも対応するため、短い行は閾値を下げる
  const FUZZY_THRESHOLD_LONG = 0.4;   // 6文字以上
  const FUZZY_THRESHOLD_SHORT = 0.2;  // 5文字以下

  const unmatchedPsd = psdLines.map((_, i) => i).filter(i => !exactPsdToMemo.has(i));
  const unmatchedMemo = memoLines.map((_, j) => j).filter(j => !exactMemoUsed.has(j));

  const fuzzyPsdToMemo = new Map<number, number>();
  const fuzzyMemoUsed = new Set<number>();

  for (const pi of unmatchedPsd) {
    let bestMj = -1, bestScore = 0;
    for (const mj of unmatchedMemo) {
      if (fuzzyMemoUsed.has(mj)) continue;
      const s = similarity(psdLines[pi], memoLines[mj]);
      if (s > bestScore) { bestScore = s; bestMj = mj; }
    }
    if (bestMj >= 0) {
      const minLen = Math.min(psdLines[pi].length, memoLines[bestMj].length);
      const threshold = minLen <= 5 ? FUZZY_THRESHOLD_SHORT : FUZZY_THRESHOLD_LONG;
      if (bestScore >= threshold) {
        fuzzyPsdToMemo.set(pi, bestMj);
        fuzzyMemoUsed.add(bestMj);
      }
    }
  }

  // ファジーマッチペアの文字レベル差分を事前計算
  const charDiffs = new Map<number, { psd: DiffPart[]; memo: DiffPart[] }>();
  for (const [pi, mj] of fuzzyPsdToMemo) {
    charDiffs.set(pi, computeCharDiff(psdLines[pi], memoLines[mj]));
  }

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
    if (exactMemoUsed.has(j)) {
      memo.push({ value: memoLines[j] + '\n' });
    } else if (fuzzyMemoUsed.has(j)) {
      const pi = memoToFuzzyPsd.get(j)!;
      const diff = charDiffs.get(pi)!;
      memo.push(...diff.memo);
      memo.push({ value: '\n' });
    } else {
      memo.push({ value: memoLines[j] + '\n', added: true });
    }
  }

  return { psd, memo };
}

/**
 * 統合ビュー用: PSD/Memo の DiffPart[] を行単位でインターリーブする
 */
export interface UnifiedDiffEntry {
  type: 'match' | 'diff';
  text?: string;                // match 時のテキスト
  psdParts?: DiffPart[];        // diff 時の PSD 行パーツ
  memoParts?: DiffPart[];       // diff 時の Memo 行パーツ
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

  return result;
}
