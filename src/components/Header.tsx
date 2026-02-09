import React from 'react';
import { Layers } from 'lucide-react';
import kenpanLogo from '../assets/kenpan_logo.png';

interface HeaderProps {
  isFullscreen: boolean;
  fullscreenTransitioning: boolean;
  onReset: () => void;
  easterEgg?: boolean;
}

const Header: React.FC<HeaderProps> = ({ isFullscreen, fullscreenTransitioning, onReset, easterEgg }) => {
  return (
      <div className={`bg-neutral-900 border-b border-white/[0.06] shadow-[0_1px_3px_rgba(0,0,0,0.3)] flex items-center px-4 gap-4 shrink-0 overflow-hidden transition-all duration-300 ease-in-out ${isFullscreen || fullscreenTransitioning ? 'h-0 opacity-0 border-b-0' : 'h-10 opacity-100'}`}>
        <button
          onClick={onReset}
          className="text-sm font-semibold flex items-center gap-2 text-neutral-300 hover:text-white transition-colors tracking-wide"
          title="初期画面に戻る"
        >
          {easterEgg ? (
            <img src={kenpanLogo} alt="KENPAN" className="h-6 w-6 object-contain" />
          ) : (
            <Layers size={18} className="text-action" />
          )}
          KENBAN
        </button>
        <div className="flex-1" />
        <span className="text-[10px] px-2 py-0.5 rounded-md bg-green-900/30 text-green-400 font-medium tracking-wider uppercase">
          Ready
        </span>
      </div>
  );
};

export default Header;
