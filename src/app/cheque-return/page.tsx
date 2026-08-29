import { useState, useEffect, useMemo, useRef } from 'react';
import { RotateCcw, Search, Check, Loader2, Trash2, AlertTriangle, X, Plus, MessageCircle } from 'lucide-react';
import TopNav from '@/components/TopNav';
import { useBillStore } from '@/hooks/use-bill-store';
import { getBills, getSalespersonContacts, getWhatsAppTemplates, patchBillInMemory, getTodayDMY } from '@/lib/billStore';
import { apiPushSetting } from '@/lib/apiSync';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// ── Types ─────────────────────────────────────────────────────────────────────
export type ChequeReturnEntry = {
  id: string;
  entryDate: string;        // DD/MM/YYYY — return date (user-selected)
  billNos: string[];        // all bill nos across all cheques
  partyName: string;
  chequeNo: string;         // "CHQ1+CHQ2" when multiple
  chequeAmt: number;        // sum of all linked bills' collected amount
  chequeDate: string;       // from first cheque's bill
  bankName: string;         // from first cheque's bill
  giveSalesperson: string;  // auto-filled from linked bill, editable inline
  giveDate: string;         // filled inline in table
};

// ── Single cheque preview (before saving) ────────────────────────────────────
type ChequePreview = {
  cheqNo: string;
  billNos: string[];
  partyName: string;
  bankName: string;
  chequeDate: string;
  amt: number;
};

// ── Storage helpers ───────────────────────────────────────────────────────────
const SETTINGS_KEY = 'cheque_returns';

async function loadEntries(): Promise<ChequeReturnEntry[]> {
  try {
    const { data } = await supabase
      .from('settings')
      .select('value')
      .eq('key', SETTINGS_KEY)
      .maybeSingle();
    if (!data?.value) return [];
    return JSON.parse(data.value) as ChequeReturnEntry[];
  } catch {
    return [];
  }
}

