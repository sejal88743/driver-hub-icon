import { useState, useMemo, useEffect, useCallback, useDeferredValue } from 'react';
import { Search, Filter, Loader2, X, ChevronUp, ChevronDown, MessageCircle, Clock, XCircle, RotateCcw, RefreshCw } from 'lucide-react';
import { useBillStore } from '@/hooks/use-bill-store';
import BillDetailModal from '@/components/BillDetailModal';
import TopNav from '@/components/TopNav';
import { cn } from '@/lib/utils';
import { Bill, getWhatsAppTemplates, getPartyContacts, getSalespersonContacts, findSalespersonContact } from '@/lib/billStore';
import SalespersonAutoDispatchModal from '@/components/SalespersonAutoDispatchModal';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

function stripGST(billNo: string) {
  return billNo ? billNo.replace(/^GST[-_]/i, '') : '';
}

function parseDMY(dStr?: string): number {
  if (!dStr) return 0;
  const slashIdx1 = dStr.indexOf('/');
  if (slashIdx1 === -1) return 0;
  const slashIdx2 = dStr.indexOf('/', slashIdx1 + 1);
  if (slashIdx2 === -1) return 0;
  
  const d = parseInt(dStr.slice(0, slashIdx1), 10);
  const m = parseInt(dStr.slice(slashIdx1 + 1, slashIdx2), 10);
  const y = parseInt(dStr.slice(slashIdx2 + 1), 10);
  if (!isNaN(d) && !isNaN(m) && !isNaN(y)) {
    return y * 10000 + m * 100 + d;
  }
  return 0;
}

function getBillStatusWeight(b: Bill): number {
  const collected = b.collectedAmount || 0;
  if (collected > 0) return 4; // PAID
  const mode = b.paymentMode;
  if (mode === 'Cancel' || mode === 'FBR') return 1;
  const lineCut = b.lineCutAmt || 0;
  const netAfterLC = b.billNetAmt - lineCut;
  if (!b.paymentDate && Math.abs(netAfterLC) <= 1 && mode !== 'Credit' && mode !== 'Del Pending' && mode !== 'Pending') return 1; // FBR
  if (mode === 'Credit') return 2; // CREDIT
  if (mode === 'Del Pending' || mode === 'Pending') return 3; // DEL PEND
  if (!b.deliveryDate) return 5; // UNPAID
  return 5;
}

