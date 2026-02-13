import React, { useState, useRef, useCallback, useMemo } from 'react';
import {
  ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCcw,
  FileText, CheckCircle, AlertTriangle, Loader2,
  ClipboardPaste, Maximize2, Type, FolderOpen,
  ArrowUp, ArrowDown, SplitSquareVertical, Merge,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { normalizeTextForComparison, buildUnifiedDiff } from '../utils/textExtract';
import type { UnifiedDiffEntry } from '../utils/textExtract';
import type { TextVerifyPage, DiffPart } from '../types';

interface TextVerifyViewerProps {
  pages: TextVerifyPage[];
  currentIndex: number;
  setCurrentIndex: (v: number | ((prev: number) => number)) => void;
  memoRaw: string;
  toggleFullscreen: () => void;
  onPasteMemo: (text: string) => void;
  dropPsdRef: React.RefObject<HTMLDivElement | null>;
  dropMemoRef: React.RefObject<HTMLDivElement | null>;
  dragOverSide: string | null;
  onSelectFolder: () => void;
  onSelectMemo: () => void;
}

export default function TextVerifyViewer({
  pages,
  currentIndex,
  setCurrentIndex,
  memoRaw,
  toggleFullscreen,
  onPasteMemo,
  dropPsdRef,
  dropMemoRef,
  dragOverSide,
  onSelectFolder,
  onSelectMemo,
}: TextVerifyViewerProps) {
  const [zoom, setZoom] = useState(1);
  const [panPosition, setPanPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [showLayers, setShowLayers] = useState(false);
  const [viewMode, setViewMode] = useState<'split' | 'unified'>('unified');
  const [currentDiffIdx, setCurrentDiffIdx] = useState(0);
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const unifiedScrollRef = useRef<HTMLDivElement>(null);

  const currentPage = pages[currentIndex] || null;

  // 統計
  const stats = useMemo(() => {
    let matched = 0;
    let mismatched = 0;
    let pending = 0;
    for (const p of pages) {
      if (p.status === 'done') {
        if (p.diffResult && !p.diffResult.psd.some(d => d.removed) && !p.diffResult.memo.some(d => d.added)) {
          matched++;
        } else if (p.diffResult) {
          mismatched++;
        } else {
          pending++;
        }
      } else if (p.status === 'pending' || p.status === 'loading') {
        pending++;
      }
    }
    return { matched, mismatched, pending, total: pages.length };
  }, [pages]);

  // 差分計算（メモ化）
  const diffResult = useMemo((): { psd: DiffPart[]; memo: DiffPart[] } | null => {
    if (!currentPage || currentPage.status !== 'done') return null;
    if (currentPage.diffResult) return currentPage.diffResult;
    return null;
  }, [currentPage]);

  // ページの差分有無
  const hasDiff = useMemo(() => {
    if (!diffResult) return false;
    return diffResult.psd.some(d => d.removed) || diffResult.memo.some(d => d.added);
  }, [diffResult]);

  // レイヤー別: メモに存在しない行を検出
  const memoLinesSet = useMemo(() => {
    if (!currentPage?.memoText) return new Set<string>();
    const normalized = normalizeTextForComparison(currentPage.memoText);
    return new Set(normalized.split('\n').filter(Boolean));
  }, [currentPage?.memoText]);

  // Photoshopで開く
  const openInPhotoshop = useCallback(() => {
    if (currentPage?.filePath) {
      invoke('open_file_with_default_app', { path: currentPage.filePath });
    }
  }, [currentPage?.filePath]);

  // 統合ビュー用データ
  const unifiedEntries = useMemo((): UnifiedDiffEntry[] => {
    if (!diffResult) return [];
    return buildUnifiedDiff(diffResult.psd, diffResult.memo);
  }, [diffResult]);

  const diffCount = useMemo(() => unifiedEntries.filter(e => e.type === 'diff').length, [unifiedEntries]);

  // 差分ナビゲーション
  const scrollToDiff = useCallback((idx: number) => {
    const container = unifiedScrollRef.current;
    if (!container) return;
    const el = container.querySelector(`[data-diff-idx="${idx}"]`) as HTMLElement;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setCurrentDiffIdx(idx);
    }
  }, []);

  const goNextDiff = useCallback(() => {
    if (diffCount === 0) return;
    const next = currentDiffIdx < diffCount - 1 ? currentDiffIdx + 1 : 0;
    scrollToDiff(next);
  }, [currentDiffIdx, diffCount, scrollToDiff]);

  const goPrevDiff = useCallback(() => {
    if (diffCount === 0) return;
    const prev = currentDiffIdx > 0 ? currentDiffIdx - 1 : diffCount - 1;
    scrollToDiff(prev);
  }, [currentDiffIdx, diffCount, scrollToDiff]);

  // zoom/pan ハンドラ
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY, panX: panPosition.x, panY: panPosition.y };
  }, [panPosition]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setPanPosition({ x: dragStartRef.current.panX + dx, y: dragStartRef.current.panY + dy });
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleDoubleClick = useCallback(() => {
    setZoom(1);
    setPanPosition({ x: 0, y: 0 });
  }, []);

  // ページ送り
  const goNext = useCallback(() => {
    if (currentIndex < pages.length - 1) {
      setCurrentIndex(prev => (typeof prev === 'number' ? prev + 1 : prev));
      setZoom(1);
      setPanPosition({ x: 0, y: 0 });
    }
  }, [currentIndex, pages.length, setCurrentIndex]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => (typeof prev === 'number' ? prev - 1 : prev));
      setZoom(1);
      setPanPosition({ x: 0, y: 0 });
    }
  }, [currentIndex, setCurrentIndex]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+ホイール: ズーム
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom(prev => Math.max(0.1, Math.min(10, prev * delta)));
    } else {
      // ホイール: ページめくり
      e.preventDefault();
      if (e.deltaY > 0) {
        goNext();
      } else {
        goPrev();
      }
    }
  }, [goNext, goPrev]);

  // クリップボードからメモ貼り付け
  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        onPasteMemo(text);
      }
    } catch {
      // Clipboard API失敗時は無視
    }
  }, [onPasteMemo]);

  // 差分テキストのレンダリング
  // diffType: 'tv-diff-remove' (PSD側) or 'tv-diff-add' (メモ側)
  const renderDiffText = useCallback((parts: DiffPart[], diffType: string, missingLabel: string) => {
    const isRemove = diffType === 'tv-diff-remove';
    // インラインハイライト（文字レベル差分）
    const inlineStyle: React.CSSProperties = isRemove
      ? { background: 'rgba(194,90,90,0.18)', color: '#8a2020', borderRadius: '2px', padding: '0 2px' }
      : { background: 'rgba(60,150,80,0.16)', color: '#1a6030', borderRadius: '2px', padding: '0 2px' };
    // 行全体ハイライト（片方にしかない行）
    const fullLineStyle: React.CSSProperties = isRemove
      ? { background: 'rgba(194,90,90,0.10)', color: '#8a2020', borderLeft: '2px solid rgba(194,90,90,0.5)', borderRadius: '0 2px 2px 0', padding: '1px 4px 1px 6px', flex: 1 }
      : { background: 'rgba(60,150,80,0.08)', color: '#1a6030', borderLeft: '2px solid rgba(60,150,80,0.45)', borderRadius: '0 2px 2px 0', padding: '1px 4px 1px 6px', flex: 1 };
    const labelStyle: React.CSSProperties = {
      fontSize: '9px',
      fontWeight: 500,
      letterSpacing: '0.05em',
      textTransform: 'uppercase' as const,
      color: isRemove ? 'rgba(160,70,70,0.6)' : 'rgba(50,130,70,0.6)',
      flexShrink: 0,
      userSelect: 'none',
    };

    return parts.map((part, i) => {
      const isHighlighted = part.added || part.removed;
      if (!isHighlighted) {
        return <span key={i}>{part.value}</span>;
      }
      const isFullLine = part.value.endsWith('\n');
      if (isFullLine) {
        return (
          <span key={i} className="flex items-baseline gap-2" style={{ margin: '1px 0' }}>
            <span style={fullLineStyle}>{part.value.replace(/\n$/, '')}</span>
            <span style={labelStyle}>{missingLabel}</span>
            {'\n'}
          </span>
        );
      }
      return (
        <span key={i} style={inlineStyle}>
          {part.value}
        </span>
      );
    });
  }, []);

  // 空state — ドロップゾーン
  if (pages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center w-full max-w-3xl px-8">
          <Type size={48} className="mb-4 opacity-20 text-neutral-600" />
          <p className="text-neutral-600 mb-6">PSDフォルダとテキストメモをドロップして照合を開始</p>

          <div className="flex gap-4 w-full">
            <div
              ref={dropPsdRef}
              onClick={onSelectFolder}
              className={`flex-1 border border-dashed rounded-xl py-40 px-16 min-h-[600px] flex flex-col items-center justify-center transition-all cursor-pointer ${
                dragOverSide === 'textVerifyPsd'
                  ? 'border-teal-400/50 bg-teal-900/15 scale-[1.02]'
                  : 'border-white/[0.08] hover:border-white/[0.15] hover:bg-white/[0.02]'
              }`}
            >
              <FolderOpen size={36} className={`mb-3 ${dragOverSide === 'textVerifyPsd' ? 'text-teal-400' : 'text-neutral-600'}`} />
              <p className={`text-sm font-medium ${dragOverSide === 'textVerifyPsd' ? 'text-teal-300' : 'text-neutral-500'}`}>PSDフォルダ</p>
              <p className="text-xs text-neutral-600 mt-1">.psd</p>
            </div>

            <div
              ref={dropMemoRef}
              onClick={onSelectMemo}
              className={`flex-1 border border-dashed rounded-xl py-40 px-16 min-h-[600px] flex flex-col items-center justify-center transition-all cursor-pointer ${
                dragOverSide === 'textVerifyMemo'
                  ? 'border-teal-400/50 bg-teal-900/15 scale-[1.02]'
                  : 'border-white/[0.08] hover:border-white/[0.15] hover:bg-white/[0.02]'
              }`}
            >
              <FileText size={36} className={`mb-3 ${dragOverSide === 'textVerifyMemo' ? 'text-teal-400' : 'text-neutral-600'}`} />
              <p className={`text-sm font-medium ${dragOverSide === 'textVerifyMemo' ? 'text-teal-300' : 'text-neutral-500'}`}>テキストメモ</p>
              <p className="text-xs text-neutral-600 mt-1">.txt</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* 画像ビューワー */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* ツールバー */}
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/[0.04] bg-surface-raised">
          {/* ページナビゲーション */}
          <div className="flex items-center gap-2">
            <button
              onClick={goPrev}
              disabled={currentIndex <= 0}
              className="p-1 rounded hover:bg-white/[0.06] text-neutral-400 hover:text-neutral-200 disabled:opacity-30 disabled:cursor-default transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-xs text-neutral-400 min-w-[80px] text-center">
              {currentPage ? `${currentIndex + 1} / ${pages.length}` : '-'}
            </span>
            <button
              onClick={goNext}
              disabled={currentIndex >= pages.length - 1}
              className="p-1 rounded hover:bg-white/[0.06] text-neutral-400 hover:text-neutral-200 disabled:opacity-30 disabled:cursor-default transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {/* ファイル名 + Psボタン */}
          <div className="flex items-center gap-2 text-xs">
            {currentPage && (
              <>
                <span className="text-neutral-500 truncate max-w-[180px]">{currentPage.fileName}</span>
                <button
                  onClick={openInPhotoshop}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-[rgba(108,168,168,0.12)] text-teal-400 hover:bg-[rgba(108,168,168,0.22)] transition-colors"
                  title="Photoshopで開く (P)"
                >
                  Ps
                </button>
              </>
            )}
          </div>

          {/* ズームコントロール */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setZoom(prev => Math.max(0.1, prev * 0.8))}
              className="p-1 rounded hover:bg-white/[0.06] text-neutral-500 hover:text-neutral-300 transition-colors"
              title="縮小"
            >
              <ZoomOut size={14} />
            </button>
            <span className="text-[10px] text-neutral-500 min-w-[36px] text-center">{Math.round(zoom * 100)}%</span>
            <button
              onClick={() => setZoom(prev => Math.min(10, prev * 1.25))}
              className="p-1 rounded hover:bg-white/[0.06] text-neutral-500 hover:text-neutral-300 transition-colors"
              title="拡大"
            >
              <ZoomIn size={14} />
            </button>
            <button
              onClick={handleDoubleClick}
              className="p-1 rounded hover:bg-white/[0.06] text-neutral-500 hover:text-neutral-300 transition-colors"
              title="リセット"
            >
              <RotateCcw size={14} />
            </button>
            <div className="w-px h-4 bg-white/[0.06] mx-1" />
            <button
              onClick={toggleFullscreen}
              className="p-1 rounded hover:bg-white/[0.06] text-neutral-500 hover:text-neutral-300 transition-colors"
              title="全画面"
            >
              <Maximize2 size={14} />
            </button>
          </div>
        </div>

        {/* 画像エリア */}
        <div
          ref={imageContainerRef}
          className="relative flex-1 overflow-hidden bg-surface-base flex items-center justify-center cursor-grab active:cursor-grabbing"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onDoubleClick={handleDoubleClick}
          onWheel={handleWheel}
        >
          {currentPage?.status === 'loading' && (
            <div className="flex flex-col items-center gap-2">
              <Loader2 size={32} className="text-teal-300 animate-spin" />
              <span className="text-xs text-neutral-500">読み込み中...</span>
            </div>
          )}
          {currentPage?.status === 'error' && (
            <div className="flex flex-col items-center gap-2">
              <AlertTriangle size={32} className="text-red-400" />
              <span className="text-xs text-neutral-500">{currentPage.errorMessage || 'エラーが発生しました'}</span>
            </div>
          )}
          {currentPage?.imageSrc && (
            <img
              src={currentPage.imageSrc}
              alt={currentPage.fileName}
              className="max-h-full max-w-full object-contain select-none"
              style={{
                transform: `translate(${panPosition.x}px, ${panPosition.y}px) scale(${zoom})`,
                transformOrigin: 'center center',
              }}
              draggable={false}
            />
          )}
          {currentPage?.status === 'pending' && !currentPage.imageSrc && (
            <div className="text-neutral-600 text-sm">画像未読込</div>
          )}
          {/* 一致/差異オーバーレイアイコン（画像右上） */}
          {currentPage?.status === 'done' && (
            <div className="absolute top-3 right-3 pointer-events-none">
              {hasDiff ? (
                <AlertTriangle size={28} className="text-red-400 drop-shadow-[0_1px_4px_rgba(248,113,113,0.5)]" />
              ) : (
                <CheckCircle size={28} className="text-green-400 drop-shadow-[0_1px_4px_rgba(74,222,128,0.5)]" />
              )}
            </div>
          )}
        </div>
      </div>

      {/* テキスト照合パネル（右側 — Editorial Proofing） */}
      <div className="tv-panel w-[420px] shrink-0 flex flex-col overflow-hidden"
        style={{ background: 'var(--tv-paper)', borderLeft: '1px solid var(--tv-rule-strong)' }}
      >
          {/* アクセントライン */}
          <div className="h-[2px] shrink-0" style={{ background: 'linear-gradient(90deg, var(--tv-accent), transparent)' }} />

          {/* パネルヘッダー */}
          <div className="px-4 py-2.5 flex items-center justify-between shrink-0"
            style={{ background: 'var(--tv-header)', borderBottom: '1px solid var(--tv-rule)' }}
          >
            <span className="text-[11px] font-semibold tracking-wider"
              style={{ color: 'var(--tv-accent)' }}
            >
              テキスト照合
            </span>
            {stats.total > 0 && (
              <div className="flex items-center gap-3 text-[10px]">
                <span className="flex items-center gap-1">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#4a9a5a]" />
                  <span style={{ color: 'var(--tv-ink-secondary)' }}>{stats.matched}</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#c45a5a]" />
                  <span style={{ color: 'var(--tv-ink-secondary)' }}>{stats.mismatched}</span>
                </span>
                {stats.pending > 0 && (
                  <span style={{ color: 'var(--tv-ink-tertiary)' }}>{stats.pending}</span>
                )}
              </div>
            )}
          </div>

          {/* メモ未読込 — ドロップゾーン */}
          {!memoRaw && (
            <div
              ref={dropMemoRef}
              onClick={onSelectMemo}
              className={`flex-1 flex items-center justify-center p-6 cursor-pointer transition-colors duration-200 ${
                dragOverSide === 'textVerifyMemo' ? '' : ''
              }`}
              style={{ background: dragOverSide === 'textVerifyMemo' ? 'var(--tv-accent-wash)' : undefined }}
            >
              <div className="text-center space-y-4 border border-dashed rounded-lg px-8 py-14 w-full transition-colors duration-200"
                style={{
                  borderColor: dragOverSide === 'textVerifyMemo'
                    ? 'var(--tv-accent)' : 'var(--tv-rule-strong)',
                }}
              >
                <FileText size={28} className="mx-auto" style={{
                  color: dragOverSide === 'textVerifyMemo' ? 'var(--tv-accent)' : 'var(--tv-ink-tertiary)'
                }} />
                <p className="text-xs" style={{
                  color: dragOverSide === 'textVerifyMemo' ? 'var(--tv-accent)' : 'var(--tv-ink-tertiary)'
                }}>
                  テキストメモをドロップまたはクリックで選択
                </p>
                <button
                  onClick={(e) => { e.stopPropagation(); handlePaste(); }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded transition-colors duration-150"
                  style={{
                    color: 'var(--tv-ink-secondary)',
                    background: 'var(--tv-accent-wash)',
                    border: '1px solid var(--tv-rule)',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(58,112,112,0.14)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'var(--tv-accent-wash)'; }}
                >
                  <ClipboardPaste size={12} />
                  クリップボードから貼り付け
                </button>
              </div>
            </div>
          )}

          {/* 差分表示 */}
          {memoRaw && currentPage && (
            <div className="flex-1 flex flex-col overflow-hidden">

              {/* ツールバー: ビュー切替 + レイヤー詳細 + 差分ナビ */}
              <div className="px-4 py-1.5 flex items-center gap-2 shrink-0"
                style={{ background: 'var(--tv-header)', borderBottom: '1px solid var(--tv-rule)' }}
              >
                {/* ビュー切替 */}
                <div className="flex rounded overflow-hidden" style={{ border: '1px solid var(--tv-rule)' }}>
                  <button
                    onClick={() => setViewMode('unified')}
                    className="p-1 transition-colors duration-100"
                    style={{
                      background: viewMode === 'unified' ? 'var(--tv-accent-wash)' : 'transparent',
                      color: viewMode === 'unified' ? 'var(--tv-accent)' : 'var(--tv-ink-tertiary)',
                    }}
                    title="統合ビュー"
                  >
                    <Merge size={12} />
                  </button>
                  <button
                    onClick={() => setViewMode('split')}
                    className="p-1 transition-colors duration-100"
                    style={{
                      background: viewMode === 'split' ? 'var(--tv-accent-wash)' : 'transparent',
                      color: viewMode === 'split' ? 'var(--tv-accent)' : 'var(--tv-ink-tertiary)',
                      borderLeft: '1px solid var(--tv-rule)',
                    }}
                    title="分割ビュー"
                  >
                    <SplitSquareVertical size={12} />
                  </button>
                </div>

                {/* レイヤー詳細トグル */}
                <button
                  onClick={() => setShowLayers(!showLayers)}
                  className="text-[10px] px-2 py-0.5 rounded transition-colors duration-150"
                  style={{
                    color: showLayers ? 'var(--tv-accent)' : 'var(--tv-ink-tertiary)',
                    background: showLayers ? 'var(--tv-accent-wash)' : 'transparent',
                  }}
                >
                  レイヤー
                </button>

                <div className="flex-1" />

                {/* 差分ナビゲーション */}
                {diffCount > 0 && (
                  <div className="flex items-center gap-1">
                    <button onClick={goPrevDiff} className="p-0.5 rounded transition-colors"
                      style={{ color: 'var(--tv-ink-tertiary)' }}
                      title="前の差分"
                    >
                      <ArrowUp size={12} />
                    </button>
                    <span className="text-[10px] min-w-[36px] text-center"
                      style={{ color: 'var(--tv-ink-secondary)' }}
                    >
                      {currentDiffIdx + 1}/{diffCount}
                    </span>
                    <button onClick={goNextDiff} className="p-0.5 rounded transition-colors"
                      style={{ color: 'var(--tv-ink-tertiary)' }}
                      title="次の差分"
                    >
                      <ArrowDown size={12} />
                    </button>
                  </div>
                )}
              </div>

              {/* レイヤー詳細表示 */}
              {showLayers ? (
                <div className="flex-1 overflow-y-auto px-4 py-3">
                  {currentPage.status === 'loading' ? (
                    <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--tv-ink-tertiary)' }}>
                      <Loader2 size={12} className="animate-spin" />
                      テキスト抽出中...
                    </div>
                  ) : currentPage.extractedLayers.length === 0 ? (
                    <p className="text-xs" style={{ color: 'var(--tv-ink-tertiary)' }}>テキストレイヤーが見つかりません</p>
                  ) : (
                    <div className="space-y-2">
                      {currentPage.extractedLayers.map((layer, i) => {
                        const layerLines = normalizeTextForComparison(layer.text).split('\n').filter(Boolean);
                        const hasLayerDiff = memoLinesSet.size > 0 && layerLines.some(l => !memoLinesSet.has(l));
                        const allInMemo = memoLinesSet.size > 0 && layerLines.length > 0 && layerLines.every(l => memoLinesSet.has(l));
                        return (
                          <div key={i} className="p-2.5 rounded-md"
                            style={{
                              background: 'var(--tv-paper-warm)',
                              border: `1px solid ${hasLayerDiff ? 'rgba(194,90,90,0.35)' : allInMemo ? 'rgba(60,150,80,0.25)' : 'var(--tv-rule)'}`,
                              borderLeft: hasLayerDiff ? '3px solid rgba(194,90,90,0.5)' : allInMemo ? '3px solid rgba(60,150,80,0.4)' : undefined,
                            }}
                          >
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <span className="text-[10px] truncate flex-1" style={{ color: 'var(--tv-ink-tertiary)' }}>{layer.layerName}</span>
                              {allInMemo && <CheckCircle size={10} style={{ color: 'rgba(60,150,80,0.7)' }} />}
                              {hasLayerDiff && <AlertTriangle size={10} style={{ color: 'rgba(194,90,90,0.7)' }} />}
                            </div>
                            <div className="text-[13px] whitespace-pre-wrap break-all leading-[1.8]"
                              style={{ color: 'var(--tv-ink)' }}
                            >
                              {memoLinesSet.size > 0
                                ? layerLines.map((line, li) => {
                                    const inMemo = memoLinesSet.has(line);
                                    return (
                                      <React.Fragment key={li}>
                                        {li > 0 && '\n'}
                                        {inMemo ? <span>{line}</span> : (
                                          <span style={{ background: 'rgba(194,90,90,0.12)', color: '#8a2020', borderRadius: '2px', padding: '0 2px' }}>{line}</span>
                                        )}
                                      </React.Fragment>
                                    );
                                  })
                                : layer.text}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

              ) : viewMode === 'unified' ? (
                /* === 統合ビュー === */
                <div ref={unifiedScrollRef} className="flex-1 overflow-y-auto px-4 py-3">
                  {currentPage.status === 'loading' ? (
                    <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--tv-ink-tertiary)' }}>
                      <Loader2 size={12} className="animate-spin" />
                      テキスト抽出中...
                    </div>
                  ) : !diffResult && !currentPage.extractedText ? (
                    <p className="text-xs" style={{ color: 'var(--tv-ink-tertiary)' }}>テキストレイヤーが見つかりません</p>
                  ) : !diffResult ? (
                    <div className="text-[13px] whitespace-pre-wrap break-all leading-[1.8]" style={{ color: 'var(--tv-ink)' }}>
                      {currentPage.extractedText}
                    </div>
                  ) : (
                    <div className="text-[13px] leading-[1.8]" style={{ color: 'var(--tv-ink)' }}>
                      {(() => {
                        let diffIdx = 0;
                        return unifiedEntries.map((entry, i) => {
                          if (entry.type === 'match') {
                            return (
                              <div key={i} className="whitespace-pre-wrap break-all">{entry.text}</div>
                            );
                          }
                          const idx = diffIdx++;
                          const isCurrent = idx === currentDiffIdx;
                          return (
                            <div
                              key={i}
                              data-diff-idx={idx}
                              className="my-1 rounded-md overflow-hidden transition-shadow duration-200"
                              style={{
                                background: 'var(--tv-paper-warm)',
                                border: `1px solid ${isCurrent ? 'var(--tv-accent)' : 'var(--tv-rule)'}`,
                                boxShadow: isCurrent ? '0 0 0 1px var(--tv-accent)' : undefined,
                              }}
                            >
                              {entry.psdParts && (
                                <div className="px-2.5 py-1 whitespace-pre-wrap break-all"
                                  style={{ borderLeft: '3px solid rgba(194,90,90,0.5)' }}
                                >
                                  {entry.psdParts.map((p, pi) =>
                                    p.removed
                                      ? <span key={pi} style={{ background: 'rgba(194,90,90,0.18)', color: '#8a2020', borderRadius: '2px', padding: '0 2px' }}>{p.value}</span>
                                      : <span key={pi}>{p.value}</span>
                                  )}
                                </div>
                              )}
                              {entry.memoParts && (
                                <div className="px-2.5 py-1 whitespace-pre-wrap break-all"
                                  style={{ borderLeft: '3px solid rgba(60,150,80,0.45)' }}
                                >
                                  {entry.memoParts.map((p, mi) =>
                                    p.added
                                      ? <span key={mi} style={{ background: 'rgba(60,150,80,0.16)', color: '#1a6030', borderRadius: '2px', padding: '0 2px' }}>{p.value}</span>
                                      : <span key={mi}>{p.value}</span>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        });
                      })()}
                    </div>
                  )}
                </div>

              ) : (
                /* === 分割ビュー === */
                <>
                  {/* PSD抽出テキスト */}
                  <div className="flex-1 flex flex-col min-h-0" style={{ borderBottom: '1px solid var(--tv-rule)' }}>
                    <div className="px-4 py-1 shrink-0" style={{ background: 'var(--tv-header)', borderBottom: '1px solid var(--tv-rule)' }}>
                      <span className="text-[10px] font-medium tracking-wide uppercase" style={{ color: 'var(--tv-ink-tertiary)' }}>PSD</span>
                    </div>
                    <div className="flex-1 overflow-y-auto px-4 py-3">
                      {currentPage.status === 'loading' ? (
                        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--tv-ink-tertiary)' }}>
                          <Loader2 size={12} className="animate-spin" />
                          テキスト抽出中...
                        </div>
                      ) : (
                        <div className="text-[13px] whitespace-pre-wrap break-all leading-[1.8]" style={{ color: 'var(--tv-ink)' }}>
                          {diffResult ? renderDiffText(diffResult.psd, 'tv-diff-remove', 'PSDのみ') : currentPage.extractedText}
                        </div>
                      )}
                    </div>
                  </div>
                  {/* テキストメモ */}
                  <div className="flex-1 flex flex-col min-h-0">
                    <div className="px-4 py-1 shrink-0" style={{ background: 'var(--tv-header)', borderBottom: '1px solid var(--tv-rule)' }}>
                      <span className="text-[10px] font-medium tracking-wide uppercase" style={{ color: 'var(--tv-ink-tertiary)' }}>Memo</span>
                    </div>
                    <div className="flex-1 overflow-y-auto px-4 py-3">
                      {!currentPage.memoText ? (
                        <p className="text-xs" style={{ color: 'var(--tv-ink-tertiary)' }}>
                          このページに対応するメモテキストがありません
                        </p>
                      ) : (
                        <div className="text-[13px] whitespace-pre-wrap break-all leading-[1.8]" style={{ color: 'var(--tv-ink)' }}>
                          {diffResult ? renderDiffText(diffResult.memo, 'tv-diff-add', 'メモのみ') : currentPage.memoText}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
    </div>
  );
}
