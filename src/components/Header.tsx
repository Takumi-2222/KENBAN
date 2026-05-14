import React from 'react';
import { Home } from 'lucide-react';
import kenpanLogo from '../assets/kenpan_logo.png';

interface HeaderProps {
  isFullscreen: boolean;
  fullscreenTransitioning: boolean;
  onReset: () => void;
  easterEgg?: boolean;
  initialModeSelect?: boolean;
}

const Header: React.FC<HeaderProps> = ({ isFullscreen, fullscreenTransitioning, onReset, easterEgg, initialModeSelect }) => {
  const collapsed = isFullscreen || fullscreenTransitioning || initialModeSelect;
  return (
      <div
        data-tauri-drag-region
        className={`bg-neutral-900 border-b border-white/[0.06] shadow-[0_1px_3px_rgba(0,0,0,0.3)] flex items-center px-4 gap-3 shrink-0 transition-all duration-300 ease-in-out ${collapsed ? 'h-0 opacity-0 border-b-0 overflow-hidden' : 'h-11 opacity-100 overflow-visible'}`}
      >
        <button
          onClick={onReset}
          className="p-1.5 text-neutral-400 hover:text-neutral-100 hover:bg-white/[0.06] rounded-md transition-colors shrink-0"
          title="ホームに戻る"
        >
          {easterEgg ? (
            <img src={kenpanLogo} alt="KENPAN" className="h-5 w-5 object-contain" />
          ) : (
            <Home size={18} />
          )}
        </button>
        <div className="w-px h-5 bg-white/[0.08] shrink-0" />
        <div id="header-toolbar-slot" className="flex-1 flex items-center min-w-0" />
      </div>
  );
};

export default Header;
