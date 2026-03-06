// Web Worker ラッパーフック
// PSD テキスト抽出 + diff 計算を Worker スレッドで実行する

import { useRef, useCallback, useEffect } from 'react';
import type { ExtractRequest, ReassignRequest, WorkerResponse } from '../workers/textExtractWorker';
import type { ExtractedTextLayer, DiffPart } from '../types';

export interface WorkerExtractResult {
  extractedText: string;
  extractedLayers: ExtractedTextLayer[];
  psdWidth: number;
  psdHeight: number;
  diffResult: { psd: DiffPart[]; memo: DiffPart[] } | null;
  sharedGroupDiffs?: { pageIdx: number; diff: { psd: DiffPart[]; memo: DiffPart[] } }[];
}

export interface WorkerReassignResult {
  updates: Array<{
    idx: number;
    memoText: string;
    memoShared: boolean;
    memoSharedGroup: number[];
    diffResult: { psd: DiffPart[]; memo: DiffPart[] } | null;
  }>;
}

// Worker1リクエストあたりのタイムアウト（ms）
const WORKER_TIMEOUT_MS = 120_000; // 2分

function createWorker(): Worker {
  return new Worker(
    new URL('../workers/textExtractWorker.ts', import.meta.url),
    { type: 'module' },
  );
}

export function useTextExtractWorker() {
  const workerRef = useRef<Worker | null>(null);
  const nextIdRef = useRef(0);
  const pendingRef = useRef<Map<number, {
    resolve: (result: WorkerExtractResult) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>>(new Map());
  const disposedRef = useRef(false);

  // Worker 初期化 / 再生成
  const initWorker = useCallback(() => {
    // 既存Workerがあれば破棄
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }

    const worker = createWorker();

    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      const pending = pendingRef.current.get(msg.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      pendingRef.current.delete(msg.id);

      if (msg.type === 'result') {
        pending.resolve({
          extractedText: msg.extractedText,
          extractedLayers: msg.extractedLayers,
          psdWidth: msg.psdWidth,
          psdHeight: msg.psdHeight,
          diffResult: msg.diffResult,
          sharedGroupDiffs: msg.sharedGroupDiffs,
        });
      } else if (msg.type === 'reassign_result') {
        pending.resolve(msg as any);
      } else {
        pending.reject(new Error(msg.message));
      }
    };

    worker.onerror = (err) => {
      console.error('[TextExtractWorker] Worker error:', err.message);
      // 全pending requestを reject
      for (const [, pending] of pendingRef.current) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`Worker error: ${err.message}`));
      }
      pendingRef.current.clear();

      // Worker再生成（disposed でなければ）
      if (!disposedRef.current) {
        console.warn('[TextExtractWorker] Recreating worker after error');
        workerRef.current = null;
        // 次のリクエストで遅延初期化
      }
    };

    workerRef.current = worker;
    return worker;
  }, []);

  useEffect(() => {
    disposedRef.current = false;
    initWorker();

    return () => {
      disposedRef.current = true;
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
      // 残りのpendingを全reject
      for (const [, pending] of pendingRef.current) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Worker terminated'));
      }
      pendingRef.current.clear();
    };
  }, [initWorker]);

  // PSD テキスト抽出リクエスト
  // buffer は Transferable として転送される（メインスレッドからは即解放）
  const extractText = useCallback(async (
    buffer: ArrayBuffer,
    memoText: string,
    memoShared: boolean,
    memoSharedGroup: number[],
    pageIdx: number,
    sharedGroupTexts?: { pageNum: number; normPsd: string; pageIdx: number }[],
  ): Promise<WorkerExtractResult> => {
    // Workerが死んでいたら再生成
    let worker = workerRef.current;
    if (!worker) {
      if (disposedRef.current) {
        throw new Error('Worker disposed');
      }
      console.warn('[TextExtractWorker] Worker was dead, recreating...');
      worker = initWorker();
    }

    const id = nextIdRef.current++;

    return new Promise<WorkerExtractResult>((resolve, reject) => {
      // タイムアウト設定
      const timer = setTimeout(() => {
        const pending = pendingRef.current.get(id);
        if (pending) {
          pendingRef.current.delete(id);
          console.error(`[TextExtractWorker] Request ${id} (pageIdx=${pageIdx}) timed out after ${WORKER_TIMEOUT_MS}ms`);
          pending.reject(new Error(`Worker request timed out (pageIdx=${pageIdx})`));

          // タイムアウトしたWorkerは死んでいる可能性が高いので再生成
          if (!disposedRef.current) {
            console.warn('[TextExtractWorker] Terminating timed-out worker and recreating');
            if (workerRef.current) {
              workerRef.current.terminate();
              workerRef.current = null;
            }
          }
        }
      }, WORKER_TIMEOUT_MS);

      pendingRef.current.set(id, { resolve, reject, timer });

      const request: ExtractRequest = {
        type: 'extract',
        id,
        buffer,
        memoText,
        memoShared,
        memoSharedGroup,
        sharedGroupTexts,
        pageIdx,
      };

      // ArrayBuffer を Transferable で転送（ゼロコピー）
      try {
        worker.postMessage(request, [buffer]);
      } catch (err) {
        clearTimeout(timer);
        pendingRef.current.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }, [initWorker]);

  // メモ再割り当て + diff再計算をWorkerにオフロード
  const reassignDiffs = useCallback(async (
    pages: ReassignRequest['pages'],
    sections: ReassignRequest['sections'],
  ): Promise<WorkerReassignResult> => {
    let worker = workerRef.current;
    if (!worker) {
      if (disposedRef.current) throw new Error('Worker disposed');
      worker = initWorker();
    }

    const id = nextIdRef.current++;

    return new Promise<WorkerReassignResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = pendingRef.current.get(id);
        if (pending) {
          pendingRef.current.delete(id);
          pending.reject(new Error('Worker reassign request timed out'));
          if (!disposedRef.current) {
            if (workerRef.current) {
              workerRef.current.terminate();
              workerRef.current = null;
            }
          }
        }
      }, WORKER_TIMEOUT_MS);

      pendingRef.current.set(id, { resolve: resolve as any, reject, timer });

      const request: ReassignRequest = { type: 'reassign', id, pages, sections };
      try {
        worker.postMessage(request);
      } catch (err) {
        clearTimeout(timer);
        pendingRef.current.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }, [initWorker]);

  // 全pending requestをキャンセル
  const cancelAll = useCallback(() => {
    for (const [, pending] of pendingRef.current) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Cancelled'));
    }
    pendingRef.current.clear();
  }, []);

  return { extractText, reassignDiffs, cancelAll };
}
