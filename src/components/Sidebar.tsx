import React, { useState } from 'react';
import {
  PanelLeft, PanelLeftClose, Eye, Columns2, HardDrive,
  Settings, ChevronUp, ChevronDown, Target,
  AlertTriangle, CheckCircle, Loader2,
  FolderOpen, FileText, Upload, ClipboardPaste, Trash2, Type,
  GitCompare, Palette,
} from 'lucide-react';
import type { CompareMode, AppMode, FileWithPath, CropBounds, FilePair, ParallelFileEntry, PageCache, TextVerifyPage } from '../types';

interface ModeLabels {
  a: string;
  b: string;
  accept: string | { a: string; b: string };
}

interface SidebarProps {
  isFullscreen: boolean;
  fullscreenTransitioning: boolean;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;
  appMode: AppMode;
  setAppMode: (v: AppMode) => void;
  initialModeSelect: boolean;
  setInitialModeSelect: (v: boolean) => void;
  transferDiffToParallelView: () => void;
  transferParallelToDiffView: () => void;
  compareMode: CompareMode;
  modeLabels: ModeLabels;
  filesA: File[];
  filesB: File[];
  pairs: FilePair[];
  selectedIndex: number;
  setSelectedIndex: (v: number) => void;
  cropBounds: CropBounds | null;
  pairingMode: 'order' | 'name';
  setPairingMode: (v: 'order' | 'name') => void;
  filterDiffOnly: boolean;
  setFilterDiffOnly: (v: boolean) => void;
  showMarkers: boolean;
  setShowMarkers: (v: boolean) => void;
  settingsOpen: boolean;
  setSettingsOpen: (v: boolean) => void;
  photoshopPath: string | null;
  handleSelectPhotoshopExecutable: () => void;
  handleClearPhotoshopExecutable: () => void;
  currentPage: number;
  setCurrentPage: (v: number) => void;
  handleModeChange: (mode: CompareMode) => void;
  handleFilesAUpload: () => void;
  handleFilesBUpload: () => void;
  handleDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  handleDragEnter: (side: string) => (e: React.DragEvent<HTMLDivElement>) => void;
  handleDrop: (side: string) => (e: React.DragEvent<HTMLDivElement>) => void;
  handleDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  dragOverSide: string | null;
  setIsGDriveBrowserOpen: (v: boolean) => void;
  diffCache: Record<string, PageCache>;
  pdfComputingPages: Set<string>;
  onClear: () => void;
  parallelFolderA: string | null;
  parallelFolderB: string | null;
  parallelFilesA: ParallelFileEntry[];
  parallelFilesB: ParallelFileEntry[];
  parallelCurrentIndex: number;
  parallelIndexA: number;
  parallelIndexB: number;
  parallelSyncMode: boolean;
  parallelActivePanel: 'A' | 'B';
  setParallelIndexA: (v: number) => void;
  setParallelIndexB: (v: number) => void;
  setParallelCurrentIndex: (v: number) => void;
  handleSelectParallelFolder: (side: 'A' | 'B') => void;
  handleSelectParallelPdf: (side: 'A' | 'B') => void;
  clearParallelView: () => void;
  fileListRef: React.RefObject<HTMLDivElement | null>;
  pageListRef: React.RefObject<HTMLDivElement | null>;
  parallelFileListRef: React.RefObject<HTMLDivElement | null>;
  // テキスト照合モード用
  textVerifyPages: TextVerifyPage[];
  textVerifyCurrentIndex: number;
  setTextVerifyCurrentIndex: (v: number) => void;
  textVerifyMemoRaw: string;
  handleSelectTextVerifyFolder: () => void;
  handleSelectTextVerifyMemo: () => void;
  handlePasteTextVerifyMemo: () => void;
  clearTextVerify: () => void;
  textVerifyFileListRef: React.RefObject<HTMLDivElement | null>;
}

