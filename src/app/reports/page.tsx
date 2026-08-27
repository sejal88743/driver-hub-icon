

import { useState, useMemo, useRef, useCallback, useDeferredValue, useEffect } from 'react';
import { useBillStore } from '@/hooks/use-bill-store';
import { FileText, Sheet as SheetIcon, Filter, Loader2, ChevronUp, ChevronDown, Calculator, IndianRupee } from 'lucide-react';
import { Button } from '@/components/ui/button';
import TopNav from '@/components/TopNav';
import { cn } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Bill } from '@/lib/billStore';
import BillEditModal from '@/components/BillEditModal';
import SalespersonAutoDispatchModal from '@/components/SalespersonAutoDispatchModal';
import { cleanPartyName, cleanSalespersonName, buildCanonicalMap } from '@/lib/nameStandardizer';
import { isGreenParty } from '@/lib/greenParties';
import { getCommissionMocs, CommissionMoc, isMocBill as checkIsMocBill, extractMocNumber, getDisplayBillNo, isBillMatchingMocCode } from '@/lib/commissionMoc';

type SortConfig = {
  key: keyof Bill | 'diff';
  direction: 'asc' | 'desc';
};

function getTodayDisplay() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}

export default function ReportsPage() {
  const { bills, loading, drivers, banks, summaries } = useBillStore();
  const todayDisplay = getTodayDisplay();
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [recDate, setRecDate] = useState('');
  const [driver, setDriver] = useState('');
  const [party, setParty] = useState('');
  const [salesperson, setSalesperson] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PAID' | 'UNPAID' | 'CREDIT' | 'FBR' | 'DEL_PENDING'>('ALL');
  
  const [viewMode, setViewMode] = useState<'detail' | 'datewise' | 'driverwise' | 'partywise' | 'salespersonwise'>('detail');
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [editBill, setEditBill] = useState<Bill | null>(null);
  const [sort, setSort] = useState<SortConfig>({ key: 'billNo', direction: 'asc' });
  const [showAutoDispatch, setShowAutoDispatch] = useState(false);
  const [commissionMocs, setCommissionMocs] = useState<CommissionMoc[]>(() => getCommissionMocs());
  const [showMocPicker, setShowMocPicker] = useState(false);

  useEffect(() => {
    setCommissionMocs(getCommissionMocs());
    const onUpdate = () => setCommissionMocs(getCommissionMocs());
    window.addEventListener('vt-commission-mocs-updated', onUpdate);
    return () => window.removeEventListener('vt-commission-mocs-updated', onUpdate);
  }, []);

  // Pagination for super fast rendering
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(50);

  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({
    idx: 32,
    date: 72,
    billNo: 72,
    partyName: 140,
    salespersonName: 110,
    driverName: 80,
    amt: 75,
    recDate: 72,
    delDate: 72,
    cash: 68,
    gpay: 68,
    chq: 68,
    lineCut: 68,
    diff: 68,
    status: 84,
    reason: 100,
    enteredBy: 80,
  });

  const resizing = useRef<{ key: string; startX: number; startWidth: number } | null>(null);
  const hulFileRef = useRef<HTMLInputElement>(null);

  const startResizing = useCallback((key: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = { key, startX: e.clientX, startWidth: columnWidths[key] };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', stopResizing);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [columnWidths]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!resizing.current) return;
    const delta = e.clientX - resizing.current.startX;
    const newWidth = Math.max(25, resizing.current.startWidth + delta);
    setColumnWidths(prev => ({ ...prev, [resizing.current!.key]: newWidth }));
  }, []);

  const stopResizing = useCallback(() => {
    resizing.current = null;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', stopResizing);
    document.body.style.cursor = 'default';
    document.body.style.userSelect = 'auto';
  }, []);

  const parseDate = (dStr: string) => {
    if (!dStr) return null;
    const parts = dStr.split('/');
    if (parts.length !== 3) return null;
    const [d, m, y] = parts.map(Number);
    return new Date(y, m - 1, d);
  };

  const isoToDisplay = (iso: string) => {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  };

  // Normalize any stored date string to DD/MM/YYYY for comparisons
  const normBillDate = (v?: string): string => {
    if (!v) return '';
    const raw = v.trim();
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return raw;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) { const [y,m,d] = raw.split('-'); return `${d}/${m}/${y}`; }
    if (/^\d{2}-\d{2}-\d{4}$/.test(raw)) return raw.replace(/-/g, '/');
    if (/^\d{4}\/\d{2}\/\d{2}$/.test(raw)) { const [y,m,d] = raw.split('/'); return `${d}/${m}/${y}`; }
    return raw;
  };

  const stripGST = (bn: string) => (bn || '').replace(/^GST/i, '');

  const getBillYMD = (dStr?: string) => {
    if (!dStr) return 0;
    if (dStr.includes('/')) {
      const parts = dStr.split('/');
      if (parts.length < 3) return 0;
      return Number(parts[2]) * 10000 + Number(parts[1]) * 100 + Number(parts[0]);
    }
    if (dStr.includes('-')) {
      const parts = dStr.split('-');
      if (parts.length < 3) return 0;
      return Number(parts[0]) * 10000 + Number(parts[1]) * 100 + Number(parts[2]);
    }
    return 0;
  };

  const filtered = useMemo(() => {
    // Fast path: no filter selected → show nothing (avoids scanning all bills)
    const hasAnyFilter = !!(fromDate || toDate || deliveryDate || recDate || driver || party || salesperson || statusFilter !== 'ALL');
    if (!hasAnyFilter) return [];

    const fromYMD = fromDate ? Number(fromDate.replace(/-/g, '')) : 0;
    const toYMD = toDate ? Number(toDate.replace(/-/g, '')) : 0;
    const deliveryDStr = deliveryDate ? isoToDisplay(deliveryDate) : '';
    const recDStr = recDate ? isoToDisplay(recDate) : '';
    const partyQuery = party.toLowerCase().trim();
    const spQuery = salesperson.toLowerCase().trim();

    let result = bills.filter(b => {
      if (fromYMD > 0 || toYMD > 0) {
        const bYMD = getBillYMD(b.date);
        if (bYMD > 0) {
          if (fromYMD > 0 && bYMD < fromYMD) return false;
          if (toYMD > 0 && bYMD > toYMD) return false;
        }
      }
      if (deliveryDStr) {
        const bDel = normBillDate(b.deliveryDate);
        if (bDel !== deliveryDStr) return false;
      }
      if (recDStr) {
        const bPay = normBillDate(b.paymentDate);
        const hasMatchingPart = b.partPayments?.some(pp => normBillDate(pp.date) === recDStr) ?? false;
        if (bPay !== recDStr && !hasMatchingPart) return false;
      }
      if (driver && b.driverName !== driver) return false;
      if (partyQuery && !(b.partyName || '').toLowerCase().includes(partyQuery)) return false;
      if (spQuery) {
        const sp = (b.salespersonName || '').toLowerCase();
        const pt = (b.partyName || '').toLowerCase();
        const bn = (b.billNo || '').toLowerCase();
        const cc = (b.collectionCode || '').toLowerCase();
        const bt = (b.beatName || '').toLowerCase();

        if (spQuery === 'moc' || spQuery === 'commission') {
          const isMoc = sp === 'moc' || sp.includes('moc') || bn.startsWith('moc') || bn.includes('moc') || pt.includes('commission') || pt.includes('moc') || cc === 'moc' || bt === 'commission';
          if (!isMoc) return false;
        } else if (spQuery.startsWith('moc') || spQuery.includes('moc')) {
          const queryMocNum = extractMocNumber(spQuery);
          if (queryMocNum) {
            const billMocNum = extractMocNumber(bn) || extractMocNumber(pt) || extractMocNumber(b.partyCode) || extractMocNumber(sp);
            const isMatch = billMocNum === queryMocNum || isBillMatchingMocCode(b, `MOC ${queryMocNum}`) || isBillMatchingMocCode(b, `MOC${queryMocNum}`);
            if (!isMatch) return false;
          } else {
            const isMoc = sp === 'moc' || sp.includes('moc') || bn.startsWith('moc') || bn.includes('moc') || pt.includes('commission') || pt.includes('moc') || cc === 'moc' || bt === 'commission';
            if (!isMoc) return false;
          }
        } else {
          // Check if spQuery matches a configured MOC code (e.g. "MOC 8")
          const mocMatch = commissionMocs.find(m => 
            m.code.toLowerCase() === spQuery || 
            m.code.toLowerCase().replace(/\s+/g, '') === spQuery.replace(/\s+/g, '')
          );
          if (mocMatch) {
            const mocNum = extractMocNumber(mocMatch.code);
            const billMocNum = extractMocNumber(bn) || extractMocNumber(pt) || extractMocNumber(b.partyCode) || extractMocNumber(sp);
            const isMatch = billMocNum === mocNum || isBillMatchingMocCode(b, mocMatch.code);
            if (!isMatch) return false;
          } else {
            if (!sp.includes(spQuery) && !pt.includes(spQuery) && !bn.includes(spQuery)) return false;
          }
        }
      }
      if (statusFilter !== 'ALL') {
        const col = b.collectedAmount || 0;
        // PAID: collected amount > 0
        const isPaid = col > 0;
        const lc = (b.lineCutAmt || 0) || Number(b.cancelLine) || 0;
        const netAfterLC = b.billNetAmt - lc;
        const isAutoFbr = !b.paymentDate && Math.abs(netAfterLC) <= 1 && col === 0 && b.paymentMode !== 'Credit';
        const isFBR = col === 0 && (b.paymentMode === 'Cancel' || b.paymentMode === 'FBR' || isAutoFbr);
        const isCredit = col === 0 && b.paymentMode === 'Credit' && !!b.driverName;
        const isDelPending = col === 0 && b.paymentMode === 'Del Pending';
        const isUnpaid = !isPaid && !isFBR && !isDelPending && !b.deliveryDate && col === 0;
        if (statusFilter === 'PAID'        && !isPaid)      return false;
        if (statusFilter === 'FBR'         && !isFBR)       return false;
        if (statusFilter === 'CREDIT'      && !isCredit)    return false;
        if (statusFilter === 'DEL_PENDING' && !isDelPending) return false;
        if (statusFilter === 'UNPAID'      && !isUnpaid)    return false;
      }
      return true;
    });

    result.sort((a, b) => {
      let va: any, vb: any;
      if (sort.key === 'diff') {
        va = a.billNetAmt - (a.collectedAmount || 0);
        vb = b.billNetAmt - (b.collectedAmount || 0);
      } else {
        va = a[sort.key as keyof Bill] || '';
        vb = b[sort.key as keyof Bill] || '';
      }
      if (typeof va === 'number' && typeof vb === 'number') return sort.direction === 'asc' ? va - vb : vb - va;
      return sort.direction === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    });
    return result;
  }, [bills, fromDate, toDate, deliveryDate, recDate, driver, party, salesperson, statusFilter, sort, commissionMocs]);

  // Expand part-payment bills into one virtual row per part payment entry.
  // When a recDate filter is active, only the matching part-payment entries are shown.
  const activeRecDateStr = recDate ? isoToDisplay(recDate) : '';
  const expandedBills = useMemo(() => {
    const result: Bill[] = [];
    for (const bill of filtered) {
      if (bill.partPayments && bill.partPayments.length > 0) {
        const parts = activeRecDateStr
          ? bill.partPayments.filter(pp => normBillDate(pp.date) === activeRecDateStr)
          : bill.partPayments;
        if (parts.length > 0) {
          for (const pp of parts) {
            result.push({ ...bill, paymentDate: pp.date, cashAmount: pp.cash, upiAmount: pp.upi, chequeAmount: pp.cheque, collectedAmount: pp.amount });
          }
        } else {
          // No partPayment matches this recDate, but the bill's own paymentDate matched
          // (that's why it passed the filtered check). Include the bill as-is so it
          // doesn't silently vanish from totals and the PDF summary.
          result.push(bill);
        }
      } else {
        result.push(bill);
      }
    }
    return result;
  }, [filtered, activeRecDateStr]);
  const deferredExpandedBills = useDeferredValue(expandedBills);

  // Reset page to 1 when any filter or view mode changes
  useEffect(() => {
    setCurrentPage(1);
  }, [fromDate, toDate, deliveryDate, recDate, driver, party, salesperson, statusFilter, viewMode, sort]);

  // Sliced bills for super fast rendering
  const displayedBills = useMemo(() => {
    if (pageSize === 0) return deferredExpandedBills;
    const start = (currentPage - 1) * pageSize;
    return deferredExpandedBills.slice(start, start + pageSize);
  }, [deferredExpandedBills, currentPage, pageSize]);

  const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(deferredExpandedBills.length / pageSize)) : 1;

  const relevantSummaries = useMemo(() => {
    return summaries.filter(s => {
      if (driver && s.driverName !== driver) return false;
      if (deliveryDate) {
        const dDStr = isoToDisplay(deliveryDate);
        if (s.date !== dDStr) return false;
      }
      return !!s.cashBreakdown;
    });
  }, [summaries, driver, deliveryDate]);

  // Party / Salesperson name lists
  const [nameListsReady, setNameListsReady] = useState(false);
  const activateNameLists = useCallback(() => setNameListsReady(true), []);

  // Unique salesperson names — instant Set & sort
  const salespersonList = useMemo(() => {
    if (!nameListsReady) return ['MOC', ...commissionMocs.map(m => m.code)];
    const set = new Set<string>();
    set.add('MOC');
    for (const m of commissionMocs) {
      set.add(m.code);
    }
    for (const b of bills) {
      if (b.salespersonName?.trim()) {
        const sp = b.salespersonName.trim();
        if (sp.toUpperCase() === 'MOC') {
          set.add('MOC');
        } else if (sp.toUpperCase().startsWith('MOC')) {
          set.add(sp);
        } else {
          set.add(sp);
        }
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  }, [bills, nameListsReady, commissionMocs]);

  // Unique party names — instant Set & sort
  const partyList = useMemo(() => {
    if (!nameListsReady) return [];
    const set = new Set<string>();
    for (const b of bills) {
      if (b.partyName?.trim()) set.add(b.partyName.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  }, [bills, nameListsReady]);


  const breakdownAgg = useMemo(() => {
    return relevantSummaries.reduce((acc, s) => {
      const b = s.cashBreakdown!;
      acc.n500 += (b.n500 || 0);
      acc.n200 += (b.n200 || 0);
      acc.n100 += (b.n100 || 0);
      acc.n50 += (b.n50 || 0);
      acc.n20 += (b.n20 || 0);
      acc.n10 += (b.n10 || 0);
      acc.coins += (b.coins || 0);
      return acc;
    }, { n500: 0, n200: 0, n100: 0, n50: 0, n20: 0, n10: 0, coins: 0 });
  }, [relevantSummaries]);

  const calcTotal = useMemo(() => {
    return (breakdownAgg.n500 * 500) + (breakdownAgg.n200 * 200) + (breakdownAgg.n100 * 100) + (breakdownAgg.n50 * 50) + (breakdownAgg.n20 * 20) + (breakdownAgg.n10 * 10) + breakdownAgg.coins;
  }, [breakdownAgg]);

  const dateWiseData = useMemo(() => {
    const map = new Map<string, { recDate: string; totalBillsAmt: number; recCash: number; recGpay: number; recChq: number; totalFbr: number; totalLineCut: number; totalCredit: number; billCount: number }>();
    expandedBills.forEach(b => {
      const recDate = b.paymentDate || '—';
      if (!map.has(recDate)) {
        map.set(recDate, { recDate, totalBillsAmt: 0, recCash: 0, recGpay: 0, recChq: 0, totalFbr: 0, totalLineCut: 0, totalCredit: 0, billCount: 0 });
      }
      const row = map.get(recDate)!;
      const isFBR = b.paymentMode === 'FBR' || b.paymentMode === 'Cancel';
      const isCredit = b.paymentMode === 'Credit';
      const collected = b.collectedAmount || 0;
      const cnAdj = Number(b.cancelLine) || 0;
      const lineCutAmt = cnAdj > 0 ? cnAdj : (collected > 0 && b.billNetAmt > collected ? b.billNetAmt - collected : 0);
      row.totalBillsAmt += b.billNetAmt || 0;
      row.recCash += b.cashAmount || 0;
      row.recGpay += b.upiAmount || 0;
      row.recChq += b.chequeAmount || 0;
      if (isFBR) row.totalFbr += b.billNetAmt || 0;
      row.totalLineCut += lineCutAmt;
      if (isCredit) row.totalCredit += b.billNetAmt || 0;
      row.billCount += 1;
    });
    return Array.from(map.values()).sort((a, b) => {
      if (a.recDate === '—') return 1;
      if (b.recDate === '—') return -1;
      const parseD = (s: string) => { const [d, m, y] = s.split('/'); return new Date(+y, +m - 1, +d).getTime(); };
      return parseD(a.recDate) - parseD(b.recDate);
    });
  }, [expandedBills]);

  const driverWiseData = useMemo(() => {
    const map = new Map<string, Bill[]>();
    for (const b of expandedBills) {
      const key = (b.driverName || '(Unassigned)').trim();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(b);
    }
    // Sort order within each driver: Cash → GPay → Cheque → Split → FBR → Credit → Del Pending → Other
    function driverPayOrder(x: Bill): number {
      const ca = Number(x.cashAmount) || 0;
      const up = Number(x.upiAmount)  || 0;
      const ch = Number(x.chequeAmount) || 0;
      const col = Number(x.collectedAmount) || 0;
      let cash = ca, upi = up, chq = ch;
      if (ca === 0 && up === 0 && ch === 0 && col > 0) {
        const m = (x.paymentMode || '').toLowerCase();
        if (m === 'upi')         upi  = col;
        else if (m === 'cheque') chq  = col;
        else                     cash = col;
      }
      if (cash > 0 && upi === 0 && chq === 0) return 0; // cash only
      if (upi  > 0 && cash === 0 && chq === 0) return 1; // gpay only
      if (chq  > 0 && cash === 0 && upi === 0) return 2; // cheque only
      if (cash > 0 || upi > 0 || chq > 0)      return 3; // split / mixed
      const pm = (x.paymentMode || '').toLowerCase();
      if (pm === 'fbr' || pm === 'cancel') return 4;
      if (pm === 'credit')                 return 5;
      if (pm === 'del pending')            return 6;
      return 7; // unpaid / assigned / pending
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, grpBills]) => ({
        name,
        bills: [...grpBills].sort((a, b) => {
          const od = driverPayOrder(a) - driverPayOrder(b);
          if (od !== 0) return od;
          return (a.billNo || '').localeCompare(b.billNo || '', 'en', { numeric: true });
        }),
      }));
  }, [expandedBills]);

  function getEffAmt(b: Bill) {
    const ca = Number(b.cashAmount) || 0;
    const up = Number(b.upiAmount)  || 0;
    const ch = Number(b.chequeAmount) || 0;
    const col = Number(b.collectedAmount) || 0;
    if (ca === 0 && up === 0 && ch === 0 && col > 0) {
      const m = (b.paymentMode || '').toLowerCase();
      if (m === 'upi')    return { cash: 0,   upi: col, chq: 0   };
      if (m === 'cheque') return { cash: 0,   upi: 0,   chq: col };
      return { cash: col, upi: 0, chq: 0 };
    }
    return { cash: ca, upi: up, chq: ch };
  }

  const totals = useMemo(() => {
    let billAmt = 0, cash = 0, upi = 0, chq = 0, lineCut = 0, baki = 0, fbr = 0, delPending = 0, totalCollected = 0;
    expandedBills.forEach(b => {
      const bAmt = Number(b.billNetAmt || 0);
      const cAmt = Number(b.collectedAmount || 0);
      const lc   = (b.lineCutAmt || 0) || Number(b.cancelLine) || 0;
      const eff  = getEffAmt(b);
      billAmt += bAmt;
      cash += eff.cash;
      upi  += eff.upi;
      chq  += eff.chq;
      lineCut += lc;
      totalCollected += cAmt;
      if (b.paymentMode === 'Pending') baki += bAmt;
      if (b.paymentMode === 'Cancel' || b.paymentMode === 'FBR') fbr += bAmt;
      if (b.paymentMode === 'Del Pending') delPending += bAmt;
    });
    const finalDiff = billAmt - lineCut - totalCollected;
    return { billAmt, cash, upi, chq, lineCut, baki, fbr, delPending, finalDiff };
  }, [expandedBills]);

  async function exportToXLS() {
    try {
      const XLSX = await import('xlsx');

      // Main data sheet — same column format as Rec Payment Upload
      const headers = [
        'Bill No', 'Bill Date', 'Retailer Name', 'Driver',
        'Bill Amount', 'O/S Amount', 'Discount', 'CN Adj', 'DN Adj',
        'Collection Date', 'Mode', 'Retailer Bank Name',
        'Chq/DD Date', 'Chq/DD No', 'Amount', 'Status',
      ];
      const computeStatus = (b: Bill) => {
        const col = b.collectedAmount || 0;
        // collected amount > 0 → always PAID (line cut does not count as collected)
        if (col > 0) return 'PAID';
        const isFBR    = b.paymentMode === 'FBR' || b.paymentMode === 'Cancel';
        const isCredit  = b.paymentMode === 'Credit';
        const isDelPend = b.paymentMode === 'Del Pending';
        const isPending = b.paymentMode === 'Pending';
        if (isFBR)    return 'FBR';
        if (isCredit)  return 'CREDIT';
        if (isDelPend) return 'DEL PENDING';
        if (isPending) return 'PENDING';
        return 'UNPAID';
      };
      const xlsMode = (b: Bill): string => {
        const m = (b.paymentMode || '').toLowerCase();
        if (m === 'cash')        return 'CASH';
        if (m === 'upi')         return 'GPAY';
        if (m === 'cheque')      return 'CHEQ';
        if (m === 'credit')      return 'CREDIT';
        if (m === 'fbr' || m === 'cancel') return 'FBR';
        if (m === 'split')       return 'SPLIT';
        if (m === 'del pending') return 'DEL PEND';
        if (m === 'paid') {
          const ca = Number(b.cashAmount) || 0;
          const up = Number(b.upiAmount) || 0;
          const ch = Number(b.chequeAmount) || 0;
          if (ch > 0 && ca === 0 && up === 0) return 'CHEQ';
          if (up > 0 && ca === 0 && ch === 0) return 'GPAY';
          if (ca > 0 && up === 0 && ch === 0) return 'CASH';
          return 'SPLIT';
        }
        return (b.paymentMode || '').toUpperCase();
      };
      const dataRows = filtered.map(b => {
        const collected = b.collectedAmount || 0;
        const osAmt = collected > 0 ? b.billNetAmt - collected : b.billNetAmt;
        const cnAdj = b.cancelLine || (collected > 0 && b.billNetAmt > collected ? String(b.billNetAmt - collected) : '');
        return [
          b.billNo,
          b.date || '',
          b.partyName || '',
          b.driverName || '',
          b.billNetAmt,
          osAmt,
          0,          // Discount
          cnAdj,
          0,          // DN Adj
          b.paymentDate || '',
          xlsMode(b),
          b.bankName || '',
          b.chequeDate || '',
          b.chequeNo || '',
          collected,
          computeStatus(b),
        ];
      });

      // Summary sheet
      const summaryRows: any[][] = [
        [],
        ['PAYMENT DETAILS', 'RS'],
        ['TOTAL BILL AMT:-', totals.billAmt],
        ['TOTAL REC CASH:-', totals.cash],
        ['TOTAL REC GPAY:-', totals.upi],
        ['REC CHQ AMT:-', totals.chq],
        ['LINE CUT AMT:-', totals.lineCut],
        ['BAKI PAYMENT BILL AMT:-', totals.baki],
        ['FBR BILL AMT:-', totals.fbr],
        ['DEL PENDING AMT:-', totals.delPending],
        ['DIFF :-', totals.finalDiff],
      ];

      const wb = XLSX.utils.book_new();

      // Sheet 1: Rec Payment format (re-uploadable)
      const ws1 = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
      ws1['!cols'] = [12, 12, 22, 14, 12, 12, 10, 12, 10, 14, 10, 18, 12, 14, 12, 14].map(w => ({ wch: w }));
      XLSX.utils.book_append_sheet(wb, ws1, 'Rec Payment');

      // Sheet 2: View-matching Report — same columns & data as screen
      const viewHeaders = [
        '#', 'DATE', 'BILL NO', 'PARTY', 'SALESPERSON', 'DRIVER',
        'AMT', 'REC DATE', 'DEL DATE', 'CASH', 'GPAY', 'CHQ',
        'LINE CUT', 'DIFF', 'STATUS', 'REASON', 'ENTRY BY',
      ];

      const makeViewRow = (b: Bill, rowNum: number) => {
        const _ae = getEffAmt(b);
        const cash = _ae.cash;
        const gpay = _ae.upi;
        const chq  = _ae.chq;
        const collected = b.collectedAmount || 0;
        const lineCutAmt = (b.lineCutAmt || 0) || Number(b.cancelLine) || 0;
        const diff = b.billNetAmt - lineCutAmt - collected;
        const isFBR     = b.paymentMode === 'FBR' || b.paymentMode === 'Cancel';
        const isCredit  = b.paymentMode === 'Credit' && collected === 0;
        const isDelPend = b.paymentMode === 'Del Pending' && collected === 0;
        const isPaid    = collected > 0 && Math.abs(diff) <= 1 && !isFBR;
        const isAsgnd   = !isPaid && !isFBR && !isCredit && !isDelPend && !!b.driverName && b.deliveryDate === todayDisplay;
        const label = isFBR ? 'FBR' : isCredit ? 'CREDIT' : isDelPend ? 'DEL PEND' : isPaid ? 'PAID' : isAsgnd ? 'ASGND' : 'UNPAID';
        const diffVal = isCredit ? 'CREDIT' : isDelPend ? 'NOT DEL' : diff;
        return [
          rowNum, b.date || '-', stripGST(getDisplayBillNo(b)),
          b.partyName || '-', b.salespersonName || '', b.driverName || '-',
          b.billNetAmt, b.paymentDate || '-', b.deliveryDate || '-',
          cash, gpay, chq, lineCutAmt, diffVal, label, b.discrepancyReason || '',
          (b.paymentTime && !/^\d{2}:\d{2}$/.test(b.paymentTime)) ? b.paymentTime : '—',
        ];
      };

      let viewSheetRows: any[][];
      if (viewMode === 'driverwise') {
        viewSheetRows = [];
        let rowNum = 0;
        for (const { name, bills: grpBills } of driverWiseData) {
          viewSheetRows.push([`DRIVER: ${name.toUpperCase()} — ${grpBills.length} BILLS`]);
          for (const b of grpBills) {
            rowNum++;
            viewSheetRows.push(makeViewRow(b, rowNum));
          }
          const grpAmt  = grpBills.reduce((s, b) => s + (b.billNetAmt || 0), 0);
          const grpCash = grpBills.reduce((s, b) => s + getEffAmt(b).cash, 0);
          const grpGpay = grpBills.reduce((s, b) => s + getEffAmt(b).upi, 0);
          const grpChq  = grpBills.reduce((s, b) => s + getEffAmt(b).chq, 0);
          const grpLine = grpBills.reduce((s, b) => s + ((b.lineCutAmt || 0) || Number(b.cancelLine) || 0), 0);
          const grpColl = grpBills.reduce((s, b) => s + (b.collectedAmount || 0), 0);
          viewSheetRows.push(['', '', '', `SUBTOTAL: ${name.toUpperCase()} (${grpBills.length})`, '', '', grpAmt, '', '', grpCash, grpGpay, grpChq, grpLine, grpAmt - grpLine - grpColl, '', '']);
          viewSheetRows.push([]);
        }
      } else {
        viewSheetRows = expandedBills.map((b, i) => makeViewRow(b, i + 1));
      }

      const tCash2 = expandedBills.reduce((s, b) => s + getEffAmt(b).cash, 0);
      const tGpay2 = expandedBills.reduce((s, b) => s + getEffAmt(b).upi, 0);
      const tChq2  = expandedBills.reduce((s, b) => s + getEffAmt(b).chq, 0);
      const tLine2 = expandedBills.reduce((s, b) => s + ((b.lineCutAmt || 0) || Number(b.cancelLine) || 0), 0);
      const tAmt2  = expandedBills.reduce((s, b) => s + (b.billNetAmt || 0), 0);
      const tColl2 = expandedBills.reduce((s, b) => s + (b.collectedAmount || 0), 0);
      const grandTotalRow = ['', '', '', `TOTAL — ${expandedBills.length} BILLS`, '', '', tAmt2, '', '', tCash2, tGpay2, tChq2, tLine2, tAmt2 - tLine2 - tColl2, '', '', ''];

      const ws2 = XLSX.utils.aoa_to_sheet([
        viewHeaders,
        ...viewSheetRows,
        grandTotalRow,
        [],
        ...summaryRows,
      ]);
      ws2['!cols'] = [6, 12, 14, 22, 16, 14, 12, 12, 12, 12, 12, 12, 12, 12, 12, 18, 14].map(w => ({ wch: w }));

      XLSX.utils.book_append_sheet(wb, ws2, 'Report');

      const _now = new Date();
      const _dd = String(_now.getDate()).padStart(2, '0');
      const _mm = String(_now.getMonth() + 1).padStart(2, '0');
      const _yyyy = _now.getFullYear();
      XLSX.writeFile(wb, `VitraTrack_${_dd}-${_mm}-${_yyyy}.xlsx`);
    } catch (err) { console.error(err); alert('XLS Download Failed.'); }
  }

  function exportToHUL() {
    hulFileRef.current?.click();
  }

  async function processHulTemplate(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    e.target.value = '';
    try {
      const XLSX = await import('xlsx');
      const data = await file.arrayBuffer();
      const templateWb = XLSX.read(new Uint8Array(data), { type: 'array', raw: true, cellDates: false });

      // Find Collection Details sheet (first sheet whose name contains "collection")
      const collSheetName = templateWb.SheetNames.find(n =>
        n.trim().toLowerCase().includes('collection')
      ) ?? templateWb.SheetNames[0];
      const templateWs = templateWb.Sheets[collSheetName];

      // Read as raw array-of-arrays (preserves Excel serial dates, strings, numbers)
      const allRows: any[][] = XLSX.utils.sheet_to_json(templateWs, { header: 1, defval: '', raw: true });
      if (allRows.length < 2) { alert('Collection Details sheet appears empty.'); return; }

      const headerRow = allRows[0] as string[];
      const dataRows  = allRows.slice(1);

      // ── Column index detection (case-insensitive) ─────────────────────
      const findIdx = (...candidates: string[]) =>
        headerRow.findIndex(h => candidates.some(c => String(h).trim().toLowerCase() === c.toLowerCase()));

      const iiBillNo   = findIdx('bill no', 'bill no.', 'doc no', 'doc no.', 'invoice no');
      const iiBillAmt  = findIdx('bill amount', 'bill amt', 'net amount', 'net amt');
      const iiOsAmt    = findIdx('o/s amount', 'os amount', 'outstanding amount', 'outstanding amt');
      const iiCollDate = findIdx('collection date', 'coll date', 'coll dt', 'rec date');
      const iiCollCode = findIdx('collection code', 'coll code');
      const iiMode     = findIdx('mode', 'payment mode', 'pay mode');
      const iiBank     = findIdx('retailer bank name', 'bank name');
      const iiChqDate  = findIdx('chq/dd date', 'cheque date', 'chq date');
      const iiChqNo    = findIdx('chq/dd no', 'cheque no', 'chq no');
      const iiAmt      = findIdx('amount', 'coll amt', 'collected amount', 'rec amt');
      const iiBillDate = findIdx('bill date', 'bill dt', 'doc date', 'invoice date');

      if (iiBillNo === -1) {
        alert(`Bill No column not found in template.\nFound: ${headerRow.slice(0, 12).join(', ')}`);
        return;
      }

      // ── Build bill lookup map from ALL app bills (not just filtered view) ─
      const billMap = new Map<string, Bill>();
      for (const b of bills) {
        billMap.set(b.billNo.trim(), b);
        const stripped = b.billNo.replace(/^GST[-/]?/i, '').trim();
        if (stripped !== b.billNo.trim()) billMap.set(stripped, b);
      }

      // ── Date helpers ──────────────────────────────────────────────────
      function colLetter(idx: number): string {
        let r = '', i = idx;
        while (i >= 0) { r = String.fromCharCode(65 + (i % 26)) + r; i = Math.floor(i / 26) - 1; }
        return r;
      }
      function dateToSerial(d: string | undefined): number | '' {
        if (!d) return '';
        const clean = d.replace(/-/g, '/');
        const [dd, mm, yyyy] = clean.split('/').map(Number);
        if (!dd || !mm || !yyyy) return '';
        const epoch = new Date(1899, 11, 30);
        return Math.floor((new Date(yyyy, mm - 1, dd).getTime() - epoch.getTime()) / 86400000);
      }

      // ── Process each template row ─────────────────────────────────────
      type HulRow = any[];
      const outputRows: HulRow[] = [];

      for (const row of dataRows) {
        const rawBillNo = String(row[iiBillNo] ?? '').trim();
        if (!rawBillNo) continue;

        const bill = billMap.get(rawBillNo)
          ?? billMap.get(rawBillNo.replace(/^GST[-/]?/i, '').trim());

        if (!bill) continue;

        const collectedAmt = Number(bill.collectedAmount) || 0;
        // Only output rows where the bill is PAID in the app
        const billPayMode = (bill.paymentMode || '').toLowerCase();
        if (billPayMode !== 'paid' && collectedAmt === 0) continue;

        const billNetAmt = iiBillAmt !== -1 ? (Number(row[iiBillAmt]) || bill.billNetAmt) : bill.billNetAmt;
        const osAmt = Math.max(0, billNetAmt - collectedAmt);

        // Determine mode entries (split payments = multiple rows)
        const ca  = Number(bill.cashAmount)   || 0;
        const ua  = Number(bill.upiAmount)    || 0;
        const cha = Number(bill.chequeAmount) || 0;

        type ModeEntry = { mode: string; amt: number; bank: string; chqDate: number | ''; chqNo: string };
        const modeEntries: ModeEntry[] = [];
        if (ca  > 0) modeEntries.push({ mode: 'Cash',      amt: ca,  bank: '', chqDate: '', chqNo: '' });
        if (ua  > 0) modeEntries.push({ mode: 'GPAY',      amt: ua,  bank: '', chqDate: '', chqNo: '' });
        if (cha > 0) modeEntries.push({ mode: 'Cheque/DD', amt: cha, bank: bill.bankName || '', chqDate: dateToSerial(bill.chequeDate), chqNo: bill.chequeNo || '' });

        if (modeEntries.length === 0) {
          const pm = (bill.paymentMethod || bill.paymentMode || '').toLowerCase();
          const mode = pm.includes('upi') || pm.includes('gpay') ? 'GPAY'
                     : pm.includes('cheque') ? 'Cheque/DD' : 'Cash';
          modeEntries.push({ mode, amt: collectedAmt, bank: mode === 'Cheque/DD' ? (bill.bankName || '') : '', chqDate: mode === 'Cheque/DD' ? dateToSerial(bill.chequeDate) : '', chqNo: mode === 'Cheque/DD' ? (bill.chequeNo || '') : '' });
        }

        for (const me of modeEntries) {
          const newRow: HulRow = [...row];
          const isCheque   = me.mode === 'Cheque/DD';
          const bankOut    = isCheque ? (me.bank || 'KOTAK BANK') : '';
          const chqNoRaw   = isCheque ? me.chqNo.trim() : '';
          const isNonNum   = !chqNoRaw || /NEFT|RTGS|UPI|GPAY|NILL|NULL/i.test(chqNoRaw);
          const chqNoOut   = isCheque ? (isNonNum ? '123456' : chqNoRaw) : '';
          const chqDateOut = isCheque ? (me.chqDate !== '' ? me.chqDate : dateToSerial(bill.paymentDate)) : '';

          if (iiOsAmt    !== -1) newRow[iiOsAmt]    = osAmt;
          if (iiCollDate !== -1) newRow[iiCollDate]  = dateToSerial(bill.paymentDate);
          if (iiCollCode !== -1) newRow[iiCollCode]  = bill.collectionCode || row[iiCollCode];
          if (iiMode     !== -1) newRow[iiMode]      = me.mode;
          if (iiBank     !== -1) newRow[iiBank]      = bankOut;
          if (iiChqDate  !== -1) newRow[iiChqDate]   = chqDateOut;
          if (iiChqNo    !== -1) newRow[iiChqNo]     = chqNoOut;
          if (iiAmt      !== -1) newRow[iiAmt]       = me.amt;

          outputRows.push(newRow);
        }
      }

      // ── Build output workbook ─────────────────────────────────────────
      const wb = XLSX.utils.book_new();

      // Collection Details: rebuilt with payment data filled
      const ws1 = XLSX.utils.aoa_to_sheet([headerRow, ...outputRows]);
      // Apply date format to date columns
      for (const colIdx of [iiBillDate, iiCollDate, iiChqDate].filter(i => i !== -1)) {
        const cl = colLetter(colIdx);
        for (let r = 2; r <= outputRows.length + 1; r++) {
          const addr = `${cl}${r}`;
          if (ws1[addr] && ws1[addr].t === 'n') ws1[addr].z = 'DD-MM-YYYY';
        }
      }
      ws1['!cols'] = headerRow.map((_, i) => ({ wch: i === 2 || i === 11 ? 28 : 14 }));
      XLSX.utils.book_append_sheet(wb, ws1, collSheetName);

      // All other sheets from template — kept exactly as-is
      for (const name of templateWb.SheetNames) {
        if (name === collSheetName) continue;
        wb.Sheets[name] = templateWb.Sheets[name];
        wb.SheetNames.push(name);
      }

      const _n = new Date();
      const _dd = String(_n.getDate()).padStart(2, '0');
      const _mm = String(_n.getMonth() + 1).padStart(2, '0');
      const _yyyy = _n.getFullYear();
      XLSX.writeFile(wb, `HUL_Collection_${_dd}-${_mm}-${_yyyy}.xlsx`);
    } catch (err: any) {
      console.error(err);
      alert(`HUL XLS Error: ${err?.message || 'Unknown error'}`);
    }
  }

  async function _exportToHUL_UNUSED() {
    try {
      const XLSX = await import('xlsx');

      // Only collected bills — exclude Credit, FBR, Del Pending, Unpaid
      const excludedModes = new Set(['fbr', 'credit', 'del pending', 'unpaid', 'cancel', 'pending']);
      const collectedBills = filtered.filter(b => {
        const mode = (b.paymentMode || '').toLowerCase();
        if (excludedModes.has(mode)) return false;
        return (b.collectedAmount || 0) > 0;
      });

      // Helper: convert DD/MM/YYYY or DD-MM-YYYY → Excel serial date number
      function dateToSerial(d: string | undefined): number | '' {
        if (!d) return '';
        const clean = d.replace(/-/g, '/');
        const parts = clean.split('/');
        if (parts.length !== 3) return '';
        const [dd, mm, yyyy] = parts.map(Number);
        if (!dd || !mm || !yyyy) return '';
        const date = new Date(yyyy, mm - 1, dd);
        const excelEpoch = new Date(1899, 11, 30); // Dec 30 1899 (Excel epoch with 1900 leap year bug)
        return Math.floor((date.getTime() - excelEpoch.getTime()) / 86400000);
      }

      // Build Collection Details rows — split payments → separate rows per mode
      type HulRow = (string | number)[];
      const collectionRows: HulRow[] = [];

      for (const b of collectedBills) {
        const ca    = Number(b.cashAmount)   || 0;
        const ua    = Number(b.upiAmount)    || 0;
        const cha   = Number(b.chequeAmount) || 0;
        const total = Number(b.collectedAmount) || 0;
        const osAmt = Math.max(0, b.billNetAmt - total);

        // Determine which modes are active
        type ModeEntry = { mode: string; amt: number; bankName: string; chqDate: number | ''; chqNo: string };
        const modeEntries: ModeEntry[] = [];

        if (ca > 0)  modeEntries.push({ mode: 'Cash',      amt: ca,  bankName: '',               chqDate: '',                          chqNo: '' });
        if (ua > 0)  modeEntries.push({ mode: 'GPAY',      amt: ua,  bankName: '',               chqDate: '',                          chqNo: '' });
        if (cha > 0) modeEntries.push({ mode: 'Cheque/DD', amt: cha, bankName: b.bankName || '', chqDate: dateToSerial(b.chequeDate),  chqNo: b.chequeNo || '' });

        // Fallback: no breakdown but collected > 0
        if (modeEntries.length === 0 && total > 0) {
          const pm = (b.paymentMethod || b.paymentMode || '').toLowerCase();
          const mode = pm.includes('upi') || pm.includes('gpay') ? 'GPAY'
                     : pm.includes('cheque') ? 'Cheque/DD'
                     : 'Cash';
          const bankName = mode === 'Cheque/DD' ? (b.bankName || '') : '';
          const chqDate  = mode === 'Cheque/DD' ? dateToSerial(b.chequeDate) : ('' as const);
          const chqNo    = mode === 'Cheque/DD' ? (b.chequeNo || '') : '';
          modeEntries.push({ mode, amt: total, bankName, chqDate, chqNo });
        }

        for (const me of modeEntries) {
          const collectionSerial = dateToSerial(b.paymentDate);
          const isCheque = me.mode === 'Cheque/DD';
          const bankOut = isCheque ? (me.bankName || 'KOTAK BANK') : '';
          const chqDateOut = isCheque ? (me.chqDate !== '' ? me.chqDate : collectionSerial) : '';
          const chqNoRaw = isCheque ? (me.chqNo || '').trim() : '';
          const chqNoUpper = chqNoRaw.toUpperCase();
          const isNonNumericMode = !chqNoRaw || /NEFT|RTGS|UPI|GPAY|NILL|NULL/.test(chqNoUpper);
          const chqNoOut = isCheque ? (isNonNumericMode ? '123456' : chqNoRaw) : '';
          collectionRows.push([
            b.billNo,
            dateToSerial(b.date),
            b.partyName || '',
            b.billNetAmt,
            osAmt,
            '0.00',
            '0.00',
            '0.00',
            collectionSerial,
            b.collectionCode || '',
            me.mode,
            bankOut,
            chqDateOut,
            chqNoOut,
            me.amt,
          ]);
        }
      }

      const collectionHeaders = [
        'Bill No', 'Bill Date', 'Retailer Name', 'Bill Amount',
        'O/S Amount', 'Discount', 'CN Adj', 'DN Adj',
        'Collection Date', 'Collection Code', 'Mode',
        'Retailer Bank Name', 'Chq/DD Date', 'Chq/DD No', 'Amount',
      ];

      // Sheet 2: Retailer Bank — unique Cheque/DD bank names only, no duplicates
      const bankHeaders = ['Retailer Bank Name'];
      const bankNameSet = new Set<string>();
      collectionRows.forEach(r => {
        if (String(r[10]) === 'Cheque/DD') {
          const bank = String(r[11] || '').trim();
          if (bank.length > 0) bankNameSet.add(bank);
        }
      });
      const bankRows: HulRow[] = Array.from(bankNameSet).map(name => [name]);

      // Sheet 3: Payment Mode — only mode names (matching reference format)
      const modeHeaders = ['Payment Mode'];
      const modeNameSet = new Set<string>();
      for (const r of collectionRows) {
        const mode = String(r[10]);
        if (mode) modeNameSet.add(mode);
      }
      const modeRows: HulRow[] = Array.from(modeNameSet).map(mode => [mode]);

      const wb = XLSX.utils.book_new();

      const ws1 = XLSX.utils.aoa_to_sheet([collectionHeaders, ...collectionRows]);
      ws1['!cols'] = [14, 12, 28, 14, 14, 10, 10, 10, 14, 14, 12, 22, 14, 14, 14].map(w => ({ wch: w }));
      // Apply date format to Bill Date (col B=1) and Collection Date (col I=8) and Chq/DD Date (col M=12)
      const dateColLetters = ['B', 'I', 'M'];
      for (const col of dateColLetters) {
        for (let row = 2; row <= collectionRows.length + 1; row++) {
          const addr = `${col}${row}`;
          if (ws1[addr] && ws1[addr].t === 'n') {
            ws1[addr].z = 'DD-MM-YYYY';
          }
        }
      }
      XLSX.utils.book_append_sheet(wb, ws1, ' Collection Details');

      const ws2 = XLSX.utils.aoa_to_sheet([bankHeaders, ...bankRows]);
      ws2['!cols'] = [{ wch: 28 }];
      XLSX.utils.book_append_sheet(wb, ws2, ' Retailer Bank');

      const ws3 = XLSX.utils.aoa_to_sheet([modeHeaders, ...modeRows]);
      ws3['!cols'] = [{ wch: 18 }];
      XLSX.utils.book_append_sheet(wb, ws3, 'Payment Mode');

      const _n = new Date();
      const _dd = String(_n.getDate()).padStart(2, '0');
      const _mm = String(_n.getMonth() + 1).padStart(2, '0');
      const _yyyy = _n.getFullYear();
      XLSX.writeFile(wb, `HUL_Collection_${_dd}-${_mm}-${_yyyy}.xlsx`);
    } catch (err) { console.error(err); alert('HUL XLS Download Failed.'); }
  }

  async function exportToPDF() {
    try {
      const jsPDF = (await import('jspdf')).default;
      const autoTable = (await import('jspdf-autotable')).default;
      const doc = new jsPDF('p', 'mm', 'a4');

      const dateInfo = deliveryDate
        ? `DEL DATE: ${isoToDisplay(deliveryDate)}`
        : recDate
        ? `REC DATE: ${isoToDisplay(recDate)}`
        : fromDate && toDate
        ? `${isoToDisplay(fromDate)} - ${isoToDisplay(toDate)}`
        : '';

      // Helper: build one row for jspdf-autotable
      function makePdfRow(b: Bill, idx: number) {
        const eff = getEffAmt(b);
        const collected = b.collectedAmount || 0;
        const lineCutAmt = (b.lineCutAmt || 0) || Number(b.cancelLine) || 0;
        const diff = b.billNetAmt - lineCutAmt - collected;
        const isFBR_r  = collected === 0 && (b.paymentMode === 'FBR' || b.paymentMode === 'Cancel');
        const isCred_r = collected === 0 && b.paymentMode === 'Credit';
        const isDel_r  = collected === 0 && b.paymentMode === 'Del Pending';
        const status   = collected > 0 ? 'PAID' : isFBR_r ? 'FBR' : isCred_r ? 'CREDIT' : isDel_r ? 'DEL PEND' : b.paymentMode === 'Pending' ? 'PENDING' : 'UNPAID';
        const diffCell = isCred_r ? 'CREDIT' : isDel_r ? 'NOT DEL' : diff.toLocaleString('en-IN');

        const isMatched = String(b.discrepancyReason || (b as any).discrepancy_reason || (b as any).discrepancy || '').toUpperCase().includes('MATCHED');

        const gpayCell = eff.upi > 0 ? eff.upi.toLocaleString('en-IN') : '-';
        const chqCell  = eff.chq > 0 ? eff.chq.toLocaleString('en-IN') : '-';

        return [
          idx,
          b.date || '-',
          stripGST(getDisplayBillNo(b)),
          b.partyName?.substring(0, 16) || '-',
          b.billNetAmt.toLocaleString('en-IN'),
          b.deliveryDate || '-',
          b.paymentDate || '-',
          eff.cash > 0 ? eff.cash.toLocaleString('en-IN') : '-',
          gpayCell,
          chqCell,
          lineCutAmt > 0 ? lineCutAmt.toLocaleString('en-IN') : '-',
          diffCell,
          status,
          b.discrepancyReason || '',
        ];
      }

      // didParseCell colour logic — bill index relative to a subset array
      function makeCellParser(subset: Bill[]) {
        return (data: any) => {
          if (data.section !== 'body') return;
          const bill = subset[data.row.index];
          if (!bill) return;
          if (bill.paymentMode === 'FBR' || bill.paymentMode === 'Cancel') {
            data.cell.styles.fillColor = [255, 150, 150];
          } else if (bill.paymentMode === 'Credit') {
            data.cell.styles.fillColor = [150, 255, 150];
          } else if (bill.paymentMode === 'Pending' || bill.paymentMode === 'Del Pending') {
            data.cell.styles.fillColor = [255, 255, 150];
          }
          data.cell.styles.textColor = [0, 0, 0];
          data.cell.styles.fontStyle = 'bold';

          const isMatched = String(bill.discrepancyReason || (bill as any).discrepancy_reason || (bill as any).discrepancy || '').toUpperCase().includes('MATCHED');
          if (isMatched) {
            const eff = getEffAmt(bill);
            const colIdx = data.column.index;
            if (colIdx === 7 && eff.cash > 0) {
              data.cell.styles.fillColor = [252, 231, 243]; // Light pink
            } else if (colIdx === 8 && (eff.upi > 0 || bill.paymentMode?.toLowerCase().includes('gpay') || bill.paymentMode?.toLowerCase().includes('upi'))) {
              data.cell.styles.fillColor = [252, 231, 243];
            } else if (colIdx === 9 && (eff.chq > 0 || bill.paymentMode?.toLowerCase().includes('cheque') || bill.paymentMode?.toLowerCase().includes('chq'))) {
              data.cell.styles.fillColor = [252, 231, 243];
            }
          }

          if (data.column.index === 3 && isGreenParty(bill.partyCode, bill.partyName)) {
            data.cell.styles.fillColor = [187, 247, 208];
            data.cell.styles.textColor = [6, 78, 59];
            data.cell.styles.fontStyle = 'bold';
          }
        };
      }

      const tableHead = [['#', 'DATE', 'BILL NO', 'PARTY', 'AMT', 'DEL DATE', 'REC DATE', 'CASH', 'GPAY', 'CHQ', 'LINECUT', 'DIFF', 'STATUS', 'DBM']];
      // Column widths tuned to fit all 14 cols in 200 mm (A4 portrait − 5 mm margins each side)
      // #5 + DATE14 + BILLNO16 + PARTY30 + AMT13 + DELD13 + RECD13 + CASH12 + GPAY12 + CHQ12 + LC12 + DIFF12 + STATUS12 + DBM24 = 200
      const tableColStyles: Record<number, object> = {
        0:  { cellWidth: 5  },                                      // #
        1:  { cellWidth: 14 },                                      // DATE
        2:  { cellWidth: 16 },                                      // BILL NO
        3:  { cellWidth: 30 },                                      // PARTY
        4:  { cellWidth: 13, halign: 'right'  as const },           // AMT
        5:  { cellWidth: 13, halign: 'center' as const },           // DEL DATE
        6:  { cellWidth: 13, halign: 'center' as const },           // REC DATE
        7:  { cellWidth: 12, halign: 'right'  as const },           // CASH
        8:  { cellWidth: 12, halign: 'right'  as const },           // GPAY
        9:  { cellWidth: 12, halign: 'right'  as const },           // CHQ
        10: { cellWidth: 12, halign: 'right'  as const },           // LINECUT
        11: { cellWidth: 12, halign: 'right'  as const },           // DIFF
        12: { cellWidth: 12, halign: 'center' as const },           // STATUS
        13: { cellWidth: 24, halign: 'left'   as const },           // DBM
      };
      const tableStyles      = { fontSize: 8, font: 'helvetica', fontStyle: 'bold' as const, cellPadding: 0.25, minCellHeight: 2.38, overflow: 'ellipsize' as const, lineWidth: 0.15, textColor: [0,0,0] as [number,number,number] };
      const headStyles       = { fillColor: [79,70,229] as [number,number,number], textColor: [255,255,255] as [number,number,number], fontStyle: 'bold' as const, fontSize: 8, cellPadding: 0.25, minCellHeight: 2.38 };
      const footStyles       = { fillColor: [79,70,229] as [number,number,number], textColor: [255,255,255] as [number,number,number], fontStyle: 'bold' as const, fontSize: 8, cellPadding: 0.25, minCellHeight: 2.38 };
      const margin           = { left: 3, right: 3 };

      // ── Sort helper: Cash → GPay → Cheque → Split → FBR → Credit → Del Pending → Other ──
      function pdfPayOrder(b: Bill): number {
        const e = getEffAmt(b);
        const hasCash = e.cash > 0, hasGpay = e.upi > 0, hasChq = e.chq > 0;
        if (hasCash && !hasGpay && !hasChq) return 0; // cash only
        if (hasGpay && !hasCash && !hasChq) return 1; // gpay only
        if (hasChq  && !hasCash && !hasGpay) return 2; // cheque only
        if (hasCash || hasGpay || hasChq)   return 3; // split / mixed
        const pm = (b.paymentMode || '').toLowerCase();
        if (pm === 'fbr' || pm === 'cancel') return 4;
        if (pm === 'credit')                 return 5;
        if (pm === 'del pending')            return 6;
        return 7; // unpaid / assigned / pending
      }
      function sortForPdf(list: Bill[]): Bill[] {
        return [...list].sort((a, b) => {
          const od = pdfPayOrder(a) - pdfPayOrder(b);
          if (od !== 0) return od;
          return (a.billNo || '').localeCompare(b.billNo || '', 'en', { numeric: true });
        });
      }

      // ── Group bills by party / salesperson — one table per group, common columns ───
      // BILL DATE, PARTY NAME, SALESPERSON NAME, BILL AMOUNT, REC DATE, DEL DATE,
      // REC AMOUNT, PAYMENT MODE, STATUS. Respects the current statusFilter (already
      // applied in `filtered`) — e.g. if UNPAID is selected, each group's table only
      // shows that group's unpaid bills.
      // Same classification used to build `filtered` (statusFilter logic above) so
      // the STATUS column here always matches what a status filter actually selected.
      function classifyBillStatus(b: Bill): string {
        const collected = b.collectedAmount || 0;
        const isPaid = collected > 0;
        const lc = (b.lineCutAmt || 0) || Number(b.cancelLine) || 0;
        const netAfterLC = b.billNetAmt - lc;
        const isAutoFbr = !b.paymentDate && Math.abs(netAfterLC) <= 1 && collected === 0 && b.paymentMode !== 'Credit';
        const isFBR = collected === 0 && (b.paymentMode === 'Cancel' || b.paymentMode === 'FBR' || isAutoFbr);
        const isCredit = collected === 0 && b.paymentMode === 'Credit' && !!b.driverName;
        const isDelPending = collected === 0 && b.paymentMode === 'Del Pending';
        if (isPaid) return 'PAID';
        if (isFBR) return 'FBR';
        if (isCredit) return 'CREDIT';
        if (isDelPending) return 'DEL PEND';
        if (b.paymentMode === 'Pending') return 'PENDING';
        return 'UNPAID';
      }
      function makeGroupedRow(b: Bill) {
        const collected = b.collectedAmount || 0;
        const status = classifyBillStatus(b);
        return [
          b.date || '-',
          stripGST(b.billNo),
          b.partyName || '-',
          b.salespersonName || '-',
          b.billNetAmt.toLocaleString('en-IN'),
          collected > 0 && b.paymentDate ? b.paymentDate : '-',
          b.deliveryDate || '-',
          collected > 0 ? collected.toLocaleString('en-IN') : '-',
          b.paymentMode || '-',
          status,
        ];
      }
      const groupedTableHead = [['BILL DATE', 'BILL NO', 'PARTY NAME', 'SALESPERSON', 'BILL AMT', 'REC DATE', 'DEL DATE', 'REC AMT', 'MODE', 'STATUS']];
      const groupedColStyles: Record<number, object> = {
        4: { halign: 'right' as const },
        5: { halign: 'center' as const },
        6: { halign: 'center' as const },
        7: { halign: 'right' as const },
        8: { halign: 'center' as const },
        9: { halign: 'center' as const },
      };
      function makeGroupedCellParser(subset: Bill[]) {
        return (data: any) => {
          if (data.section !== 'body') return;
          const bill = subset[data.row.index];
          if (!bill) return;
          if (bill.paymentMode === 'FBR' || bill.paymentMode === 'Cancel') {
            data.cell.styles.fillColor = [255, 150, 150];
          } else if (bill.paymentMode === 'Credit') {
            data.cell.styles.fillColor = [150, 255, 150];
          } else if (bill.paymentMode === 'Pending' || bill.paymentMode === 'Del Pending') {
            data.cell.styles.fillColor = [255, 255, 150];
          }
          data.cell.styles.textColor = [0, 0, 0];
          data.cell.styles.fontStyle = 'bold';
        };
      }
      function renderGroupedTables(groupKeyLabel: string, groupFn: (b: Bill) => string, bannerColor: [number, number, number]) {
        const map = new Map<string, Bill[]>();
        for (const b of expandedBills) {
          const key = (groupFn(b) || '(UNKNOWN)').trim() || '(UNKNOWN)';
          if (!map.has(key)) map.set(key, []);
          map.get(key)!.push(b);
        }
        const groups = Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
        for (const [name, grpBills] of groups) {
          const sorted = [...grpBills].sort((a, b) => (a.billNo || '').localeCompare(b.billNo || '', 'en', { numeric: true }));
          const grpAmt = sorted.reduce((s, b) => s + (b.billNetAmt || 0), 0);
          const grpColl = sorted.reduce((s, b) => s + (b.collectedAmount || 0), 0);

          doc.setFillColor(...bannerColor);
          doc.setTextColor(255, 255, 255);
          doc.setFontSize(8.5); doc.setFont('helvetica', 'bold');
          const pageW = doc.internal.pageSize.getWidth();
          doc.rect(5, curY, pageW - 10, 6, 'F');
          doc.text(`${groupKeyLabel}: ${name.toUpperCase()}   —   ${sorted.length} BILLS`, 8, curY + 4.2);
          doc.setTextColor(0, 0, 0);
          curY += 7;

          const bodyData = sorted.map(makeGroupedRow);
          const footRow = ['', '', '', `TOTAL (${sorted.length})`, grpAmt.toLocaleString('en-IN'), '', '', grpColl > 0 ? grpColl.toLocaleString('en-IN') : '-', '', ''];

          autoTable(doc, {
            startY: curY,
            head: groupedTableHead,
            body: bodyData,
            foot: [footRow],
            showFoot: 'lastPage',
            theme: 'grid',
            styles: tableStyles,
            headStyles,
            footStyles,
            bodyStyles: { textColor: [0, 0, 0], fontStyle: 'bold' },
            columnStyles: groupedColStyles,
            margin,
            didParseCell: makeGroupedCellParser(sorted),
          });

          curY = (doc as any).lastAutoTable.finalY + 6;
          if (curY > doc.internal.pageSize.getHeight() - 40) {
            doc.addPage();
            curY = 12;
          }
        }
        return groups.length;
      }

      // ── Group bills by driver for driver-wise PDF ─────────────────────
      // Bills where payment was received on a different date than delivery → group under OWNER or USER
      const useDriverWise = (!!deliveryDate || !!recDate) && !(salesperson || party) && viewMode !== 'partywise' && viewMode !== 'salespersonwise';

      // Build set of user-role names to detect user entries from paymentTime field
      const userNameSet = new Set(
        drivers
          .filter(d => d.role === 'user' || d.id?.startsWith('usr_'))
          .map(d => d.name.toUpperCase().trim())
      );

      function getPdfGroupKey(b: Bill): string {
        const collByOwner = (b.collectedAmount || 0) > 0 && !!b.deliveryDate && !!b.paymentDate && b.paymentDate !== b.deliveryDate;
        if (collByOwner) {
          // paymentTime stores entry-maker name for recent entries (HH:MM for old entries)
          const entryName = (b.paymentTime || '').trim().toUpperCase();
          // If it matches a known user → show under their name; otherwise OWNER
          return userNameSet.has(entryName) ? entryName : 'OWNER';
        }
        return (b.driverName || '(Unassigned)').trim();
      }

      const driverGroupMap = new Map<string, Bill[]>();
      for (const b of expandedBills) {
        const key = getPdfGroupKey(b);
        if (!driverGroupMap.has(key)) driverGroupMap.set(key, []);
        driverGroupMap.get(key)!.push(b);
      }
      const driverGroups = Array.from(driverGroupMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));

      // ── PDF Title ────────────────────────────────────────────────────
      const isPartyOrSP = !!(party || salesperson);
      const reportTitle = viewMode === 'partywise'
        ? 'VITRATRACK — PARTY WISE REPORT'
        : viewMode === 'salespersonwise'
        ? 'VITRATRACK — SALESPERSON WISE REPORT'
        : party
        ? 'VITRATRACK — PARTY REPORT'
        : salesperson
        ? 'VITRATRACK — SALESPERSON REPORT'
        : 'VITRATRACK — DRIVER WISE REPORT';

      doc.setFontSize(13); doc.setFont('helvetica', 'bold');
      doc.text(reportTitle, 14, 14);

      let curY = 20;

      // ── Show selected party / salesperson name prominently ───────────
      if (isPartyOrSP) {
        const nameLabel = party
          ? `PARTY: ${party.toUpperCase()}`
          : `SALESPERSON: ${salesperson.toUpperCase()}`;
        doc.setFontSize(10); doc.setFont('helvetica', 'bold');
        doc.setTextColor(79, 70, 229);
        doc.text(nameLabel, 14, curY);
        doc.setTextColor(0, 0, 0);
        curY += 6;
      }

      if (dateInfo) {
        doc.setFontSize(9); doc.setFont('helvetica', 'bold');
        doc.text(dateInfo, 14, curY);
        curY += 6;
      }

      if (viewMode === 'partywise') {
        renderGroupedTables('PARTY', b => b.partyName || '', [16, 130, 84]);
      } else if (viewMode === 'salespersonwise') {
        renderGroupedTables('SALESPERSON', b => b.salespersonName || '', [194, 100, 20]);
      } else if (useDriverWise && driverGroups.length > 0) {
        // ── One table per driver ─────────────────────────────────────
        for (const [driverName, rawDBills] of driverGroups) {
          const dBills = sortForPdf(rawDBills);
          const dCash = dBills.reduce((s, b) => s + getEffAmt(b).cash, 0);
          const dGpay = dBills.reduce((s, b) => s + getEffAmt(b).upi,  0);
          const dChq  = dBills.reduce((s, b) => s + getEffAmt(b).chq,  0);
          const dAmt  = dBills.reduce((s, b) => s + (b.billNetAmt || 0), 0);
          const dLine = dBills.reduce((s, b) => s + ((b.lineCutAmt || 0) || Number(b.cancelLine) || 0), 0);
          const dColl = dBills.reduce((s, b) => s + (b.collectedAmount || 0), 0);
          const dDiff = dAmt - dLine - dColl;

          // Driver name banner
          doc.setFillColor(30, 80, 180);
          doc.setTextColor(255, 255, 255);
          doc.setFontSize(8); doc.setFont('helvetica', 'bold');
          const pageW = doc.internal.pageSize.getWidth();
          doc.rect(3, curY, pageW - 6, 4.8, 'F');
          doc.text(`${driverName.toUpperCase()}   —   ${dBills.length} BILLS`, 6, curY + 3.4);
          doc.setTextColor(0, 0, 0);
          curY += 5.8;

          const bodyData = dBills.map((b, i) => makePdfRow(b, i + 1));
          const footRow  = [
            `TOTAL (${dBills.length})`, '', '', '',
            dAmt.toLocaleString('en-IN'), '', '',
            dCash > 0 ? dCash.toLocaleString('en-IN') : '-',
            dGpay > 0 ? dGpay.toLocaleString('en-IN') : '-',
            dChq  > 0 ? dChq.toLocaleString('en-IN')  : '-',
            dLine > 0 ? dLine.toLocaleString('en-IN')  : '-',
            dDiff.toLocaleString('en-IN'), '', '',
          ];

          autoTable(doc, {
            startY: curY,
            head: tableHead,
            body: bodyData,
            foot: [footRow],
            showFoot: 'lastPage',
            theme: 'grid',
            styles: tableStyles,
            headStyles,
            footStyles,
            bodyStyles: { textColor: [0,0,0], fontStyle: 'bold' },
            columnStyles: tableColStyles,
            margin,
            didParseCell: makeCellParser(dBills),
          });

          curY = (doc as any).lastAutoTable.finalY + 6;

          // New page if little space left
          if (curY > doc.internal.pageSize.getHeight() - 40) {
            doc.addPage();
            curY = 12;
          }
        }
      } else {
        // ── Single combined table (when a specific driver is selected) ──
        const sortedFiltered = sortForPdf(expandedBills);
        const tableData = sortedFiltered.map((b, i) => makePdfRow(b, i + 1));
        const tCash = expandedBills.reduce((s, b) => s + getEffAmt(b).cash, 0);
        const tGpay = expandedBills.reduce((s, b) => s + getEffAmt(b).upi,  0);
        const tChq  = expandedBills.reduce((s, b) => s + getEffAmt(b).chq,  0);
        const tAmt  = expandedBills.reduce((s, b) => s + (b.billNetAmt || 0), 0);
        const tLine = expandedBills.reduce((s, b) => s + ((b.lineCutAmt || 0) || Number(b.cancelLine) || 0), 0);
        const tColl = expandedBills.reduce((s, b) => s + (b.collectedAmount || 0), 0);
        const tDiff = tAmt - tLine - tColl;

        autoTable(doc, {
          startY: curY,
          head: tableHead,
          body: tableData,
          foot: [[``, '', '', '', `TOTAL (${expandedBills.length}) ₹${tAmt.toLocaleString('en-IN')}`, '', '', tCash.toLocaleString('en-IN'), tGpay.toLocaleString('en-IN'), tChq.toLocaleString('en-IN'), tLine.toLocaleString('en-IN'), tDiff.toLocaleString('en-IN'), '', '']],
          showFoot: 'lastPage',
          theme: 'grid',
          styles: tableStyles,
          headStyles,
          footStyles,
          bodyStyles: { textColor: [0,0,0], fontStyle: 'bold' },
          columnStyles: tableColStyles,
          margin,
          didParseCell: makeCellParser(sortedFiltered),
        });
        curY = (doc as any).lastAutoTable.finalY + 10;
      }

      // ── Calculator Box — only when a driver is selected and NOT party/salesperson ─────────────
      if (driver && !isPartyOrSP) {
        const boxStartY = curY + 4;
        autoTable(doc, {
          startY: boxStartY,
          margin: { left: 14 },
          tableWidth: 60,
          head: [['CALCULATOR', 'RS']],
          body: [
            [`500 × ${breakdownAgg.n500}`, (breakdownAgg.n500 * 500).toLocaleString('en-IN')],
            [`200 × ${breakdownAgg.n200}`, (breakdownAgg.n200 * 200).toLocaleString('en-IN')],
            [`100 × ${breakdownAgg.n100}`, (breakdownAgg.n100 * 100).toLocaleString('en-IN')],
            [`50  × ${breakdownAgg.n50}`,  (breakdownAgg.n50  *  50).toLocaleString('en-IN')],
            [`20  × ${breakdownAgg.n20}`,  (breakdownAgg.n20  *  20).toLocaleString('en-IN')],
            [`10  × ${breakdownAgg.n10}`,  (breakdownAgg.n10  *  10).toLocaleString('en-IN')],
            ['COINS', breakdownAgg.coins.toLocaleString('en-IN')],
            ['TOTAL', calcTotal.toLocaleString('en-IN')],
          ],
          theme: 'grid',
          styles: { fontSize: 8.5, font: 'helvetica', fontStyle: 'bold', cellPadding: 1.4 },
          headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold', fontSize: 8.5 },
          columnStyles: { 1: { halign: 'right' } },
          didParseCell: (data: any) => {
            if (data.row.index === 7 && data.column.index === 1) data.cell.styles.textColor = [200, 0, 0];
          }
        });
      }




      // ── Driver-wise Summary Table (only when driver-wise mode and NOT party/salesperson) ───────────
      if (useDriverWise && !isPartyOrSP) {
      const driverMap = new Map<string, {
        billCount: number; totalAmt: number; cash: number; gpay: number; chq: number; lineCut: number; credit: number; fbr: number;
      }>();
      for (const b of expandedBills) {
        const eff = getEffAmt(b);
        const lc = (b.lineCutAmt || 0) || Number(b.cancelLine) || 0;
        const isFBRb = b.paymentMode === 'FBR' || b.paymentMode === 'Cancel';
        const isCreditb = b.paymentMode === 'Credit';
        // Use shared key function: detects USER entries separately from OWNER
        const key = getPdfGroupKey(b);
        if (!driverMap.has(key)) driverMap.set(key, { billCount: 0, totalAmt: 0, cash: 0, gpay: 0, chq: 0, lineCut: 0, credit: 0, fbr: 0 });
        const entry = driverMap.get(key)!;
        entry.billCount += 1;
        entry.totalAmt  += b.billNetAmt || 0;
        entry.cash      += eff.cash;
        entry.gpay      += eff.upi;
        entry.chq       += eff.chq;
        entry.lineCut   += lc;
        if (isCreditb) entry.credit += b.billNetAmt - lc;
        if (isFBRb)    entry.fbr    += b.billNetAmt;
      }
      const sortedDrivers = Array.from(driverMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));

      const driverTableY = (doc as any).lastAutoTable.finalY + 10;
      autoTable(doc, {
        startY: driverTableY,
        margin: { left: 5, right: 5 },
        head: [['DRIVER / USER', 'BILLS', 'TOTAL AMT', 'CASH', 'GPAY', 'CHQ', 'LINE CUT', 'CREDIT', 'FBR']],
        body: sortedDrivers.map(([name, d]) => [
          name.toUpperCase(),
          d.billCount,
          d.totalAmt.toLocaleString('en-IN'),
          d.cash > 0  ? d.cash.toLocaleString('en-IN')  : '-',
          d.gpay > 0  ? d.gpay.toLocaleString('en-IN')  : '-',
          d.chq  > 0  ? d.chq.toLocaleString('en-IN')   : '-',
          d.lineCut > 0 ? d.lineCut.toLocaleString('en-IN') : '-',
          d.credit > 0  ? d.credit.toLocaleString('en-IN')  : '-',
          d.fbr  > 0  ? d.fbr.toLocaleString('en-IN')   : '-',
        ]),
        foot: [(() => {
          const gt = sortedDrivers.reduce((acc, [, d]) => ({
            billCount: acc.billCount + d.billCount,
            totalAmt: acc.totalAmt + d.totalAmt,
            cash: acc.cash + d.cash,
            gpay: acc.gpay + d.gpay,
            chq: acc.chq + d.chq,
            lineCut: acc.lineCut + d.lineCut,
            credit: acc.credit + d.credit,
            fbr: acc.fbr + d.fbr,
          }), { billCount: 0, totalAmt: 0, cash: 0, gpay: 0, chq: 0, lineCut: 0, credit: 0, fbr: 0 });
          return [
            `TOTAL (${sortedDrivers.length} DRIVERS)`,
            gt.billCount,
            gt.totalAmt.toLocaleString('en-IN'),
            gt.cash > 0  ? gt.cash.toLocaleString('en-IN')  : '-',
            gt.gpay > 0  ? gt.gpay.toLocaleString('en-IN')  : '-',
            gt.chq  > 0  ? gt.chq.toLocaleString('en-IN')   : '-',
            gt.lineCut > 0 ? gt.lineCut.toLocaleString('en-IN') : '-',
            gt.credit > 0  ? gt.credit.toLocaleString('en-IN')  : '-',
            gt.fbr  > 0  ? gt.fbr.toLocaleString('en-IN')   : '-',
          ];
        })()],
        showFoot: 'lastPage',
        theme: 'grid',
        styles: { fontSize: 7.5, font: 'helvetica', fontStyle: 'bold', cellPadding: 0.3, minCellHeight: 2.38, overflow: 'ellipsize', lineWidth: 0.15, textColor: [0, 0, 0] },
        headStyles: { fillColor: [30, 80, 180], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5, cellPadding: 0.3, minCellHeight: 2.38 },
        footStyles: { fillColor: [30, 80, 180], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5, cellPadding: 0.3, minCellHeight: 2.38 },
        bodyStyles: { textColor: [0, 0, 0] },
        columnStyles: {
          0: { cellWidth: 38 },
          1: { halign: 'center', cellWidth: 12 },
          2: { halign: 'right', cellWidth: 24 },
          3: { halign: 'right', cellWidth: 20 },
          4: { halign: 'right', cellWidth: 20 },
          5: { halign: 'right', cellWidth: 22 },
          6: { halign: 'right', cellWidth: 20 },
          7: { halign: 'right', cellWidth: 20 },
          8: { halign: 'right', cellWidth: 20 },
        },
        didParseCell: (data: any) => {
          if (data.section === 'body' && data.row.index % 2 === 1) {
            data.cell.styles.fillColor = [240, 244, 255];
          }
        },
      });
      } // end if (useDriverWise)

      // ── Page numbers at bottom of every page ─────────────────────────
      const totalPagesCount = doc.getNumberOfPages();
      const pw = doc.internal.pageSize.getWidth();
      const ph = doc.internal.pageSize.getHeight();
      for (let pg = 1; pg <= totalPagesCount; pg++) {
        doc.setPage(pg);
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(120, 120, 120);
        doc.text(`Page ${pg} / ${totalPagesCount}`, pw / 2, ph - 4, { align: 'center' });
        doc.setTextColor(0, 0, 0);
      }

      // ── File name: DDMMYY + driver name (e.g. "190526 KARIM") ────────
      const _n = new Date();
      const _dd = String(_n.getDate()).padStart(2, '0');
      const _mm = String(_n.getMonth() + 1).padStart(2, '0');
      const _yy = String(_n.getFullYear()).slice(2);
      const _datePart = `${_dd}${_mm}${_yy}`;
      const _namePart = party
        ? ` ${party.toUpperCase().replace(/\s+/g, '_').trim().substring(0, 30)}`
        : salesperson
        ? ` ${salesperson.toUpperCase().replace(/\s+/g, '_').trim().substring(0, 30)}`
        : driver
        ? ` ${driver.toUpperCase().replace(/\s+/g, ' ').trim()}`
        : '';
      doc.save(`${_datePart}${_namePart}.pdf`);
    } catch (err) { console.error(err); alert('PDF Download Failed.'); }
  }

  function handleSort(key: keyof Bill | 'diff' | 'lineCut') {
    setSort(prev => ({ key: key as any, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }));
  }

  const SortIcon = ({ field }: { field: string }) => {
    if (sort.key !== field) return null;
    return sort.direction === 'asc' ? <ChevronUp className="w-3 h-3 inline ml-0.5" /> : <ChevronDown className="w-3 h-3 inline ml-0.5" />;
  };

  // Column display config: key → { label, sortKey, align }
  const colConfig: Record<string, { label: string; sortKey: string; right?: boolean; center?: boolean }> = {
    idx:        { label: '#',        sortKey: 'billNo' },
    date:       { label: 'DATE',     sortKey: 'date' },
    billNo:     { label: 'BILL NO',  sortKey: 'billNo' },
    partyName:       { label: 'PARTY',       sortKey: 'partyName' },
    salespersonName: { label: 'SALESPERSON', sortKey: 'salespersonName' },
    driverName:      { label: 'DRIVER',      sortKey: 'driverName' },
    amt:        { label: 'AMT',      sortKey: 'billNetAmt',   right: true },
    recDate:    { label: 'REC DATE', sortKey: 'paymentDate',  center: true },
    delDate:    { label: 'DEL DATE', sortKey: 'deliveryDate', center: true },
    cash:       { label: 'CASH',     sortKey: 'cashAmount',   right: true },
    gpay:       { label: 'GPAY',     sortKey: 'upiAmount',    right: true },
    chq:        { label: 'CHQ',      sortKey: 'chequeAmount', right: true },
    lineCut:    { label: 'LINECUT',  sortKey: 'lineCut',      right: true },
    diff:       { label: 'DIFF',     sortKey: 'diff',         right: true },
    status:     { label: 'STATUS',   sortKey: 'paymentMode',  center: true },
    reason:     { label: 'REASON',   sortKey: 'discrepancyReason' },
    enteredBy:  { label: 'ENTRY BY', sortKey: 'paymentTime' },
  };

  // ── No filter selected = no report ──────────────────────────────────────────
  const hasSelection = !!(fromDate || toDate || deliveryDate || recDate || driver || party || salesperson || statusFilter !== 'ALL');

  const ResizeHandle = ({ colKey }: { colKey: string }) => (
    <div onMouseDown={(e) => startResizing(colKey, e)} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/50 z-20" />
  );

  return (
    <>
    <div className="min-h-screen bg-background pb-4 pt-10 w-full max-w-none overflow-x-hidden">
      <input ref={hulFileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={processHulTemplate} />
      <TopNav />
      <div className="bg-primary px-2 py-1.5 rounded-b-lg shadow-sm w-full">
        <div className="flex items-center justify-between gap-2 w-full">
          <div><h1 className="text-[11px] font-black text-primary-foreground uppercase tracking-widest leading-none">Financial Audit</h1><p className="text-[8px] font-bold text-primary-foreground/60 uppercase tracking-tighter">Global Reconciliation</p></div>
          <div className="flex gap-1 flex-wrap justify-end">
            <Button size="sm" onClick={() => setShowAutoDispatch(true)} className="h-8 px-3 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black text-[10px] rounded-lg border-0 shadow-sm">⚡ 50 SP Auto Dispatch</Button>
            <Button size="sm" onClick={exportToHUL} className="h-8 px-3 bg-blue-700 text-white font-black text-[10px] rounded-lg border-0 shadow-sm"><SheetIcon className="w-3.5 h-3.5 mr-1" /> HUL XLS</Button>
            <Button size="sm" onClick={exportToXLS} className="h-8 px-3 bg-emerald-600 text-white font-black text-[10px] rounded-lg border-0 shadow-sm"><SheetIcon className="w-3.5 h-3.5 mr-1" /> XLS</Button>
            <Button size="sm" onClick={exportToPDF} className="h-8 px-3 bg-rose-500 text-white font-black text-[10px] rounded-lg border-0 shadow-sm"><FileText className="w-3.5 h-3.5 mr-1" /> PDF</Button>
          </div>
        </div>
      </div>

      <div className="w-full px-0 mt-0 space-y-0">
        <div className="bg-card rounded-none p-0 border-b border-border shadow-sm space-y-1 w-full">
          <div className="flex items-center justify-between px-1.5 pt-1"><span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest flex items-center gap-1"><Filter className="w-3 h-3" /> Intelligence Filters</span><button onClick={() => { setFromDate(''); setToDate(''); setDeliveryDate(''); setRecDate(''); setDriver(''); setParty(''); setSalesperson(''); setStatusFilter('ALL'); }} className="text-[9px] font-black text-primary uppercase">Reset</button></div>
          <div className="grid grid-cols-4 gap-0 px-1.5 pb-1">
            <div className="space-y-0.5 pr-1"><label className="text-[7.5px] font-black text-muted-foreground uppercase">From</label><input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="w-full h-7 px-1.5 bg-muted rounded text-[9px] font-black outline-none border-0 uppercase" /></div>
            <div className="space-y-0.5 pr-1"><label className="text-[7.5px] font-black text-muted-foreground uppercase">To</label><input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="w-full h-7 px-1.5 bg-muted rounded text-[9px] font-black outline-none border-0 uppercase" /></div>
            <div className="space-y-0.5 pr-1"><label className="text-[7.5px] font-black text-muted-foreground uppercase">Del Date</label><input type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} className="w-full h-7 px-1.5 bg-muted rounded text-[9px] font-black outline-none border-0 uppercase" /></div>
            <div className="space-y-0.5"><label className="text-[7.5px] font-black text-orange-600 uppercase font-black">Rec Date ★</label><input type="date" value={recDate} onChange={e => setRecDate(e.target.value)} className="w-full h-7 px-1.5 bg-orange-50 rounded text-[9px] font-black outline-none border border-orange-300 uppercase" /></div>
          </div>
          <div className="grid grid-cols-5 gap-0 border-t border-border/30 px-1.5 py-1">
            <div className="space-y-0.5 pr-1"><label className="text-[7.5px] font-black text-muted-foreground uppercase">Driver</label><select value={driver} onChange={e => setDriver(e.target.value)} className="w-full h-7 px-1 bg-muted rounded text-[9px] font-black outline-none border-0 uppercase"><option value="">ALL</option>{drivers.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}</select></div>
            <div className="space-y-0.5 pr-1">
              <div className="flex items-center gap-1">
                <label className="text-[7.5px] font-black text-muted-foreground uppercase">Party</label>
                <button onClick={() => setViewMode(v => v === 'datewise' ? 'detail' : 'datewise')} className={cn("text-[6.5px] font-black uppercase px-1.5 py-0.5 rounded border leading-none", viewMode === 'datewise' ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-border hover:border-primary hover:text-primary")}>DATE WISE</button>
                <button onClick={() => setViewMode(v => v === 'driverwise' ? 'detail' : 'driverwise')} className={cn("text-[6.5px] font-black uppercase px-1.5 py-0.5 rounded border leading-none", viewMode === 'driverwise' ? "bg-indigo-600 text-white border-indigo-600" : "bg-muted text-muted-foreground border-border hover:border-indigo-500 hover:text-indigo-600")}>DRIVER WISE</button>
                <button onClick={() => setViewMode(v => v === 'partywise' ? 'detail' : 'partywise')} className={cn("text-[6.5px] font-black uppercase px-1.5 py-0.5 rounded border leading-none", viewMode === 'partywise' ? "bg-emerald-600 text-white border-emerald-600" : "bg-muted text-muted-foreground border-border hover:border-emerald-500 hover:text-emerald-600")}>PARTY WISE</button>
                <button onClick={() => setViewMode(v => v === 'salespersonwise' ? 'detail' : 'salespersonwise')} className={cn("text-[6.5px] font-black uppercase px-1.5 py-0.5 rounded border leading-none", viewMode === 'salespersonwise' ? "bg-orange-600 text-white border-orange-600" : "bg-muted text-muted-foreground border-border hover:border-orange-500 hover:text-orange-600")}>SP WISE</button>
              </div>
              <select value={party} onMouseDown={activateNameLists} onFocus={activateNameLists} onChange={e => setParty(e.target.value)} className="w-full h-7 px-1 bg-muted rounded text-[9px] font-black outline-none border-0 uppercase"><option value="">ALL</option>{partyList.map(p => <option key={p} value={p}>{p}</option>)}</select>
            </div>
            <div className="space-y-0.5 pr-1">
              <label className="text-[7.5px] font-black text-muted-foreground uppercase">Status</label>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)} className="w-full h-7 px-1 bg-muted rounded text-[9px] font-black outline-none border-0 uppercase">
                <option value="ALL">ALL</option>
                <option value="PAID">PAID</option>
                <option value="UNPAID">UNPAID</option>
                <option value="CREDIT">CREDIT</option>
                <option value="FBR">FBR</option>
                <option value="DEL_PENDING">DEL PENDING</option>
              </select>
            </div>
            <div className="space-y-0.5 col-span-2">
              <div className="flex items-center justify-between">
                <label className="text-[7.5px] font-black text-muted-foreground uppercase">Salesperson</label>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setShowMocPicker(true)}
                    className={cn(
                      "text-[7px] font-black uppercase px-1.5 py-0.2 rounded border leading-none transition-colors",
                      (salesperson || '').toUpperCase().includes('MOC') || commissionMocs.some(m => (m?.month || '').toUpperCase() === (salesperson || '').toUpperCase() || (m?.code || '').toUpperCase() === (salesperson || '').toUpperCase())
                        ? "bg-emerald-600 text-white border-emerald-600 shadow-xs"
                        : "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-950 dark:text-emerald-300"
                    )}
                    title="Select Commission Month (MOC Master)"
                  >
                    {(salesperson || '').toUpperCase().includes('MOC') || commissionMocs.some(m => (m?.month || '').toUpperCase() === (salesperson || '').toUpperCase() || (m?.code || '').toUpperCase() === (salesperson || '').toUpperCase())
                      ? ((salesperson || '').toUpperCase() || 'MOC')
                      : 'MOC'}
                  </button>
                  {salesperson && (
                    <button
                      type="button"
                      onClick={() => setSalesperson('')}
                      className="text-[7.5px] font-black text-muted-foreground hover:text-red-500 uppercase px-0.5"
                      title="Clear salesperson filter"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
              <input list="sp-list" type="text" value={salesperson} onFocus={activateNameLists} onChange={e => setSalesperson(e.target.value)} placeholder="..." className="w-full h-7 px-2 bg-muted rounded text-[9px] font-black outline-none border-0 uppercase" />
              <datalist id="sp-list">{salespersonList.map(s => <option key={s} value={s} />)}</datalist>
            </div>
          </div>
        </div>

        {/* ── No-selection placeholder ─────────────────────────────────── */}
        {!hasSelection && (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground select-none">
            <Filter className="w-8 h-8 opacity-20" />
            <p className="text-[11px] font-black uppercase tracking-widest opacity-40">Select a filter to load report</p>
            <p className="text-[9px] font-bold uppercase tracking-wide opacity-25">Rec Date · Del Date · Driver · Party · Salesperson · Status</p>
          </div>
        )}

        {hasSelection && viewMode === 'datewise' && (
          <div className="bg-card border-0 overflow-hidden overflow-x-auto no-scrollbar w-full">
            <table className="w-full border-separate border-spacing-y-[1px] text-[11px] font-black uppercase">
              <thead>
                <tr className="bg-primary text-primary-foreground">
                  <th className="px-2 py-1.5 text-left font-black tracking-tight">#</th>
                  <th className="px-2 py-1.5 text-left font-black tracking-tight">REC DATE</th>
                  <th className="px-2 py-1.5 text-right font-black tracking-tight">BILLS AMT</th>
                  <th className="px-2 py-1.5 text-right font-black tracking-tight text-emerald-300">REC CASH</th>
                  <th className="px-2 py-1.5 text-right font-black tracking-tight text-blue-300">REC GPAY</th>
                  <th className="px-2 py-1.5 text-right font-black tracking-tight text-violet-300">REC CHQ</th>
                  <th className="px-2 py-1.5 text-right font-black tracking-tight text-red-300">FBR AMT</th>
                  <th className="px-2 py-1.5 text-right font-black tracking-tight text-amber-300">LINE CUT</th>
                  <th className="px-2 py-1.5 text-right font-black tracking-tight text-green-300">CREDIT AMT</th>
                </tr>
              </thead>
              <tbody>
                {dateWiseData.map((row, i) => (
                  <tr key={row.recDate} className={cn("border-b border-border/40", i % 2 === 0 ? "bg-white" : "bg-muted/30")}>
                    <td className="px-2 py-1 text-muted-foreground">{i + 1}</td>
                    <td className="px-2 py-1 font-black text-orange-600">{row.recDate}</td>
                    <td className="px-2 py-1 text-right">₹{row.totalBillsAmt.toLocaleString('en-IN')}</td>
                    <td className="px-2 py-1 text-right text-emerald-700">₹{row.recCash.toLocaleString('en-IN')}</td>
                    <td className="px-2 py-1 text-right text-blue-700">₹{row.recGpay.toLocaleString('en-IN')}</td>
                    <td className="px-2 py-1 text-right text-violet-700">₹{row.recChq.toLocaleString('en-IN')}</td>
                    <td className="px-2 py-1 text-right text-red-600">₹{row.totalFbr.toLocaleString('en-IN')}</td>
                    <td className="px-2 py-1 text-right text-amber-600">₹{row.totalLineCut.toLocaleString('en-IN')}</td>
                    <td className="px-2 py-1 text-right text-green-700">₹{row.totalCredit.toLocaleString('en-IN')}</td>
                  </tr>
                ))}
                {dateWiseData.length > 0 && (() => {
                  const gt = dateWiseData.reduce((acc, r) => ({
                    totalBillsAmt: acc.totalBillsAmt + r.totalBillsAmt,
                    recCash: acc.recCash + r.recCash,
                    recGpay: acc.recGpay + r.recGpay,
                    recChq: acc.recChq + r.recChq,
                    totalFbr: acc.totalFbr + r.totalFbr,
                    totalLineCut: acc.totalLineCut + r.totalLineCut,
                    totalCredit: acc.totalCredit + r.totalCredit,
                  }), { totalBillsAmt: 0, recCash: 0, recGpay: 0, recChq: 0, totalFbr: 0, totalLineCut: 0, totalCredit: 0 });
                  return (
                    <tr className="bg-primary text-primary-foreground font-black">
                      <td className="px-2 py-1.5" colSpan={2}>TOTAL ({dateWiseData.length} DAYS)</td>
                      <td className="px-2 py-1.5 text-right">₹{gt.totalBillsAmt.toLocaleString('en-IN')}</td>
                      <td className="px-2 py-1.5 text-right">₹{gt.recCash.toLocaleString('en-IN')}</td>
                      <td className="px-2 py-1.5 text-right">₹{gt.recGpay.toLocaleString('en-IN')}</td>
                      <td className="px-2 py-1.5 text-right">₹{gt.recChq.toLocaleString('en-IN')}</td>
                      <td className="px-2 py-1.5 text-right">₹{gt.totalFbr.toLocaleString('en-IN')}</td>
                      <td className="px-2 py-1.5 text-right">₹{gt.totalLineCut.toLocaleString('en-IN')}</td>
                      <td className="px-2 py-1.5 text-right">₹{gt.totalCredit.toLocaleString('en-IN')}</td>
                    </tr>
                  );
                })()}
                {dateWiseData.length === 0 && (
                  <tr><td colSpan={9} className="px-2 py-8 text-center text-muted-foreground text-[10px]">NO DATA — Apply filters to see date-wise report</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {hasSelection && viewMode === 'driverwise' && (
          <div className="bg-card border-0 overflow-hidden overflow-x-auto no-scrollbar w-full">
            <table className="w-full border-collapse text-[10px] font-black uppercase">
              <thead className="sticky top-0 z-10">
                <tr className="bg-indigo-700 text-white">
                  <th className="px-1.5 py-1.5 text-center w-7">#</th>
                  <th className="px-1.5 py-1.5 text-left">DATE</th>
                  <th className="px-1.5 py-1.5 text-left">BILL NO</th>
                  <th className="px-1.5 py-1.5 text-left">PARTY</th>
                  <th className="px-1.5 py-1.5 text-left text-indigo-300">SALESPERSON</th>
                  <th className="px-1.5 py-1.5 text-right">AMT</th>
                  <th className="px-1.5 py-1.5 text-center">REC DATE</th>
                  <th className="px-1.5 py-1.5 text-center text-indigo-300">DEL DATE</th>
                  <th className="px-1.5 py-1.5 text-right text-emerald-300">CASH</th>
                  <th className="px-1.5 py-1.5 text-right text-blue-300">GPAY</th>
                  <th className="px-1.5 py-1.5 text-right text-violet-300">CHQ</th>
                  <th className="px-1.5 py-1.5 text-right text-amber-300">LINE CUT</th>
                  <th className="px-1.5 py-1.5 text-right">DIFF</th>
                  <th className="px-1.5 py-1.5 text-center">STATUS</th>
                </tr>
              </thead>
              <tbody>
                {driverWiseData.length === 0 && (
                  <tr><td colSpan={14} className="px-2 py-8 text-center text-muted-foreground text-[10px]">NO DATA — Apply filters to see driver-wise report</td></tr>
                )}
                {driverWiseData.map(({ name, bills: grpBills }) => {
                  const grpCash = grpBills.reduce((s, b) => s + getEffAmt(b).cash, 0);
                  const grpGpay = grpBills.reduce((s, b) => s + getEffAmt(b).upi, 0);
                  const grpChq  = grpBills.reduce((s, b) => s + getEffAmt(b).chq, 0);
                  const grpAmt  = grpBills.reduce((s, b) => s + (b.billNetAmt || 0), 0);
                  const grpLine = grpBills.reduce((s, b) => s + ((b.lineCutAmt || 0) || Number(b.cancelLine) || 0), 0);
                  const grpColl = grpBills.reduce((s, b) => s + (b.collectedAmount || 0), 0);
                  const grpDiff = grpAmt - grpLine - grpColl;
                  return (
                    <>
                      {/* Driver header row */}
                      <tr key={`hdr-${name}`} className="bg-indigo-100 border-t-2 border-indigo-400">
                        <td colSpan={14} className="px-2 py-1 text-[11px] font-black text-indigo-800 tracking-widest">
                          👤 {name.toUpperCase()} — {grpBills.length} BILLS
                        </td>
                      </tr>
                      {/* Bill rows */}
                      {grpBills.map((b, i) => {
                        const eff = getEffAmt(b);
                        const collected = b.collectedAmount || 0;
                        const lc = (b.lineCutAmt || 0) || Number(b.cancelLine) || 0;
                        const diff = b.billNetAmt - lc - collected;
                        const isFBR     = b.paymentMode === 'FBR' || b.paymentMode === 'Cancel';
                        const isCredit  = b.paymentMode === 'Credit' && collected === 0;
                        const isDelPend = b.paymentMode === 'Del Pending' && collected === 0;
                        const isPaid    = collected > 0 && Math.abs(diff) <= 1 && !isFBR;
                        const isAsgnd   = !isPaid && !isFBR && !isCredit && !isDelPend && !!b.driverName && b.deliveryDate === todayDisplay;
                        const label = isFBR ? 'FBR' : isCredit ? 'CREDIT' : isDelPend ? 'DEL PEND' : isPaid ? 'PAID' : isAsgnd ? 'ASGND' : 'UNPAID';
                        const labelCls = isFBR ? 'bg-red-500 text-white' : isCredit ? 'bg-green-500 text-white' : isDelPend ? 'bg-yellow-400 text-black' : isPaid ? 'bg-emerald-500 text-white' : isAsgnd ? 'bg-red-100 text-red-700' : 'bg-muted text-muted-foreground';
                        const rowCls = isFBR ? 'bg-red-50' : isCredit ? 'bg-green-50' : isDelPend ? 'bg-yellow-50' : i % 2 === 0 ? 'bg-white' : 'bg-slate-50/60';
                        return (
                          <tr key={b.billNo} onClick={() => setEditBill(b)} className={cn("border-b border-border/20 hover:bg-indigo-50/40 cursor-pointer transition-colors", rowCls)}>
                            <td className="px-1.5 py-0.5 text-center text-muted-foreground">{i + 1}</td>
                            <td className="px-1.5 py-0.5">{b.date || '-'}</td>
                            <td className={cn("px-1.5 py-0.5 font-black", isFBR && "text-red-700", isCredit && "text-green-800")}>{stripGST(getDisplayBillNo(b))}</td>
                            <td className="px-1.5 py-0.5 font-black truncate">
                              <span className={cn(
                                "truncate inline-block px-1 py-0.5 rounded font-black",
                                isGreenParty(b.partyCode, b.partyName) ? "bg-emerald-300 text-emerald-950 dark:bg-emerald-800 dark:text-emerald-100 border border-emerald-500 shadow-sm" : ""
                              )}>
                                {b.partyName || '-'}
                              </span>
                            </td>
                            <td className="px-1.5 py-0.5 truncate text-primary/70">{b.salespersonName || '—'}</td>
                            <td className="px-1.5 py-0.5 text-right">₹{b.billNetAmt.toLocaleString('en-IN')}</td>
                            <td className="px-1.5 py-0.5 text-center text-orange-600">{b.paymentDate || '-'}</td>
                            <td className="px-1.5 py-0.5 text-center text-indigo-600">{b.deliveryDate || '-'}</td>
                            <td className="px-1.5 py-0.5 text-right text-emerald-700">{eff.cash > 0 ? `₹${eff.cash.toLocaleString('en-IN')}` : '—'}</td>
                            <td className="px-1.5 py-0.5 text-right text-blue-700">{eff.upi > 0 ? `₹${eff.upi.toLocaleString('en-IN')}` : '—'}</td>
                            <td className="px-1.5 py-0.5 text-right text-violet-700">{eff.chq > 0 ? `₹${eff.chq.toLocaleString('en-IN')}` : '—'}</td>
                            <td className="px-1.5 py-0.5 text-right text-amber-600">{lc > 0 ? `₹${lc.toLocaleString('en-IN')}` : '—'}</td>
                            <td className={cn("px-1.5 py-0.5 text-right font-black", isCredit ? "text-green-700" : isDelPend ? "text-yellow-600" : diff > 0 ? "text-destructive" : diff < 0 ? "text-blue-700" : "text-muted-foreground/40")}>
                              {isCredit ? 'CREDIT' : isDelPend ? 'NOT DEL' : `₹${diff.toLocaleString('en-IN')}`}
                            </td>
                            <td className="px-1.5 py-0.5 text-center">
                              <span className={cn("px-1.5 py-px rounded text-[8px] font-black", labelCls)}>{label}</span>
                            </td>
                          </tr>
                        );
                      })}
                      {/* Driver subtotal row */}
                      <tr key={`tot-${name}`} className="bg-indigo-700 text-white border-t border-indigo-500">
                        <td colSpan={5} className="px-2 py-1 text-[10px] font-black">TOTAL — {name.toUpperCase()} ({grpBills.length})</td>
                        <td className="px-1.5 py-1 text-right font-black">₹{grpAmt.toLocaleString('en-IN')}</td>
                        <td className="px-1.5 py-1 text-center">—</td>
                        <td className="px-1.5 py-1 text-center">—</td>
                        <td className="px-1.5 py-1 text-right font-black text-emerald-300">{grpCash > 0 ? `₹${grpCash.toLocaleString('en-IN')}` : '—'}</td>
                        <td className="px-1.5 py-1 text-right font-black text-blue-300">{grpGpay > 0 ? `₹${grpGpay.toLocaleString('en-IN')}` : '—'}</td>
                        <td className="px-1.5 py-1 text-right font-black text-violet-300">{grpChq > 0 ? `₹${grpChq.toLocaleString('en-IN')}` : '—'}</td>
                        <td className="px-1.5 py-1 text-right font-black text-amber-300">{grpLine > 0 ? `₹${grpLine.toLocaleString('en-IN')}` : '—'}</td>
                        <td className={cn("px-1.5 py-1 text-right font-black", grpDiff > 0 ? "text-red-300" : grpDiff < 0 ? "text-blue-300" : "text-white/50")}>₹{grpDiff.toLocaleString('en-IN')}</td>
                        <td className="px-1.5 py-1 text-center">—</td>
                      </tr>
                    </>
                  );
                })}
                {driverWiseData.length > 0 && (() => {
                  const gCash = expandedBills.reduce((s, b) => s + getEffAmt(b).cash, 0);
                  const gGpay = expandedBills.reduce((s, b) => s + getEffAmt(b).upi, 0);
                  const gChq  = expandedBills.reduce((s, b) => s + getEffAmt(b).chq, 0);
                  const gAmt  = expandedBills.reduce((s, b) => s + (b.billNetAmt || 0), 0);
                  const gLine = expandedBills.reduce((s, b) => s + ((b.lineCutAmt || 0) || Number(b.cancelLine) || 0), 0);
                  const gColl = expandedBills.reduce((s, b) => s + (b.collectedAmount || 0), 0);
                  const gDiff = gAmt - gLine - gColl;
                  return (
                    <tr className="bg-slate-900 text-white border-t-2 border-slate-600">
                      <td colSpan={5} className="px-2 py-1.5 text-[10px] font-black">GRAND TOTAL — {driverWiseData.length} DRIVERS ({expandedBills.length} BILLS)</td>
                      <td className="px-1.5 py-1.5 text-right font-black">₹{gAmt.toLocaleString('en-IN')}</td>
                      <td className="px-1.5 py-1.5 text-center">—</td>
                      <td className="px-1.5 py-1.5 text-center">—</td>
                      <td className="px-1.5 py-1.5 text-right font-black text-emerald-400">{gCash > 0 ? `₹${gCash.toLocaleString('en-IN')}` : '—'}</td>
                      <td className="px-1.5 py-1.5 text-right font-black text-blue-400">{gGpay > 0 ? `₹${gGpay.toLocaleString('en-IN')}` : '—'}</td>
                      <td className="px-1.5 py-1.5 text-right font-black text-violet-400">{gChq > 0 ? `₹${gChq.toLocaleString('en-IN')}` : '—'}</td>
                      <td className="px-1.5 py-1.5 text-right font-black text-amber-400">{gLine > 0 ? `₹${gLine.toLocaleString('en-IN')}` : '—'}</td>
                      <td className={cn("px-1.5 py-1.5 text-right font-black", gDiff > 0 ? "text-red-400" : gDiff < 0 ? "text-blue-400" : "text-white/50")}>₹{gDiff.toLocaleString('en-IN')}</td>
                      <td className="px-1.5 py-1.5 text-center">—</td>
                    </tr>
                  );
                })()}
              </tbody>
            </table>
          </div>
        )}

        {hasSelection && (viewMode === 'detail' || viewMode === 'partywise' || viewMode === 'salespersonwise') && (
          <div className="bg-card border border-border/40 rounded-lg overflow-hidden w-full my-2 shadow-sm">
            {/* Top Pagination Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 bg-muted/60 border-b border-border text-xs font-black uppercase tracking-tight">
              <div className="flex items-center gap-2 text-[11px] text-foreground">
                <span>
                  Showing{' '}
                  <span className="text-primary font-black">
                    {deferredExpandedBills.length > 0 ? (pageSize > 0 ? (currentPage - 1) * pageSize + 1 : 1) : 0}
                  </span>{' '}
                  -{' '}
                  <span className="text-primary font-black">
                    {pageSize > 0 ? Math.min(currentPage * pageSize, deferredExpandedBills.length) : deferredExpandedBills.length}
                  </span>{' '}
                  of <span className="text-indigo-600 font-black">{deferredExpandedBills.length}</span> bills
                </span>
                {pageSize > 0 && totalPages > 1 && (
                  <span className="text-muted-foreground font-normal text-[10px]">
                    (Page {currentPage} of {totalPages})
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground">Per Page:</span>
                <select
                  value={pageSize}
                  onChange={e => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="h-6 px-1.5 bg-background border border-border rounded text-[11px] font-black outline-none cursor-pointer"
                >
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                  <option value={500}>500</option>
                  <option value={0}>All ({deferredExpandedBills.length})</option>
                </select>

                {pageSize > 0 && totalPages > 1 && (
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={currentPage <= 1}
                      onClick={() => setCurrentPage(1)}
                      className="h-6 px-1.5 text-[9px] font-black"
                    >
                      «
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={currentPage <= 1}
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      className="h-6 px-2 text-[9px] font-black"
                    >
                      Prev
                    </Button>
                    <span className="px-1 text-[11px] font-black">
                      {currentPage}/{totalPages}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={currentPage >= totalPages}
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      className="h-6 px-2 text-[9px] font-black"
                    >
                      Next
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={currentPage >= totalPages}
                      onClick={() => setCurrentPage(totalPages)}
                      className="h-6 px-1.5 text-[9px] font-black"
                    >
                      »
                    </Button>
                  </div>
                )}
              </div>
            </div>

            <div className="overflow-x-auto no-scrollbar w-full">
              <Table className="w-full border-separate border-spacing-y-[2px] table-fixed" style={{ width: Object.values(columnWidths).reduce((a, b) => a + b, 0) }}>
                <TableHeader className="bg-muted/50">
                  <TableRow className="border-b border-border">
                    {Object.keys(colConfig).map(key => {
                      const cfg = colConfig[key];
                      return (
                        <TableHead key={key} style={{ width: columnWidths[key] }} onClick={() => handleSort(cfg.sortKey as any)} className={cn("text-[10px] font-black uppercase px-1 py-1 h-auto relative cursor-pointer hover:bg-muted select-none", cfg.right && "text-right", cfg.center && "text-center")}>
                          {cfg.label} <SortIcon field={cfg.sortKey} />
                          <ResizeHandle colKey={key} />
                        </TableHead>
                      );
                    })}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayedBills.map((b, i) => {
                    const rowIdx   = pageSize > 0 ? (currentPage - 1) * pageSize + i + 1 : i + 1;
                    const _eff     = getEffAmt(b);
                    const cash     = _eff.cash;
                    const gpay     = _eff.upi;
                    const chq      = _eff.chq;
                    const collected = b.collectedAmount || 0;
                    const lineCutAmt = (b.lineCutAmt || 0) || Number(b.cancelLine) || 0;
                    // DIFF = NET AMOUNT - LINE CUT AMOUNT - REC AMOUNT
                    const effectiveDiff = b.billNetAmt - lineCutAmt - collected;
                    const isFBR       = b.paymentMode === 'FBR' || b.paymentMode === 'Cancel';
                    const isCredit    = b.paymentMode === 'Credit' && collected === 0;
                    const isDelPend   = b.paymentMode === 'Del Pending' && collected === 0;
                    const isPending   = isDelPend;
                    const isPaid      = collected > 0 && Math.abs(effectiveDiff) <= 1 && !isFBR;
                    const isAsgnd     = !isPaid && !isFBR && !isCredit && !isPending && !!b.driverName && b.deliveryDate === todayDisplay;
                    const isMatchedRow = String(b.discrepancyReason || (b as any).discrepancy_reason || (b as any).discrepancy || '').toUpperCase().includes('MATCHED');
                    return (
                      <TableRow key={`${b.billNo}_${i}`} onClick={() => setEditBill(b)} className={cn("font-black cursor-pointer transition-colors",
                        isFBR     ? "bg-red-200 hover:bg-red-300/60" :
                        isCredit  ? "bg-green-200 hover:bg-green-300/60" :
                        isPending ? "bg-yellow-100 hover:bg-yellow-200/60" :
                        "bg-white hover:bg-primary/5",
                        isAsgnd && "text-red-600"
                      )}>
                        <TableCell className="text-[12px] px-1 py-0.5 h-auto truncate">{rowIdx}</TableCell>
                        <TableCell className="text-[12px] px-1 py-0.5 h-auto truncate">{b.date || '-'}</TableCell>
                        <TableCell className={cn("text-[12px] px-1 py-0.5 h-auto truncate font-black", isCredit && "text-green-800", isFBR && "text-amber-700", isAsgnd && "text-red-600")}>{stripGST(getDisplayBillNo(b))}</TableCell>
                        <TableCell className="text-[12px] px-1 py-0.5 h-auto truncate font-black">
                          <span className={cn(
                            "truncate inline-block px-1 py-0.5 rounded font-black",
                            isGreenParty(b.partyCode, b.partyName) ? "bg-emerald-300 text-emerald-950 dark:bg-emerald-800 dark:text-emerald-100 border border-emerald-500 shadow-sm" : ""
                          )}>
                            {b.partyName || '-'}
                          </span>
                        </TableCell>
                        <TableCell className="text-[12px] px-1 py-0.5 h-auto truncate text-primary/70">{b.salespersonName || '—'}</TableCell>
                        <TableCell className="text-[12px] px-1 py-0.5 h-auto truncate">{b.driverName || '-'}</TableCell>
                        <TableCell className="text-[12px] px-1 py-0.5 h-auto text-right truncate">₹{b.billNetAmt.toLocaleString('en-IN')}</TableCell>
                        <TableCell className={cn("text-[12px] px-1 py-0.5 h-auto truncate font-black", isAsgnd ? "text-red-600" : "text-orange-600")}>{collected > 0 && b.paymentDate ? b.paymentDate : '-'}</TableCell>
                        <TableCell className="text-[12px] px-1 py-0.5 h-auto truncate text-center text-indigo-600 font-black">{b.deliveryDate || '-'}</TableCell>
                        <TableCell className={cn("text-[12px] px-1 py-0.5 h-auto text-right", isAsgnd ? "text-red-600" : "text-emerald-600", isMatchedRow && cash > 0 && "bg-pink-100 dark:bg-pink-950/80 text-pink-950 dark:text-pink-100 border border-pink-300 dark:border-pink-700 rounded-sm font-extrabold")}>{isCredit ? '—' : `₹${cash.toLocaleString('en-IN')}`}</TableCell>
                        <TableCell className={cn("text-[12px] px-1 py-0.5 h-auto text-right", isAsgnd ? "text-red-600" : "text-blue-600", isMatchedRow && gpay > 0 && "bg-pink-100 dark:bg-pink-950/80 text-pink-950 dark:text-pink-100 border border-pink-300 dark:border-pink-700 rounded-sm font-extrabold")}>{isCredit ? '—' : `₹${gpay.toLocaleString('en-IN')}`}</TableCell>
                        <TableCell className={cn("text-[12px] px-1 py-0.5 h-auto text-right", isAsgnd ? "text-red-600" : "text-violet-600", isMatchedRow && chq > 0 && "bg-pink-100 dark:bg-pink-950/80 text-pink-950 dark:text-pink-100 border border-pink-300 dark:border-pink-700 rounded-sm font-extrabold")}>{isCredit ? '—' : `₹${chq.toLocaleString('en-IN')}`}</TableCell>
                        <TableCell className={cn("text-[12px] px-1 py-0.5 h-auto text-right", isAsgnd ? "text-red-600" : "text-amber-600")}>₹{lineCutAmt.toLocaleString('en-IN')}</TableCell>
                        <TableCell className={cn("text-[12px] px-1 py-0.5 h-auto text-right truncate font-black",
                          isCredit ? "text-green-700" :
                          isDelPend ? "text-yellow-600" :
                          isAsgnd ? "text-red-600" :
                          effectiveDiff > 0 ? "text-destructive" : effectiveDiff < 0 ? "text-blue-700" : "text-muted-foreground/30"
                        )}>
                          {isCredit ? 'CREDIT' : isDelPend ? 'NOT DELIVERY' : `₹${effectiveDiff.toLocaleString('en-IN')}`}
                        </TableCell>
                        <TableCell className="text-[11px] px-1 py-0.5 h-auto text-center truncate font-black">
                          {(() => {
                            const label = isFBR ? 'FBR' : isCredit ? 'CREDIT' : isDelPend ? 'DEL PENDING' : isPaid ? 'PAID' : isAsgnd ? 'ASGND' : 'UNPAID';
                            const cls = isFBR ? 'bg-red-500 text-white' :
                                        isCredit ? 'bg-green-500 text-white' :
                                        isDelPend ? 'bg-yellow-400 text-black' :
                                        isPaid ? 'bg-emerald-500 text-white' :
                                        isAsgnd ? 'bg-red-100 text-red-700' :
                                        'bg-muted text-muted-foreground';
                            return <span className={cn('px-1.5 py-0.5 rounded uppercase tracking-tight text-[10px]', cls)}>{label}</span>;
                          })()}
                        </TableCell>
                        <TableCell className="text-[12px] px-1 py-0.5 h-auto truncate font-black text-orange-600">{b.discrepancyReason || '—'}</TableCell>
                        <TableCell className="text-[12px] px-1 py-0.5 h-auto truncate font-black text-violet-600">
                          {b.paymentTime && !/^\d{2}:\d{2}$/.test(b.paymentTime) ? b.paymentTime : '—'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {expandedBills.length > 0 && (() => {
                    const tCash = expandedBills.reduce((s, b) => s + getEffAmt(b).cash, 0);
                    const tGpay = expandedBills.reduce((s, b) => s + getEffAmt(b).upi,  0);
                    const tChq  = expandedBills.reduce((s, b) => s + getEffAmt(b).chq,  0);
                    const tAmt  = expandedBills.reduce((s, b) => s + (b.billNetAmt || 0), 0);
                    const tLine = expandedBills.reduce((s, b) => s + ((b.lineCutAmt || 0) || Number(b.cancelLine) || 0), 0);
                    const tColl = expandedBills.reduce((s, b) => s + (b.collectedAmount || 0), 0);
                    const tDiff = tAmt - tLine - tColl;
                    return (
                      <TableRow className="bg-primary text-primary-foreground font-black sticky bottom-0">
                        <TableCell className="text-[12px] px-1 py-1 h-auto" colSpan={6}>TOTAL ({expandedBills.length})</TableCell>
                        <TableCell className="text-[12px] px-1 py-1 h-auto text-right">₹{tAmt.toLocaleString('en-IN')}</TableCell>
                        <TableCell className="text-[12px] px-1 py-1 h-auto"></TableCell>
                        <TableCell className="text-[12px] px-1 py-1 h-auto"></TableCell>
                        <TableCell className="text-[12px] px-1 py-1 h-auto text-right">₹{tCash.toLocaleString('en-IN')}</TableCell>
                        <TableCell className="text-[12px] px-1 py-1 h-auto text-right">₹{tGpay.toLocaleString('en-IN')}</TableCell>
                        <TableCell className="text-[12px] px-1 py-1 h-auto text-right">₹{tChq.toLocaleString('en-IN')}</TableCell>
                        <TableCell className="text-[12px] px-1 py-1 h-auto text-right">₹{tLine.toLocaleString('en-IN')}</TableCell>
                        <TableCell className="text-[12px] px-1 py-1 h-auto text-right">₹{tDiff.toLocaleString('en-IN')}</TableCell>
                        <TableCell className="text-[11px] px-1 py-1 h-auto text-center">—</TableCell>
                        <TableCell className="text-[12px] px-1 py-1 h-auto"></TableCell>
                        <TableCell className="text-[12px] px-1 py-1 h-auto"></TableCell>
                      </TableRow>
                    );
                  })()}
                </TableBody>
              </Table>
            </div>

            {/* Bottom Pagination Bar */}
            {pageSize > 0 && totalPages > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 bg-muted/40 border-t border-border text-xs font-black uppercase">
                <span className="text-[10px] text-muted-foreground">
                  Page {currentPage} of {totalPages} ({deferredExpandedBills.length} total bills)
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage(1)}
                    className="h-6 px-1.5 text-[9px] font-black"
                  >
                    « First
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    className="h-6 px-2 text-[9px] font-black"
                  >
                    Prev
                  </Button>
                  <span className="px-2 text-[11px] font-black text-primary">
                    {currentPage} / {totalPages}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    className="h-6 px-2 text-[9px] font-black"
                  >
                    Next
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage(totalPages)}
                    className="h-6 px-1.5 text-[9px] font-black"
                  >
                    Last »
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}


        {/* Audit Boxes — only when a filter is selected */}
        {hasSelection && <div className={cn("w-full mt-0", driver ? "grid grid-cols-2" : "")}>
          <div className={cn("bg-card border-t border-border overflow-hidden", driver && "border-r")}>
             <div className="bg-muted/50 px-2 py-0.5 border-b border-border flex items-center justify-between"><h3 className="text-[12px] font-black text-destructive uppercase tracking-widest">PAYMENT DETAILS</h3><span className="text-[12px] font-black text-destructive">RS</span></div>
             <table className="w-full text-[12px] font-black uppercase">
               <tbody>
                 <tr className="border-b border-border/50"><td className="px-1 py-0.5">TOTAL BILL AMT:-</td><td className="px-1 py-0.5 text-right">{totals.billAmt.toLocaleString('en-IN')}</td></tr>
                 <tr className="border-b border-border/50"><td className="px-1 py-0.5">TOTAL REC CASH:-</td><td className="px-1 py-0.5 text-right">{totals.cash.toLocaleString('en-IN')}</td></tr>
                 <tr className="border-b border-border/50"><td className="px-1 py-0.5">TOTAL REC GPAY:-</td><td className="px-1 py-0.5 text-right">{totals.upi.toLocaleString('en-IN')}</td></tr>
                 <tr className="border-b border-border/50"><td className="px-1 py-0.5">REC CHQ AMT:-</td><td className="px-1 py-0.5 text-right">{totals.chq.toLocaleString('en-IN')}</td></tr>
                 <tr className="border-b border-border/50"><td className="px-1 py-0.5">LINE CUT AMT:-</td><td className="px-1 py-0.5 text-right">{totals.lineCut.toLocaleString('en-IN')}</td></tr>
                 <tr className="border-b border-border/50"><td className="px-1 py-0.5">BAKI PAYMENT BILL AMT:-</td><td className="px-1 py-0.5 text-right">{totals.baki.toLocaleString('en-IN')}</td></tr>
                 <tr className="border-b border-border/50"><td className="px-1 py-0.5">FBR BILL AMT:-</td><td className="px-1 py-0.5 text-right">{totals.fbr.toLocaleString('en-IN')}</td></tr>
                 <tr className="border-b border-border/50"><td className="px-1 py-0.5">DEL PENDING AMT:-</td><td className="px-1 py-0.5 text-right">{totals.delPending.toLocaleString('en-IN')}</td></tr>
                 <tr className="bg-destructive/5"><td className="px-1 py-0.5 text-destructive font-black">DIFF :-</td><td className="px-1 py-0.5 text-right text-destructive font-black">{totals.finalDiff.toLocaleString('en-IN')}</td></tr>
               </tbody>
             </table>
          </div>
          {driver && <div className="bg-card border-t border-border overflow-hidden">
             <div className="bg-muted/50 px-2 py-0.5 border-b border-border flex items-center justify-between"><h3 className="text-[12px] font-black text-foreground uppercase tracking-widest">CALCUTELOR</h3><span className="text-[12px] font-black">RS.</span></div>
             <table className="w-full text-[12px] font-black uppercase">
               <tbody>
                 <tr className="border-b border-border/50"><td className="px-1 py-0.5 text-muted-foreground">500* {breakdownAgg.n500}</td><td className="px-1 py-0.5 text-right">{(breakdownAgg.n500 * 500).toLocaleString('en-IN')}</td></tr>
                 <tr className="border-b border-border/50"><td className="px-1 py-0.5 text-muted-foreground">200* {breakdownAgg.n200}</td><td className="px-1 py-0.5 text-right">{(breakdownAgg.n200 * 200).toLocaleString('en-IN')}</td></tr>
                 <tr className="border-b border-border/50"><td className="px-1 py-0.5 text-muted-foreground">100* {breakdownAgg.n100}</td><td className="px-1 py-0.5 text-right">{(breakdownAgg.n100 * 100).toLocaleString('en-IN')}</td></tr>
                 <tr className="border-b border-border/50"><td className="px-1 py-0.5 text-muted-foreground">50* {breakdownAgg.n50}</td><td className="px-1 py-0.5 text-right">{(breakdownAgg.n50 * 50).toLocaleString('en-IN')}</td></tr>
                 <tr className="border-b border-border/50"><td className="px-1 py-0.5 text-muted-foreground">20* {breakdownAgg.n20}</td><td className="px-1 py-0.5 text-right">{(breakdownAgg.n20 * 20).toLocaleString('en-IN')}</td></tr>
                 <tr className="border-b border-border/50"><td className="px-1 py-0.5 text-muted-foreground">10* {breakdownAgg.n10}</td><td className="px-1 py-0.5 text-right">{(breakdownAgg.n10 * 10).toLocaleString('en-IN')}</td></tr>
                 <tr className="border-b border-border/50"><td className="px-1 py-0.5 text-muted-foreground">COIN</td><td className="px-1 py-0.5 text-right">{breakdownAgg.coins.toLocaleString('en-IN')}</td></tr>
                 <tr className="bg-muted/10"><td className="px-1 py-0.5 text-muted-foreground font-black">TOTAL</td><td className="px-1 py-0.5 text-right text-destructive font-black">{calcTotal.toLocaleString('en-IN')}</td></tr>
               </tbody>
             </table>
          </div>}
        </div>}
      </div>
    </div>

    {editBill && (
      <BillEditModal
        bill={editBill}
        banks={banks}
        onClose={() => setEditBill(null)}
        onSaved={() => setEditBill(null)}
      />
    )}

    <SalespersonAutoDispatchModal
      isOpen={showAutoDispatch}
      onClose={() => setShowAutoDispatch(false)}
      bills={bills}
    />

    {/* ── MOC Commission Picker Modal for Reports ── */}
    {showMocPicker && (
      <div className="fixed inset-0 bg-black/60 z-[280] flex items-center justify-center p-4 backdrop-blur-xs">
        <div className="bg-card rounded-3xl p-5 w-full max-w-md shadow-2xl border-2 border-emerald-500/40 animate-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between pb-3 border-b border-border mb-4">
            <div>
              <h3 className="text-base font-black uppercase text-emerald-700 flex items-center gap-1.5">
                <span className="w-6 h-6 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center text-xs font-black">₹</span>
                Filter MOC Commission
              </h3>
              <p className="text-[10px] font-bold text-muted-foreground uppercase">
                Select MOC code or ALL MOC to filter reports
              </p>
            </div>
            <button
              onClick={() => setShowMocPicker(false)}
              className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground font-black"
            >
              ✕
            </button>
          </div>

          <div className="mb-3">
            <button
              onClick={() => {
                setSalesperson('MOC');
                setShowMocPicker(false);
              }}
              className={cn(
                "w-full py-2.5 rounded-xl border-2 font-black text-xs uppercase transition-all shadow-xs",
                (salesperson || '').toUpperCase() === 'MOC'
                  ? "bg-emerald-600 text-white border-emerald-700 shadow-md"
                  : "bg-emerald-100/60 border-emerald-300 text-emerald-950 hover:bg-emerald-500 hover:text-white"
              )}
            >
              ★ ALL MOC ENTRIES
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-[280px] overflow-y-auto pr-1">
            {commissionMocs.map(moc => {
              const isSelected = (salesperson || '').toUpperCase() === (moc?.code || '').toUpperCase();
              return (
                <button
                  key={moc.id}
                  onClick={() => {
                    setSalesperson(moc.code);
                    setShowMocPicker(false);
                  }}
                  className={cn(
                    "flex flex-col items-center justify-center py-3.5 px-2 rounded-2xl border-2 transition-all text-center group shadow-xs active:scale-95",
                    isSelected
                      ? "bg-emerald-600 text-white border-emerald-700 shadow-md"
                      : "border-emerald-300 bg-emerald-50/50 hover:bg-emerald-500 hover:text-white hover:border-emerald-600 text-emerald-950"
                  )}
                >
                  <span className={cn("text-base font-black uppercase", isSelected ? "text-white" : "text-emerald-950 group-hover:text-white")}>
                    {moc.code}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-[10px] font-bold text-muted-foreground uppercase">
            <span>Admin settings se naye MOC add/manage karein</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowMocPicker(false)}
              className="rounded-xl text-[10px] font-black uppercase h-8 px-3"
            >
              Close
            </Button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
