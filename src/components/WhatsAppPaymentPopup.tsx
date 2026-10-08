import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
  Bell, CheckCircle2, XCircle, Loader2, AlertTriangle, Search,
  Building2, ArrowRight, UserCheck, ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getBills, bulkPatchBillsInMemory, Bill } from '@/lib/billStore';

/** One extracted payment from a live WhatsApp message or image scan. */
type WaEntry = {
  billNo: string;
  amount: number;
  paymentMethod: string;
  date: string;
  accountName?: string;       // Paid to / Beneficiary / Receiver Account Name from screenshot
  senderAccountName?: string; // Paid by / Sender Name from screenshot
  partyName?: string;         // Customer / Party Name
  upiId?: string;             // UTR / UPI Ref / Transaction ID
  remarks?: string;
};

export type WaPaymentEvent = {
  type: string;
  id: string;
  fromJid: string;
  senderName: string;
  text: string;
  summary: string;
  entries: WaEntry[];
};

/** Queued popup item — one payment awaiting confirmation. */
type PendingItem = {
  eventId: string;
  entry: WaEntry;
  senderName: string;
  sourceLabel: string;
  text: string;
  summary: string;
  matched: boolean;
  bill?: Bill;
  isAlreadyPaid?: boolean;
};

const SEEN_STORAGE_KEY = 'vitratrack_wa_seen_payments_v3';

function getStoredSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return new Set(arr);
    }
  } catch {}
  return new Set();
}

function storeSeen(idOrSig: string) {
  if (!idOrSig) return;
  try {
    const s = getStoredSeen();
    s.add(idOrSig);
    const arr = Array.from(s).slice(-1000);
    localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(arr));
  } catch {}
}

