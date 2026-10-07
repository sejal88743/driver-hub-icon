import { Fragment, useMemo, useState, useRef } from 'react';
import {
  History,
  Search,
  X,
  ChevronDown,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  Landmark,
  Upload,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  FileSpreadsheet,
  Filter,
  Check,
  Download,
} from 'lucide-react';
import TopNav from '@/components/TopNav';
import { Button } from '@/components/ui/button';
import { useBillStore } from '@/hooks/use-bill-store';
import type { Bill, BillEditEntry } from '@/lib/billStore';
import { cn } from '@/lib/utils';
import {
  useStatementMatch,
  parseStatementFile,
  matchStatementWithBills,
  downloadUnmatchedStatementEntries,
  STATEMENT_MATCHED_AMOUNT_CLS,
} from '@/lib/statementMatch';

type SortKey =
  | 'date'
  | 'billNo'
  | 'partyName'
  | 'deliveryDate'
  | 'driverName'
  | 'paymentDate'
  | 'paymentMode'
  | 'collectedAmount'
  | 'edits'
  | 'lastActor';

function rowTone(mode?: string) {
  const m = (mode || '').toLowerCase();
  if (m === 'fbr') return 'bg-red-50 dark:bg-red-950/20';
  if (m === 'credit') return 'bg-emerald-100 dark:bg-emerald-950/20';
  if (m === 'del pending') return 'bg-yellow-50 dark:bg-yellow-950/20';
  return '';
}

function histOf(b: Bill): BillEditEntry[] {
  return Array.isArray(b.editHistory) ? b.editHistory : [];
}

function lastActor(b: Bill): string {
  const h = histOf(b);
  if (h.length) return `${h[h.length - 1].by} (${h[h.length - 1].role})`;
  return b.owner || b.user || '—';
}

function parseDateDisplay(d?: string | null): number {
  if (!d || d === '—') return 0;
  const parts = d.split('/');
  if (parts.length < 3) return 0;
  const [dd, mm, yyOrYyyy] = parts;
  const year =
    yyOrYyyy.length === 2
      ? parseInt(yyOrYyyy, 10) < 50
        ? `20${yyOrYyyy}`
        : `19${yyOrYyyy}`
      : yyOrYyyy;
  const n = new Date(`${year}-${mm}-${dd}`).getTime();
  return isNaN(n) ? 0 : n;
}

