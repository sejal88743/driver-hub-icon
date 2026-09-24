'use client';

import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSelectReason: (reason: string) => void;
  saving: boolean;
};

const REASONS = [
  { num: '1', key: 'No Cash', label: 'NO CASH' },
  { num: '2', key: 'Shop Close', label: 'SHOP CLOSE' },
  { num: '3', key: 'No Order', label: 'NO ORDER' },
] as const;

export default function FbrReasonModal({ isOpen, onClose, onSelectReason, saving }: Props) {
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  // Reset selected index to 0 when opened
  useEffect(() => {
    if (isOpen) {
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Keyboard navigation & direct number shortcuts (1, 2, 3, ArrowUp, ArrowDown, Enter, Esc, +)
  useEffect(() => {
    if (!isOpen || saving) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Direct 1, 2, 3 selection & immediate submit
      if (e.key === '1' || e.code === 'Numpad1') {
        e.preventDefault();
        e.stopPropagation();
        onSelectReason(REASONS[0].key);
        return;
      }
      if (e.key === '2' || e.code === 'Numpad2') {
        e.preventDefault();
        e.stopPropagation();
        onSelectReason(REASONS[1].key);
        return;
      }
      if (e.key === '3' || e.code === 'Numpad3') {
        e.preventDefault();
        e.stopPropagation();
        onSelectReason(REASONS[2].key);
        return;
      }

      // Arrow navigation
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex(prev => (prev + 1) % REASONS.length);
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex(prev => (prev - 1 + REASONS.length) % REASONS.length);
        return;
      }

      // Enter to confirm highlighted selection
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        onSelectReason(REASONS[selectedIndex].key);
        return;
      }

      // Escape or '+' to cancel / close
      if (e.key === 'Escape' || e.key === '+' || e.code === 'NumpadAdd') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, saving, selectedIndex, onSelectReason, onClose]);

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/70 z-[300] flex items-start justify-center pt-4 sm:pt-6 p-4 backdrop-blur-sm overflow-y-auto" 
      onClick={onClose}
      id="fbr-reason-modal-overlay"
    >
      <div 
        className="bg-card rounded-3xl w-full max-w-md mx-4 p-6 shadow-2xl border-2 border-destructive/40 animate-in zoom-in-95 duration-150" 
        onClick={e => e.stopPropagation()}
        id="fbr-reason-modal-container"
      >
        <div className="text-center mb-4">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-2xl bg-destructive/15 text-destructive font-black text-lg mb-2">
            FBR
          </div>
          <h3 className="font-black text-lg uppercase text-destructive tracking-wider" id="fbr-reason-title">
            Select FBR Reason
          </h3>
          <p className="text-[10px] font-black text-muted-foreground uppercase mt-1 tracking-tight" id="fbr-reason-subtitle">
            Press <span className="text-destructive font-black">1</span>, <span className="text-destructive font-black">2</span>, <span className="text-destructive font-black">3</span> or use <span className="text-foreground font-black">↑ ↓</span> & <span className="text-foreground font-black">ENTER</span>
          </p>
        </div>

        <div className="flex flex-col gap-2.5" id="fbr-reasons-list">
          {REASONS.map((item, idx) => {
            const isHighlighted = selectedIndex === idx;
            return (
              <button
                id={`fbr-reason-btn-${item.key.replace(/\s+/g, '-').toLowerCase()}`}
                key={item.key}
                onClick={() => onSelectReason(item.key)}
                onMouseEnter={() => setSelectedIndex(idx)}
                disabled={saving}
                className={cn(
                  "h-14 px-4 rounded-2xl border-2 font-black uppercase text-base tracking-wide transition-all disabled:opacity-50 cursor-pointer flex items-center justify-between text-left",
                  isHighlighted
                    ? "bg-destructive text-white border-destructive shadow-lg scale-[1.02] ring-4 ring-destructive/20"
                    : "bg-destructive/10 border-destructive/30 text-destructive hover:bg-destructive/20 hover:border-destructive/50"
                )}
              >
                <div className="flex items-center gap-3">
                  <span className={cn(
                    "w-7 h-7 rounded-xl flex items-center justify-center font-black text-xs transition-colors",
                    isHighlighted
                      ? "bg-white text-destructive shadow-sm"
                      : "bg-destructive/20 text-destructive border border-destructive/40"
                  )}>
                    {item.num}
                  </span>
                  <span>{item.label}</span>
                </div>
                {saving && isHighlighted ? (
                  <Loader2 className="w-5 h-5 animate-spin" id={`fbr-reason-loader-${item.key.replace(/\s+/g, '-').toLowerCase()}`} />
                ) : (
                  <span className={cn(
                    "text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-lg",
                    isHighlighted ? "bg-white/20 text-white" : "text-muted-foreground"
                  )}>
                    {isHighlighted ? '↵ ENTER' : `KEY [${item.num}]`}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-4 pt-3 border-t border-border flex items-center justify-between">
          <span className="text-[9px] font-black uppercase text-muted-foreground">
            [+] or [ESC] to Cancel
          </span>
          <button 
            id="fbr-reason-cancel-btn"
            onClick={onClose} 
            className="px-4 h-9 rounded-xl border border-border font-black text-[10px] uppercase text-muted-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
