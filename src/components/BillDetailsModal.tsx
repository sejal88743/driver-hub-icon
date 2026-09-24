import { useState, useEffect } from 'react';
import { X, Calendar, Check, Loader2, Edit2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Bill } from '@/lib/billStore';
import { patchBillDirect } from '@/lib/billStore';
import { displayToIso, isoToDisplay } from '@/lib/dateUtils';

type Props = {
  billNo: string | null;
  bill: Bill | undefined;
  onClose: () => void;
  onOpenEntry: (billNo: string) => void;
};

export default function BillDetailsModal({ billNo, bill, onClose, onOpenEntry }: Props) {
  const [isEditingRecDate, setIsEditingRecDate] = useState(false);
  const [recDateVal, setRecDateVal] = useState(() => displayToIso(bill?.paymentDate || ''));
  const [savingDate, setSavingDate] = useState(false);
  const [dateSavedMsg, setDateSavedMsg] = useState(false);

  useEffect(() => {
    if (!billNo || !bill) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '+' || e.code === 'NumpadAdd') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [billNo, bill, onClose]);

  if (!billNo || !bill) return null;

  const _pbMode = (bill.paymentMode || '').toLowerCase();
  const isFBR = _pbMode === 'fbr' || _pbMode === 'cancel';
  const isUnpaid = _pbMode === 'unpaid' || _pbMode === 'credit' || _pbMode === 'del pending' || _pbMode === 'pending';
  const isPaid = !isFBR && !isUnpaid && ((bill.collectedAmount || 0) > 0 || !!bill.paymentDate
    || _pbMode === 'paid' || _pbMode === 'cash' || _pbMode === 'upi' || _pbMode === 'cheque' || _pbMode === 'split');
  const hasMethod = bill.paymentMethod;
  const statusLabel = isFBR ? 'FBR' : isUnpaid ? 'UNPAID' : isPaid ? (hasMethod ? hasMethod.toUpperCase() : 'PAID') : 'PENDING';
  const statusCls = isFBR ? 'bg-red-500 text-white' : isUnpaid ? 'bg-yellow-400 text-black' : isPaid ? 'bg-emerald-500 text-white' : 'bg-muted text-muted-foreground';

  async function handleSaveRecDate() {
    if (!recDateVal) return;
    setSavingDate(true);
    const newDisplay = isoToDisplay(recDateVal);
    const ok = await patchBillDirect(bill!.billNo, { paymentDate: newDisplay });
    setSavingDate(false);
    if (ok) {
      setDateSavedMsg(true);
      setIsEditingRecDate(false);
      setTimeout(() => setDateSavedMsg(false), 2000);
    }
  }

  return (
    <div 
      className="fixed inset-0 bg-black/60 z-[200] flex items-start justify-center pt-4 px-4 backdrop-blur-sm"
      id="bill-details-modal-overlay"
    >
      <div 
        className="bg-card rounded-3xl p-5 w-full max-w-xs shadow-2xl animate-in zoom-in-95 border border-border"
        onClick={e => e.stopPropagation()}
        id="bill-details-modal-container"
      >
        <div className="flex items-center justify-between mb-3" id="bill-details-header">
          <h3 className="font-black text-xs uppercase text-primary">Bill Details</h3>
          <button 
            id="bill-details-close-btn"
            onClick={onClose} 
            className="p-1 rounded-full hover:bg-muted text-muted-foreground cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-2 mb-4" id="bill-details-content">
          <div className="flex justify-between items-center border-b border-border/30 pb-2">
            <span className="text-[9px] font-black text-muted-foreground uppercase">Bill No</span>
            <span className="text-xs font-black text-foreground">{bill.billNo}</span>
          </div>
          <div className="flex justify-between items-center border-b border-border/30 pb-2">
            <span className="text-[9px] font-black text-muted-foreground uppercase">Party</span>
            <span className="text-[10px] font-black text-foreground text-right max-w-[60%] truncate">{bill.partyName || '—'}</span>
          </div>
          <div className="flex justify-between items-center border-b border-border/30 pb-2">
            <span className="text-[9px] font-black text-muted-foreground uppercase">Bill Amt</span>
            <span className="text-xs font-black text-primary">₹{bill.billNetAmt.toLocaleString('en-IN')}</span>
          </div>
          {(bill.collectedAmount || 0) > 0 && (
            <div className="flex justify-between items-center border-b border-border/30 pb-2">
              <span className="text-[9px] font-black text-muted-foreground uppercase">Collected</span>
              <span className="text-xs font-black text-emerald-600">₹{(bill.collectedAmount || 0).toLocaleString('en-IN')}</span>
            </div>
          )}

          {/* Editable REC DATE */}
          <div className="border-b border-border/30 pb-2 bg-purple-50/50 dark:bg-purple-950/20 p-2 rounded-xl">
            <div className="flex justify-between items-center">
              <span className="text-[9px] font-black text-purple-700 dark:text-purple-300 uppercase flex items-center gap-1">
                <Calendar className="w-3 h-3" /> REC DATE
              </span>
              {!isEditingRecDate ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-black text-purple-950 dark:text-purple-100">
                    {bill.paymentDate || '—'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setRecDateVal(displayToIso(bill.paymentDate || ''));
                      setIsEditingRecDate(true);
                    }}
                    className="p-1 text-purple-700 hover:bg-purple-200 dark:hover:bg-purple-900 rounded-md transition-colors cursor-pointer"
                    title="Change REC DATE"
                  >
                    <Edit2 className="w-3 h-3" />
                  </button>
                </div>
              ) : null}
            </div>

            {isEditingRecDate && (
              <div className="mt-2 flex items-center gap-1.5">
                <input
                  type="date"
                  value={recDateVal}
                  onChange={e => setRecDateVal(e.target.value)}
                  className="flex-1 h-7 px-2 bg-white dark:bg-card rounded-lg text-[11px] font-black border border-purple-300 outline-none uppercase"
                />
                <button
                  type="button"
                  disabled={savingDate}
                  onClick={handleSaveRecDate}
                  className="h-7 px-2.5 bg-purple-600 text-white rounded-lg text-[9px] font-black uppercase flex items-center gap-1 cursor-pointer"
                >
                  {savingDate ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3 stroke-[3]" />} Save
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingRecDate(false)}
                  className="h-7 px-2 bg-muted text-muted-foreground rounded-lg text-[9px] font-bold uppercase cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            )}

            {dateSavedMsg && (
              <p className="text-[8px] font-black text-emerald-600 uppercase mt-1 text-right">REC Date Updated ✓</p>
            )}
          </div>

          {bill.bankName && (
            <div className="flex justify-between items-center border-b border-border/30 pb-2">
              <span className="text-[9px] font-black text-muted-foreground uppercase">Bank</span>
              <span className="text-[10px] font-black text-foreground">{bill.bankName}{bill.chequeNo ? ` / ${bill.chequeNo}` : ''}</span>
            </div>
          )}
          <div className="flex justify-between items-center pt-0.5">
            <span className="text-[9px] font-black text-muted-foreground uppercase">Status</span>
            <span className={cn("text-[9px] font-black px-2 py-0.5 rounded-full uppercase", statusCls)}>{statusLabel}</span>
          </div>
        </div>
        <div className="flex gap-2" id="bill-details-actions">
          <button 
            id="bill-details-cancel-btn"
            onClick={onClose} 
            className="flex-1 h-10 rounded-2xl border border-border font-black text-[10px] uppercase text-muted-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button 
            id="bill-details-open-btn"
            onClick={() => onOpenEntry(bill.billNo)} 
            className="flex-1 h-10 rounded-2xl bg-primary text-primary-foreground font-black text-[10px] uppercase shadow transition-colors hover:bg-primary/90 cursor-pointer"
          >
            Open Entry
          </button>
        </div>
      </div>
    </div>
  );
}