// Mode accent color helpers
const modeAccent: Record<string, { text: string; bg: string; border: string }> = {
  'tiff-tiff': { text: 'text-blue-400', bg: 'bg-[rgba(124,156,196,0.12)]', border: 'border-[rgba(124,156,196,0.20)]' },
  'psd-psd': { text: 'text-purple-400', bg: 'bg-[rgba(164,140,196,0.12)]', border: 'border-[rgba(164,140,196,0.20)]' },
  'pdf-pdf': { text: 'text-rose-400', bg: 'bg-[rgba(196,140,156,0.12)]', border: 'border-[rgba(196,140,156,0.20)]' },
  'psd-tiff': { text: 'text-orange-400', bg: 'bg-[rgba(196,164,124,0.12)]', border: 'border-[rgba(196,164,124,0.20)]' },
  'psd-pdf': { text: 'text-pink-400', bg: 'bg-[rgba(196,124,164,0.12)]', border: 'border-[rgba(196,124,164,0.20)]' },
  'color-mono': { text: 'text-amber-300', bg: 'bg-[rgba(212,180,108,0.12)]', border: 'border-[rgba(212,180,108,0.20)]' },
  'text-verify': { text: 'text-teal-400', bg: 'bg-[rgba(108,168,168,0.12)]', border: 'border-[rgba(108,168,168,0.20)]' },
};