async function persistEntries(entries: ChequeReturnEntry[]) {
  return apiPushSetting(SETTINGS_KEY, JSON.stringify(entries));
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function stripGST(no: string) {
  return (no || '').replace(/^GST[-/]?/i, '').trim();
}

function getTodayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function isoToDMY(iso: string) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function dmyToISO(dmy: string) {
  if (!dmy) return '';
  const parts = dmy.split('/');
  if (parts.length !== 3) return '';
  const [d, m, y] = parts;
  return `${y}-${m}-${d}`;
}

function formatMobile(raw: string) {
  const mobile = String(raw || '').trim();
  if (!mobile) return '';
  return mobile.startsWith('+') ? mobile : mobile.startsWith('91') ? `+${mobile}` : `+91${mobile}`;
}

function getBillSalesperson(entry: ChequeReturnEntry) {
  const bills = getBills();
  const billByNumber = new Map(
    bills.map(b => [stripGST(b.billNo).toLowerCase(), b])
  );
  return entry.billNos
    .map(billNo => billByNumber.get(stripGST(billNo).toLowerCase())?.salespersonName?.trim() || '')
    .find(Boolean) || '';
}

function buildReturnChequeMessage(entry: ChequeReturnEntry) {
  const bills = getBills();
  const billNos = entry.billNos.map(stripGST).join('+');
  const totalAmt = entry.billNos.reduce((total, billNo) => {
    const bill = bills.find(b => b.billNo.trim() === billNo.trim());
    if (!bill) return total;
    return total + Math.max(0, (Number(bill.billNetAmt) || 0) - (Number(bill.lineCutAmt) || 0));
  }, 0);

  return getWhatsAppTemplates().returnCheque
    .replace(/{{partyName}}/g, entry.partyName)
    .replace(/{{allBillNos}}/g, billNos)
    .replace(/{{totalAmt}}/g, totalAmt.toLocaleString('en-IN'))
    .replace(/{{chequeAmt}}/g, (Number(entry.chequeAmt) || 0).toLocaleString('en-IN'))
    .replace(/{{chequeNo}}/g, entry.chequeNo || '-')
    .replace(/{{chequeDate}}/g, entry.chequeDate || '-')
    .replace(/{{bankName}}/g, entry.bankName || '-');
}

// Cheque amount for a specific cheque no, checking all storage locations:
// 1. partPayments entries matching the cheque no
// 2. chequeAmount (split breakdown)
// 3. collectedAmount (full single-cheque payment)
function billCheqAmt(b: ReturnType<typeof getBills>[number], cheqNo?: string): number {
  // 1. partPayments — find entries matching this specific cheque no
  if (b.partPayments && b.partPayments.length > 0) {
    if (cheqNo) {
      const q = cheqNo.toLowerCase();
      const matching = b.partPayments.filter(
        p => p.chequeNo && p.chequeNo.trim().toLowerCase() === q
      );
      if (matching.length > 0) {
        const total = matching.reduce((s, p) => s + (Number(p.cheque) || Number(p.amount) || 0), 0);
        if (total > 0) return total;
      }
    }
    // No specific match — sum all cheque portions across partPayments
    const ppChequeTotal = b.partPayments.reduce((s, p) => s + (Number(p.cheque) || 0), 0);
    if (ppChequeTotal > 0) return ppChequeTotal;
  }
  // 2. chequeAmount from split breakdown
  if (Number(b.chequeAmount) > 0) return Number(b.chequeAmount);
  // 3. collectedAmount — full payment was by cheque
  return Number(b.collectedAmount) || 0;
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function ChequeReturnPage() {
  const { bills, refresh } = useBillStore();

  // Multi-cheque form state
  const [cheqInput, setCheqInput]         = useState('');
  const [addedCheques, setAddedCheques]   = useState<ChequePreview[]>([]); // confirmed chips
  const [previewError, setPreviewError]   = useState('');
  const [returnDate, setReturnDate]       = useState(getTodayISO());
  const [saving, setSaving]               = useState(false);
  const [saveMsg, setSaveMsg]             = useState('');

  // Entries
  const [entries, setEntries]             = useState<ChequeReturnEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(true);

  // Inline table editing
  const [editingId, setEditingId]         = useState<string | null>(null);
  const [editSP, setEditSP]               = useState('');
  const [editGiveDate, setEditGiveDate]   = useState('');
  const [savingInline, setSavingInline]   = useState(false);

  // Delete confirm
  const [deleteId, setDeleteId]           = useState<string | null>(null);

  const cheqRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadEntries().then(e => {
      setEntries(e);
      setLoadingEntries(false);
    });
  }, []);

  // Salesperson list
  const spList = useMemo(() => {
    const contacts = getSalespersonContacts().map(c => c.name);
    const fromBills = [...new Set(bills.map(b => b.salespersonName).filter(Boolean))];
    const seen = new Set<string>();
    const merged: string[] = [];
    [...contacts, ...fromBills].forEach(n => {
      const key = n.toLowerCase().trim();
      if (n && !seen.has(key)) { seen.add(key); merged.push(n); }
    });
    return merged.sort((a, b) => a.localeCompare(b));
  }, [bills]);

  // Active entries — keep showing while any linked bill is:
  //   • collectedAmount === 0 (unpaid / returned), OR
  //   • paymentMode is credit/unpaid/pending/del pending
  // Entry disappears only when ALL linked bills are genuinely re-paid
  // (collectedAmount > 0 AND mode is not credit-like)
  const activeEntries = useMemo(() => {
    const billMap = new Map(getBills().map(b => [b.billNo.trim(), b]));
    return entries.filter(entry =>
      entry.billNos.some(billNo => {
        const b = billMap.get(billNo.trim());
        if (!b) return true; // bill not in store — keep entry
        const mode = (b.paymentMode || '').toLowerCase();
        const isCreditLike = mode === 'credit' || mode === 'unpaid' || mode === 'pending' || mode === 'del pending';
        // Keep in active list while still unpaid/credit
        return (Number(b.collectedAmount) || 0) === 0 || isCreditLike;
      })
    );
  }, [entries, bills]);

  // All added cheque nos (for duplicate check)
  const addedCheqNos = useMemo(
    () => new Set(addedCheques.map(c => c.cheqNo.toLowerCase())),
    [addedCheques]
  );

  // Combined summary across all added cheques
  const combined = useMemo(() => {
    if (addedCheques.length === 0) return null;
    const allBillNos = [...new Set(addedCheques.flatMap(c => c.billNos))];
    const totalAmt   = addedCheques.reduce((s, c) => s + c.amt, 0);
    const first      = addedCheques[0];
    return {
      billNos:    allBillNos,
      partyName:  first.partyName,
      bankName:   first.bankName,
      chequeDate: first.chequeDate,
      totalAmt,
      chequeNos:  addedCheques.map(c => c.cheqNo).join('+'),
    };
  }, [addedCheques]);

  // ── Cheque lookup ─────────────────────────────────────────────────────────
  function lookupCheque() {
    const q = cheqInput.trim();
    if (!q) { setPreviewError('Cheque number darj karo.'); return; }

    // Already added in this session
    if (addedCheqNos.has(q.toLowerCase())) {
      setPreviewError(`Cheque "${q}" already is entry me add hai.`);
      return;
    }

    const allBills = getBills();
    const matched = allBills.filter(b => {
      // Match on bill-level chequeNo
      const bCheq = (b.chequeNo || '').trim();
      if (bCheq && bCheq.toLowerCase() === q.toLowerCase()) return true;
      // Also match if any partPayment entry has this cheque no
      if (b.partPayments?.some(p => p.chequeNo?.trim().toLowerCase() === q.toLowerCase())) return true;
      return false;
    });

    if (matched.length === 0) {
      setPreviewError(`Cheque no. "${q}" kisi bhi bill me nahi mila.`);
      return;
    }

    // Already in active return list
    const alreadyActive = activeEntries.some(
      e => e.chequeNo.split('+').map(x => x.trim().toLowerCase()).includes(q.toLowerCase())
    );
    if (alreadyActive) {
      setPreviewError(`Cheque "${q}" already active return list me hai.`);
      return;
    }

    const first = matched[0];
    // Amount = sum across all matched bills, checking partPayments first
    const amt = matched.reduce((s, b) => s + billCheqAmt(b, q), 0);

    const preview: ChequePreview = {
      cheqNo:     q,
      billNos:    matched.map(b => b.billNo),
      partyName:  first.partyName  || '',
      bankName:   first.bankName   || '',
      chequeDate: first.chequeDate || '',
      amt,
    };

    setAddedCheques(prev => [...prev, preview]);
    setCheqInput('');
    setPreviewError('');
    cheqRef.current?.focus();
  }

  function removeCheque(cheqNo: string) {
    setAddedCheques(prev => prev.filter(c => c.cheqNo !== cheqNo));
  }

  function clearForm() {
    setCheqInput('');
    setAddedCheques([]);
    setPreviewError('');
    setReturnDate(getTodayISO());
  }

  // ── Save return entry + convert all matched bills → Credit ────────────────
  async function handleSave() {
    if (!combined || saving) return;
    setSaving(true);
    setSaveMsg('');

    try {
      const allBills = getBills();
      let failedBills = 0;

      for (const billNo of combined.billNos) {
        const bill = allBills.find(b => b.billNo === billNo);
        const lineCut    = Number(bill?.lineCutAmt) || 0;
        const outstanding = bill ? Math.max(0, bill.billNetAmt - lineCut) : 0;

        const ok = await patchBillInMemory(billNo, {
          paymentMode:       'Credit',
          collectedAmount:   0,
          cashAmount:        0,
          upiAmount:         0,
          chequeAmount:      0,
          outstandingAmount: outstanding,
          paymentDate:       '',
        });
        if (!ok) failedBills++;
      }

      if (failedBills > 0) {
        setSaveMsg(`✗ ${failedBills} bill(s) save nahi hue — internet check karke dobara try karein.`);
        setSaving(false);
        return;
      }


      const newEntryBase: ChequeReturnEntry = {
        id:              `chr_${Date.now()}`,
        entryDate:       returnDate ? isoToDMY(returnDate) : getTodayDMY(),
        billNos:         combined.billNos,
        partyName:       combined.partyName,
        chequeNo:        combined.chequeNos,
        chequeAmt:       combined.totalAmt,
        chequeDate:      combined.chequeDate,
        bankName:        combined.bankName,
        giveSalesperson: '',
        giveDate:        '',
      };
      const newEntry: ChequeReturnEntry = {
        ...newEntryBase,
        giveSalesperson: getBillSalesperson(newEntryBase),
      };

      const updated = [...entries, newEntry];
      await persistEntries(updated);
      setEntries(updated);

      clearForm();
      setSaveMsg('✓ Cheque return entry save ho gaya! Bills Credit me convert ho gaye.');
      refresh();
      setTimeout(() => setSaveMsg(''), 4000);
    } catch {
      setSaveMsg('Save nahi hua — dobara try karein.');
    } finally {
      setSaving(false);
    }
  }

  // ── Inline table edit (SP + give date) ───────────────────────────────────
  async function handleInlineSave(id: string) {
    setSavingInline(true);
    try {
      const updated = entries.map(e =>
        e.id === id
          ? { ...e, giveSalesperson: editSP.trim(), giveDate: editGiveDate ? isoToDMY(editGiveDate) : '' }
          : e
      );
      await persistEntries(updated);
      setEntries(updated);
      setEditingId(null);
    } finally {
      setSavingInline(false);
    }
  }

  function startEdit(entry: ChequeReturnEntry) {
    setEditingId(entry.id);
    setEditSP(getBillSalesperson(entry) || entry.giveSalesperson.trim());
    setEditGiveDate(entry.giveDate ? dmyToISO(entry.giveDate) : getTodayISO());
  }

  function sendReturnMessage(entry: ChequeReturnEntry) {
    const salesperson = getBillSalesperson(entry) || entry.giveSalesperson.trim();
    const contact = getSalespersonContacts().find(
      c => c.name.trim().toLowerCase() === salesperson.trim().toLowerCase()
    );
    const mobile = formatMobile(contact?.mobile || '');
    if (!mobile) {
      window.alert(`Salesperson "${salesperson || '—'}" ka WhatsApp number saved nahi hai.`);
      return;
    }
    const message = buildReturnChequeMessage(entry);
    const encodedMsg = encodeURIComponent(message);
    window.location.href = `whatsapp://send?phone=${mobile}&text=${encodedMsg}`;
  }

  // ── Delete entry ─────────────────────────────────────────────────────────
  async function handleDelete(id: string) {
    const updated = entries.filter(e => e.id !== id);
    await persistEntries(updated);
    setEntries(updated);
    setDeleteId(null);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background pb-16">
      <TopNav />

      <div className="pt-12 px-1.5">

        {/* ── Header ── */}
        <div className="flex items-center gap-1.5 px-1 py-1.5">
          <RotateCcw className="w-3.5 h-3.5 text-destructive shrink-0" />
          <h1 className="text-[11px] font-black uppercase tracking-widest text-foreground leading-none">Cheque Return</h1>
          <span className="text-[8px] text-muted-foreground uppercase tracking-widest">— Bounced cheque entry</span>
        </div>

        {/* ── Entry Form ── */}
        <div className="bg-card border border-border rounded-xl p-2 mb-1.5 shadow-sm">

          {/* Row 1: Cheque input + Return Date side by side */}
          <div className="flex gap-1.5 mb-1.5">
            {/* Cheque search */}
            <div className="flex gap-1 flex-1 min-w-0">
              <input
                ref={cheqRef}
                type="text"
                value={cheqInput}
                onChange={e => { setCheqInput(e.target.value); setPreviewError(''); }}
                onKeyDown={e => { if (e.key === 'Enter') lookupCheque(); }}
                placeholder={addedCheques.length === 0 ? 'CHEQUE NO...' : 'ADD MORE...'}
                className="flex-1 min-w-0 h-8 px-2 bg-muted rounded-lg text-[10px] font-black uppercase border border-border outline-none focus:border-primary tracking-widest"
              />
              <button
                onClick={lookupCheque}
                className="h-8 px-2 rounded-lg bg-muted border border-border hover:border-primary flex items-center gap-1 shrink-0"
              >
                {addedCheques.length === 0
                  ? <Search className="w-3 h-3 text-muted-foreground" />
                  : <Plus   className="w-3 h-3 text-primary" />
                }
                <span className="text-[8px] font-black uppercase text-muted-foreground">
                  {addedCheques.length === 0 ? 'SRCH' : 'ADD'}
                </span>
              </button>
            </div>

            {/* Return Date — beside search */}
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-[7px] font-black text-muted-foreground uppercase whitespace-nowrap">Ret.Date</span>
              <input
                type="date"
                value={returnDate}
                onChange={e => setReturnDate(e.target.value || getTodayISO())}
                className="h-8 px-1.5 bg-muted rounded-lg text-[9px] font-black border border-border outline-none focus:border-primary w-[112px]"
              />
            </div>
          </div>

          {/* Added cheque chips */}
          {addedCheques.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-1.5">
              {addedCheques.map(c => (
                <div key={c.cheqNo} className="flex items-center gap-1 bg-primary/10 border border-primary/30 rounded-full px-1.5 py-0.5">
                  <span className="text-[9px] font-black text-primary tracking-widest">{c.cheqNo}</span>
                  <span className="text-[8px] text-muted-foreground">{c.billNos.map(n => stripGST(n)).join('+')}</span>
                  {c.amt > 0 && <span className="text-[8px] font-black text-destructive">₹{c.amt.toLocaleString('en-IN')}</span>}
                  <button onClick={() => removeCheque(c.cheqNo)} className="text-muted-foreground hover:text-destructive">
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Error */}
          {previewError && (
            <div className="flex items-center gap-1.5 bg-destructive/10 border border-destructive/20 rounded-lg px-2 py-1 mb-1.5">
              <AlertTriangle className="w-3 h-3 text-destructive shrink-0" />
              <p className="text-[9px] font-bold text-destructive">{previewError}</p>
            </div>
          )}

          {/* Combined Summary */}
          {combined && (
            <div className="bg-primary/5 border border-primary/20 rounded-lg px-2 py-1.5 mb-1.5">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[7px] font-black uppercase tracking-widest text-primary">
                  {addedCheques.length} Cheque{addedCheques.length > 1 ? 's' : ''} — Summary
                </p>
                <button onClick={clearForm} className="text-muted-foreground hover:text-foreground">
                  <X className="w-3 h-3" />
                </button>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 mb-1">
                <span className="text-[8px] font-bold text-muted-foreground">
                  Bank: <span className="text-foreground">{combined.bankName || '—'}</span>
                </span>
                <span className="text-[8px] font-bold text-muted-foreground">
                  Chq Date: <span className="text-foreground">{combined.chequeDate || '—'}</span>
                </span>
                <span className="text-[8px] font-bold text-muted-foreground">
                  Party: <span className="text-foreground uppercase">{combined.partyName || '—'}</span>
                </span>
                <span className="text-[8px] font-bold text-muted-foreground">
                  Amt: <span className="text-destructive font-black text-[11px]">₹{combined.totalAmt.toLocaleString('en-IN')}</span>
                </span>
              </div>
              <p className="text-[7px] font-black text-muted-foreground uppercase mb-0.5">
                Bills ({combined.billNos.length})
              </p>
              <p className="text-[11px] font-black tracking-widest text-primary">
                {combined.billNos.map(n => stripGST(n)).join(' • ')}
              </p>
            </div>
          )}

          {/* Save Button */}
          {combined && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full h-9 rounded-lg font-black uppercase text-[10px] bg-destructive hover:bg-destructive/90 text-white flex items-center justify-center gap-1.5 disabled:opacity-60"
            >
              {saving
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving...</>
                : <><Check className="w-3.5 h-3.5" /> CONFIRM — Credit me Convert</>
              }
            </button>
          )}

          {saveMsg && (
            <p className={cn(
              "text-[9px] font-bold mt-1 text-center uppercase",
              saveMsg.startsWith('✓') ? 'text-emerald-600' : 'text-destructive'
            )}>
              {saveMsg}
            </p>
          )}
        </div>

        {/* ── Active Returns Table ── */}
        <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
          <div className="flex items-center justify-between px-2 py-1.5 border-b border-border">
            <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">Active Cheque Returns</p>
            <span className={cn(
              "text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full",
              activeEntries.length > 0 ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'
            )}>
              {activeEntries.length}
            </span>
          </div>

          {loadingEntries ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : activeEntries.length === 0 ? (
            <div className="py-8 text-center">
              <RotateCcw className="w-6 h-6 text-muted-foreground/30 mx-auto mb-1" />
              <p className="text-[9px] font-black text-muted-foreground uppercase">Koi active cheque return nahi hai</p>
              <p className="text-[8px] text-muted-foreground/60 mt-0.5">Bills re-collect hone par auto-remove ho jayenge</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[8px]">
                <thead>
                  <tr className="bg-muted/40 border-b border-border">
                    {[
                      { label: '#',          align: 'text-left'  },
                      { label: 'RET DATE',   align: 'text-left'  },
                      { label: 'BILL NO',    align: 'text-left'  },
                      { label: 'PARTY',      align: 'text-left'  },
                      { label: 'CHQ NO',     align: 'text-left'  },
                      { label: 'AMT',        align: 'text-right' },
                      { label: 'BANK',       align: 'text-left'  },
                      { label: 'GIVE TO SP', align: 'text-left'  },
                      { label: 'GIVE DATE',  align: 'text-left'  },
                      { label: '',           align: 'text-left'  },
                    ].map(h => (
                      <th key={h.label} className={`px-1.5 py-1 font-black text-muted-foreground uppercase whitespace-nowrap ${h.align}`}>
                        {h.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeEntries.map((entry, i) => {
                    const isEditing = editingId === entry.id;
                    const resolvedSalesperson = getBillSalesperson(entry) || entry.giveSalesperson.trim();
                    return (
                      <tr key={entry.id} className="border-b border-border/30 hover:bg-muted/10 transition-colors">
                        <td className="px-1.5 py-1 font-black text-muted-foreground">{i + 1}</td>
                        <td className="px-1.5 py-1 font-bold whitespace-nowrap">{entry.entryDate}</td>
                        <td className="px-1.5 py-1 font-black text-primary whitespace-nowrap">
                          {entry.billNos.map(n => stripGST(n)).join('+')}
                        </td>
                        <td className="px-1.5 py-1 font-bold max-w-[80px] truncate">{entry.partyName}</td>
                        <td className="px-1.5 py-1 font-black tracking-wide whitespace-nowrap">{entry.chequeNo}</td>
                        <td className="px-1.5 py-1 font-black text-right text-destructive whitespace-nowrap">
                          {entry.chequeAmt > 0 ? `₹${entry.chequeAmt.toLocaleString('en-IN')}` : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-1.5 py-1 font-bold max-w-[70px] truncate">{entry.bankName || '—'}</td>

                        {/* Give SP — tap to edit */}
                        <td className="px-1.5 py-1 min-w-[90px]">
                          {isEditing ? (
                            <>
                              <input
                                list="sp-list-cr-inline"
                                type="text"
                                value={editSP}
                                onChange={e => setEditSP(e.target.value)}
                                placeholder="SP..."
                                autoFocus
                                className="w-full h-6 px-1.5 bg-muted rounded text-[8px] font-black uppercase border border-primary outline-none"
                              />
                              <datalist id="sp-list-cr-inline">
                                {spList.map(s => <option key={s} value={s} />)}
                              </datalist>
                            </>
                          ) : (
                            <button
                              onClick={() => startEdit(entry)}
                              className={cn(
                                "text-left w-full font-bold truncate max-w-[85px] hover:text-primary transition-colors",
                                resolvedSalesperson ? 'text-amber-700' : 'text-muted-foreground/40 italic'
                              )}
                            >
                              {resolvedSalesperson || '—'}
                            </button>
                          )}
                        </td>

                        {/* Give Date — tap to edit */}
                        <td className="px-1.5 py-1 min-w-[90px]">
                          {isEditing ? (
                            <input
                              type="date"
                              value={editGiveDate}
                              onChange={e => setEditGiveDate(e.target.value)}
                              className="w-full h-6 px-1.5 bg-muted rounded text-[8px] font-black border border-primary outline-none"
                            />
                          ) : (
                            <button
                              onClick={() => startEdit(entry)}
                              className={cn(
                                "text-left w-full font-bold whitespace-nowrap hover:text-primary transition-colors",
                                entry.giveDate ? '' : 'text-muted-foreground/40 italic'
                              )}
                            >
                              {entry.giveDate || '—'}
                            </button>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="px-1.5 py-1 whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => sendReturnMessage(entry)}
                              title="Send cheque return message on WhatsApp"
                              className="text-emerald-600 hover:text-emerald-700"
                            >
                              <MessageCircle className="w-3 h-3" />
                            </button>
                            {isEditing ? (
                              <button
                                onClick={() => handleInlineSave(entry.id)}
                                disabled={savingInline}
                                className="text-emerald-600 hover:text-emerald-700"
                              >
                                {savingInline ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                              </button>
                              ) : null}
                              {isEditing ? (
                                <button onClick={() => setEditingId(null)} className="text-muted-foreground hover:text-foreground">
                                  <X className="w-3 h-3" />
                                </button>
                              ) : (
                                <button onClick={() => setDeleteId(entry.id)} className="text-muted-foreground hover:text-destructive">
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Delete Confirm Modal ── */}
      {deleteId && (
        <div className="fixed inset-0 bg-black/60 z-[200] flex items-center justify-center px-4 backdrop-blur-sm">
          <div className="bg-card rounded-xl p-4 w-full max-w-xs shadow-2xl border border-border text-center">
            <Trash2 className="w-5 h-5 text-destructive mx-auto mb-2" />
            <h3 className="font-black text-xs uppercase mb-1">Entry Delete Karo?</h3>
            <p className="text-[9px] text-muted-foreground mb-3 font-bold">
              Sirf return entry delete hogi. Bills Credit me hi rahenge.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setDeleteId(null)} className="flex-1 rounded-lg font-black uppercase text-[9px] h-8">
                Cancel
              </Button>
              <Button
                onClick={() => handleDelete(deleteId)}
                className="flex-1 rounded-lg font-black uppercase text-[9px] h-8 bg-destructive hover:bg-destructive/90 text-white border-0"
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
