import { Fragment, useMemo, useState, useRef, useEffect, memo } from 'react';
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
import { normalizeEditHistory, formatBillChanges, type Bill, type BillEditEntry } from '@/lib/billStore';
import { cn } from '@/lib/utils';
import {
  useStatementMatch,
  parseStatementFile,
  matchStatementWithBills,
  downloadUnmatchedStatementEntries,
  STATEMENT_MATCHED_AMOUNT_CLS,
  type StatementEntry,
  type BillMatchLookupResult,
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

const historyMetadata = new WeakMap<Bill, { source: Bill['editHistory']; history: BillEditEntry[]; sortKey: string }>();

function metadataOf(b: Bill) {
  const cached = historyMetadata.get(b);
  if (cached && cached.source === b.editHistory) return cached;
  const history = normalizeEditHistory(b.editHistory);
  const last = history[history.length - 1];
  const metadata = {
    source: b.editHistory,
    history,
    sortKey: (last?.date || '').split('/').reverse().join('') + (last?.time || ''),
  };
  historyMetadata.set(b, metadata);
  return metadata;
}

function histOf(b: Bill): BillEditEntry[] {
  return metadataOf(b).history;
}

function lastActor(b: Bill): string {
  const h = histOf(b);
  if (h.length) {
    const last = h[h.length - 1];
    const byStr = typeof last.by === 'object' ? JSON.stringify(last.by) : (last.by || '');
    const roleStr = typeof last.role === 'object' ? JSON.stringify(last.role) : (last.role || '');
    return `${byStr} (${roleStr})`;
  }
  const fallback = b.owner || b.user;
  return typeof fallback === 'object' ? JSON.stringify(fallback) : (fallback || '—');
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

const StatementEntryRow = memo(function StatementEntryRow({
  entry,
  idx,
  bills,
  findBills,
  onMatchSubmit,
  onUnmatch,
  feedback,
  isEditing,
  onStartEdit,
  onCancelEdit,
}: {
  entry: StatementEntry;
  idx: number;
  bills: Bill[];
  findBills: (q: string, bills: Bill[], targetAmt?: number) => BillMatchLookupResult[];
  onMatchSubmit: (entryId: string, query: string, entryAmt: number) => void;
  onUnmatch: (entryId: string) => void;
  feedback?: { type: 'ok' | 'err'; text: string };
  isEditing: boolean;
  onStartEdit: (entryId: string) => void;
  onCancelEdit: () => void;
}) {
  const [localQuery, setLocalQuery] = useState(isEditing ? entry.matchedBillNos.join('+') : '');

  useEffect(() => {
    if (isEditing) {
      setLocalQuery(entry.matchedBillNos.join('+'));
    } else if (entry.matched) {
      setLocalQuery('');
    }
  }, [isEditing, entry.matched, entry.matchedBillNos]);

  const trimmed = localQuery.trim();
  const lookup = trimmed ? findBills(trimmed, bills, entry.creditAmount) : [];
  const totalBillsAmt = lookup.length > 0 ? Math.round(lookup.reduce((s, x) => s + x.amount, 0) * 100) / 100 : 0;
  const diff = lookup.length > 0 ? Math.round((totalBillsAmt - entry.creditAmount) * 100) / 100 : 0;
  const hasLookup = lookup.length > 0;
  const allFound = hasLookup && lookup.every(x => x.found);
  const isExact = allFound && Math.abs(diff) < 0.05;

  return (
    <tr
      key={entry.id}
      className={cn(
        "border-b border-border/50 hover:bg-muted/30 transition-colors",
        entry.matched ? "bg-yellow-50/50 dark:bg-yellow-950/20" : "bg-card"
      )}
    >
      <td className="py-2 px-1 font-bold text-muted-foreground align-top text-[10px]">{idx + 1}</td>
      <td className="py-2 px-1.5 font-black whitespace-nowrap align-top">{entry.date}</td>
      <td className="py-2 px-2 font-bold uppercase truncate max-w-[200px] text-muted-foreground align-top" title={entry.description}>
        {entry.description || '—'}
      </td>
      <td className="py-2 px-2 text-right font-black tabular-nums whitespace-nowrap align-top">
        <span className={cn(entry.matched && STATEMENT_MATCHED_AMOUNT_CLS)}>
          ₹{entry.creditAmount.toLocaleString('en-IN')}
        </span>
      </td>
      <td className="py-2 px-2 text-center whitespace-nowrap align-top">
        {entry.matched ? (
          <span className="text-[9px] font-black uppercase bg-yellow-400 text-yellow-950 px-1.5 py-0.5 rounded shadow-xs border border-yellow-500">
            MATCHED {entry.isManual ? '(MANUAL)' : entry.matchType === 'multi' ? '(MULTI)' : '(SINGLE)'}
          </span>
        ) : (
          <span className="text-[9px] font-black uppercase bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 px-1.5 py-0.5 rounded border border-rose-300 dark:border-rose-800">
            UNMATCHED
          </span>
        )}
      </td>
      <td className="py-2 px-2 align-top">
        {entry.matched && !isEditing ? (
          <div className="space-y-0.5">
            <div className="flex flex-wrap items-center gap-1">
              <span className="font-black text-primary text-xs">
                {entry.matchedBillNos.join(' + ')}
              </span>
              {entry.matchedBillNos.length > 1 && (
                <span className="text-[9px] text-emerald-800 bg-emerald-100 dark:bg-emerald-950 dark:text-emerald-200 px-1.5 py-0.5 rounded font-black border border-emerald-300 dark:border-emerald-800">
                  Merged ({entry.matchedBillNos.length} bills)
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 min-w-[280px] max-w-[420px]">
            <div className="flex items-center gap-1">
              <input
                type="text"
                placeholder="Bill no(s) e.g. 42155+44855"
                value={localQuery}
                onChange={evt => setLocalQuery(evt.target.value)}
                onKeyDown={evt => {
                  if (evt.key === 'Enter') {
                    onMatchSubmit(entry.id, localQuery, entry.creditAmount);
                  }
                }}
                className="h-7 flex-1 px-2 text-xs font-bold rounded-md border border-input bg-background shadow-xs focus:outline-none focus:ring-1 focus:ring-primary uppercase placeholder:normal-case placeholder:text-muted-foreground/60"
                autoFocus={isEditing}
              />
              <Button
                type="button"
                size="sm"
                onClick={() => onMatchSubmit(entry.id, localQuery, entry.creditAmount)}
                disabled={!trimmed}
                className={cn(
                  "h-7 px-2.5 text-[10px] font-black uppercase tracking-wider rounded-md shadow-xs transition-colors cursor-pointer",
                  isExact
                    ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                    : "bg-primary hover:bg-primary/90 text-primary-foreground"
                )}
                title="Match this statement entry with entered bill(s)"
              >
                <Check className="w-3 h-3 mr-0.5" />
                <span>Match</span>
              </Button>
              {isEditing && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={onCancelEdit}
                  className="h-7 px-1.5 text-xs text-muted-foreground hover:bg-muted cursor-pointer"
                  title="Cancel editing"
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>

            {hasLookup && (
              <div className="p-1.5 rounded-md bg-muted/70 border border-border/70 text-[10px] space-y-1">
                <div className="flex flex-wrap gap-1">
                  {lookup.map((lk, lIdx) => (
                    <span
                      key={lIdx}
                      className={cn(
                        "px-1.5 py-0.5 rounded text-[10px] font-black border",
                        lk.found
                          ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 border-emerald-300 dark:border-emerald-700"
                          : "bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-700"
                      )}
                      title={lk.found ? `${lk.partyName} (Date: ${lk.date || '—'})` : 'Not found'}
                    >
                      {lk.found ? (
                        <>
                          {lk.billNo}: ₹{lk.amount.toLocaleString('en-IN')}
                          {lk.partyName && <span className="opacity-75 font-normal ml-0.5">({lk.partyName.slice(0, 14)})</span>}
                        </>
                      ) : (
                        <>❌ {lk.queryNo} nahi mila</>
                      )}
                    </span>
                  ))}
                </div>

                <div className="flex items-center justify-between font-bold pt-0.5 border-t border-border/40">
                  <span>
                    Bills Total: <span className="font-black text-foreground">₹{totalBillsAmt.toLocaleString('en-IN')}</span>
                    {' '}/ Deposit: <span className="font-black text-foreground">₹{entry.creditAmount.toLocaleString('en-IN')}</span>
                  </span>
                  {isExact ? (
                    <span className="text-emerald-600 dark:text-emerald-400 font-black flex items-center gap-0.5">
                      <CheckCircle2 className="w-3 h-3" /> Exact Match!
                    </span>
                  ) : (
                    <span className={cn("font-black", diff > 0 ? "text-amber-600" : "text-rose-600")}>
                      Diff: {diff > 0 ? `+₹${diff.toLocaleString('en-IN')}` : `-₹${Math.abs(diff).toLocaleString('en-IN')}`}
                    </span>
                  )}
                </div>
              </div>
            )}

            {feedback && (
              <div
                className={cn(
                  "text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1",
                  feedback.type === 'ok'
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                    : "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200"
                )}
              >
                {feedback.type === 'ok' ? <CheckCircle2 className="w-3 h-3 shrink-0" /> : <AlertCircle className="w-3 h-3 shrink-0" />}
                <span>{feedback.text}</span>
              </div>
            )}
          </div>
        )}
      </td>
      <td className="py-2 px-2 text-right whitespace-nowrap align-top">
        {entry.matched && !isEditing ? (
          <div className="flex items-center justify-end gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onStartEdit(entry.id)}
              className="h-6 px-1.5 text-[9px] font-bold text-muted-foreground hover:text-foreground cursor-pointer"
              title="Edit matched bill numbers"
            >
              Edit
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onUnmatch(entry.id)}
              className="h-6 px-1.5 text-[9px] font-black uppercase border-rose-300 dark:border-rose-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
              title="Unmatch this statement entry and free bills"
            >
              Unmatch
            </Button>
          </div>
        ) : (
          <span className="text-[10px] font-bold text-muted-foreground">—</span>
        )}
      </td>
    </tr>
  );
});

export default function HistoryPage() {
  const { bills } = useBillStore();
  const { isMatched, stats, entries, clear: clearStatementMatch, manualMatch, unmatch, findBills } = useStatementMatch();

  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null);

  // Statement matching UI state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [statementModalOpen, setStatementModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<'all' | 'matched' | 'unmatched'>('all');
  const [modalSearch, setModalSearch] = useState('');
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [manualFeedback, setManualFeedback] = useState<Record<string, { type: 'ok' | 'err'; text: string }>>({});
  const [confirmDiffDialog, setConfirmDiffDialog] = useState<{
    entryId: string;
    diff: number;
    totalBillsAmt: number;
    entryAmt: number;
    query: string;
  } | null>(null);
  const [filterMatchedOnly, setFilterMatchedOnly] = useState(false);
  const [uploadFeedback, setUploadFeedback] = useState<string | null>(null);

  const handleManualMatchSubmit = (
    entryId: string,
    queryOrAmt?: any,
    amtOrAllowTol?: any,
    allowTolOrQuery?: any
  ) => {
    let queryStr = '';
    let targetAmt = 0;
    let allowTolerance = false;

    if (typeof queryOrAmt === 'string') {
      queryStr = queryOrAmt;
      targetAmt = typeof amtOrAllowTol === 'number' ? amtOrAllowTol : 0;
      allowTolerance = typeof allowTolOrQuery === 'boolean' ? allowTolOrQuery : (typeof amtOrAllowTol === 'boolean' ? amtOrAllowTol : false);
    } else if (typeof queryOrAmt === 'number') {
      targetAmt = Number(queryOrAmt) || 0;
      allowTolerance = typeof amtOrAllowTol === 'boolean' ? amtOrAllowTol : false;
      queryStr = typeof allowTolOrQuery === 'string' ? allowTolOrQuery : (allowTolOrQuery != null ? String(allowTolOrQuery) : '');
    } else if (queryOrAmt && typeof queryOrAmt === 'object') {
      queryStr = String((queryOrAmt as any)?.query ?? (queryOrAmt as any)?.billNo ?? '');
      targetAmt = Number(amtOrAllowTol) || 0;
      allowTolerance = Boolean(allowTolOrQuery);
    } else {
      queryStr = typeof allowTolOrQuery === 'string' ? allowTolOrQuery : '';
    }

    const qTrim = String(queryStr || '').trim();
    if (!qTrim) {
      setManualFeedback(prev => ({ ...prev, [entryId]: { type: 'err', text: 'Bill no(s) likhein (e.g. 42155+44855)' } }));
      return;
    }

    const res = manualMatch(entryId, qTrim, bills, allowTolerance);
    if (!res.ok) {
      if (res.diff !== undefined && Math.abs(res.diff) > 1 && !allowTolerance) {
        setConfirmDiffDialog({
          entryId,
          diff: res.diff,
          totalBillsAmt: res.totalBillsAmt || 0,
          entryAmt: targetAmt || res.entryAmt || 0,
          query: qTrim,
        });
        return;
      }
      setManualFeedback(prev => ({ ...prev, [entryId]: { type: 'err', text: res.message } }));
      return;
    }

    setManualFeedback(prev => ({ ...prev, [entryId]: { type: 'ok', text: res.message } }));
    setEditingEntryId(null);
    setConfirmDiffDialog(null);

    setTimeout(() => {
      setManualFeedback(prev => {
        const copy = { ...prev };
        delete copy[entryId];
        return copy;
      });
    }, 3500);
  };

  const handleUnmatch = (entryId: string) => {
    const res = unmatch(entryId);
    if (res.ok) {
      setManualFeedback(prev => ({ ...prev, [entryId]: { type: 'ok', text: 'Unmatched successfully' } }));
      setTimeout(() => {
        setManualFeedback(prev => {
          const copy = { ...prev };
          delete copy[entryId];
          return copy;
        });
      }, 2500);
    }
  };

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

  const filteredModalEntries = useMemo(() => {
    let list = entries;
    if (modalTab === 'matched') list = list.filter(e => e.matched);
    if (modalTab === 'unmatched') list = list.filter(e => !e.matched);
    if (!modalSearch.trim()) return list;

    const qLower = modalSearch.toLowerCase().trim();
    return list.filter(e => {
      return (
        String(e.creditAmount).includes(qLower) ||
        (e.date || '').toLowerCase().includes(qLower) ||
        (e.description || '').toLowerCase().includes(qLower) ||
        e.matchedBillNos.some(bn => bn.toLowerCase().includes(qLower))
      );
    });
  }, [entries, modalTab, modalSearch]);

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

        return metadataOf(b).sortKey.localeCompare(metadataOf(a).sortKey);
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
                  onClick={() => {
                    setModalTab('matched');
                    setStatementModalOpen(true);
                  }}
                  variant="secondary"
                  className="h-4 min-h-4 px-1.5 rounded-sm font-black text-[9px] uppercase gap-0.5 [&_svg]:size-2 shadow-xs cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>
                    Matched ({stats.matchedStatementRows}/{stats.totalStatementRows})
                  </span>
                </Button>

                <Button
                  type="button"
                  onClick={() => {
                    setModalTab('unmatched');
                    setStatementModalOpen(true);
                  }}
                  variant="outline"
                  className="h-4 min-h-4 px-1.5 rounded-sm font-black text-[9px] uppercase gap-0.5 [&_svg]:size-2 border-rose-400/70 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 shadow-xs cursor-pointer"
                  title="View Unmatched Entries and Match Manually"
                >
                  <AlertCircle className="w-2.5 h-2.5" />
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
                                    <td className="px-1 py-0.5">{typeof e.seq === 'object' ? JSON.stringify(e.seq) : e.seq}</td>
                                    <td className="px-1 py-0.5 whitespace-nowrap">{typeof e.date === 'object' ? JSON.stringify(e.date) : (e.date || '')}</td>
                                    <td className="px-1 py-0.5 whitespace-nowrap">{typeof e.time === 'object' ? JSON.stringify(e.time) : (e.time || '')}</td>
                                    <td className="px-1 py-0.5 uppercase">{typeof e.by === 'object' ? JSON.stringify(e.by) : (e.by || '')}</td>
                                    <td className="px-1 py-0.5 uppercase">{typeof e.role === 'object' ? JSON.stringify(e.role) : (e.role || '')}</td>
                                    <td className="px-1 py-0.5 uppercase">{typeof e.action === 'object' ? JSON.stringify(e.action) : (e.action || '')}</td>
                                    <td className="px-1 py-0.5 uppercase">{typeof e.mode === 'object' ? JSON.stringify(e.mode) : (e.mode || '—')}</td>
                                    <td className="px-1 py-0.5 text-right tabular-nums">
                                      {e.amount != null ? (typeof e.amount === 'number' ? e.amount.toLocaleString('en-IN') : String(e.amount)) : '—'}
                                    </td>
                                    <td className="px-1 py-0.5">{formatBillChanges(e.changes)}</td>
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

              {/* Tabs & Search */}
              <div className="px-3 py-2 flex flex-wrap items-center gap-2 border-b border-border bg-card">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setModalTab('all')}
                    className={cn(
                      "h-7 px-2.5 rounded-lg text-[10px] font-black uppercase transition-colors cursor-pointer",
                      modalTab === 'all' ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
                    )}
                  >
                    All Rows ({entries.length})
                  </button>
                  <button
                    onClick={() => setModalTab('matched')}
                    className={cn(
                      "h-7 px-2.5 rounded-lg text-[10px] font-black uppercase transition-colors cursor-pointer",
                      modalTab === 'matched' ? "bg-yellow-400 text-yellow-950 border border-yellow-500" : "bg-muted text-muted-foreground hover:bg-muted/80"
                    )}
                  >
                    Matched ({stats.matchedStatementRows})
                  </button>
                  <button
                    onClick={() => setModalTab('unmatched')}
                    className={cn(
                      "h-7 px-2.5 rounded-lg text-[10px] font-black uppercase transition-colors cursor-pointer",
                      modalTab === 'unmatched' ? "bg-rose-600 text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"
                    )}
                  >
                    Unmatched ({stats.unmatchedStatementRows})
                  </button>
                </div>

                {/* Modal Search Bar */}
                <div className="relative flex-1 min-w-[180px] max-w-xs">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search narration, amt, bill..."
                    value={modalSearch}
                    onChange={e => setModalSearch(e.target.value)}
                    className="h-7 w-full pl-8 pr-6 text-xs rounded-lg border border-input bg-background placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  {modalSearch && (
                    <button
                      onClick={() => setModalSearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {stats.unmatchedStatementRows > 0 && (
                  <button
                    type="button"
                    onClick={handleDownloadUnmatched}
                    disabled={isDownloading}
                    className="ml-auto h-7 px-2.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-black text-[10px] uppercase flex items-center gap-1 shadow-xs cursor-pointer transition-colors"
                    title="Download Excel list of all unmatched statement entries"
                  >
                    <Download className="w-3 h-3" />
                    <span>Download Excel ({stats.unmatchedStatementRows})</span>
                  </button>
                )}
              </div>

              {/* Entries Table */}
              <div className="overflow-y-auto flex-1 p-2 md:p-3">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-[9px] font-black uppercase text-muted-foreground border-b border-border pb-1 text-left">
                      <th className="py-1 px-1">#</th>
                      <th className="py-1 px-1.5 whitespace-nowrap">Date</th>
                      <th className="py-1 px-2">Narration</th>
                      <th className="py-1 px-2 text-right whitespace-nowrap">Deposit (₹)</th>
                      <th className="py-1 px-2 text-center whitespace-nowrap">Status</th>
                      <th className="py-1 px-2">Matched Bill(s) / Manual Entry</th>
                      <th className="py-1 px-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredModalEntries.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center py-8 text-muted-foreground font-bold">
                          Koi statement entries nahi mili.
                        </td>
                      </tr>
                    ) : (
                      filteredModalEntries.map((e, idx) => (
                        <StatementEntryRow
                          key={e.id}
                          entry={e}
                          idx={idx}
                          bills={bills}
                          findBills={findBills}
                          onMatchSubmit={handleManualMatchSubmit}
                          onUnmatch={handleUnmatch}
                          feedback={manualFeedback[e.id]}
                          isEditing={editingEntryId === e.id}
                          onStartEdit={id => setEditingEntryId(id)}
                          onCancelEdit={() => setEditingEntryId(null)}
                        />
                      ))
                    )}
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

        {/* Amount Difference Confirmation Dialog */}
        {confirmDiffDialog && (
          <div className="fixed inset-0 z-[600] bg-black/60 flex items-center justify-center p-4 backdrop-blur-xs">
            <div className="bg-card w-full max-w-md p-4 rounded-xl shadow-2xl border border-border space-y-3 animate-in zoom-in-95">
              <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <h3 className="text-sm font-black uppercase">Amount Difference Confirmation</h3>
              </div>
              <p className="text-xs text-muted-foreground">
                Entered bills ka total aur statement deposit amount me farq hai:
              </p>
              <div className="bg-muted/40 p-2.5 rounded-lg text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Bills Total:</span>
                  <span className="font-black">₹{confirmDiffDialog.totalBillsAmt.toLocaleString('en-IN')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Statement Deposit:</span>
                  <span className="font-black text-primary">₹{confirmDiffDialog.entryAmt.toLocaleString('en-IN')}</span>
                </div>
                <div className="flex justify-between border-t border-border/50 pt-1">
                  <span className="text-muted-foreground">Difference:</span>
                  <span className="font-black text-rose-600">
                    {confirmDiffDialog.diff > 0 ? `+₹${confirmDiffDialog.diff.toLocaleString('en-IN')}` : `-₹${Math.abs(confirmDiffDialog.diff).toLocaleString('en-IN')}`}
                  </span>
                </div>
              </div>
              <p className="text-[11px] font-bold text-muted-foreground">
                Kya aap is difference ke sath match save karna chahte hain?
              </p>
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmDiffDialog(null)}
                  className="text-xs font-bold"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    handleManualMatchSubmit(confirmDiffDialog.entryId, confirmDiffDialog.query, confirmDiffDialog.entryAmt, true);
                  }}
                  className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-black"
                >
                  Haan, Match Save Karein
                </Button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
