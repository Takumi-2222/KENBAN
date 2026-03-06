// Web Worker: PSD テキスト抽出 + 差分計算
// メインスレッドから ArrayBuffer を Transferable で受け取り、
// ag-psd でパースしてテキストレイヤー + diff 結果を返す

import {
  extractVisibleTextLayers,
  combineTextForComparison,
  normalizeTextForComparison,
  computeLineSetDiff,
  computeSharedGroupDiff,
  findBestMemoSection,
  preNormalizeSections,
} from '../utils/textExtract';
import type { ExtractedTextLayer, DiffPart } from '../types';

// === メッセージ型定義 ===

export interface ExtractRequest {
  type: 'extract';
  id: number;
  buffer: ArrayBuffer;
  memoText: string;
  memoShared: boolean;
  memoSharedGroup: number[];
  // 共有ページ用: グループ内の他ページの抽出済みテキスト
  sharedGroupTexts?: { pageNum: number; normPsd: string; pageIdx: number }[];
  pageIdx: number;
}

export interface ExtractResult {
  type: 'result';
  id: number;
  extractedText: string;
  extractedLayers: ExtractedTextLayer[];
  psdWidth: number;
  psdHeight: number;
  diffResult: { psd: DiffPart[]; memo: DiffPart[] } | null;
  // 共有ページ用: 他ページの再計算されたdiff
  sharedGroupDiffs?: { pageIdx: number; diff: { psd: DiffPart[]; memo: DiffPart[] } }[];
}

export interface ExtractError {
  type: 'error';
  id: number;
  message: string;
}

// diff再計算リクエスト（reassignMemoSections用）
export interface ReassignRequest {
  type: 'reassign';
  id: number;
  pages: Array<{
    idx: number;
    extractedText: string;
    memoText: string;
    memoShared: boolean;
    memoSharedGroup: number[];
    fileName: string;
  }>;
  sections: Array<{ pageNums: number[]; text: string }>;
}

export interface ReassignResult {
  type: 'reassign_result';
  id: number;
  updates: Array<{
    idx: number;
    memoText: string;
    memoShared: boolean;
    memoSharedGroup: number[];
    diffResult: { psd: DiffPart[]; memo: DiffPart[] } | null;
  }>;
}

export type WorkerRequest = ExtractRequest | ReassignRequest;
export type WorkerResponse = ExtractResult | ReassignResult | ExtractError;

