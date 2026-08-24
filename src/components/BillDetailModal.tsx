
import { useState } from 'react';
import { X, RotateCcw, AlertTriangle, Loader2, Lock } from 'lucide-react';
import { Bill, resetBill, getOwnerPassword } from '@/lib/billStore';
import { cn } from '@/lib/utils';

type Props = {
  bill: Bill;
  onClose: () => void;
};

export default function BillDetailModal({ bill, onClose }: Props) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [ownerPwInput, setOwnerPwInput] = useState('');
  const [pwError, setPwError] = useState(false);

  const lc = bill.lineCutAmt || 0;
  const outstandingAmt = Math.max(0, bill.billNetAmt - lc - (bill.collectedAmount || 0));
  const reason = bill.cancelLine && isNaN(Number(bill.cancelLine)) ? bill.cancelLine : '';

  const fields = [
    { label: 'Date',              value: bill.date },
    { label: 'Salesperson',       value: bill.salespersonName },
    { label: 'Bill No',           value: bill.billNo },
    { label: 'Party Name',        value: bill.partyName },
    { label: 'Bill Net Amount',   value: `₹${Number(bill.billNetAmt).toLocaleString('en-IN')}` },
    { label: 'Line Cut Amt',      value: lc > 0 ? `₹${lc.toLocaleString('en-IN')}` : '—' },
    { label: 'Cancel Reason',     value: reason || '—' },
    { label: 'Collected Amount',  value: `₹${Number(bill.collectedAmount || 0).toLocaleString('en-IN')}` },
    { label: 'Outstanding',       value: `₹${outstandingAmt.toLocaleString('en-IN')}` },
    { label: 'Bill Ageing',       value: `${bill.billAgeing} days` },
    { label: 'Driver Name',       value: bill.driverName || '—' },
    { label: 'Delivery Date',     value: bill.deliveryDate || '—' },
    { label: 'Payment Mode',      value: bill.paymentMode || '—' },
    { label: 'Payment Date',      value: bill.paymentDate || '—' },
    { label: 'Cheque No',         value: bill.chequeNo || '—' },
    { label: 'Bank',              value: bill.bankName || '—' },
  ];

  async function handleReset() {
    const ownerPw = (getOwnerPassword() || '').trim();
    if (ownerPwInput.trim() !== ownerPw) {
      setPwError(true);
      return;
    }
    setResetting(true);
    await resetBill(bill.billNo);
    setResetting(false);
    setConfirmReset(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-4 bg-black/50 backdrop-blur-sm px-4" onClick={onClose}>
      <div className="bg-card rounded-t-3xl sm:rounded-2xl w-full max-w-md max-h-[90vh] overflow-auto animate-in slide-in-from-bottom duration-300 shadow-2xl" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="sticky top-0 bg-card z-10 flex items-center justify-between p-4 border-b border-border">
          <h3 className="font-extrabold text-sm uppercase tracking-widest text-primary">Bill Details</h3>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-muted transition-colors">
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* Fields */}
        <div className="p-4 space-y-0.5">
          {fields.map(({ label, value }) => (
            <div key={label} className="flex justify-between items-start py-1.5 border-b border-border/30 last:border-0">
              <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-tight">{label}</span>
              <span className="text-xs font-bold text-foreground text-right max-w-[60%] leading-tight">{value}</span>
            </div>
          ))}
        </div>

        {/* Reset section */}
        <div className="px-4 pb-6 pt-2">
          {!confirmReset ? (
            <button
              onClick={() => { setConfirmReset(true); setOwnerPwInput(''); setPwError(false); }}
              className="w-full h-10 rounded-xl border-2 border-destructive/40 text-destructive font-black uppercase text-[10px] tracking-widest flex items-center justify-center gap-2 hover:bg-destructive/5 transition-colors"
            >
              <RotateCcw className="w-4 h-4" /> Reset Bill Payment
            </button>
          ) : (
            <div className="bg-destructive/10 border border-destructive/40 rounded-xl p-3 space-y-2.5 animate-in fade-in">
              <div className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <p className="text-[10px] font-black uppercase leading-tight">
                  Rec Amount, Linecut, Reason, Payment Mode — sab clear ho jaayega. Bill Amount same rahega.
                </p>
              </div>
              <div className="relative">
                <Lock className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  placeholder="ENTER OWNER PASSWORD"
                  autoFocus
                  value={ownerPwInput}
                  onChange={e => { setOwnerPwInput(e.target.value); setPwError(false); }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleReset();
                    }
                  }}
                  className={cn(
                    "w-full h-9 pl-8 pr-2 bg-card rounded-lg text-[11px] font-black outline-none uppercase border",
                    pwError ? "border-destructive text-destructive" : "border-border focus:border-destructive"
                  )}
                />
              </div>
              {pwError && (
                <p className="text-[9px] font-black text-destructive uppercase">Wrong Owner Password</p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => { setConfirmReset(false); setOwnerPwInput(''); setPwError(false); }}
                  className="flex-1 h-9 rounded-lg border border-border font-black uppercase text-[10px] text-muted-foreground hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleReset}
                  disabled={resetting}
                  className={cn(
                    "flex-1 h-9 rounded-lg font-black uppercase text-[10px] text-white flex items-center justify-center gap-1.5 transition-colors",
                    resetting ? "bg-destructive/60" : "bg-destructive hover:bg-destructive/90"
                  )}
                >
                  {resetting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                  {resetting ? 'Resetting...' : 'Confirm Reset'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
