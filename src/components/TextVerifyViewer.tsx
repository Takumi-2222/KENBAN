import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import {
  ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCcw,
  FileText, CheckCircle, AlertTriangle, Loader2,
  ClipboardPaste, Maximize2, Type, FolderOpen,
  ArrowUp, ArrowDown, SplitSquareVertical, Merge,
  Eye, EyeOff, Pencil, PencilOff, Save, Undo2,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { normalizeTextForComparison, buildUnifiedDiff, CHUNK_BREAK, getMemoTextFromEntry, getPsdTextFromEntry, reconstructMemoFromEntries } from '../utils/textExtract';
import type { UnifiedDiffEntry } from '../utils/textExtract';
import type { TextVerifyPage, DiffPart, ExtractedTextLayer } from '../types';

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
  memoFilePath: string | null;
  hasUnsavedChanges: boolean;
  canUndo: boolean;
  onUpdatePageMemo: (pageIndex: number, newText: string) => void;
  onSaveMemo: () => Promise<boolean>;
  onUndo: () => void;
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
  memoFilePath,
  hasUnsavedChanges,
  canUndo,
  onUpdatePageMemo,
  onSaveMemo,
  onUndo,
}: TextVerifyViewerProps) {
  const [zoom, setZoom] = useState(1);
  const [panPosition, setPanPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [viewMode, setViewMode] = useState<'unified' | 'split' | 'layers'>('unified');
  const [currentDiffIdx, setCurrentDiffIdx] = useState(0);
  const [showHighlights, setShowHighlights] = useState(true);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const [imgNaturalSize, setImgNaturalSize] = useState({ w: 0, h: 0, src: '' });
  const [editingBlockIndex, setEditingBlockIndex] = useState<number | null>(null);
  const [isFullEditing, setIsFullEditing] = useState(false);
  const [isSplitEditing, setIsSplitEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const unifiedScrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cancellingRef = useRef(false);
  const cursorOffsetRef = useRef<number | null>(null);

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

  // 差分のあるテキストレイヤー（画像ハイライト用）
  // computeLineSetDiffと同じ貪欲マッチングで判定（Set判定だと重複行の差分を見逃す）
  const layerDiffMap = useMemo((): (ExtractedTextLayer & { isLineBreakOnly: boolean })[] => {
    if (!currentPage || currentPage.status !== 'done' || !currentPage.memoText) return [];

    const normMemo = normalizeTextForComparison(currentPage.memoText);
    const memoLines = normMemo.split('\n').filter(Boolean);

    // PSD全行をレイヤー紐付きで構築
    const psdLineEntries: { line: string; layerIdx: number }[] = [];
    for (let li = 0; li < currentPage.extractedLayers.length; li++) {
      const lines = normalizeTextForComparison(currentPage.extractedLayers[li].text).split('\n').filter(Boolean);
      for (const line of lines) {
        psdLineEntries.push({ line, layerIdx: li });
      }
    }

    // 貪欲完全一致マッチ（computeLineSetDiff Pass 1 と同ロジック）
    const memoUsed = new Set<number>();
    const psdMatched = new Set<number>();
    for (let i = 0; i < psdLineEntries.length; i++) {
      for (let j = 0; j < memoLines.length; j++) {
        if (!memoUsed.has(j) && psdLineEntries[i].line === memoLines[j]) {
          psdMatched.add(i);
          memoUsed.add(j);
          break;
        }
      }
    }

    // 完全一致しなかったPSD行 → そのレイヤーは差分あり
    const diffLayerIndices = new Set<number>();
    for (let i = 0; i < psdLineEntries.length; i++) {
      if (!psdMatched.has(i)) {
        diffLayerIndices.add(psdLineEntries[i].layerIdx);
      }
    }

    // 各差分レイヤーの改行のみ判定: レイヤーテキスト(改行除去) がメモの連続行(改行除去)と一致するか
    return currentPage.extractedLayers.map((layer, idx) => {
      if (!diffLayerIndices.has(idx)) return null;
      const w = layer.right - layer.left;
      const h = layer.bottom - layer.top;
      if (w <= 0 || h <= 0) return null;

      const layerLines = normalizeTextForComparison(layer.text).split('\n').filter(Boolean);
      const layerJoined = layerLines.join('');
      let isLineBreakOnly = false;
      if (layerJoined.length > 0) {
        for (let start = 0; start < memoLines.length && !isLineBreakOnly; start++) {
          let joined = '';
          for (let end = start; end < memoLines.length; end++) {
            joined += memoLines[end];
            if (joined === layerJoined) { isLineBreakOnly = true; break; }
            if (joined.length >= layerJoined.length) break;
          }
        }
      }

      return { ...layer, isLineBreakOnly };
    }).filter((v): v is ExtractedTextLayer & { isLineBreakOnly: boolean } => v !== null);
  }, [currentPage]);

  // コンテナサイズ追跡（ResizeObserver）
  useEffect(() => {
    const el = imageContainerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(entries => {
      for (const entry of entries) {
        setContainerSize({ w: entry.contentRect.width, h: entry.contentRect.height });
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // 画像表示サイズ計算（object-contain / max-w-full max-h-full と同等）
  const fittedSize = useMemo(() => {
    if (imgNaturalSize.src !== currentPage?.imageSrc) return null;
    const { w: cw, h: ch } = containerSize;
    const { w: nw, h: nh } = imgNaturalSize;
    if (cw <= 0 || ch <= 0 || nw <= 0 || nh <= 0) return null;
    const scale = Math.min(cw / nw, ch / nh, 1);
    return { w: nw * scale, h: nh * scale };
  }, [containerSize, imgNaturalSize, currentPage?.imageSrc]);

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

  const diffCount = useMemo(() => unifiedEntries.filter(e => e.type === 'diff' || e.type === 'linebreak').length, [unifiedEntries]);

  // 差分があるページのインデックスリスト（ページ横断ナビ用）
  const diffPageIndices = useMemo(() => {
    const indices: number[] = [];
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      if (p.status === 'done' && p.diffResult &&
        (p.diffResult.psd.some(d => d.removed && d.value.replace(/\n$/, '') !== CHUNK_BREAK) || p.diffResult.memo.some(d => d.added && d.value.replace(/\n$/, '') !== CHUNK_BREAK))) {
        indices.push(i);
      }
    }
    return indices;
  }, [pages]);

  // 全体での差分ページ数と現在位置
  const globalDiffPos = useMemo(() => {
    const idx = diffPageIndices.indexOf(currentIndex);
    return { current: idx, total: diffPageIndices.length };
  }, [diffPageIndices, currentIndex]);

  // 差分ナビゲーション（ページ内スクロール）
  const scrollToDiff = useCallback((idx: number) => {
    const container = unifiedScrollRef.current;
    if (!container) return;
    const el = container.querySelector(`[data-diff-idx="${idx}"]`) as HTMLElement;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setCurrentDiffIdx(idx);
    }
  }, []);

  // 次の差分へ（ページ内 → ページ横断）
  const goNextDiff = useCallback(() => {
    // ページ内に次の差分があればそこへ
    if (diffCount > 0 && currentDiffIdx < diffCount - 1) {
      scrollToDiff(currentDiffIdx + 1);
      return;
    }
    // 次の差分ページへ移動
    const nextPage = diffPageIndices.find(i => i > currentIndex);
    if (nextPage !== undefined) {
      setCurrentIndex(nextPage);
      setCurrentDiffIdx(0);
    } else if (diffPageIndices.length > 0) {
      // ラップアラウンド: 最初の差分ページへ
      setCurrentIndex(diffPageIndices[0]);
      setCurrentDiffIdx(0);
    }
  }, [currentDiffIdx, diffCount, scrollToDiff, diffPageIndices, currentIndex, setCurrentIndex]);

  // 前の差分へ（ページ内 → ページ横断）
  const goPrevDiff = useCallback(() => {
    // ページ内に前の差分があればそこへ
    if (diffCount > 0 && currentDiffIdx > 0) {
      scrollToDiff(currentDiffIdx - 1);
      return;
    }
    // 前の差分ページへ移動（最後の差分にフォーカス）
    const prevPages = diffPageIndices.filter(i => i < currentIndex);
    if (prevPages.length > 0) {
      setCurrentIndex(prevPages[prevPages.length - 1]);
      setCurrentDiffIdx(-1); // -1 = 最後の差分（レンダー後にスクロール）
    } else if (diffPageIndices.length > 0) {
      // ラップアラウンド: 最後の差分ページへ
      setCurrentIndex(diffPageIndices[diffPageIndices.length - 1]);
      setCurrentDiffIdx(-1);
    }
  }, [currentDiffIdx, diffCount, scrollToDiff, diffPageIndices, currentIndex, setCurrentIndex]);

  // ページ切替後に差分位置へスクロール（-1 = 最後の差分）
  useEffect(() => {
    if (currentDiffIdx === -1 && diffCount > 0) {
      // 少し遅延してDOMレンダー完了後にスクロール
      const timer = setTimeout(() => scrollToDiff(diffCount - 1), 50);
      return () => clearTimeout(timer);
    }
    if (currentDiffIdx === 0 && diffCount > 0) {
      const timer = setTimeout(() => scrollToDiff(0), 50);
      return () => clearTimeout(timer);
    }
  }, [diffCount, currentDiffIdx, scrollToDiff]);

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
      setCurrentDiffIdx(0);
    }
  }, [currentIndex, pages.length, setCurrentIndex]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => (typeof prev === 'number' ? prev - 1 : prev));
      setZoom(1);
      setPanPosition({ x: 0, y: 0 });
      setCurrentDiffIdx(0);
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

  // ダブルクリック位置からテキストオフセットを計算
  const getClickOffset = useCallback((container: HTMLElement): number => {
    const sel = window.getSelection();
    if (!sel || !sel.anchorNode) return 0;
    let offset = 0;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      if (node === sel.anchorNode) {
        return offset + sel.anchorOffset;
      }
      offset += node.textContent?.length || 0;
    }
    return 0;
  }, []);

  // インライン編集開始時にtextareaへフォーカス＋カーソル位置設定
  useEffect(() => {
    if (editingBlockIndex !== null && textareaRef.current) {
      const ta = textareaRef.current;
      ta.focus();
      if (cursorOffsetRef.current !== null) {
        const pos = Math.min(cursorOffsetRef.current, ta.value.length);
        ta.selectionStart = pos;
        ta.selectionEnd = pos;
        cursorOffsetRef.current = null;
      }
    }
  }, [editingBlockIndex]);

  // 統合ビュー: インライン編集確定
  const handleInlineEditConfirm = useCallback(() => {
    if (editingBlockIndex === null) return;
    const origMemoText = getMemoTextFromEntry(unifiedEntries[editingBlockIndex]);
    // 変更がなければ何もしない
    if (editText === origMemoText) {
      setEditingBlockIndex(null);
      return;
    }
    const newMemoText = reconstructMemoFromEntries(unifiedEntries, editingBlockIndex, editText);
    onUpdatePageMemo(currentIndex, newMemoText);
    setEditingBlockIndex(null);
  }, [editingBlockIndex, editText, unifiedEntries, currentIndex, onUpdatePageMemo]);

  // 全体エディタ / 分割エディタの適用
  const handleFullEditApply = useCallback(() => {
    if (!currentPage) return;
    if (editText !== currentPage.memoText) {
      onUpdatePageMemo(currentIndex, editText);
    }
    setIsFullEditing(false);
    setIsSplitEditing(false);
  }, [editText, currentPage, currentIndex, onUpdatePageMemo]);

  // ページ切替時に編集中なら自動適用
  const prevIndexRef = useRef(currentIndex);
  useEffect(() => {
    if (prevIndexRef.current !== currentIndex) {
      // 統合インライン
      if (editingBlockIndex !== null) {
        const origMemoText = getMemoTextFromEntry(unifiedEntries[editingBlockIndex]);
        if (editText !== origMemoText) {
          const newMemoText = reconstructMemoFromEntries(unifiedEntries, editingBlockIndex, editText);
          onUpdatePageMemo(prevIndexRef.current, newMemoText);
        }
        setEditingBlockIndex(null);
      }
      // 全体 / 分割
      if (isFullEditing || isSplitEditing) {
        const prevPage = pages[prevIndexRef.current];
        if (prevPage && editText !== prevPage.memoText) {
          onUpdatePageMemo(prevIndexRef.current, editText);
        }
        // 新ページのテキストで更新
        const newPage = pages[currentIndex];
        if (newPage) setEditText(newPage.memoText);
      }
      prevIndexRef.current = currentIndex;
    }
  }, [currentIndex]);

  // キーボードショートカット
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 編集中のtextarea内のCtrl+Zはブラウザデフォルトに任せる
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        onUndo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        onSaveMemo();
        return;
      }
      if (e.key === 'Escape') {
        if (editingBlockIndex !== null) {
          setEditingBlockIndex(null);
        } else if (isFullEditing) {
          setIsFullEditing(false);
        } else if (isSplitEditing) {
          setIsSplitEditing(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editingBlockIndex, isFullEditing, isSplitEditing, onUndo, onSaveMemo]);

  // textarea自動リサイズ
  useEffect(() => {
    if (textareaRef.current && (editingBlockIndex !== null)) {
      const ta = textareaRef.current;
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
    }
  }, [editText, editingBlockIndex]);

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
      // CHUNK_BREAK センチネルはスペーシングとして表示
      const stripped = part.value.replace(/\n$/, '');
      // ゼロ幅マーカー（changed行判定用）はスキップ
      if (!stripped && (part.added || part.removed)) return null;
      if (stripped === CHUNK_BREAK) {
        return (
          <span key={i} className="flex items-center py-1.5" style={{ display: 'flex' }}>
            <span className="flex-1 h-px" style={{ background: 'linear-gradient(to right, transparent, var(--tv-rule), transparent)' }} />
          </span>
        );
      }
      const isHighlighted = part.added || part.removed;
      if (!isHighlighted) {
        return <span key={i}>{part.value}</span>;
      }
      const isFullLine = part.value.endsWith('\n');
      if (isFullLine) {
        return (
          <span key={i} className="flex items-baseline gap-2" style={{ margin: '1px 0' }}>
            <span style={fullLineStyle}>{stripped}</span>
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
      <div className="flex-1 flex flex-col">
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
                className={`flex-1 border rounded-xl py-40 px-16 min-h-[600px] flex flex-col items-center justify-center transition-all cursor-pointer ${
                  memoRaw
                    ? 'border-solid border-teal-400/30 bg-teal-900/10'
                    : dragOverSide === 'textVerifyMemo'
                      ? 'border-dashed border-teal-400/50 bg-teal-900/15 scale-[1.02]'
                      : 'border-dashed border-white/[0.08] hover:border-white/[0.15] hover:bg-white/[0.02]'
                }`}
              >
                {memoRaw ? (
                  <>
                    <CheckCircle size={36} className="mb-3 text-teal-400/70" />
                    <p className="text-sm font-medium text-teal-300/80">メモ読み込み済み</p>
                    <p className="text-xs text-neutral-500 mt-1">PSDフォルダをドロップして開始</p>
                  </>
                ) : (
                  <>
                    <FileText size={36} className={`mb-3 ${dragOverSide === 'textVerifyMemo' ? 'text-teal-400' : 'text-neutral-600'}`} />
                    <p className={`text-sm font-medium ${dragOverSide === 'textVerifyMemo' ? 'text-teal-300' : 'text-neutral-500'}`}>テキストメモ</p>
                    <p className="text-xs text-neutral-600 mt-1">.txt</p>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
        {/* ステータスバー */}
        <div className="bg-neutral-900 border-t border-white/[0.06] flex items-center px-4 text-xs text-neutral-600 justify-between shrink-0 h-8">
          <div />
          <div className="flex items-center gap-3">
            <span className="px-2 py-0.5 rounded-md bg-[rgba(108,168,168,0.08)] text-teal-400">
              PSD-TEXT
            </span>
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
            {layerDiffMap.length > 0 && (
              <button
                onClick={() => setShowHighlights(prev => !prev)}
                className="p-1 rounded transition-colors"
                style={{
                  background: showHighlights ? 'rgba(194,90,90,0.12)' : 'transparent',
                  color: showHighlights ? 'rgb(248,113,113)' : 'rgb(115,115,130)',
                }}
                title={showHighlights ? '差分ハイライト非表示' : '差分ハイライト表示'}
                onMouseEnter={e => { if (!showHighlights) e.currentTarget.style.color = 'rgb(212,212,216)'; }}
                onMouseLeave={e => { if (!showHighlights) e.currentTarget.style.color = 'rgb(115,115,130)'; }}
              >
                {showHighlights ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
            )}
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
          {/* fittedSize未算出: plain img（onLoadでnaturalSizeを取得） */}
          {currentPage?.imageSrc && !fittedSize && (
            <img
              src={currentPage.imageSrc}
              alt={currentPage.fileName}
              className="max-h-full max-w-full object-contain select-none"
              style={{
                transform: `translate(${panPosition.x}px, ${panPosition.y}px) scale(${zoom})`,
                transformOrigin: 'center center',
              }}
              onLoad={e => {
                setImgNaturalSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight, src: e.currentTarget.src });
                // ResizeObserverが発火していない場合のフォールバック: コンテナサイズを直接測定
                if (imageContainerRef.current) {
                  const rect = imageContainerRef.current.getBoundingClientRect();
                  if (rect.width > 0 && rect.height > 0) {
                    setContainerSize({ w: rect.width, h: rect.height });
                  }
                }
              }}
              draggable={false}
            />
          )}
          {/* fittedSize算出済み: 明示的サイズのラッパーでimg+SVGを重ねる */}
          {currentPage?.imageSrc && fittedSize && (
            <div
              className="relative flex-shrink-0"
              style={{
                width: fittedSize.w,
                height: fittedSize.h,
                transform: `translate(${panPosition.x}px, ${panPosition.y}px) scale(${zoom})`,
                transformOrigin: 'center center',
              }}
            >
              <img
                src={currentPage.imageSrc}
                alt={currentPage.fileName}
                className="w-full h-full select-none"
                onLoad={e => setImgNaturalSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight, src: e.currentTarget.src })}
                draggable={false}
              />
              {showHighlights && layerDiffMap.length > 0 && currentPage.psdWidth > 0 && (
                <svg
                  className="absolute inset-0 w-full h-full pointer-events-none"
                  viewBox={`0 0 ${currentPage.psdWidth} ${currentPage.psdHeight}`}
                  preserveAspectRatio="none"
                >
                  {layerDiffMap.map((layer, i) => (
                    <rect
                      key={i}
                      x={layer.left}
                      y={layer.top}
                      width={layer.right - layer.left}
                      height={layer.bottom - layer.top}
                      fill={layer.isLineBreakOnly ? 'rgba(59,130,246,0.12)' : 'rgba(194,90,90,0.15)'}
                      stroke={layer.isLineBreakOnly ? 'rgba(59,130,246,0.45)' : 'rgba(194,90,90,0.5)'}
                      strokeWidth={Math.max(3, currentPage.psdWidth * 0.002)}
                      rx={4}
                    />
                  ))}
                </svg>
              )}
            </div>
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

        {/* ステータスバー（画像未読込時のみ） */}
        {!currentPage?.imageSrc && (
          <div className="bg-neutral-900 border-t border-white/[0.06] flex items-center px-4 text-xs text-neutral-600 justify-between shrink-0 h-8">
            <div className="flex items-center gap-3">
              {currentPage && (
                <>
                  <span>#{currentIndex + 1}</span>
                  <span className="text-neutral-500 truncate max-w-[200px]">{currentPage.fileName}</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="px-2 py-0.5 rounded-md bg-[rgba(108,168,168,0.08)] text-teal-400">
                PSD-TEXT
              </span>
            </div>
          </div>
        )}
      </div>

      {/* テキスト照合パネル（右側 — Editorial Proofing） */}
      <div className="tv-panel w-[420px] shrink-0 flex flex-col overflow-hidden select-text"
        style={{ background: 'var(--tv-paper)', borderLeft: '1px solid var(--tv-rule-strong)' }}
      >
          {/* アクセントライン */}
          <div className="h-[2px] shrink-0" style={{ background: 'linear-gradient(90deg, var(--tv-accent), transparent)' }} />

          {/* パネルヘッダー */}
          <div className="px-4 py-2.5 flex items-center justify-between shrink-0"
            style={{ background: 'var(--tv-header)', borderBottom: '1px solid var(--tv-rule)' }}
          >
            <span className="flex items-center gap-2">
              <span className="text-[11px] font-semibold tracking-wider"
                style={{ color: 'var(--tv-accent)' }}
              >テキスト照合</span>
              {pages.length > 0 && (
                <span className="text-[10px] tabular-nums"
                  style={{ color: 'var(--tv-ink-tertiary)' }}
                >P{currentIndex + 1}</span>
              )}
            </span>
            <div className="flex items-center gap-2">
              {/* 編集アクション */}
              {memoRaw && currentPage && (
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={onUndo}
                    disabled={!canUndo}
                    className="p-1 rounded transition-all duration-150 disabled:opacity-30 disabled:cursor-default"
                    style={{ color: 'var(--tv-ink-tertiary)' }}
                    title="元に戻す (Ctrl+Z)"
                    onMouseEnter={e => { if (canUndo) { e.currentTarget.style.color = 'var(--tv-accent)'; e.currentTarget.style.background = 'var(--tv-accent-wash)'; } }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--tv-ink-tertiary)'; e.currentTarget.style.background = 'transparent'; }}
                  >
                    <Undo2 size={12} />
                  </button>
                  <button
                    onClick={() => {
                      if (isFullEditing) {
                        handleFullEditApply();
                      } else if (currentPage) {
                        setEditText(currentPage.memoText);
                        setIsFullEditing(true);
                        setIsSplitEditing(false);
                        setEditingBlockIndex(null);
                      }
                    }}
                    className="p-1 rounded transition-all duration-150"
                    style={{
                      color: isFullEditing ? 'var(--tv-accent)' : 'var(--tv-ink-tertiary)',
                      background: isFullEditing ? 'var(--tv-accent-wash)' : 'transparent',
                    }}
                    title={isFullEditing ? '編集を適用' : 'メモ全体を編集'}
                    onMouseEnter={e => { if (!isFullEditing) { e.currentTarget.style.color = 'var(--tv-accent)'; e.currentTarget.style.background = 'var(--tv-accent-wash)'; } }}
                    onMouseLeave={e => { if (!isFullEditing) { e.currentTarget.style.color = 'var(--tv-ink-tertiary)'; e.currentTarget.style.background = 'transparent'; } }}
                  >
                    {isFullEditing ? <PencilOff size={12} /> : <Pencil size={12} />}
                  </button>
                  {memoFilePath && (
                    <button
                      onClick={() => onSaveMemo()}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-all duration-150"
                      style={{
                        color: hasUnsavedChanges ? 'var(--tv-accent)' : 'var(--tv-ink-tertiary)',
                        background: hasUnsavedChanges ? 'var(--tv-accent-wash)' : 'transparent',
                        border: hasUnsavedChanges ? '1px solid rgba(58,112,112,0.2)' : '1px solid transparent',
                      }}
                      title="メモを保存 (Ctrl+S)"
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--tv-accent-wash)'; e.currentTarget.style.color = 'var(--tv-accent)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = hasUnsavedChanges ? 'var(--tv-accent-wash)' : 'transparent'; e.currentTarget.style.color = hasUnsavedChanges ? 'var(--tv-accent)' : 'var(--tv-ink-tertiary)'; }}
                    >
                      <Save size={11} />
                      保存
                      {hasUnsavedChanges && (
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-orange-400" />
                      )}
                    </button>
                  )}
                </div>
              )}
              {/* 統計 */}
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
              <div className="px-3 py-1.5 flex items-center gap-3 shrink-0"
                style={{ background: 'var(--tv-header)', borderBottom: '1px solid var(--tv-rule)' }}
              >
                {/* セグメントコントロール */}
                <div className="flex items-center gap-0.5 p-0.5 rounded-lg"
                  style={{ background: 'rgba(255,255,255,0.04)' }}
                >
                  {([
                    { key: 'unified' as const, icon: <Merge size={11} />, label: '統合' },
                    { key: 'split' as const, icon: <SplitSquareVertical size={11} />, label: '分割' },
                  ] as const).map(tab => {
                    const isActive = viewMode === tab.key;
                    return (
                      <button
                        key={tab.key}
                        onClick={() => setViewMode(tab.key)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium tracking-wide transition-all duration-150"
                        style={{
                          background: isActive ? 'var(--tv-accent-wash)' : 'transparent',
                          color: isActive ? 'var(--tv-accent)' : 'var(--tv-ink-tertiary)',
                          boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.15)' : 'none',
                        }}
                      >
                        {tab.icon}
                        {tab.label}
                      </button>
                    );
                  })}

                  {/* セパレータ */}
                  <div className="w-px h-3 mx-0.5" style={{ background: 'var(--tv-rule)' }} />

                  {/* レイヤー詳細 */}
                  <button
                    onClick={() => setViewMode('layers')}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium tracking-wide transition-all duration-150"
                    style={{
                      background: viewMode === 'layers' ? 'var(--tv-accent-wash)' : 'transparent',
                      color: viewMode === 'layers' ? 'var(--tv-accent)' : 'var(--tv-ink-tertiary)',
                      boxShadow: viewMode === 'layers' ? '0 1px 3px rgba(0,0,0,0.15)' : 'none',
                    }}
                  >
                    <Type size={11} />
                    レイヤー
                  </button>
                </div>

                <div className="flex-1" />

                {/* 差分ナビゲーション（統合ビューのみ） */}
                {viewMode === 'unified' && diffPageIndices.length > 0 && (
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg"
                    style={{
                      background: 'var(--tv-paper-warm)',
                      border: '1px solid var(--tv-rule)',
                    }}
                  >
                    <span className="inline-flex h-1.5 w-1.5 rounded-full shrink-0"
                      style={{ background: '#b84040' }}
                    />
                    <span className="text-[10px] font-semibold tracking-wide"
                      style={{ color: 'var(--tv-ink-tertiary)' }}
                    >差分</span>

                    <div className="w-px h-3" style={{ background: 'var(--tv-rule-strong)' }} />

                    <span className="text-[11px] font-semibold min-w-[28px] text-center tabular-nums"
                      style={{ color: 'var(--tv-ink-secondary)' }}
                    >
                      {globalDiffPos.current >= 0
                        ? <>{globalDiffPos.current + 1}<span style={{ color: 'var(--tv-ink-tertiary)', margin: '0 1px' }}>/</span>{globalDiffPos.total}</>
                        : <>—<span style={{ color: 'var(--tv-ink-tertiary)', margin: '0 1px' }}>/</span>{globalDiffPos.total}</>
                      }
                    </span>

                    <div className="w-px h-3" style={{ background: 'var(--tv-rule-strong)' }} />

                    <button
                      onClick={goPrevDiff}
                      className="p-0.5 rounded transition-all duration-150"
                      style={{ color: 'var(--tv-ink-tertiary)' }}
                      title="前の差分"
                      onMouseEnter={e => { e.currentTarget.style.color = 'var(--tv-accent)'; e.currentTarget.style.background = 'var(--tv-accent-wash)'; }}
                      onMouseLeave={e => { e.currentTarget.style.color = 'var(--tv-ink-tertiary)'; e.currentTarget.style.background = 'transparent'; }}
                    >
                      <ArrowUp size={12} />
                    </button>
                    <button
                      onClick={goNextDiff}
                      className="p-0.5 rounded transition-all duration-150"
                      style={{ color: 'var(--tv-ink-tertiary)' }}
                      title="次の差分"
                      onMouseEnter={e => { e.currentTarget.style.color = 'var(--tv-accent)'; e.currentTarget.style.background = 'var(--tv-accent-wash)'; }}
                      onMouseLeave={e => { e.currentTarget.style.color = 'var(--tv-ink-tertiary)'; e.currentTarget.style.background = 'transparent'; }}
                    >
                      <ArrowDown size={12} />
                    </button>
                  </div>
                )}
              </div>

              {/* 全体エディタモード */}
              {isFullEditing ? (
                <div
                  className="flex-1 flex flex-col overflow-hidden p-3"
                  onBlur={e => {
                    // フォーカスがこのコンテナ外に移った場合に適用して閉じる
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      handleFullEditApply();
                    }
                  }}
                >
                  {currentPage.memoShared && (
                    <div className="mb-2 px-2.5 py-1.5 rounded text-[10px] flex items-center gap-1.5"
                      style={{ color: 'var(--tv-ink-secondary)', background: 'rgba(200,160,60,0.08)', border: '1px solid rgba(200,160,60,0.2)' }}
                    >
                      <AlertTriangle size={10} style={{ color: 'rgba(200,160,60,0.7)' }} />
                      このメモは P{currentPage.memoSharedGroup.join(', P')} で共有されています。変更は全ページに反映されます。
                    </div>
                  )}
                  <textarea
                    ref={textareaRef}
                    value={editText}
                    onChange={e => setEditText(e.target.value)}
                    className="flex-1 w-full resize-none text-[13px] leading-[1.8] font-mono p-3 rounded-md outline-none"
                    style={{
                      background: 'var(--tv-paper-warm)',
                      color: 'var(--tv-ink)',
                      border: '2px solid var(--tv-accent)',
                    }}
                    autoFocus
                    onKeyDown={e => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        handleFullEditApply();
                      }
                    }}
                  />
                  <div className="flex gap-2 mt-2 justify-end shrink-0">
                    <button
                      onClick={() => setIsFullEditing(false)}
                      className="px-3 py-1 rounded text-[11px] font-medium transition-colors"
                      style={{ color: 'var(--tv-ink-secondary)', background: 'rgba(0,0,0,0.04)', border: '1px solid var(--tv-rule)' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.08)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.04)'; }}
                    >
                      キャンセル
                    </button>
                    <button
                      onClick={handleFullEditApply}
                      className="px-3 py-1 rounded text-[11px] font-medium transition-colors"
                      style={{ color: '#fff', background: 'var(--tv-accent)', border: '1px solid var(--tv-accent)' }}
                      onMouseEnter={e => { e.currentTarget.style.opacity = '0.85'; }}
                      onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
                    >
                      適用 <span className="text-[9px] opacity-60 ml-1">Ctrl+Enter</span>
                    </button>
                  </div>
                </div>

              ) : viewMode === 'layers' ? (
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
                            <div className="flex items-start gap-1.5">
                              {hasLayerDiff && <AlertTriangle size={10} className="shrink-0 mt-1.5" style={{ color: 'rgba(194,90,90,0.7)' }} />}
                              {allInMemo && <CheckCircle size={10} className="shrink-0 mt-1.5" style={{ color: 'rgba(60,150,80,0.7)' }} />}
                            <div className="flex-1 text-[13px] whitespace-pre-wrap break-all leading-[1.8]"
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
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

              ) : viewMode === 'unified' ? (
                /* === 統合ビュー === */
                <div ref={unifiedScrollRef} className="flex-1 overflow-y-auto px-4 py-3">
                  {currentPage.memoShared && (
                    <div className="mb-2 px-2.5 py-1 rounded text-[10px]"
                      style={{ color: 'var(--tv-ink-tertiary)', background: 'rgba(108,168,168,0.06)', border: '1px solid rgba(108,168,168,0.12)' }}
                    >
                      {currentPage.memoSharedGroup.join(',') + 'P'} のメモから照合（PSD順で表示）
                    </div>
                  )}
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
                          if (entry.type === 'separator') {
                            return (
                              <div key={i} className="flex items-center py-1.5">
                                <div className="flex-1 h-px" style={{ background: 'linear-gradient(to right, transparent, var(--tv-rule), transparent)' }} />
                              </div>
                            );
                          }
                          if (entry.type === 'match') {
                            if (editingBlockIndex === i) {
                              return (
                                <div key={i}>
                                  {currentPage.memoShared && (
                                    <div className="mb-1 px-2 py-1 rounded text-[10px] flex items-center gap-1"
                                      style={{ color: 'var(--tv-ink-secondary)', background: 'rgba(200,160,60,0.08)', border: '1px solid rgba(200,160,60,0.15)' }}
                                    >
                                      <AlertTriangle size={9} style={{ color: 'rgba(200,160,60,0.7)' }} />
                                      P{currentPage.memoSharedGroup.join(', P')} 共有
                                    </div>
                                  )}
                                  <textarea
                                    ref={textareaRef}
                                    value={editText}
                                    onChange={e => setEditText(e.target.value)}
                                    onBlur={() => { if (cancellingRef.current) { cancellingRef.current = false; return; } handleInlineEditConfirm(); }}
                                    onKeyDown={e => {
                                      if (e.key === 'Escape') { e.preventDefault(); cancellingRef.current = true; setEditingBlockIndex(null); }
                                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleInlineEditConfirm(); }
                                    }}
                                    className="w-full resize-none rounded-md px-2.5 py-1.5 text-[13px] leading-[1.8] font-mono outline-none"
                                    style={{ background: 'var(--tv-paper-warm)', color: 'var(--tv-ink)', border: '2px solid var(--tv-accent)', minHeight: '2em' }}
                                  />
                                </div>
                              );
                            }
                            return (
                              <div key={i}
                                className="whitespace-pre-wrap break-all cursor-text rounded-sm transition-colors duration-100"
                                onDoubleClick={(e) => { cursorOffsetRef.current = getClickOffset(e.currentTarget); const t = getMemoTextFromEntry(entry); if (t !== null) { setEditingBlockIndex(i); setEditText(t); } }}
                                style={{ padding: '0 1px' }}
                                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(58,112,112,0.04)'; }}
                                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                              >
                                {entry.text}
                              </div>
                            );
                          }
                          // 改行変更のみ
                          if (entry.type === 'linebreak') {
                            const idx = diffIdx++;
                            const isCurrent = idx === currentDiffIdx;
                            if (editingBlockIndex === i) {
                              return (
                                <div key={i} className="my-1">
                                  <div className="px-2.5 py-1 rounded-t-md text-[12px] leading-[1.7] whitespace-pre-wrap break-all"
                                    style={{ background: 'rgba(59,130,246,0.06)', color: 'var(--tv-ink-secondary)', border: '2px solid var(--tv-accent)', borderBottom: '1px dashed var(--tv-rule)' }}
                                  >
                                    <span className="text-[9px] font-semibold tracking-wide select-none mr-1.5" style={{ color: 'rgba(59,130,246,0.6)' }}>PSD</span>
                                    {entry.psdText}
                                  </div>
                                  <div className="px-2.5 py-0.5 flex items-center gap-1.5"
                                    style={{ borderLeft: '2px solid var(--tv-accent)', borderRight: '2px solid var(--tv-accent)', background: 'rgba(50,130,70,0.04)', borderTop: '1px dashed var(--tv-rule)' }}
                                  >
                                    <span className="text-[9px] font-semibold tracking-wide select-none" style={{ color: 'rgba(50,130,70,0.55)' }}>メモ</span>
                                    {currentPage.memoShared && (
                                      <span className="text-[9px] flex items-center gap-0.5" style={{ color: 'rgba(200,160,60,0.7)' }}>
                                        <AlertTriangle size={8} />
                                        P{currentPage.memoSharedGroup.join(', P')} 共有
                                      </span>
                                    )}
                                  </div>
                                  <textarea
                                    ref={textareaRef}
                                    value={editText}
                                    onChange={e => setEditText(e.target.value)}
                                    onBlur={() => { if (cancellingRef.current) { cancellingRef.current = false; return; } handleInlineEditConfirm(); }}
                                    onKeyDown={e => {
                                      if (e.key === 'Escape') { e.preventDefault(); cancellingRef.current = true; setEditingBlockIndex(null); }
                                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleInlineEditConfirm(); }
                                    }}
                                    className="w-full resize-none rounded-b-md px-2.5 py-1.5 text-[13px] leading-[1.8] font-mono outline-none"
                                    style={{ background: 'var(--tv-paper-warm)', color: 'var(--tv-ink)', border: '2px solid var(--tv-accent)', borderTop: 'none', minHeight: '2em' }}
                                  />
                                </div>
                              );
                            }
                            return (
                              <div
                                key={i}
                                data-diff-idx={idx}
                                className="my-1 rounded-md overflow-hidden transition-all duration-200 cursor-text"
                                style={{
                                  background: isCurrent ? 'rgba(59,130,246,0.08)' : 'rgba(59,130,246,0.03)',
                                  border: `1px solid ${isCurrent ? 'rgba(59,130,246,0.4)' : 'rgba(59,130,246,0.15)'}`,
                                  boxShadow: isCurrent ? '0 0 0 1px rgba(59,130,246,0.25)' : undefined,
                                }}
                                onDoubleClick={(e) => { cursorOffsetRef.current = getClickOffset(e.currentTarget); const t = getMemoTextFromEntry(entry); if (t !== null) { setEditingBlockIndex(i); setEditText(t); } }}
                              >
                                <div className="px-2.5 pt-1 pb-0" style={{ borderBottom: '1px solid rgba(59,130,246,0.12)' }}>
                                  <span className="flex items-center gap-1 text-[9px] font-semibold tracking-wide select-none" style={{ color: 'rgba(59,130,246,0.6)' }}>
                                    <Type size={10} style={{ color: 'rgb(59,130,246)' }} />
                                    改行変更
                                  </span>
                                </div>
                                <div className="px-2.5 py-1 break-all">
                                  {entry.psdText?.split('\n').map((line, li, arr) => (
                                    <React.Fragment key={li}>
                                      <span>{line}</span>
                                      {li < arr.length - 1 && (
                                        <>
                                          <span className="select-none" style={{ color: 'rgb(59,130,246)', fontSize: '0.7em', opacity: 0.5 }}> {'↵'}</span>
                                          <br />
                                        </>
                                      )}
                                    </React.Fragment>
                                  ))}
                                  <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold tracking-wide select-none ml-1.5 align-baseline" style={{ color: 'rgba(59,130,246,0.55)' }}>PSD</span>
                                </div>
                                <div className="px-2.5 py-1 break-all" style={{ borderTop: '1px dashed rgba(59,130,246,0.15)' }}>
                                  {entry.memoText?.split('\n').map((line, li, arr) => (
                                    <React.Fragment key={li}>
                                      <span>{line}</span>
                                      {li < arr.length - 1 && (
                                        <>
                                          <span className="select-none" style={{ color: 'rgb(59,130,246)', fontSize: '0.7em', opacity: 0.5 }}> {'↵'}</span>
                                          <br />
                                        </>
                                      )}
                                    </React.Fragment>
                                  ))}
                                  <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold tracking-wide select-none ml-1.5 align-baseline" style={{ color: 'rgba(59,130,246,0.55)' }}>メモ</span>
                                </div>
                              </div>
                            );
                          }
                          const idx = diffIdx++;
                          const isCurrent = idx === currentDiffIdx;
                          if (editingBlockIndex === i) {
                            const psdRef = getPsdTextFromEntry(entry);
                            return (
                              <div key={i} className="my-1">
                                {psdRef && (
                                  <div className="px-2.5 py-1 rounded-t-md text-[12px] leading-[1.7] whitespace-pre-wrap break-all"
                                    style={{ background: 'rgba(194,90,90,0.06)', color: 'var(--tv-ink-secondary)', border: '2px solid var(--tv-accent)', borderBottom: '1px dashed var(--tv-rule)' }}
                                  >
                                    <span className="text-[9px] font-semibold tracking-wide select-none mr-1.5" style={{ color: 'rgba(160,70,70,0.6)' }}>PSD</span>
                                    {psdRef}
                                  </div>
                                )}
                                <div className="px-2.5 py-0.5 flex items-center gap-1.5"
                                  style={{ borderLeft: '2px solid var(--tv-accent)', borderRight: '2px solid var(--tv-accent)', background: 'rgba(50,130,70,0.04)', borderTop: '1px dashed var(--tv-rule)' }}
                                >
                                  <span className="text-[9px] font-semibold tracking-wide select-none" style={{ color: 'rgba(50,130,70,0.55)' }}>メモ</span>
                                  {currentPage.memoShared && (
                                    <span className="text-[9px] flex items-center gap-0.5" style={{ color: 'rgba(200,160,60,0.7)' }}>
                                      <AlertTriangle size={8} />
                                      P{currentPage.memoSharedGroup.join(', P')} 共有
                                    </span>
                                  )}
                                </div>
                                <textarea
                                  ref={textareaRef}
                                  value={editText}
                                  onChange={e => setEditText(e.target.value)}
                                  onBlur={() => { if (cancellingRef.current) { cancellingRef.current = false; return; } handleInlineEditConfirm(); }}
                                  onKeyDown={e => {
                                    if (e.key === 'Escape') { e.preventDefault(); cancellingRef.current = true; setEditingBlockIndex(null); }
                                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleInlineEditConfirm(); }
                                  }}
                                  className={`w-full resize-none px-2.5 py-1.5 text-[13px] leading-[1.8] font-mono outline-none ${psdRef ? 'rounded-b-md' : 'rounded-md'}`}
                                  style={{ background: 'var(--tv-paper-warm)', color: 'var(--tv-ink)', border: '2px solid var(--tv-accent)', borderTop: 'none', minHeight: '2em' }}
                                />
                              </div>
                            );
                          }
                          return (
                            <div
                              key={i}
                              data-diff-idx={idx}
                              className={`my-1 rounded-md overflow-hidden transition-all duration-200${entry.memoParts ? ' cursor-text' : ''}`}
                              style={{
                                background: isCurrent ? 'rgba(210,170,80,0.10)' : 'var(--tv-paper-warm)',
                                border: `1px solid ${isCurrent ? 'rgba(200,160,60,0.5)' : 'var(--tv-rule)'}`,
                                boxShadow: isCurrent ? '0 0 0 1px rgba(200,160,60,0.35), 0 1px 4px rgba(200,160,60,0.12)' : undefined,
                              }}
                              onDoubleClick={entry.memoParts ? (e) => { cursorOffsetRef.current = getClickOffset(e.currentTarget); const t = getMemoTextFromEntry(entry); if (t !== null) { setEditingBlockIndex(i); setEditText(t); } } : undefined}
                            >
                              {/* 差分ヘッダー */}
                              <div className="px-2.5 pt-1 pb-0"
                                style={{ borderBottom: '1px solid var(--tv-rule)' }}
                              >
                                <span className="flex items-center gap-1 text-[9px] font-semibold tracking-wide select-none"
                                  style={{ color: entry.psdParts && entry.memoParts ? 'var(--tv-ink-tertiary)' : !entry.memoParts ? 'rgba(160,70,70,0.6)' : 'rgba(50,130,70,0.6)' }}
                                >
                                  <AlertTriangle size={10} className="text-red-400" />
                                  {entry.psdParts && entry.memoParts ? '文字差分あり' : !entry.memoParts ? 'PSDのみ' : 'メモのみ'}
                                </span>
                              </div>
                              {entry.psdParts && (
                                <div className="px-2.5 py-1 whitespace-pre-wrap break-all"
                                >
                                  {entry.psdParts.map((p, pi) =>
                                    !p.value ? null :
                                    p.removed
                                      ? <span key={pi} style={{ background: 'rgba(194,90,90,0.18)', color: '#8a2020', borderRadius: '2px', padding: '0 2px' }}>{p.value}</span>
                                      : <span key={pi}>{p.value}</span>
                                  )}
                                  {entry.memoParts && (
                                    <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold tracking-wide select-none ml-1.5 align-baseline"
                                      style={{ color: 'rgba(160,70,70,0.55)' }}
                                    >PSD</span>
                                  )}
                                </div>
                              )}
                              {entry.memoParts && (
                                <div className="px-2.5 py-1 whitespace-pre-wrap break-all"
                                  style={{ borderTop: entry.psdParts ? '1px dashed var(--tv-rule)' : undefined }}
                                >
                                  {entry.memoParts.map((p, mi) =>
                                    !p.value ? null :
                                    p.added
                                      ? <span key={mi} style={{ background: 'rgba(60,150,80,0.16)', color: '#1a6030', borderRadius: '2px', padding: '0 2px' }}>{p.value}</span>
                                      : <span key={mi}>{p.value}</span>
                                  )}
                                  {entry.psdParts && (
                                    <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold tracking-wide select-none ml-1.5 align-baseline"
                                      style={{ color: 'rgba(50,130,70,0.55)' }}
                                    >メモ</span>
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
                    <div
                      className="flex-1 overflow-y-auto px-4 py-3 cursor-text"
                      onDoubleClick={() => {
                        if (!isSplitEditing && currentPage?.memoText) {
                          setIsSplitEditing(true);
                          setEditText(currentPage.memoText);
                        }
                      }}
                    >
                      {isSplitEditing ? (
                        <div className="flex flex-col h-full">
                          {currentPage.memoShared && (
                            <div className="mb-2 px-2.5 py-1.5 rounded text-[10px] flex items-center gap-1.5"
                              style={{ color: 'var(--tv-ink-secondary)', background: 'rgba(200,160,60,0.08)', border: '1px solid rgba(200,160,60,0.2)' }}
                            >
                              <AlertTriangle size={10} style={{ color: 'rgba(200,160,60,0.7)' }} />
                              P{currentPage.memoSharedGroup.join(', P')} で共有 — 変更は全ページに反映
                            </div>
                          )}
                          <textarea
                            ref={textareaRef}
                            value={editText}
                            onChange={e => setEditText(e.target.value)}
                            className="flex-1 w-full resize-none text-[13px] leading-[1.8] font-mono p-2 rounded-md outline-none"
                            style={{ background: 'var(--tv-paper-warm)', color: 'var(--tv-ink)', border: '2px solid var(--tv-accent)' }}
                            autoFocus
                            onKeyDown={e => {
                              if (e.key === 'Escape') { e.preventDefault(); setIsSplitEditing(false); }
                              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onUpdatePageMemo(currentIndex, editText); setIsSplitEditing(false); }
                            }}
                          />
                          <div className="flex gap-2 mt-2 justify-end">
                            <button
                              onClick={() => setIsSplitEditing(false)}
                              className="px-3 py-1 rounded text-[11px] font-medium transition-colors"
                              style={{ color: 'var(--tv-ink-secondary)', background: 'rgba(0,0,0,0.04)', border: '1px solid var(--tv-rule)' }}
                              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.08)'; }}
                              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.04)'; }}
                            >
                              キャンセル
                            </button>
                            <button
                              onClick={() => { onUpdatePageMemo(currentIndex, editText); setIsSplitEditing(false); }}
                              className="px-3 py-1 rounded text-[11px] font-medium transition-colors"
                              style={{ color: '#fff', background: 'var(--tv-accent)', border: '1px solid var(--tv-accent)' }}
                              onMouseEnter={e => { e.currentTarget.style.opacity = '0.85'; }}
                              onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
                            >
                              適用 <span className="text-[9px] opacity-60 ml-1">Ctrl+Enter</span>
                            </button>
                          </div>
                        </div>
                      ) : !currentPage.memoText ? (
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
