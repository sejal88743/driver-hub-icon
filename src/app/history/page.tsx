import { Fragment, useMemo, useState } from 'react';
import { History, Search, X, ChevronDown, ChevronRight } from 'lucide-react';
import TopNav from '@/components/TopNav';
import { useBillStore } from '@/hooks/use-bill-store';
import type { Bill, BillEditEntry } from '@/lib/billStore';
import { cn } from '@/lib/utils';

function rowTone(mode?: string) {
  const m = (mode || '').toLowerCase();
  if (m === 'fbr') return 'bg-red-50';
  if (m === 'credit') return 'bg-emerald-50';
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

export default function HistoryPage() {
  const { bills } = useBillStore();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});

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
        const ha = histOf(a); const hb = histOf(b);
        const ka = `${ha[ha.length - 1]?.date || ''} ${ha[ha.length - 1]?.time || ''}`;
        const kb = `${hb[hb.length - 1]?.date || ''} ${hb[hb.length - 1]?.time || ''}`;
        const pa = ka.split(' ')[0].split('/').reverse().join('') + (ka.split(' ')[1] || '');
        const pb = kb.split(' ')[0].split('/').reverse().join('') + (kb.split(' ')[1] || '');
        return pb.localeCompare(pa);
      })
      .slice(0, 1000);
  }, [bills, q]);

  const totalEdits = useMemo(() => rows.reduce((s, b) => s + histOf(b).length, 0), [rows]);

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
                <th className="px-2 py-1.5 text-left">Bill Date</th>
                <th className="px-2 py-1.5 text-left">Bill No</th>
                <th className="px-2 py-1.5 text-left">Party</th>
                <th className="px-2 py-1.5 text-left">Del Date</th>
                <th className="px-2 py-1.5 text-left">Driver</th>
                <th className="px-2 py-1.5 text-left">Rec / Paid Date</th>
                <th className="px-2 py-1.5 text-left">Status</th>
                <th className="px-2 py-1.5 text-right">Rec Amt</th>
                <th className="px-2 py-1.5 text-center">Edits</th>
                <th className="px-2 py-1.5 text-left">Last By</th>
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
