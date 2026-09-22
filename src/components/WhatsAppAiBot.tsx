import React, { useState, useRef, useMemo } from 'react';
import {
  MessageSquare, Image as ImageIcon, Loader2, CheckCircle2, XCircle,
  Send, Upload, RefreshCw, ClipboardPaste, Key, ShieldCheck, AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { bulkPatchBillsInMemory, getBills, Bill } from '@/lib/billStore';

/** One extracted payment entry from the WhatsApp screenshot/text. */
type ExtractedEntry = {
  billNo: string;
  amount: number;
  paymentMethod: string;
  date: string;
  partyName?: string;
  remarks?: string;
};

/** Entry after matching against the bills in memory. */
type MatchedEntry = {
  extracted: ExtractedEntry;
  matched: boolean;
  bill?: Bill;
  confirm: boolean;
  amount: number;
  paymentMethod: string;
  date: string;
};

function todayDMY() {
  const now = new Date();
  return `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
}

export function WhatsAppAiBot() {
  const [mode, setMode] = useState<'image' | 'text'>('image');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState('');
  const [entries, setEntries] = useState<MatchedEntry[]>([]);
  const [pastedText, setPastedText] = useState('');

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Admin page saved Gemini API key (same localStorage slot as AdminAiAgent)
  const [geminiApiKey, setGeminiApiKey] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('gemini_api_key') || '';
    }
    return '';
  });

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Sirf image/screenshot file upload karein (JPG, PNG, WEBP).');
      return;
    }
    setError(null);
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = () => setImagePreview(String(reader.result));
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function clearImage() {
    setImageFile(null);
    setImagePreview(null);
  }

  async function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).replace(/^data:[^;]+;base64,/, ''));
      reader.onerror = () => reject(new Error('File read failed'));
      reader.readAsDataURL(file);
    });
  }

  // ── Match an extracted bill no against bills in memory (same matching as AdminAiAgent) ──
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

  async function handleExtract() {
    if (mode === 'image' && !imageFile) {
      setError('Pehle WhatsApp group ka screenshot/image upload karein.');
      return;
    }
    if (mode === 'text' && !pastedText.trim()) {
      setError('Pehle WhatsApp group ka text paste karein.');
      return;
    }
    if (!geminiApiKey.trim()) {
      setError('Gemini API key required — Admin AI Agent section me key save karein. WhatsApp AI sirf admin page ki key use karta hai.');
      return;
    }

    setLoading(true);
    setError(null);
    setEntries([]);
    setSummary('');
    setSaveMessage(null);

    try {
      const body: Record<string, any> = {
        action: 'extract',
        apiKey: geminiApiKey.trim(),
      };
      if (mode === 'image' && imageFile) {
        body.imageBase64 = await fileToBase64(imageFile);
        body.imageMime = imageFile.type || 'image/jpeg';
      }
      if (mode === 'text' && pastedText.trim()) {
        body.text = pastedText.trim();
      }

      const res = await fetch('/api/admin/whatsapp-ai', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-gemini-api-key': geminiApiKey.trim(),
        },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({ ok: false, error: 'Server response invalid.' }));
      if (!data?.ok) {
        setError(data?.error || 'AI extraction failed.');
        return;
      }

      const extracted: ExtractedEntry[] = Array.isArray(data.entries) ? data.entries : [];
      setSummary(data.summary || '');

      const matched: MatchedEntry[] = extracted.map((e) => {
        const bill = findBill(e.billNo);
        return {
          extracted: e,
          matched: Boolean(bill),
          bill,
          confirm: false, // Har entry default UNCONFIRMED — user khud confirm karega
          amount: Number(e.amount) || 0,
          paymentMethod: e.paymentMethod || 'Cash',
          date: e.date || todayDMY(),
        };
      });
      setEntries(matched);
    } catch (err: any) {
      setError(err?.message || 'Extraction failed.');
    } finally {
      setLoading(false);
    }
  }

  function toggleConfirm(idx: number) {
    setEntries((prev) => prev.map((e, i) => (i === idx ? { ...e, confirm: !e.confirm } : e)));
  }

  function updateEntry(idx: number, patch: Partial<MatchedEntry>) {
    setEntries((prev) => prev.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  }

  // ── Save ONLY confirmed entries (payment credit) ──
  async function handleSaveConfirmed() {
    const confirmed = entries.filter((e) => e.confirm && e.matched && e.bill);
    if (confirmed.length === 0) {
      setError('Koi entry confirm nahi hui. Pehle jinko save karna hai unhe confirm karein.');
      return;
    }

    setSaving(true);
    setError(null);
    setSaveMessage(null);

    try {
      const patches = confirmed.map((e) => {
        const bill = e.bill!;
        const netAmt = Number(bill.billNetAmt) || 0;
        const lineCut = Number(bill.lineCutAmt) || 0;
        const effectiveNet = Math.max(0, netAmt - lineCut);
        const amount = e.amount > 0 ? Math.min(e.amount, effectiveNet) : effectiveNet;
        const outstanding = Math.max(0, effectiveNet - amount);
        const method = e.paymentMethod || 'Cash';

        return {
          id: bill.id,
          billNo: bill.billNo,
          changes: {
            paymentMode: outstanding <= 0 ? 'Paid' : 'Credit',
            paymentMethod: method,
            paymentDate: e.date || todayDMY(),
            collectedAmount: amount,
            outstandingAmount: outstanding,
            cashAmount: method === 'Cash' ? amount : 0,
            upiAmount: method === 'UPI' ? amount : 0,
            chequeAmount: method === 'Cheque' ? amount : 0,
          },
        };
      });

      const res = await bulkPatchBillsInMemory(patches);

      // Backend Postgres sync (best-effort, same as AdminAiAgent)
      try {
        fetch('/api/admin/ai-agent', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-gemini-api-key': geminiApiKey.trim() || '',
          },
          body: JSON.stringify({ action: 'execute', patches: patches.slice(0, 500) }),
        }).catch(() => {});
      } catch {}

      setSaveMessage(`✅ ${res.updatedCount} bills me payment credit ho gaya (confirm karne ke bad save hua).`);

      // Remove saved entries from the list
      setEntries((prev) => prev.filter((e) => !e.confirm));
    } catch (err: any) {
      setError(err?.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  const confirmedCount = useMemo(() => entries.filter((e) => e.confirm && e.matched).length, [entries]);
  const matchedCount = useMemo(() => entries.filter((e) => e.matched).length, [entries]);

  return (
    <div className="bg-card border-2 border-emerald-500/25 rounded-2xl p-4 sm:p-6 shadow-xl space-y-4 my-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between pb-3 border-b border-border/70 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-gradient-to-tr from-emerald-500/20 to-green-600/20 text-emerald-600 border border-emerald-500/30 shadow-sm">
            <MessageSquare className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-black uppercase text-foreground tracking-wider">
                WhatsApp AI Payment Bot
              </h2>
              <span className="bg-gradient-to-r from-emerald-600 to-green-500 text-white text-[9.5px] font-black px-2.5 py-0.5 rounded-full flex items-center gap-1 shadow-xs tracking-wide">
                <ShieldCheck className="w-3 h-3" /> CONFIRM-THEN-SAVE
              </span>
            </div>
            <p className="text-xs text-muted-foreground font-semibold mt-0.5">
              WhatsApp group ke screenshot, image ya text se AI bill no nikalega aur payment credit karega. Har entry aapke confirm karne ke bad hi save hoti hai.
            </p>
          </div>
        </div>
        <div
          className={cn(
            'text-[10px] font-extrabold px-3 py-1.5 rounded-xl border flex items-center gap-1.5 shadow-2xs',
            geminiApiKey.trim()
              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-400 dark:border-emerald-800'
              : 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-400 dark:border-amber-800'
          )}
          title="Gemini API Key (Admin page saved)"
        >
          <Key className="w-3.5 h-3.5" />
          {geminiApiKey.trim() ? 'Admin API Key Active' : 'API Key Missing'}
        </div>
      </div>

      {/* ── Mode Tabs ── */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMode('image')}
          className={cn(
            'flex-1 text-[11px] font-black uppercase tracking-wider px-3 py-2 rounded-xl border transition-all flex items-center justify-center gap-1.5',
            mode === 'image'
              ? 'bg-emerald-500/15 border-emerald-400 text-emerald-700 dark:text-emerald-300'
              : 'bg-muted/50 border-border text-muted-foreground hover:bg-accent'
          )}
        >
          <ImageIcon className="w-4 h-4" /> Screenshot / Image
        </button>
        <button
          type="button"
          onClick={() => setMode('text')}
          className={cn(
            'flex-1 text-[11px] font-black uppercase tracking-wider px-3 py-2 rounded-xl border transition-all flex items-center justify-center gap-1.5',
            mode === 'text'
              ? 'bg-emerald-500/15 border-emerald-400 text-emerald-700 dark:text-emerald-300'
              : 'bg-muted/50 border-border text-muted-foreground hover:bg-accent'
          )}
        >
          <ClipboardPaste className="w-4 h-4" /> Paste Text
        </button>
      </div>

      {/* ── Image Upload ── */}
      {mode === 'image' && (
        <div className="border-2 border-dashed border-emerald-400/40 rounded-2xl p-4 bg-gradient-to-r from-emerald-500/5 to-green-500/5">
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />
          {!imagePreview ? (
            <div onClick={() => fileInputRef.current?.click()} className="flex flex-col sm:flex-row items-center justify-between gap-3 cursor-pointer group p-1">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-emerald-500/10 text-emerald-600 rounded-2xl group-hover:scale-105 transition-all border border-emerald-500/20">
                  <ImageIcon className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-xs sm:text-sm font-black text-foreground uppercase tracking-wider flex items-center gap-2">
                    <Upload className="w-4 h-4 text-emerald-600" /> WhatsApp Group Screenshot Upload Karein
                  </p>
                  <p className="text-[10.5px] text-muted-foreground font-medium mt-0.5">
                    WhatsApp group ka screenshot ya payment image — AI bill number aur amount nikalega.
                  </p>
                </div>
              </div>
              <Button type="button" size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[11px] uppercase tracking-wider px-5 py-2.5 rounded-xl shadow-md shrink-0 gap-2">
                <Upload className="w-4 h-4" /> Select Image
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2.5">
                  <img src={imagePreview} alt="WhatsApp screenshot preview" className="h-16 w-16 object-cover rounded-xl border border-emerald-400/40 shadow-sm" />
                  <div>
                    <p className="text-xs font-black text-foreground">{imageFile?.name || 'Screenshot'}</p>
                    <p className="text-[10px] text-muted-foreground font-semibold">Preview ready — Extract button dabayein.</p>
                  </div>
                </div>
                <Button type="button" size="sm" variant="ghost" onClick={clearImage} className="text-[10px] font-bold text-destructive hover:bg-destructive/10 rounded-xl">
                  <XCircle className="w-4 h-4 mr-1" /> Remove
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Text Paste ── */}
      {mode === 'text' && (
        <div className="space-y-2">
          <label className="text-[10.5px] font-black uppercase tracking-wider text-foreground flex items-center gap-1.5">
            <ClipboardPaste className="w-3.5 h-3.5 text-emerald-600" /> WhatsApp Group Text Paste Karein:
          </label>
          <textarea
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            rows={5}
            placeholder={'Jaise:\nGST123456 5000 cash aaj\nMOC789 online 2300\n1234 cheque 12/09/2026'}
            className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-input bg-background font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
          />
        </div>
      )}

      {/* ── Extract Button ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          type="button"
          onClick={handleExtract}
          disabled={loading || saving}
          className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[11px] uppercase tracking-wider px-6 py-2.5 rounded-xl shadow-md gap-2"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {loading ? 'AI Reading Screenshot...' : 'AI Se Bill Nikalo'}
        </Button>
        {entries.length > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => { setEntries([]); setSummary(''); setSaveMessage(null); }}
            className="text-[10px] font-bold rounded-xl gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Clear Results
          </Button>
        )}
      </div>

      {/* ── Error / Save Message ── */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/40 text-red-600 dark:text-red-400 px-3.5 py-2.5 rounded-xl text-xs font-bold flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
        </div>
      )}
      {saveMessage && (
        <div className="bg-emerald-500/10 border border-emerald-500/40 text-emerald-700 dark:text-emerald-300 px-3.5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" /> {saveMessage}
        </div>
      )}

      {/* ── AI Summary ── */}
      {summary && (
        <div className="bg-emerald-500/5 border border-emerald-500/25 rounded-xl px-3.5 py-2.5 text-[11px] font-semibold text-emerald-800 dark:text-emerald-200">
          <span className="font-black uppercase tracking-wide">AI Summary:</span> {summary}
        </div>
      )}

      {/* ── Extracted Entries Table (Confirm-Then-Save) ── */}
      {entries.length > 0 && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-[10.5px] font-black uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              Extracted Entries: {entries.length} | Bills Matched: {matchedCount} | Confirmed: {confirmedCount}
            </p>
            <p className="text-[9.5px] text-muted-foreground font-bold">
              ⚠ Har entry confirm karne ke bad hi save hogi.
            </p>
          </div>

          <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {entries.map((entry, idx) => {
              const bill = entry.bill;
              const effectiveNet = bill ? Math.max(0, (Number(bill.billNetAmt) || 0) - (Number(bill.lineCutAmt) || 0)) : 0;
              return (
                <div
                  key={idx}
                  className={cn(
                    'rounded-xl border p-3 transition-all',
                    !entry.matched
                      ? 'bg-red-500/5 border-red-400/40'
                      : entry.confirm
                        ? 'bg-emerald-500/10 border-emerald-400/60 shadow-sm'
                        : 'bg-muted/40 border-border'
                  )}
                >
                  <div className="flex items-start justify-between gap-2.5 flex-wrap">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <button
                        type="button"
                        disabled={!entry.matched}
                        onClick={() => toggleConfirm(idx)}
                        className={cn(
                          'mt-0.5 w-6 h-6 shrink-0 rounded-lg border-2 flex items-center justify-center transition-all',
                          !entry.matched
                            ? 'border-red-300 bg-red-100 text-red-400 cursor-not-allowed'
                            : entry.confirm
                              ? 'border-emerald-500 bg-emerald-500 text-white'
                              : 'border-border bg-background hover:border-emerald-400'
                        )}
                        title={entry.matched ? (entry.confirm ? 'Confirmed — remove confirm' : 'Confirm this entry') : 'Bill not found in app'}
                      >
                        {entry.matched && entry.confirm && <CheckCircle2 className="w-4 h-4" />}
                        {!entry.matched && <XCircle className="w-3.5 h-3.5" />}
                      </button>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[11px] font-black text-foreground font-mono">{entry.extracted.billNo}</span>
                          {!entry.matched ? (
                            <span className="text-[8.5px] font-black bg-red-100 text-red-700 px-2 py-0.5 rounded-full uppercase tracking-wide">Bill Not Found</span>
                          ) : (
                            <span className="text-[8.5px] font-black bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full uppercase tracking-wide">
                              {bill?.paymentMode || 'Unpaid'} → {((entry.amount > 0 && entry.amount < effectiveNet) ? 'Credit' : 'Paid')}
                            </span>
                          )}
                        </div>
                        {bill ? (
                          <p className="text-[10px] text-muted-foreground font-semibold mt-0.5 truncate">
                            {bill.partyName || '-'} • {bill.driverName || '-'} • Net ₹{effectiveNet.toLocaleString('en-IN')} • Outstanding ₹{(Number(bill.outstandingAmount) || 0).toLocaleString('en-IN')}
                          </p>
                        ) : (
                          <p className="text-[10px] text-red-500 font-semibold mt-0.5">
                            App me ye bill number nahi mila. {entry.extracted.partyName ? `Party: ${entry.extracted.partyName}` : ''}
                          </p>
                        )}
                        {entry.extracted.remarks && (
                          <p className="text-[9.5px] text-muted-foreground font-medium mt-0.5 italic">Note: {entry.extracted.remarks}</p>
                        )}
                      </div>
                    </div>

                    {/* Editable credit fields */}
                    {entry.matched && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <input
                          type="number"
                          value={entry.amount}
                          min={0}
                          onChange={(e) => updateEntry(idx, { amount: Number(e.target.value) })}
                          className="w-20 text-[11px] font-bold px-2 py-1 rounded-lg border border-input bg-background text-right"
                          title="Amount to credit"
                        />
                        <select
                          value={entry.paymentMethod}
                          onChange={(e) => updateEntry(idx, { paymentMethod: e.target.value })}
                          className="text-[10px] font-bold px-1.5 py-1 rounded-lg border border-input bg-background"
                          title="Payment method"
                        >
                          <option value="Cash">Cash</option>
                          <option value="UPI">UPI</option>
                          <option value="Cheque">Cheque</option>
                        </select>
                        <input
                          type="text"
                          value={entry.date}
                          onChange={(e) => updateEntry(idx, { date: e.target.value })}
                          className="w-24 text-[10px] font-bold px-2 py-1 rounded-lg border border-input bg-background"
                          title="Payment date (DD/MM/YYYY)"
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Save Confirmed ── */}
          <Button
            type="button"
            onClick={handleSaveConfirmed}
            disabled={saving || confirmedCount === 0}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[12px] uppercase tracking-wider px-6 py-3 rounded-xl shadow-md gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            {saving ? 'Saving...' : `Save ${confirmedCount} Confirmed Entries (Payment Credit)`}
          </Button>
        </div>
      )}
    </div>
  );
}
