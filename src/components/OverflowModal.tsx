import { useState, useRef, useEffect } from 'react';
import { X, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Bill } from '@/lib/billStore';

type ChainItem = {
  billNo: string;
  partyName: string;
  billNetAmt: number;
  lineCutInput: string;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  overflowTotalCollected: number;
  overflowMode: string;
  initialItems: ChainItem[];
  bills: Bill[];
  onSaveAll: (items: ChainItem[]) => Promise<void>;
  overflowSaving: boolean;
};

export default function OverflowModal({
  isOpen,
  onClose,
  overflowTotalCollected,
  overflowMode,
  initialItems,
  bills,
  onSaveAll,
  overflowSaving
}: Props) {
  const [pendingItems, setPendingItems] = useState<ChainItem[]>([]);
  const [nextBillInput, setNextBillInput] = useState('');
  const [nextBillErr, setNextBillErr] = useState('');
  const nextInputRef = useRef<HTMLInputElement>(null);

  // Sync initial items when modal opens
  useEffect(() => {
    if (isOpen) {
      setPendingItems(initialItems);
      setNextBillInput('');
      setNextBillErr('');
      setTimeout(() => nextInputRef.current?.focus(), 150);
    }
  }, [isOpen, initialItems]);

  // Global Escape and '+' listener to close OverflowModal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '+' || e.code === 'NumpadAdd') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Live calculations for each pending item in the chain
  let rem = overflowTotalCollected;
  const processed = pendingItems.map(item => {
    const foundBill = bills.find(b => b.billNo === item.billNo);
    const existingLc = (Number(foundBill?.lineCutAmt) || 0) || (Number(foundBill?.cancelLine) || 0);

    const lineCut = item.lineCutInput !== ''
      ? Math.max(0, Math.min(Number(item.lineCutInput) || 0, item.billNetAmt))
      : (existingLc > 0 ? existingLc : 0);

    const netPayable = Math.max(0, item.billNetAmt - lineCut);
    const applied = Math.min(rem, netPayable);
    rem -= applied;
    return { ...item, lineCut, applied, netPayable };
  });
  const remaining = rem;

  const handleAddNextBill = () => {
    const bn = nextBillInput.trim();
    if (!bn) return;
    
    // Exact or suffix/prefix match
    const foundBill = bills.find(b => b.billNo === bn || b.billNo.endsWith(bn) || bn.endsWith(b.billNo));
    if (!foundBill) {
      setNextBillErr(`Bill "${bn}" not found`);
      return;
    }
    if (pendingItems.some(x => x.billNo === foundBill.billNo)) {
      setNextBillErr('Already in chain');
      return;
    }
    
    setNextBillErr('');
    const existingLc = (Number(foundBill.lineCutAmt) || 0) || (Number(foundBill.cancelLine) || 0);
    const nextLineCut = existingLc > 0 ? String(existingLc) : '0';
    setPendingItems(prev => [
      ...prev, 
      { 
        billNo: foundBill.billNo, 
        partyName: foundBill.partyName, 
        billNetAmt: foundBill.billNetAmt, 
        lineCutInput: nextLineCut 
      }
    ]);
    setNextBillInput('');
    setTimeout(() => nextInputRef.current?.focus(), 50);
  };

  const handleUpdateLineCut = (index: number, val: string) => {
    setPendingItems(prev => prev.map((x, idx) => idx === index ? { ...x, lineCutInput: val } : x));
  };

  const handleRemoveItem = (index: number) => {
    setPendingItems(prev => prev.filter((_, idx) => idx !== index));
    setNextBillErr('');
  };

  return (
    <div 
      className="fixed inset-0 bg-black/70 z-[250] flex items-start justify-center pt-4 px-3 backdrop-blur-sm animate-in fade-in-50 duration-150"
      id="overflow-modal-overlay"
    >
      <div 
        className="bg-card rounded-3xl w-full max-w-sm shadow-2xl border border-border animate-in slide-in-from-top-4 duration-200"
        onClick={e => e.stopPropagation()}
        id="overflow-modal-container"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border/40" id="overflow-header">
          <div>
            <h3 className="font-black text-sm uppercase text-primary">Chain Payment</h3>
            <p className="text-[10px] font-bold text-muted-foreground uppercase mt-0.5">
              Total: <span className="text-primary font-black">₹{overflowTotalCollected.toLocaleString('en-IN')}</span>
              <span className="mx-1.5 text-border">·</span>
              Mode: <span className="text-primary font-black">{overflowMode}</span>
              {remaining > 0 && (
                <>
                  <span className="mx-1.5 text-border">·</span>
                  <span className="text-orange-500 font-black">Rem: ₹{remaining.toLocaleString('en-IN')}</span>
                </>
              )}
            </p>
          </div>
          <button 
            id="overflow-close-btn"
            onClick={onClose} 
            className="p-1.5 rounded-full hover:bg-muted text-muted-foreground cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Pending bills — each with editable line cut + remove button */}
        <div className="px-5 py-3 space-y-2 max-h-60 overflow-y-auto no-scrollbar" id="overflow-items-list">
          {processed.map((item, i) => (
            <div 
              key={item.billNo} 
              className={cn("rounded-xl border p-2.5 space-y-1.5", i === 0 ? "bg-primary/5 border-primary/20" : "bg-orange-50/60 border-orange-200")}
              id={`overflow-item-${item.billNo}`}
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-black uppercase text-foreground">{item.billNo}</p>
                  <p className="text-[8px] text-muted-foreground font-bold truncate uppercase">{item.partyName} · Amt ₹{item.billNetAmt.toLocaleString('en-IN')}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  <div className="text-right">
                    <p className="text-[10px] font-black text-emerald-600">Apply ₹{item.applied.toLocaleString('en-IN')}</p>
                    {item.lineCut > 0 && <p className="text-[9px] font-black text-destructive">Cut ₹{item.lineCut.toLocaleString('en-IN')}</p>}
                  </div>
                  {/* Remove button — only for bills added after the first (first bill is the primary entry) */}
                  {i > 0 && (
                    <button
                      id={`overflow-item-remove-btn-${item.billNo}`}
                      onClick={() => handleRemoveItem(i)}
                      className="w-6 h-6 rounded-full bg-destructive/10 hover:bg-destructive/20 flex items-center justify-center text-destructive ml-0.5 cursor-pointer"
                      title="Remove this bill from chain"
                    >
                      <X className="w-3 h-3 stroke-[3]" />
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[8px] font-black text-muted-foreground uppercase shrink-0">Line Cut:</span>
                <input
                  id={`overflow-item-linecut-input-${item.billNo}`}
                  type="number" 
                  inputMode="numeric"
                  placeholder="0"
                  value={item.lineCutInput}
                  onChange={e => handleUpdateLineCut(i, e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') nextInputRef.current?.focus(); }}
                  className="flex-1 h-7 px-2 bg-card rounded-lg text-[10px] font-black border border-destructive/30 focus:border-destructive outline-none text-center text-destructive"
                />
              </div>
            </div>
          ))}
        </div>

        {/* Next bill input (only if remaining > 0) */}
        <div className="px-5 pb-5 pt-1 space-y-2" id="overflow-actions-container">
          {remaining > 0 && (
            <div>
              <p className="text-[9px] font-black text-orange-600 uppercase mb-1">Baki ₹{remaining.toLocaleString('en-IN')} — Agla Bill No:</p>
              <input
                ref={nextInputRef}
                id="overflow-next-bill-input"
                type="text" 
                inputMode="numeric"
                placeholder="NEXT BILL NO..."
                value={nextBillInput}
                onChange={e => { setNextBillInput(e.target.value); setNextBillErr(''); }}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddNextBill(); } }}
                className={cn(
                  "w-full h-11 px-4 bg-muted rounded-2xl text-sm font-black border-2 outline-none uppercase text-center transition-all", 
                  nextBillErr ? "border-destructive" : "border-border focus:border-primary"
                )}
              />
              {nextBillErr && (
                <p className="text-destructive text-[9px] font-black uppercase mt-1 text-center" id="overflow-next-bill-error">
                  {nextBillErr}
                </p>
              )}
              <Button 
                id="overflow-add-bill-btn"
                onClick={handleAddNextBill} 
                disabled={!nextBillInput.trim()} 
                className="w-full mt-1.5 h-8 rounded-xl font-black uppercase text-[10px] bg-orange-500 hover:bg-orange-600 text-white cursor-pointer"
              >
                Add Bill to Chain
              </Button>
            </div>
          )}
          {remaining <= 0 && (
            <p className="text-[9px] font-black text-emerald-600 uppercase text-center py-1" id="overflow-complete-msg">
              Chain Complete — Ready to Save All
            </p>
          )}
          <div className="flex gap-2 pt-1" id="overflow-final-buttons">
            <Button 
              id="overflow-cancel-btn"
              variant="outline" 
              onClick={onClose} 
              className="flex-1 rounded-2xl font-black uppercase text-[10px] h-11 cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              id="overflow-save-all-btn"
              onClick={() => onSaveAll(pendingItems)}
              disabled={overflowSaving || pendingItems.length === 0}
              className={cn(
                "flex-[2] rounded-2xl font-black uppercase text-[10px] h-11 text-white cursor-pointer", 
                remaining <= 0 ? "bg-emerald-600 hover:bg-emerald-700" : "bg-primary hover:bg-primary/90"
              )}
            >
              {overflowSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" id="overflow-save-all-loader" />
              ) : (
                <>
                  <Check className="w-3.5 h-3.5 mr-1.5" />
                  Save All ({pendingItems.length} Bill{pendingItems.length > 1 ? 's' : ''})
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