function compareString(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export default function HistoryPage() {
  const { bills } = useBillStore();
  const { isMatched, stats, entries, clear: clearStatementMatch } = useStatementMatch();

  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null);

  // Statement matching UI state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [statementModalOpen, setStatementModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<'all' | 'matched' | 'unmatched'>('all');
  const [filterMatchedOnly, setFilterMatchedOnly] = useState(false);
  const [uploadFeedback, setUploadFeedback] = useState<string | null>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsProcessingFile(true);
    setUploadFeedback(null);
    try {
      const parsedEntries = await parseStatementFile(file);
      if (parsedEntries.length === 0) {
        alert('Bank statement file me koi valid credit/deposit transactions nahi mile.');
        return;
      }
      const result = matchStatementWithBills(parsedEntries, bills);
      const unCount = result.stats.unmatchedStatementRows;
      setUploadFeedback(
        `✅ Matched ${result.stats.matchedStatementRows} statement entries (${result.stats.matchedBillsCount} bills, ₹${result.stats.matchedBillsTotalAmount.toLocaleString('en-IN')}). ${unCount > 0 ? `⚠️ ${unCount} unmatched entries available to download.` : '🎉 Sabhi entries match ho gayi!'}`
      );
      setStatementModalOpen(true);
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Statement parse karne me error aaya. Kripya valid XLS ya CSV file chunein.');
    } finally {
      setIsProcessingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleReMatch = () => {
    if (entries.length === 0) return;
    const result = matchStatementWithBills(entries, bills);
    const unCount = result.stats.unmatchedStatementRows;
    setUploadFeedback(
      `✅ Re-match complete: ${result.stats.matchedStatementRows} matched (${result.stats.matchedBillsCount} bills, ₹${result.stats.matchedBillsTotalAmount.toLocaleString('en-IN')}). ${unCount > 0 ? `⚠️ ${unCount} unmatched entries available.` : '🎉 All matched!'}`
    );
  };

  const handleDownloadUnmatched = async () => {
    if (!entries || entries.length === 0) {
      alert('Koi statement data uplabdh nahi hai.');
      return;
    }
    const unmatched = entries.filter(e => !e.matched);
    if (unmatched.length === 0) {
      alert('Sabhi statement entries match ho chuki hain! Koi unmatched entry nahi hai.');
      return;
    }
    try {
      setIsDownloading(true);
      await downloadUnmatchedStatementEntries(entries, bills);
    } catch (err: any) {
      console.error('Download error:', err);
      alert('Unmatched entries download karne me error aaya: ' + (err?.message || err));
    } finally {
      setIsDownloading(false);
    }
  };

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    let list = bills.filter(b => histOf(b).length > 0 || !!b.editDate);

    if (filterMatchedOnly) {
      list = list.filter(b => isMatched(b));
    }

    const filtered = !term
      ? list
      : list.filter(b =>
          (b.billNo || '').toLowerCase().includes(term) ||
          (b.partyName || '').toLowerCase().includes(term) ||
          (b.driverName || '').toLowerCase().includes(term) ||
          histOf(b).some(h => (h.by || '').toLowerCase().includes(term)),
        );

    return filtered
      .slice()
      .sort((a, b) => {
        if (sort) {
          let cmp = 0;
          switch (sort.key) {
            case 'date':
              cmp = parseDateDisplay(a.date) - parseDateDisplay(b.date);
              break;
            case 'billNo':
              cmp = compareString(a.billNo || '', b.billNo || '');
              break;
            case 'partyName':
              cmp = compareString(a.partyName || '', b.partyName || '');
              break;
            case 'deliveryDate':
              cmp = parseDateDisplay(a.deliveryDate) - parseDateDisplay(b.deliveryDate);
              break;
            case 'driverName':
              cmp = compareString(a.driverName || '', b.driverName || '');
              break;
            case 'paymentDate':
              cmp = parseDateDisplay(a.paymentDate) - parseDateDisplay(b.paymentDate);
              break;
            case 'paymentMode':
              cmp = compareString(a.paymentMode || 'UNPAID', b.paymentMode || 'UNPAID');
              break;
            case 'collectedAmount':
              cmp = (a.collectedAmount || 0) - (b.collectedAmount || 0);
              break;
            case 'edits':
              cmp = histOf(a).length - histOf(b).length;
              break;
            case 'lastActor':
              cmp = compareString(lastActor(a), lastActor(b));
              break;
          }
          if (cmp !== 0) return sort.dir === 'asc' ? cmp : -cmp;
        }

        const ha = histOf(a);
        const hb = histOf(b);
        const ka = `${ha[ha.length - 1]?.date || ''} ${ha[ha.length - 1]?.time || ''}`;
        const kb = `${hb[hb.length - 1]?.date || ''} ${hb[hb.length - 1]?.time || ''}`;
        const pa = ka.split(' ')[0].split('/').reverse().join('') + (ka.split(' ')[1] || '');
        const pb = kb.split(' ')[0].split('/').reverse().join('') + (kb.split(' ')[1] || '');
        return pb.localeCompare(pa);
      })
      .slice(0, 1000);
  }, [bills, q, sort, filterMatchedOnly, isMatched]);

  const totalEdits = useMemo(() => rows.reduce((s, b) => s + histOf(b).length, 0), [rows]);

  function toggleSort(sortKey: SortKey) {
    setSort(prev => {
      if (prev?.key === sortKey) {
        return prev.dir === 'asc' ? { key: sortKey, dir: 'desc' } : { key: sortKey, dir: 'asc' };
      }
      return { key: sortKey, dir: 'asc' };
    });
  }

  function SortHeader({ sortKey, children, align = 'left' }: { sortKey: SortKey; children: React.ReactNode; align?: 'left' | 'right' | 'center' }) {
    const active = Boolean(sort && sort.key === sortKey);
    const Icon = active ? (sort?.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUp;
    const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
    return (
      <th
        onClick={() => toggleSort(sortKey)}
        className={cn(
          'px-2 py-1.5 cursor-pointer select-none hover:bg-muted transition-colors',
          alignClass,
        )}
      >
        <span className="inline-flex items-center gap-0.5">
          {children}
          <Icon
            className={cn(
              'w-3 h-3 transition-opacity',
              active ? 'text-foreground opacity-100' : 'text-muted-foreground opacity-0 group-hover:opacity-50',
            )}
          />
        </span>
      </th>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-16">
      <TopNav />
      <main className="max-w-[1500px] mx-auto px-2 md:px-4 pt-[calc(3.25rem+env(safe-area-inset-top))] pb-3 space-y-3">
        {/* ── Page Header & Bank Statement Matching Toolbar ── */}
        <header className="flex flex-wrap items-center justify-between gap-2.5 pb-2 border-b border-border/60">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-primary" />
            <div>
              <h1 className="text-sm font-black uppercase tracking-[0.15em] flex items-center gap-2">
                <span>Bill Edit History</span>
                {stats && (
                  <span className="bg-yellow-300 dark:bg-yellow-900 text-yellow-950 dark:text-yellow-100 text-[10px] font-black px-2 py-0.5 rounded-full border border-yellow-500 shadow-xs">
                    Statement Active
                  </span>
                )}
              </h1>
              <p className="text-[10px] font-bold uppercase text-muted-foreground">
                {rows.length} bills · {totalEdits} history entries
              </p>
            </div>
          </div>

          {/* Bank Statement Actions */}
          <div className="flex w-full items-center gap-1 flex-wrap" aria-label="Bank statement actions">
            <input
              type="file"
              ref={fileInputRef}
              accept=".xlsx,.xls,.csv"
              onChange={handleFileUpload}
              className="hidden"
            />

            <Button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessingFile}
              className="h-4 min-h-4 px-1.5 rounded-sm font-black text-[9px] uppercase gap-0.5 [&_svg]:size-2 shadow-xs"
            >
              {isProcessingFile ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Processing...</span>
                </>
              ) : (
                <>
                  <Landmark className="w-3.5 h-3.5" />
                  <span>Upload Bank Statement</span>
                </>
              )}
            </Button>

            {stats && (
              <>
                <Button
                  type="button"
                  onClick={() => setStatementModalOpen(true)}
                  variant="secondary"
                  className="h-4 min-h-4 px-1.5 rounded-sm font-black text-[9px] uppercase gap-0.5 [&_svg]:size-2 shadow-xs"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>
                    Matched ({stats.matchedStatementRows}/{stats.totalStatementRows})
                  </span>
                </Button>

                <Button
                  type="button"
                  onClick={handleDownloadUnmatched}
                  disabled={isDownloading || stats.unmatchedStatementRows === 0}
                  variant="outline"
                  className="h-4 min-h-4 px-1.5 rounded-sm font-black text-[9px] uppercase gap-0.5 [&_svg]:size-2 border-rose-400/70 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 shadow-xs"
                  title="Download Unmatched Statement Entries (Excel)"
                >
                  <Download className="w-2.5 h-2.5" />
                  <span>Unmatched ({stats.unmatchedStatementRows})</span>
                </Button>

                <Button
                  type="button"
                  onClick={handleReMatch}
                  title="Re-run matching with current bills"
                  variant="outline"
                  className="h-4 min-h-4 px-1 rounded-sm font-black text-[9px] uppercase gap-0.5 [&_svg]:size-2"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Re-match</span>
                </Button>

                <Button
                  type="button"
                  onClick={() => {
                    if (confirm('Statement match data clear karein? Sabhi yellow highlights hat jayengi.')) {
                      clearStatementMatch();
                      setUploadFeedback(null);
                    }
                  }}
                  title="Clear Statement Data"
                  variant="outline"
                  className="h-4 min-h-4 px-1 rounded-sm border-destructive/30 hover:bg-destructive/10 text-destructive font-black text-[9px] uppercase"
                >
                  Clear
                </Button>

                <Button
                  type="button"
                  onClick={() => setFilterMatchedOnly(p => !p)}
                  variant={filterMatchedOnly ? 'secondary' : 'outline'}
                  aria-pressed={filterMatchedOnly}
                  className="h-4 min-h-4 px-1 rounded-sm font-black text-[9px] uppercase gap-0.5 [&_svg]:size-2"
                >
                  <Filter className="w-3 h-3" />
                  <span>{filterMatchedOnly ? "Showing Matched" : "Filter Matched"}</span>
                </Button>
              </>
            )}
          </div>
        </header>

        {/* Statement Status Summary Banner */}
        {stats && (
          <div className="bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-300 dark:border-yellow-700/60 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-yellow-500 animate-pulse shrink-0" />
              <div className="text-[11px] font-bold text-yellow-950 dark:text-yellow-100">
                <span className="font-black uppercase">Bank Statement Active:</span>{' '}
                <span>
                  {stats.matchedStatementRows} entries matched ({stats.matchedBillsCount} bills) · Total Matched:{' '}
                  <span className="font-black">₹{stats.matchedBillsTotalAmount.toLocaleString('en-IN')}</span>
                </span>
                <span className="text-yellow-800 dark:text-yellow-300 text-[10px] ml-2">
                  (Matched GPay/Cheque amounts highlighted in YELLOW)
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {uploadFeedback && (
                <span className="text-[10px] font-black text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-300">
                  {uploadFeedback}
                </span>
              )}
              {stats.unmatchedStatementRows > 0 && (
                <button
                  type="button"
                  onClick={handleDownloadUnmatched}
                  disabled={isDownloading}
                  className="h-6 px-2.5 rounded-md text-[10px] font-black uppercase text-rose-700 dark:text-rose-300 bg-white dark:bg-card border border-rose-300 dark:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/50 shadow-xs flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <Download className="w-3 h-3" />
                  <span>Download Unmatched ({stats.unmatchedStatementRows})</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Search Bar ── */}
        <div className="relative max-w-md">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="BILL NO / PARTY / DRIVER / NAME"
            className="w-full h-9 pl-8 pr-8 rounded-md border border-border bg-card text-[13px] font-bold uppercase tracking-wide outline-none focus:border-primary"
          />
          {q && (
            <button onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* ── History Table ── */}
        <div className="overflow-x-auto border border-border rounded-md bg-card">
          <table className="w-full text-[11px]">
            <thead className="bg-muted/60 sticky top-0">
              <tr className="text-[9px] font-black uppercase tracking-wider text-muted-foreground">
                <th className="px-2 py-1.5 w-6" />
                <SortHeader sortKey="date">Bill Date</SortHeader>
                <SortHeader sortKey="billNo">Bill No</SortHeader>
                <SortHeader sortKey="partyName">Party</SortHeader>
                <SortHeader sortKey="deliveryDate">Del Date</SortHeader>
                <SortHeader sortKey="driverName">Driver</SortHeader>
                <SortHeader sortKey="paymentDate">Rec / Paid Date</SortHeader>
                <SortHeader sortKey="paymentMode">Status</SortHeader>
                <SortHeader sortKey="collectedAmount" align="right">Rec Amt</SortHeader>
                <SortHeader sortKey="edits" align="center">Edits</SortHeader>
                <SortHeader sortKey="lastActor">Last By</SortHeader>
              </tr>
            </thead>
            <tbody>
              {rows.map(b => {
                const h = histOf(b);
                const isOpen = !!open[b.id];
                const matched = isMatched(b);

                return (
                  <Fragment key={b.id}>
                    <tr
                      onClick={() => setOpen(o => ({ ...o, [b.id]: !o[b.id] }))}
                      className={cn(
                        'border-t border-border cursor-pointer hover:bg-muted/40 font-bold transition-colors',
                        rowTone(b.paymentMode),
                        matched && 'bg-yellow-50/50 dark:bg-yellow-950/10',
                      )}
                    >
                      <td className="px-1 py-1 text-muted-foreground">
                        {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      </td>
                      <td className="px-2 py-1 whitespace-nowrap">{b.date || '—'}</td>
                      <td className="px-2 py-1 font-black">
                        <span className="flex items-center gap-1">
                          <span>{b.billNo}</span>
                          {matched && (
                            <span className="text-[8px] bg-yellow-400 text-yellow-950 px-1 py-0.2 rounded font-black tracking-tight" title="Bank Statement Matched">
                              ✓ STMT
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-2 py-1 truncate max-w-[220px] uppercase">{b.partyName}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{b.deliveryDate || '—'}</td>
                      <td className="px-2 py-1 uppercase whitespace-nowrap">{b.driverName || '—'}</td>
                      <td className="px-2 py-1 whitespace-nowrap font-black text-orange-700 dark:text-orange-300">
                        {b.paymentDate || '—'}
                      </td>
                      <td className="px-2 py-1 uppercase whitespace-nowrap">{b.paymentMode || 'UNPAID'}</td>
                      
                      {/* Rec Amount cell: HIGHLIGHTED IN YELLOW FOR STATEMENT MATCHED GPAY/CHEQUE BILLS */}
                      <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap">
                        <span className={cn(
                          "tabular-nums font-bold",
                          matched ? STATEMENT_MATCHED_AMOUNT_CLS : "text-emerald-700 dark:text-emerald-400 font-black"
                        )}>
                          ₹{(b.collectedAmount || 0).toLocaleString('en-IN')}
                        </span>
                      </td>
                      <td className="px-2 py-1 text-center">{h.length}</td>
                      <td className="px-2 py-1 uppercase whitespace-nowrap">{lastActor(b)}</td>
                    </tr>
                    {isOpen && (
                      <tr className="border-t border-border bg-muted/20">
                        <td />
                        <td colSpan={10} className="px-2 py-2">
                          {matched && (
                            <div className="mb-2 bg-yellow-100 dark:bg-yellow-950/40 border border-yellow-300 text-yellow-950 dark:text-yellow-100 px-2.5 py-1 rounded-md text-[10px] font-bold flex items-center justify-between">
                              <span>✓ Bank Statement Verified (Rec Date: {b.paymentDate || '—'}, Mode: {b.paymentMode || '—'})</span>
                              <span className="text-[9px] font-black uppercase text-yellow-800">100% MATCHED</span>
                            </div>
                          )}
                          {h.length === 0 ? (
                            <div className="text-[10px] font-bold uppercase text-muted-foreground">
                              No detailed history — last edit date {b.editDate || '—'}
                            </div>
                          ) : (
                            <table className="w-full text-[10px]">
                              <thead>
                                <tr className="text-[9px] font-black uppercase text-muted-foreground">
                                  <th className="px-1 py-0.5 text-left">#</th>
                                  <th className="px-1 py-0.5 text-left">Date</th>
                                  <th className="px-1 py-0.5 text-left">Time</th>
                                  <th className="px-1 py-0.5 text-left">By</th>
                                  <th className="px-1 py-0.5 text-left">Role</th>
                                  <th className="px-1 py-0.5 text-left">Action</th>
                                  <th className="px-1 py-0.5 text-left">Mode</th>
                                  <th className="px-1 py-0.5 text-right">Amount</th>
                                  <th className="px-1 py-0.5 text-left">Changes</th>
                                </tr>
                              </thead>
                              <tbody>
                                {h.map((e, i) => (
                                  <tr key={i} className="border-t border-border/60 font-semibold">
                                    <td className="px-1 py-0.5">{e.seq}</td>
                                    <td className="px-1 py-0.5 whitespace-nowrap">{e.date}</td>
                                    <td className="px-1 py-0.5 whitespace-nowrap">{e.time}</td>
                                    <td className="px-1 py-0.5 uppercase">{e.by}</td>
                                    <td className="px-1 py-0.5 uppercase">{e.role}</td>
                                    <td className="px-1 py-0.5 uppercase">{e.action}</td>
                                    <td className="px-1 py-0.5 uppercase">{e.mode || '—'}</td>
                                    <td className="px-1 py-0.5 text-right tabular-nums">
                                      {e.amount != null ? e.amount.toLocaleString('en-IN') : '—'}
                                    </td>
                                    <td className="px-1 py-0.5">{e.changes || '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-3 py-6 text-center text-[11px] font-black uppercase text-muted-foreground">
                    {filterMatchedOnly ? 'No statement-matched bills found' : 'No edit history found'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ── Statement Reconciliation Modal ── */}
        {statementModalOpen && stats && (
          <div className="fixed inset-0 z-[500] bg-black/60 flex items-center justify-center p-3 backdrop-blur-xs">
            <div className="bg-card w-full max-w-4xl max-h-[92vh] rounded-2xl shadow-2xl border border-border flex flex-col overflow-hidden animate-in zoom-in-95">
              {/* Header */}
              <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-muted/40">
                <div className="flex items-center gap-2">
                  <Landmark className="w-5 h-5 text-teal-600" />
                  <div>
                    <h2 className="text-sm font-black uppercase tracking-wider">Bank Statement Reconciliation</h2>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase">
                      Updated: {stats.uploadedAt} · Date = Rec Date & Exact Amount
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setStatementModalOpen(false)}
                  className="p-1 rounded-lg text-muted-foreground hover:bg-muted"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* KPI Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 p-3 bg-muted/20 border-b border-border">
                <div className="bg-card p-2.5 rounded-xl border border-border">
                  <p className="text-[9px] font-black text-muted-foreground uppercase">Total Statement Deposits</p>
                  <p className="text-base font-black text-foreground">₹{stats.totalCreditAmount.toLocaleString('en-IN')}</p>
                  <p className="text-[9px] font-bold text-muted-foreground">{stats.totalStatementRows} Transactions</p>
                </div>
                <div className="bg-yellow-50 dark:bg-yellow-950/30 p-2.5 rounded-xl border border-yellow-300 dark:border-yellow-700">
                  <p className="text-[9px] font-black text-yellow-800 dark:text-yellow-300 uppercase">✓ Matched in App (Yellow)</p>
                  <p className="text-base font-black text-yellow-950 dark:text-yellow-100">₹{stats.matchedStatementAmount.toLocaleString('en-IN')}</p>
                  <p className="text-[9px] font-bold text-yellow-800 dark:text-yellow-300">
                    {stats.matchedStatementRows} entries ({stats.matchedBillsCount} bills)
                  </p>
                </div>
                <div className="bg-card p-2.5 rounded-xl border border-border">
                  <div className="flex items-center justify-between">
                    <p className="text-[9px] font-black text-muted-foreground uppercase">Unmatched in App</p>
                    {stats.unmatchedStatementRows > 0 && (
                      <button
                        type="button"
                        onClick={handleDownloadUnmatched}
                        disabled={isDownloading}
                        className="text-[9px] font-black uppercase text-rose-600 dark:text-rose-400 hover:underline flex items-center gap-0.5 cursor-pointer"
                        title="Download Excel List"
                      >
                        <Download className="w-2.5 h-2.5" />
                        <span>Excel</span>
                      </button>
                    )}
                  </div>
                  <p className="text-base font-black text-rose-600">₹{stats.unmatchedStatementAmount.toLocaleString('en-IN')}</p>
                  <p className="text-[9px] font-bold text-muted-foreground">{stats.unmatchedStatementRows} Transactions</p>
                </div>
              </div>

              {/* Tabs */}
              <div className="px-3 pt-2 pb-1 flex items-center gap-1.5 border-b border-border bg-card">
                <button
                  onClick={() => setModalTab('all')}
                  className={cn(
                    "h-7 px-3 rounded-lg text-[10px] font-black uppercase transition-colors",
                    modalTab === 'all' ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
                  )}
                >
                  All Rows ({entries.length})
                </button>
                <button
                  onClick={() => setModalTab('matched')}
                  className={cn(
                    "h-7 px-3 rounded-lg text-[10px] font-black uppercase transition-colors",
                    modalTab === 'matched' ? "bg-yellow-400 text-yellow-950 border border-yellow-500" : "bg-muted text-muted-foreground hover:bg-muted/80"
                  )}
                >
                  Matched ({stats.matchedStatementRows})
                </button>
                <button
                  onClick={() => setModalTab('unmatched')}
                  className={cn(
                    "h-7 px-3 rounded-lg text-[10px] font-black uppercase transition-colors",
                    modalTab === 'unmatched' ? "bg-rose-600 text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"
                  )}
                >
                  Unmatched ({stats.unmatchedStatementRows})
                </button>

                {stats.unmatchedStatementRows > 0 && (
                  <button
                    type="button"
                    onClick={handleDownloadUnmatched}
                    disabled={isDownloading}
                    className="ml-auto h-7 px-3 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-black text-[10px] uppercase flex items-center gap-1.5 shadow-xs cursor-pointer transition-colors"
                    title="Download Excel list of all unmatched statement entries"
                  >
                    <Download className="w-3 h-3" />
                    <span>Download Unmatched ({stats.unmatchedStatementRows})</span>
                  </button>
                )}
              </div>

              {/* Entries Table */}
              <div className="overflow-y-auto flex-1 p-3">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-[9px] font-black uppercase text-muted-foreground border-b border-border pb-1 text-left">
                      <th className="py-1 px-1">#</th>
                      <th className="py-1 px-1">Date</th>
                      <th className="py-1 px-2">Description / Narration</th>
                      <th className="py-1 px-2 text-right">Deposit Amt (₹)</th>
                      <th className="py-1 px-2 text-center">Status</th>
                      <th className="py-1 px-2">Matched Bill(s)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries
                      .filter(e => {
                        if (modalTab === 'matched') return e.matched;
                        if (modalTab === 'unmatched') return !e.matched;
                        return true;
                      })
                      .map((e, idx) => (
                        <tr
                          key={e.id}
                          className={cn(
                            "border-b border-border/50 hover:bg-muted/30 transition-colors",
                            e.matched && "bg-yellow-50/60 dark:bg-yellow-950/20"
                          )}
                        >
                          <td className="py-1.5 px-1 font-bold text-muted-foreground">{idx + 1}</td>
                          <td className="py-1.5 px-1 font-black whitespace-nowrap">{e.date}</td>
                          <td className="py-1.5 px-2 font-bold uppercase truncate max-w-[260px] text-muted-foreground" title={e.description}>
                            {e.description || '—'}
                          </td>
                          <td className="py-1.5 px-2 text-right font-black tabular-nums whitespace-nowrap">
                            <span className={cn(e.matched && STATEMENT_MATCHED_AMOUNT_CLS)}>
                              ₹{e.creditAmount.toLocaleString('en-IN')}
                            </span>
                          </td>
                          <td className="py-1.5 px-2 text-center whitespace-nowrap">
                            {e.matched ? (
                              <span className="text-[9px] font-black uppercase bg-yellow-400 text-yellow-950 px-1.5 py-0.5 rounded shadow-xs border border-yellow-500">
                                MATCHED ({e.matchType === 'multi' ? 'MULTI' : 'SINGLE'})
                              </span>
                            ) : (
                              <span className="text-[9px] font-black uppercase bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                                UNMATCHED
                              </span>
                            )}
                          </td>
                          <td className="py-1.5 px-2 font-black text-primary truncate max-w-[220px]">
                            {e.matchedBillNos.length > 0 ? (
                              <span>
                                {e.matchedBillNos.join(', ')}
                                {e.matchedBillNos.length > 1 && (
                                  <span className="ml-1 text-[9px] text-emerald-700 bg-emerald-100 px-1 py-0.2 rounded font-black">
                                    Merged ({e.matchedBillNos.length})
                                  </span>
                                )}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/40 font-normal">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

              {/* Footer */}
              <div className="p-3 border-t border-border flex items-center justify-between bg-muted/20">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="h-8 px-3 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-black text-[10px] uppercase flex items-center gap-1 cursor-pointer"
                  >
                    <Upload className="w-3 h-3" />
                    <span>Upload Another Statement</span>
                  </button>
                  <button
                    onClick={handleReMatch}
                    className="h-8 px-3 rounded-lg bg-card border border-border hover:bg-muted text-foreground font-black text-[10px] uppercase flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Re-Run Match</span>
                  </button>
                  {stats.unmatchedStatementRows > 0 && (
                    <button
                      type="button"
                      onClick={handleDownloadUnmatched}
                      disabled={isDownloading}
                      className="h-8 px-3 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-black text-[10px] uppercase flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download Unmatched Sheet</span>
                    </button>
                  )}
                </div>
                <button
                  onClick={() => setStatementModalOpen(false)}
                  className="h-8 px-4 rounded-lg bg-primary text-primary-foreground font-black text-[10px] uppercase cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
