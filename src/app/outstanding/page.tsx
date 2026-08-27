import { useMemo, useState } from 'react';
import { IndianRupee, TrendingUp, Users, Loader2, ArrowUpDown } from 'lucide-react';
import { useBillStore } from '@/hooks/use-bill-store';
import TopNav from '@/components/TopNav';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';

type OsSort = { key: 'name' | 'pendingCount' | 'fbrAmt' | 'osAmt'; dir: 'asc' | 'desc' };

export default function OutstandingPage() {
  const { bills, loading } = useBillStore();
  const navigate = useNavigate();
  const [osSort, setOsSort] = useState<OsSort>({ key: 'osAmt', dir: 'desc' });

  function toggleSort(key: OsSort['key']) {
    setOsSort(prev => prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' });
  }

  const totals = useMemo(() => {
    let billAmt = 0;
    let collected = 0;
    let lineCutTotal = 0;
    for (let i = 0; i < bills.length; i++) {
      const b = bills[i];
      billAmt += Number(b.billNetAmt || 0);
      collected += Number(b.collectedAmount || 0);
      lineCutTotal += b.lineCutAmt != null ? b.lineCutAmt : (Number(b.cancelLine) || 0);
    }
    return { billAmt, collected, lineCutTotal, outstanding: billAmt - lineCutTotal - collected };
  }, [bills]);

  const salespersonData = useMemo(() => {
    const map: Record<string, {
      name: string;
      billAmt: number;
      collected: number;
      count: number;
      cancelAmt: number;
      lineCutAmt: number;
      pendingCount: number;
      fbrCount: number;
    }> = {};

    bills.forEach(b => {
      const name = b.salespersonName || 'UNKNOWN';
      if (!map[name]) map[name] = { name, billAmt: 0, collected: 0, count: 0, cancelAmt: 0, lineCutAmt: 0, pendingCount: 0, fbrCount: 0 };

      const bAmt = Number(b.billNetAmt || 0);
      const cAmt = Number(b.collectedAmount || 0);
      const lcAmt = b.lineCutAmt != null ? b.lineCutAmt : (Number(b.cancelLine) || 0);
      const effectiveBillAmt = bAmt - lcAmt;
      const effectiveDiff = effectiveBillAmt - cAmt;

      map[name].billAmt += bAmt;
      map[name].collected += cAmt;
      map[name].count++;
      map[name].lineCutAmt += lcAmt;

      if (b.paymentMode === 'Cancel' || b.paymentMode === 'FBR') {
        map[name].cancelAmt += bAmt;
        map[name].fbrCount++;
      } else if (cAmt === 0 && effectiveDiff > 0) {
        // pending only if nothing collected — collected amount > 0 means PAID
        map[name].pendingCount++;
      }
    });

    const arr = Object.values(map);
    arr.sort((a, b) => {
      let va: number | string, vb: number | string;
      if (osSort.key === 'name')         { va = a.name; vb = b.name; }
      else if (osSort.key === 'pendingCount') { va = a.pendingCount; vb = b.pendingCount; }
      else if (osSort.key === 'fbrAmt')  { va = a.cancelAmt; vb = b.cancelAmt; }
      else                               { va = a.billAmt - a.lineCutAmt - a.collected; vb = b.billAmt - b.lineCutAmt - b.collected; }
      if (typeof va === 'string') return osSort.dir === 'asc' ? va.localeCompare(vb as string) : (vb as string).localeCompare(va);
      return osSort.dir === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });
    return arr;
  }, [bills, osSort]);

  const colors = ['from-indigo-500 to-indigo-700', 'from-violet-500 to-violet-700', 'from-emerald-500 to-emerald-700', 'from-rose-500 to-rose-700', 'from-amber-500 to-amber-700'];

  return (
    <div className="min-h-screen bg-background pb-6 pt-10">
      <TopNav />
      <div className="bg-primary px-3 pt-2 pb-2 rounded-b-xl shadow-md">
        <h1 className="text-sm font-black text-primary-foreground uppercase tracking-widest max-w-full mx-auto">Outstanding Ledger</h1>
        <p className="text-[10px] font-black text-primary-foreground/60 uppercase tracking-tighter max-w-full mx-auto">Collection Efficiency</p>
      </div>

      <div className="max-w-full mx-auto px-1 mt-3 space-y-3">
        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="animate-spin text-primary" /></div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-1">
              <div className="bg-card rounded-xl p-2 shadow-sm border border-border">
                <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center mb-1 text-primary">
                  <IndianRupee className="w-3 h-3" />
                </div>
                <p className="text-[7px] font-black text-muted-foreground uppercase tracking-widest leading-none mb-0.5">Net Payable</p>
                <p className="text-[16px] font-bold text-foreground leading-tight">₹{totals.billAmt.toLocaleString('en-IN')}</p>
              </div>
              <div className="bg-card rounded-xl p-2 shadow-sm border border-border">
                <div className="w-6 h-6 rounded-lg bg-amber-100 flex items-center justify-center mb-1 text-amber-600">
                  <IndianRupee className="w-3 h-3" />
                </div>
                <p className="text-[7px] font-black text-muted-foreground uppercase tracking-widest leading-none mb-0.5">Line Cut Total</p>
                <p className="text-[16px] font-bold text-foreground leading-tight">₹{totals.lineCutTotal.toLocaleString('en-IN')}</p>
              </div>
              <div className="bg-card rounded-xl p-2 shadow-sm border border-border">
                <div className="w-6 h-6 rounded-lg bg-emerald-100 flex items-center justify-center mb-1 text-emerald-600">
                  <TrendingUp className="w-3 h-3" />
                </div>
                <p className="text-[7px] font-black text-muted-foreground uppercase tracking-widest leading-none mb-0.5">Total Collected</p>
                <p className="text-[16px] font-bold text-foreground leading-tight">₹{totals.collected.toLocaleString('en-IN')}</p>
              </div>
              <div className="bg-card rounded-xl p-2 shadow-sm border border-border">
                <div className="w-6 h-6 rounded-lg bg-destructive/10 flex items-center justify-center mb-1 text-destructive">
                  <IndianRupee className="w-3 h-3" />
                </div>
                <p className="text-[7px] font-black text-muted-foreground uppercase tracking-widest leading-none mb-0.5">Outstanding</p>
                <p className="text-[16px] font-bold text-destructive leading-tight">₹{totals.outstanding.toLocaleString('en-IN')}</p>
              </div>
            </div>

            <div className="space-y-2 px-0.5">
              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-muted-foreground" />
                  <h2 className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Salesperson Leaderboard</h2>
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                  {([ ['name', 'A–Z Name'], ['osAmt', 'O/S Amt'], ['pendingCount', 'Pending'], ['fbrAmt', 'FBR'] ] as [OsSort['key'], string][]).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => toggleSort(key)}
                      className={cn(
                        "flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[8px] font-black uppercase border transition-colors",
                        osSort.key === key
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-muted border-border text-muted-foreground hover:border-primary/40"
                      )}
                    >
                      {label}
                      {osSort.key === key && (
                        <ArrowUpDown className="w-2.5 h-2.5 ml-0.5" />
                      )}
                      {osSort.key === key && (
                        <span className="text-[7px]">{osSort.dir === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-1.5">
                {salespersonData.map((sp, i) => {
                  const shortName = sp.name.replace(/^SMN\d+-/, '').split(' ').slice(0, 2).join(' ');
                  const o_s = sp.billAmt - sp.lineCutAmt - sp.collected;
                  const colorClass = colors[i % colors.length];
                  const cardPending = sp.pendingCount > 0 || sp.lineCutAmt > 0;
                  const cardPaid = o_s === 0 && sp.pendingCount === 0;
                  return (
                    <div 
                      key={sp.name} 
                      className={cn("rounded-xl overflow-hidden border shadow-sm group active:scale-[0.98] transition-transform cursor-pointer",
                        cardPending ? "bg-red-50 border-red-200" : cardPaid ? "bg-emerald-100 border-emerald-300" : "bg-card border-border"
                      )}
                      onClick={() => navigate('/bills?salesperson=' + encodeURIComponent(sp.name))}
                    >
                      <div className={cn("h-1 bg-gradient-to-r", colorClass)} />
                      <div className="p-2">
                        <p className="text-[11px] font-black uppercase truncate text-foreground mb-0.5">{shortName}</p>
                        <p className="text-[8px] font-black text-muted-foreground uppercase mb-2 tracking-tighter">{sp.count} BILLS</p>
                        <div className="space-y-1">
                          <div className="flex justify-between text-[9px] font-black uppercase tracking-tight">
                            <span className="text-muted-foreground">O/S AMT</span>
                            <span className={cn(o_s > 0 ? "text-destructive" : "text-emerald-600")}>₹{o_s.toLocaleString('en-IN')}</span>
                          </div>
                          <div className="flex justify-between text-[9px] font-black uppercase tracking-tight">
                            <span className="text-destructive font-bold uppercase">FBR</span>
                            <span className="text-destructive font-bold">₹{sp.cancelAmt.toLocaleString('en-IN')}</span>
                          </div>
                          <div className="flex justify-between text-[9px] font-black uppercase tracking-tight">
                            <span className="text-amber-600">LINE CUT</span>
                            <span className="text-amber-600">₹{sp.lineCutAmt.toLocaleString('en-IN')}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}