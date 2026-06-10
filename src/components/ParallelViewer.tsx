import React, { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import {
  Layers,
  FileText,
  FolderOpen,
  Link2,
  Unlink2,
  RefreshCw,
  Maximize2,
  HelpCircle,
  Loader2,
  Edit3,
  Eye,
  EyeOff,
  Menu,
  Download,
  ChevronDown,
  Check,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { ParallelFileEntry } from '../types';

interface ParallelViewerProps {
  isFullscreen: boolean;
  fullscreenTransitioning: boolean;
  parallelFilesA: ParallelFileEntry[];
  parallelFilesB: ParallelFileEntry[];
  parallelFolderA: string | null;
  parallelFolderB: string | null;
  parallelSyncMode: boolean;
  parallelActivePanel: 'A' | 'B';
  parallelCurrentIndex: number;
  parallelIndexA: number;
  parallelIndexB: number;
  setParallelCurrentIndex: (v: number | ((prev: number) => number)) => void;
  setParallelIndexA: (v: number | ((prev: number) => number)) => void;
  setParallelIndexB: (v: number | ((prev: number) => number)) => void;
  setParallelSyncMode: (v: boolean) => void;
  setParallelActivePanel: (v: 'A' | 'B') => void;
  parallelImageA: string | null;
  parallelImageB: string | null;
  parallelLoading: boolean;
  parallelZoomA: number;
  parallelZoomB: number;
  parallelPanA: { x: number; y: number };
  parallelPanB: { x: number; y: number };
  setParallelZoomA: (v: number | ((prev: number) => number)) => void;
  setParallelZoomB: (v: number | ((prev: number) => number)) => void;
  setParallelPanA: (v: { x: number; y: number } | ((prev: { x: number; y: number }) => { x: number; y: number })) => void;
  setParallelPanB: (v: { x: number; y: number } | ((prev: { x: number; y: number }) => { x: number; y: number })) => void;
  handleParallelMouseDownA: (e: React.MouseEvent) => void;
  handleParallelMouseDownB: (e: React.MouseEvent) => void;
  handleParallelMouseMoveA: (e: React.MouseEvent) => void;
  handleParallelMouseMoveB: (e: React.MouseEvent) => void;
  handleParallelMouseUpA: () => void;
  handleParallelMouseUpB: () => void;
  isDraggingParallelA: boolean;
  isDraggingParallelB: boolean;
  spreadSplitModeA: boolean;
  spreadSplitModeB: boolean;
  firstPageSingleA: boolean;
  firstPageSingleB: boolean;
  setSpreadSplitModeA: (v: boolean) => void;
  setSpreadSplitModeB: (v: boolean) => void;
  setFirstPageSingleA: (v: boolean) => void;
  setFirstPageSingleB: (v: boolean) => void;
  showSyncOptions: boolean;
  showPsSelectPopup: boolean;
  showCbSelectPopup: boolean;
  showMojiQSelectPopup: boolean;
  showFolderSelectPopup: boolean;
  setShowSyncOptions: (v: boolean) => void;
  setShowPsSelectPopup: (v: boolean) => void;
  setShowCbSelectPopup: (v: boolean) => void;
  setShowMojiQSelectPopup: (v: boolean) => void;
  setShowFolderSelectPopup: (v: boolean) => void;
  instructionButtonsHidden: boolean;
  setInstructionButtonsHidden: (v: boolean) => void;
  openFolderInExplorer: (path: string) => void;
  toggleFullscreen: () => void;
  setParallelCapturedImageA: (v: string | null) => void;
  setParallelCapturedImageB: (v: string | null) => void;
  handleParallelDrop: (e: React.DragEvent, side: 'A' | 'B') => void;
  handleSelectParallelFolder: (side: 'A' | 'B') => void;
  handleSelectParallelPdf: (side: 'A' | 'B') => void;
  parallelPdfImageA: string | null;
  parallelPdfImageB: string | null;
  parallelMaxIndex: number;
  releaseMemoryBeforeMojiQ: () => void;
  expandPdfToParallelEntries: (pdfPath: string, side: 'A' | 'B', droppedFile?: File, forceSplitMode?: boolean, forceFirstPageSingle?: boolean) => void;
  refreshParallelView: () => void;
  openInPhotoshop: (path: string) => void;
  openInComicBridge: (path: string) => void;
  showHelp: boolean;
  setShowHelp: (v: boolean) => void;
  parallelDropZoneARef: React.RefObject<HTMLDivElement | null>;
  parallelDropZoneBRef: React.RefObject<HTMLDivElement | null>;
  tauriDragOverSide: string | null;
}

const ParallelViewer: React.FC<ParallelViewerProps> = (props) => {
  const {
    isFullscreen,
    fullscreenTransitioning,
    parallelFilesA,
    parallelFilesB,
    parallelFolderA,
    parallelFolderB,
    parallelSyncMode,
    parallelActivePanel,
    parallelCurrentIndex: _parallelCurrentIndex,
    parallelIndexA,
    parallelIndexB,
    setParallelCurrentIndex: _setParallelCurrentIndex,
    setParallelIndexA,
    setParallelIndexB,
    setParallelSyncMode,
    setParallelActivePanel,
    parallelImageA,
    parallelImageB,
    parallelLoading,
    parallelZoomA,
    parallelZoomB,
    parallelPanA,
    parallelPanB,
    setParallelZoomA,
    setParallelZoomB,
    setParallelPanA,
    setParallelPanB,
    handleParallelMouseDownA,
    handleParallelMouseDownB,
    handleParallelMouseMoveA,
    handleParallelMouseMoveB,
    handleParallelMouseUpA,
    handleParallelMouseUpB,
    isDraggingParallelA,
    isDraggingParallelB,
    spreadSplitModeA,
    spreadSplitModeB,
    firstPageSingleA,
    firstPageSingleB,
    setSpreadSplitModeA,
    setSpreadSplitModeB,
    setFirstPageSingleA,
    setFirstPageSingleB,
    showSyncOptions,
    showPsSelectPopup,
    showCbSelectPopup,
    showMojiQSelectPopup,
    setShowSyncOptions,
    setShowPsSelectPopup,
    setShowCbSelectPopup,
    setShowMojiQSelectPopup,
    instructionButtonsHidden,
    setInstructionButtonsHidden,
    toggleFullscreen,
    setParallelCapturedImageA,
    setParallelCapturedImageB,
    handleParallelDrop,
    handleSelectParallelFolder,
    handleSelectParallelPdf,
    parallelPdfImageA,
    parallelPdfImageB,
    parallelMaxIndex: _parallelMaxIndex,
    releaseMemoryBeforeMojiQ,
  expandPdfToParallelEntries,
  refreshParallelView,
  openInPhotoshop,
  openInComicBridge,
  showHelp,
    setShowHelp,
    parallelDropZoneARef,
    parallelDropZoneBRef,
    tauriDragOverSide,
  } = props;

  // ローカルstate: ドラッグオーバー側（HTMLドラッグ + Tauriネイティブドラッグを統合）
  const [localDragOverSide, setLocalDragOverSide] = useState<string | null>(null);
  const dragOverSide = localDragOverSide || tauriDragOverSide;
  const [pdfLayoutMenuSide, setPdfLayoutMenuSide] = useState<'A' | 'B' | null>(null);
  const [applyPdfLayoutBothSides, setApplyPdfLayoutBothSides] = useState(true);

  type PdfLayoutMode = 'cover-spread' | 'spread' | 'single';

  const getPdfLayoutMode = (splitMode: boolean, firstSingle: boolean): PdfLayoutMode => {
    if (!splitMode) return 'single';
    return firstSingle ? 'cover-spread' : 'spread';
  };

  const getPdfLayoutLabel = (mode: PdfLayoutMode) => {
    switch (mode) {
      case 'cover-spread':
        return '表紙あり見開き';
      case 'spread':
        return '見開き分割';
      case 'single':
        return 'そのまま表示';
    }
  };

  const getExpandedPdfEntryCount = (pageCount: number, mode: PdfLayoutMode) => {
    if (mode === 'single') return pageCount;
    if (mode === 'cover-spread') return pageCount <= 0 ? 0 : 1 + Math.max(0, pageCount - 1) * 2;
    return pageCount * 2;
  };

  const getPdfEntriesForSide = (side: 'A' | 'B') => side === 'A' ? parallelFilesA : parallelFilesB;
  const getPdfLayoutModeForSide = (side: 'A' | 'B') => getPdfLayoutMode(
    side === 'A' ? spreadSplitModeA : spreadSplitModeB,
    side === 'A' ? firstPageSingleA : firstPageSingleB,
  );

  const applyPdfLayoutMode = useCallback((side: 'A' | 'B', mode: PdfLayoutMode) => {
    const splitMode = mode !== 'single';
    const firstSingle = mode === 'cover-spread';
    const sides: Array<'A' | 'B'> = applyPdfLayoutBothSides ? ['A', 'B'] : [side];

    sides.forEach(targetSide => {
      if (targetSide === 'A') {
        setSpreadSplitModeA(splitMode);
        setFirstPageSingleA(firstSingle);
      } else {
        setSpreadSplitModeB(splitMode);
        setFirstPageSingleB(firstSingle);
      }

      const firstEntry = getPdfEntriesForSide(targetSide)[0];
      if (firstEntry?.path && firstEntry.type === 'pdf') {
        expandPdfToParallelEntries(firstEntry.path, targetSide, firstEntry.pdfFile, splitMode, firstSingle);
      }
    });

    setPdfLayoutMenuSide(null);
  }, [
    applyPdfLayoutBothSides,
    expandPdfToParallelEntries,
    parallelFilesA,
    parallelFilesB,
    setFirstPageSingleA,
    setFirstPageSingleB,
    setSpreadSplitModeA,
    setSpreadSplitModeB,
  ]);

  // 画像ズーム（Ctrl+ホイール / ツールバーの±ボタン）
  // 同期モードでは両パネルを同時に、非同期モードでは対象パネルのみズーム
  const ZOOM_MIN = 0.1;
  const ZOOM_MAX = 5;
  const zoomParallel = useCallback((side: 'A' | 'B', factor: number) => {
    const clamp = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * factor));
    if (parallelSyncMode) {
      setParallelZoomA(z => clamp(z));
      setParallelZoomB(z => clamp(z));
    } else if (side === 'A') {
      setParallelZoomA(z => clamp(z));
    } else {
      setParallelZoomB(z => clamp(z));
    }
  }, [parallelSyncMode, setParallelZoomA, setParallelZoomB]);

  const resetParallelZoom = useCallback(() => {
    setParallelZoomA(1);
    setParallelZoomB(1);
    setParallelPanA({ x: 0, y: 0 });
    setParallelPanB({ x: 0, y: 0 });
  }, [setParallelZoomA, setParallelZoomB, setParallelPanA, setParallelPanB]);

  // ハンバーガーメニュー（ショートカット説明）
  const helpButtonRef = useRef<HTMLButtonElement>(null);
  const [helpAnchor, setHelpAnchor] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!showHelp) return;
    const update = () => {
      const rect = helpButtonRef.current?.getBoundingClientRect();
      if (rect) setHelpAnchor({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [showHelp]);

  // ヘッダーのツールバースロットを探す（Header.tsx の #header-toolbar-slot にポータルで描画）
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const findSlot = () => {
      const el = document.getElementById('header-toolbar-slot');
      if (el) setHeaderSlot(el);
      return !!el;
    };
    if (findSlot()) return;
    let raf = requestAnimationFrame(function tick() {
      if (!findSlot()) raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  // PDF canvas同期描画（両パネルを同一フレームで同時更新）
  const pdfCanvasRefA = useRef<HTMLCanvasElement>(null);
  const pdfCanvasRefB = useRef<HTMLCanvasElement>(null);
  const pdfDrawVersionRef = useRef(0);

  // コンテナのコンテンツ領域を計測（padding除外、canvasを0にして親の本来のサイズを取得）
  const measureContainer = useCallback((canvas: HTMLCanvasElement) => {
    const parent = canvas.parentElement;
    if (!parent) return { w: 0, h: 0 };
    canvas.style.width = '0px';
    canvas.style.height = '0px';
    const cs = getComputedStyle(parent);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    return { w: parent.clientWidth - padX, h: parent.clientHeight - padY };
  }, []);

  // canvasに高品質描画（統一スケールで同じ画像サイズを同じ表示サイズにする）
  const drawToCanvasWithScale = useCallback((
    canvas: HTMLCanvasElement,
    img: HTMLImageElement,
    maxW: number,
    maxH: number,
  ) => {
    // 150DPI のRust出力に対して dpr=3 だと過剰なので 2 で頭打ち（MojiQ流）
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    // object-contain相当: アスペクト比を維持して指定領域に収める
    const imgRatio = img.naturalWidth / img.naturalHeight;
    const containerRatio = maxW / maxH;
    let displayW: number, displayH: number;
    if (imgRatio > containerRatio) {
      displayW = maxW;
      displayH = maxW / imgRatio;
    } else {
      displayH = maxH;
      displayW = maxH * imgRatio;
    }

    // canvas解像度 = 表示サイズ × DPR（CSSスケーリング不要で高画質）
    canvas.width = Math.round(displayW * dpr);
    canvas.height = Math.round(displayH * dpr);
    canvas.style.width = `${displayW}px`;
    canvas.style.height = `${displayH}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  }, []);

  useEffect(() => {
    const urlA = parallelPdfImageA;
    const urlB = parallelPdfImageB;
    if (!urlA && !urlB) return;

    const version = ++pdfDrawVersionRef.current;

    (async () => {
      // 両画像をデコード
      const imgA = urlA ? new Image() : null;
      const imgB = urlB ? new Image() : null;
      if (imgA) { imgA.crossOrigin = 'anonymous'; imgA.src = urlA!; }
      if (imgB) { imgB.crossOrigin = 'anonymous'; imgB.src = urlB!; }

      await Promise.all([
        imgA?.decode().catch(() => {}) ?? Promise.resolve(),
        imgB?.decode().catch(() => {}) ?? Promise.resolve(),
      ]);

      if (version !== pdfDrawVersionRef.current) return;

      // 同一requestAnimationFrame内で両canvasに描画 → 同じフレームで表示
      requestAnimationFrame(() => {
        if (version !== pdfDrawVersionRef.current) return;

        const canvasA = pdfCanvasRefA.current;
        const canvasB = pdfCanvasRefB.current;

        // 両パネルのコンテナサイズを計測
        const sizeA = canvasA ? measureContainer(canvasA) : null;
        const sizeB = canvasB ? measureContainer(canvasB) : null;

        // 統一スケール: 両パネルのコンテナサイズの小さい方を使い、
        // 同じキャンバスサイズの画像が同じ表示サイズになるようにする
        const unifiedW = Math.min(sizeA?.w ?? Infinity, sizeB?.w ?? Infinity);
        const unifiedH = Math.min(sizeA?.h ?? Infinity, sizeB?.h ?? Infinity);
        const maxW = unifiedW === Infinity ? 0 : unifiedW;
        const maxH = unifiedH === Infinity ? 0 : unifiedH;

        if (imgA && canvasA && maxW > 0 && maxH > 0) {
          drawToCanvasWithScale(canvasA, imgA, maxW, maxH);
        }
        if (imgB && canvasB && maxW > 0 && maxH > 0) {
          drawToCanvasWithScale(canvasB, imgB, maxW, maxH);
        }
      });
    })();
  }, [parallelPdfImageA, parallelPdfImageB, drawToCanvasWithScale, measureContainer]);

  const hasPsdInParallel = parallelFilesA.some(f => f.type === 'psd') || parallelFilesB.some(f => f.type === 'psd');

  const renderPdfCompositionControl = (side: 'A' | 'B') => {
    const entries = getPdfEntriesForSide(side);
    const firstEntry = entries[0];
    if (!firstEntry || firstEntry.type !== 'pdf') return null;

    const currentMode = getPdfLayoutModeForSide(side);
    const pageCount = firstEntry.pageCount ?? entries.length;
    const expandedCount = getExpandedPdfEntryCount(pageCount, currentMode);
    const alignClass = side === 'A' ? 'left-0' : 'right-0';
    const options: Array<{ mode: PdfLayoutMode; title: string; description: string }> = [
      {
        mode: 'cover-spread',
        title: '表紙だけ単独 + 見開き分割',
        description: '1ページ目は表紙としてそのまま、2ページ目以降を右→左に分割',
      },
      {
        mode: 'spread',
        title: '見開きを左右分割',
        description: 'すべてのPDFページを右ページ、左ページに分けて表示',
      },
      {
        mode: 'single',
        title: 'そのまま表示',
        description: 'PDFの1ページを1枚として表示',
      },
    ];

    return (
      <div className="ml-2 relative">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setPdfLayoutMenuSide(pdfLayoutMenuSide === side ? null : side);
          }}
          className="h-8 px-3 rounded-md border border-[rgba(196,164,124,0.22)] bg-[rgba(196,164,124,0.12)] text-orange-200 hover:bg-[rgba(196,164,124,0.18)] transition-colors flex items-center gap-2 font-semibold text-[13px] shadow-[0_0_0_1px_rgba(0,0,0,0.25)]"
          title="PDF構成を選択"
        >
          <span>PDF構成: {getPdfLayoutLabel(currentMode)}</span>
          <ChevronDown size={14} className={`transition-transform ${pdfLayoutMenuSide === side ? 'rotate-180' : ''}`} />
        </button>

        {pdfLayoutMenuSide === side && (
          <div
            className={`absolute top-full ${alignClass} mt-2 z-50 w-[520px] max-w-[calc(100vw-32px)] rounded-lg border border-white/[0.08] bg-neutral-900/95 backdrop-blur-md shadow-[0_16px_48px_rgba(0,0,0,0.55)] p-4 text-neutral-200`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-semibold text-neutral-100 mb-3">PDF構成</div>
            <div className="space-y-2">
              {options.map(option => {
                const selected = option.mode === currentMode;
                return (
                  <button
                    key={option.mode}
                    onClick={() => applyPdfLayoutMode(side, option.mode)}
                    className={`w-full text-left rounded-lg border p-3 transition-colors flex gap-3 ${selected ? 'border-[rgba(196,164,124,0.35)] bg-[rgba(196,164,124,0.12)]' : 'border-transparent hover:border-white/[0.08] hover:bg-white/[0.04]'}`}
                  >
                    <span className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-full border ${selected ? 'border-orange-200 bg-[rgba(196,164,124,0.20)] text-orange-200' : 'border-white/[0.20] text-transparent'}`}>
                      <Check size={13} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-neutral-100">{option.title}</span>
                      <span className="block mt-1 text-xs leading-5 text-neutral-400">{option.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 pt-3 border-t border-white/[0.08] flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-xs text-neutral-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={applyPdfLayoutBothSides}
                  onChange={(e) => setApplyPdfLayoutBothSides(e.target.checked)}
                  className="h-4 w-4 rounded border-white/[0.12] bg-neutral-800 accent-[#6b8aff]"
                />
                A/B両方に適用
              </label>
              <div className="rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-neutral-300">
                展開後: {pageCount}ページ → {expandedCount}表示
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ヘッダーのスロットに portal で描画するツールバー（Photoshop / CB写植 / MojiQ / フォルダ / 同期 / 更新 / 閲覧 / ハンバーガー）
  const toolbarContent = (
        <div className="flex items-center justify-between gap-2 flex-1 min-w-0">
            <div className={`flex items-center flex-nowrap text-xs text-neutral-400 min-w-0 overflow-hidden ${hasPsdInParallel ? 'gap-1.5' : 'gap-2'}`}>
              {/* Photoshopで開くボタン */}
              {(() => {
                const currentFileA = parallelFilesA[parallelIndexA];
                const currentFileB = parallelFilesB[parallelIndexB];
                const hasPsdA = currentFileA?.type === 'psd';
                const hasPsdB = currentFileB?.type === 'psd';
                if (!hasPsdA && !hasPsdB) return null;
                return (
                  <div className="relative">
                    <button
                      onClick={() => {
                        if (!parallelSyncMode) {
                          // 非同期モード: アクティブパネル側を直接開く
                          const file = parallelActivePanel === 'A' ? currentFileA : currentFileB;
                          if (file?.type === 'psd') {
                            openInPhotoshop(file.path);
                          }
                        } else {
                          setShowPsSelectPopup(!showPsSelectPopup);
                        }
                      }}
                      className={`flex items-center rounded border transition-colors bg-[rgba(164,140,196,0.15)] border-[rgba(164,140,196,0.2)] text-purple-400 hover:bg-[rgba(164,140,196,0.2)] ${hasPsdInParallel ? 'gap-1 px-2.5 py-1.5' : 'gap-1.5 px-3 py-1.5'}`}
                      title="Photoshopで開く (P)"
                    >
                      <Layers size={hasPsdInParallel ? 12 : 14} />
                      Photoshop<span className={`opacity-60 ${hasPsdInParallel ? 'text-[11px]' : ''}`}>[P]</span>
                    </button>

                    {/* 選択ポップアップ */}
                    {showPsSelectPopup && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setShowPsSelectPopup(false)} />
                        <div className="absolute top-full right-0 mt-2 p-2 bg-neutral-800/95 backdrop-blur-md rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.5)] border border-white/[0.06] z-50 min-w-48">
                          <button
                            onClick={() => {
                            if (currentFileA?.path) openInPhotoshop(currentFileA.path);
                              setShowPsSelectPopup(false);
                            }}
                            disabled={!hasPsdA}
                            className="w-full text-left px-3 py-2 rounded text-sm hover:bg-white/[0.03] disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2"
                          >
                            <span className="text-blue-400 shrink-0">A側</span>
                            <span className="text-neutral-400 truncate">{currentFileA?.name || '-'}</span>
                          </button>
                          <button
                            onClick={() => {
                            if (currentFileB?.path) openInPhotoshop(currentFileB.path);
                              setShowPsSelectPopup(false);
                            }}
                            disabled={!hasPsdB}
                            className="w-full text-left px-3 py-2 rounded text-sm hover:bg-white/[0.03] disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2"
                          >
                            <span className="text-green-400 shrink-0">B側</span>
                            <span className="text-neutral-400 truncate">{currentFileB?.name || '-'}</span>
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })()}
              {/* COMIC-Bridge写植で開くボタン */}
              {(() => {
                const currentFileA = parallelFilesA[parallelIndexA];
                const currentFileB = parallelFilesB[parallelIndexB];
                const hasPsdA = currentFileA?.type === 'psd';
                const hasPsdB = currentFileB?.type === 'psd';
                const hasBothPsd = hasPsdA && hasPsdB;
                if (!hasPsdA && !hasPsdB) return null;
                return (
                  <div className="relative">
                    <button
                      onClick={() => {
                        if (parallelSyncMode && hasBothPsd) {
                          setShowPsSelectPopup(false);
                          setShowMojiQSelectPopup(false);
                          setShowCbSelectPopup(!showCbSelectPopup);
                          return;
                        }

                        const active = parallelActivePanel === 'A' ? currentFileA : currentFileB;
                        const fallback = hasPsdA ? currentFileA : currentFileB;
                        const target = (active?.type === 'psd') ? active : fallback;
                        if (target?.path) openInComicBridge(target.path);
                      }}
                      className={`flex items-center rounded border transition-colors bg-[rgba(196,164,124,0.15)] border-[rgba(196,164,124,0.2)] text-orange-300 hover:bg-[rgba(196,164,124,0.22)] ${hasPsdInParallel ? 'gap-1 px-2.5 py-1.5' : 'gap-1.5 px-3 py-1.5'}`}
                      title="COMIC-Bridgeの写植機能で開く"
                    >
                      <Layers size={hasPsdInParallel ? 12 : 14} />
                      CB写植
                    </button>

                    {showCbSelectPopup && hasBothPsd && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setShowCbSelectPopup(false)} />
                        <div className="absolute top-full right-0 mt-2 p-2 bg-neutral-800/95 backdrop-blur-md rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.5)] border border-white/[0.06] z-50 min-w-48">
                          <button
                            onClick={() => {
                              if (currentFileA?.path) openInComicBridge(currentFileA.path);
                              setShowCbSelectPopup(false);
                            }}
                            disabled={!hasPsdA}
                            className="w-full text-left px-3 py-2 rounded text-sm hover:bg-white/[0.03] disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2"
                          >
                            <span className="text-blue-400 shrink-0">A側</span>
                            <span className="text-neutral-400 truncate">{currentFileA?.name || '-'}</span>
                          </button>
                          <button
                            onClick={() => {
                              if (currentFileB?.path) openInComicBridge(currentFileB.path);
                              setShowCbSelectPopup(false);
                            }}
                            disabled={!hasPsdB}
                            className="w-full text-left px-3 py-2 rounded text-sm hover:bg-white/[0.03] disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2"
                          >
                            <span className="text-green-400 shrink-0">B側</span>
                            <span className="text-neutral-400 truncate">{currentFileB?.name || '-'}</span>
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })()}
              {/* MojiQで開くボタン */}
              {(() => {
                const currentFileA = parallelFilesA[parallelIndexA];
                const currentFileB = parallelFilesB[parallelIndexB];
                const hasPdfA = currentFileA?.type === 'pdf';
                const hasPdfB = currentFileB?.type === 'pdf';
                if (!hasPdfA && !hasPdfB) return null;
                const hasBothPdf = hasPdfA && hasPdfB;
                return (
                  <div className="relative">
                    <button
                      onClick={() => {
                        // 非同期モードまたは片方のみPDFの場合は直接開く
                        if (!parallelSyncMode || !hasBothPdf) {
                          const active = parallelActivePanel === 'A' ? currentFileA : currentFileB;
                          const fallback = hasPdfA ? currentFileA : currentFileB;
                          const target = active?.type === 'pdf' ? active : fallback;
                          if (target?.type === 'pdf') {
                            releaseMemoryBeforeMojiQ();
                            setTimeout(() => {
                              invoke('open_pdf_in_mojiq', { pdfPath: target.path, page: target.pdfPage || 1 })
                                .catch((err: unknown) => {
                                  console.error('[MojiQ] Error:', err);
                                  alert(`MojiQの起動に失敗しました:\n${err}`);
                                });
                            }, 100);
                          }
                        } else {
                          // 同期モードで両方PDFの場合はポップアップ
                          setShowPsSelectPopup(false);
                          setShowCbSelectPopup(false);
                          setShowMojiQSelectPopup(!showMojiQSelectPopup);
                        }
                      }}
                      className={`flex items-center rounded border transition-colors bg-[rgba(196,140,156,0.15)] border-[rgba(196,140,156,0.2)] text-rose-400 hover:bg-[rgba(196,140,156,0.2)] ${hasPsdInParallel ? 'gap-1 px-2.5 py-1.5' : 'gap-1.5 px-3 py-1.5'}`}
                      title="MojiQで開く (Q)"
                    >
                      <FileText size={hasPsdInParallel ? 12 : 14} />
                      MojiQ<span className={`opacity-60 ${hasPsdInParallel ? 'text-[11px]' : ''}`}>[Q]</span>
                    </button>

                    {/* 選択ポップアップ */}
                    {showMojiQSelectPopup && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setShowMojiQSelectPopup(false)} />
                        <div className="absolute top-full right-0 mt-2 p-2 bg-neutral-800/95 backdrop-blur-md rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.5)] border border-white/[0.06] z-50 min-w-48">
                          <button
                            onClick={() => {
                              if (currentFileA?.type === 'pdf') {
                                releaseMemoryBeforeMojiQ();
                                setTimeout(() => {
                                  invoke('open_pdf_in_mojiq', { pdfPath: currentFileA.path, page: currentFileA.pdfPage || 1 })
                                    .catch((err: unknown) => {
                                      console.error('[MojiQ] Error:', err);
                                      alert(`MojiQの起動に失敗しました:\n${err}`);
                                    });
                                }, 100);
                              }
                              setShowMojiQSelectPopup(false);
                            }}
                            disabled={!hasPdfA}
                            className="w-full text-left px-3 py-2 rounded text-sm hover:bg-white/[0.03] disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2"
                          >
                            <span className="text-blue-400 shrink-0">A側</span>
                            <span className="text-neutral-400 truncate">{currentFileA?.name || '-'}</span>
                          </button>
                          <button
                            onClick={() => {
                              if (currentFileB?.type === 'pdf') {
                                releaseMemoryBeforeMojiQ();
                                setTimeout(() => {
                                  invoke('open_pdf_in_mojiq', { pdfPath: currentFileB.path, page: currentFileB.pdfPage || 1 })
                                    .catch((err: unknown) => {
                                      console.error('[MojiQ] Error:', err);
                                      alert(`MojiQの起動に失敗しました:\n${err}`);
                                    });
                                }, 100);
                              }
                              setShowMojiQSelectPopup(false);
                            }}
                            disabled={!hasPdfB}
                            className="w-full text-left px-3 py-2 rounded text-sm hover:bg-white/[0.03] disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2"
                          >
                            <span className="text-green-400 shrink-0">B側</span>
                            <span className="text-neutral-400 truncate">{currentFileB?.name || '-'}</span>
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })()}
              {/* 同期/非同期切り替え */}
              {(parallelFilesA.length > 0 || parallelFilesB.length > 0) && (
                <div className="relative flex items-center">
                  <div className="flex rounded-lg overflow-hidden bg-neutral-950 p-0.5 gap-0.5">
                    {/* 同期ボタン: クリックで即座に同期へ戻す（現在のページ位置を維持） */}
                    <button
                      onClick={() => {
                        if (!parallelSyncMode) {
                          setParallelSyncMode(true);
                          setShowSyncOptions(false);
                        }
                      }}
                      className={`px-3 py-1.5 text-xs flex items-center gap-1 rounded transition ${
                        parallelSyncMode
                          ? 'bg-neutral-700 text-neutral-100 shadow-sm'
                          : 'text-neutral-500 hover:text-neutral-400'
                      }`}
                      title="同期モードに戻す"
                    >
                      <Link2 size={12} />同期
                    </button>
                    {/* 非同期ボタン */}
                    <button
                      onClick={() => {
                        if (parallelSyncMode) {
                          setParallelSyncMode(false);
                          setParallelActivePanel('A');
                          setShowSyncOptions(false);
                        }
                      }}
                      className={`px-3 py-1.5 text-xs flex items-center gap-1 rounded transition ${
                        !parallelSyncMode
                          ? 'bg-neutral-700 text-neutral-100 shadow-sm'
                          : 'text-neutral-500 hover:text-neutral-400'
                      }`}
                      title="非同期モード"
                    >
                      <Unlink2 size={12} />非同期
                    </button>
                  </div>
                  {/* 非同期時のみ: ページを合わせて同期し直すオプション（任意） */}
                  {!parallelSyncMode && (
                    <button
                      onClick={() => setShowSyncOptions(!showSyncOptions)}
                      className={`ml-0.5 px-1.5 py-1.5 rounded transition ${showSyncOptions ? 'text-neutral-200 bg-white/[0.06]' : 'text-neutral-500 hover:text-neutral-300'}`}
                      title="同期オプション（ページを合わせて再同期）"
                    >
                      <ChevronDown size={12} />
                    </button>
                  )}
                  {/* 再同期オプションポップアップ */}
                  {!parallelSyncMode && showSyncOptions && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowSyncOptions(false)} />
                      <div className="absolute top-full left-0 mt-1 z-50">
                        <div className="p-1 bg-neutral-800/95 backdrop-blur-md rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.5)] border border-white/[0.06] whitespace-nowrap flex flex-col gap-1">
                        <button
                          onClick={() => {
                            setParallelSyncMode(true);
                            setShowSyncOptions(false);
                          }}
                          className="px-3 py-1.5 text-xs bg-[rgba(124,156,196,0.12)] hover:bg-[rgba(124,156,196,0.18)] border border-[rgba(124,156,196,0.2)] text-blue-400 rounded transition"
                        >
                          このまま再同期
                        </button>
                        <button
                          onClick={() => {
                            const targetIndex = parallelActivePanel === 'A' ? parallelIndexA : parallelIndexB;
                            setParallelIndexA(targetIndex);
                            setParallelIndexB(targetIndex);
                            setParallelSyncMode(true);
                            setShowSyncOptions(false);
                          }}
                          className="px-3 py-1.5 text-xs bg-[rgba(124,184,140,0.12)] hover:bg-[rgba(124,184,140,0.18)] border border-[rgba(124,184,140,0.2)] text-green-400 rounded transition"
                        >
                          ページを合わせて再同期
                        </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
              {/* ズーム操作（Ctrl+ホイールでも可） */}
              {(parallelFilesA.length > 0 || parallelFilesB.length > 0) && (() => {
                const activeZoom = parallelSyncMode
                  ? parallelZoomA
                  : (parallelActivePanel === 'A' ? parallelZoomA : parallelZoomB);
                return (
                  <div className="flex items-center rounded-lg overflow-hidden bg-neutral-950 p-0.5 gap-0.5" title="Ctrl+ホイール / Ctrl +/- でもズームできます">
                    <button
                      onClick={() => zoomParallel(parallelActivePanel, 1 / 1.25)}
                      className="px-2 py-1.5 text-neutral-400 hover:text-neutral-100 rounded transition"
                      title="ズームアウト (Ctrl -)"
                    >
                      <ZoomOut size={12} />
                    </button>
                    <button
                      onClick={resetParallelZoom}
                      className="px-1.5 py-1.5 text-xs text-neutral-300 hover:text-neutral-100 rounded transition tabular-nums min-w-[3rem]"
                      title="等倍に戻す (Ctrl 0)"
                    >
                      {Math.round(activeZoom * 100)}%
                    </button>
                    <button
                      onClick={() => zoomParallel(parallelActivePanel, 1.25)}
                      className="px-2 py-1.5 text-neutral-400 hover:text-neutral-100 rounded transition"
                      title="ズームイン (Ctrl +)"
                    >
                      <ZoomIn size={12} />
                    </button>
                  </div>
                );
              })()}
              {/* 更新ボタン */}
              {(parallelFilesA.length > 0 || parallelFilesB.length > 0) && (
                <button
                  onClick={refreshParallelView}
                  disabled={parallelLoading}
                  className={`flex items-center rounded border transition-colors bg-[rgba(124,184,140,0.12)] border-[rgba(124,184,140,0.2)] text-green-400 hover:bg-[rgba(124,184,140,0.18)] disabled:opacity-30 ${hasPsdInParallel ? 'gap-1 px-2.5 py-1.5' : 'gap-1.5 px-3 py-1.5'}`}
                  title="ファイルを再読み込み (F5)"
                >
                  <RefreshCw size={hasPsdInParallel ? 12 : 14} />
                  更新<span className={`opacity-60 ${hasPsdInParallel ? 'text-[11px]' : ''}`}>[F5]</span>
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* 全画面ボタン */}
              <button
                onClick={toggleFullscreen}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded border transition-colors bg-neutral-700 border-white/[0.06] text-neutral-300 hover:bg-neutral-600 text-xs shrink-0"
                title="全画面表示 (F11)"
              >
                <Maximize2 size={14} />
                <span>閲覧</span>
              </button>
              {/* ハンバーガーメニュー（ショートカット説明パネル） */}
              <button
                ref={helpButtonRef}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowHelp(!showHelp);
                }}
                className="p-1.5 text-neutral-500 hover:text-neutral-200 hover:bg-white/[0.06] rounded-md transition-colors shrink-0"
                title="ショートカット一覧"
                aria-label="ショートカット一覧"
              >
                <Menu size={18} />
              </button>
            </div>
        </div>
  );

  return (
        /* 並列ビューモードのMain Viewer */
        <div className="flex-1 flex flex-col bg-black relative">
          {/* 左右分割ビューア */}
          <div className="flex-1 flex min-h-0">
            {/* 左パネル (フォルダ/PDFA) */}
            <div
              ref={parallelDropZoneARef}
              className={`flex-1 flex flex-col border-r border-white/[0.04] transition-all duration-200 ${dragOverSide === 'parallelA' ? 'border-r-[rgba(124,156,196,0.35)] bg-[rgba(124,156,196,0.06)]' : ''} ${!parallelSyncMode && parallelActivePanel === 'A' ? 'ring-1 ring-[rgba(124,156,196,0.25)] ring-inset' : ''}`}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setLocalDragOverSide('parallelA'); }}
              onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); if (!e.currentTarget.contains(e.relatedTarget as Node)) setLocalDragOverSide(null); }}
              onDrop={(e) => { handleParallelDrop(e, 'A'); setLocalDragOverSide(null); }}
              onClick={() => !parallelSyncMode && setParallelActivePanel('A')}
            >
              {!isFullscreen && (
              <div className={`h-10 border-b border-white/[0.06] flex items-center px-3 text-xs ${!parallelSyncMode && parallelActivePanel === 'A' ? 'bg-[rgba(124,156,196,0.08)] text-blue-400' : 'bg-neutral-900 text-blue-400'}`}>
                {parallelFilesA[0]?.type === 'pdf' ? <FileText size={12} className="mr-2" /> : <FolderOpen size={12} className="mr-2" />}
                <span className="truncate max-w-32">{parallelFolderA ? parallelFolderA.split(/[/\\]/).pop() : 'A'}</span>
                {/* 単ページ化ボタン（PDF時のみ） */}
                {renderPdfCompositionControl('A')}
                {!parallelSyncMode && parallelFilesA.length > 0 && (
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); setParallelActivePanel('A'); setParallelIndexA(prev => Math.max(prev - 1, 0)); }}
                      disabled={parallelIndexA <= 0}
                      className="px-1 hover:bg-white/[0.03] rounded disabled:opacity-30"
                    >▲</button>
                    <span className="px-1 text-neutral-400">{parallelIndexA + 1}/{parallelFilesA.length}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); setParallelActivePanel('A'); setParallelIndexA(prev => Math.min(prev + 1, parallelFilesA.length - 1)); }}
                      disabled={parallelIndexA >= parallelFilesA.length - 1}
                      className="px-1 hover:bg-white/[0.03] rounded disabled:opacity-30"
                    >▼</button>
                  </div>
                )}
              </div>
              )}
              <div
                className={`flex-1 flex items-center justify-center bg-neutral-950 ${isFullscreen ? '' : 'p-4'} overflow-hidden relative`}
                style={{ cursor: parallelZoomA > 1 ? (isDraggingParallelA ? 'grabbing' : 'grab') : 'default' }}
                onWheel={(e) => {
                  e.preventDefault();
                  // Ctrl+ホイール = ズームイン/アウト
                  if (e.ctrlKey) {
                    zoomParallel('A', e.deltaY < 0 ? 1.25 : 1 / 1.25);
                    return;
                  }
                  // 非同期モードでアクティブパネルでない場合は無視
                  if (!parallelSyncMode && parallelActivePanel !== 'A') return;
                  if (e.deltaY > 0) {
                    // 下スクロール = 次のファイル
                    setParallelIndexA(i => Math.min(i + 1, parallelFilesA.length - 1));
                    if (parallelSyncMode) setParallelIndexB(i => Math.min(i + 1, parallelFilesB.length - 1));
                  } else {
                    // 上スクロール = 前のファイル
                    setParallelIndexA(i => Math.max(i - 1, 0));
                    if (parallelSyncMode) setParallelIndexB(i => Math.max(i - 1, 0));
                  }
                }}
                onMouseDown={handleParallelMouseDownA}
                onMouseMove={handleParallelMouseMoveA}
                onMouseUp={handleParallelMouseUpA}
                onMouseLeave={handleParallelMouseUpA}
              >
                {/* ドラッグオーバー時のオーバーレイ */}
                {dragOverSide === 'parallelA' && (
                  <div className="absolute inset-0 bg-[rgba(124,156,196,0.08)] backdrop-blur-[1px] flex items-center justify-center z-10 pointer-events-none">
                    <div className="bg-neutral-800/90 backdrop-blur-md text-blue-400 px-5 py-2.5 rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.5)] border border-[rgba(124,156,196,0.20)] text-sm font-medium">
                      ドロップで切り替え
                    </div>
                  </div>
                )}
                {/* PDF表示: Rust PDFiumレンダリング → canvas同期描画。未完了時は小スピナー */}
                {parallelFilesA[parallelIndexA]?.type === 'pdf' && !parallelPdfImageA ? (
                  <Loader2 size={32} className="animate-spin text-blue-400 opacity-50" />
                ) : parallelFilesA[parallelIndexA]?.type === 'pdf' && parallelPdfImageA ? (
                  <>
                    <canvas
                      ref={pdfCanvasRefA}
                      className="shadow-2xl bg-white"
                      draggable={false}
                      style={{ transform: `scale(${parallelZoomA}) translate(${parallelPanA.x / parallelZoomA}px, ${parallelPanA.y / parallelZoomA}px)`, transformOrigin: 'center center' }}
                    />
                    {!isFullscreen && (
                      instructionButtonsHidden ? (
                        <button
                          onClick={() => setInstructionButtonsHidden(false)}
                          className="absolute bottom-6 right-2 p-2 text-white/0 hover:text-white/60 hover:bg-black/20 rounded-lg transition-all"
                          title="指示エディタボタンを表示"
                        >
                          <EyeOff size={16} />
                        </button>
                      ) : (
                        <div className="absolute bottom-6 right-2 flex flex-col items-end gap-1">
                          <button
                            onClick={() => setInstructionButtonsHidden(true)}
                            className="p-1 text-white/50 hover:text-white/80 transition-colors"
                            title="指示エディタボタンを非表示"
                          >
                            <Eye size={14} />
                          </button>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleSelectParallelPdf('A'); }}
                              className="flex items-center gap-1 px-2 py-1.5 bg-green-600/90 hover:bg-green-500 text-white rounded-md shadow-lg transition-colors text-xs"
                              title="PDFを選択して再読み込み"
                            >
                              <Download size={12} />
                              読み込み
                            </button>
                            <button
                              onClick={async () => {
                                if (parallelPdfImageA) setParallelCapturedImageA(parallelPdfImageA);
                              }}
                              className="flex items-center gap-1 px-2 py-1.5 bg-blue-600/90 hover:bg-blue-500 text-white rounded-md shadow-lg transition-colors text-xs"
                              title="指示エディタを開く (C)"
                            >
                              <Edit3 size={12} />
                              指示
                            </button>
                          </div>
                        </div>
                      )
                    )}
                  </>
                ) : parallelImageA ? (
                  <>
                    <img
                      src={parallelImageA}
                      alt="A"
                      className="max-w-full max-h-full object-contain shadow-2xl bg-white"
                      draggable={false}
                      style={{ transform: `scale(${parallelZoomA}) translate(${parallelPanA.x / parallelZoomA}px, ${parallelPanA.y / parallelZoomA}px)`, transformOrigin: 'center center' }}
                    />
                    {!isFullscreen && parallelZoomA !== 1 && (
                      <div className="absolute top-2 left-2 px-2 py-1 bg-black/60 text-white text-xs rounded">
                        {Math.round(parallelZoomA * 100)}% (Ctrl+0でリセット)
                      </div>
                    )}
                    {!isFullscreen && (
                      instructionButtonsHidden ? (
                        <button
                          onClick={() => setInstructionButtonsHidden(false)}
                          className="absolute bottom-6 right-2 p-2 text-white/0 hover:text-white/60 hover:bg-black/20 rounded-lg transition-all"
                          title="指示エディタボタンを表示"
                        >
                          <EyeOff size={16} />
                        </button>
                      ) : (
                        <div className="absolute bottom-6 right-2 flex flex-col items-end gap-1">
                          <button
                            onClick={() => setInstructionButtonsHidden(true)}
                            className="p-1 text-white/50 hover:text-white/80 transition-colors"
                            title="指示エディタボタンを非表示"
                          >
                            <Eye size={14} />
                          </button>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleSelectParallelFolder('A'); }}
                              className="flex items-center gap-1 px-2 py-1.5 bg-green-600/90 hover:bg-green-500 text-white rounded-md shadow-lg transition-colors text-xs"
                              title="フォルダを選択して再読み込み"
                            >
                              <Download size={12} />
                              読み込み
                            </button>
                            <button
                              onClick={() => setParallelCapturedImageA(parallelImageA)}
                              className="flex items-center gap-1 px-2 py-1.5 bg-blue-600/90 hover:bg-blue-500 text-white rounded-md shadow-lg transition-colors text-xs"
                              title="指示エディタを開く (C)"
                            >
                              <Edit3 size={12} />
                              指示
                            </button>
                          </div>
                        </div>
                      )
                    )}
                  </>
                ) : parallelLoading ? (
                  <Loader2 size={32} className="animate-spin text-blue-400 opacity-50" />
                ) : parallelFilesA.length > 0 ? (
                  <div className="text-neutral-600 text-sm">読み込み中...</div>
                ) : (
                  <div className="text-neutral-600 text-sm flex flex-col items-center gap-3">
                    <div className="flex items-center gap-4 opacity-30">
                      <FolderOpen size={36} />
                      <span className="text-2xl">/</span>
                      <FileText size={36} />
                    </div>
                    <div className="text-center">
                      <div className="mb-2">フォルダまたはPDFをドロップ</div>
                      <div className="flex gap-2 justify-center">
                        <button
                          onClick={() => handleSelectParallelFolder('A')}
                          className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700/50 rounded text-xs transition"
                        >
                          フォルダ選択
                        </button>
                        <button
                          onClick={() => handleSelectParallelPdf('A')}
                          className="px-3 py-1.5 bg-blue-900/50 hover:bg-blue-800 rounded text-xs transition text-blue-300"
                        >
                          PDF選択
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 右パネル (フォルダ/PDFB) */}
            <div
              ref={parallelDropZoneBRef}
              className={`flex-1 flex flex-col transition-all duration-200 ${dragOverSide === 'parallelB' ? 'border-l border-l-[rgba(124,184,140,0.35)] bg-[rgba(124,184,140,0.06)]' : ''} ${!parallelSyncMode && parallelActivePanel === 'B' ? 'ring-1 ring-[rgba(124,184,140,0.25)] ring-inset' : ''}`}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setLocalDragOverSide('parallelB'); }}
              onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); if (!e.currentTarget.contains(e.relatedTarget as Node)) setLocalDragOverSide(null); }}
              onDrop={(e) => { handleParallelDrop(e, 'B'); setLocalDragOverSide(null); }}
              onClick={() => !parallelSyncMode && setParallelActivePanel('B')}
            >
              {!isFullscreen && (
              <div className={`h-10 border-b border-white/[0.06] flex items-center px-3 text-xs ${!parallelSyncMode && parallelActivePanel === 'B' ? 'bg-[rgba(124,184,140,0.08)] text-green-400' : 'bg-neutral-900 text-green-400'}`}>
                {parallelFilesB[0]?.type === 'pdf' ? <FileText size={12} className="mr-2" /> : <FolderOpen size={12} className="mr-2" />}
                <span className="truncate max-w-32">{parallelFolderB ? parallelFolderB.split(/[/\\]/).pop() : 'B'}</span>
                {/* 単ページ化ボタン（PDF時のみ） */}
                {renderPdfCompositionControl('B')}
                {!parallelSyncMode && parallelFilesB.length > 0 && (
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); setParallelActivePanel('B'); setParallelIndexB(prev => Math.max(prev - 1, 0)); }}
                      disabled={parallelIndexB <= 0}
                      className="px-1 hover:bg-white/[0.03] rounded disabled:opacity-30"
                    >▲</button>
                    <span className="px-1 text-neutral-400">{parallelIndexB + 1}/{parallelFilesB.length}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); setParallelActivePanel('B'); setParallelIndexB(prev => Math.min(prev + 1, parallelFilesB.length - 1)); }}
                      disabled={parallelIndexB >= parallelFilesB.length - 1}
                      className="px-1 hover:bg-white/[0.03] rounded disabled:opacity-30"
                    >▼</button>
                  </div>
                )}
              </div>
              )}
              <div
                className={`flex-1 flex items-center justify-center bg-neutral-950 ${isFullscreen ? '' : 'p-4'} overflow-hidden relative`}
                style={{ cursor: parallelZoomB > 1 ? (isDraggingParallelB ? 'grabbing' : 'grab') : 'default' }}
                onWheel={(e) => {
                  e.preventDefault();
                  // Ctrl+ホイール = ズームイン/アウト
                  if (e.ctrlKey) {
                    zoomParallel('B', e.deltaY < 0 ? 1.25 : 1 / 1.25);
                    return;
                  }
                  // 非同期モードでアクティブパネルでない場合は無視
                  if (!parallelSyncMode && parallelActivePanel !== 'B') return;
                  if (e.deltaY > 0) {
                    // 下スクロール = 次のファイル
                    setParallelIndexB(i => Math.min(i + 1, parallelFilesB.length - 1));
                    if (parallelSyncMode) setParallelIndexA(i => Math.min(i + 1, parallelFilesA.length - 1));
                  } else {
                    // 上スクロール = 前のファイル
                    setParallelIndexB(i => Math.max(i - 1, 0));
                    if (parallelSyncMode) setParallelIndexA(i => Math.max(i - 1, 0));
                  }
                }}
                onMouseDown={handleParallelMouseDownB}
                onMouseMove={handleParallelMouseMoveB}
                onMouseUp={handleParallelMouseUpB}
                onMouseLeave={handleParallelMouseUpB}
              >
                {/* ドラッグオーバー時のオーバーレイ */}
                {dragOverSide === 'parallelB' && (
                  <div className="absolute inset-0 bg-[rgba(124,184,140,0.08)] backdrop-blur-[1px] flex items-center justify-center z-10 pointer-events-none">
                    <div className="bg-neutral-800/90 backdrop-blur-md text-green-400 px-5 py-2.5 rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.5)] border border-[rgba(124,184,140,0.20)] text-sm font-medium">
                      ドロップで切り替え
                    </div>
                  </div>
                )}
                {/* PDF表示: Rust PDFiumレンダリング → canvas同期描画。未完了時は小スピナー */}
                {parallelFilesB[parallelIndexB]?.type === 'pdf' && !parallelPdfImageB ? (
                  <Loader2 size={32} className="animate-spin text-green-400 opacity-50" />
                ) : parallelFilesB[parallelIndexB]?.type === 'pdf' && parallelPdfImageB ? (
                  <>
                    <canvas
                      ref={pdfCanvasRefB}
                      className="shadow-2xl bg-white"
                      draggable={false}
                      style={{ transform: `scale(${parallelZoomB}) translate(${parallelPanB.x / parallelZoomB}px, ${parallelPanB.y / parallelZoomB}px)`, transformOrigin: 'center center' }}
                    />
                    {!isFullscreen && (
                      instructionButtonsHidden ? (
                        <button
                          onClick={() => setInstructionButtonsHidden(false)}
                          className="absolute bottom-6 right-2 p-2 text-white/0 hover:text-white/60 hover:bg-black/20 rounded-lg transition-all"
                          title="指示エディタボタンを表示"
                        >
                          <EyeOff size={16} />
                        </button>
                      ) : (
                        <div className="absolute bottom-6 right-2 flex flex-col items-end gap-1">
                          <button
                            onClick={() => setInstructionButtonsHidden(true)}
                            className="p-1 text-white/50 hover:text-white/80 transition-colors"
                            title="指示エディタボタンを非表示"
                          >
                            <Eye size={14} />
                          </button>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleSelectParallelPdf('B'); }}
                              className="flex items-center gap-1 px-2 py-1.5 bg-green-600/90 hover:bg-green-500 text-white rounded-md shadow-lg transition-colors text-xs"
                              title="PDFを選択して再読み込み"
                            >
                              <Download size={12} />
                              読み込み
                            </button>
                            <button
                              onClick={async () => {
                                if (parallelPdfImageB) setParallelCapturedImageB(parallelPdfImageB);
                              }}
                              className="flex items-center gap-1 px-2 py-1.5 bg-blue-600/90 hover:bg-blue-500 text-white rounded-md shadow-lg transition-colors text-xs"
                              title="指示エディタを開く (C)"
                            >
                              <Edit3 size={12} />
                              指示
                            </button>
                          </div>
                        </div>
                      )
                    )}
                  </>
                ) : parallelImageB ? (
                  <>
                    <img
                      src={parallelImageB}
                      alt="B"
                      className="max-w-full max-h-full object-contain shadow-2xl bg-white"
                      draggable={false}
                      style={{ transform: `scale(${parallelZoomB}) translate(${parallelPanB.x / parallelZoomB}px, ${parallelPanB.y / parallelZoomB}px)`, transformOrigin: 'center center' }}
                    />
                    {!isFullscreen && parallelZoomB !== 1 && (
                      <div className="absolute top-2 left-2 px-2 py-1 bg-black/60 text-white text-xs rounded">
                        {Math.round(parallelZoomB * 100)}% (Ctrl+0でリセット)
                      </div>
                    )}
                    {!isFullscreen && (
                      instructionButtonsHidden ? (
                        <button
                          onClick={() => setInstructionButtonsHidden(false)}
                          className="absolute bottom-6 right-2 p-2 text-white/0 hover:text-white/60 hover:bg-black/20 rounded-lg transition-all"
                          title="指示エディタボタンを表示"
                        >
                          <EyeOff size={16} />
                        </button>
                      ) : (
                        <div className="absolute bottom-6 right-2 flex flex-col items-end gap-1">
                          <button
                            onClick={() => setInstructionButtonsHidden(true)}
                            className="p-1 text-white/50 hover:text-white/80 transition-colors"
                            title="指示エディタボタンを非表示"
                          >
                            <Eye size={14} />
                          </button>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleSelectParallelFolder('B'); }}
                              className="flex items-center gap-1 px-2 py-1.5 bg-green-600/90 hover:bg-green-500 text-white rounded-md shadow-lg transition-colors text-xs"
                              title="フォルダを選択して再読み込み"
                            >
                              <Download size={12} />
                              読み込み
                            </button>
                            <button
                              onClick={() => setParallelCapturedImageB(parallelImageB)}
                              className="flex items-center gap-1 px-2 py-1.5 bg-blue-600/90 hover:bg-blue-500 text-white rounded-md shadow-lg transition-colors text-xs"
                              title="指示エディタを開く (C)"
                            >
                              <Edit3 size={12} />
                              指示
                            </button>
                          </div>
                        </div>
                      )
                    )}
                  </>
                ) : parallelLoading ? (
                  <Loader2 size={32} className="animate-spin text-green-400 opacity-50" />
                ) : parallelFilesB.length > 0 ? (
                  <div className="text-neutral-600 text-sm">読み込み中...</div>
                ) : (
                  <div className="text-neutral-600 text-sm flex flex-col items-center gap-3">
                    <div className="flex items-center gap-4 opacity-30">
                      <FolderOpen size={36} />
                      <span className="text-2xl">/</span>
                      <FileText size={36} />
                    </div>
                    <div className="text-center">
                      <div className="mb-2">フォルダまたはPDFをドロップ</div>
                      <div className="flex gap-2 justify-center">
                        <button
                          onClick={() => handleSelectParallelFolder('B')}
                          className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700/50 rounded text-xs transition"
                        >
                          フォルダ選択
                        </button>
                        <button
                          onClick={() => handleSelectParallelPdf('B')}
                          className="px-3 py-1.5 bg-green-900/50 hover:bg-green-800 rounded text-xs transition text-green-300"
                        >
                          PDF選択
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ヘルプパネル（document.body portal） */}
          {!isFullscreen && showHelp && helpAnchor && createPortal(
            <>
              <div className="fixed inset-0 z-[60]" onClick={() => setShowHelp(false)} />
              <div
                className="fixed z-[70] bg-neutral-800/95 backdrop-blur-md border border-white/[0.10] rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.5)] p-4 text-sm min-w-64"
                style={{ top: helpAnchor.top, right: helpAnchor.right }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="text-neutral-200 font-semibold mb-3 flex items-center gap-2">
                  <HelpCircle size={16} /> ショートカット
                </div>
                <div className="space-y-1.5 text-neutral-300">
                  <div className="flex justify-between gap-4"><span className="text-neutral-500 font-mono text-xs">↑ / ↓</span><span>ページ移動</span></div>
                  <div className="flex justify-between gap-4"><span className="text-neutral-500 font-mono text-xs">Home</span><span>最初のページ</span></div>
                  <div className="flex justify-between gap-4"><span className="text-neutral-500 font-mono text-xs">End</span><span>最後のページ</span></div>
                  <div className="flex justify-between gap-4"><span className="text-neutral-500 font-mono text-xs">S</span><span>非同期⇔同期（維持）</span></div>
                  <div className="flex justify-between gap-4"><span className="text-neutral-500 font-mono text-xs">Shift+S</span><span>元に戻して再同期</span></div>
                  <div className="flex justify-between gap-4"><span className="text-neutral-500 font-mono text-xs">← / →</span><span>パネル切替（非同期時）</span></div>
                  <div className="flex justify-between gap-4"><span className="text-neutral-500 font-mono text-xs">C</span><span>指示エディタを開く</span></div>
                  <div className="flex justify-between gap-4"><span className="text-neutral-500 font-mono text-xs">P</span><span>Photoshopで開く</span></div>
                  <div className="flex justify-between gap-4"><span className="text-neutral-500 font-mono text-xs">Q</span><span>MojiQで開く（PDF）</span></div>
                  <div className="flex justify-between gap-4"><span className="text-neutral-500 font-mono text-xs">Ctrl+ホイール</span><span>ズームイン/アウト</span></div>
                  <div className="flex justify-between gap-4"><span className="text-neutral-500 font-mono text-xs">Ctrl + / - / 0</span><span>ズーム / 等倍に戻す</span></div>
                  <div className="flex justify-between gap-4"><span className="text-neutral-500 font-mono text-xs">V</span><span>モード切り替え</span></div>
                </div>
              </div>
            </>,
            document.body,
          )}

          {/* フッター */}
          <div
            data-tauri-drag-region
            className={`bg-neutral-900 border-t border-white/[0.06] flex items-center px-4 text-xs text-neutral-500 justify-between shrink-0 overflow-hidden transition-all duration-300 ease-in-out ${isFullscreen || fullscreenTransitioning ? 'h-0 opacity-0 border-t-0' : 'h-8 opacity-100'}`}
          >
            <div className="flex items-center gap-3">
              {parallelIndexA === parallelIndexB ? (
                <span>#{parallelIndexA + 1}</span>
              ) : (
                <span className="text-orange-400">A:#{parallelIndexA + 1} B:#{parallelIndexB + 1}</span>
              )}
              {parallelFilesA[parallelIndexA] && (
                <span className="text-blue-400">{parallelFilesA[parallelIndexA].name}</span>
              )}
              {parallelFilesB[parallelIndexB] && (
                <span className="text-green-400">{parallelFilesB[parallelIndexB].name}</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="px-2 py-0.5 rounded bg-[rgba(124,184,140,0.08)] text-green-400">
                並列ビュー
              </span>
            </div>
          </div>

          {/* Header.tsx のツールバースロットへ全ボタンを portal で描画 */}
          {headerSlot && createPortal(toolbarContent, headerSlot)}
        </div>
  );
};

export default ParallelViewer;