export default function BillsPage() {
  const { bills, loading, syncing, syncFromApi } = useBillStore();
  
  const [searchInput, setSearchInput] = useState('');
  const search = useDeferredValue(searchInput);
  const [sortField, setSortField] = useState<keyof Bill | 'status' | 'lineCut' | ''>('billNo');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filterSP, setFilterSP] = useState('');
  const [filterParty, setFilterParty] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // WhatsApp template selection popup
  const [waPopup, setWaPopup] = useState<{ bill: Bill; target: 'party' | 'sales' } | null>(null);
  const [showAutoDispatch, setShowAutoDispatch] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sp = params.get('salesperson');
    if (sp) {
      setFilterSP(sp);
      setShowFilters(true);
    }
  }, []);

  useEffect(() => { setPage(1); }, [search, filterSP, filterParty, sortField, sortDir, pageSize]);

  const salespersons = useMemo(() => {
    if (!showFilters && !filterSP) return [];
    const seen = new Map<string, string>();
    bills.forEach(b => {
      if (b.salespersonName) {
        const key = b.salespersonName.trim().toLowerCase();
        if (!seen.has(key)) seen.set(key, b.salespersonName.trim());
      }
    });
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  }, [bills, showFilters, filterSP]);

  const parties = useMemo(() => {
    if (!showFilters && !filterParty) return [];
    const seen = new Map<string, string>();
    bills.forEach(b => {
      if (b.partyName) {
        const key = b.partyName.trim().toLowerCase();
        if (!seen.has(key)) seen.set(key, b.partyName.trim());
      }
    });
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  }, [bills, showFilters, filterParty]);

  const filtered = useMemo(() => {
    let result = bills;
    if (filterSP) {
      const spClean = filterSP.trim().toLowerCase();
      result = result.filter(b => (b.salespersonName || '').trim().toLowerCase() === spClean);
    }
    if (filterParty) {
      const partyClean = filterParty.trim().toLowerCase();
      result = result.filter(b => (b.partyName || '').trim().toLowerCase() === partyClean);
    }
    if (search) {
      const q = search.toLowerCase().trim();
      result = result.filter(b =>
        (b.billNo && b.billNo.toLowerCase().includes(q)) ||
        (b.partyName && b.partyName.toLowerCase().includes(q)) ||
        (b.salespersonName && b.salespersonName.toLowerCase().includes(q)) ||
        (b.driverName && b.driverName.toLowerCase().includes(q)) ||
        String(b.billNetAmt || '').includes(q) ||
        String(b.collectedAmount || '').includes(q)
      );
    }

    if (sortField || search) {
      const mult = sortDir === 'asc' ? 1 : -1;
      const sorted = [...result];
      const q = search ? search.toLowerCase().trim() : '';

      sorted.sort((a, b) => {
        // 1. If searching, prioritize exact bill number match
        if (q) {
          const aExact = (a.billNo || '').toLowerCase() === q;
          const bExact = (b.billNo || '').toLowerCase() === q;
          if (aExact !== bExact) return aExact ? -1 : 1;
        }

        // 2. Primary sort field
        if (sortField) {
          let cmp = 0;
          if (sortField === 'billNo') {
            cmp = (a.billNo || '').localeCompare(b.billNo || '', undefined, { numeric: true });
          } else if (sortField === 'date') {
            cmp = parseDMY(a.date) - parseDMY(b.date);
          } else if (sortField === 'deliveryDate') {
            cmp = parseDMY(a.deliveryDate) - parseDMY(b.deliveryDate);
          } else if (sortField === 'paymentDate') {
            cmp = parseDMY(a.paymentDate) - parseDMY(b.paymentDate);
          } else if (sortField === 'collectedAmount') {
            cmp = (a.collectedAmount || 0) - (b.collectedAmount || 0);
          } else if (sortField === 'billNetAmt') {
            cmp = (a.billNetAmt || 0) - (b.billNetAmt || 0);
          } else if (sortField === 'lineCut') {
            cmp = (a.lineCutAmt || 0) - (b.lineCutAmt || 0);
          } else if (sortField === 'billAgeing') {
            cmp = (a.billAgeing || 0) - (b.billAgeing || 0);
          } else if (sortField === 'status') {
            cmp = getBillStatusWeight(a) - getBillStatusWeight(b);
          } else {
            const va = String(a[sortField as keyof Bill] || '').toLowerCase();
            const vb = String(b[sortField as keyof Bill] || '').toLowerCase();
            cmp = va.localeCompare(vb);
          }

          if (cmp !== 0) return cmp * mult;
        }

        // Tie breaker by billNo ascending
        return (a.billNo || '').localeCompare(b.billNo || '', undefined, { numeric: true });
      });
      result = sorted;
    }

    return result;
  }, [bills, search, sortField, sortDir, filterSP, filterParty]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = useMemo(() => {
    return filtered.slice((page - 1) * pageSize, page * pageSize);
  }, [filtered, page, pageSize]);

  const goToPage = useCallback((p: number) => setPage(Math.min(Math.max(1, p), totalPages)), [totalPages]);

  function toggleSort(field: keyof Bill | 'status' | 'lineCut') {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  }

  function renderSortHeader(label: string, field: keyof Bill | 'status' | 'lineCut', align: 'left' | 'center' | 'right' = 'left') {
    const isCurrent = sortField === field;
    return (
      <TableHead
        onClick={() => toggleSort(field)}
        className={cn(
          "text-[10px] font-black uppercase px-2 py-2 cursor-pointer transition-colors select-none hover:bg-muted/90 hover:text-primary",
          align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left',
          isCurrent && "text-primary bg-primary/10"
        )}
      >
        <div className={cn("inline-flex items-center gap-1", align === 'center' && "justify-center", align === 'right' && "justify-end")}>
          <span>{label}</span>
          {isCurrent ? (
            sortDir === 'asc' ? <ChevronUp className="w-3 h-3 text-primary shrink-0" /> : <ChevronDown className="w-3 h-3 text-primary shrink-0" />
          ) : (
            <span className="text-[8px] opacity-20 hover:opacity-50">↕</span>
          )}
        </div>
      </TableHead>
    );
  }

  function formatMobile(raw: string) {
    const m = String(raw).trim();
    if (!m) return '';
    return m.startsWith('+') ? m : m.startsWith('91') ? `+${m}` : `+91${m}`;
  }

  function buildDaysOld(bill: Bill) {
    const now = new Date();
    const [d, m, y] = bill.date.split('/').map(Number);
    const bDate = new Date(y, m - 1, d);
    return Math.ceil(Math.abs(now.getTime() - bDate.getTime()) / (1000 * 60 * 60 * 24));
  }

  function buildPendingMessage(bill: Bill) {
    const t = getWhatsAppTemplates().pending;
    return t
      .replace(/{{billNo}}/g, bill.billNo)
      .replace(/{{billDate}}/g, bill.date)
      .replace(/{{partyName}}/g, bill.partyName)
      .replace(/{{billAmt}}/g, (bill.billNetAmt || 0).toLocaleString('en-IN'))
      .replace(/{{days}}/g, String(buildDaysOld(bill)));
  }

  function buildFbrMessage(bill: Bill) {
    const t = getWhatsAppTemplates().fbr;
    return t
      .replace(/{{billNo}}/g, bill.billNo)
      .replace(/{{billDate}}/g, bill.date)
      .replace(/{{partyName}}/g, bill.partyName)
      .replace(/{{billAmt}}/g, (bill.billNetAmt || 0).toLocaleString('en-IN'));
  }

  function buildReturnChequeMessage(bill: Bill) {
    const t = getWhatsAppTemplates().returnCheque;
    const chqNo = (bill.chequeNo || '').trim().toLowerCase();

    // Find all bills linked to the same cheque number (same party, case-insensitive trim match)
    const relatedBills = chqNo
      ? bills.filter(b => (b.chequeNo || '').trim().toLowerCase() === chqNo && b.partyName === bill.partyName)
      : [bill];

    // Bill nos joined with +
    const allBillNos = relatedBills.map(b => b.billNo).join('+');

    // Total amount = billNetAmt - lineCutAmt for each related bill
    const totalAmt = relatedBills.reduce((s, b) => {
      const lc = Number(b.lineCutAmt) || 0;
      return s + Math.max(0, (b.billNetAmt || 0) - lc);
    }, 0);

    // Cheque amount = sum of chequeAmount across related bills
    const totalChequeAmt = relatedBills.reduce((s, b) => {
      const chqAmt = Number(b.chequeAmount) || 0;
      const collected = (b.paymentMethod === 'Cheque' && !chqAmt) ? (Number(b.collectedAmount) || 0) : chqAmt;
      return s + collected;
    }, 0);

    // Pull chequeDate and bankName from the clicked bill (all related bills share the same cheque)
    const chequeDate = bill.chequeDate || '-';
    const bankName = bill.bankName || '-';
    const displayChequeNo = bill.chequeNo || '-';

    return t
      .replace(/{{partyName}}/g, bill.partyName)
      .replace(/{{allBillNos}}/g, allBillNos || bill.billNo)
      .replace(/{{totalAmt}}/g, totalAmt.toLocaleString('en-IN'))
      .replace(/{{chequeAmt}}/g, totalChequeAmt.toLocaleString('en-IN'))
      .replace(/{{chequeNo}}/g, displayChequeNo)
      .replace(/{{chequeDate}}/g, chequeDate)
      .replace(/{{bankName}}/g, bankName);
  }

  function sendWa(bill: Bill, templateType: 'pending' | 'fbr' | 'returnCheque', target: 'party' | 'sales') {
    let message = '';
    if (templateType === 'pending') message = buildPendingMessage(bill);
    else if (templateType === 'fbr') message = buildFbrMessage(bill);
    else message = buildReturnChequeMessage(bill);

    let mobile = '';
    if (target === 'party') {
      const contact = getPartyContacts().find(c => c.name.toLowerCase() === bill.partyName.toLowerCase());
      mobile = formatMobile(contact?.mobile || '');
    } else {
      const contact = findSalespersonContact(bill.salespersonName) || getSalespersonContacts().find(c => (c.name || '').toLowerCase() === (bill.salespersonName || '').toLowerCase());
      mobile = formatMobile(contact?.mobile || '');
    }
    window.open(`https://wa.me/${mobile}?text=${encodeURIComponent(message)}`, '_blank');
    setWaPopup(null);
  }

  function handleWhatsApp(bill: Bill) {
    setWaPopup({ bill, target: 'party' });
  }

  function handleWhatsAppSales(bill: Bill) {
    setWaPopup({ bill, target: 'sales' });
  }

  const isTrulyEmptyAndLoading = loading && bills.length === 0;

  return (
    <div className="min-h-screen bg-background pb-6 pt-10 w-full">
      <TopNav />
      <div className="bg-primary px-3 pt-2 pb-2 rounded-b-xl shadow-md w-full flex items-center justify-between">
        <div>
          <h1 className="text-sm font-black text-primary-foreground uppercase tracking-widest max-w-full mx-auto flex items-center gap-2">
            Bill Registry
            {syncing && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-black bg-white/20 text-white animate-pulse">
                <RefreshCw className="w-2.5 h-2.5 animate-spin" /> SYNCING...
              </span>
            )}
          </h1>
          <p className="text-[10px] font-black text-primary-foreground/60 uppercase tracking-tighter max-w-full mx-auto">
            {isTrulyEmptyAndLoading ? 'LOADING FROM DATABASE...' : `${filtered.length} RECORDS · PAGE ${page}/${totalPages}`}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => syncFromApi()}
            disabled={syncing}
            title="Refresh bills from Supabase"
            className="p-1.5 bg-primary-foreground/10 hover:bg-primary-foreground/20 text-primary-foreground rounded-lg transition-all active:scale-95 disabled:opacity-50"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", syncing && "animate-spin")} />
          </button>
          <button
            onClick={() => setShowAutoDispatch(true)}
            className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-slate-950 font-black rounded-lg text-[10px] uppercase tracking-tight flex items-center gap-1.5 shadow"
          >
            <MessageCircle className="w-3.5 h-3.5 fill-slate-950" />
            ⚡ 50 Salesperson Auto Dispatch
          </button>
        </div>
      </div>

      <div className="max-w-full mx-auto px-3 mt-2 space-y-1">
        <div className="bg-card rounded-xl border border-border shadow-sm flex items-center px-3 h-11 gap-2">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            type="text"
            inputMode="numeric"
            placeholder="SEARCH BILL NO, PARTY, SALESPERSON, AMOUNT..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="flex-1 bg-transparent border-0 text-[11px] font-black focus:outline-none uppercase placeholder:text-muted-foreground/30"
          />
          {searchInput && (
            <button
              onClick={() => setSearchInput('')}
              className="p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <button onClick={() => setShowFilters(!showFilters)} className={cn("p-1.5 rounded-lg transition-colors", showFilters ? "bg-primary/10 text-primary" : "text-muted-foreground")}>
            <Filter className="w-4 h-4" />
          </button>
        </div>

        {showFilters && (
          <div className="bg-card rounded-xl p-3 border border-border shadow-lg animate-in slide-in-from-top-1">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Advanced Filters</span>
              {(filterSP || filterParty) && <button onClick={() => { setFilterSP(''); setFilterParty(''); }} className="text-[10px] font-black text-primary uppercase">Clear</button>}
            </div>
            <div className="space-y-2">
              <select value={filterSP} onChange={(e) => setFilterSP(e.target.value)} className="w-full h-9 bg-muted rounded-lg border-0 text-[11px] font-black focus:outline-none">
                <option value="">ALL SALESPERSONS</option>
                {salespersons.map(sp => <option key={sp} value={sp}>{sp}</option>)}
              </select>
              <select value={filterParty} onChange={(e) => setFilterParty(e.target.value)} className="w-full h-9 bg-muted rounded-lg border-0 text-[11px] font-black focus:outline-none">
                <option value="">ALL PARTIES</option>
                {parties.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
        )}

        {!isTrulyEmptyAndLoading && search && filtered.length === 0 && (
          <div className="bg-destructive/10 border-2 border-destructive/30 rounded-2xl px-4 py-4 text-center animate-in fade-in duration-200">
            <p className="text-[13px] font-black text-destructive uppercase tracking-widest">⚠ NOT FOUND</p>
            <p className="text-[10px] font-bold text-muted-foreground mt-1 uppercase">"{search}" — No matching bill</p>
          </div>
        )}

        {isTrulyEmptyAndLoading ? (
          <div className="bg-card border border-border/60 rounded-xl shadow-sm overflow-hidden p-6 space-y-4">
            <div className="flex items-center justify-center gap-3 py-6 text-primary">
              <Loader2 className="w-6 h-6 animate-spin" />
              <div className="text-left">
                <p className="text-xs font-black uppercase tracking-wider">Loading Bills from Database...</p>
                <p className="text-[10px] font-bold text-muted-foreground uppercase">Please wait a moment while records are synced</p>
              </div>
            </div>
            {/* Skeleton rows */}
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, idx) => (
                <div key={idx} className="h-8 bg-muted/60 rounded-lg animate-pulse" />
              ))}
            </div>
          </div>
        ) : (
          <div className="bg-card border border-border/60 rounded-xl shadow-sm overflow-hidden w-full">
            <div className="overflow-x-auto no-scrollbar w-full">
              <Table className="w-full border-separate border-spacing-y-[2px] text-[11px]">
                <TableHeader className="bg-muted/80">
                  <TableRow className="border-b border-border">
                    <TableHead className="text-[10px] font-black uppercase px-2 py-2 text-left">#</TableHead>
                    {renderSortHeader("Bill Date", "date", "left")}
                    {renderSortHeader("Bill No", "billNo", "left")}
                    {renderSortHeader("Party Name", "partyName", "left")}
                    {renderSortHeader("Salesperson", "salespersonName", "left")}
                    {renderSortHeader("Del Date", "deliveryDate", "center")}
                    {renderSortHeader("Driver", "driverName", "left")}
                    {renderSortHeader("Rec Date", "paymentDate", "center")}
                    {renderSortHeader("Collection Amt", "collectedAmount", "right")}
                    {renderSortHeader("Net Amt", "billNetAmt", "right")}
                    {renderSortHeader("Line Cut", "lineCut", "right")}
                    {renderSortHeader("Ageing", "billAgeing", "center")}
                    {renderSortHeader("Status", "status", "center")}
                    <TableHead className="text-[10px] font-black uppercase px-2 py-2 text-center whitespace-nowrap">WhatsApp Send</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginated.map((bill, i) => {
                    const rowIdx = (page - 1) * pageSize + i + 1;
                    const lineCut = bill.lineCutAmt || 0;
                    const netAfterLC = bill.billNetAmt - lineCut;
                    const collected = bill.collectedAmount || 0;
                    const isCreditMode = bill.paymentMode === 'Credit';
                    const isDelPendMode = bill.paymentMode === 'Del Pending' || bill.paymentMode === 'Pending';
                    const isPaid = collected > 0;
                    const isAutoFbr = !bill.paymentDate && Math.abs(netAfterLC) <= 1 && collected === 0 && !isCreditMode && !isDelPendMode;
                    const isManualFbr = bill.paymentMode === 'Cancel' || bill.paymentMode === 'FBR';
                    const isCancel = isManualFbr || isAutoFbr;
                    const isCredit = !isCancel && !isDelPendMode && !isPaid && isCreditMode;
                    const isDelPend = isDelPendMode && collected === 0;

                    const isUnpaidRow = !bill.deliveryDate && collected === 0;
                    const statusLabel = isCancel
                      ? 'FBR'
                      : isCredit
                      ? 'CREDIT'
                      : isDelPend
                      ? 'DEL PEND'
                      : isPaid
                      ? 'PAID'
                      : isUnpaidRow
                      ? 'UNPAID'
                      : '';

                    const statusClass = isCancel
                      ? 'bg-rose-600 text-white'
                      : isCredit
                      ? 'bg-emerald-600 text-white'
                      : isDelPend
                      ? 'bg-amber-400 text-black'
                      : isPaid
                      ? 'bg-emerald-500 text-white'
                      : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300';

                    return (
                      <TableRow
                        key={bill.billNo || i}
                        onClick={() => setSelectedBill(bill)}
                        className={cn(
                          "font-black cursor-pointer transition-colors hover:bg-primary/5",
                          isCancel && "bg-red-100/90 hover:bg-red-200/80",
                          isCredit && "bg-green-100/90 hover:bg-green-200/80",
                          isDelPend && "bg-yellow-100/90 hover:bg-yellow-200/80",
                          !isCancel && !isCredit && !isDelPend && isPaid && "bg-emerald-50/80 hover:bg-emerald-100/80"
                        )}
                      >
                        <TableCell className="text-[11px] font-black px-2 py-1.5 whitespace-nowrap text-foreground">{rowIdx}</TableCell>
                        <TableCell className="text-[11px] font-black px-2 py-1.5 whitespace-nowrap text-foreground">{bill.date || '-'}</TableCell>
                        <TableCell className="text-[11px] font-black px-2 py-1.5 whitespace-nowrap text-primary">{stripGST(bill.billNo)}</TableCell>
                        <TableCell className="text-[11px] font-black px-2 py-1.5 truncate max-w-[180px] text-foreground">{bill.partyName || '-'}</TableCell>
                        <TableCell className="text-[11px] font-black px-2 py-1.5 truncate max-w-[140px] text-primary">{bill.salespersonName || '—'}</TableCell>
                        <TableCell className="text-[11px] font-black px-2 py-1.5 text-center whitespace-nowrap text-indigo-700">{bill.deliveryDate || '-'}</TableCell>
                        <TableCell className="text-[11px] font-black px-2 py-1.5 truncate max-w-[110px] text-foreground">{bill.driverName || '-'}</TableCell>
                        <TableCell className="text-[11px] font-black px-2 py-1.5 text-center whitespace-nowrap text-orange-700">{collected > 0 && bill.paymentDate ? bill.paymentDate : '-'}</TableCell>
                        <TableCell className="text-[11px] font-black px-2 py-1.5 text-right whitespace-nowrap">
                          {collected > 0 ? (
                            <span className="text-emerald-700 font-black">₹{collected.toLocaleString('en-IN')}</span>
                          ) : (
                            <span className="text-muted-foreground font-black">₹0</span>
                          )}
                        </TableCell>
                        <TableCell className="text-[11px] font-black px-2 py-1.5 text-right whitespace-nowrap text-foreground">
                          ₹{(bill.billNetAmt || 0).toLocaleString('en-IN')}
                        </TableCell>
                        <TableCell className="text-[11px] font-black px-2 py-1.5 text-right whitespace-nowrap text-rose-600">
                          {lineCut > 0 ? `₹${lineCut.toLocaleString('en-IN')}` : '-'}
                        </TableCell>
                        <TableCell className="text-[11px] font-black px-2 py-1.5 text-center whitespace-nowrap text-muted-foreground">
                          {bill.billAgeing ?? '-'}
                        </TableCell>
                        <TableCell className="text-[11px] px-2 py-1.5 text-center whitespace-nowrap">
                          <span className={cn('px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-tight', statusClass)}>
                            {statusLabel}
                          </span>
                        </TableCell>
                        <TableCell className="text-[11px] px-2 py-1.5 text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleWhatsApp(bill); }}
                              title="WhatsApp Party Send"
                              className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-md shadow-sm transition-all text-[9px] font-black uppercase tracking-tight"
                            >
                              <MessageCircle className="w-3 h-3 shrink-0" />
                              Party
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleWhatsAppSales(bill); }}
                              title="WhatsApp Salesperson Send"
                              className="inline-flex items-center gap-1 px-2 py-1 bg-orange-500 hover:bg-orange-600 active:scale-95 text-white rounded-md shadow-sm transition-all text-[9px] font-black uppercase tracking-tight"
                            >
                              <MessageCircle className="w-3 h-3 shrink-0" />
                              Sales
                            </button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {!isTrulyEmptyAndLoading && filtered.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-3 pb-2 px-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-black text-muted-foreground uppercase">Rows:</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="h-7 px-1.5 rounded-lg border border-border bg-card text-[9px] font-black text-foreground focus:outline-none"
              >
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
                <option value={500}>500</option>
              </select>
              <span className="text-[9px] font-black text-muted-foreground uppercase ml-1">{filtered.length} total</span>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => goToPage(1)}
                  disabled={page === 1}
                  className="px-2 py-1 rounded-lg text-[9px] font-black uppercase border border-border bg-card disabled:opacity-30 hover:border-primary/50 transition-colors"
                >«</button>
                <button
                  onClick={() => goToPage(page - 1)}
                  disabled={page === 1}
                  className="px-2.5 py-1 rounded-lg text-[9px] font-black uppercase border border-border bg-card disabled:opacity-30 hover:border-primary/50 transition-colors"
                >PREV</button>
                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let p: number;
                    if (totalPages <= 5) p = i + 1;
                    else if (page <= 3) p = i + 1;
                    else if (page >= totalPages - 2) p = totalPages - 4 + i;
                    else p = page - 2 + i;
                    return (
                      <button
                        key={p}
                        onClick={() => goToPage(p)}
                        className={cn(
                          "w-7 h-7 rounded-lg text-[9px] font-black uppercase border transition-colors",
                          page === p ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:border-primary/50"
                        )}
                      >{p}</button>
                    );
                  })}
                </div>
                <button
                  onClick={() => goToPage(page + 1)}
                  disabled={page === totalPages}
                  className="px-2.5 py-1 rounded-lg text-[9px] font-black uppercase border border-border bg-card disabled:opacity-30 hover:border-primary/50 transition-colors"
                >NEXT</button>
                <button
                  onClick={() => goToPage(totalPages)}
                  disabled={page === totalPages}
                  className="px-2 py-1 rounded-lg text-[9px] font-black uppercase border border-border bg-card disabled:opacity-30 hover:border-primary/50 transition-colors"
                >»</button>
              </div>
            )}
          </div>
        )}
      </div>

      {selectedBill && <BillDetailModal bill={selectedBill} onClose={() => setSelectedBill(null)} />}

      {/* WhatsApp Template Selection Popup */}
      {waPopup && (
        <div className="fixed inset-0 bg-black/70 z-[200] flex items-start sm:items-center justify-center pt-6 sm:pt-0 px-4 backdrop-blur-sm">
          <div className="bg-card rounded-3xl p-5 w-full max-w-xs shadow-2xl border border-border animate-in zoom-in-95">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-black text-sm uppercase text-primary flex items-center gap-2">
                <MessageCircle className="w-4 h-4" /> WhatsApp Message
              </h3>
              <button onClick={() => setWaPopup(null)} className="p-1 rounded-full hover:bg-muted transition-colors">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
            <p className="text-[9px] font-black text-muted-foreground uppercase mb-1 truncate">
              {waPopup.bill.partyName} · Bill #{waPopup.bill.billNo}
            </p>
            <p className="text-[9px] font-black text-muted-foreground uppercase mb-4">
              {waPopup.target === 'party' ? '📲 Party ko bhej rahe ho' : '📲 Salesperson ko bhej rahe ho'}
            </p>
            <div className="space-y-2">
              <button
                onClick={() => sendWa(waPopup.bill, 'pending', waPopup.target)}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-orange-50 border-2 border-orange-200 hover:border-orange-400 hover:bg-orange-100 transition-all text-left"
              >
                <Clock className="w-5 h-5 text-orange-500 shrink-0" />
                <div>
                  <p className="text-[11px] font-black uppercase text-orange-700">Pending Bill Alert</p>
                  <p className="text-[9px] font-bold text-orange-500/80 uppercase">Outstanding payment reminder</p>
                </div>
              </button>
              <button
                onClick={() => sendWa(waPopup.bill, 'fbr', waPopup.target)}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-rose-50 border-2 border-rose-200 hover:border-rose-400 hover:bg-rose-100 transition-all text-left"
              >
                <XCircle className="w-5 h-5 text-rose-500 shrink-0" />
                <div>
                  <p className="text-[11px] font-black uppercase text-rose-700">FBR Alert</p>
                  <p className="text-[9px] font-bold text-rose-500/80 uppercase">Full bill return notice</p>
                </div>
              </button>
              <button
                onClick={() => sendWa(waPopup.bill, 'returnCheque', waPopup.target)}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-violet-50 border-2 border-violet-200 hover:border-violet-400 hover:bg-violet-100 transition-all text-left"
              >
                <RotateCcw className="w-5 h-5 text-violet-500 shrink-0" />
                <div>
                  <p className="text-[11px] font-black uppercase text-violet-700">Cheque Return Alert</p>
                  <p className="text-[9px] font-bold text-violet-500/80 uppercase">
                    {waPopup.bill.chequeNo
                      ? `CHQ ${waPopup.bill.chequeNo} · ${bills.filter(b => b.chequeNo === waPopup.bill.chequeNo && b.partyName === waPopup.bill.partyName).length} bill(s)`
                      : 'Cheque return notice'}
                  </p>
                </div>
              </button>
            </div>
            <button onClick={() => setWaPopup(null)} className="mt-3 w-full py-2 rounded-2xl border border-border text-[10px] font-black uppercase text-muted-foreground hover:bg-muted transition-colors">Cancel</button>
          </div>
        </div>
      )}

      <SalespersonAutoDispatchModal
        isOpen={showAutoDispatch}
        onClose={() => setShowAutoDispatch(false)}
        bills={bills}
      />
    </div>
  );
}
