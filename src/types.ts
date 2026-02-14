// ============== 型定義 ==============

export type CompareMode = 'tiff-tiff' | 'psd-psd' | 'pdf-pdf' | 'psd-tiff' | 'text-verify';
export type AppMode = 'diff-check' | 'parallel-view';
export type ViewMode = 'A' | 'B' | 'diff' | 'A-full';

// パス情報付きFileオブジェクト
export interface FileWithPath extends File {
  filePath?: string;
}

export interface CropBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface DiffMarker {
  x: number;
  y: number;
  radius: number;
  count: number;
}

export interface FilePair {
  index: number;
  fileA: File | null;
  fileB: File | null;
  nameA: string | null;
  nameB: string | null;
  srcA: string | null;
  srcB: string | null;
  processedA: string | null;
  processedB: string | null;
  diffSrc: string | null;
  diffSrcWithMarkers?: string | null;
  hasDiff: boolean;
  diffProbability: number;
  totalPages: number;
  status: 'pending' | 'loading' | 'checked' | 'rendering' | 'done' | 'error';
  errorMessage?: string;
  markers?: DiffMarker[];
  imageWidth?: number;
  imageHeight?: number;
}

export interface PageCache {
  srcA: string;
  srcB: string;
  diffSrc: string;
  diffSrcWithMarkers?: string;
  hasDiff: boolean;
  markers?: DiffMarker[];
}

// ============== 並列ビューモード用の型定義 ==============

export interface ParallelFileEntry {
  path: string;
  name: string;
  type: 'tiff' | 'psd' | 'pdf' | 'image';
  pageCount?: number; // PDFの場合（元ファイルの総ページ数）
  pdfPage?: number; // PDFの場合、このエントリが何ページ目か（1-indexed）
  pdfFile?: File; // PDFファイル参照（ドロップされた場合）
  spreadSide?: 'left' | 'right'; // 見開き分割時の左右（右から読みなので right が先）
}

export interface ParallelImageCache {
  [key: string]: {
    dataUrl: string;
    width: number;
    height: number;
  };
}

// ============== テキスト照合モード用の型定義 ==============

export interface ExtractedTextLayer {
  text: string;
  layerName: string;
  x: number;
  y: number;
  visible: boolean;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface TextVerifyPage {
  fileIndex: number;
  fileName: string;
  filePath: string;
  imageSrc: string | null;
  extractedText: string;
  extractedLayers: ExtractedTextLayer[];
  memoText: string;
  diffResult: { psd: DiffPart[]; memo: DiffPart[] } | null;
  status: 'pending' | 'loading' | 'done' | 'error';
  errorMessage?: string;
  psdWidth: number;
  psdHeight: number;
  memoShared: boolean;
  memoSharedGroup: number[];
}

export interface DiffPart {
  value: string;
  added?: boolean;
  removed?: boolean;
}