// === Worker メッセージハンドラ ===

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;

  if (msg.type === 'extract') {
    try {
      // 1. ag-psd でテキストレイヤー抽出
      const { layers, psdWidth, psdHeight } = extractVisibleTextLayers(msg.buffer);
      const extractedText = combineTextForComparison(layers);

      // 2. diff 計算
      let diffResult: { psd: DiffPart[]; memo: DiffPart[] } | null = null;
      let sharedGroupDiffs: ExtractResult['sharedGroupDiffs'] = undefined;

      if (msg.memoText) {
        const normPsd = normalizeTextForComparison(extractedText, true);
        const normMemo = normalizeTextForComparison(msg.memoText, true);

        if (msg.memoShared && msg.sharedGroupTexts && msg.sharedGroupTexts.length > 0) {
          // 共有メモ: グループ全体で計算
          const groupEntries = [...msg.sharedGroupTexts];
          // 自分を追加（ソートはメインスレッドで行うのでここではpageNum順に挿入）
          const myEntry = { pageNum: -1, normPsd, pageIdx: msg.pageIdx };
          // 挿入位置を探す（sharedGroupTextsはpageNum順にソート済み）
          let inserted = false;
          for (let i = 0; i < groupEntries.length; i++) {
            if (msg.pageIdx < groupEntries[i].pageIdx) {
              groupEntries.splice(i, 0, myEntry);
              inserted = true;
              break;
            }
          }
          if (!inserted) groupEntries.push(myEntry);

          const diffs = computeSharedGroupDiff(groupEntries.map(e => e.normPsd), normMemo);

          // 自分のdiffを取得
          const myGroupIdx = groupEntries.findIndex(e => e.pageIdx === msg.pageIdx);
          diffResult = myGroupIdx >= 0 ? diffs[myGroupIdx] : computeLineSetDiff(normPsd, normMemo);

          // 他ページのdiffも返す
          sharedGroupDiffs = groupEntries
            .filter(e => e.pageIdx !== msg.pageIdx)
            .map((e, _) => {
              const idx = groupEntries.indexOf(e);
              return { pageIdx: e.pageIdx, diff: diffs[idx] };
            });
        } else if (msg.memoShared) {
          // 共有メモだがグループメンバーがまだ未完了 → 単体版
          const singleDiffs = computeSharedGroupDiff([normPsd], normMemo);
          diffResult = singleDiffs[0];
        } else {
          // 通常ページ
          diffResult = computeLineSetDiff(normPsd, normMemo);
        }
      }

      const result: ExtractResult = {
        type: 'result',
        id: msg.id,
        extractedText,
        extractedLayers: layers,
        psdWidth,
        psdHeight,
        diffResult,
        sharedGroupDiffs,
      };

      self.postMessage(result);
    } catch (err) {
      const error: ExtractError = {
        type: 'error',
        id: msg.id,
        message: err instanceof Error ? err.message : String(err),
      };
      self.postMessage(error);
    }
  }

  if (msg.type === 'reassign') {
    try {
      const { pages, sections } = msg;
      const preNormalized = preNormalizeSections(sections);

      // Phase 1: コンテンツベースでメモセクション再割り当て
      const updates: ReassignResult['updates'] = [];
      const changedIndices = new Set<number>();

      // 各ページに最適なメモセクションを見つける
      const pageAssignments = pages.map(page => {
        const normPsd = normalizeTextForComparison(page.extractedText);
        const best = findBestMemoSection(normPsd, sections, preNormalized);
        const changed = best && best.matchRatio > 0 && best.text !== page.memoText;
        return {
          ...page,
          newMemoText: changed ? best!.text : page.memoText,
          newMemoShared: changed ? best!.pageNums.length > 1 : page.memoShared,
          newMemoSharedGroup: changed ? best!.pageNums : page.memoSharedGroup,
          changed: !!changed,
        };
      });

      const anyChange = pageAssignments.some(p => p.changed);
      if (!anyChange) {
        self.postMessage({ type: 'reassign_result', id: msg.id, updates: [] } as ReassignResult);
        return;
      }

      for (const pa of pageAssignments) {
        if (pa.changed) changedIndices.add(pa.idx);
      }

      // Phase 2: diff再計算
      // 共有グループのdiffをまとめて計算
      const groupDiffCache = new Map<string, Map<number, { psd: DiffPart[]; memo: DiffPart[] }>>();
      const groupPageIndices = new Map<string, number[]>();

      for (const pa of pageAssignments) {
        if (pa.newMemoShared && pa.extractedText && pa.newMemoText) {
          const key = pa.newMemoSharedGroup.join(',');
          if (!groupPageIndices.has(key)) groupPageIndices.set(key, []);
          groupPageIndices.get(key)!.push(pa.idx);
        }
      }

      const paByIdx = new Map(pageAssignments.map(pa => [pa.idx, pa]));

      for (const [key, indices] of groupPageIndices) {
        if (!indices.some(i => changedIndices.has(i))) continue;
        const sorted = indices
          .map(i => ({ idx: i, pa: paByIdx.get(i)! }))
          .sort((a, b) => {
            const numA = parseInt(a.pa.fileName.match(/(\d+)/)?.[1] || '0');
            const numB = parseInt(b.pa.fileName.match(/(\d+)/)?.[1] || '0');
            return numA - numB;
          });
        const psdTexts = sorted.map(e => normalizeTextForComparison(e.pa.extractedText, true));
        const normMemo = normalizeTextForComparison(sorted[0].pa.newMemoText, true);
        const diffs = computeSharedGroupDiff(psdTexts, normMemo);
        const diffMap = new Map<number, { psd: DiffPart[]; memo: DiffPart[] }>();
        sorted.forEach((e, i) => diffMap.set(e.idx, diffs[i]));
        groupDiffCache.set(key, diffMap);
      }

      for (const pa of pageAssignments) {
        if (!pa.changed && !changedIndices.has(pa.idx)) continue;

        let diffResult: { psd: DiffPart[]; memo: DiffPart[] } | null = null;
        if (pa.extractedText && pa.newMemoText) {
          if (pa.newMemoShared) {
            const key = pa.newMemoSharedGroup.join(',');
            const diffMap = groupDiffCache.get(key);
            if (diffMap?.has(pa.idx)) {
              diffResult = diffMap.get(pa.idx)!;
            } else {
              const normPsd = normalizeTextForComparison(pa.extractedText, true);
              const normMemo = normalizeTextForComparison(pa.newMemoText, true);
              const singleDiffs = computeSharedGroupDiff([normPsd], normMemo);
              diffResult = singleDiffs[0];
            }
          } else {
            const normPsd = normalizeTextForComparison(pa.extractedText, true);
            const normMemo = normalizeTextForComparison(pa.newMemoText, true);
            diffResult = computeLineSetDiff(normPsd, normMemo);
          }
        }

        updates.push({
          idx: pa.idx,
          memoText: pa.newMemoText,
          memoShared: pa.newMemoShared,
          memoSharedGroup: pa.newMemoSharedGroup,
          diffResult,
        });
      }

      self.postMessage({ type: 'reassign_result', id: msg.id, updates } as ReassignResult);
    } catch (err) {
      self.postMessage({
        type: 'error',
        id: msg.id,
        message: err instanceof Error ? err.message : String(err),
      } as ExtractError);
    }
  }
};
