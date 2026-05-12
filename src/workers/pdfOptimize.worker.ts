// Web Worker: PDF 軽量最適化 (pdf-lib によるリソース除去)
// メインスレッドから ArrayBuffer を Transferable で受け取り、
// 最適化済み ArrayBuffer を Transferable で返す。
// pdf-lib は WASM 不要のため Worker でそのまま動く。

import { PDFDocument } from 'pdf-lib';

export interface OptimizeRequest {
  type: 'optimize';
  id: number;
  buffer: ArrayBuffer;
}

export interface ProgressMessage {
  type: 'progress';
  id: number;
  message: string;
  current?: number;
  total?: number;
}

export interface OptimizeResultMessage {
  type: 'result';
  id: number;
  buffer: ArrayBuffer;
}

export interface ErrorMessage {
  type: 'error';
  id: number;
  error: string;
}

export type WorkerMessage = ProgressMessage | OptimizeResultMessage | ErrorMessage;

self.onmessage = async (e: MessageEvent<OptimizeRequest>) => {
  const { type, id, buffer } = e.data;
  if (type !== 'optimize') return;

  const post = (msg: WorkerMessage, transfer?: Transferable[]) => {
    if (transfer && transfer.length > 0) {
      (self as unknown as Worker).postMessage(msg, transfer);
    } else {
      (self as unknown as Worker).postMessage(msg);
    }
  };

  try {
    post({ type: 'progress', id, message: 'PDFを解析しています...' });

    const srcPdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const pageCount = srcPdf.getPageCount();
    post({ type: 'progress', id, message: 'PDFを最適化しています...', current: 0, total: pageCount });

    const pdfDoc = await PDFDocument.create();
    const pageIndices = Array.from({ length: pageCount }, (_, i) => i);
    const copiedPages = await pdfDoc.copyPages(srcPdf, pageIndices);

    for (let i = 0; i < copiedPages.length; i++) {
      pdfDoc.addPage(copiedPages[i]);
      // 10ページごとに進捗報告（毎回 postMessage するとオーバーヘッド大）
      if (i % 10 === 0 || i === copiedPages.length - 1) {
        post({ type: 'progress', id, message: 'PDFを最適化しています...', current: i + 1, total: pageCount });
      }
    }

    post({ type: 'progress', id, message: '最適化されたPDFを生成しています...', current: pageCount, total: pageCount });

    const optimizedBytes = await pdfDoc.save({ useObjectStreams: false });
    const out = optimizedBytes.buffer as ArrayBuffer;

    post({ type: 'progress', id, message: '最適化完了', current: pageCount, total: pageCount });
    post({ type: 'result', id, buffer: out }, [out]);
  } catch (err) {
    post({ type: 'error', id, error: err instanceof Error ? err.message : String(err) });
  }
};