function getPaymentSig(entry: WaEntry): string {
  const upi = String(entry.upiId || '').trim().toLowerCase();
  if (upi && upi.length >= 6) return `utr:${upi}`;
  const bn = String(entry.billNo || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const amt = Math.round(Number(entry.amount) || 0);
  const ac = String(entry.accountName || '').trim().toLowerCase().slice(0, 15);
  const dt = String(entry.date || '').trim();
  if (bn && amt > 0) return `bill_amt:${bn}:${amt}`;
  return `pay:${amt}:${ac}:${dt}`;
}

function todayDMY() {
  const now = new Date();
  return `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
}

function cleanStr(s: string) {
  return String(s || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findBill(rawBn: string): Bill | undefined {
  const cleanBn = (s: string) => String(s || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const stripGst = (s: string) => cleanBn(s).replace(/^GST/i, '').replace(/^MOC/i, '').replace(/^INV/i, '');
  const c = cleanBn(rawBn);
  const st = stripGst(rawBn);
  if (!c && !st) return undefined;

  const allBills = getBills ? getBills() : [];
  for (const b of allBills) {
    const bc = cleanBn(b.billNo);
    const bs = stripGst(b.billNo);
    if (bc === c || bs === st || bs === c || bc === st) return b;
    // Numeric equality check (e.g. "042911" == "42911")
    const numRaw = parseInt(st, 10);
    const numB = parseInt(bs, 10);
    if (!isNaN(numRaw) && !isNaN(numB) && numRaw === numB) return b;
  }
  return undefined;
}

/** Find matching bills by account name or party name */
function findMatchingBills(accountOrParty: string, allBills: Bill[]): Bill[] {
  const q = cleanStr(accountOrParty);
  if (!q || q.length < 3) return [];

  return allBills.filter((b) => {
    const p = cleanStr(b.partyName);
    return p.includes(q) || q.includes(p);
  });
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
  const [manualBillSearch, setManualBillSearch] = useState('');
  const seenIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: any = null;
    let unmounted = false;

    function connectSSE() {
      if (unmounted) return;
      try {
        es = new EventSource('/api/admin/whatsapp-bot/events');

        es.onmessage = (ev) => {
          try {
            const data = JSON.parse(ev.data);
            if (data?.type !== 'wa-payment' || !Array.isArray(data.entries)) return;

            const storedSeen = getStoredSeen();
            if (storedSeen.has(data.id) || seenIdsRef.current.has(data.id)) return;
            seenIdsRef.current.add(data.id);

            const allBills = getBills ? getBills() : [];
            const newItems: PendingItem[] = [];

            for (const entry of data.entries) {
              const sig = getPaymentSig(entry);
              if (storedSeen.has(sig)) {
                console.log('[Popup] Skipping already seen/processed payment signature:', sig);
                continue;
              }

              // 1. Try matching by bill number
              let bill = findBill(entry.billNo);

              // 2. If no bill number, try matching by account name / party name
              if (!bill && (entry.accountName || entry.partyName)) {
                const candidates = findMatchingBills(entry.accountName || entry.partyName || '', allBills);
                if (candidates.length === 1) {
                  bill = candidates[0];
                } else if (candidates.length > 1) {
                  // Prefer one that is unpaid / outstanding
                  const withOutstanding = candidates.filter((c) => Number(c.outstandingAmount) > 0);
                  if (withOutstanding.length === 1) {
                    bill = withOutstanding[0];
                  } else if (entry.amount > 0) {
                    // Match by outstanding amount equality
                    const exactAmt = withOutstanding.find((c) => Math.abs(Number(c.outstandingAmount) - entry.amount) < 2);
                    if (exactAmt) bill = exactAmt;
                  }
                }
              }

              // Check if bill in app is already marked Paid
              const isAlreadyPaid = Boolean(
                bill && (
                  bill.paymentMode === 'Paid' ||
                  (Number(bill.outstandingAmount) <= 0 && Number(bill.collectedAmount) > 0)
                )
              );

              newItems.push({
                eventId: data.id,
                entry,
                senderName: data.senderName || '',
                sourceLabel: jidLabel(data.fromJid || ''),
                text: data.text || '',
                summary: data.summary || '',
                matched: Boolean(bill),
                bill,
                isAlreadyPaid,
              });
            }

            if (newItems.length === 0) return;

            setQueue((prev) => {
              let list = prev;
              // If this event replaces an earlier unlinked event (replacesEventId):
              if (data.replacesEventId) {
                list = list.filter((p) => p.eventId !== data.replacesEventId);
              }

              // Filter out duplicates that might already be in queue
              const uniqueNew = newItems.filter((ni) => {
                const niSig = getPaymentSig(ni.entry);
                return !list.some((existing) => {
                  if (existing.eventId === ni.eventId && existing.entry.billNo === ni.entry.billNo) return true;
                  return getPaymentSig(existing.entry) === niSig;
                });
              });

              return [...list, ...uniqueNew];
            });
          } catch {}
        };

        es.onerror = () => {
          try { es?.close(); } catch {}
          es = null;
          if (!unmounted) {
            clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(connectSSE, 4000);
          }
        };
      } catch {
        if (!unmounted) {
          clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(connectSSE, 5000);
        }
      }
    }

    connectSSE();

    return () => {
      unmounted = true;
      clearTimeout(reconnectTimer);
      try { es?.close(); } catch {}
    };
  }, []);

  const current = queue[0];
  const allBills = useMemo(() => (getBills ? getBills() : []), []);

  // Suggested bills for unmatched item by accountName or partyName
  const suggestedBills = useMemo(() => {
    if (!current || current.matched) return [];
    const searchTarget = current.entry.accountName || current.entry.partyName || '';
    if (!searchTarget) return [];
    return findMatchingBills(searchTarget, allBills).slice(0, 5);
  }, [current, allBills]);

  // Auto retry matching if bills list loaded late
  useEffect(() => {
    if (current && !current.matched) {
      if (current.entry.billNo) {
        const b = findBill(current.entry.billNo);
        if (b) {
          setQueue((prev) => {
            if (!prev[0]) return prev;
            const copy = [...prev];
            copy[0] = { ...copy[0], matched: true, bill: b };
            return copy;
          });
        }
      } else if (current.entry.accountName || current.entry.partyName) {
        const candidates = findMatchingBills(current.entry.accountName || current.entry.partyName || '', allBills);
        if (candidates.length === 1) {
          setQueue((prev) => {
            if (!prev[0]) return prev;
            const copy = [...prev];
            copy[0] = { ...copy[0], matched: true, bill: candidates[0] };
            return copy;
          });
        }
      }
    }
  }, [current, allBills]);

  function tellServerDismiss(eventId: string, entry?: WaEntry) {
    try {
      storeSeen(eventId);
      if (entry) storeSeen(getPaymentSig(entry));
      fetch('/api/admin/whatsapp-bot/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId,
          paymentDetails: entry ? {
            billNo: entry.billNo,
            amount: entry.amount,
            paymentMethod: entry.paymentMethod,
            accountName: entry.accountName,
            upiId: entry.upiId,
            date: entry.date,
          } : undefined,
        }),
      }).catch(() => {});
    } catch {}
  }

  function dismiss() {
    if (current) {
      tellServerDismiss(current.eventId, current.entry);
      storeSeen(getPaymentSig(current.entry));
      storeSeen(current.eventId);
    }
    setManualBillSearch('');
    setQueue((prev) => prev.slice(1));
  }

  function selectBillManually(b: Bill) {
    setQueue((prev) => {
      if (!prev[0]) return prev;
      const copy = [...prev];
      const isAlreadyPaid = Boolean(
        b.paymentMode === 'Paid' ||
        (Number(b.outstandingAmount) <= 0 && Number(b.collectedAmount) > 0)
      );
      copy[0] = {
        ...copy[0],
        matched: true,
        bill: b,
        isAlreadyPaid,
        entry: { ...copy[0].entry, billNo: b.billNo },
      };
      return copy;
    });
    setManualBillSearch('');
  }

  function handleManualMatch() {
    if (!manualBillSearch.trim()) return;
    const b = findBill(manualBillSearch);
    if (b) {
      selectBillManually(b);
    } else {
      alert(`Bill "${manualBillSearch}" app me nahi mila. Kripya sahi bill number check karein.`);
    }
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

      // Notify server dismissal so it won't replay on client refresh
      tellServerDismiss(current.eventId, current.entry);
      storeSeen(getPaymentSig(current.entry));
      storeSeen(current.eventId);

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
      setManualBillSearch('');
      setQueue((prev) => prev.slice(1));
    } finally {
      setSaving(false);
    }
  }

  if (!current) return null;

  const bill = current.bill;
  const effectiveNet = bill ? Math.max(0, (Number(bill.billNetAmt) || 0) - (Number(bill.lineCutAmt) || 0)) : 0;
  const combinedCount = queue.filter((q) => q.eventId === current.eventId).length;
  const accountName = current.entry.accountName;
  const senderAccountName = current.entry.senderAccountName;

  return (
    <div className="fixed inset-0 z-[200] bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 animate-in fade-in duration-200">
      <div className="bg-card border-2 border-green-500/50 rounded-2xl shadow-2xl w-full max-w-md max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-t-2xl px-4 py-3 flex items-center gap-2.5 shadow-md">
          <div className="p-2 bg-white/20 rounded-xl">
            <Bell className="w-5 h-5 animate-pulse" />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-black uppercase tracking-wider">WhatsApp Payment Received</p>
            <p className="text-[10px] font-bold text-white/90 truncate">
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
          {/* Detected Screenshot / Image Data Card */}
          <div className="bg-gradient-to-br from-emerald-500/15 to-green-500/10 border-2 border-emerald-500/40 rounded-xl p-3.5 space-y-2">
            <div className="flex items-center justify-between pb-2 border-b border-emerald-500/25">
              <span className="text-[10px] font-black uppercase tracking-wider text-emerald-800 dark:text-emerald-200 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                Scanned Payment Details
              </span>
              <span className="text-xs font-black uppercase bg-emerald-600 text-white px-2.5 py-0.5 rounded-md">
                {current.entry.paymentMethod || 'GPay'}
              </span>
            </div>

            {/* Extracted Amount */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-muted-foreground">Scanned Amount:</span>
              <span className="text-lg font-black text-emerald-700 dark:text-emerald-300">
                ₹{(Number(current.entry.amount) || 0).toLocaleString('en-IN')}
              </span>
            </div>

            {/* Extracted Account Name */}
            {accountName && (
              <div className="flex items-start justify-between gap-2 text-xs pt-1 border-t border-emerald-500/15">
                <span className="text-[11px] font-bold text-muted-foreground flex items-center gap-1 shrink-0">
                  <Building2 className="w-3.5 h-3.5 text-emerald-600" /> Account Name:
                </span>
                <span className="font-black text-foreground text-right break-words text-[12px]">
                  {accountName}
                </span>
              </div>
            )}

            {/* Extracted Sender Name */}
            {senderAccountName && (
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-[10.5px] font-bold text-muted-foreground flex items-center gap-1 shrink-0">
                  <UserCheck className="w-3.5 h-3.5 text-muted-foreground" /> Paid By:
                </span>
                <span className="font-semibold text-muted-foreground text-right truncate">
                  {senderAccountName}
                </span>
              </div>
            )}

            {/* UPI ID / Ref */}
            {current.entry.upiId && (
              <div className="flex items-center justify-between gap-2 text-[10.5px]">
                <span className="font-bold text-muted-foreground">UTR / UPI Ref:</span>
                <span className="font-mono text-muted-foreground">{current.entry.upiId}</span>
              </div>
            )}
          </div>

          {/* WhatsApp message snippet if present */}
          {current.text && (
            <div className="bg-muted/60 border border-border rounded-xl px-3 py-2 text-[10.5px] font-medium text-muted-foreground italic">
              "{current.text}"
            </div>
          )}

          {!current.matched ? (
            <div className="bg-amber-500/10 border border-amber-400/40 rounded-xl px-3.5 py-3 space-y-2.5">
              <p className="text-[11px] font-black text-amber-800 dark:text-amber-200 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
                {current.entry.billNo
                  ? `Bill "${current.entry.billNo}" match nahi hua — bill select karein`
                  : 'Image me bill number nahi likha tha — niche se bill select karein:'}
              </p>

              {/* Suggestions based on Account Name */}
              {suggestedBills.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <p className="text-[10px] font-bold text-foreground">
                    "{accountName || current.entry.partyName}" se match hone wale bills:
                  </p>
                  <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                    {suggestedBills.map((sb) => (
                      <button
                        key={sb.id}
                        type="button"
                        onClick={() => selectBillManually(sb)}
                        className="w-full text-left bg-background hover:bg-emerald-500/15 border border-border hover:border-emerald-500/50 rounded-lg p-2 transition-all flex items-center justify-between gap-2 group"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-black font-mono text-foreground group-hover:text-emerald-700 dark:group-hover:text-emerald-300">
                            Bill #{sb.billNo}
                          </p>
                          <p className="text-[10.5px] font-bold text-foreground truncate">{sb.partyName}</p>
                          <p className="text-[9px] text-muted-foreground">Driver: {sb.driverName || '-'} • {sb.beatName || '-'}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs font-black text-red-600 dark:text-red-400">
                            ₹{(Number(sb.outstandingAmount) || 0).toLocaleString('en-IN')}
                          </p>
                          <span className="text-[9px] font-bold text-emerald-600 flex items-center justify-end gap-0.5">
                            Select <ArrowRight className="w-2.5 h-2.5" />
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Manual search input */}
              <div className="pt-2 border-t border-amber-400/30">
                <p className="text-[9.5px] font-bold text-muted-foreground mb-1.5">
                  Ya Bill Number search karke link karein:
                </p>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    placeholder="Enter Bill No (e.g. 42911)"
                    value={manualBillSearch}
                    onChange={(e) => setManualBillSearch(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleManualMatch(); }}
                    className="flex-1 text-xs px-2.5 py-1.5 rounded-lg border border-input bg-background font-mono font-bold"
                  />
                  <button
                    type="button"
                    onClick={handleManualMatch}
                    className="bg-primary text-primary-foreground font-black text-[10px] px-3 py-1.5 rounded-lg flex items-center gap-1 shrink-0"
                  >
                    <Search className="w-3.5 h-3.5" /> Link Bill
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Matched Bill Details */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-[9.5px] font-black uppercase tracking-wider text-muted-foreground">
                    Matched Bill Details:
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setQueue((prev) => {
                        if (!prev[0]) return prev;
                        const copy = [...prev];
                        copy[0] = { ...copy[0], matched: false, bill: undefined };
                        return copy;
                      });
                    }}
                    className="text-[9.5px] font-bold text-muted-foreground hover:text-foreground underline"
                  >
                    Change Bill
                  </button>
                </div>
                <div className="bg-muted/40 border border-border rounded-xl px-3 py-2.5 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-black text-foreground font-mono">#{bill!.billNo}</span>
                    <span className="text-[9px] font-black bg-primary/10 text-primary px-2 py-0.5 rounded-full uppercase">
                      {bill!.paymentMode || 'Unpaid'}
                    </span>
                  </div>
                  <p className="text-[11px] font-black text-foreground">{bill!.partyName || '-'}</p>
                  <p className="text-[9.5px] font-semibold text-muted-foreground">
                    Driver: {bill!.driverName || '-'} • Salesperson: {bill!.salespersonName || '-'} • Beat: {bill!.beatName || '-'}
                  </p>
                  <div className="flex items-center gap-3 pt-1 border-t border-border/60 mt-1.5 text-[10px] font-bold">
                    <span className="text-muted-foreground">Net: <span className="text-foreground">₹{effectiveNet.toLocaleString('en-IN')}</span></span>
                    <span className="text-muted-foreground">Outstanding: <span className="text-red-600 dark:text-red-400">₹{(Number(bill!.outstandingAmount) || 0).toLocaleString('en-IN')}</span></span>
                  </div>
                </div>
              </div>

              {/* Warning if bill is already paid */}
              {current.isAlreadyPaid && (
                <div className="bg-amber-500/15 border-2 border-amber-500/40 rounded-xl p-2.5 space-y-1 animate-in fade-in">
                  <p className="text-[11px] font-black text-amber-800 dark:text-amber-200 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    Warning: Bill #{bill!.billNo} pehle se Paid hai (Outstanding: ₹0)
                  </p>
                  <p className="text-[10px] font-semibold text-muted-foreground">
                    Is bill ka payment pehle hi app me save ho chuka hai. Dobara save karne par duplicate payment create ho sakta hai.
                  </p>
                </div>
              )}

              {/* Adjustment info */}
              <div className="bg-green-500/10 border border-green-500/30 rounded-xl px-3 py-2 text-xs space-y-1 text-center">
                <p className="text-[10px] font-bold text-muted-foreground">Payment to be applied:</p>
                <p className="text-sm font-black text-green-700 dark:text-green-300">
                  ₹{(Number(current.entry.amount) || effectiveNet).toLocaleString('en-IN')} ({current.entry.paymentMethod || 'GPay'})
                </p>
                <p className="text-[9.5px] text-muted-foreground">
                  New Outstanding: <span className="font-bold text-foreground">₹{Math.max(0, effectiveNet - (Number(current.entry.amount) || effectiveNet)).toLocaleString('en-IN')}</span>
                </p>
              </div>

              {combinedCount > 1 && (
                <p className="text-[9.5px] font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  Ek hi payment {combinedCount} bills ({queue.filter(q => q.eventId === current.eventId).map(q => q.entry.billNo).join(', ')}) ke against hai.
                </p>
              )}
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
                className={cn(
                  'flex-1 text-white font-black text-[11px] uppercase tracking-wider px-4 py-2.5 rounded-xl shadow-md flex items-center justify-center gap-1.5 transition-all active:scale-95',
                  current.isAlreadyPaid ? 'bg-amber-600 hover:bg-amber-700' : 'bg-green-600 hover:bg-green-700'
                )}
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {current.isAlreadyPaid ? 'Already Paid (Overwrite)' : 'Confirm & Save Payment'}
              </button>
            )}
            <button
              type="button"
              onClick={dismiss}
              className={cn(
                'flex-1 bg-muted hover:bg-destructive/10 text-foreground hover:text-destructive font-black text-[11px] uppercase tracking-wider px-4 py-2.5 rounded-xl border border-border flex items-center justify-center gap-1.5 transition-all active:scale-95'
              )}
            >
              <XCircle className="w-4 h-4" /> {current.isAlreadyPaid ? 'Already Recorded (Skip)' : (current.matched ? 'Skip / Cancel' : 'Close')}
            </button>
          </div>
          <p className="text-[9px] text-center font-bold text-muted-foreground">
            ⚠ Payment confirm karne ke bad hi bill me update hota hai.
          </p>
        </div>
      </div>
    </div>
  );
}
