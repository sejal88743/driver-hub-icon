
import { useState, useMemo, useEffect, useRef } from "react";
import { Bill, CashBreakdown, saveSummaries, getSummaries, DriverDailySummary, getDrivers } from "@/lib/billStore";
import { getRole } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { ChevronUp, ChevronDown, Calculator, X, Check, Save, Square, FileText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isGreenParty } from "@/lib/greenParties";
import { getDisplayBillNo } from "@/lib/commissionMoc";

type Props = {
  bills: Bill[];
  selectedDriver: string;
  displayDate: string;
  onSelectBill: (billNo: string) => void;
  ownerSavedBillNos?: string[];
  isDriverMode?: boolean;
  /** When true, show all-bills (owner) view instead of driver-assignment view */
  selectedDriverIsOwnerOrUser?: boolean;
  /** When set, filter owner/user view to only show bills entered by this person (paymentTime match) */
  enteredByFilter?: string;
};

type SortConfig = {
  key: keyof Bill | 'diff';
  direction: 'asc' | 'desc';
};

function parseDDMMYYYY(d: string): number {
  const [dd, mm, yyyy] = d.split('/');
  if (!dd || !mm || !yyyy) return 0;
  return Number(`${yyyy}${mm}${dd}`);
}

export default function DriverDayTable({ bills, selectedDriver, displayDate, onSelectBill, ownerSavedBillNos, isDriverMode, selectedDriverIsOwnerOrUser, enteredByFilter }: Props) {
  const isOwnerRole = (() => { try { return getRole() === 'owner'; } catch { return false; } })();
  const [sort, setSort] = useState<SortConfig>({ key: 'paymentDate', direction: 'desc' });

  useEffect(() => {
    setSort({ key: 'paymentDate', direction: 'desc' });
  }, [selectedDriver]);
  const [showCalculator, setShowCalculator] = useState(false);
  const [calcSaved, setCalcSaved] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());

  function toggleRow(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    setSelectedRows(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  const [breakdown, setBreakdown] = useState<CashBreakdown>({
    n500: 0, n200: 0, n100: 0, n50: 0, n20: 0, n10: 0, coins: 0
  });

  // Subscribe to store updates so saved/loaded summaries reflect immediately
  const [liveSummaries, setLiveSummaries] = useState<ReturnType<typeof getSummaries>>(getSummaries);

  useEffect(() => {
    const handler = () => setLiveSummaries(getSummaries());
    window.addEventListener('bill-store-update', handler);
    return () => window.removeEventListener('bill-store-update', handler);
  }, []);

  const existingSummary = liveSummaries.find(s => s.driverName === selectedDriver && s.date === displayDate);

  useEffect(() => {
    if (existingSummary?.cashBreakdown) {
      setBreakdown(existingSummary.cashBreakdown);
    } else {
      setBreakdown({ n500: 0, n200: 0, n100: 0, n50: 0, n20: 0, n10: 0, coins: 0 });
    }
  }, [selectedDriver, displayDate]);

  // Auto-save breakdown whenever it changes (debounced 600ms) — driver+date keyed, never wiped
  const breakdownRef = useRef(breakdown);
  breakdownRef.current = breakdown;
  useEffect(() => {
    const hasAny = Object.values(breakdown).some(v => (v || 0) > 0);
    if (!hasAny) return; // don't auto-save if all zeros
    const timer = setTimeout(() => {
      const allSummaries = getSummaries();
      const currentIdx = allSummaries.findIndex(s => s.driverName === selectedDriver && s.date === displayDate);
      const stableId = `drv_${selectedDriver.replace(/[^a-zA-Z0-9]/g, '_')}_${displayDate.replace(/[^a-zA-Z0-9]/g, '_')}`;
      const summary: DriverDailySummary = currentIdx !== -1
        ? { ...allSummaries[currentIdx], cashBreakdown: breakdownRef.current }
        : { id: stableId, driverName: selectedDriver, date: displayDate, totalBillCount: 0, totalAmount: 0, cashBreakdown: breakdownRef.current };
      if (currentIdx !== -1) allSummaries[currentIdx] = summary;
      else allSummaries.push(summary);
      saveSummaries(allSummaries);
      setCalcSaved(true);
      setTimeout(() => setCalcSaved(false), 1500);
    }, 600);
    return () => clearTimeout(timer);
  }, [breakdown, selectedDriver, displayDate]);

  // Bills that appear here only because of a historical Del Pending snapshot
  // (driver + date matched a record in del_pending_history). They must render as DEL PENDING
  // regardless of their current paymentMode.
  const snapshotBillNos = useMemo(() => {
    const s = new Set<string>();
    if (selectedDriver === 'OWNER') return s;
    const nameLower = selectedDriver.toLowerCase().trim();
    for (const b of bills) {
      if (!Array.isArray(b.delPendingHistory)) continue;
      const hit = b.delPendingHistory.some(h => h.driverName?.toLowerCase().trim() === nameLower && h.deliveryDate === displayDate);
      if (hit) s.add(b.billNo);
    }
    return s;
  }, [bills, selectedDriver, displayDate]);

  const driverBillsByName = useMemo(() => {
    const map = new Map<string, Bill[]>();
    for (const b of bills) {
      if (b.deliveryDate !== displayDate || !b.driverName) continue;
      const name = (b.driverName || '').trim();
      if (!name) continue;
      if (!map.has(name)) map.set(name, []);
      map.get(name)!.push(b);
    }
    return map;
  }, [bills, displayDate]);

  const rows = useMemo(() => {
    const allDrivers = getDrivers();
    const selUpper = (selectedDriver || '').trim().toUpperCase();
    const matchedDriver = allDrivers.find(drv => (drv.name || '').trim().toUpperCase() === selUpper);
    const isOwner = selUpper === 'OWNER' || matchedDriver?.role === 'owner';
    const isStaffUser = !isOwner && (
      Boolean(selectedDriverIsOwnerOrUser) ||
      matchedDriver?.role === 'user' ||
      selUpper === 'PRATIXA' ||
      selUpper === 'KHUSHI' ||
      selUpper === 'TARACHAND' ||
      selUpper === 'SEJAL'
    );

    let result: Bill[];
    if (isOwner) {
      // OWNER view: Show all bills where payment was received / entered by OWNER on displayDate
      // Driver-assigned bills (deliveryDate = selectedDate) must NEVER appear here unless received by OWNER
      const seenOwnerBills = new Set<string>();
      result = bills.filter(b => {
        if (!b.billNo) return false;
        const isMoc = (b.billNo || '').toUpperCase().startsWith('MOC') || b.collectionCode === 'MOC' || b.salespersonName === 'MOC';
        const normNo = isMoc ? (b.id || b.billNo || '') : (b.billNo || '').trim().toUpperCase();
        if (seenOwnerBills.has(normNo)) return false;

        const eff = getEffectiveAmounts(b);
        const collected = Number(b.collectedAmount) || 0;
        const _bm = (b.paymentMode || '').toLowerCase();
        const hasMoneyRec = eff.cash > 0 || eff.upi > 0 || eff.chq > 0 || collected > 0;
        const isFBR = (_bm === 'fbr' || _bm === 'cancel');
        const isCredit = _bm === 'credit';
        const isPaid = _bm === 'paid' || _bm === 'cash' || _bm === 'upi' || _bm === 'cheque' || _bm === 'split';

        // Assigned bills / uncollected bills belong only to the driver's table — never in owner view
        if (_bm === 'assigned') return false;
        if (!hasMoneyRec && !isFBR && !isCredit && !isPaid) return false;
        // If bill was assigned to a driver on deliveryDate = displayDate, do not show in owner view
        if (b.deliveryDate === displayDate && b.driverName && b.driverName.trim().toUpperCase() !== 'OWNER') return false;
        // If bill does not have paymentDate, do not show in owner view
        if (!b.paymentDate) return false;

        const isSavedByOwnerList = Array.isArray(ownerSavedBillNos) && (ownerSavedBillNos.includes(b.billNo) || ownerSavedBillNos.includes(b.id));
        const pTime = (b.paymentTime || '').trim().toUpperCase();
        const dName = (b.driverName || '').trim().toUpperCase();

        // Check if payment/received date matches displayDate
        let matchesDate = b.paymentDate === displayDate;
        if (pTime.startsWith('OWNER:') && pTime.includes(':')) {
          const entryDate = pTime.split(':')[1];
          if (entryDate === displayDate) matchesDate = true;
        }
        if (isSavedByOwnerList && b.paymentDate === displayDate) {
          matchesDate = true;
        }

        if (!matchesDate) return false;

        // Exclude payments made by other recognized staff users (e.g. Khushi, Tarachand, Pratixa)
        const otherStaffUsers = allDrivers.filter(d => d.role === 'user' && (d.name || '').trim().toUpperCase() !== 'OWNER');
        const isOtherUserPayment = otherStaffUsers.some(d => {
          const uName = (d.name || '').trim().toUpperCase();
          return uName && (pTime === uName || pTime.startsWith(uName + ':') || pTime.startsWith(uName + ' '));
        });
        if (isOtherUserPayment) return false;

        const isOwnerPayment = (
          pTime === 'OWNER' ||
          pTime.startsWith('OWNER:') ||
          pTime.startsWith('OWNER ') ||
          isSavedByOwnerList ||
          dName === 'OWNER' ||
          !pTime ||
          /^\d{1,2}:\d{2}/.test(pTime) // regular timestamp e.g. 14:30
        );

        if (isOwnerPayment) {
          seenOwnerBills.add(normNo);
          return true;
        }
        return false;
      });
    } else if (isStaffUser) {
      // Staff user selected in dropdown (User-name wise): Show only bills genuinely entered/received by this specific user on displayDate
      // Driver-assigned bills (deliveryDate = selectedDate) must NEVER appear in user table
      const isPratixa = selUpper === 'PRATIXA';
      const todayDMY = (() => {
        const d = new Date();
        return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
      })();

      const seenUserBills = new Set<string>();
      result = bills.filter(b => {
        if (!b.billNo) return false;
        const isMoc = (b.billNo || '').toUpperCase().startsWith('MOC') || b.collectionCode === 'MOC' || b.salespersonName === 'MOC';
        const normNo = isMoc ? (b.id || b.billNo || '') : (b.billNo || '').trim().toUpperCase();
        if (seenUserBills.has(normNo)) return false;

        const eff = getEffectiveAmounts(b);
        const collected = Number(b.collectedAmount) || 0;
        const _bm = (b.paymentMode || '').toLowerCase();
        const hasMoneyRec = eff.cash > 0 || eff.upi > 0 || eff.chq > 0 || collected > 0;
        const isFBR = (_bm === 'fbr' || _bm === 'cancel');
        const isCredit = _bm === 'credit';
        const isPaid = _bm === 'paid' || _bm === 'cash' || _bm === 'upi' || _bm === 'cheque' || _bm === 'split';

        // Assigned bills belong only to the driver's table — never in owner/user view
        if (_bm === 'assigned') return false;
        if (!hasMoneyRec && !isFBR && !isCredit && !isPaid) return false;
        // SAME DEL DATE WALA KOI BHI ENTRY USER TABLE ME SHOW NAHI HONA CHAHIYE
        if (b.deliveryDate === displayDate) return false;
        // If bill does not have paymentDate, do not show in user view
        if (!b.paymentDate) return false;

        const pTime = (b.paymentTime || '').trim().toUpperCase();

        // Must strictly be entered by this user (pTime === USER_NAME or starts with USER_NAME: / USER_NAME )
        const isThisUserPayment = (
          pTime === selUpper ||
          pTime.startsWith(selUpper + ':') ||
          pTime.startsWith(selUpper + ' ') ||
          (Boolean(enteredByFilter) && enteredByFilter!.trim().toUpperCase() === selUpper && (pTime === selUpper || pTime.startsWith(selUpper + ':') || pTime.startsWith(selUpper + ' ')))
        );

        if (!isThisUserPayment) return false;

        let matchesDate = b.paymentDate === displayDate;
        if (pTime.includes(':')) {
          const entryDate = pTime.split(':')[1];
          if (entryDate === displayDate) matchesDate = true;
        } else if (isPratixa && displayDate === todayDMY && pTime === 'PRATIXA') {
          matchesDate = true;
        }

        if (matchesDate) {
          seenUserBills.add(normNo);
          return true;
        }
        return false;
      });
    } else {
      // Driver view: strictly show bills assigned to this driver whose deliveryDate matches the selected date (or snapshots)
      const seenDriverBills = new Set<string>();
      result = bills.filter(b => {
        if (!b.billNo) return false;
        const isMoc = (b.billNo || '').toUpperCase().startsWith('MOC') || b.collectionCode === 'MOC' || b.salespersonName === 'MOC';
        const normNo = isMoc ? (b.id || b.billNo || '') : (b.billNo || '').trim().toUpperCase();
        if (seenDriverBills.has(normNo)) return false;

        const isMatch = ((b.driverName || '').trim().toUpperCase() === selUpper && (b.deliveryDate === displayDate || (!b.deliveryDate && b.date === displayDate))) ||
          (b.billNo && snapshotBillNos.has(b.billNo));

        if (isMatch) {
          seenDriverBills.add(normNo);
          return true;
        }
        return false;
      });
    }

    // Unified sort for OWNER, User, and driver views
    result.sort((a, b) => {
      if (sort.key === 'paymentDate') {
        const da = parseDDMMYYYY(String(a.paymentDate || ''));
        const db = parseDDMMYYYY(String(b.paymentDate || ''));
        if (da !== db) return sort.direction === 'asc' ? da - db : db - da;
        // Secondary: paymentTime
        const ta = String(a.paymentTime || '');
        const tb = String(b.paymentTime || '');
        return sort.direction === 'asc' ? ta.localeCompare(tb) : tb.localeCompare(ta);
      }
      const va = sort.key === 'diff' ? (a.billNetAmt - (a.collectedAmount || 0)) : (a[sort.key as keyof Bill] || '');
      const vb = sort.key === 'diff' ? (b.billNetAmt - (b.collectedAmount || 0)) : (b[sort.key as keyof Bill] || '');
      if (typeof va === 'number' && typeof vb === 'number') return sort.direction === 'asc' ? va - vb : vb - va;
      return sort.direction === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    });

    // ── Group bills sharing the same Cheque Number together contiguously ──
    const groupedResult: Bill[] = [];
    const processedCheques = new Set<string>();
    const placedBillKeys = new Set<string>();

    for (const bill of result) {
      const billKey = bill.id || bill.billNo;
      if (placedBillKeys.has(billKey)) continue;

      const chq = (bill.chequeNo || '').trim().toLowerCase();
      if (chq) {
        if (!processedCheques.has(chq)) {
          processedCheques.add(chq);
          const siblingBills = result.filter(b => (b.chequeNo || '').trim().toLowerCase() === chq);
          for (const sib of siblingBills) {
            const sibKey = sib.id || sib.billNo;
            if (!placedBillKeys.has(sibKey)) {
              groupedResult.push(sib);
              placedBillKeys.add(sibKey);
            }
          }
        }
      } else {
        groupedResult.push(bill);
        placedBillKeys.add(billKey);
      }
    }

    return groupedResult;
  }, [bills, selectedDriver, displayDate, sort, ownerSavedBillNos, snapshotBillNos, enteredByFilter, selectedDriverIsOwnerOrUser]);

  if (!rows.length) {
    const isStaffOrOwner = selectedDriver === 'OWNER' || Boolean(selectedDriverIsOwnerOrUser);
    return (
      <div className="p-10 text-center bg-card rounded-2xl border border-dashed border-border mt-2">
        <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
          {isStaffOrOwner ? `No Receipt Entries Found for ${displayDate}` : `No Assigned Bills Found for ${displayDate}`}
        </p>
      </div>
    );
  }

  function getEffectiveAmounts(b: Bill) {
    const cash = Number(b.cashAmount) || 0;
    const upi  = Number(b.upiAmount)  || 0;
    const chq  = Number(b.chequeAmount) || 0;
    const collected = Number(b.collectedAmount) || 0;
    if (cash === 0 && upi === 0 && chq === 0 && collected > 0) {
      const mode = (b.paymentMode || '').toLowerCase();
      if (mode === 'upi') return { cash: 0, upi: collected, chq: 0 };
      if (mode === 'cheque') return { cash: 0, upi: 0, chq: collected };
      return { cash: collected, upi: 0, chq: 0 };
    }
    return { cash, upi, chq };
  }

  // Bills excluded from totals: currently Credit, OR collected on a different date
  function isExcludedFromTotals(b: Bill): boolean {
    const _bm = (b.paymentMode || '').toLowerCase();
    if (_bm === 'credit') return true;
    if (b.paymentDate && b.paymentDate !== displayDate && (b.collectedAmount || 0) > 0) return true;
    return false;
  }

  let totals = { amt: 0, cash: 0, upi: 0, chq: 0, line: 0, fbr: 0, delPending: 0 };
  let counts = { cash: 0, upi: 0, chq: 0, line: 0, fbr: 0, delPending: 0 };
  rows.forEach(b => {
    const _bm = (b.paymentMode || '').toLowerCase();
    const eff = getEffectiveAmounts(b);
    const hasMoneyRec = eff.cash > 0 || eff.upi > 0 || eff.chq > 0 || (Number(b.collectedAmount) || 0) > 0;
    const hasRecDate = !!b.paymentDate && b.paymentDate.trim() !== '' && b.paymentDate !== '—';
    const isFBR = (_bm === 'fbr' || _bm === 'cancel') && !hasMoneyRec;
    if (isFBR) { totals.fbr += b.billNetAmt; counts.fbr++; return; }
    if ((_bm === 'del pending' || _bm === 'pending') && !hasMoneyRec) {
      counts.delPending++;
      totals.delPending += b.billNetAmt;
      return;
    }
    if (isExcludedFromTotals(b)) return;
    totals.amt += b.billNetAmt;
    if (hasMoneyRec && hasRecDate) {
      totals.cash += eff.cash;
      totals.upi  += eff.upi;
      totals.chq  += eff.chq;
      if (eff.cash > 0) counts.cash++;
      if (eff.upi  > 0) counts.upi++;
      if (eff.chq  > 0) counts.chq++;
    }
    const collected = Number(b.collectedAmount) || 0;
    const isCredit = _bm === 'credit';
    const lineCutAmt = isCredit && (b.lineCutAmt || 0) > 0
      ? (b.lineCutAmt || 0)
      : (collected > 0 && b.billNetAmt > collected
        ? (b.billNetAmt - collected)
        : (b.lineCutAmt || 0));
    if (lineCutAmt > 0) {
      totals.line += lineCutAmt;
      counts.line++;
    }
  });
  const countedBills = rows.filter(b => !isExcludedFromTotals(b)).length;

  const calcTotal = (breakdown.n500 * 500) + (breakdown.n200 * 200) + (breakdown.n100 * 100) + (breakdown.n50 * 50) + (breakdown.n20 * 20) + (breakdown.n10 * 10) + breakdown.coins;

  async function generatePDF() {
    try {
      const jsPDF = (await import('jspdf')).default;
      const autoTable = (await import('jspdf-autotable')).default;
      const doc = new jsPDF('p', 'mm', 'a4');
      const ML = 7, MR = 7, MT = 7, MB = 7, PAGE_H = 297;
      const usableW = 210 - ML - MR;

      // ── Sort Rows for PDF output strictly: ──────────────────────────────
      // 1. CREDIT
      // 2. DEL PENDING
      // 3. FBR
      // 4. CASH
      // 5. GPAY (UPI)
      // 6. CHEQUE (CHQ)
      // 7. OTHER / UNPAID
      function getPdfSortRank(b: Bill): number {
        const isSnap = snapshotBillNos.has(b.billNo);
        const _bm = (b.paymentMode || '').toLowerCase();
        const eff = getEffectiveAmounts(b);

        if (!isSnap && _bm === 'credit') return 1;                     // 1. CREDIT
        if (isSnap || _bm === 'del pending') return 2;                 // 2. DEL PENDING
        if (!isSnap && (_bm === 'fbr' || _bm === 'cancel')) return 3;   // 3. FBR
        if (!isSnap && eff.cash > 0 && eff.chq === 0) return 4;         // 4. CASH
        if (!isSnap && eff.upi > 0 && eff.chq === 0) return 5;          // 5. GPAY
        if (!isSnap && eff.chq > 0) return 6;                           // 6. CHEQUE
        return 7;                                                      // 7. OTHER
      }

      const sortedPdfRows = [...rows].sort((a, b) => {
        const rA = getPdfSortRank(a);
        const rB = getPdfSortRank(b);
        if (rA !== rB) return rA - rB;
        const chqA = (a.chequeNo || '').trim().toLowerCase();
        const chqB = (b.chequeNo || '').trim().toLowerCase();
        if (chqA && chqB && chqA !== chqB) return chqA.localeCompare(chqB);
        return a.billNo.localeCompare(b.billNo, undefined, { numeric: true });
      });

      // ── Compute stats ───────────────────────────────────────────────────
      let cashCount = 0, cashAmt = 0, gpayCount = 0, gpayAmt = 0;
      let chqCount = 0, chqAmt = 0, fbrCount = 0, fbrAmt = 0;
      let delPendCount = 0, delPendAmt = 0, lineCutTotal = 0;
      rows.forEach(b => {
        const _bm = (b.paymentMode || '').toLowerCase();
        const eff = getEffectiveAmounts(b);
        const collected = b.collectedAmount || 0;
        if (_bm === 'fbr' || _bm === 'cancel') { fbrCount++; fbrAmt += b.billNetAmt; return; }
        if (_bm === 'del pending' || _bm === 'pending') { delPendCount++; delPendAmt += b.billNetAmt; return; }
        if (eff.cash > 0) { cashCount++; cashAmt += eff.cash; }
        if (eff.upi  > 0) { gpayCount++; gpayAmt += eff.upi; }
        if (eff.chq  > 0) { chqCount++;  chqAmt  += eff.chq; }
        if (collected > 0 && b.billNetAmt > collected) lineCutTotal += b.billNetAmt - collected;
        else if ((b.lineCutAmt || 0) > 0) lineCutTotal += b.lineCutAmt!;
      });

      // ── Title ───────────────────────────────────────────────────────────
      const titleLabel = selectedDriver === 'OWNER' ? 'OWNER COLLECTION' : `DRIVER: ${selectedDriver.toUpperCase()}`;
      doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(0, 0, 0);
      doc.text(`${titleLabel}  ·  ${displayDate}`, ML, 10);
      doc.setFontSize(8); doc.setTextColor(60, 60, 60);
      doc.text(`TOTAL BILLS: ${rows.length}   BILL AMT: RS.${totals.amt.toLocaleString('en-IN')}`, ML, 15);

      // ── Coloured Summary Stats Row ──────────────────────────────────────
      autoTable(doc, {
        startY: 17,
        margin: { left: ML, right: MR },
        tableWidth: usableW,
        head: [],
        body: [[
          `CASH\n${cashCount} BILLS\nRS.${cashAmt.toLocaleString('en-IN')}`,
          `GPAY\n${gpayCount} BILLS\nRS.${gpayAmt.toLocaleString('en-IN')}`,
          `CHEQ\n${chqCount} BILLS\nRS.${chqAmt.toLocaleString('en-IN')}`,
          `FBR\n${fbrCount} BILLS\nRS.${fbrAmt.toLocaleString('en-IN')}`,
          `DEL PEND\n${delPendCount} BILLS\nRS.${delPendAmt.toLocaleString('en-IN')}`,
          `LINE CUT\nRS.${lineCutTotal.toLocaleString('en-IN')}`,
        ]],
        theme: 'grid',
        styles: { fontSize: 7, fontStyle: 'bold', halign: 'center', cellPadding: 1.4, lineWidth: 0.2, lineColor: [180, 180, 180] },
        columnStyles: {
          0: { fillColor: [210, 255, 215], textColor: [0, 120, 0] },
          1: { fillColor: [210, 228, 255], textColor: [10, 60, 200] },
          2: { fillColor: [238, 210, 255], textColor: [100, 0, 180] },
          3: { fillColor: [255, 210, 210], textColor: [180, 0, 0] },
          4: { fillColor: [255, 252, 200], textColor: [130, 90, 0] },
          5: { fillColor: [255, 230, 205], textColor: [150, 55, 0] },
        },
      });

      const tableStartY = (doc as any).lastAutoTable.finalY + 1.5;

      // ── Auto-scale: FIT ALL BILLS ON 1 SINGLE PAGE & FILL DOWN TO BOTTOM ────
      const availableH = PAGE_H - tableStartY - 6;     // 6mm bottom margin
      const totalRows = sortedPdfRows.length + 2;      // +2 for head + foot rows
      const rowBudget = availableH / totalRows;

      // Font size maximum 9px and minimum 8px; row height maximum 10px (~2.65mm).
      const fSize = Math.max(8, Math.min(9, rowBudget * 0.55));
      const maxRowH = 2.65; // 10px in mm
      const minRowH = Math.max(2.2, Math.min(maxRowH, rowBudget * 0.92));
      const cellPad = Math.max(0.1, Math.min(0.3, (minRowH - 2) / 2));

      // ── Bills Table ──────────────────────────────────────────────────────
      const tableBody = sortedPdfRows.map((b, i) => {
        const cash = Number(b.cashAmount) || 0;
        const gpay = Number(b.upiAmount)  || 0;
        const chq  = Number(b.chequeAmount) || 0;
        const collected = b.collectedAmount || 0;
        const isSnap = snapshotBillNos.has(b.billNo);
        const _bm = (b.paymentMode || '').toLowerCase();
        const isFBR    = !isSnap && (_bm === 'fbr' || _bm === 'cancel');
        const isCredit = !isSnap && _bm === 'credit';
        const isDelPend= isSnap || _bm === 'del pending';
        const isPaid   = !isSnap && !isFBR && !isDelPend && !isCredit && (collected > 0 || !!b.paymentDate);
        const status   = isFBR ? 'FBR' : isDelPend ? 'DEL PND' : isCredit ? 'CREDIT' : isPaid ? 'PAID' : 'UNPAID';
        const lineCut  = !isSnap && collected > 0 && b.billNetAmt > collected ? b.billNetAmt - collected : 0;

        const isMatched = String(b.discrepancyReason || (b as any).discrepancy_reason || (b as any).discrepancy || '').toUpperCase().includes('MATCHED');

        const gpayCell = !isSnap && gpay > 0 ? gpay.toLocaleString('en-IN') : '';
        const chqCell  = !isSnap && chq > 0 ? (b.chequeNo ? `${chq.toLocaleString('en-IN')}#${b.chequeNo}` : chq.toLocaleString('en-IN')) : '';

        return [
          i + 1,
          getDisplayBillNo(b).replace(/^GST[-/]?/i, ''),
          (b.partyName || '-').substring(0, 24),
          b.billNetAmt > 0 ? b.billNetAmt.toLocaleString('en-IN') : '-',
          !isSnap && cash > 0 ? cash.toLocaleString('en-IN') : '',
          gpayCell,
          chqCell,
          lineCut > 0 ? lineCut.toLocaleString('en-IN') : '',
          !isSnap && (cash > 0 || gpay > 0 || chq > 0 || collected > 0) ? (b.paymentDate || '-') : '-',
          status,
        ];
      });

      autoTable(doc, {
        startY: tableStartY,
        tableWidth: usableW,
        head: [['#', 'BILL NO', 'PARTY NAME', 'AMT', 'CASH', 'GPAY', 'CHQ/#NO', 'LINE CUT', 'REC DATE', 'STATUS']],
        body: tableBody,
        foot: [['', '', `TOTAL (${sortedPdfRows.length})`, totals.amt.toLocaleString('en-IN'), totals.cash.toLocaleString('en-IN'), totals.upi.toLocaleString('en-IN'), totals.chq.toLocaleString('en-IN'), totals.line.toLocaleString('en-IN'), '', '']],
        showFoot: 'lastPage',
        pageBreak: 'avoid',
        theme: 'grid',
        styles: {
          fontSize: fSize,
          font: 'helvetica',
          fontStyle: 'bold',
          cellPadding: cellPad,
          textColor: [0, 0, 0],
          minCellHeight: minRowH,
          overflow: 'ellipsize',
          lineWidth: 0.15,
        },
        headStyles: { fillColor: [79, 70, 229], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: Math.max(8, fSize) },
        footStyles: { fillColor: [79, 70, 229], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: Math.max(8, fSize) },
        bodyStyles: { textColor: [0, 0, 0], fontStyle: 'bold' },
        columnStyles: {
          0: { cellWidth: 6 },
          1: { cellWidth: 16 },
          2: { cellWidth: 40 },
          3: { halign: 'right', cellWidth: 14 },
          4: { halign: 'right', cellWidth: 14 },
          5: { halign: 'right', cellWidth: 14 },
          6: { halign: 'right', cellWidth: 30 },
          7: { halign: 'right', cellWidth: 12 },
          8: { halign: 'center', cellWidth: 18 },
          9: { halign: 'center', cellWidth: 18 },
        },
        margin: { left: ML, right: MR, top: MT, bottom: MB },
        didParseCell: (data: any) => {
          if (data.section !== 'body') return;
          const b = sortedPdfRows[data.row.index];
          if (!b) return;
          const isSnap = snapshotBillNos.has(b.billNo);
          const m = (b.paymentMode || '').toLowerCase();

          // Only CREDIT, DEL PENDING, and FBR have background colors. CASH, GPAY, CHEQ are pure WHITE by default.
          if (!isSnap && m === 'credit') {
            data.cell.styles.fillColor = [210, 255, 215]; // Green
          } else if (isSnap || m === 'del pending') {
            data.cell.styles.fillColor = [255, 252, 200]; // Amber
          } else if (!isSnap && (m === 'fbr' || m === 'cancel')) {
            data.cell.styles.fillColor = [255, 210, 210]; // Red
          } else {
            data.cell.styles.fillColor = [255, 255, 255]; // Pure White for CASH, GPAY, CHEQUE, etc.
          }

          // Highlight matched amounts with light pink background
          const isMatched = String(b.discrepancyReason || (b as any).discrepancy_reason || (b as any).discrepancy || '').toUpperCase().includes('MATCHED');
          if (isMatched) {
            const cash = Number(b.cashAmount) || 0;
            const gpay = Number(b.upiAmount) || 0;
            const chq = Number(b.chequeAmount) || 0;
            const colIdx = data.column.index;
            if (colIdx === 4 && cash > 0) {
              data.cell.styles.fillColor = [252, 231, 243]; // Light pink (#fce7f3)
            } else if (colIdx === 5 && (gpay > 0 || m.includes('gpay') || m.includes('upi'))) {
              data.cell.styles.fillColor = [252, 231, 243];
            } else if (colIdx === 6 && (chq > 0 || m.includes('cheque') || m.includes('chq'))) {
              data.cell.styles.fillColor = [252, 231, 243];
            }
          }

          // Green Party list highlight on Party Name column (col 2)
          if (data.column.index === 2 && isGreenParty(b.partyCode, b.partyName)) {
            data.cell.styles.fillColor = [187, 247, 208]; // Vibrant Emerald Light Green
            data.cell.styles.textColor = [6, 78, 59];     // Dark Emerald Text
            data.cell.styles.fontStyle = 'bold';
          }
        },
      });

      // ── Footer ────────────────────────────────────────────────────────────
      doc.setFontSize(6); doc.setFont('helvetica', 'bold'); doc.setTextColor(140);
      doc.text(`VITRATRACK  |  ${new Date().toLocaleString('en-IN')}`, ML, PAGE_H - 3);

      const safeDate = displayDate.replace(/\//g, '-');
      const safeName = selectedDriver.replace(/\s+/g, '_').toUpperCase();
      doc.save(`${safeDate}_${safeName}.pdf`);
    } catch (err) {
      console.error('PDF error', err);
      alert('PDF download failed. Please try again.');
    }
  }

  async function generateAllDriversPDF() {
    try {
      const jsPDF = (await import('jspdf')).default;
      const autoTable = (await import('jspdf-autotable')).default;
      const doc = new jsPDF('p', 'mm', 'a4');
      const ML = 10, MR = 10, MT = 10, MB = 10, PAGE_H = 297;
      const usableW = 210 - ML - MR;
      const driverNames = [...driverBillsByName.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

      if (driverNames.length === 0) {
        alert('Kisi driver par bills nahi hain.');
        return;
      }

      let currentY = 12;
      for (let idx = 0; idx < driverNames.length; idx++) {
        const driverName = driverNames[idx];
        const driverBills = driverBillsByName.get(driverName) || [];
        if (driverBills.length === 0) continue;

        const totalAmt = driverBills.reduce((sum, b) => sum + (Number(b.billNetAmt) || 0), 0);
        const totalCash = driverBills.reduce((sum, b) => {
          const cash = Number(b.cashAmount) || 0;
          const col = Number(b.collectedAmount) || 0;
          const m = (b.paymentMode || '').toLowerCase();
          if (m === 'fbr' || m === 'cancel') return sum;
          if (cash > 0) return sum + cash;
          if ((m === 'cash' || m === 'paid') && !b.upiAmount && !b.chequeAmount) return sum + col;
          return sum;
        }, 0);
        const totalGpay = driverBills.reduce((sum, b) => {
          const gpay = Number(b.upiAmount) || 0;
          const col = Number(b.collectedAmount) || 0;
          const m = (b.paymentMode || '').toLowerCase();
          if (m === 'fbr' || m === 'cancel') return sum;
          if (gpay > 0) return sum + gpay;
          if ((m === 'gpay' || m === 'upi') && !b.cashAmount && !b.chequeAmount) return sum + col;
          return sum;
        }, 0);
        const totalChq = driverBills.reduce((sum, b) => {
          const chq = Number(b.chequeAmount) || 0;
          const col = Number(b.collectedAmount) || 0;
          const m = (b.paymentMode || '').toLowerCase();
          if (m === 'fbr' || m === 'cancel') return sum;
          if (chq > 0) return sum + chq;
          if ((m === 'cheque' || m === 'chq') && !b.cashAmount && !b.upiAmount) return sum + col;
          return sum;
        }, 0);
        const totalLc = driverBills.reduce((sum, b) => sum + ((Number(b.lineCutAmt) || 0) || (Number(b.cancelLine) || 0)), 0);

        const sectionHeaderHeight = 5;
        const availableHeight = PAGE_H - MB - 4;
        if (currentY + sectionHeaderHeight + 10 > availableHeight) {
          doc.addPage();
          currentY = MT;
        }

        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0, 0, 0);
        doc.text(`DRIVER: ${driverName.toUpperCase()}  |  DATE: ${displayDate}  |  BILLS: ${driverBills.length}  |  AMT: RS.${totalAmt.toLocaleString('en-IN')}`, ML, currentY + 3);

        const tableBody = driverBills.map(b => {
          const cash = Number(b.cashAmount) || 0;
          const gpay = Number(b.upiAmount) || 0;
          const chq = Number(b.chequeAmount) || 0;
          const lc = (Number(b.lineCutAmt) || 0) || (Number(b.cancelLine) || 0);
          const isFBR = b.paymentMode === 'FBR' || b.paymentMode === 'Cancel';

          const isMatched = String(b.discrepancyReason || (b as any).discrepancy_reason || (b as any).discrepancy || '').toUpperCase().includes('MATCHED');

          const gpayCell = gpay > 0 ? gpay.toLocaleString('en-IN') : '-';
          const chqCell  = chq > 0 ? chq.toLocaleString('en-IN') : '-';

          return [
            getDisplayBillNo(b).replace(/^GST[-/]?/i, ''),
            (b.partyName || '-').substring(0, 24),
            b.billNetAmt > 0 ? b.billNetAmt.toLocaleString('en-IN') : '-',
            cash > 0 ? cash.toLocaleString('en-IN') : '-',
            gpayCell,
            chqCell,
            lc > 0 ? lc.toLocaleString('en-IN') : '-',
            isFBR ? 'FBR' : (b.paymentMode || 'UNPAID').toUpperCase(),
          ];
        });

        const tableStartY = currentY + 4.5;
        autoTable(doc, {
          startY: tableStartY,
          margin: { left: ML, right: MR, top: MT, bottom: MB },
          tableWidth: usableW,
          head: [['BILL NO', 'PARTY NAME', 'BILL AMT', 'CASH', 'GPAY', 'CHEQ', 'LINE CUT', 'STATUS']],
          body: tableBody,
          showFoot: 'lastPage',
          foot: [[
            '',
            'TOTAL',
            totalAmt > 0 ? totalAmt.toLocaleString('en-IN') : '0',
            totalCash > 0 ? totalCash.toLocaleString('en-IN') : '-',
            totalGpay > 0 ? totalGpay.toLocaleString('en-IN') : '-',
            totalChq > 0 ? totalChq.toLocaleString('en-IN') : '-',
            totalLc > 0 ? totalLc.toLocaleString('en-IN') : '-',
            '',
          ]],
          pageBreak: 'auto',
          theme: 'grid',
          styles: {
            fontSize: 9,
            font: 'helvetica',
            fontStyle: 'bold',
            cellPadding: 0.35,
            minCellHeight: 2.6,
            textColor: [0, 0, 0],
            overflow: 'ellipsize',
            lineWidth: 0.15,
          },
          headStyles: { fillColor: [79, 70, 229], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9, cellPadding: 0.35, minCellHeight: 2.6 },
          footStyles: { fillColor: [79, 70, 229], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9, cellPadding: 0.35, minCellHeight: 2.6 },
          bodyStyles: { textColor: [0, 0, 0], fontStyle: 'bold', fontSize: 9 },
          columnStyles: {
            0: { cellWidth: 20 },
            1: { cellWidth: 50 },
            2: { halign: 'right', cellWidth: 20 },
            3: { halign: 'right', cellWidth: 16 },
            4: { halign: 'right', cellWidth: 16 },
            5: { halign: 'right', cellWidth: 16 },
            6: { halign: 'right', cellWidth: 16 },
            7: { halign: 'center', cellWidth: 20 },
          },
          didParseCell: (data: any) => {
            if (data.section !== 'body') return;
            const b = driverBills[data.row.index];
            if (!b) return;
            const m = (b.paymentMode || '').toLowerCase();
            if (m === 'credit') data.cell.styles.fillColor = [210, 255, 215];
            else if (m === 'del pending') data.cell.styles.fillColor = [255, 252, 200];
            else if (m === 'fbr' || m === 'cancel') data.cell.styles.fillColor = [255, 210, 210];

            const isMatched = String(b.discrepancyReason || (b as any).discrepancy_reason || (b as any).discrepancy || '').toUpperCase().includes('MATCHED');
            if (isMatched) {
              const cash = Number(b.cashAmount) || 0;
              const gpay = Number(b.upiAmount) || 0;
              const chq = Number(b.chequeAmount) || 0;
              const colIdx = data.column.index;
              if (colIdx === 3 && cash > 0) {
                data.cell.styles.fillColor = [252, 231, 243];
              } else if (colIdx === 4 && (gpay > 0 || m.includes('gpay') || m.includes('upi'))) {
                data.cell.styles.fillColor = [252, 231, 243];
              } else if (colIdx === 5 && (chq > 0 || m.includes('cheque') || m.includes('chq'))) {
                data.cell.styles.fillColor = [252, 231, 243];
              }
            }

            if (data.column.index === 1 && isGreenParty(b.partyCode, b.partyName)) {
              data.cell.styles.fillColor = [187, 247, 208];
              data.cell.styles.textColor = [6, 78, 59];
              data.cell.styles.fontStyle = 'bold';
            }
          },
        });

        currentY = (doc as any).lastAutoTable.finalY + 2.5;
      }

      // ── MASTER SUMMARY TABLE AT THE END OF ALL DRIVERS PDF ─────────────────
      // Lists User Name, Owner, Drivers with Bill Count, Rec Cash, GPay, Cheq Amt totals
      interface PersonSummaryRow {
        name: string;
        role: string;
        billCount: number;
        cash: number;
        gpay: number;
        cheque: number;
        totalRec: number;
      }

      const summaryRows: PersonSummaryRow[] = [];

      // 1. Drivers collection summary
      for (const dName of driverNames) {
        const dBills = driverBillsByName.get(dName) || [];
        if (dBills.length === 0) continue;

        let cash = 0, gpay = 0, chq = 0;
        for (const b of dBills) {
          const c = Number(b.cashAmount) || 0;
          const g = Number(b.upiAmount) || 0;
          const cq = Number(b.chequeAmount) || 0;
          const col = Number(b.collectedAmount) || 0;
          const m = (b.paymentMode || '').toLowerCase();
          if (m === 'fbr' || m === 'cancel') continue;

          if (c > 0 || g > 0 || cq > 0) {
            cash += c;
            gpay += g;
            chq += cq;
          } else if (col > 0) {
            if (m === 'cash' || m === 'paid') cash += col;
            else if (m === 'gpay' || m === 'upi') gpay += col;
            else if (m === 'cheque' || m === 'chq') chq += col;
          }
        }

        summaryRows.push({
          name: dName.toUpperCase(),
          role: 'DRIVER',
          billCount: dBills.length,
          cash,
          gpay,
          cheque: chq,
          totalRec: cash + gpay + chq,
        });
      }

      // 2. Owner & User collections for displayDate
      const allDriversList = getDrivers();
      const usersList = allDriversList.filter(d => d.role === 'user');

      // Check Owner
      const ownerBills = bills.filter(b => {
        if (b.paymentDate !== displayDate) return false;
        const pTime = (b.paymentTime || '').trim().toUpperCase();
        const dName = (b.driverName || '').trim().toUpperCase();
        const isSaved = Array.isArray(ownerSavedBillNos) && ownerSavedBillNos.includes(b.billNo);
        return pTime === 'OWNER' || pTime.startsWith('OWNER:') || pTime.startsWith('OWNER ') || dName === 'OWNER' || isSaved;
      });

      if (ownerBills.length > 0) {
        let cash = 0, gpay = 0, chq = 0;
        for (const b of ownerBills) {
          const c = Number(b.cashAmount) || 0;
          const g = Number(b.upiAmount) || 0;
          const cq = Number(b.chequeAmount) || 0;
          const col = Number(b.collectedAmount) || 0;
          const m = (b.paymentMode || '').toLowerCase();
          if (m === 'fbr' || m === 'cancel') continue;

          if (c > 0 || g > 0 || cq > 0) {
            cash += c;
            gpay += g;
            chq += cq;
          } else if (col > 0) {
            if (m === 'cash' || m === 'paid') cash += col;
            else if (m === 'gpay' || m === 'upi') gpay += col;
            else if (m === 'cheque' || m === 'chq') chq += col;
          }
        }
        summaryRows.push({
          name: 'OWNER',
          role: 'OWNER',
          billCount: ownerBills.length,
          cash,
          gpay,
          cheque: chq,
          totalRec: cash + gpay + chq,
        });
      }

      // Check Staff Users (e.g. Pratixa, Khushi, Tarachand, Sejal)
      const staffNamesSet = new Set<string>(['PRATIXA', 'KHUSHI', 'TARACHAND', 'SEJAL']);
      for (const u of usersList) {
        if (u.name) staffNamesSet.add(u.name.trim().toUpperCase());
      }

      for (const uName of staffNamesSet) {
        const uBills = bills.filter(b => {
          if (b.paymentDate !== displayDate) return false;
          const pTime = (b.paymentTime || '').trim().toUpperCase();
          return pTime === uName || pTime.startsWith(uName + ':') || pTime.startsWith(uName + ' ');
        });

        if (uBills.length > 0) {
          let cash = 0, gpay = 0, chq = 0;
          for (const b of uBills) {
            const c = Number(b.cashAmount) || 0;
            const g = Number(b.upiAmount) || 0;
            const cq = Number(b.chequeAmount) || 0;
            const col = Number(b.collectedAmount) || 0;
            const m = (b.paymentMode || '').toLowerCase();
            if (m === 'fbr' || m === 'cancel') continue;

            if (c > 0 || g > 0 || cq > 0) {
              cash += c;
              gpay += g;
              chq += cq;
            } else if (col > 0) {
              if (m === 'cash' || m === 'paid') cash += col;
              else if (m === 'gpay' || m === 'upi') gpay += col;
              else if (m === 'cheque' || m === 'chq') chq += col;
            }
          }
          summaryRows.push({
            name: uName,
            role: 'USER',
            billCount: uBills.length,
            cash,
            gpay,
            cheque: chq,
            totalRec: cash + gpay + chq,
          });
        }
      }

      if (summaryRows.length > 0) {
        const summaryEstHeight = (summaryRows.length + 3) * 3 + 12;
        if (currentY + summaryEstHeight > PAGE_H - MB - 5) {
          doc.addPage();
          currentY = MT;
        } else {
          currentY += 3;
        }

        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0, 0, 0);
        doc.text(`COLLECTION SUMMARY (DRIVERS, USERS, OWNER)  |  DATE: ${displayDate}`, ML, currentY + 3);

        const summaryBody = summaryRows.map(r => [
          r.name,
          r.role,
          r.billCount.toLocaleString('en-IN'),
          r.cash > 0 ? r.cash.toLocaleString('en-IN') : '-',
          r.gpay > 0 ? r.gpay.toLocaleString('en-IN') : '-',
          r.cheque > 0 ? r.cheque.toLocaleString('en-IN') : '-',
          r.totalRec > 0 ? r.totalRec.toLocaleString('en-IN') : '-',
        ]);

        const gTotalBills = summaryRows.reduce((s, r) => s + r.billCount, 0);
        const gTotalCash = summaryRows.reduce((s, r) => s + r.cash, 0);
        const gTotalGpay = summaryRows.reduce((s, r) => s + r.gpay, 0);
        const gTotalCheq = summaryRows.reduce((s, r) => s + r.cheque, 0);
        const gTotalRec = summaryRows.reduce((s, r) => s + r.totalRec, 0);

        autoTable(doc, {
          startY: currentY + 4.5,
          margin: { left: ML, right: MR, top: MT, bottom: MB },
          tableWidth: usableW,
          head: [['NAME / PERSON', 'ROLE', 'TOTAL BILLS', 'TOTAL REC CASH', 'TOTAL GPAY', 'TOTAL CHEQ AMT', 'TOTAL RECEIVED']],
          body: summaryBody,
          showFoot: 'lastPage',
          foot: [[
            'GRAND TOTAL',
            '',
            gTotalBills.toLocaleString('en-IN'),
            gTotalCash > 0 ? gTotalCash.toLocaleString('en-IN') : '0',
            gTotalGpay > 0 ? gTotalGpay.toLocaleString('en-IN') : '0',
            gTotalCheq > 0 ? gTotalCheq.toLocaleString('en-IN') : '0',
            gTotalRec > 0 ? gTotalRec.toLocaleString('en-IN') : '0',
          ]],
          pageBreak: 'auto',
          theme: 'grid',
          styles: {
            fontSize: 9,
            font: 'helvetica',
            fontStyle: 'bold',
            cellPadding: 0.35,
            minCellHeight: 2.6,
            textColor: [0, 0, 0],
            overflow: 'ellipsize',
            lineWidth: 0.15,
          },
          headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9, cellPadding: 0.35, minCellHeight: 2.6 },
          footStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9, cellPadding: 0.35, minCellHeight: 2.6 },
          bodyStyles: { textColor: [0, 0, 0], fontStyle: 'bold', fontSize: 9 },
          columnStyles: {
            0: { cellWidth: 42 },
            1: { cellWidth: 22, halign: 'center' },
            2: { cellWidth: 24, halign: 'right' },
            3: { cellWidth: 26, halign: 'right' },
            4: { cellWidth: 26, halign: 'right' },
            5: { cellWidth: 26, halign: 'right' },
            6: { cellWidth: 24, halign: 'right' },
          },
          didParseCell: (data: any) => {
            if (data.section === 'body') {
              const r = summaryRows[data.row.index];
              if (!r) return;
              if (r.role === 'OWNER') {
                data.cell.styles.fillColor = [254, 243, 199];
              } else if (r.role === 'USER') {
                data.cell.styles.fillColor = [238, 242, 255];
              }
            }
          },
        });
      }

      const totalPagesCount = doc.getNumberOfPages();
      const pw = doc.internal.pageSize.getWidth();
      const ph = doc.internal.pageSize.getHeight();
      for (let pg = 1; pg <= totalPagesCount; pg++) {
        doc.setPage(pg);
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(120, 120, 120);
        doc.text(`Page ${pg} / ${totalPagesCount}`, pw / 2, ph - 4, { align: 'center' });
      }

      doc.save(`All_Drivers_${displayDate.replace(/\//g, '-')}.pdf`);
    } catch (err) {
      console.error('PDF error', err);
      alert('PDF download failed. Please try again.');
    }
  }

  const handleSaveBreakdown = () => {
    const allSummaries = getSummaries();
    const currentIdx = allSummaries.findIndex(s => s.driverName === selectedDriver && s.date === displayDate);

    // Deterministic stable ID: drv_<driver>_<date> — never random
    // This prevents duplicate rows when memory is empty on first save
    const stableId = `drv_${selectedDriver.replace(/[^a-zA-Z0-9]/g, '_')}_${displayDate.replace(/[^a-zA-Z0-9]/g, '_')}`;

    const summary: DriverDailySummary = currentIdx !== -1
      ? { ...allSummaries[currentIdx], cashBreakdown: breakdown }
      : {
          id: stableId,
          driverName: selectedDriver,
          date: displayDate,
          totalBillCount: rows.length,
          totalAmount: totals.amt,
          cashBreakdown: breakdown,
        };

    if (currentIdx !== -1) allSummaries[currentIdx] = summary;
    else allSummaries.push(summary);

    saveSummaries(allSummaries);
    setCalcSaved(true);
    setTimeout(() => setCalcSaved(false), 2000);
  };

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden mt-2 w-full">

      {/* ── Top Summary Bar ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-6 gap-px bg-border/60 border-b border-border/40">
        {([
          { label: 'TOTAL',   amt: totals.amt,  cnt: rows.length,         amtColor: 'text-primary',      cntColor: 'text-primary/70' },
          { label: 'CASH',    amt: totals.cash, cnt: counts.cash,         amtColor: 'text-emerald-600',  cntColor: 'text-emerald-500' },
          { label: 'GPAY',    amt: totals.upi,  cnt: counts.upi,          amtColor: 'text-blue-600',     cntColor: 'text-blue-500' },
          { label: 'CHQ',     amt: totals.chq,  cnt: counts.chq,          amtColor: 'text-violet-600',   cntColor: 'text-violet-500' },
          { label: 'FBR',     amt: totals.fbr,        cnt: counts.fbr,          amtColor: 'text-destructive',  cntColor: 'text-destructive/70' },
          { label: 'D.PEND',  amt: totals.delPending, cnt: counts.delPending,   amtColor: 'text-orange-600',   cntColor: 'text-orange-500' },
        ] as { label: string; amt: number | null; cnt: number; amtColor: string; cntColor: string }[]).map(({ label, amt, cnt, amtColor, cntColor }) => (
          <div key={label} className={cn("bg-card flex flex-col items-center justify-center py-1 px-0.5 gap-0", isDriverMode && "py-0.5")}>
            <span className="text-[7.5px] sm:text-[8px] font-black uppercase text-muted-foreground leading-none">{label}</span>
            {amt !== null && <span className={cn("text-[10.5px] sm:text-[11px] font-black leading-tight", amtColor)}>₹{amt.toLocaleString('en-IN')}</span>}
            <span className={cn("text-[9px] font-black leading-none", cntColor)}>{cnt}<span className="text-[7px] font-black text-muted-foreground"> bills</span></span>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto no-scrollbar">
        <table className="w-full border-collapse">
          <thead className="bg-primary text-primary-foreground text-[10px] uppercase font-black">
            <tr>
              <th className="px-1 py-1.5 text-center w-8">#</th>
              {([
                { key: 'billNo', label: 'Bill No', align: 'left' },
                { key: 'partyName', label: 'Party', align: 'left' },
                { key: 'billNetAmt', label: 'Amt', align: 'right' },
                { key: 'deliveryDate', label: 'Del. Date', align: 'center' },
                { key: 'cashAmount', label: 'Cash', align: 'right' },
                { key: 'upiAmount', label: 'GPay', align: 'right' },
                { key: 'chequeAmount', label: 'Chq', align: 'right' },
                { key: 'diff', label: 'Line Cut', align: 'right' },
                ...(!isDriverMode ? [{ key: 'paymentDate' as SortConfig['key'], label: 'Paid Date', align: 'center' }] : []),
                { key: 'paymentMode', label: 'Status', align: 'center' },
              ] as { key: SortConfig['key']; label: string; align: string }[]).map(col => (
                <th
                  key={col.key}
                  className={cn(
                    "px-2 py-1.5 cursor-pointer select-none hover:bg-primary/80 transition-colors",
                    col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                  )}
                  onClick={() =>
                    setSort(prev =>
                      prev.key === col.key
                        ? { key: col.key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
                        : { key: col.key, direction: 'asc' }
                    )
                  }
                >
                  <span className="inline-flex items-center gap-0.5">
                    {col.label}
                    {sort.key === col.key ? (
                      sort.direction === 'asc' ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />
                    ) : (
                      <span className="w-2.5 h-2.5 opacity-30">↕</span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-[10px] font-black uppercase">
            {rows.map((b, i) => {
              const isChecked = selectedRows.has(b.id);
              // A bill is a snapshot (historical Del Pending) only if it is NOT currently
              // assigned to this driver for this date. If it IS currently assigned with a
              // payment, show its actual payment status (PAID/FBR/etc.), not ASSIGNED.
              const isSnapshot = snapshotBillNos.has(b.billNo) && !(b.driverName === selectedDriver && b.deliveryDate === displayDate);
              const _bm = (b.paymentMode || '').toLowerCase();
              const eff = getEffectiveAmounts(b);
              const hasMoneyRec = eff.cash > 0 || eff.upi > 0 || eff.chq > 0 || (Number(b.collectedAmount) || 0) > 0;
              const hasRecDate = !!b.paymentDate && b.paymentDate.trim() !== '' && b.paymentDate !== '—';

              // Snapshot rows = bill was Del Pending for this driver/date but has since been
              // re-assigned to another driver. Show as ASSIGNED (not DEL PEND anymore).
              const isFBR = !isSnapshot && (_bm === 'fbr' || _bm === 'cancel') && !hasMoneyRec;
              const isDelPend = !isSnapshot && (_bm === 'del pending' || _bm === 'pending') && !hasMoneyRec;
              const isCredit = !isSnapshot && _bm === 'credit';
              const collected = b.collectedAmount || 0;
              // Bill collected on a different date (originally credit, now paid on Date B)
              const isPaidElsewhere = !isCredit && !isFBR && !isDelPend && hasRecDate && b.paymentDate !== displayDate && hasMoneyRec;
              // Strict rule: PAID ONLY WHEN Cash, GPay, Cheque received AND paymentDate present!
              const isPaid = !isSnapshot && !isFBR && !isDelPend && !isCredit && !isPaidElsewhere && hasMoneyRec && hasRecDate;
              // Today's delivery, driver assigned, no payment/FBR/credit/del-pending entry yet → ASSIGNED
              // (matches paymentMode = "Assigned" saved in Supabase; never shown/saved as Credit).
              const isAssignedToday = !isSnapshot && !isFBR && !isDelPend && !isCredit && !isPaid && !isPaidElsewhere
                && !!b.driverName && b.deliveryDate === displayDate;
              // Snapshot bill: if it has money + recDate show PAID, else ASSIGNED
              const snapshotPaid = isSnapshot && hasMoneyRec && hasRecDate;
              const statusLabel = isSnapshot ? (snapshotPaid ? 'PAID' : 'ASSIGNED') : isFBR ? 'FBR' : isDelPend ? 'DEL PEND' : isCredit ? 'CREDIT' : isPaidElsewhere ? 'REC' : isPaid ? 'PAID' : isAssignedToday ? 'ASSIGNED' : 'UNPAID';
              const statusCls = isSnapshot ? (snapshotPaid ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-500 text-white') : isFBR ? 'bg-red-500 text-white' : isDelPend ? 'bg-amber-400 text-black' : isCredit ? 'bg-green-500 text-white' : isPaidElsewhere ? 'bg-indigo-500 text-white' : isPaid ? 'bg-emerald-100 text-emerald-700' : isAssignedToday ? 'bg-blue-500 text-white' : 'bg-red-100 text-red-700';
              const isMatchedRow = String(b.discrepancyReason || (b as any).discrepancy_reason || (b as any).discrepancy || '').toUpperCase().includes('MATCHED');
              return (
                <tr 
                  key={b.id || b.billNo} 
                  onClick={() => onSelectBill(b.id || b.billNo)} 
                  className={cn(
                    "transition-colors cursor-pointer",
                    isChecked ? "bg-blue-100" :
                    isSnapshot ? "bg-blue-50 hover:bg-blue-100" :
                    isFBR ? "bg-red-200 hover:bg-red-300" :
                    isDelPend ? "bg-yellow-100 hover:bg-yellow-200" :
                    isCredit ? "bg-green-50 hover:bg-green-100" :
                    isPaidElsewhere ? "bg-indigo-50 hover:bg-indigo-100" :
                    !isPaid ? "bg-white text-red-700 font-black hover:bg-red-50" :
                    (i % 2 === 0 ? "bg-white hover:bg-primary/5" : "bg-slate-50/40 hover:bg-primary/5")
                  )}
                >
                  <td className="px-0.5 py-0 text-center" onClick={e => toggleRow(e, b.id)}>
                    <div className={cn(
                      "w-4 h-4 rounded flex items-center justify-center mx-auto transition-colors",
                      isChecked
                        ? "bg-blue-600 border border-blue-700"
                        : "border border-primary/30 bg-primary/5"
                    )}>
                      {isChecked
                        ? <Check className="w-2.5 h-2.5 text-white" />
                        : <Square className="w-2.5 h-2.5 text-primary/40" />}
                    </div>
                  </td>
                  <td className="px-0.5 py-0 font-black">
                    {getDisplayBillNo(b)}
                  </td>
                  <td className="px-0.5 py-0 font-black truncate max-w-[110px]" title={b.partyName || ''}>
                    <span className={cn(
                      "truncate inline-block max-w-full px-1 py-0.5 rounded font-black",
                      isGreenParty(b.partyCode, b.partyName) ? "bg-emerald-300 text-emerald-950 dark:bg-emerald-800 dark:text-emerald-100 border border-emerald-500 shadow-sm" : ""
                    )}>
                      {(b.partyName || '—').slice(0, 14)}
                    </span>
                  </td>
                  <td className="px-0.5 py-0 text-right font-black">₹{b.billNetAmt.toLocaleString('en-IN')}</td>
                  <td className="px-0.5 py-0 text-center font-black text-muted-foreground">{b.deliveryDate || '—'}</td>
                  <td className={cn("px-0.5 py-0 text-right font-black text-emerald-600", isMatchedRow && eff.cash > 0 && "bg-pink-100 dark:bg-pink-950/80 text-pink-950 dark:text-pink-100 border border-pink-300 dark:border-pink-700 rounded-sm font-extrabold")}>{eff.cash > 0 ? `₹${eff.cash.toLocaleString('en-IN')}` : '—'}</td>
                  <td className={cn("px-0.5 py-0 text-right font-black text-blue-600", isMatchedRow && eff.upi > 0 && "bg-pink-100 dark:bg-pink-950/80 text-pink-950 dark:text-pink-100 border border-pink-300 dark:border-pink-700 rounded-sm font-extrabold")}>{eff.upi > 0 ? `₹${eff.upi.toLocaleString('en-IN')}` : '—'}</td>
                  <td className={cn("px-0.5 py-0 text-right font-black text-violet-600", isMatchedRow && eff.chq > 0 && "bg-pink-100 dark:bg-pink-950/80 text-pink-950 dark:text-pink-100 border border-pink-300 dark:border-pink-700 rounded-sm font-extrabold")}>{eff.chq > 0 ? `₹${eff.chq.toLocaleString('en-IN')}${b.chequeNo ? ` #${b.chequeNo}` : ''}` : '—'}</td>
                  <td className="px-0.5 py-0 text-right font-black text-destructive">
                    {isCredit && (b.lineCutAmt || 0) > 0
                      ? `₹${(b.lineCutAmt!).toLocaleString('en-IN')}`
                      : collected > 0 && b.billNetAmt > collected
                        ? `₹${(b.billNetAmt - collected).toLocaleString('en-IN')}`
                        : '-'}
                  </td>
                  {!isDriverMode && <td className="px-0.5 py-0 text-center font-black text-emerald-600">{b.paymentDate || '—'}</td>}
                  <td className="px-0.5 py-0 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <span className={cn("px-1.5 py-px rounded text-[7px] font-black", statusCls)}>
                        {statusLabel}
                      </span>
                      {selectedDriver === 'OWNER' && b.driverName && (
                        <span className="text-[6.5px] font-black text-muted-foreground leading-none truncate max-w-[64px] uppercase">
                          {b.driverName}
                        </span>
                      )}
                      {/* delete button removed per request: not shown to any role */}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-primary/10 text-[11px] font-black uppercase border-t border-primary/30">
            <tr>
              <td className="px-0.5 py-1 text-center">—</td>
              <td className="px-0.5 py-1 text-center text-primary">{rows.length}</td>
              <td className="px-0.5 py-1 text-center">TOTAL</td>
              <td className="px-0.5 py-1 text-center text-foreground font-black">₹{totals.amt.toLocaleString('en-IN')}</td>
              <td className="px-0.5 py-1 text-center">—</td>
              <td className="px-0.5 py-1 text-center text-emerald-600 font-black">₹{totals.cash.toLocaleString('en-IN')}</td>
              <td className="px-0.5 py-1 text-center text-blue-600 font-black">₹{totals.upi.toLocaleString('en-IN')}</td>
              <td className="px-0.5 py-1 text-center text-violet-600 font-black">₹{totals.chq.toLocaleString('en-IN')}</td>
              <td className="px-0.5 py-1 text-center text-destructive font-black">₹{totals.line.toLocaleString('en-IN')}</td>
              {!isDriverMode && <td className="px-0.5 py-1 text-center">—</td>}
              <td className="px-0.5 py-1 text-center">—</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className={cn("p-3 border-t border-border bg-card flex gap-2", isDriverMode && "p-2 gap-1.5")}>
        <Button 
          onClick={() => setShowCalculator(true)} 
          className={cn(
            "flex-1 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase tracking-wider shadow-md flex items-center justify-center gap-1.5 transition-transform active:scale-95",
            isDriverMode ? "h-9 rounded-xl text-[11px]" : "h-11 text-xs tracking-widest"
          )}
        >
          <Calculator className="w-3.5 h-3.5" />
          Cash Breakdown
        </Button>
        {getRole() === 'owner' && (
          <Button
            onClick={generateAllDriversPDF}
            className="flex-1 h-11 rounded-2xl bg-slate-700 hover:bg-slate-800 text-white font-black uppercase text-xs tracking-widest shadow-lg flex items-center justify-center gap-2 transition-transform active:scale-95"
          >
            <FileText className="w-4 h-4" />
            ALL DRIVERS PDF
          </Button>
        )}
        <Button
          onClick={generatePDF}
          className={cn(
            "flex-1 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white font-black uppercase tracking-wider shadow-md flex items-center justify-center gap-1.5 transition-transform active:scale-95",
            isDriverMode ? "h-9 rounded-xl text-[11px]" : "h-11 text-xs tracking-widest"
          )}
        >
          <FileText className="w-3.5 h-3.5" />
          PDF Download
        </Button>
      </div>

      {showCalculator && (
        <div className="fixed inset-0 bg-black/60 z-[300] flex items-start justify-center pt-4 p-3 backdrop-blur-sm">
          <div className="bg-card rounded-2xl p-4 w-full max-w-xs shadow-2xl animate-in zoom-in-95 border border-border overflow-y-auto max-h-[95vh]">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-black text-xs uppercase text-primary">Cash Breakdown</h3>
                  <span className="text-xs font-black text-destructive">₹{totals.cash.toLocaleString('en-IN')}</span>
                </div>
                <p className="text-[8px] font-black text-muted-foreground uppercase">{selectedDriver} • {displayDate}</p>
              </div>
              <button onClick={() => { setShowCalculator(false); setCalcSaved(false); }} className="p-1.5 bg-muted rounded-full text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>

            <div className="space-y-1.5 mb-3">
              {[500, 200, 100, 50, 20, 10].map(note => (
                <div key={note} className="flex items-center gap-2">
                  <div className="w-10 text-[10px] font-black text-muted-foreground text-right shrink-0">₹{note}</div>
                  <input
                    type="number" inputMode="numeric"
                    value={breakdown[`n${note}` as keyof CashBreakdown] || ''}
                    onChange={e => { setBreakdown({...breakdown, [`n${note}` as keyof CashBreakdown]: Number(e.target.value) || 0}); setCalcSaved(false); }}
                    className="flex-1 h-8 px-2 bg-muted rounded-lg text-[11px] font-black outline-none border border-border/30 focus:ring-2 focus:ring-primary/20 text-center"
                    placeholder="0"
                  />
                  <div className="w-16 text-right text-[10px] font-black text-foreground shrink-0">
                    ₹{((breakdown[`n${note}` as keyof CashBreakdown] || 0) * note).toLocaleString('en-IN')}
                  </div>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <div className="w-10 text-[10px] font-black text-muted-foreground text-right shrink-0">COIN</div>
                <input
                  type="number" inputMode="numeric"
                  value={breakdown.coins || ''}
                  onChange={e => { setBreakdown({...breakdown, coins: Number(e.target.value) || 0}); setCalcSaved(false); }}
                  className="flex-1 h-8 px-2 bg-muted rounded-lg text-[11px] font-black outline-none border border-border/30 focus:ring-2 focus:ring-primary/20 text-center"
                  placeholder="0"
                />
                <div className="w-16 text-right text-[10px] font-black text-foreground shrink-0">
                  ₹{breakdown.coins.toLocaleString('en-IN')}
                </div>
              </div>
            </div>

            <div className="bg-primary/5 px-3 py-2 rounded-xl border border-primary/10 mb-3 flex justify-between items-center">
              <span className="text-[10px] font-black uppercase text-primary">Total</span>
              <span className="text-base font-black text-primary">₹{calcTotal.toLocaleString('en-IN')}</span>
            </div>

            <Button
              onClick={handleSaveBreakdown}
              className={cn(
                "w-full h-10 rounded-xl font-black uppercase text-[11px] tracking-widest shadow-md flex items-center justify-center gap-2 transition-all",
                calcSaved ? "bg-emerald-600 hover:bg-emerald-600" : "bg-primary hover:bg-primary/90"
              )}
            >
              {calcSaved ? <><Check className="w-3.5 h-3.5" /> SAVED!</> : <><Save className="w-3.5 h-3.5" /> Save</>}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}