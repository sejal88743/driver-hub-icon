import { useState, useRef, useEffect } from 'react';
import { X, Check, Loader2, Wallet, Smartphone, Landmark, Hash, RotateCcw } from 'lucide-react';
import { Bill, Bank, savePayment } from '@/lib/billStore';
import BankCombobox from '@/components/BankCombobox';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { getLoggedInName, getRole } from '@/lib/auth';
import { getTodayISO, displayToIso, isoToDisplay } from '@/lib/dateUtils';

type Props = {
  bill: Bill;
  banks: Bank[];
  onClose: () => void;
  onSaved: () => void;
};

export default function BillEditModal({ bill, banks, onClose, onSaved }: Props) {
  const lc0    = Number(bill.lineCutAmt) || Number(bill.cancelLine) || 0;
  const ca0    = Number(bill.cashAmount) || 0;
  const ua0    = Number(bill.upiAmount) || 0;
  const qa0    = Number(bill.chequeAmount) || 0;
  // If breakdown missing but collectedAmount exists, infer from paymentMode
  const _m = (bill.paymentMode || '').toLowerCase();
  const initCash = ca0 > 0 ? String(ca0) : (ca0 === 0 && ua0 === 0 && qa0 === 0 && bill.collectedAmount && _m === 'cash') ? String(bill.collectedAmount) : '';
  const initUpi  = ua0 > 0 ? String(ua0) : (ca0 === 0 && ua0 === 0 && qa0 === 0 && bill.collectedAmount && _m === 'upi')  ? String(bill.collectedAmount) : '';
  const initChq  = qa0 > 0 ? String(qa0) : (ca0 === 0 && ua0 === 0 && qa0 === 0 && bill.collectedAmount && (_m === 'cheque' || _m === 'chq')) ? String(bill.collectedAmount) : '';

  const [cashAmt,   setCashAmt]   = useState(initCash);
  const [upiAmt,    setUpiAmt]    = useState(initUpi);
  const [chqAmt,    setChqAmt]    = useState(initChq);
  const [chequeNo,  setChequeNo]  = useState(bill.chequeNo  || '');
  const [bankName,  setBankName]  = useState(bill.bankName  || '');
  const [payMode,   setPayMode]   = useState(''); // FBR | Credit | Del Pending | Unpaid | ''
  const [lcInput,   setLcInput]   = useState(lc0 > 0 ? String(lc0) : '');
  const [recDateInput, setRecDateInput] = useState(() => bill.paymentDate ? displayToIso(bill.paymentDate) : getTodayISO());
  const [saving,    setSaving]    = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [done,      setDone]      = useState(false);

  const cashRef = useRef<HTMLInputElement>(null);
  const upiRef  = useRef<HTMLInputElement>(null);
  const chqRef  = useRef<HTMLInputElement>(null);
  const chqNoRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setTimeout(() => cashRef.current?.focus(), 80); }, []);

  // ESC to close
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const cash   = Number(cashAmt)  || 0;
  const upi    = Number(upiAmt)   || 0;
  const chq    = Number(chqAmt)   || 0;
  const lc     = Number(lcInput)  || 0;
  const total  = cash + upi + chq;
  const net    = bill.billNetAmt - lc;
  const diff   = net - total;

  const isDriverRole = getRole() === 'driver';
  const isSpecialMode = payMode === 'FBR' || payMode === 'Credit' || payMode === 'Del Pending' || payMode === 'Unpaid';
  const chqOk = chq <= 0 || (chequeNo.trim().length >= 3 && (isDriverRole || !!bankName.trim()));
  const canSave = !saving && chqOk && (
    (total > 0) ||
    isSpecialMode
  );

  // Derive final payment mode
  function deriveMode(): string {
    if (payMode === 'FBR' || payMode === 'Del Pending' || payMode === 'Unpaid') return payMode;
    if (payMode === 'Credit' && total === 0) return 'Credit';
    if (total === 0) return payMode || 'Unpaid';
    const active: string[] = [];
    if (cash > 0) active.push('Cash');
    if (upi  > 0) active.push('UPI');
    if (chq  > 0) active.push('Cheque');
    return active.length > 1 ? 'Split' : active[0] || 'Unknown';
  }

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);

    const finalMode = deriveMode();
    const effectiveDriver = bill.driverName?.trim() || 'OWNER';
    const splitDetails = { cash, upi, cheque: chq };
    const chosenRecDate = isoToDisplay(recDateInput) || bill.paymentDate || '';

    const finalLc = total >= bill.billNetAmt ? 0 : Math.max(0, Math.min(lc, bill.billNetAmt - total));

    const ok = await savePayment(
      bill.billNo,
      finalMode,
      null,
      total,
      null,
      effectiveDriver,
      getTodayISO(),
      chq > 0 ? (chequeNo.trim() || null) : null,
      chq > 0 ? (bankName.trim() || null) : null,
      null,
      splitDetails,
      finalMode === 'Credit' ? finalLc : (total >= bill.billNetAmt ? 0 : (finalLc > 0 ? finalLc : null)),
      chosenRecDate || null,
      getLoggedInName(),
      chq > 0 ? (bill.chequeDate || null) : null,
    );

    setSaving(false);
    if (!ok) {
      setSaveError('Database me save nahi hua. Internet check kar ke dobara try karein.');
      return;
    }
    setDone(true);
    onSaved();
    setTimeout(() => onClose(), 1400);
  }

  const isFBR     = bill.paymentMode === 'FBR'  || bill.paymentMode === 'Cancel';
  const isCredit  = bill.paymentMode === 'Credit';
  const isDelPend = bill.paymentMode === 'Del Pending';
  const isPaid    = !isFBR && (bill.collectedAmount || 0) > 0 && Math.abs(bill.billNetAmt - lc0 - (bill.collectedAmount || 0)) <= 1;

  const statusLabel = isFBR ? 'FBR' : isCredit ? 'CREDIT' : isDelPend ? 'DEL PEND' : isPaid ? 'PAID' : 'UNPAID';
  const statusCls   = isFBR ? 'bg-red-500 text-white' : isCredit ? 'bg-green-500 text-white' : isDelPend ? 'bg-amber-400 text-black' : isPaid ? 'bg-emerald-500 text-white' : 'bg-muted text-muted-foreground';

  if (done) return (
    <div className="fixed inset-0 z-[400] bg-black/60 flex items-start justify-center pt-4 p-4 backdrop-blur-sm">
      <div className="bg-card rounded-3xl p-8 w-full max-w-xs shadow-2xl border-2 border-emerald-500 text-center animate-in zoom-in-95">
        <div className="w-14 h-14 bg-emerald-500 rounded-full flex items-center justify-center mx-auto mb-3">
          <Check className="w-7 h-7 text-white stroke-[3]" />
        </div>
        <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Saved Successfully</p>
        <p className="text-lg font-black text-foreground mt-1">{bill.billNo}</p>
      </div>
    </div>
  );

  if (saveError) return (
    <div className="fixed inset-0 z-[400] bg-black/60 flex items-start justify-center pt-4 p-4 backdrop-blur-sm">
      <div className="bg-card rounded-3xl p-6 w-full max-w-sm shadow-2xl border-2 border-destructive text-center">
        <div className="w-14 h-14 bg-destructive rounded-full flex items-center justify-center mx-auto mb-3">
          <X className="w-7 h-7 text-white stroke-[3]" />
        </div>
        <p className="text-[11px] font-black text-destructive uppercase tracking-widest">Save Failed</p>
        <p className="text-sm text-foreground mt-2">{saveError}</p>
        <button onClick={() => setSaveError(null)} className="mt-4 w-full bg-primary text-primary-foreground rounded-xl py-2 text-xs font-black uppercase tracking-widest">OK</button>
      </div>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-[400] bg-black/60 flex items-start justify-center pt-4 backdrop-blur-sm px-0 sm:px-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-card w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl shadow-2xl border border-border animate-in slide-in-from-bottom duration-200 max-h-[95vh] overflow-y-auto">

        {/* Header */}
        <div className="sticky top-0 bg-card z-10 flex items-center justify-between px-4 pt-4 pb-3 border-b border-border">
          <div>
            <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Edit Entry</p>
            <p className="text-sm font-black text-primary uppercase">{bill.billNo}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-muted transition-colors">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <div className="p-4 space-y-3">

          {/* Bill Info */}
          <div className="bg-muted/40 rounded-2xl px-3 py-2.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[15px] font-black text-foreground uppercase leading-tight truncate flex-1">{bill.partyName}</p>
              <span className={cn("text-[8px] font-black px-2 py-0.5 rounded-full uppercase shrink-0", statusCls)}>{statusLabel}</span>
            </div>
            {bill.salespersonName && (
              <p className="text-[10px] font-black text-primary/70 uppercase">{bill.salespersonName}</p>
            )}
            <div className="grid grid-cols-4 gap-0 rounded-xl overflow-hidden border border-border text-center">
              <div className="py-1.5 px-1 bg-primary/5">
                <p className="text-[7px] font-black text-primary/60 uppercase leading-none mb-0.5">Bill Amt</p>
                <p className="text-[12px] font-black text-primary leading-none">₹{bill.billNetAmt.toLocaleString('en-IN')}</p>
              </div>
              <div className="py-1.5 px-1 bg-red-50 border-l border-border">
                <p className="text-[7px] font-black text-red-500 uppercase leading-none mb-0.5">Line Cut</p>
                <p className="text-[12px] font-black text-red-600 leading-none">₹{lc0.toLocaleString('en-IN')}</p>
              </div>
              <div className="py-1.5 px-1 bg-orange-50 border-l border-border">
                <p className="text-[7px] font-black text-orange-500 uppercase leading-none mb-0.5">O/S</p>
                <p className="text-[12px] font-black text-orange-600 leading-none">₹{Math.max(0, bill.billNetAmt - lc0 - (bill.collectedAmount || 0)).toLocaleString('en-IN')}</p>
              </div>
              <div className="py-1.5 px-1 bg-emerald-50 border-l border-border">
                <p className="text-[7px] font-black text-emerald-600 uppercase leading-none mb-0.5">Paid</p>
                <p className="text-[12px] font-black text-emerald-700 leading-none">₹{(bill.collectedAmount || 0).toLocaleString('en-IN')}</p>
              </div>
            </div>
            {(bill.driverName || bill.paymentDate || bill.deliveryDate) && (
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 pt-0.5">
                {bill.driverName && <span className="text-[9px] font-bold text-muted-foreground uppercase">{bill.driverName}</span>}
                {bill.deliveryDate && <span className="text-[9px] font-bold text-muted-foreground uppercase">DEL: {bill.deliveryDate}</span>}
                {bill.paymentDate && <span className="text-[9px] font-bold text-purple-700 dark:text-purple-300 uppercase">REC: {bill.paymentDate}</span>}
              </div>
            )}
          </div>

          {/* REC DATE Field */}
          <div className="flex items-center gap-2 bg-purple-50 dark:bg-purple-950/40 px-3 py-1.5 rounded-xl border border-purple-200 dark:border-purple-800">
            <label className="text-[10px] font-black text-purple-700 dark:text-purple-300 uppercase shrink-0">REC DATE ★</label>
            <input
              type="date"
              value={recDateInput}
              onChange={e => setRecDateInput(e.target.value)}
              className="flex-1 h-7 px-2 bg-white dark:bg-card rounded-lg text-[12px] font-black outline-none border border-purple-300 dark:border-purple-700 text-purple-950 dark:text-purple-200 uppercase"
            />
          </div>

          {/* Amount Inputs */}
          <div className="grid grid-cols-3 gap-2">
            <div className="relative">
              <Wallet className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-emerald-600 pointer-events-none" />
              <input
                ref={cashRef}
                type="number" inputMode="numeric" placeholder="CASH"
                value={cashAmt} onChange={e => setCashAmt(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); upiRef.current?.focus(); } }}
                className="w-full h-10 pl-8 pr-1 bg-muted/50 rounded-xl text-[13px] font-black outline-none border border-border/30 focus:ring-2 focus:ring-emerald-500/30"
              />
            </div>
            <div className="relative">
              <Smartphone className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-blue-600 pointer-events-none" />
              <input
                ref={upiRef}
                type="number" inputMode="numeric" placeholder="GPAY"
                value={upiAmt} onChange={e => setUpiAmt(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); chqRef.current?.focus(); }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); cashRef.current?.focus(); }
                }}
                className="w-full h-10 pl-8 pr-1 bg-muted/50 rounded-xl text-[13px] font-black outline-none border border-border/30 focus:ring-2 focus:ring-blue-500/30"
              />
            </div>
            <div className="relative">
              <Landmark className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-violet-600 pointer-events-none" />
              <input
                ref={chqRef}
                type="number" inputMode="numeric" placeholder="CHQ"
                value={chqAmt} onChange={e => setChqAmt(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); if (chq > 0) chqNoRef.current?.focus(); }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); upiRef.current?.focus(); }
                }}
                className="w-full h-10 pl-8 pr-1 bg-muted/50 rounded-xl text-[13px] font-black outline-none border border-border/30 focus:ring-2 focus:ring-violet-500/30"
              />
            </div>
          </div>

          {/* Cheque fields */}
          {chq > 0 && (
            <div className="flex gap-2 animate-in slide-in-from-top-1 duration-150">
              <div className="relative flex-1">
                <Hash className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <input
                  ref={chqNoRef}
                  type="text" inputMode="numeric" placeholder="CHQ NO"
                  maxLength={6}
                  value={chequeNo}
                  onChange={e => setChequeNo(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="w-full h-10 pl-8 pr-2 bg-muted/50 rounded-xl text-[11px] font-black uppercase outline-none border border-border/30 focus:ring-2 focus:ring-violet-500/30"
                />
              </div>
              <BankCombobox
                banks={banks}
                value={bankName}
                onChange={setBankName}
                placeholder="BANK"
                className="flex-1 h-10 px-2 bg-muted/50 rounded-xl text-[10px] font-black outline-none border border-border/30 text-foreground"
              />
            </div>
          )}

          {/* Line Cut override */}
          <div className="flex items-center gap-2">
            <label className="text-[9px] font-black text-amber-600 uppercase shrink-0">Line Cut</label>
            <input
              type="number" inputMode="numeric" placeholder="0"
              value={lcInput}
              onChange={e => setLcInput(e.target.value)}
              className="flex-1 h-8 px-2 bg-amber-50 rounded-lg text-[11px] font-black outline-none border border-amber-200 text-right"
            />
            {total > 0 && (
              <span className={cn("text-[10px] font-black shrink-0", Math.abs(diff) <= 1 ? 'text-emerald-600' : diff > 0 ? 'text-destructive' : 'text-blue-600')}>
                DIFF: ₹{diff.toLocaleString('en-IN')}
              </span>
            )}
          </div>

          {/* Mode buttons */}
          <div className="grid grid-cols-4 gap-1.5">
            {(['FBR', 'Credit', 'Del Pending', 'Unpaid'] as const).map(m => (
              <button
                key={m}
                onClick={() => setPayMode(prev => prev === m ? '' : m)}
                disabled={total > 0 && (m === 'FBR' || m === 'Credit' || m === 'Del Pending' || m === 'Unpaid')}
                className={cn(
                  "h-9 rounded-xl text-[9px] font-black uppercase transition-all border disabled:opacity-40",
                  payMode === m
                    ? m === 'FBR'         ? 'bg-destructive text-white border-transparent'
                    : m === 'Credit'      ? 'bg-green-600 text-white border-transparent'
                    : m === 'Del Pending' ? 'bg-amber-500 text-white border-transparent'
                                         : 'bg-muted-foreground text-white border-transparent'
                    : 'bg-muted text-muted-foreground border-border/30 hover:border-primary/30'
                )}
              >
                {m === 'Del Pending' ? 'DEL PND' : m}
              </button>
            ))}
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <Button variant="outline" onClick={onClose} className="flex-1 h-10 rounded-xl font-black uppercase text-[11px]">
              <RotateCcw className="w-3.5 h-3.5 mr-1" /> Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!canSave}
              className={cn(
                "flex-[1.5] h-10 rounded-xl font-black uppercase text-[11px] transition-all",
                canSave ? 'bg-primary hover:bg-primary/90 shadow-md' : 'opacity-50 cursor-not-allowed'
              )}
            >
              {saving
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <><Check className="w-4 h-4 mr-1" />Save {total > 0 ? `₹${total.toLocaleString('en-IN')}` : payMode || ''}</>
              }
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
