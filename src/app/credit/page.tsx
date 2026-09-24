import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { ChevronUp, ChevronDown, Shield, Eye, EyeOff, Lock, Loader2, FileDown, X, Search } from 'lucide-react';
import { useBillStore } from '@/hooks/use-bill-store';
import TopNav from '@/components/TopNav';
import { cn } from '@/lib/utils';
import { getSystemPassword } from '@/lib/billStore';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';


type SortKey = 'date' | 'billNo' | 'partyName' | 'salespersonName' | 'outstandingAmount' | 'givenTo' | 'giveDate';
type CreditAssign = { givenTo: string; giveDate: string };

const LS_KEY = 'vitratrack_credit_assigns';

function loadAssigns(): Record<string, CreditAssign> {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; }
}

function saveAssigns(data: Record<string, CreditAssign>) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch {}
}

export default function CreditPage() {
  const { bills, loading } = useBillStore();

  // ── Auth gate ───────────────────────────────────────────────────────────────
  const [unlocked, setUnlocked] = useState(false);
  const [pwInput, setPwInput]   = useState('');
  const [pwError, setPwError]   = useState(false);
  const [showPw,  setShowPw]    = useState(false);

  function handleUnlock() {
    if (pwInput.trim().toUpperCase() === getSystemPassword().toUpperCase()) {
      setUnlocked(true);
    } else {
      setPwError(true);
      setTimeout(() => setPwError(false), 1500);
    }
  }

  // ── Assignments (persisted to localStorage) ─────────────────────────────────
  const [assigns, setAssigns] = useState<Record<string, CreditAssign>>(loadAssigns);

  function updateAssign(billId: string, data: Partial<CreditAssign>) {
    setAssigns(prev => {
      const next = { ...prev, [billId]: { givenTo: prev[billId]?.givenTo || '', giveDate: prev[billId]?.giveDate || '', ...data } };
      saveAssigns(next);
      return next;
    });
  }

  // ── Sort state ──────────────────────────────────────────────────────────────
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const toggleSort = useCallback((key: SortKey) => {
    setSortKey(prev => {
      if (prev === key) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); return prev; }
      setSortDir('asc');
      return key;
    });
  }, []);

  // ── Search (bill no / party name) ───────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  // Debounced value — actual filtering fires 300 ms after user stops typing.
  // Input shows `searchQuery` immediately (no lag); expensive filter uses `debouncedSearch`.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    if (!searchQuery) { setDebouncedSearch(''); return; }
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim().toLowerCase()), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // ── Del Date filter ─────────────────────────────────────────────────────────
  const [delDateFilter, setDelDateFilter] = useState('');

  // ── Selection ───────────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggleSelect(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  // ── Credit bills = status Credit + rec payment nil, duplicates removed ──────
  const creditBills = useMemo(() => {
    const filtered = bills.filter(b => {
      const m = (b.paymentMode || '').toLowerCase();
      const isCredit = m === 'credit';
      const recNil = !b.collectedAmount || Number(b.collectedAmount) === 0;
      return isCredit && recNil;
    });
    // Deduplicate by numeric cancelLine — if two bills share the same credit ref no,
    // keep only the first one encountered (earliest in the store order).
    const seenRefNos = new Set<number>();
    return filtered.filter(b => {
      const n = Number(b.cancelLine);
      if (Number.isInteger(n) && n > 0) {
        if (seenRefNos.has(n)) return false; // duplicate — hide it
        seenRefNos.add(n);
      }
      return true;
    });
  }, [bills]);

  // ── Unique salesperson list ─────────────────────────────────────────────────
  const salespersons = useMemo(() => {
    const seen = new Set<string>();
    bills.forEach(b => { if (b.salespersonName?.trim()) seen.add(b.salespersonName.trim()); });
    return Array.from(seen).sort();
  }, [bills]);

  // ── Sorted list ─────────────────────────────────────────────────────────────
  const sorted = useMemo(() => {
    const list = [...creditBills];
    list.sort((a, b) => {
      let va: string | number = '';
      let vb: string | number = '';

      switch (sortKey) {
        case 'date':               va = a.date || '';               vb = b.date || '';               break;
        case 'billNo':             va = a.billNo || '';             vb = b.billNo || '';             break;
        case 'partyName':          va = a.partyName || '';          vb = b.partyName || '';          break;
        case 'salespersonName':    va = a.salespersonName || '';    vb = b.salespersonName || '';    break;
        case 'outstandingAmount':  va = a.outstandingAmount || 0;  vb = b.outstandingAmount || 0;  break;
        case 'givenTo':            va = assigns[a.id]?.givenTo || ''; vb = assigns[b.id]?.givenTo || ''; break;
        case 'giveDate':           va = assigns[a.id]?.giveDate || ''; vb = assigns[b.id]?.giveDate || ''; break;
      }

      if (typeof va === 'number') return sortDir === 'asc' ? va - (vb as number) : (vb as number) - va;
      const cmp = String(va).localeCompare(String(vb), 'en', { sensitivity: 'base' });
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [creditBills, sortKey, sortDir, assigns]);

  // ── Del Date + search filtered list (what renders in the table) ─────────────
  // When a search query is present we scan ALL bills (not just credit-filtered ones)
  // so any bill can be found by bill no or party name regardless of its payment status.
  // Without a query we show only the credit-filtered + sorted list as before.
  // Uses `debouncedSearch` (not live `searchQuery`) so heavy filter fires only after
  // the user pauses typing, keeping keystrokes instant.
  const displayed = useMemo(() => {
    const q = debouncedSearch; // already trimmed + lowercased

    if (q) {
      // Search across every bill in the store (bill no, party name, or credit reference no)
      let results = bills.filter(b =>
        (b.billNo    || '').trim().toLowerCase().includes(q) ||
        (b.partyName || '').trim().toLowerCase().includes(q) ||
        (b.cancelLine|| '').trim().toLowerCase().includes(q)
      );
      // Apply del-date filter on top
      if (delDateFilter) {
        const [y, m, d] = delDateFilter.split('-');
        const displayFmt = `${d}/${m}/${y}`;
        results = results.filter(b => (b.deliveryDate || '') === displayFmt);
      }
      // Apply the same sort as the credit list
      results.sort((a, b) => {
        let va: string | number = '';
        let vb: string | number = '';
        switch (sortKey) {
          case 'date':              va = a.date || '';              vb = b.date || '';              break;
          case 'billNo':            va = a.billNo || '';            vb = b.billNo || '';            break;
          case 'partyName':         va = a.partyName || '';         vb = b.partyName || '';         break;
          case 'salespersonName':   va = a.salespersonName || '';   vb = b.salespersonName || '';   break;
          case 'outstandingAmount': va = a.outstandingAmount || 0;  vb = b.outstandingAmount || 0;  break;
          case 'givenTo':           va = assigns[a.id]?.givenTo || ''; vb = assigns[b.id]?.givenTo || ''; break;
          case 'giveDate':          va = assigns[a.id]?.giveDate || ''; vb = assigns[b.id]?.giveDate || ''; break;
        }
        if (typeof va === 'number') return sortDir === 'asc' ? va - (vb as number) : (vb as number) - va;
        const cmp = String(va).localeCompare(String(vb), 'en', { sensitivity: 'base' });
        return sortDir === 'asc' ? cmp : -cmp;
      });
      return results;
    }

    // No search — show credit-only list with optional del-date filter
    if (delDateFilter) {
      const [y, m, d] = delDateFilter.split('-');
      const displayFmt = `${d}/${m}/${y}`;
      return sorted.filter(b => (b.deliveryDate || '') === displayFmt);
    }
    return sorted;
  }, [bills, sorted, delDateFilter, debouncedSearch, sortKey, sortDir, assigns]);

  const allChecked = displayed.length > 0 && displayed.every(b => selected.has(b.id));

  function toggleAll() {
    if (allChecked) {
      setSelected(prev => { const n = new Set(prev); displayed.forEach(b => n.delete(b.id)); return n; });
    } else {
      setSelected(prev => { const n = new Set(prev); displayed.forEach(b => n.add(b.id)); return n; });
    }
  }

  const selectedOutstanding = displayed
    .filter(b => selected.has(b.id))
    .reduce((s, b) => s + (b.outstandingAmount || 0), 0);

  // ── PDF export ──────────────────────────────────────────────────────────────
  function handlePdfDownload() {
    // A4 portrait: 210 × 297 mm, usable width = 210 - 14 - 14 = 182 mm
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    const title = delDateFilter
      ? `Credit Bills — Del Date: ${delDateFilter}`
      : 'Credit Bills';
    const now = new Date();
    const stamp = `${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()}  ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(title, 14, 13);
    doc.setFontSize(7);
    doc.text(`Generated: ${stamp}  |  ${displayed.length} bills`, 14, 19);

    const head = [['#', 'Bill Date', 'Bill No', 'Party Name', 'Salesperson', 'O/S Amt', 'Given To', 'Give Date']];
    const body = displayed.map((bill, idx) => {
      const assign = assigns[bill.id] || { givenTo: '', giveDate: '' };
      return [
        String(idx + 1),
        bill.date || '—',
        bill.billNo || '—',
        bill.partyName || '—',
        bill.salespersonName || '—',
        `Rs.${(bill.outstandingAmount || 0).toLocaleString('en-IN')}`,
        assign.givenTo || '—',
        assign.giveDate || '—',
      ];
    });

    // Total row
    const totalOs = displayed.reduce((s, b) => s + (b.outstandingAmount || 0), 0);
    body.push(['', '', '', '', 'TOTAL', `Rs.${totalOs.toLocaleString('en-IN')}`, '', '']);

    autoTable(doc, {
      startY: 22,
      head,
      body,
      // Base styles — bold font, tight padding, 8pt
      styles: {
        font: 'helvetica',
        fontStyle: 'bold',
        fontSize: 8,
        cellPadding: { top: 1.5, bottom: 1.5, left: 2, right: 2 },
      },
      headStyles: {
        fillColor: [79, 70, 229],
        textColor: 255,
        fontStyle: 'bold',
        fontSize: 8,
        cellPadding: { top: 2, bottom: 2, left: 2, right: 2 },
      },
      // Column widths summing to 182 mm (portrait A4 usable width)
      columnStyles: {
        0: { halign: 'center', cellWidth: 8  },   // #
        1: { halign: 'center', cellWidth: 20 },   // Bill Date
        2: { halign: 'left',   cellWidth: 28 },   // Bill No
        3: { halign: 'left',   cellWidth: 50 },   // Party Name
        4: { halign: 'left',   cellWidth: 28 },   // Salesperson
        5: { halign: 'right',  cellWidth: 24 },   // O/S Amt
        6: { halign: 'left',   cellWidth: 14 },   // Given To
        7: { halign: 'center', cellWidth: 10 },   // Give Date
      },
      didParseCell(data) {
        if (data.row.index === body.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [240, 240, 255];
        }
      },
      alternateRowStyles: { fillColor: [248, 248, 255] },
      margin: { left: 14, right: 14 },
    });

    const fileName = delDateFilter
      ? `credit-bills-${delDateFilter}.pdf`
      : `credit-bills-${now.toISOString().slice(0, 10)}.pdf`;
    doc.save(fileName);
  }

  // ── Header sort cell ─────────────────────────────────────────────────────────
  const renderTh = (col: SortKey, label: string, right?: boolean) => {
    const active = sortKey === col;
    return (
      <th
        key={col}
        onClick={() => toggleSort(col)}
        className={cn(
          'px-2 py-2 text-[8px] font-black uppercase tracking-widest cursor-pointer select-none whitespace-nowrap',
          'hover:bg-muted transition-colors',
          right ? 'text-right' : 'text-left'
        )}
      >
        <div className={cn('flex items-center gap-0.5', right && 'justify-end')}>
          <span>{label}</span>
          {active
            ? (sortDir === 'asc' ? <ChevronUp className="w-2.5 h-2.5 text-primary shrink-0" /> : <ChevronDown className="w-2.5 h-2.5 text-primary shrink-0" />)
            : <ChevronUp className="w-2.5 h-2.5 opacity-20 shrink-0" />}
        </div>
      </th>
    );
  };

  // ── Password gate UI ────────────────────────────────────────────────────────
  if (!unlocked) {
    return (
      <div className="min-h-screen bg-background pt-10">
        <TopNav />
        <div className="fixed inset-0 z-40 flex items-start justify-center pt-4 p-4 bg-background/80 backdrop-blur-sm">
          <div className="bg-white rounded-3xl p-6 w-full max-w-xs shadow-2xl">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center shrink-0">
                <Shield className="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <p className="text-sm font-black text-gray-900 uppercase tracking-widest leading-none">Credit Bills</p>
                <p className="text-[9px] text-gray-500 font-semibold mt-0.5">Enter owner password</p>
              </div>
            </div>

            <div className="relative mb-3">
              <input
                type={showPw ? 'text' : 'password'}
                placeholder="PASSWORD"
                autoFocus
                value={pwInput}
                onChange={e => { setPwInput(e.target.value); setPwError(false); }}
                onKeyDown={e => e.key === 'Enter' && handleUnlock()}
                className={cn(
                  'w-full h-12 px-4 pr-11 rounded-xl border-2 text-sm font-black uppercase text-center tracking-widest focus:outline-none transition-all',
                  pwError
                    ? 'border-red-400 bg-red-50 text-red-600 animate-bounce'
                    : 'border-gray-200 bg-gray-50 text-gray-900 focus:border-indigo-400'
                )}
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {pwError && (
              <p className="text-center text-xs font-black text-red-500 uppercase mb-3 tracking-wide">
                Wrong Password
              </p>
            )}

            <button
              onClick={handleUnlock}
              className="w-full h-12 rounded-xl font-black uppercase text-sm tracking-widest text-white transition-all active:scale-95"
              style={{ background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)' }}
            >
              Unlock
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main page ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background pb-4 pt-10 w-full overflow-x-hidden">
      <TopNav />

      {/* Header bar */}
      <div className="bg-primary px-3 py-2 rounded-b-lg shadow-sm">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="shrink-0">
            <h1 className="text-[11px] font-black text-primary-foreground uppercase tracking-widest leading-none">
              Credit Bills
            </h1>
            <p className="text-[8px] font-bold text-primary-foreground/60 uppercase tracking-tighter mt-0.5">
              {displayed.length}{delDateFilter ? ` of ${sorted.length}` : ''} bills
              {selected.size > 0 && ` · ${selected.size} selected · ₹${selectedOutstanding.toLocaleString('en-IN')} O/S`}
            </p>
          </div>

          {/* Del Date filter + PDF button */}
          <div className="flex items-center gap-2">
            {/* Del Date picker */}
            <div className="flex items-center gap-1 bg-primary-foreground/10 rounded-lg px-2 py-1">
              <span className="text-[8px] font-black text-primary-foreground/70 uppercase tracking-wider whitespace-nowrap">
                Del Date
              </span>
              <input
                type="date"
                value={delDateFilter}
                onChange={e => setDelDateFilter(e.target.value)}
                className="h-5 px-1 rounded text-[9px] font-black border-0 outline-none bg-white text-gray-800 cursor-pointer"
              />
              {delDateFilter && (
                <button
                  onClick={() => setDelDateFilter('')}
                  className="text-primary-foreground/60 hover:text-primary-foreground transition-colors"
                  title="Clear filter"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* PDF Download button */}
            <button
              onClick={handlePdfDownload}
              disabled={displayed.length === 0}
              className={cn(
                'flex items-center gap-1.5 h-7 px-3 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all active:scale-95',
                displayed.length === 0
                  ? 'bg-primary-foreground/10 text-primary-foreground/30 cursor-not-allowed'
                  : 'bg-white text-indigo-700 hover:bg-indigo-50 shadow-sm'
              )}
            >
              <FileDown className="w-3.5 h-3.5" />
              PDF
            </button>

            <Lock className="w-3.5 h-3.5 text-primary-foreground/40 shrink-0" />
          </div>
        </div>
      </div>

      {/* Search bar */}
      <div className="px-3 py-2 bg-white border-b border-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Bill No, Party Name ya Credit No (1001) search karo..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full h-8 pl-8 pr-8 rounded-lg border border-border bg-muted/40 text-[11px] font-semibold text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary focus:bg-white transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Active del-date badge */}
      {delDateFilter && (
        <div className="px-3 py-1.5 bg-indigo-50 border-b border-indigo-100 flex items-center gap-2">
          <span className="text-[9px] font-black text-indigo-600 uppercase tracking-wider">
            Showing Del Date: {delDateFilter}
          </span>
          <span className="text-[9px] text-indigo-400">({displayed.length} bills)</span>
          <button
            onClick={() => setDelDateFilter('')}
            className="ml-auto text-[9px] font-black text-indigo-400 hover:text-indigo-700 uppercase tracking-wider flex items-center gap-0.5"
          >
            <X className="w-2.5 h-2.5" /> Clear
          </button>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : (
        <div className="overflow-x-auto w-full">
          <table className="w-full border-collapse min-w-[680px]">
            <thead className="sticky top-10 z-10">
              <tr className="bg-muted/80 border-b border-border backdrop-blur-sm">
                {/* Checkbox header */}
                <th className="px-2 py-2 w-7">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleAll}
                    className="w-3.5 h-3.5 accent-blue-500 cursor-pointer"
                  />
                </th>
                {renderTh('date', 'Bill Date')}
                {renderTh('billNo', 'Bill No')}
                {renderTh('partyName', 'Party Name')}
                {renderTh('salespersonName', 'Salesperson')}
                {renderTh('outstandingAmount', 'O/S Amt', true)}
                {renderTh('givenTo', 'Given To')}
                {renderTh('giveDate', 'Give Date')}
              </tr>
            </thead>

            <tbody>
              {displayed.map(bill => {
                const isSelected = selected.has(bill.id);
                const assign = assigns[bill.id] || { givenTo: '', giveDate: '' };

                return (
                  <tr
                    key={bill.id}
                    className={cn(
                      'border-b border-border transition-colors',
                      isSelected ? 'bg-blue-50' : 'bg-white hover:bg-gray-50/60'
                    )}
                  >
                    {/* Checkbox */}
                    <td className="px-1.5 py-[2px]">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(bill.id)}
                        className="w-3.5 h-3.5 accent-blue-500 cursor-pointer"
                      />
                    </td>

                    {/* Bill Date */}
                    <td className="px-1.5 py-[2px] text-[9px] font-black whitespace-nowrap">
                      {bill.date || '—'}
                    </td>

                    {/* Bill No */}
                    <td className="px-1.5 py-[2px] text-[9px] font-black whitespace-nowrap text-blue-700">
                      {bill.billNo || '—'}
                    </td>

                    {/* Party Name */}
                    <td className="px-1.5 py-[2px] text-[9px] font-black max-w-[110px] truncate">
                      {bill.partyName || '—'}
                    </td>

                    {/* Salesperson Name */}
                    <td className="px-1.5 py-[2px] text-[9px] font-black max-w-[80px] truncate">
                      {bill.salespersonName || '—'}
                    </td>

                    {/* Outstanding Amount */}
                    <td className="px-1.5 py-[2px] text-[9px] font-black text-red-600 text-right whitespace-nowrap">
                      ₹{(bill.outstandingAmount || 0).toLocaleString('en-IN')}
                    </td>

                    {/* Given To (salesperson select) */}
                    <td className="px-1.5 py-[2px]">
                      <select
                        value={assign.givenTo}
                        onChange={e => {
                          const givenTo = e.target.value;
                          const today = new Date().toISOString().slice(0, 10);
                          updateAssign(bill.id, {
                            givenTo,
                            giveDate: givenTo ? today : assign.giveDate,
                          });
                        }}
                        className="h-6 px-1.5 bg-muted rounded text-[9px] font-black border-0 outline-none w-full max-w-[120px] cursor-pointer"
                      >
                        <option value="">— Select —</option>
                        {salespersons.map(sp => (
                          <option key={sp} value={sp}>{sp}</option>
                        ))}
                      </select>
                    </td>

                    {/* Give Date */}
                    <td className="px-1.5 py-[2px]">
                      <input
                        type="date"
                        value={assign.giveDate}
                        onChange={e => updateAssign(bill.id, { giveDate: e.target.value })}
                        className="h-6 px-1.5 bg-muted rounded text-[9px] font-black border-0 outline-none w-full max-w-[110px]"
                      />
                    </td>
                  </tr>
                );
              })}

              {/* Total row */}
              {displayed.length > 0 && (
                <tr className="bg-indigo-50 border-t-2 border-indigo-200">
                  <td colSpan={5} className="px-2 py-1.5 text-[9px] font-black uppercase tracking-widest text-indigo-700 text-right">
                    Total ({displayed.length} bills)
                  </td>
                  <td className="px-1.5 py-1.5 text-[9px] font-black text-red-700 text-right whitespace-nowrap">
                    ₹{displayed.reduce((s, b) => s + (b.outstandingAmount || 0), 0).toLocaleString('en-IN')}
                  </td>
                  <td colSpan={2} />
                </tr>
              )}

              {displayed.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="text-center py-16 text-[10px] font-black text-muted-foreground uppercase tracking-widest"
                  >
                    {delDateFilter ? `No credit bills for del date ${delDateFilter}` : 'No credit bills found'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
