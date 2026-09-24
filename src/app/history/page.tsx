import { Fragment, useMemo, useState } from 'react';
import { History, Search, X, ChevronDown, ChevronRight, ArrowUp, ArrowDown } from 'lucide-react';
import TopNav from '@/components/TopNav';
import { useBillStore } from '@/hooks/use-bill-store';
import type { Bill, BillEditEntry } from '@/lib/billStore';
import { cn } from '@/lib/utils';

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
  if (m === 'fbr') return 'bg-red-50';
  if (m === 'credit') return 'bg-emerald-100';
  if (m === 'del pending') return 'bg-yellow-50';
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
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = bills.filter(b => histOf(b).length > 0 || !!b.editDate);
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
  }, [bills, q, sort]);

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
      <main className="max-w-[1500px] mx-auto px-2 md:px-4 py-3 space-y-3">
        <header className="flex flex-wrap items-center gap-2">
          <History className="w-5 h-5 text-primary" />
          <h1 className="text-sm font-black uppercase tracking-[0.15em]">Bill Edit History</h1>
          <span className="text-[10px] font-black uppercase text-muted-foreground">
            {rows.length} bills · {totalEdits} entries
          </span>
        </header>

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
                return (
                  <Fragment key={b.id}>
                    <tr
                      onClick={() => setOpen(o => ({ ...o, [b.id]: !o[b.id] }))}
                      className={cn('border-t border-border cursor-pointer hover:bg-muted/40 font-bold', rowTone(b.paymentMode))}
                    >
                      <td className="px-1 py-1 text-muted-foreground">
                        {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      </td>
                      <td className="px-2 py-1 whitespace-nowrap">{b.date || '—'}</td>
                      <td className="px-2 py-1 font-black">{b.billNo}</td>
                      <td className="px-2 py-1 truncate max-w-[220px] uppercase">{b.partyName}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{b.deliveryDate || '—'}</td>
                      <td className="px-2 py-1 uppercase whitespace-nowrap">{b.driverName || '—'}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{b.paymentDate || '—'}</td>
                      <td className="px-2 py-1 uppercase whitespace-nowrap">{b.paymentMode || 'UNPAID'}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{(b.collectedAmount || 0).toLocaleString('en-IN')}</td>
                      <td className="px-2 py-1 text-center">{h.length}</td>
                      <td className="px-2 py-1 uppercase whitespace-nowrap">{lastActor(b)}</td>
                    </tr>
                    {isOpen && (
                      <tr className="border-t border-border bg-muted/20">
                        <td />
                        <td colSpan={10} className="px-2 py-2">
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
                    No edit history found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
