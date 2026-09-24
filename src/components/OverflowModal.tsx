import { useState, useRef, useEffect } from 'react';
import { X, Check, Loader2, Scissors } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getBills, type Bill } from '@/lib/billStore';

export type ChainItem = {
  billNo: string;
  partyName: string;
  billNetAmt: number;
  lineCutInput: string;
  applied?: number;
  lineCut?: number;
  netPayable?: number;
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

// Robust bill lookup helper
function findBillInList(query: string, billList: Bill[]): Bill | undefined {
  if (!query) return undefined;
  const q = query.toString().trim().toLowerCase();
  if (!q) return undefined;

  const norm = (s: string) => (s || '').toString().toLowerCase()
    .replace(/^gst[-/]?/i, '')
    .replace(/^inv[-/]?/i, '')
    .replace(/^bill[-/]?/i, '')
    .replace(/[^0-9a-z]/g, '')
    .replace(/^0+/, '');

  const getDigits = (s: string) => (s || '').toString().replace(/\D/g, '').replace(/^0+/, '');

  const qNorm = norm(q);
  const qDigits = getDigits(q);

  // 1. Exact raw match
  let match = billList.find(b => (b.billNo || '').toLowerCase().trim() === q);
  if (match) return match;

  // 2. Exact normalized match
  if (qNorm) {
    match = billList.find(b => norm(b.billNo) === qNorm);
    if (match) return match;
  }

  // 3. Pure digit match
  if (qDigits) {
    match = billList.find(b => getDigits(b.billNo) === qDigits);
    if (match) return match;
  }

  // 4. Prefix or suffix match
  return billList.find(b => {
    const bLower = (b.billNo || '').toLowerCase().trim();
    return bLower.endsWith(q) || q.endsWith(bLower) || bLower.includes(q);
  });
}

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

  const allAvailableBills = bills && bills.length > 0 ? bills : getBills();

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
  let rem = Number(overflowTotalCollected) || 0;
  const processed = pendingItems.map((item, idx) => {
    const foundBill = findBillInList(item.billNo, allAvailableBills);
    const billNetAmt = Number(item.billNetAmt) || Number(foundBill?.billNetAmt) || Number(foundBill?.outstandingAmount) || 0;
    const existingLc = (Number(foundBill?.lineCutAmt) || 0) || (Number(foundBill?.cancelLine) || 0);

    let lineCut = 0;
    if (item.lineCutInput !== '' && item.lineCutInput !== undefined) {
      lineCut = Math.max(0, Math.min(Number(item.lineCutInput) || 0, billNetAmt));
    } else {
      // Default line cut if money runs short on this item
      lineCut = existingLc > 0 ? existingLc : Math.max(0, billNetAmt - rem);
    }

    const netPayable = Math.max(0, billNetAmt - lineCut);
    const applied = Math.min(rem, netPayable);
    rem = Math.max(0, rem - applied);
    return { ...item, billNetAmt, lineCut, applied, netPayable };
  });
  const remaining = rem;

  const handleAddNextBill = () => {
    const bn = nextBillInput.trim();
    if (!bn) return;
    
    const foundBill = findBillInList(bn, allAvailableBills);
    if (!foundBill) {
      setNextBillErr(`Bill "${bn}" nahi mila`);
      return;
    }
    if (pendingItems.some(x => x.billNo === foundBill.billNo)) {
      setNextBillErr('Bill pehle se chain me hai');
      return;
    }
    
    const billNetAmt = Number(foundBill.billNetAmt) || Number(foundBill.outstandingAmount) || 0;
    const existingLc = (Number(foundBill.lineCutAmt) || 0) || (Number(foundBill.cancelLine) || 0);

    // Auto-calculate line cut for the new bill if remaining money is less than the bill net amount
    let nextLineCut = '0';
    if (existingLc > 0) {
      nextLineCut = String(existingLc);
    } else if (remaining < billNetAmt) {
      // Auto apply line cut for the shortfall so the bill is 100% covered!
      const shortfall = Math.max(0, billNetAmt - remaining);
      nextLineCut = String(shortfall);
    }

    setNextBillErr('');
    setPendingItems(prev => [
      ...prev, 
      { 
        billNo: foundBill.billNo, 
        partyName: foundBill.partyName, 
        billNetAmt: billNetAmt, 
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
              {remaining > 0 ? (
                <>
                  <span className="mx-1.5 text-border">·</span>
                  <span className="text-orange-500 font-black">Rem: ₹{remaining.toLocaleString('en-IN')}</span>
                </>
              ) : (
                <>
                  <span className="mx-1.5 text-border">·</span>
                  <span className="text-emerald-600 font-black">Full Allocated</span>
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
        <div className="px-5 py-3 space-y-2 max-h-64 overflow-y-auto no-scrollbar" id="overflow-items-list">
          {processed.map((item, i) => (
            <div 
              key={item.billNo} 
              className={cn("rounded-xl border p-2.5 space-y-1.5", i === 0 ? "bg-primary/5 border-primary/20" : "bg-orange-50/60 border-orange-200")}
              id={`overflow-item-${item.billNo}`}
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-black uppercase text-foreground">{item.billNo}</p>
                  <p className="text-[8.5px] text-muted-foreground font-bold truncate uppercase">{item.partyName} · Bill ₹{item.billNetAmt.toLocaleString('en-IN')}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  <div className="text-right">
                    <p className="text-[11px] font-black text-emerald-600">Apply ₹{item.applied.toLocaleString('en-IN')}</p>
                    {item.lineCut > 0 && (
                      <p className="text-[9px] font-black text-destructive flex items-center justify-end gap-0.5">
                        <Scissors className="w-2.5 h-2.5" /> Cut ₹{item.lineCut.toLocaleString('en-IN')}
                      </p>
                    )}
                  </div>
                  {/* Remove button — only for bills added after the first */}
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
              <div className="flex items-center gap-2 bg-background/80 rounded-lg px-2 py-1 border border-border/40">
                <span className="text-[8.5px] font-black text-muted-foreground uppercase shrink-0 flex items-center gap-1">
                  <Scissors className="w-3 h-3 text-destructive" /> Line Cut:
                </span>
                <input
                  id={`overflow-item-linecut-input-${item.billNo}`}
                  type="number" 
                  inputMode="numeric"
                  placeholder="0"
                  value={item.lineCutInput}
                  onChange={e => handleUpdateLineCut(i, e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') nextInputRef.current?.focus(); }}
                  className="flex-1 h-6 px-2 bg-transparent rounded text-[10.5px] font-black border-0 outline-none text-right text-destructive focus:ring-1 focus:ring-destructive/40"
                />
              </div>
            </div>
          ))}
        </div>

        {/* Next bill input */}
        <div className="px-5 pb-5 pt-1 space-y-2" id="overflow-actions-container">
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-[9px] font-black text-orange-600 uppercase">
                {remaining > 0 ? `Baki ₹${remaining.toLocaleString('en-IN')} — Agla Bill No:` : 'Aur Bill Add Karein:'}
              </p>
              {remaining > 0 && (
                <span className="text-[8px] font-bold text-muted-foreground uppercase">Auto Line Cut Active</span>
              )}
            </div>
            <div className="flex gap-1.5">
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
                  "flex-1 h-10 px-3 bg-muted rounded-xl text-sm font-black border-2 outline-none uppercase text-center transition-all", 
                  nextBillErr ? "border-destructive" : "border-border focus:border-primary"
                )}
              />
              <Button 
                id="overflow-add-bill-btn"
                onClick={handleAddNextBill} 
                disabled={!nextBillInput.trim()} 
                className="h-10 px-4 rounded-xl font-black uppercase text-[10px] bg-orange-500 hover:bg-orange-600 text-white cursor-pointer shrink-0"
              >
                Add Bill
              </Button>
            </div>
            {nextBillErr && (
              <p className="text-destructive text-[9px] font-black uppercase mt-1 text-center" id="overflow-next-bill-error">
                {nextBillErr}
              </p>
            )}
          </div>

          <div className="flex gap-2 pt-2" id="overflow-final-buttons">
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
              onClick={() => onSaveAll(processed)}
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
