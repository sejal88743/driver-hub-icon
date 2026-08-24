import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Bill } from '@/lib/billStore';

type Props = {
  isOpen: boolean;
  selectedBill: Bill | undefined;
  totalCollected: number;
  isDriverMode: boolean;
  onClose: () => void;
  onSaveNormal: (enteredLineCut: number, discrepancyReason?: string | null) => void;
  onSaveAsOutstanding: (enteredLineCut: number, discrepancyReason?: string | null) => void;
  initialLcAsOutstanding?: boolean;
  initialLineCutValue?: number;
};

function parseAmountExpression(value: string) {
  const cleaned = String(value || '').replace(/,/g, '').trim();
  if (!cleaned) return 0;
  const parts = cleaned.split('+').map(part => part.trim());
  if (parts.every(part => part !== '' && Number.isFinite(Number(part)))) {
    return parts.reduce((sum, part) => sum + Number(part), 0);
  }
  return Number(cleaned) || 0;
}

export default function LineCutPopup({ 
  isOpen, 
  selectedBill, 
  totalCollected, 
  isDriverMode, 
  onClose, 
  onSaveNormal, 
  onSaveAsOutstanding,
  initialLcAsOutstanding = false,
  initialLineCutValue = 0,
}: Props) {
  const [lcInputVal, setLcInputVal] = useState('');
  const [lcAsOutstanding, setLcAsOutstanding] = useState(initialLcAsOutstanding);
  const [discrepancyReason, setDiscrepancyReason] = useState('');

  // Sync initial outstanding state and default value when bill changes or modal opens
  useEffect(() => {
    if (selectedBill) {
      if (initialLcAsOutstanding) {
        // Credit / OS mode: Line Cut amount must be what's in entry page line cut, or "0" if none (never full bill amount)
        const existingEntryLc = (Number(selectedBill.lineCutAmt) || 0) || (Number(selectedBill.cancelLine) || 0);
        const defaultValue = (initialLineCutValue !== undefined && initialLineCutValue > 0)
          ? initialLineCutValue
          : existingEntryLc;
        setLcInputVal(defaultValue > 0 ? String(defaultValue) : '0');
      } else {
        const autoCalculatedLc = Math.max(0, selectedBill.billNetAmt - totalCollected);
        const defaultValue = initialLineCutValue !== undefined && initialLineCutValue > 0 && initialLineCutValue <= autoCalculatedLc
          ? initialLineCutValue
          : autoCalculatedLc;
        setLcInputVal(defaultValue > 0 ? String(defaultValue) : (autoCalculatedLc > 0 ? String(autoCalculatedLc) : '0'));
      }
    }
    setLcAsOutstanding(initialLcAsOutstanding);
    setDiscrepancyReason('');
  }, [selectedBill, totalCollected, initialLcAsOutstanding, initialLineCutValue, isOpen]);

  // Global Escape and '+' listener to close LineCutPopup
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

  if (!isOpen || !selectedBill) return null;

  const maxAllowedLineCut = Math.max(0, selectedBill.billNetAmt - totalCollected);
  const enteredLineCut = Math.min(Math.max(0, parseAmountExpression(lcInputVal)), maxAllowedLineCut);
  const creditOutstanding = Math.max(0, selectedBill.billNetAmt - enteredLineCut - totalCollected);

  const handleConfirm = () => {
    const reason = discrepancyReason || null;
    if (lcAsOutstanding) {
      onSaveAsOutstanding(enteredLineCut, reason);
    } else {
      onSaveNormal(enteredLineCut, reason);
    }
  };

  return (
    <div 
      className="fixed inset-0 bg-black/60 z-[200] flex items-start justify-center pt-4 px-4 backdrop-blur-sm"
      id="linecut-popup-overlay"
    >
      <div 
        className="bg-card rounded-3xl p-6 w-full max-w-xs shadow-2xl border border-border animate-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
        id="linecut-popup-container"
      >
        <h3 className="font-black text-sm uppercase mb-1 text-orange-600" id="linecut-title">Line Cut Confirm</h3>
        
        {/* Amount summary row */}
        <div className="flex gap-2 mb-3" id="linecut-summary-row">
          <div className="flex-1 bg-primary/5 rounded-xl px-2 py-2 text-center">
            <p className="text-[8px] font-black text-muted-foreground uppercase mb-0.5">Bill Amt</p>
            <p className="text-[13px] font-black text-primary">₹{selectedBill.billNetAmt.toLocaleString('en-IN')}</p>
          </div>
          <div className="flex-1 bg-emerald-50 rounded-xl px-2 py-2 text-center">
            <p className="text-[8px] font-black text-emerald-600 uppercase mb-0.5">Collected</p>
            <p className="text-[13px] font-black text-emerald-700">₹{totalCollected.toLocaleString('en-IN')}</p>
          </div>
          <div className="flex-1 bg-orange-50 rounded-xl px-2 py-2 text-center border-2 border-orange-300">
            <p className="text-[8px] font-black text-orange-600 uppercase mb-0.5">Line Cut</p>
            <p className="text-[13px] font-black text-orange-700">₹{enteredLineCut.toLocaleString('en-IN')}</p>
          </div>
        </div>

        {isDriverMode ? (
          /* Driver: read-only confirmation — diff always goes to Line Cut, bill → Paid */
          <p className="text-[10px] font-black text-muted-foreground text-center mb-4 uppercase" id="linecut-driver-desc">
            Baki ₹{enteredLineCut.toLocaleString('en-IN')} Line Cut me save hoga. Confirm karo?
          </p>
        ) : (
          /* Owner/User: editable line cut + optional Outstanding checkbox */
          <>
            <p className="text-[10px] font-black text-muted-foreground mb-1 uppercase" id="linecut-input-label">
              Line Cut Amt (edit if needed)
            </p>
            <input
              id="linecut-value-input"
              type="text" 
              inputMode="decimal" 
              autoFocus
              value={lcInputVal}
              onChange={e => setLcInputVal(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleConfirm();
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  onClose();
                }
              }}
              className="w-full h-12 px-4 bg-muted rounded-2xl text-sm font-black text-center border-2 border-orange-400 outline-none transition-all mb-2 focus:border-orange-500"
            />
            <div className="mb-3">
              <label htmlFor="linecut-reason-select" className="text-[10px] font-black text-muted-foreground uppercase mb-1 block">
                Reason (optional)
              </label>
              <select
                id="linecut-reason-select"
                value={discrepancyReason}
                onChange={e => setDiscrepancyReason(e.target.value)}
                className="w-full h-11 px-3 bg-muted rounded-2xl text-sm font-black border-2 border-border outline-none focus:border-orange-500"
              >
                <option value="">None</option>
                <option value="RETURN CHARG">RETURN CHARG</option>
                <option value="INTREST">INTREST</option>
              </select>
            </div>
            {/* Outstanding / Credit checkbox */}
            <label
              id="linecut-outstanding-checkbox-label"
              className={cn(
                "flex items-center gap-2.5 cursor-pointer mb-3 px-3 py-2.5 rounded-2xl border-2 transition-all select-none",
                lcAsOutstanding
                  ? "bg-blue-50 border-blue-400"
                  : "bg-muted/40 border-border"
              )}
              onClick={() => {
                setLcAsOutstanding(prev => {
                  const next = !prev;
                  if (next) {
                    const existingEntryLc = (Number(selectedBill.lineCutAmt) || 0) || (Number(selectedBill.cancelLine) || 0);
                    setLcInputVal(existingEntryLc > 0 ? String(existingEntryLc) : '0');
                  } else {
                    setLcInputVal(String(Math.max(0, selectedBill.billNetAmt - totalCollected)));
                  }
                  return next;
                });
              }}
            >
              <div className={cn(
                "w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all",
                lcAsOutstanding ? "bg-blue-500 border-blue-500" : "border-muted-foreground/40 bg-white"
              )}>
                {lcAsOutstanding && (
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                  </svg>
                )}
              </div>
              <div id="linecut-outstanding-text">
                <p className={cn("text-[10px] font-black uppercase", lcAsOutstanding ? "text-blue-700" : "text-muted-foreground")}>
                  OS Amt — Credit me save karo
                </p>
                <p className="text-[8px] text-muted-foreground font-semibold">
                  Total line cut save hoga; baaki ₹{creditOutstanding.toLocaleString('en-IN')} Credit me dikhega
                </p>
              </div>
            </label>
          </>
        )}

        <div className="flex gap-2" id="linecut-actions">
          <Button 
            id="linecut-back-btn"
            variant="outline" 
            onClick={onClose} 
            className="flex-1 rounded-2xl font-black uppercase text-[11px] h-12 cursor-pointer"
          >
            Back
          </Button>
          <Button
            id="linecut-confirm-btn"
            autoFocus={isDriverMode}
            onClick={handleConfirm}
            className={cn(
              "flex-1 rounded-2xl font-black uppercase text-[11px] h-12 text-white border-0 cursor-pointer",
              lcAsOutstanding
                ? "bg-blue-500 hover:bg-blue-600"
                : "bg-orange-500 hover:bg-orange-600"
            )}
          >
            {lcAsOutstanding ? "Credit Save" : "Confirm Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