export default function Sidebar({
  isFullscreen,
  fullscreenTransitioning,
  sidebarCollapsed,
  setSidebarCollapsed,
  appMode,
  setAppMode,
  initialModeSelect,
  setInitialModeSelect,
  transferDiffToParallelView,
  transferParallelToDiffView,
  compareMode,
  modeLabels,
  filesA,
  filesB,
  pairs,
  selectedIndex,
  setSelectedIndex,
  cropBounds,
  pairingMode,
  setPairingMode,
  filterDiffOnly,
  setFilterDiffOnly,
  showMarkers,
  setShowMarkers,
  settingsOpen,
  setSettingsOpen,
  photoshopPath,
  handleSelectPhotoshopExecutable,
  handleClearPhotoshopExecutable,
  currentPage,
  setCurrentPage,
  handleModeChange,
  handleFilesAUpload,
  handleFilesBUpload,
  handleDragOver,
  handleDragEnter,
  handleDrop,
  handleDragLeave,
  dragOverSide,
  setIsGDriveBrowserOpen,
  diffCache,
  pdfComputingPages,
  onClear,
  parallelFolderA,
  parallelFolderB,
  parallelFilesA,
  parallelFilesB,
  parallelCurrentIndex: _parallelCurrentIndex,
  parallelIndexA,
  parallelIndexB,
  parallelSyncMode,
  parallelActivePanel,
  setParallelIndexA,
  setParallelIndexB,
  setParallelCurrentIndex,
  handleSelectParallelFolder,
  handleSelectParallelPdf,
  clearParallelView,
  fileListRef,
  pageListRef,
  parallelFileListRef,
  textVerifyPages,
  textVerifyCurrentIndex,
  setTextVerifyCurrentIndex,
  textVerifyMemoRaw,
  handleSelectTextVerifyFolder,
  handleSelectTextVerifyMemo,
  handlePasteTextVerifyMemo,
  clearTextVerify,
  textVerifyFileListRef,
}: SidebarProps) {
  // Derived values
  const filteredPairs = filterDiffOnly ? pairs.filter(p => (p.status === 'done' || p.status === 'checked') && p.hasDiff) : pairs;

  const stats = {
    total: pairs.length,
    done: pairs.filter(p => p.status === 'done' || p.status === 'checked').length,
    diff: pairs.filter(p => (p.status === 'done' || p.status === 'checked') && p.hasDiff).length,
    pending: pairs.filter(p => p.status === 'pending' && p.fileA && p.fileB).length
  };
  const isProcessing = pairs.some(p => {
    if (p.status === 'loading' || p.status === 'checked' || p.status === 'rendering') return true;
    if (p.status === 'pending' && p.fileA && p.fileB && (compareMode !== 'psd-tiff' || cropBounds)) return true;
    return false;
  });

  const currentPair = pairs[selectedIndex];
  const sourceButtonLabel = compareMode === 'psd-pdf' ? 'PSDフォルダ' : modeLabels.a;
  const targetButtonLabel = compareMode === 'psd-pdf' ? 'PDF/画像ファイル' : modeLabels.b;
  const dropHint = compareMode === 'psd-pdf'
    ? 'PSDフォルダ / PDF・画像ファイルをドロップ可能'
    : 'ファイル/フォルダをドロップ可能';
  const [modeMenuOpen, setModeMenuOpen] = useState(false);

  const modeMeta: Record<CompareMode, { label: string; group: string; icon: React.ReactNode }> = {
    'tiff-tiff': { label: 'TIFF', group: '標準比較', icon: <span className="text-[11px] font-semibold">TIFF</span> },
    'psd-psd': { label: 'PSD', group: '標準比較', icon: <span className="text-[11px] font-semibold">PSD</span> },
    'pdf-pdf': { label: 'PDF', group: '標準比較', icon: <FileText size={14} /> },
    'psd-tiff': { label: 'PSD-TIFF', group: '混合・特殊', icon: <GitCompare size={14} /> },
    'psd-pdf': { label: 'PSD↔PDF', group: '混合・特殊', icon: <GitCompare size={14} /> },
    'color-mono': { label: 'カラー/モノクロ', group: '混合・特殊', icon: <Palette size={14} /> },
    'text-verify': { label: 'テキスト照合', group: '照合', icon: <Type size={14} /> },
  };

  const modeGroups: Array<{ title: string; modes: CompareMode[] }> = [
    { title: '標準比較', modes: ['tiff-tiff', 'psd-psd', 'pdf-pdf'] },
    { title: '混合・特殊', modes: ['psd-pdf', 'psd-tiff', 'color-mono'] },
    { title: '照合', modes: ['text-verify'] },
  ];
  const currentModeMeta = modeMeta[compareMode];

  const selectMode = (mode: CompareMode) => {
    handleModeChange(mode);
    setModeMenuOpen(false);
  };

  return (
        <div className={`bg-neutral-800 border-r border-white/[0.04] shadow-[2px_0_12px_rgba(0,0,0,0.15)] flex flex-col shrink-0 overflow-hidden transition-all duration-300 ease-in-out ${isFullscreen || fullscreenTransitioning || initialModeSelect ? 'w-0 opacity-0 border-r-0' : sidebarCollapsed ? 'w-10 opacity-100' : 'w-72 opacity-100'}`}>
          {/* Collapse button */}
          <div className={`flex items-center border-b border-white/[0.04] ${sidebarCollapsed ? 'justify-center p-2' : 'justify-end px-2 py-1'}`}>
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="p-1.5 text-neutral-500 hover:text-neutral-200 hover:bg-white/[0.06] rounded-md transition-colors"
              title={sidebarCollapsed ? 'サイドバーを開く' : 'サイドバーを閉じる'}
            >
              {sidebarCollapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
            </button>
          </div>

          {!sidebarCollapsed && (
          <>
          {/* App mode toggle */}
          <div className="p-3 border-b border-white/[0.04]">
            <div className="flex gap-1 bg-neutral-950 rounded-lg p-0.5">
              <button
                onClick={() => {
                  if (appMode === 'parallel-view') {
                    transferParallelToDiffView();
                  } else {
                    setAppMode('diff-check');
                    setInitialModeSelect(false);
                  }
                }}
                className={`flex-1 flex items-center justify-center gap-1 py-2 text-xs rounded-md transition-all ${
                  appMode === 'diff-check'
                    ? 'bg-neutral-700 text-neutral-100 shadow-sm'
                    : 'text-neutral-500 hover:text-neutral-300'
                }`}
              >
                <Eye size={14} />
                検版
              </button>
              <button
                onClick={() => {
                  if (appMode === 'diff-check') {
                    transferDiffToParallelView();
                  }
                  setAppMode('parallel-view');
                  setInitialModeSelect(false);
                }}
                className={`flex-1 flex items-center justify-center gap-1 py-2 text-xs rounded-md transition-all ${
                  appMode === 'parallel-view'
                    ? 'bg-neutral-700 text-neutral-100 shadow-sm'
                    : 'text-neutral-500 hover:text-neutral-300'
                }`}
              >
                <Columns2 size={14} />
                並列
              </button>
            </div>
          </div>

          {appMode === 'diff-check' ? (
          <>
          <div className="p-3 border-b border-white/[0.04]">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-neutral-500 tracking-wide">比較モード</span>
              {compareMode !== 'text-verify' && <span className="text-xs text-neutral-600">{stats.done}/{stats.total}</span>}
            </div>

            <div className="relative mb-3">
              <button
                onClick={() => setModeMenuOpen(v => !v)}
                className={`w-full min-h-10 px-3 rounded-lg border flex items-center justify-between gap-3 transition-colors ${modeAccent[compareMode].bg} ${modeAccent[compareMode].text} ${modeAccent[compareMode].border} hover:bg-white/[0.06]`}
                title="比較モードを選択"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span className="shrink-0">{currentModeMeta.icon}</span>
                  <span className="truncate text-sm font-semibold">{currentModeMeta.label}</span>
                </span>
                <span className="flex items-center gap-2 shrink-0 text-neutral-500">
                  <span className="text-[10px]">{currentModeMeta.group}</span>
                  <ChevronDown size={14} className={`transition-transform ${modeMenuOpen ? 'rotate-180' : ''}`} />
                </span>
              </button>

              {modeMenuOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setModeMenuOpen(false)} />
                  <div className="absolute left-0 right-0 top-full z-40 mt-2 rounded-lg border border-white/[0.08] bg-neutral-900/95 backdrop-blur-md shadow-[0_12px_36px_rgba(0,0,0,0.45)] p-2">
                    {modeGroups.map((group, groupIndex) => (
                      <div key={group.title} className={groupIndex < modeGroups.length - 1 ? 'mb-2' : ''}>
                        <div className="px-2 pb-1 text-[10px] text-neutral-600 tracking-wide">{group.title}</div>
                        <div className="space-y-1">
                          {group.modes.map(mode => {
                            const meta = modeMeta[mode];
                            const selected = compareMode === mode;
                            const accent = modeAccent[mode];
                            return (
                              <button
                                key={mode}
                                onClick={() => selectMode(mode)}
                                className={`w-full h-9 px-2 rounded-md border flex items-center justify-between gap-2 text-xs transition-colors ${
                                  selected
                                    ? `${accent.bg} ${accent.text} ${accent.border}`
                                    : 'border-transparent text-neutral-400 hover:text-neutral-200 hover:bg-white/[0.04]'
                                }`}
                              >
                                <span className="flex items-center gap-2 min-w-0">
                                  <span className="w-5 flex justify-center shrink-0">{meta.icon}</span>
                                  <span className="truncate font-medium">{meta.label}</span>
                                </span>
                                {selected && <span className="h-1.5 w-1.5 rounded-full bg-current shrink-0" />}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {compareMode === 'text-verify' ? (
              /* テキスト照合モードのコントロール */
              <>
                <div className="space-y-2">
                  <button
                    onClick={handleSelectTextVerifyFolder}
                    className="w-full flex items-center gap-2 py-2 px-3 bg-neutral-700 hover:bg-neutral-600 rounded-md text-xs transition-colors"
                  >
                    <FolderOpen size={14} className="text-teal-300 shrink-0" />
                    <span className="flex-1 text-left truncate">PSDフォルダ</span>
                    <span className="text-neutral-600 shrink-0">({textVerifyPages.length})</span>
                  </button>
                  <div className="flex gap-1">
                    <button
                      onClick={handleSelectTextVerifyMemo}
                      className="flex-1 flex items-center gap-2 py-2 px-3 bg-neutral-700 hover:bg-neutral-600 rounded-l-md text-xs transition-colors"
                    >
                      <Upload size={14} className="text-teal-300 shrink-0" />
                      <span className="flex-1 text-left truncate">{textVerifyMemoRaw ? 'メモ読込済' : 'テキストメモ'}</span>
                    </button>
                    <button
                      onClick={handlePasteTextVerifyMemo}
                      className="py-2 px-2 bg-teal-900/30 hover:bg-teal-900/50 rounded-r-md text-xs transition-colors"
                      title="クリップボードから貼り付け"
                    >
                      <ClipboardPaste size={14} className="text-teal-300" />
                    </button>
                  </div>
                </div>
                {(textVerifyPages.length > 0 || textVerifyMemoRaw) && (
                  <button
                    onClick={clearTextVerify}
                    className="w-full mt-3 py-1 bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded-md text-xs transition-colors flex items-center justify-center gap-1"
                  >
                    <Trash2 size={12} />
                    クリア
                  </button>
                )}
              </>
            ) : (
              /* 通常の差分比較コントロール */
              <>
                <div className="flex gap-2">
                  <div className={`flex-1 relative rounded-md transition-colors ${dragOverSide === 'A' ? 'ring-1 ring-blue-400/50 bg-blue-900/20' : ''}`} onDragOver={handleDragOver} onDragEnter={handleDragEnter('A')} onDragLeave={handleDragLeave} onDrop={handleDrop('A')}>
                    <button onClick={handleFilesAUpload} className="w-full text-center py-2 bg-neutral-700 hover:bg-neutral-600 rounded-md cursor-pointer text-xs transition-colors">
                      {sourceButtonLabel} ({filesA.length})
                    </button>
                    {dragOverSide === 'A' && <div className="absolute inset-0 flex items-center justify-center bg-blue-600/60 rounded-md text-white text-xs font-medium pointer-events-none">ドロップ</div>}
                  </div>
                  <div className={`flex-1 relative rounded-md transition-colors ${dragOverSide === 'B' ? 'ring-1 ring-green-400/50 bg-green-900/20' : ''}`} onDragOver={handleDragOver} onDragEnter={handleDragEnter('B')} onDragLeave={handleDragLeave} onDrop={handleDrop('B')}>
                    <button onClick={handleFilesBUpload} className="w-full text-center py-2 bg-neutral-700 hover:bg-neutral-600 rounded-md cursor-pointer text-xs transition-colors">
                      {targetButtonLabel} ({filesB.length})
                    </button>
                    {dragOverSide === 'B' && <div className="absolute inset-0 flex items-center justify-center bg-green-600/60 rounded-md text-white text-xs font-medium pointer-events-none">ドロップ</div>}
                  </div>
                </div>

                <div className="mt-1.5 text-[10px] text-neutral-600 text-center tracking-wide">{dropHint}</div>

                {/* File name display */}
                {(filesA.length > 0 || filesB.length > 0) && (
                  <div className="mt-2 space-y-1 text-xs">
                    <div className="flex items-center gap-1.5 px-1">
                      <span className="text-blue-400 font-medium shrink-0">A:</span>
                      <span className="text-neutral-300 truncate">
                        {filesA.length > 0 ? ((filesA[0] as FileWithPath).filePath?.split(/[/\\]/).slice(-2, -1)[0] || filesA[0].name) : '-'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 px-1">
                      <span className="text-green-400 font-medium shrink-0">B:</span>
                      <span className="text-neutral-300 truncate">
                        {filesB.length > 0 ? ((filesB[0] as FileWithPath).filePath?.split(/[/\\]/).slice(-2, -1)[0] || filesB[0].name) : '-'}
                      </span>
                    </div>
                  </div>
                )}
              </>
            )}

            {compareMode === 'psd-tiff' && (
              <div className="mt-2 space-y-1">
                <div
                  className={`relative rounded-md transition-colors ${dragOverSide === 'json' ? 'ring-1 ring-orange-400/50 bg-orange-900/20' : ''}`}
                  onDragOver={handleDragOver}
                  onDragEnter={handleDragEnter('json')}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop('json')}
                >
                  <button
                    onClick={() => setIsGDriveBrowserOpen(true)}
                    className="w-full flex items-center justify-center gap-2 py-2 bg-neutral-700 hover:bg-neutral-600 rounded-md cursor-pointer text-xs transition-colors"
                  >
                    <HardDrive size={14} />
                    {cropBounds ? <span className="text-green-400">JSON OK</span> : <span className="text-orange-400">Gドライブ</span>}
                  </button>
                  {dragOverSide === 'json' && <div className="absolute inset-0 flex items-center justify-center bg-orange-600/60 rounded-md text-white text-xs font-medium pointer-events-none">ドロップ</div>}
                </div>
                <p className="text-[10px] text-neutral-600 text-center tracking-wide">JSONドロップも可能</p>
              </div>
            )}

            {compareMode !== 'text-verify' && stats.pending > 0 && <div className="mt-2 w-full bg-white/[0.06] rounded-full h-1"><div className="bg-action h-1 rounded-full transition-all shadow-[0_0_6px_rgba(107,138,255,0.3)]" style={{ width: `${(stats.done / stats.total) * 100}%` }} /></div>}
          </div>

          {compareMode === 'text-verify' ? (
          /* テキスト照合ファイルリスト */
          <div ref={textVerifyFileListRef} className="flex-1 overflow-y-auto">
            {textVerifyPages.length === 0 && (
              <div className="p-4 text-center text-neutral-600 text-xs">PSDフォルダを選択</div>
            )}
            {textVerifyPages.map((page, idx) => {
              const isSelected = textVerifyCurrentIndex === idx;
              const hasDiff = page.diffResult ? (page.diffResult.psd.some(d => d.removed) || page.diffResult.memo.some(d => d.added)) : false;
              return (
                <button
                  key={idx}
                  data-index={idx}
                  onClick={() => setTextVerifyCurrentIndex(idx)}
                  className={`w-full text-left px-3 py-2 border-b border-white/[0.03] transition-colors ${
                    isSelected
                      ? 'bg-[rgba(128,188,188,0.06)] border-l-2 border-l-teal-400'
                      : 'hover:bg-white/[0.03]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-xs truncate ${isSelected ? 'text-teal-300' : 'text-neutral-300'}`}>
                      {page.fileName.replace(/\.psd$/i, '')}
                    </span>
                    {page.status === 'loading' && <Loader2 size={12} className="text-teal-300 animate-spin shrink-0" />}
                    {page.status === 'done' && !hasDiff && <CheckCircle size={12} className="text-green-400 shrink-0" />}
                    {page.status === 'done' && hasDiff && <AlertTriangle size={12} className="text-red-400 shrink-0" />}
                    {page.status === 'error' && <span className="text-xs text-red-400 shrink-0">!</span>}
                    {page.status === 'pending' && !page.memoText && <span className="text-[10px] text-neutral-600 shrink-0">-</span>}
                    {page.status === 'pending' && page.memoText && <span className="text-[10px] text-neutral-600 shrink-0">...</span>}
                  </div>
                </button>
              );
            })}
          </div>
          ) : (
          <>
          <div className="border-b border-white/[0.04]">
            <button onClick={() => setSettingsOpen(!settingsOpen)} className="w-full px-3 py-2 flex items-center justify-between text-xs text-neutral-500 hover:bg-white/[0.04] transition-colors">
              <span className="flex items-center gap-1">
                <Settings size={12} />設定
                {filterDiffOnly && <span className="text-action ml-1">フィルター中</span>}
                {showMarkers && <span className="text-cyan-400 ml-1">マーカーON</span>}
              </span>
              {settingsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {settingsOpen && (
              <div className="px-3 pb-3 space-y-2">
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2 space-y-2">
                  <div className="text-[11px] text-neutral-500">Photoshop実行ファイル</div>
                  <div className="text-[11px] break-all text-neutral-300">
                    {photoshopPath || '未設定: 既定のインストール先を自動探索します'}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={handleSelectPhotoshopExecutable} className="flex-1 py-1 bg-[rgba(164,140,196,0.15)] hover:bg-[rgba(164,140,196,0.25)] text-purple-300 rounded-md text-xs transition-colors">
                      Photoshop.exe を選択
                    </button>
                    {photoshopPath && (
                      <button onClick={handleClearPhotoshopExecutable} className="px-2 py-1 bg-white/[0.06] hover:bg-white/[0.1] text-neutral-300 rounded-md text-xs transition-colors">
                        解除
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex gap-1 bg-neutral-950 rounded-lg p-0.5">
                  <button onClick={() => setPairingMode('order')} className={`flex-1 text-xs py-1 rounded-md transition-all ${pairingMode === 'order' ? 'bg-neutral-700 text-neutral-100 shadow-sm' : 'text-neutral-500 hover:text-neutral-300'}`}>順番でペア</button>
                  <button onClick={() => setPairingMode('name')} className={`flex-1 text-xs py-1 rounded-md transition-all ${pairingMode === 'name' ? 'bg-neutral-700 text-neutral-100 shadow-sm' : 'text-neutral-500 hover:text-neutral-300'}`}>名前でペア</button>
                </div>
                <label className="flex items-center gap-2 text-xs cursor-pointer text-neutral-300">
                  <input type="checkbox" checked={filterDiffOnly} onChange={(e) => setFilterDiffOnly(e.target.checked)} className="rounded w-3 h-3" />
                  差分ありのみ表示
                </label>
                <label className="flex items-center gap-2 text-xs cursor-pointer text-neutral-300">
                  <input type="checkbox" checked={showMarkers} onChange={(e) => setShowMarkers(e.target.checked)} className="rounded w-3 h-3" />
                  <Target size={12} className="text-cyan-400" />
                  差分箇所を丸枠で強調
                </label>
                <button onClick={onClear} className="w-full py-1 bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded-md text-xs transition-colors">クリア</button>
              </div>
            )}
          </div>

          <div ref={fileListRef} className={`overflow-y-auto ${compareMode === 'pdf-pdf' && currentPair?.totalPages && currentPair.totalPages > 1 ? 'shrink-0 max-h-32' : 'flex-1'}`}>
            {pairs.length === 0 && <div className="p-4 text-center text-neutral-600 text-xs">ファイルをアップロード</div>}
            {stats.diff > 0 && <div className="px-3 py-2 bg-red-900/15 text-xs text-red-400 border-b border-white/[0.04]">差分: {stats.diff}件</div>}

            {filteredPairs.map((pair) => (
              <button
                key={pair.index}
                data-index={pair.index}
                onClick={() => setSelectedIndex(pair.index)}
                disabled={isProcessing}
                title={isProcessing ? '解析中はファイル切替できません' : undefined}
                className={`w-full text-left px-3 py-2 border-b border-white/[0.03] transition-colors ${selectedIndex === pair.index ? 'bg-[rgba(107,138,255,0.06)] border-l-2 border-l-action' : 'hover:bg-white/[0.03]'} ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-1 flex-1 min-w-0 mr-2">
                    <span className="text-blue-400 text-[10px] shrink-0">A:</span>
                    <span className="text-xs text-neutral-300 truncate">{pair.nameA?.replace(/\.(psd|tiff?|pdf)/i, '') || '-'}</span>
                  </div>
                  {(pair.status === 'done' || pair.status === 'checked') && (pair.hasDiff ? <AlertTriangle size={12} className="text-red-400 shrink-0" /> : <CheckCircle size={12} className="text-green-400 shrink-0" />)}
                  {(pair.status === 'loading' || pair.status === 'rendering') && <Loader2 size={12} className="text-action animate-spin shrink-0" />}
                  {pair.status === 'pending' && pair.fileA && pair.fileB && <span className="text-xs text-neutral-600 shrink-0">...</span>}
                  {pair.status === 'error' && <span className="text-xs text-red-400 shrink-0">!</span>}
                </div>
                <div className="flex items-center gap-1 min-w-0">
                  <span className="text-green-400 text-[10px] shrink-0">B:</span>
                  <span className="text-xs text-neutral-500 truncate">{pair.nameB?.replace(/\.(psd|tiff?|pdf)/i, '') || '-'}</span>
                </div>
              </button>
            ))}

          </div>

          {/* PDF-PDF mode: page diff list */}
          {compareMode === 'pdf-pdf' && currentPair?.status === 'done' && currentPair.totalPages && currentPair.totalPages > 1 && (
            <div className="flex-1 flex flex-col min-h-0 border-t border-white/[0.06]">
              <div className="px-3 py-2 text-xs text-neutral-500 bg-neutral-800/50 shrink-0 tracking-wide">
                ページ一覧 ({currentPair.totalPages}p)
              </div>
              <div ref={pageListRef} className="flex-1 overflow-y-auto">
                {Array.from({ length: currentPair.totalPages }, (_, i) => i + 1).map(pageNum => {
                  const cacheKey = `${selectedIndex}-${pageNum}`;
                  const pageData = diffCache[cacheKey];
                  const isCurrentPage = currentPage === pageNum;
                  return (
                    <button
                      key={pageNum}
                      data-page={pageNum}
                      onClick={() => setCurrentPage(pageNum)}
                      className={`w-full text-left px-3 py-1.5 text-xs border-b border-white/[0.03] transition-colors flex items-center justify-between ${isCurrentPage ? 'bg-[rgba(196,140,156,0.08)] border-l-2 border-l-rose-400' : 'hover:bg-white/[0.03]'}`}
                    >
                      <span className={isCurrentPage ? 'text-rose-300' : 'text-neutral-500'}>P.{pageNum}</span>
                      {pageData ? (
                        pageData.hasDiff ? <AlertTriangle size={10} className="text-red-400" /> : <CheckCircle size={10} className="text-green-400" />
                      ) : pdfComputingPages.has(cacheKey) ? (
                        <Loader2 size={10} className="text-rose-300 animate-spin" />
                      ) : (
                        <span className="text-neutral-600 text-[10px]">...</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          </>
          )}
          </>
          ) : (
          /* Parallel view mode sidebar */
          <>
          <div className="p-3 border-b border-white/[0.04]">
            <div className="text-xs text-neutral-500 mb-3 tracking-wide">フォルダ / PDF選択</div>
            <div className="space-y-3">
              {/* A side */}
              <div>
                <div className="flex gap-1">
                  <button
                    onClick={() => handleSelectParallelFolder('A')}
                    className="flex-1 min-w-0 flex items-center gap-2 py-2 px-3 bg-neutral-700 hover:bg-neutral-600 rounded-l-md text-xs transition-colors"
                    title="フォルダを選択"
                  >
                    <FolderOpen size={14} className="text-blue-400 shrink-0" />
                    <span className="flex-1 min-w-0 text-left truncate">
                      {parallelFolderA ? parallelFolderA.split(/[/\\]/).pop() : 'A'}
                    </span>
                    <span className="text-neutral-600 shrink-0">({parallelFilesA.length})</span>
                  </button>
                  <button
                    onClick={() => handleSelectParallelPdf('A')}
                    className="py-2 px-2 bg-blue-900/30 hover:bg-blue-900/50 rounded-r-md text-xs transition-colors"
                    title="PDFを選択"
                  >
                    <FileText size={14} className="text-blue-400" />
                  </button>
                </div>
              </div>

              {/* B side */}
              <div>
                <div className="flex gap-1">
                  <button
                    onClick={() => handleSelectParallelFolder('B')}
                    className="flex-1 min-w-0 flex items-center gap-2 py-2 px-3 bg-neutral-700 hover:bg-neutral-600 rounded-l-md text-xs transition-colors"
                    title="フォルダを選択"
                  >
                    <FolderOpen size={14} className="text-green-400 shrink-0" />
                    <span className="flex-1 min-w-0 text-left truncate">
                      {parallelFolderB ? parallelFolderB.split(/[/\\]/).pop() : 'B'}
                    </span>
                    <span className="text-neutral-600 shrink-0">({parallelFilesB.length})</span>
                  </button>
                  <button
                    onClick={() => handleSelectParallelPdf('B')}
                    className="py-2 px-2 bg-green-900/30 hover:bg-green-900/50 rounded-r-md text-xs transition-colors"
                    title="PDFを選択"
                  >
                    <FileText size={14} className="text-green-400" />
                  </button>
                </div>
              </div>
            </div>

            {parallelFilesA.length > 0 || parallelFilesB.length > 0 ? (
              <button
                onClick={clearParallelView}
                className="w-full mt-3 py-1 bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded-md text-xs transition-colors"
              >
                クリア
              </button>
            ) : null}
          </div>

          <div ref={parallelFileListRef} className="flex-1 overflow-y-auto">
            {parallelFilesA.length === 0 && parallelFilesB.length === 0 && (
              <div className="p-4 text-center text-neutral-600 text-xs">フォルダまたはPDFを選択</div>
            )}
            {Array.from({ length: Math.max(parallelFilesA.length, parallelFilesB.length) }).map((_, idx) => {
              const fileA = parallelFilesA[idx];
              const fileB = parallelFilesB[idx];
              const isSelectedA = parallelIndexA === idx;
              const isSelectedB = parallelIndexB === idx;
              const isSelected = isSelectedA || isSelectedB;
              return (
                <button
                  key={idx}
                  data-index={idx}
                  onClick={() => {
                    if (parallelSyncMode) {
                      setParallelIndexA(idx);
                      setParallelIndexB(idx);
                    } else {
                      if (parallelActivePanel === 'A') {
                        setParallelIndexA(idx);
                      } else {
                        setParallelIndexB(idx);
                      }
                    }
                    setParallelCurrentIndex(idx);
                  }}
                  className={`w-full text-left px-3 py-2 border-b border-white/[0.03] transition-colors ${
                    isSelected
                      ? isSelectedA && isSelectedB
                        ? 'bg-[rgba(124,184,140,0.06)] border-l-2 border-l-green-400'
                        : isSelectedA
                          ? 'bg-[rgba(107,138,255,0.06)] border-l-2 border-l-action'
                          : 'bg-[rgba(124,184,140,0.06)] border-l-2 border-l-green-400'
                      : 'hover:bg-white/[0.03]'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-neutral-600 w-8">#{idx + 1}</span>
                    <span className="flex-1 truncate text-neutral-300 mx-2">
                      {fileA?.name || '-'}
                    </span>
                    <span className="flex-1 truncate text-neutral-300 mx-2">
                      {fileB?.name || '-'}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
          </>
          )}
          </>
          )}
        </div>
  );
}
