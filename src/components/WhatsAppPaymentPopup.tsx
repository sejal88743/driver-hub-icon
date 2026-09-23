import React, { useEffect, useState, useRef } from 'react';
import {
  Bell, CheckCircle2, XCircle, Loader2, AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getBills, bulkPatchBillsInMemory, Bill } from '@/lib/billStore';

/** One extracted payment from a live WhatsApp message. */
type WaEntry = {
  billNo: string;
  amount: number;
  paymentMethod: string;
  date: string;
  partyName?: string;
  remarks?: string;
};

type WaEvent = {
  type: string;
  id: string;
  fromJid: string;
  senderName: string;
  text: string;
  summary: string;
  entries: WaEntry[];
};

/** Queued popup item — one bill payment awaiting confirmation. */
type PendingItem = {
  eventId: string;
  entry: WaEntry;
  senderName: string;
  sourceLabel: string;
  text: string;
  summary: string;
  matched: boolean;
  bill?: Bill;
};

function todayDMY() {
  const now = new Date();
  return `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
}

function findBill(rawBn: string): Bill | undefined {
  const cleanBn = (s: string) => String(s || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const stripGst = (s: string) => cleanBn(s).replace(/^GST/i, '').replace(/^MOC/i, '');
  const c = cleanBn(rawBn);
  const st = stripGst(rawBn);
  const allBills = getBills ? getBills() : [];
  for (const b of allBills) {
    const bc = cleanBn(b.billNo);
    const bs = stripGst(b.billNo);
    if (bc === c || bs === st || bs === c) return b;
  }
  return undefined;
}

function jidLabel(jid: string): string {
  if (jid.endsWith('@g.us')) return 'WhatsApp Group';
  if (jid.endsWith('@s.whatsapp.net')) return jid.split('@')[0];
  return jid;
}

/** Global WhatsApp payment confirmation popup — listens to the live bot and shows
 *  bill details + payment details for each extracted entry. Save ONLY on confirm. */
export function WhatsAppPaymentPopup() {
  const [queue, setQueue] = useState<PendingItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(0);
  const seenIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const es = new EventSource('/api/admin/whatsapp-bot/events');

    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data?.type !== 'wa-payment' || !Array.isArray(data.entries)) return;
        if (seenIdsRef.current.has(data.id)) return;
        seenIdsRef.current.add(data.id);

        const items: PendingItem[] = data.entries.map((entry: WaEntry) => {
          const bill = findBill(entry.billNo);
          return {
            eventId: data.id,
            entry,
            senderName: data.senderName || '',
            sourceLabel: jidLabel(data.fromJid || ''),
            text: data.text || '',
            summary: data.summary || '',
            matched: Boolean(bill),
            bill,
          };
        });
        setQueue((prev) => [...prev, ...items]);
      } catch {}
    };

    es.onerror = () => { /* EventSource auto-reconnects */ };

    return () => es.close();
  }, []);

  const current = queue[0];

  function dismiss() {
    setQueue((prev) => prev.slice(1));
  }

  // ── Confirm & Save: only this click saves the payment ──
  async function confirmAndSave() {
    if (!current || !current.matched || !current.bill || saving) return;
    setSaving(true);
    try {
      const bill = current.bill;
      const netAmt = Number(bill.billNetAmt) || 0;
      const lineCut = Number(bill.lineCutAmt) || 0;
      const effectiveNet = Math.max(0, netAmt - lineCut);
      const amount = current.entry.amount > 0 ? Math.min(Number(current.entry.amount), effectiveNet) : effectiveNet;
      const outstanding = Math.max(0, effectiveNet - amount);
      // GPay / UPI / online — sab UPI bucket me; payment usually GPay screenshot se aata hai
      const rawMethod = current.entry.paymentMethod || 'GPay';
      const isUpi = /gpay|upi|online|phonepe|paytm|g-pay/i.test(rawMethod);
      const method = isUpi ? 'GPay' : rawMethod;

      const patch = {
        id: bill.id,
        billNo: bill.billNo,
        changes: {
          paymentMode: outstanding <= 0 ? 'Paid' : 'Credit',
          paymentMethod: method,
          paymentDate: current.entry.date || todayDMY(),
          collectedAmount: amount,
          outstandingAmount: outstanding,
          cashAmount: !isUpi && method === 'Cash' ? amount : 0,
          upiAmount: isUpi ? amount : 0,
          chequeAmount: method === 'Cheque' ? amount : 0,
        },
      };

      await bulkPatchBillsInMemory([patch]);

      // Backend Postgres sync (best-effort)
      try {
        const key = (typeof window !== 'undefined' && localStorage.getItem('gemini_api_key')) || '';
        fetch('/api/admin/ai-agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-gemini-api-key': key },
          body: JSON.stringify({ action: 'execute', patches: [patch] }),
        }).catch(() => {});
      } catch {}

      setJustSaved((n) => n + 1);
      setQueue((prev) => prev.slice(1));
    } finally {
      setSaving(false);
    }
  }

  if (!current) return null;

  const bill = current.bill;
  const effectiveNet = bill ? Math.max(0, (Number(bill.billNetAmt) || 0) - (Number(bill.lineCutAmt) || 0)) : 0;
  const combinedCount = queue.filter((q) => q.eventId === current.eventId).length;

  return (
    <div className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3">
      <div className="bg-card border-2 border-green-500/40 rounded-2xl shadow-2xl w-full max-w-md max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-t-2xl px-4 py-3 flex items-center gap-2.5">
          <div className="p-2 bg-white/20 rounded-xl">
            <Bell className="w-5 h-5 animate-pulse" />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-black uppercase tracking-wider">WhatsApp Payment Received</p>
            <p className="text-[10px] font-bold text-white/80 truncate">
              {current.sourceLabel}{current.senderName ? ` • ${current.senderName}` : ''}
            </p>
          </div>
          {queue.length > 1 && (
            <span className="ml-auto bg-white/25 text-white text-[10px] font-black px-2 py-0.5 rounded-full shrink-0">
              +{queue.length - 1} more
            </span>
          )}
        </div>

        <div className="p-4 space-y-3">
          {/* Message text */}
          {current.text && (
            <div className="bg-muted/60 border border-border rounded-xl px-3 py-2 text-[10.5px] font-medium text-muted-foreground italic">
              "{current.text}"
            </div>
          )}

          {!current.matched ? (
            <div className="bg-red-500/10 border border-red-400/40 rounded-xl px-3.5 py-3 space-y-1.5">
              <p className="text-[11px] font-black text-red-600 dark:text-red-400 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" /> Bill "{current.entry.billNo}" app me nahi mila
              </p>
              {current.entry.partyName && (
                <p className="text-[10px] font-semibold text-muted-foreground">Party: {current.entry.partyName}</p>
              )}
              <p className="text-[9.5px] font-bold text-muted-foreground">
                Bill number check karein — ya pehle bill app me add karein. Save nahi hoga.
              </p>
            </div>
          ) : (
            <>
              {/* Bill Details */}
              <div className="space-y-1.5">
                <p className="text-[9.5px] font-black uppercase tracking-wider text-muted-foreground">Bill Details:</p>
                <div className="bg-muted/40 border border-border rounded-xl px-3 py-2.5 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-black text-foreground font-mono">{bill!.billNo}</span>
                    <span className="text-[9px] font-black bg-primary/10 text-primary px-2 py-0.5 rounded-full uppercase">
                      {bill!.paymentMode || 'Unpaid'}
                    </span>
                  </div>
                  <p className="text-[10.5px] font-bold text-foreground">{bill!.partyName || '-'}</p>
                  <p className="text-[9.5px] font-semibold text-muted-foreground">
                    Driver: {bill!.driverName || '-'} • Salesperson: {bill!.salespersonName || '-'} • Beat: {bill!.beatName || '-'}
                  </p>
                  <div className="flex items-center gap-3 pt-1 border-t border-border/60 mt-1.5 pt-1.5 text-[10px] font-bold">
                    <span className="text-muted-foreground">Net: <span className="text-foreground">₹{effectiveNet.toLocaleString('en-IN')}</span></span>
                    <span className="text-muted-foreground">Outstanding: <span className="text-red-600 dark:text-red-400">₹{(Number(bill!.outstandingAmount) || 0).toLocaleString('en-IN')}</span></span>
                  </div>
                </div>
              </div>

              {/* Payment Details (extracted by AI) */}
              <div className="space-y-1.5">
                <p className="text-[9.5px] font-black uppercase tracking-wider text-muted-foreground">Payment Details (AI Extracted):</p>
                <div className="bg-green-500/5 border border-green-500/30 rounded-xl px-3 py-2.5 grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-[8.5px] font-black uppercase text-muted-foreground">Amount</p>
                    <p className="text-[12px] font-black text-green-700 dark:text-green-300">₹{(Number(current.entry.amount) || effectiveNet).toLocaleString('en-IN')}</p>
                  </div>
                  <div>
                    <p className="text-[8.5px] font-black uppercase text-muted-foreground">Method</p>
                    <p className="text-[12px] font-black text-foreground">{current.entry.paymentMethod || 'GPay'}</p>
                  </div>
                  <div>
                    <p className="text-[8.5px] font-black uppercase text-muted-foreground">Date</p>
                    <p className="text-[11px] font-black text-foreground">{current.entry.date || todayDMY()}</p>
                  </div>
                </div>
                {current.entry.remarks && (
                  <p className="text-[9.5px] font-medium text-muted-foreground italic">Note: {current.entry.remarks}</p>
                )}
                {combinedCount > 1 && (
                  <p className="text-[9.5px] font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    Ek hi payment {combinedCount} bills ({queue.filter(q => q.eventId === current.eventId).map(q => q.entry.billNo).join(', ')}) ke against hai — har bill apne outstanding tak hi adjust hoga.
                  </p>
                )}
              </div>
            </>
          )}

          {/* Saved counter */}
          {justSaved > 0 && (
            <p className="text-[9.5px] font-bold text-green-600 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> {justSaved} payments confirm karke save ho chuke hain.
            </p>
          )}

          {/* Actions — confirmation gate */}
          <div className="flex gap-2 pt-1">
            {current.matched && (
              <button
                type="button"
                onClick={confirmAndSave}
                disabled={saving}
                className="flex-1 bg-green-600 hover:bg-green-700 text-white font-black text-[11px] uppercase tracking-wider px-4 py-2.5 rounded-xl shadow-md flex items-center justify-center gap-1.5 transition-all active:scale-95"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Confirm & Save Payment
              </button>
            )}
            <button
              type="button"
              onClick={dismiss}
              className={cn(
                'flex-1 bg-muted hover:bg-destructive/10 text-foreground hover:text-destructive font-black text-[11px] uppercase tracking-wider px-4 py-2.5 rounded-xl border border-border flex items-center justify-center gap-1.5 transition-all active:scale-95'
              )}
            >
              <XCircle className="w-4 h-4" /> {current.matched ? 'Skip / Cancel' : 'Close'}
            </button>
          </div>
          <p className="text-[9px] text-center font-bold text-muted-foreground">
            ⚠ Payment confirm karne ke bad hi save hota hai.
          </p>
        </div>
      </div>
    </div>
  );
}
