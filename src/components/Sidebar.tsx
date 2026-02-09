import React from 'react';
import {
  PanelLeft, PanelLeftClose, Eye, Columns2, HardDrive,
  Settings, ChevronUp, ChevronDown, Target,
  AlertTriangle, CheckCircle, Loader2,
  FolderOpen, FileText,
} from 'lucide-react';
import type { CompareMode, AppMode, FileWithPath, CropBounds, FilePair, ParallelFileEntry, PageCache } from '../types';

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
  setInitialModeSelect: (v: boolean) => void;
  transferDiffToParallelView: () => void;
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
}

// Mode accent color helpers
const modeAccent = {
  'tiff-tiff': { text: 'text-blue-400', bg: 'bg-[rgba(124,156,196,0.12)]', border: 'border-[rgba(124,156,196,0.20)]' },
  'psd-psd': { text: 'text-purple-400', bg: 'bg-[rgba(164,140,196,0.12)]', border: 'border-[rgba(164,140,196,0.20)]' },
  'pdf-pdf': { text: 'text-rose-400', bg: 'bg-[rgba(196,140,156,0.12)]', border: 'border-[rgba(196,140,156,0.20)]' },
  'psd-tiff': { text: 'text-orange-400', bg: 'bg-[rgba(196,164,124,0.12)]', border: 'border-[rgba(196,164,124,0.20)]' },
};

export default function Sidebar({
  isFullscreen,
  fullscreenTransitioning,
  sidebarCollapsed,
  setSidebarCollapsed,
  appMode,
  setAppMode,
  setInitialModeSelect,
  transferDiffToParallelView,
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
}: SidebarProps) {
  // Derived values
  const filteredPairs = filterDiffOnly ? pairs.filter(p => (p.status === 'done' || p.status === 'checked') && p.hasDiff) : pairs;

  const stats = {
    total: pairs.length,
    done: pairs.filter(p => p.status === 'done' || p.status === 'checked').length,
    diff: pairs.filter(p => (p.status === 'done' || p.status === 'checked') && p.hasDiff).length,
    pending: pairs.filter(p => p.status === 'pending' && p.fileA && p.fileB).length
  };

  const currentPair = pairs[selectedIndex];

  // Helper for mode button styling
  const modeButtonClass = (mode: CompareMode) => {
    const accent = modeAccent[mode];
    return compareMode === mode
      ? `${accent.bg} ${accent.text} border ${accent.border}`
      : 'bg-transparent text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.04] border border-transparent';
  };

  return (
        <div className={`bg-neutral-800 border-r border-white/[0.04] shadow-[2px_0_12px_rgba(0,0,0,0.15)] flex flex-col shrink-0 overflow-hidden transition-all duration-300 ease-in-out ${isFullscreen || fullscreenTransitioning ? 'w-0 opacity-0 border-r-0' : sidebarCollapsed ? 'w-10 opacity-100' : 'w-72 opacity-100'}`}>
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
                onClick={() => { setAppMode('diff-check'); setInitialModeSelect(false); }}
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
                }}
                className={`flex-1 flex items-center justify-center gap-1 py-2 text-xs rounded-md transition-all ${
                  appMode === 'parallel-view'
                    ? 'bg-neutral-700 text-neutral-100 shadow-sm'
                    : 'text-neutral-500 hover:text-neutral-300'
                }`}
              >
                <Columns2 size={14} />
                並列ビュー
              </button>
            </div>
            <p className="text-[10px] text-neutral-600 text-center mt-1.5 tracking-wide">Vキーで切り替え</p>
          </div>

          {appMode === 'diff-check' ? (
          <>
          <div className="p-3 border-b border-white/[0.04]">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-neutral-500 tracking-wide">比較モード</span>
              <span className="text-xs text-neutral-600">{stats.done}/{stats.total}</span>
            </div>

            <div className="flex gap-1 mb-3">
              <button onClick={() => handleModeChange('tiff-tiff')} className={`flex-1 text-xs py-1.5 rounded-md transition-all ${modeButtonClass('tiff-tiff')}`}>TIFF</button>
              <button onClick={() => handleModeChange('psd-psd')} className={`flex-1 text-xs py-1.5 rounded-md transition-all ${modeButtonClass('psd-psd')}`}>PSD</button>
              <button onClick={() => handleModeChange('pdf-pdf')} className={`flex-1 text-xs py-1.5 rounded-md transition-all ${modeButtonClass('pdf-pdf')}`}>PDF</button>
              <button onClick={() => handleModeChange('psd-tiff')} className={`flex-1 text-xs py-1.5 rounded-md transition-all ${modeButtonClass('psd-tiff')}`}>混合</button>
            </div>

            <div className="flex gap-2">
              <div className={`flex-1 relative rounded-md transition-colors ${dragOverSide === 'A' ? 'ring-1 ring-blue-400/50 bg-blue-900/20' : ''}`} onDragOver={handleDragOver} onDragEnter={handleDragEnter('A')} onDragLeave={handleDragLeave} onDrop={handleDrop('A')}>
                <button onClick={handleFilesAUpload} className="w-full text-center py-2 bg-neutral-700 hover:bg-neutral-600 rounded-md cursor-pointer text-xs transition-colors">
                  {modeLabels.a} ({filesA.length})
                </button>
                {dragOverSide === 'A' && <div className="absolute inset-0 flex items-center justify-center bg-blue-600/60 rounded-md text-white text-xs font-medium pointer-events-none">ドロップ</div>}
              </div>
              <div className={`flex-1 relative rounded-md transition-colors ${dragOverSide === 'B' ? 'ring-1 ring-green-400/50 bg-green-900/20' : ''}`} onDragOver={handleDragOver} onDragEnter={handleDragEnter('B')} onDragLeave={handleDragLeave} onDrop={handleDrop('B')}>
                <button onClick={handleFilesBUpload} className="w-full text-center py-2 bg-neutral-700 hover:bg-neutral-600 rounded-md cursor-pointer text-xs transition-colors">
                  {modeLabels.b} ({filesB.length})
                </button>
                {dragOverSide === 'B' && <div className="absolute inset-0 flex items-center justify-center bg-green-600/60 rounded-md text-white text-xs font-medium pointer-events-none">ドロップ</div>}
              </div>
            </div>

            <div className="mt-1.5 text-[10px] text-neutral-600 text-center tracking-wide">ファイル/フォルダをドロップ可能</div>

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

            {stats.pending > 0 && <div className="mt-2 w-full bg-white/[0.06] rounded-full h-1"><div className="bg-action h-1 rounded-full transition-all shadow-[0_0_6px_rgba(107,138,255,0.3)]" style={{ width: `${(stats.done / stats.total) * 100}%` }} /></div>}
          </div>

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
              <button key={pair.index} data-index={pair.index} onClick={() => setSelectedIndex(pair.index)} className={`w-full text-left px-3 py-2 border-b border-white/[0.03] transition-colors ${selectedIndex === pair.index ? 'bg-[rgba(107,138,255,0.06)] border-l-2 border-l-action' : 'hover:bg-white/[0.03]'}`}>
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
