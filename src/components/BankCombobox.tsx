import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import type { Bank } from '@/lib/billStore';

type Props = {
  banks: Bank[];
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  onEnterKey?: () => void;   // called when Enter is pressed after a bank is already selected
  onOpenChange?: (open: boolean) => void; // notifies parent of dropdown open/close
};

export default function BankCombobox({
  banks,
  value,
  onChange,
  disabled,
  placeholder = 'BANK',
  className,
  inputRef,
  onEnterKey,
  onOpenChange,
}: Props) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [hiIdx, setHiIdx] = useState(0);
  const localRef = useRef<HTMLInputElement>(null);
  const ref = (inputRef as React.RefObject<HTMLInputElement | null>) ?? localRef;

  // Sync external value → display text (e.g. when form resets)
  useEffect(() => {
    setQuery(value);
  }, [value]);

  function setOpenNotify(val: boolean) {
    setOpen(val);
    onOpenChange?.(val);
  }

  // Show all matching banks when typing; up to 15 suggestions when empty
  // Word-start matches (e.g. "SUT" → "SUTEX") are ranked first, substring matches follow
  const filtered = query.trim()
    ? (() => {
        const q = query.toLowerCase().trim();
        const matches = banks.filter(b => {
          const name = b.name.toLowerCase();
          return name.includes(q) || name.split(/[\s\-\/\.]+/).some(w => w.startsWith(q));
        });
        return matches.sort((a, b) => {
          const aWord = a.name.toLowerCase().split(/[\s\-\/\.]+/).some(w => w.startsWith(q));
          const bWord = b.name.toLowerCase().split(/[\s\-\/\.]+/).some(w => w.startsWith(q));
          return aWord === bWord ? 0 : aWord ? -1 : 1;
        });
      })()
    : banks.slice(0, 15);

  function select(name: string) {
    onChange(name);
    setQuery(name);
    setOpenNotify(false);
  }

  return (
    <div className="relative w-full">
      <input
        ref={ref}
        type="text"
        placeholder={placeholder}
        disabled={disabled}
        value={query}
        autoComplete="off"
        onChange={e => {
          const val = e.target.value;
          setQuery(val);
          onChange(val); // Keep parent in sync immediately so bankName is never blank during typing
          setOpenNotify(true);
          setHiIdx(0);
        }}
        onFocus={() => {
          setOpenNotify(true);
          setHiIdx(0);
        }}
        onBlur={() => {
          // If query has text, commit exact/prefix bank match or typed text to parent
          if (query.trim()) {
            const q = query.toLowerCase().trim();
            const match = banks.find(b => b.name.toLowerCase() === q) ||
                          banks.find(b => b.name.toLowerCase().startsWith(q));
            if (match) {
              onChange(match.name);
              setQuery(match.name);
            } else {
              onChange(query.trim());
            }
          }
          // Delay so onMouseDown in dropdown fires first
          setTimeout(() => setOpenNotify(false), 160);
        }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHiIdx(i => Math.min(i + 1, Math.max(0, filtered.length - 1)));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHiIdx(i => Math.max(i - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (open && filtered.length > 0) {
              const chosen = filtered[hiIdx]?.name ?? query.trim();
              select(chosen);
              setTimeout(() => onEnterKey?.(), 30);
            } else {
              if (query.trim()) {
                const q = query.toLowerCase().trim();
                const match = banks.find(b => b.name.toLowerCase() === q) ||
                              banks.find(b => b.name.toLowerCase().startsWith(q));
                const finalBank = match ? match.name : query.trim();
                onChange(finalBank);
                setQuery(finalBank);
              }
              onEnterKey?.();
            }
          } else if (e.key === 'Escape') {
            // Close own dropdown but don't propagate — parent ESC handler
            // will see bankDropdownOpen=false and can close the modal
            setOpenNotify(false);
          }
        }}
        className={cn(className)}
      />
      {open && filtered.length > 0 && !disabled && (
        <div className="absolute top-full left-0 right-0 mt-0.5 bg-card border border-border rounded-xl shadow-2xl max-h-52 overflow-auto z-[500]">
          {filtered.map((b, i) => (
            <button
              key={b.id}
              type="button"
              onMouseDown={() => select(b.name)}
              className={cn(
                'w-full text-left px-3 py-1.5 text-[10px] font-black uppercase border-b border-border/20 last:border-0 transition-colors',
                hiIdx === i
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-primary/5 text-foreground'
              )}
            >
              {b.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
