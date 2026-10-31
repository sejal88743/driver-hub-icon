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
  const processed = pendingItems.map((item) => {
    const foundBill = findBillInList(item.billNo, allAvailableBills);
    const billNetAmt = Number(item.billNetAmt) || Number(foundBill?.billNetAmt) || Number(foundBill?.outstandingAmount) || 0;
    const existingLc = (Number(foundBill?.lineCutAmt) || 0) || (Number(foundBill?.cancelLine) || 0);

    let lineCut = 0;
    if (item.lineCutInput !== '' && item.lineCutInput !== undefined) {
      lineCut = Math.max(0, Math.min(Number(item.lineCutInput) || 0, billNetAmt));
    } else {
      lineCut = existingLc > 0 ? existingLc : 0;
    }

    const netPayable = Math.max(0, billNetAmt - lineCut);
    const applied = Math.min(rem, netPayable);
    rem = Math.max(0, rem - applied);
    return { ...item, billNetAmt, lineCut, applied, netPayable };
  });
  const remaining = Math.round(rem * 100) / 100;
  const isFullySettled = remaining === 0 && pendingItems.length > 0;

  const handleAddNextBill = () => {
    const bn = nextBillInput.trim();
    if (!bn) return;

    if (remaining <= 0) {
      setNextBillErr(`Pura rec amount (₹${overflowTotalCollected.toLocaleString('en-IN')}) settle ho chuka hai (Remain ₹0 hai)!`);
      return;
    }
    
    // MANDATORY CHECK: Ensure the last/current pending item has its lineCutInput filled (0 or any value)
    const lastItem = pendingItems[pendingItems.length - 1];
    if (lastItem && (lastItem.lineCutInput === '' || lastItem.lineCutInput === undefined || lastItem.lineCutInput === null)) {
      setNextBillErr(`Pehle bill "${lastItem.billNo}" ka line cut amount daalein (0 ya jo bhi ho) tabhi agla bill add hoga!`);
      return;
    }
    
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
    const nextLineCut = existingLc > 0 ? String(existingLc) : '';

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
            <div className="flex items-center flex-wrap gap-1.5 text-[10px] font-bold text-muted-foreground uppercase mt-1">
              <span>Total: <strong className="text-primary font-black">₹{overflowTotalCollected.toLocaleString('en-IN')}</strong></span>
              <span className="text-border">·</span>
              <span>Mode: <strong className="text-primary font-black">{overflowMode}</strong></span>
              <span className="text-border">·</span>
              {remaining > 0 ? (
                <span className="text-amber-700 bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 rounded-md font-black">
                  Rem: ₹{remaining.toLocaleString('en-IN')}
                </span>
              ) : isFullySettled ? (
                <span className="text-emerald-700 bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-md font-black flex items-center gap-1">
                  <Check className="w-3 h-3 stroke-[3]" /> Remain: ₹0 (Settled)
                </span>
              ) : (
                <span className="text-destructive bg-destructive/10 border border-destructive/30 px-2 py-0.5 rounded-md font-black">
                  Over: ₹{Math.abs(remaining).toLocaleString('en-IN')}
                </span>
              )}
            </div>
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

        {/* Settlement Status Banner */}
        <div className="px-5 pt-1">
          {remaining > 0 ? (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2 text-center text-amber-800 dark:text-amber-300 space-y-0.5" id="overflow-remaining-banner">
              <p className="text-[10px] font-black uppercase flex items-center justify-center gap-1">
                ⚠️ Baki ₹{remaining.toLocaleString('en-IN')} Settle Karna Baki Hai
              </p>
              <p className="text-[8.5px] font-bold text-muted-foreground">
                Agla bill add karke Remain Amount = ₹0 karein. Remain 0 hone par hi entry save hogi!
              </p>
            </div>
          ) : isFullySettled ? (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-3 py-2 text-center text-emerald-800 dark:text-emerald-300 space-y-0.5" id="overflow-settled-banner">
              <p className="text-[10px] font-black uppercase flex items-center justify-center gap-1 text-emerald-700 dark:text-emerald-400">
                <Check className="w-3.5 h-3.5 stroke-[3] text-emerald-600" /> Pura Rec Amount Settle Ho Gaya (Remain = ₹0)
              </p>
              <p className="text-[8.5px] font-bold text-muted-foreground">
                Sabhi bills me pura amount divide ho chuka hai. Niche Save All par click karein.
              </p>
            </div>
          ) : (
            <div className="bg-destructive/10 border border-destructive/30 rounded-xl px-3 py-1.5 text-center text-destructive">
              <p className="text-[9.5px] font-black uppercase">
                ⚠️ Over-allocated by ₹{Math.abs(remaining).toLocaleString('en-IN')}! Line cut ya bills adjust karein.
              </p>
            </div>
          )}
        </div>

        {/* Next bill input */}
        <div className="px-5 pb-5 pt-2 space-y-2" id="overflow-actions-container">
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-[9px] font-black text-orange-600 uppercase">
                {remaining > 0 ? `Baki ₹${remaining.toLocaleString('en-IN')} — Agla Bill No:` : 'Aur Bill Add Karein:'}
              </p>
            </div>
            <div className="flex gap-1.5">
              <input
                ref={nextInputRef}
                id="overflow-next-bill-input"
                type="text" 
                inputMode="numeric"
                placeholder={remaining > 0 ? "NEXT BILL NO (REMAIN SETTLE)..." : "ALL SETTLED (REMAIN ₹0)"}
                value={nextBillInput}
                onChange={e => { setNextBillInput(e.target.value); setNextBillErr(''); }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (nextBillInput.trim()) {
                      handleAddNextBill();
                    } else if (isFullySettled && !overflowSaving && pendingItems.length > 0) {
                      onSaveAll(processed);
                    } else if (!isFullySettled) {
                      setNextBillErr(`Remain amount ₹${remaining.toLocaleString('en-IN')} bacha hai! Agla bill no dalein.`);
                    }
                  }
                }}
                className={cn(
                  "flex-1 h-10 px-3 bg-muted rounded-xl text-sm font-black border-2 outline-none uppercase text-center transition-all", 
                  nextBillErr ? "border-destructive" : "border-border focus:border-primary"
                )}
              />
              <Button 
                id="overflow-add-bill-btn"
                onClick={handleAddNextBill} 
                disabled={!nextBillInput.trim() || remaining <= 0} 
                className="h-10 px-4 rounded-xl font-black uppercase text-[10px] bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white cursor-pointer shrink-0"
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
              onClick={() => {
                const unFilledItem = pendingItems.find(item => item.lineCutInput === '' || item.lineCutInput === undefined || item.lineCutInput === null);
                if (unFilledItem) {
                  setNextBillErr(`Pehle bill "${unFilledItem.billNo}" ka line cut amount daalein (0 ya jo bhi ho)!`);
                  return;
                }
                if (!isFullySettled) {
                  setNextBillErr(`Remain amount ₹${remaining.toLocaleString('en-IN')} bacha hai! Remain amount = 0 hoga tohi entry save hogi.`);
                  nextInputRef.current?.focus();
                  return;
                }
                onSaveAll(processed);
              }}
              disabled={overflowSaving || pendingItems.length === 0 || !isFullySettled}
              className={cn(
                "flex-[2] rounded-2xl font-black uppercase text-[10px] h-11 text-white cursor-pointer transition-all", 
                isFullySettled 
                  ? "bg-emerald-600 hover:bg-emerald-700 shadow-md shadow-emerald-600/30 ring-2 ring-emerald-500/50" 
                  : "bg-muted text-muted-foreground/60 border border-border cursor-not-allowed opacity-75"
              )}
            >
              {overflowSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" id="overflow-save-all-loader" />
              ) : isFullySettled ? (
                <>
                  <Check className="w-3.5 h-3.5 mr-1.5 stroke-[3]" />
                  Save All ({pendingItems.length} Bill{pendingItems.length > 1 ? 's' : ''})
                </>
              ) : (
                <>
                  Remain ₹{remaining.toLocaleString('en-IN')} — Save Locked
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
