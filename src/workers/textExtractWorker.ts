// Web Worker: PSD テキスト抽出 + 差分計算
// メインスレッドから ArrayBuffer を Transferable で受け取り、
// ag-psd でパースしてテキストレイヤー + diff 結果を返す

import {
  extractVisibleTextLayers,
  combineTextForComparison,
  normalizeTextForComparison,
  computeLineSetDiff,
  computeSharedGroupDiff,
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

export type WorkerRequest = ExtractRequest;
export type WorkerResponse = ExtractResult | ExtractError;

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
};
