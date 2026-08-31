import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, Lock, Loader2, X, Plus, CheckCircle2, Upload, Trash2, FileText, MessageCircle, FileBarChart2, Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBillStore } from '@/hooks/use-bill-store';
import { saveSummaries, DriverDailySummary, type Bill, getSystemPassword, getBills, saveBills, addBillsToStore, getDrivers, saveDrivers, excelSerialToDate, patchBillInMemory, patchBillsInMemory, getWhatsAppTemplates, getWABulkSendEnabled, getDailyUnlocked, setDailyUnlocked, getTodayDMY, getUserPerm } from '@/lib/billStore';
import { getRole, getLoggedInName } from '@/lib/auth';
import { processBillsReportFile, BillsReportStatus } from '@/lib/billsReport';
import { safeReadWorkbook } from '@/lib/xlsxHelper';
import { generateDriverAssignmentImages } from '@/lib/driverAssignmentImage';
import { generateBillReportImages } from '@/lib/billReportImage';
import { recordDriverDownload } from '@/lib/driverDownloadStatus';
import TopNav from '@/components/TopNav';
import { cn } from '@/lib/utils';

function getTodayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}

export function isBillPaidOrFbrOrDelPending(b: any) {
  const mode = (b.paymentMode || '').trim().toLowerCase();
  const hasMoneyReceived =
    (Number(b.collectedAmount) || 0) > 0 ||
    (Number(b.cashAmount) || 0) > 0 ||
    (Number(b.upiAmount) || 0) > 0 ||
    (Number(b.chequeAmount) || 0) > 0;
  const isPaid = hasMoneyReceived || ['paid', 'cash', 'upi', 'cheque', 'split'].includes(mode);
  const isFBR = mode === 'fbr' || mode === 'cancel';
  const isDelPending = mode === 'del pending';
  const isCredit = mode === 'credit';
  return isPaid || isFBR || isDelPending || isCredit;
}

export default function DriverPage() {
  const { bills, drivers, summaries, loading, refresh } = useBillStore();
  const navigate = useNavigate();
  const [unlocked] = useState(true);
  const [pwInput] = useState('');
  const [pwError] = useState(false);
  const [selectedDate, setSelectedDate] = useState(getTodayISO());

  const [popupDriver, setPopupDriver] = useState<any>(null);
  const [popupBills, setPopupBills] = useState('');
  const [popupAmt, setPopupAmt] = useState('');
  const [saving, setSaving] = useState(false);

  // XLS Driver Assignment Upload
  const xlsRef = useRef<HTMLInputElement>(null);
  const [xlsStatus, setXlsStatus] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle');
  const [xlsStats, setXlsStats] = useState<{ updated: number; created: number; missing: number } | null>(null);

  // Bills Report Update (direct file upload — no settings redirect)
  const billsRptRef = useRef<HTMLInputElement>(null);
  const [billsRptStatus, setBillsRptStatus] = useState<BillsReportStatus | null>(null);

  // Manual bill assignment
  const [assignBillNo, setAssignBillNo] = useState('');
  const [assignDriver, setAssignDriver] = useState('');
  const [showPendingOnly, setShowPendingOnly] = useState(false);
  const [assignMsg, setAssignMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [assignSaving, setAssignSaving] = useState(false);

  // Del Pending carry-forward
  const [dpSaving, setDpSaving] = useState<Record<string, boolean>>({});

  // Del Pending multi-select
  const [selectedDpBills, setSelectedDpBills] = useState<Set<string>>(new Set());
  const [bulkDriver, setBulkDriver] = useState('');

  // Del Pending sort state
  const [dpSortCol, setDpSortCol] = useState<'billNo' | 'deliveryDate' | 'driverName'>('billNo');
  const [dpSortDir, setDpSortDir] = useState<'asc' | 'desc'>('asc');

  // WhatsApp bulk send state
  const [waSending, setWaSending] = useState<string | null>(null); // driverName currently sending

  // PDF TPL dropdown menu
  const [showTplMenu, setShowTplMenu] = useState(false);
  // Bill Reports dropdown menu
  const [showRptMenu, setShowRptMenu] = useState(false);


  const displayDate = useMemo(() => {
    if (!selectedDate || !selectedDate.includes('-')) return getTodayDMY();
    const parts = selectedDate.split('-');
    if (parts.length === 3) {
      const [y, m, d] = parts;
      return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
    }
    return getTodayDMY();
  }, [selectedDate]);

  function toDDMMYYYY(str: string): string {
    if (!str) return getTodayDMY();
    const clean = str.trim();
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(clean)) return clean;
    const parts = clean.includes('/') ? clean.split('/') : clean.split('-');
    if (parts.length === 3) {
      let [p1, p2, p3] = parts;
      if (p1.length === 4) {
        return `${p3.padStart(2, '0')}/${p2.padStart(2, '0')}/${p1}`;
      } else {
        if (p3.length === 2) p3 = '20' + p3;
        return `${p1.padStart(2, '0')}/${p2.padStart(2, '0')}/${p3}`;
      }
    }
    return getTodayDMY();
  }

  function toYYYYMMDD(str: string): string {
    if (!str) return getTodayISO();
    const clean = str.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
    const parts = clean.includes('/') ? clean.split('/') : clean.split('-');
    if (parts.length === 3) {
      let [p1, p2, p3] = parts;
      if (p1.length === 4) {
        return `${p1}-${p2.padStart(2, '0')}-${p3.padStart(2, '0')}`;
      } else {
        if (p3.length === 2) p3 = '20' + p3;
        return `${p3}-${p2.padStart(2, '0')}-${p1.padStart(2, '0')}`;
      }
    }
    return getTodayISO();
  }

  function isDateMatching(dt1?: string, dt2?: string): boolean {
    if (!dt1 || !dt2) return false;
    const clean1 = dt1.trim();
    const clean2 = dt2.trim();
    if (clean1 === clean2) return true;
    return toDDMMYYYY(clean1) === toDDMMYYYY(clean2);
  }

  function billsForDriver(driverName: string): typeof bills {
    const nameLower = driverName.toLowerCase().trim();
    return bills.filter(b => {
      const curDriverLower = (b.driverName || '').toLowerCase().trim();
      const hasDeliveryDateMatch = isDateMatching(b.deliveryDate, displayDate) || (!b.deliveryDate && isDateMatching(b.date, displayDate));

      // If currently assigned to a driver for this date
      if (curDriverLower && hasDeliveryDateMatch) {
        return curDriverLower === nameLower;
      }

      // If currently assigned to someone else for this date, do NOT show under this driver
      if (curDriverLower && curDriverLower !== nameLower && hasDeliveryDateMatch) {
        return false;
      }

      // If unassigned currently, check historical Del Pending snapshot
      if (!curDriverLower && Array.isArray(b.delPendingHistory)) {
        return b.delPendingHistory.some(h =>
          h.driverName && h.driverName.toLowerCase().trim() === nameLower && isDateMatching(h.deliveryDate, displayDate)
        );
      }
      return false;
    });
  }

  async function handleXlsUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const role = getRole();
    if (role === 'user') {
      const perms = getUserPerm(getLoggedInName());
      if (!perms.canAdd) {
        alert('Aapko entries upload/add karne ka right nahi hai!');
        e.target.value = '';
        return;
      }
    }

    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setXlsStatus('loading'); setXlsStats(null); e.target.value = '';

    try {
      const XLSX = await import('xlsx');
      const strip = (s: string) => String(s).replace(/^GST[-/]?/i, '').replace(/[^a-zA-Z0-9]/g, '').trim().toLowerCase();
      const getDigits = (s: string) => String(s).replace(/\D/g, '').replace(/^0+/, '');
      const todayNow = new Date();
      const todayFmt = `${String(todayNow.getDate()).padStart(2,'0')}/${String(todayNow.getMonth()+1).padStart(2,'0')}/${todayNow.getFullYear()}`;

      // Load all files as ArrayBuffers in parallel
      const buffers = await Promise.all(
        files.map(f => f.arrayBuffer().then(ab => new Uint8Array(ab)))
      );

      // Work on a single mutable copy of bills across all files
      const currentBills = [...getBills()];
      const xlsPatches: Array<{ billNo: string; patch: { driverName?: string; deliveryDate: string; paymentMode?: string; partyName?: string; billNetAmt?: number } }> = [];
      const newBillsCreated: Bill[] = [];
      const existingDrivers = getDrivers();

      // Canonical driver map (case-insensitive)
      const canonicalDriverMap = new Map<string, string>();
      existingDrivers.forEach(d => canonicalDriverMap.set(d.name.toLowerCase().trim(), d.name));

      const allDriverNames = new Set<string>();
      let totalUpdated = 0, totalCreated = 0, totalMissing = 0;

      // Track date frequency to auto-jump to the most common trip date
      const dateCounts = new Map<string, number>();

      for (const data of buffers) {
        const wb = safeReadWorkbook(XLSX, data, { cellDates: true });

        for (const sheetName of wb.SheetNames) {
          const ws = wb.Sheets[sheetName] as Record<string, unknown>;
          const wsTyped = ws as { '!ref'?: string };
          if (!wsTyped['!ref']) continue;
          const range = XLSX.utils.decode_range(wsTyped['!ref']);

          // Expanded keywords for robust matching
          const BILL_KEYWORDS = ['bill_number', 'bill number', 'bill no', 'billno', 'bill_no', 'bill', 'invoice no', 'invoice number', 'invoiceno', 'inv no', 'inv_no', 'doc no', 'doc_no', 'document no', 'ref no', 'ref_no', 'bill#', 'invoice', 'bill/inv'];
          // ONLY HHT VAN is recognized as driver name (VAN NAME is ignored)
          const DRIVER_KEYWORDS = ['hht van', 'hhtvan', 'hht_van', 'hht van name', 'hht_van_name', 'hht_van_no', 'hht van no'];
          const DATE_KEYWORDS = ['trip date', 'tripdate', 'trip_date', 'del date', 'delivery date', 'delivery_date', 'dispatch date', 'date', 'bill date', 'invoice date'];
          const PARTY_KEYWORDS = ['party name', 'party_name', 'customer name', 'customer_name', 'retailer name', 'party', 'customer', 'account name', 'outlet', 'party/customer', 'client', 'firm', 'firm name'];
          const AMT_KEYWORDS = ['net amt', 'net amount', 'bill amt', 'bill amount', 'total amt', 'amount', 'grand total', 'val', 'value', 'net_amt', 'bill_amt', 'invoice amt', 'invoice amount'];

          // Auto-detect header row — scan first 25 rows
          let headerRow = range.s.r;
          for (let r = range.s.r; r <= Math.min(range.s.r + 25, range.e.r); r++) {
            let found = false;
            for (let c = range.s.c; c <= range.e.c; c++) {
              const cell = ws[XLSX.utils.encode_cell({ r, c })] as { v?: unknown } | undefined;
              const val = String(cell?.v || '').toLowerCase().trim();
              if (BILL_KEYWORDS.some(kw => val.includes(kw)) || DRIVER_KEYWORDS.some(kw => val.includes(kw))) {
                found = true;
                break;
              }
            }
            if (found) { headerRow = r; break; }
          }

          function findCol(keywords: string[]): number {
            for (let c = range.s.c; c <= range.e.c; c++) {
              const cell = ws[XLSX.utils.encode_cell({ r: headerRow, c })] as { v?: unknown } | undefined;
              const val = String(cell?.v || '').toLowerCase().trim();
              if (keywords.some(kw => val === kw || val.includes(kw))) return c;
            }
            return -1;
          }

          let COL_BILL_NO = findCol(BILL_KEYWORDS);
          let COL_DRIVER = findCol(DRIVER_KEYWORDS);
          let COL_TRIP_DATE = findCol(DATE_KEYWORDS);
          let COL_PARTY = findCol(PARTY_KEYWORDS);
          let COL_AMT = findCol(AMT_KEYWORDS);

          // If bill column not found by header, inspect contents of first data row
          if (COL_BILL_NO === -1) {
            for (let c = range.s.c; c <= range.e.c; c++) {
              const sampleCell = ws[XLSX.utils.encode_cell({ r: headerRow + 1, c })] as { v?: unknown } | undefined;
              const sampleVal = String(sampleCell?.v || '').trim();
              if (sampleVal && (sampleVal.match(/\d{3,}/) || sampleVal.toLowerCase().includes('gst'))) {
                COL_BILL_NO = c;
                break;
              }
            }
          }

          if (COL_BILL_NO === -1) COL_BILL_NO = 1; // Fallback to second column
          const colBill = COL_BILL_NO;
          const colDriver = COL_DRIVER; // Only parse driver if HHT VAN column is present
          const colDate = COL_TRIP_DATE;

          // Pre-index current bills for fast multi-tiered lookup
          const exactMap = new Map<string, number>();
          const strippedMap = new Map<string, number>();
          const digitsMap = new Map<string, number>();

          currentBills.forEach((b, i) => {
            exactMap.set(b.billNo.toLowerCase().trim(), i);
            const s = strip(b.billNo);
            if (s) strippedMap.set(s, i);
            const d = getDigits(b.billNo);
            if (d) digitsMap.set(d, i);
          });

          for (let r = headerRow + 1; r <= range.e.r; r++) {
            const bnCell = ws[XLSX.utils.encode_cell({ r, c: colBill })] as { v?: unknown } | undefined;
            const drCell = colDriver !== -1 ? (ws[XLSX.utils.encode_cell({ r, c: colDriver })] as { v?: unknown } | undefined) : undefined;
            const dtCell = colDate !== -1 ? (ws[XLSX.utils.encode_cell({ r, c: colDate })] as { v?: unknown } | undefined) : undefined;
            const partyCell = COL_PARTY !== -1 ? ws[XLSX.utils.encode_cell({ r, c: COL_PARTY })] as { v?: unknown } | undefined : undefined;
            const amtCell = COL_AMT !== -1 ? ws[XLSX.utils.encode_cell({ r, c: COL_AMT })] as { v?: unknown } | undefined : undefined;

            let rawBn = String(bnCell?.v || '').trim();
            if (typeof bnCell?.v === 'number') rawBn = String(bnCell.v).replace(/\.0+$/, '');
            if (!rawBn || rawBn.toLowerCase() === 'bill no' || rawBn.toLowerCase() === 'bill number') continue; // skip empty or header rows

            const dr = String(drCell?.v || '').trim();
            const partyVal = String(partyCell?.v || '').trim();
            let netAmtVal = 0;
            if (amtCell?.v != null) {
              const parsedAmt = parseFloat(String(amtCell.v).replace(/,/g, ''));
              if (!isNaN(parsedAmt)) netAmtVal = parsedAmt;
            }

            const parsedRawDate = dtCell?.v != null ? excelSerialToDate(dtCell.v) : '';
            const tripDate = parsedRawDate ? toDDMMYYYY(parsedRawDate) : todayFmt;
            if (parsedRawDate) dateCounts.set(tripDate, (dateCounts.get(tripDate) || 0) + 1);

            const patch: { deliveryDate: string; driverName?: string; paymentMode?: string; partyName?: string; billNetAmt?: number } = { deliveryDate: tripDate };
            if (dr) {
              const canonicalDr = canonicalDriverMap.get(dr.toLowerCase().trim()) ?? dr;
              patch.driverName = canonicalDr;
              allDriverNames.add(canonicalDr);
            }

            // Multi-tiered bill matching
            const bnLower = rawBn.toLowerCase().trim();
            const bnStrip = strip(rawBn);
            const bnDigits = getDigits(rawBn);

            let idx = exactMap.get(bnLower) ?? -1;
            if (idx === -1 && bnStrip) idx = strippedMap.get(bnStrip) ?? -1;
            if (idx === -1 && bnDigits) idx = digitsMap.get(bnDigits) ?? -1;
            if (idx === -1) {
              idx = currentBills.findIndex(b => {
                const bLower = b.billNo.toLowerCase();
                return bLower.endsWith(bnLower) || bnLower.endsWith(bLower);
              });
            }

            if (idx !== -1) {
              const curMode = (currentBills[idx].paymentMode || '').trim().toLowerCase();
              const hasPaymentRec = (Number(currentBills[idx].collectedAmount) || 0) > 0 || (Number(currentBills[idx].cashAmount) || 0) > 0 || (Number(currentBills[idx].upiAmount) || 0) > 0 || (Number(currentBills[idx].chequeAmount) || 0) > 0 || !!currentBills[idx].paymentDate;
              const isCredit = curMode === 'credit';
              const isFBR = curMode === 'fbr' || curMode === 'cancel';

              // If bill has payment received or is in Credit/FBR, preserve status & do not overwrite with 'Assigned'
              if (dr && !hasPaymentRec && !isCredit && !isFBR && (curMode === '' || curMode === 'pending' || curMode === 'assigned' || curMode === 'del pending' || curMode === 'unpaid')) {
                patch.paymentMode = 'Assigned';
              }
              if (partyVal && (!currentBills[idx].partyName || currentBills[idx].partyName.startsWith('Party '))) {
                patch.partyName = partyVal;
              }
              if (netAmtVal > 0 && !currentBills[idx].billNetAmt) {
                patch.billNetAmt = netAmtVal;
              }
              currentBills[idx] = { ...currentBills[idx], ...patch };
              xlsPatches.push({ billNo: currentBills[idx].billNo, patch });
              totalUpdated++;
            } else {
              // Create NEW bill so driver cards display ALL bills in uploaded XLS
              const newBill: Bill = {
                id: 'xls_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                billNo: rawBn,
                partyName: partyVal || `Party ${rawBn}`,
                date: tripDate,
                deliveryDate: tripDate,
                billNetAmt: netAmtVal || 0,
                collectedAmount: 0,
                cashAmount: 0,
                upiAmount: 0,
                chequeAmount: 0,
                paymentMode: dr ? 'Assigned' : 'Unpaid',
                driverName: patch.driverName || '',
                delPendingHistory: [],
                srNo: '',
                salespersonName: '',
                collectionCode: '',
                partyCode: '',
                partyHulCode: '',
                beatName: '',
                outstandingAmount: netAmtVal || 0,
                billAgeing: 0,
              };
              newBillsCreated.push(newBill);
              currentBills.push(newBill);
              const newIdx = currentBills.length - 1;
              exactMap.set(bnLower, newIdx);
              if (bnStrip) strippedMap.set(bnStrip, newIdx);
              if (bnDigits) digitsMap.set(bnDigits, newIdx);
              totalCreated++;
            }
          }
        }
      }

      if (xlsPatches.length > 0) {
        await patchBillsInMemory(xlsPatches);
      }
      if (newBillsCreated.length > 0) {
        addBillsToStore(newBillsCreated);
      }

      // Auto-jump date picker safely to the most common trip date
      if (dateCounts.size > 0) {
        const topDate = [...dateCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
        const safeISO = toYYYYMMDD(topDate);
        setSelectedDate(safeISO);
      }

      // Add any new driver names encountered across all files
      const existingLower = new Set(existingDrivers.map(d => d.name.toLowerCase().trim()));
      const newDrivers = [...allDriverNames]
        .filter(n => !existingLower.has(n.toLowerCase().trim()))
        .map(n => ({ id: Math.random().toString(36).substr(2, 9), name: n }));
      if (newDrivers.length > 0) await saveDrivers([...existingDrivers, ...newDrivers]);

      refresh();
      setXlsStats({ updated: totalUpdated, created: totalCreated, missing: totalMissing });
      setXlsStatus('ok');
      setTimeout(() => setXlsStatus('idle'), 5000);
    } catch (err) {
      console.error('XLS Upload error:', err);
      setXlsStatus('err');
    }
  }

  async function handleAssignBill() {
    const role = getRole();
    if (role === 'user') {
      const perms = getUserPerm(getLoggedInName());
      if (!perms.canEdit) {
        setAssignMsg({ type: 'err', text: 'Aapko driver assignment add/change karne ka right nahi hai!' });
        return;
      }
    }

    const bn = assignBillNo.trim();
    if (!bn || !assignDriver) return;
    setAssignSaving(true);
    setAssignMsg(null);
    const allBills = getBills();
    const idx = allBills.findIndex(b => b.billNo === bn || b.billNo.endsWith(bn));
    if (idx === -1) {
      setAssignMsg({ type: 'err', text: `Bill "${bn}" not found` });
      setAssignSaving(false);
      return;
    }
    const existingMode = (allBills[idx].paymentMode || '').trim().toLowerCase();
    const patch: { driverName: string; deliveryDate: string; paymentMode?: string } = { driverName: assignDriver, deliveryDate: displayDate };
    const hasPaymentRec = (Number(allBills[idx].collectedAmount) || 0) > 0 || (Number(allBills[idx].cashAmount) || 0) > 0 || (Number(allBills[idx].upiAmount) || 0) > 0 || (Number(allBills[idx].chequeAmount) || 0) > 0 || !!allBills[idx].paymentDate;
    const isCredit = existingMode === 'credit';
    const isFBR = existingMode === 'fbr' || existingMode === 'cancel';

    // If bill already has payment received or is in Credit/FBR, do NOT change status to 'Assigned' and do NOT wipe payment details
    if (!hasPaymentRec && !isCredit && !isFBR) {
      const OVERRIDABLE = new Set(['', 'pending', 'assigned', 'del pending', 'unpaid']);
      if (displayDate === getTodayDMY() && OVERRIDABLE.has(existingMode)) {
        patch.paymentMode = 'Assigned';
      }
    }
    const ok = await patchBillInMemory(allBills[idx].billNo, patch);
    refresh();
    if (ok) {
      setAssignMsg({ type: 'ok', text: `Bill ${bn} → ${assignDriver} (${displayDate}) · Saved to database` });
      setAssignBillNo('');
    } else {
      setAssignMsg({ type: 'err', text: `Bill ${bn} database me save nahi hua. Internet check karein.` });
    }
    setAssignSaving(false);
  }

  const delPendingBills = useMemo(() => {
    // Show Del Pending bills that haven't been collected yet AND not yet assigned for today.
    // Once assigned to a driver for today (deliveryDate === displayDate), they move to the driver's table.
    const filtered = bills.filter(b => {
      if (b.paymentMode !== 'Del Pending') return false;
      if ((b.collectedAmount || 0) > 0) return false; // actually collected → done
      if (b.driverName && b.deliveryDate === displayDate) return false; // already assigned for today → show in driver table
      return true;
    });
    // Deduplicate by billNo — keep only the first occurrence
    const seen = new Set<string>();
    const deduped = filtered.filter(b => {
      if (seen.has(b.billNo)) return false;
      seen.add(b.billNo);
      return true;
    });
    // Sort by selected column
    return [...deduped].sort((a, b) => {
      const va = String(a[dpSortCol] || '');
      const vb = String(b[dpSortCol] || '');
      const cmp = dpSortCol === 'billNo'
        ? va.localeCompare(vb, 'en', { numeric: true })
        : va.localeCompare(vb);
      return dpSortDir === 'asc' ? cmp : -cmp;
    });
  }, [bills, dpSortCol, dpSortDir, displayDate]);

  async function handleDeleteBillAssignment(billNo: string, targetDate?: string, e?: React.SyntheticEvent) {
    if (e) e.stopPropagation();
    const role = getRole();
    // Only owner may remove driver assignments from the Driver page
    if (role !== 'owner') {
      alert('Sirf OWNER hi driver assignment remove kar sakta hai.');
      return;
    }

    const norm = billNo.trim().toLowerCase();
    const orig = getBills().find(b => b.billNo.trim().toLowerCase() === norm) || bills.find(b => b.billNo.trim().toLowerCase() === norm);
    if (!orig) return;

    const matchDate = targetDate || orig.deliveryDate || displayDate;
    const newHistory = Array.isArray(orig.delPendingHistory)
      ? orig.delPendingHistory.filter(h => !isDateMatching(h.deliveryDate, matchDate) && !isDateMatching(h.deliveryDate, displayDate))
      : [];
    const newMode = orig.paymentMode === 'Assigned' ? 'Unpaid' : (orig.paymentMode || 'Unpaid');

    const ok = await patchBillInMemory(orig.billNo, {
      driverName: '',
      deliveryDate: '',
      paymentMode: newMode,
      delPendingHistory: newHistory
    });
    refresh();
    if (!ok) alert(`Bill ${billNo} database me update nahi hua. Internet check karein.`);
  }

  async function handleReassignDelPending(billNo: string, newDriver: string) {
    if (!newDriver) return;
    const role = getRole();
    if (role === 'user') {
      const perms = getUserPerm(getLoggedInName());
      if (!perms.canEdit) {
        alert('Aapko driver assignment change karne ka right nahi hai!');
        return;
      }
    }

    setDpSaving(p => ({ ...p, [billNo]: true }));
    // Snapshot current Del Pending assignment so the original driver/date keeps showing it
    const orig = getBills().find(b => b.billNo === billNo);
    const history = Array.isArray(orig?.delPendingHistory) ? [...orig!.delPendingHistory] : [];
    if (orig?.driverName && orig?.deliveryDate) {
      const exists = history.some(h => h.driverName === orig.driverName && h.deliveryDate === orig.deliveryDate);
      if (!exists) history.push({ driverName: orig.driverName, deliveryDate: orig.deliveryDate });
    }
    // Reset paymentMode so bill no longer shows as Del Pending in Bills cards and Reports.
    // If reassigned for today's delivery, mark Assigned (not left blank → never falls into Credit).
    const newMode = displayDate === getTodayDMY() ? 'Assigned' : '';
    const ok = await patchBillInMemory(billNo, {
      driverName: newDriver,
      deliveryDate: displayDate,
      paymentMode: newMode,
      delPendingHistory: history,
      paymentDate: '',
      paymentTime: '',
      cashAmount: 0,
      upiAmount: 0,
      chequeAmount: 0,
      chequeNo: '',
      bankName: '',
      collectedAmount: 0,
    });
    refresh();
    setDpSaving(p => ({ ...p, [billNo]: false }));
    if (!ok) alert(`Bill ${billNo} database me save nahi hua. Internet check karein.`);
  }

  async function handleBulkAssign() {
    if (!bulkDriver || selectedDpBills.size === 0) return;
    const role = getRole();
    if (role === 'user') {
      const perms = getUserPerm(getLoggedInName());
      if (!perms.canEdit) {
        alert('Aapko driver assignment change karne ka right nahi hai!');
        return;
      }
    }

    const allBills = getBills();
    const patches = Array.from(selectedDpBills).map(billNo => {
      const orig = allBills.find(b => b.billNo === billNo);
      const history = Array.isArray(orig?.delPendingHistory) ? [...orig!.delPendingHistory] : [];
      if (orig?.driverName && orig?.deliveryDate) {
        const exists = history.some(h => h.driverName === orig.driverName && h.deliveryDate === orig.deliveryDate);
        if (!exists) history.push({ driverName: orig.driverName, deliveryDate: orig.deliveryDate });
      }
      const newMode = displayDate === getTodayDMY() ? 'Assigned' : '';
      return {
        billNo,
        patch: {
          driverName: bulkDriver,
          deliveryDate: displayDate,
          paymentMode: newMode,
          delPendingHistory: history,
          paymentDate: '',
          paymentTime: '',
          cashAmount: 0,
          upiAmount: 0,
          chequeAmount: 0,
          chequeNo: '',
          bankName: '',
          collectedAmount: 0,
        },
      };
    });
    const ok = await patchBillsInMemory(patches);
    refresh();
    if (ok) {
      setSelectedDpBills(new Set());
      setBulkDriver('');
    } else {
      alert('Kuch bills database me save nahi hue. Internet check karein.');
    }
  }


  function toggleDpBill(billNo: string) {
    setSelectedDpBills(prev => {
      const next = new Set(prev);
      next.has(billNo) ? next.delete(billNo) : next.add(billNo);
      return next;
    });
  }

  function toggleAllDpBills(all: string[]) {
    setSelectedDpBills(prev => prev.size === all.length ? new Set() : new Set(all));
  }

  const driverStats = useMemo(() => {
    // Deduplicate drivers by name (case-insensitive) — same-name entries show as one card
    const seen = new Set<string>();
    const uniqueDrivers = drivers.filter(d => {
      const key = d.name.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return uniqueDrivers.map(d => {
      // Del Pending bills assigned to this driver from ANY previous date — carry-forward
      const nameLower = d.name.toLowerCase().trim();
      // Del Pending carry-forward for this driver — do NOT filter on paymentDate,
      // old entries may have had it set before the fix.
      const driverDelPending = bills.filter(b =>
        b.paymentMode === 'Del Pending' &&
        !(b.collectedAmount > 0) &&
        !!b.driverName &&
        b.driverName.toLowerCase().trim() === nameLower &&
        b.deliveryDate !== displayDate
      );

      // Dynamic calculation from Master Ledger based on Sync Assignments (includes carry-forward)
      const allDbills = billsForDriver(d.name);
      const dbills = showPendingOnly
        ? allDbills.filter(b => !!b.deliveryDate && !b.paymentDate)
        : allDbills;
      
      const getEff = (b: typeof bills[0]) => {
        const ca = Number(b.cashAmount) || 0;
        const up = Number(b.upiAmount) || 0;
        const ch = Number(b.chequeAmount) || 0;
        const col = Number(b.collectedAmount) || 0;
        if (ca === 0 && up === 0 && ch === 0 && col > 0) {
          const m = (b.paymentMode || '').toLowerCase();
          if (m === 'upi') return { cash: 0, upi: col, chq: 0 };
          if (m === 'cheque') return { cash: 0, upi: 0, chq: col };
          return { cash: col, upi: 0, chq: 0 };
        }
        return { cash: ca, upi: up, chq: ch };
      };
      const cash = dbills.reduce((s, b) => s + getEff(b).cash, 0);
      const upi  = dbills.reduce((s, b) => s + getEff(b).upi,  0);
      const chq  = dbills.reduce((s, b) => s + getEff(b).chq,  0);
      const totalCollected = cash + upi + chq;

      const cancelCount = dbills.filter(b => b.paymentMode === 'Cancel' || b.paymentMode === 'FBR').length;
      
      const isPending = (b: typeof bills[0]) => {
        const mode = (b.paymentMode || '').trim().toUpperCase();
        if (mode === 'CANCEL' || mode === 'FBR') return false;
        if (mode === 'CREDIT') return false;
        
        const hasMoneyReceived =
          (Number(b.collectedAmount) || 0) > 0 ||
          (Number(b.cashAmount) || 0) > 0 ||
          (Number(b.upiAmount) || 0) > 0 ||
          (Number(b.chequeAmount) || 0) > 0;
        const hasLineCut = (Number(b.lineCutAmt) || 0) > 0 || !!(b.cancelLine && b.cancelLine !== '0');
        if (hasMoneyReceived || hasLineCut) return false;

        return true;
      };

      const pendingAmt = dbills.filter(isPending).reduce((s, b) => s + (Number(b.billNetAmt) || 0), 0);
      const cancelAmt = dbills.filter(b => b.paymentMode === 'Cancel' || b.paymentMode === 'FBR').reduce((s, b) => s + (Number(b.billNetAmt) || 0), 0);
      const creditAmt = dbills.filter(b => (b.paymentMode || '').trim().toUpperCase() === 'CREDIT').reduce((s, b) => s + (Number(b.billNetAmt) || 0), 0);

      const lineCutAmt = dbills
        .filter(b => (b.collectedAmount || 0) > 0)
        .reduce((s, b) => s + (Number(b.billNetAmt) - Number(b.collectedAmount)), 0);

      // Total Load is derived from all assigned bills for this driver/date
      const loadAmt = dbills.reduce((s, b) => s + Number(b.billNetAmt), 0);
      const loadBillCount = dbills.length;

      const paidBillCount = dbills.filter(isBillPaidOrFbrOrDelPending).length;
      const pendingCount = Math.max(0, loadBillCount - paidBillCount);
      
      const shortage = loadAmt - (totalCollected + cancelAmt + pendingAmt + lineCutAmt + creditAmt);

      const saved = summaries.find(s => s.driverName === d.name && s.date === displayDate);

      const billNos = dbills.map(b => b.billNo.replace(/^GST/i, ''));

      return { 
        ...d, 
        cash, upi, chq, totalCollected, 
        cancelCount, 
        pendingCount,
        shortage,
        loadAmt,
        loadBillCount,
        billNos,
        saved,
        driverDelPending,
      };
    });
  }, [drivers, bills, displayDate, summaries, showPendingOnly]);

  async function handleWABulkSend(d: typeof driverStats[number], e: React.MouseEvent) {
    e.stopPropagation();
    if (!getWABulkSendEnabled()) { alert('WhatsApp Bulk Send is disabled. Enable it in Settings → Intelligence Templates.'); return; }
    const dBills = billsForDriver(d.name).filter(b => b.deliveryDate === displayDate);
    if (dBills.length === 0) { alert('No bills assigned to this driver for selected date.'); return; }
    const templates = getWhatsAppTemplates();
    setWaSending(d.name);
    const today = new Date();
    for (let i = 0; i < dBills.length; i++) {
      const b = dBills[i];
      const isPaid = !!b.paymentDate || (b.collectedAmount || 0) > 0;
      const isFBR = b.paymentMode === 'FBR' || b.paymentMode === 'Cancel';
      const isLineCut = !isPaid && !isFBR && (b.collectedAmount || 0) > 0 && b.billNetAmt > (b.collectedAmount || 0);
      let template = templates.pending;
      if (isFBR) template = templates.fbr;
      else if (isLineCut) template = templates.returnCheque;
      // Calculate days outstanding
      let days = '';
      if (b.date) {
        try {
          const [dd, mm, yy] = b.date.split('/');
          const billDt = new Date(+`20${yy.length === 2 ? yy : yy.slice(2)}`, +mm - 1, +dd);
          days = String(Math.floor((today.getTime() - billDt.getTime()) / 86400000));
        } catch { days = ''; }
      }
      const billNo = b.billNo.replace(/^GST[-/]?/i, '');
      const msg = template
        .replace(/\{\{billNo\}\}/gi, billNo)
        .replace(/\{\{billDate\}\}/gi, b.date || '')
        .replace(/\{\{partyName\}\}/gi, b.partyName || '')
        .replace(/\{\{billAmt\}\}/gi, b.billNetAmt.toLocaleString('en-IN'))
        .replace(/\{\{days\}\}/gi, days)
        .replace(/\{\{lineCutAmt\}\}/gi, String((b.billNetAmt - (b.collectedAmount || 0)).toLocaleString('en-IN')))
        .replace(/\{\{driver\}\}/gi, d.name);
      const encodedMsg = encodeURIComponent(msg);
      window.location.href = `whatsapp://send?text=${encodedMsg}`;
      // Small delay so browser doesn't block multiple popups
      if (i < dBills.length - 1) await new Promise(r => setTimeout(r, 700));
    }
    setWaSending(null);
  }

  async function handlePrintDriverPDF(d: typeof driverStats[number], e: React.MouseEvent) {
    e.stopPropagation();
    try {
      const jsPDF = (await import('jspdf')).default;
      const autoTable = (await import('jspdf-autotable')).default;
      const doc = new jsPDF('p', 'mm', 'a4');
      const ML = 10, MR = 10, PAGE_H = 297;
      const usableW = 210 - ML - MR;

      const driverBills = billsForDriver(d.name);

      // ── Compute summary stats ──────────────────────────────────────────
      let cashCount = 0, cashAmt = 0, gpayCount = 0, gpayAmt = 0;
      let chqCount = 0, chqAmt = 0, fbrCount = 0, fbrAmt = 0;
      let delPendCount = 0, delPendAmt = 0, totalLineCut = 0, totalAmt = 0;
      driverBills.forEach(b => {
        const isFBR    = b.paymentMode === 'FBR' || b.paymentMode === 'Cancel';
        const isDelPend= b.paymentMode === 'Del Pending';
        const cash = Number(b.cashAmount) || 0;
        const gpay = Number(b.upiAmount)  || 0;
        const chq  = Number(b.chequeAmount) || 0;
        const lc   = (Number(b.lineCutAmt) || 0) || (Number(b.cancelLine) || 0);
        if (isFBR)    { fbrCount++;    fbrAmt    += b.billNetAmt; return; }
        if (isDelPend){ delPendCount++; delPendAmt += b.billNetAmt; return; }
        totalAmt    += b.billNetAmt;
        if (cash > 0) { cashCount++; cashAmt += cash; }
        if (gpay > 0) { gpayCount++; gpayAmt += gpay; }
        if (chq  > 0) { chqCount++;  chqAmt  += chq;  }
        totalLineCut += lc;
      });

      // ── Title ───────────────────────────────────────────────────────────
      doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.setTextColor(0, 0, 0);
      doc.text(`DRIVER: ${d.name.toUpperCase()}`, ML, 11);
      doc.setFontSize(9); doc.setTextColor(50, 50, 50);
      doc.text(`DEL DATE: ${displayDate}   |   LOAD: ${driverBills.length} BILLS   |   AMT: RS.${(totalAmt + fbrAmt).toLocaleString('en-IN')}`, ML, 17);

      // ── Coloured Summary Stats Row ──────────────────────────────────────
      autoTable(doc, {
        startY: 19,
        margin: { left: ML, right: MR },
        tableWidth: usableW,
        head: [],
        body: [[
          `CASH\n${cashCount} BILLS\nRS.${cashAmt.toLocaleString('en-IN')}`,
          `GPAY\n${gpayCount} BILLS\nRS.${gpayAmt.toLocaleString('en-IN')}`,
          `CHEQ\n${chqCount} BILLS\nRS.${chqAmt.toLocaleString('en-IN')}`,
          `FBR\n${fbrCount} BILLS\nRS.${fbrAmt.toLocaleString('en-IN')}`,
          `DEL PEND\n${delPendCount} BILLS\nRS.${delPendAmt.toLocaleString('en-IN')}`,
          `LINE CUT\nRS.${totalLineCut.toLocaleString('en-IN')}`,
        ]],
        theme: 'grid',
        styles: { fontSize: 7.5, fontStyle: 'bold', halign: 'center', cellPadding: 1.8, lineWidth: 0.3, lineColor: [180, 180, 180] },
        columnStyles: {
          0: { fillColor: [210, 255, 215], textColor: [0, 120, 0]   },
          1: { fillColor: [210, 228, 255], textColor: [10, 60, 200]  },
          2: { fillColor: [238, 210, 255], textColor: [100, 0, 180]  },
          3: { fillColor: [255, 210, 210], textColor: [180, 0, 0]    },
          4: { fillColor: [255, 252, 200], textColor: [130, 90, 0]   },
          5: { fillColor: [255, 230, 205], textColor: [150, 55, 0]   },
        },
      });

      const tableStartY = (doc as any).lastAutoTable.finalY + 2;

      // ── Auto-scale padding to fit all bills; font fixed at 9pt bold ─────
      const availableH = PAGE_H - tableStartY - 8;
      const totalRows  = driverBills.length + 2;          // head + foot
      const maxRowH    = availableH / totalRows;
      const cellPad    = Math.max(0.2, Math.min(0.35, maxRowH * 0.18));
      const fSize      = 9;

      // ── Bills Table ──────────────────────────────────────────────────────
      const tableBody = driverBills.map((b) => {
        const isFBR = b.paymentMode === 'FBR' || b.paymentMode === 'Cancel';
        const cash  = Number(b.cashAmount)   || 0;
        const gpay  = Number(b.upiAmount)    || 0;
        const chq   = Number(b.chequeAmount) || 0;
        const lc    = (Number(b.lineCutAmt) || 0) || (Number(b.cancelLine) || 0);

        const isMatched = String(b.discrepancyReason || (b as any).discrepancy_reason || (b as any).discrepancy || '').toUpperCase().includes('MATCHED');

        const gpayCell = gpay > 0 ? gpay.toLocaleString('en-IN') : '-';
        const chqCell  = chq > 0 ? chq.toLocaleString('en-IN') : '-';

        return [
          b.billNo.replace(/^GST[-/]?/i, ''),
          (b.partyName || '-').substring(0, 20),
          b.billNetAmt > 0 ? b.billNetAmt.toLocaleString('en-IN') : '-',
          lc   > 0 ? lc.toLocaleString('en-IN')              : '-',
          cash > 0 ? cash.toLocaleString('en-IN')            : '-',
          gpayCell,
          chqCell,
          isFBR ? b.billNetAmt.toLocaleString('en-IN')       : '-',
        ];
      });

      const totalCash = driverBills.reduce((s, b) => s + (Number(b.cashAmount)   || 0), 0);
      const totalGpay = driverBills.reduce((s, b) => s + (Number(b.upiAmount)    || 0), 0);
      const totalChq  = driverBills.reduce((s, b) => s + (Number(b.chequeAmount) || 0), 0);
      const grandAmt  = driverBills.reduce((s, b) => s + (Number(b.billNetAmt)   || 0), 0);

      autoTable(doc, {
        startY: tableStartY,
        head: [['BILL NO', 'PARTY NAME', 'BILL AMT', 'LINE CUT', 'CASH', 'GPAY', 'CHEQ', 'FBR']],
        body: tableBody,
        foot: [['', 'TOTAL', grandAmt.toLocaleString('en-IN'), totalLineCut > 0 ? totalLineCut.toLocaleString('en-IN') : '-', totalCash.toLocaleString('en-IN'), totalGpay.toLocaleString('en-IN'), totalChq.toLocaleString('en-IN'), fbrAmt > 0 ? fbrAmt.toLocaleString('en-IN') : '-']],
        showFoot: 'lastPage',
        theme: 'grid',
        styles: { fontSize: fSize, font: 'helvetica', fontStyle: 'bold', cellPadding: cellPad, minCellHeight: 2.65, overflow: 'ellipsize', lineWidth: 0.15, textColor: [0, 0, 0] },
        headStyles: { fillColor: [72, 80, 229], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: fSize, cellPadding: cellPad, minCellHeight: 2.65 },
        footStyles: { fillColor: [72, 80, 229], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: fSize, cellPadding: cellPad, minCellHeight: 2.65 },
        bodyStyles: { textColor: [0, 0, 0], fontStyle: 'bold' },
        columnStyles: {
          0: { cellWidth: 26 },
          1: { cellWidth: 50 },
          2: { halign: 'right', cellWidth: 20 },
          3: { halign: 'right', cellWidth: 18 },
          4: { halign: 'right', cellWidth: 16 },
          5: { halign: 'right', cellWidth: 16 },
          6: { halign: 'right', cellWidth: 16 },
          7: { halign: 'right', cellWidth: 16 },
        },
        margin: { left: ML, right: MR },
        didParseCell: (data: any) => {
          if (data.section !== 'body') return;
          const bill = driverBills[data.row.index];
          if (!bill) return;
          const isFBR    = bill.paymentMode === 'FBR' || bill.paymentMode === 'Cancel';
          const isCredit = bill.paymentMode === 'Credit';
          const isDelPend= bill.paymentMode === 'Del Pending';
          const isPaid   = !!bill.paymentDate || (bill.collectedAmount || 0) > 0;
          if (isFBR)          { data.cell.styles.fillColor = [255, 150, 150]; }
          else if (isCredit)  { data.cell.styles.fillColor = [150, 255, 150]; }
          else if (isDelPend) { data.cell.styles.fillColor = [255, 252, 200]; }
          else if (!isPaid)   { data.cell.styles.textColor = [200, 0, 0]; }

          const isMatched = String(bill.discrepancyReason || (bill as any).discrepancy_reason || (bill as any).discrepancy || '').toUpperCase().includes('MATCHED');
          if (isMatched) {
            const cash = Number(bill.cashAmount) || 0;
            const gpay = Number(bill.upiAmount) || 0;
            const chq = Number(bill.chequeAmount) || 0;
            const m = (bill.paymentMode || '').toLowerCase();
            const colIdx = data.column.index;
            if (colIdx === 4 && cash > 0) {
              data.cell.styles.fillColor = [252, 231, 243];
            } else if (colIdx === 5 && (gpay > 0 || m.includes('gpay') || m.includes('upi'))) {
              data.cell.styles.fillColor = [252, 231, 243];
            } else if (colIdx === 6 && (chq > 0 || m.includes('cheque') || m.includes('chq'))) {
              data.cell.styles.fillColor = [252, 231, 243];
            }
          }
        },
      });

      // ── Footer ────────────────────────────────────────────────────────
      doc.setFontSize(6.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(140);
      doc.text(`CONFIANCE  |  ${new Date().toLocaleString('en-IN')}`, ML, PAGE_H - 4);

      const safeDate = displayDate.replace(/\//g, '-');
      doc.save(`${safeDate}_${d.name.replace(/\s+/g,'_').toUpperCase()}.pdf`);
    } catch (err) {
      console.error('PDF error', err);
      alert('PDF generation failed. Please try again.');
    }
  }

  async function handlePrintAllDriversPDF() {
    try {
      const jsPDF = (await import('jspdf')).default;
      const autoTable = (await import('jspdf-autotable')).default;
      const doc = new jsPDF('p', 'mm', 'a4');
      const ML = 10, MR = 10, MT = 10, MB = 10, PAGE_H = 297;
      const usableW = 210 - ML - MR;
      const activeDrivers = driverStats.filter(d => d.loadBillCount > 0);

      if (activeDrivers.length === 0) {
        alert('Kisi driver par bills nahi hain.');
        return;
      }

      for (let idx = 0; idx < activeDrivers.length; idx++) {
        const d = activeDrivers[idx];
        const driverBills = billsForDriver(d.name);
        if (driverBills.length === 0) continue;
        if (idx > 0) doc.addPage();

        const totalAmt = driverBills.reduce((sum, b) => sum + (Number(b.billNetAmt) || 0), 0);

        doc.setFontSize(13);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0, 0, 0);
        doc.text(`DRIVER: ${d.name.toUpperCase()}`, ML, 11);

        doc.setFontSize(10);
        doc.setTextColor(30, 30, 30);
        doc.text(`DEL DATE: ${displayDate}   |   BILLS: ${driverBills.length}   |   AMT: RS.${totalAmt.toLocaleString('en-IN')}`, ML, 17);

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
            b.billNo.replace(/^GST[-/]?/i, ''),
            (b.partyName || '-').substring(0, 24),
            b.billNetAmt > 0 ? b.billNetAmt.toLocaleString('en-IN') : '-',
            cash > 0 ? cash.toLocaleString('en-IN') : '-',
            gpayCell,
            chqCell,
            lc > 0 ? lc.toLocaleString('en-IN') : '-',
            isFBR ? 'FBR' : (b.paymentMode || 'UNPAID').toUpperCase(),
          ];
        });

        autoTable(doc, {
          startY: 20,
          margin: { left: ML, right: MR, top: MT, bottom: MB },
          tableWidth: usableW,
          head: [['BILL NO', 'PARTY NAME', 'BILL AMT', 'CASH', 'GPAY', 'CHEQ', 'LINE CUT', 'STATUS']],
          body: tableBody,
          showFoot: 'lastPage',
          foot: [['', 'TOTAL', totalAmt.toLocaleString('en-IN'), '', '', '', '', '']],
          pageBreak: 'auto',
          theme: 'grid',
          styles: {
            fontSize: 9,
            font: 'helvetica',
            fontStyle: 'bold',
            cellPadding: 0.35,
            minCellHeight: 2.65,
            textColor: [0, 0, 0],
            overflow: 'ellipsize',
            lineWidth: 0.15,
          },
          headStyles: { fillColor: [79, 70, 229], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9, cellPadding: 0.35, minCellHeight: 2.65 },
          footStyles: { fillColor: [79, 70, 229], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5, cellPadding: 0.35, minCellHeight: 2.65 },
          bodyStyles: { textColor: [0, 0, 0], fontStyle: 'bold' },
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
      alert('PDF generation failed. Please try again.');
    }
  }

  async function handleSaveSummary() {
    if (!popupDriver) return;
    setSaving(true);
    const newSummary: DriverDailySummary = {
      id: popupDriver.saved?.id || Math.random().toString(36).substr(2, 9),
      driverName: popupDriver.name,
      date: displayDate,
      totalBillCount: Number(popupBills) || 0,
      totalAmount: Number(popupAmt) || 0
    };
    
    const filtered = summaries.filter(s => !(s.driverName === popupDriver.name && s.date === displayDate));
    saveSummaries([...filtered, newSummary]);
    setSaving(false);
    setPopupDriver(null);
    refresh();
  }

  return (
    <div className="min-h-screen bg-background pb-6 pt-10">
      <TopNav />
      <div className="bg-primary px-3 pt-3 pb-3 rounded-b-xl shadow-lg">
        <div className="max-w-full mx-auto flex items-center justify-between gap-2">
          <div className="flex flex-col shrink-0">
            <h1 className="text-xs font-black text-primary-foreground uppercase tracking-widest">Driver Center</h1>
            <p className="text-[9px] font-bold text-primary-foreground/60 uppercase tracking-tighter">Daily Reconciliation</p>
          </div>

          {/* Template / Assignment Image & XLS Download */}
          <div className="relative shrink-0">
          <button
            onClick={() => {
              setShowTplMenu(v => !v);
              setShowRptMenu(false);
            }}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg border font-black text-[9px] uppercase tracking-wider shrink-0 bg-white/10 border-white/20 text-primary-foreground hover:bg-white/20"
            title="Driver Assignment Templates & Reports (IMG / PDF / XLS)"
          >
            <ImageIcon className="w-3 h-3" />
            TPL
          </button>

          {showTplMenu && (
            <>
              {/* backdrop */}
              <div className="fixed inset-0 z-40" onClick={() => setShowTplMenu(false)} />
              <div className="absolute right-0 top-full mt-1 z-50 flex flex-col gap-0.5 rounded-lg border border-white/20 bg-primary shadow-xl overflow-hidden min-w-[105px]">
                {/* IMG option (Driver Assignment Image matching sample format) */}
                <button
                  className="flex items-center gap-1.5 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-primary-foreground hover:bg-white/20 text-left"
                  onClick={async () => {
                    setShowTplMenu(false);
                    const res = await generateDriverAssignmentImages(bills, displayDate, selectedDate);
                    if (res.success) {
                      recordDriverDownload('TPL', selectedDate || displayDate, 'IMG');
                    } else if (res.message) {
                      alert(res.message);
                    }
                  }}
                >
                  <ImageIcon className="w-3 h-3" /> IMG
                </button>

                {/* PDF option (Driver Assignment Report PDF) */}
                <button
                  className="flex items-center gap-1.5 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-primary-foreground hover:bg-white/20 text-left"
                  onClick={async () => {
                    setShowTplMenu(false);
                    const jsPDF = (await import('jspdf')).default;
                    const autoTable = (await import('jspdf-autotable')).default;

                    const isDateMatch = (dt?: string) => {
                      if (!dt) return false;
                      const clean = dt.trim();
                      if (!clean) return false;
                      if (clean === displayDate || clean === selectedDate) return true;
                      const parts = clean.includes('/') ? clean.split('/') : clean.split('-');
                      if (parts.length === 3) {
                        let [p1, p2, p3] = parts;
                        if (p1.length === 4) {
                          return `${p3.padStart(2, '0')}/${p2.padStart(2, '0')}/${p1}` === displayDate;
                        } else {
                          return `${p1.padStart(2, '0')}/${p2.padStart(2, '0')}/${p3}` === displayDate;
                        }
                      }
                      return false;
                    };

                    const activeBills = bills.filter(b => 
                      b.driverName && 
                      b.driverName.trim() !== '' && 
                      (isDateMatch(b.deliveryDate) || isDateMatch(b.date))
                    );

                    const driverMap = new Map<string, Map<string, { count: number; date: string }>>();
                    activeBills.forEach(b => {
                      const driver = (b.driverName || 'UNASSIGNED').trim();
                      const beat = (b.beatName || 'UNASSIGNED').trim();
                      const dt = b.date || b.deliveryDate || displayDate;
                      if (!driverMap.has(driver)) driverMap.set(driver, new Map());
                      const bMap = driverMap.get(driver)!;
                      const existing = bMap.get(beat);
                      if (existing) {
                        existing.count += 1;
                      } else {
                        bMap.set(beat, { count: 1, date: dt });
                      }
                    });

                    const tableRows: any[][] = [];
                    let grandTotalBills = 0;
                    const sortedDrivers = Array.from(driverMap.keys()).sort((a, b) => a.localeCompare(b));

                    sortedDrivers.forEach(driver => {
                      const bMap = driverMap.get(driver)!;
                      const sortedBeats = Array.from(bMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
                      sortedBeats.forEach(([beat, data], idx) => {
                        grandTotalBills += data.count;
                        tableRows.push([
                          idx === 0 ? driver : '',
                          beat,
                          data.date,
                          data.count
                        ]);
                      });
                    });

                    tableRows.push(['Grand Total', '', '', grandTotalBills]);

                    const doc = new jsPDF('p', 'mm', 'a4');
                    const ML = 8;
                    doc.setFontSize(11);
                    doc.setFont('helvetica', 'bold');
                    doc.text(`DRIVER ASSIGNMENT REPORT - ${displayDate}`, ML, 10);

                    autoTable(doc, {
                      startY: 13,
                      margin: { left: ML, right: ML, top: 4, bottom: 4 },
                      head: [['HHT VAN', 'BEAT_NAME', 'Bill Date', 'Total']],
                      body: tableRows,
                      styles: {
                        font: 'helvetica',
                        fontStyle: 'bold',
                        fontSize: 9,
                        textColor: [0, 0, 0],
                        cellPadding: { top: 0.8, bottom: 0.8, left: 1.5, right: 1.5 },
                        minCellHeight: 4,
                        lineColor: [200, 200, 200],
                        lineWidth: 0.1
                      },
                      headStyles: {
                        fillColor: [220, 230, 242],
                        textColor: [0, 0, 0],
                        fontStyle: 'bold',
                        fontSize: 9,
                        cellPadding: { top: 1, bottom: 1, left: 1.5, right: 1.5 },
                        halign: 'left'
                      },
                      columnStyles: {
                        0: { cellWidth: 50, halign: 'left' },
                        1: { cellWidth: 74, halign: 'left' },
                        2: { cellWidth: 35, halign: 'center' },
                        3: { cellWidth: 35, halign: 'right' }
                      },
                      didParseCell: (data) => {
                        const rawRow = data.row.raw as any;
                        const rawFirstCell = String(rawRow?.[0] || '');
                        if (rawFirstCell === 'Grand Total') {
                          data.cell.styles.fontStyle = 'bold';
                          data.cell.styles.fillColor = [226, 232, 240];
                          data.cell.styles.textColor = [0, 0, 0];
                        }
                      }
                    });

                    doc.save(`Driver_Assignment_Report_${displayDate.replace(/\//g, '-')}.pdf`);
                    recordDriverDownload('TPL', selectedDate || displayDate, 'PDF');
                  }}
                >
                  <FileText className="w-3 h-3" /> PDF
                </button>

                {/* XLS option */}
                <button
                  className="flex items-center gap-1.5 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-primary-foreground hover:bg-white/20 text-left"
                  onClick={async () => {
                    setShowTplMenu(false);
                    const XLSX = await import('xlsx');

                    const isDateMatch = (dt?: string) => {
                      if (!dt) return false;
                      const clean = dt.trim();
                      if (!clean) return false;
                      if (clean === displayDate || clean === selectedDate) return true;
                      const parts = clean.includes('/') ? clean.split('/') : clean.split('-');
                      if (parts.length === 3) {
                        let [p1, p2, p3] = parts;
                        if (p1.length === 4) {
                          return `${p3.padStart(2,'0')}/${p2.padStart(2,'0')}/${p1}` === displayDate;
                        } else {
                          return `${p1.padStart(2,'0')}/${p2.padStart(2,'0')}/${p3}` === displayDate;
                        }
                      }
                      return false;
                    };

                    const activeBills = bills.filter(b =>
                      b.driverName &&
                      b.driverName.trim() !== '' &&
                      (isDateMatch(b.deliveryDate) || isDateMatch(b.date))
                    );

                    // Group by beatName
                    const beatMap = new Map<string, { billCount: number; totalAmount: number }>();
                    activeBills.forEach(b => {
                      const beat = (b.beatName || 'UNASSIGNED').trim();
                      let amt = 0;
                      if (typeof b.billNetAmt === 'number') {
                        amt = isNaN(b.billNetAmt) ? 0 : b.billNetAmt;
                      } else if (b.billNetAmt) {
                        const parsed = parseFloat(String(b.billNetAmt).replace(/[^0-9.-]+/g, ''));
                        amt = isNaN(parsed) ? 0 : parsed;
                      }
                      const existing = beatMap.get(beat.toLowerCase());
                      if (existing) {
                        existing.billCount += 1;
                        existing.totalAmount += amt;
                      } else {
                        beatMap.set(beat.toLowerCase(), { billCount: 1, totalAmount: amt });
                      }
                    });

                    const rows: any[] = [['DATE', 'BEAT NAME', 'TOTAL BILL COUNT', 'TOTAL AMOUNT']];
                    const sortedBeats = Array.from(beatMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
                    let grandBills = 0;
                    let grandAmt = 0;
                    sortedBeats.forEach(([beatKey, data]) => {
                      // recover original-case beat name from bills
                      const orig = activeBills.find(b => (b.beatName || 'UNASSIGNED').trim().toLowerCase() === beatKey)?.beatName?.trim() || beatKey.toUpperCase();
                      rows.push([displayDate, orig, data.billCount, Math.round(data.totalAmount)]);
                      grandBills += data.billCount;
                      grandAmt += data.totalAmount;
                    });
                    rows.push(['TOTAL', '', grandBills, Math.round(grandAmt)]);

                    const ws = XLSX.utils.aoa_to_sheet(rows);
                    ws['!cols'] = [{ wch: 14 }, { wch: 28 }, { wch: 18 }, { wch: 16 }];
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, 'Beat Summary');
                    XLSX.writeFile(wb, `Beat_Summary_${displayDate.replace(/\//g, '-')}.xlsx`);
                    recordDriverDownload('TPL', selectedDate || displayDate, 'XLS');
                  }}
                >
                  <FileBarChart2 className="w-3 h-3" /> XLS
                </button>
              </div>
            </>
          )}
          </div>

          {/* Salesperson FBR / Credit / Line Cut / Del Pending RPT Menu */}
          <div className="relative shrink-0">
          <button
            onClick={() => {
              setShowRptMenu(v => !v);
              setShowTplMenu(false);
            }}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg border font-black text-[9px] uppercase tracking-wider shrink-0 bg-white/10 border-white/20 text-primary-foreground hover:bg-white/20"
            title="Download Salesperson FBR / Credit / Line Cut / Del Pending Report (PDF / IMG)"
          >
            <FileText className="w-3 h-3" />
            PDF RPT
          </button>

          {showRptMenu && (
            <>
              {/* backdrop */}
              <div className="fixed inset-0 z-40" onClick={() => setShowRptMenu(false)} />
              <div className="absolute right-0 top-full mt-1 z-50 flex flex-col gap-0.5 rounded-lg border border-white/20 bg-primary shadow-xl overflow-hidden min-w-[105px]">
                {/* PDF Option */}
                <button
                  className="flex items-center gap-1.5 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-primary-foreground hover:bg-white/20 text-left"
                  onClick={async () => {
                    setShowRptMenu(false);
                    const jsPDF = (await import('jspdf')).default;
                    const autoTable = (await import('jspdf-autotable')).default;

                    // Calculate 1 day prior date (e.g., if selected is 18/08/2026, target is 17/08/2026)
                    let dt: Date;
                    if (selectedDate && selectedDate.includes('-')) {
                      const [y, m, d] = selectedDate.split('-').map(Number);
                      dt = new Date(y, m - 1, d);
                    } else if (displayDate && displayDate.includes('/')) {
                      const [d, m, y] = displayDate.split('/').map(Number);
                      dt = new Date(y, m - 1, d);
                    } else {
                      dt = new Date();
                    }
                    dt.setDate(dt.getDate() - 1);
                    const prevD = String(dt.getDate()).padStart(2, '0');
                    const prevM = String(dt.getMonth() + 1).padStart(2, '0');
                    const prevY = dt.getFullYear();
                    const targetDMY = `${prevD}/${prevM}/${prevY}`;
                    const targetISO = `${prevY}-${prevM}-${prevD}`;

                    const isDateMatch = (val?: string) => {
                      if (!val) return false;
                      const clean = val.trim();
                      if (!clean) return false;
                      if (clean === targetDMY || clean === targetISO) return true;
                      const parts = clean.includes('/') ? clean.split('/') : clean.split('-');
                      if (parts.length === 3) {
                        let [p1, p2, p3] = parts;
                        if (p1.length === 4) {
                          const dmy = `${p3.padStart(2, '0')}/${p2.padStart(2, '0')}/${p1}`;
                          return dmy === targetDMY;
                        } else {
                          const dmy = `${p1.padStart(2, '0')}/${p2.padStart(2, '0')}/${p3}`;
                          return dmy === targetDMY;
                        }
                      }
                      return false;
                    };

                    // STRICT: Filter bills ONLY where DEL DATE (deliveryDate) matches target 1-day prior date
                    const activeBills = bills.filter(b => isDateMatch(b.deliveryDate));

                    type RptItem = {
                      salesmanName: string;
                      partyName: string;
                      delDate: string;
                      billAmt: number;
                      driverName: string;
                      billStatus: 'FBR' | 'CREDIT' | 'DEL PENDING' | 'LINE CUT';
                    };

                    const matchedItems: RptItem[] = [];

                    activeBills.forEach(b => {
                      const sp = (b.salespersonName || '-').trim();
                      const party = (b.partyName || '-').trim();
                      const driver = (b.driverName || '-').trim();
                      const mode = (b.paymentMode || b.paymentMethod || '').toUpperCase().trim();
                      const cancelLine = (b.cancelLine || '').toUpperCase().trim();
                      const delStatus = (b.deliveryStatus || '').toUpperCase().trim();

                      let lineCut = 0;
                      if (typeof b.lineCutAmt === 'number' && !isNaN(b.lineCutAmt) && b.lineCutAmt > 0) {
                        lineCut = b.lineCutAmt;
                      } else if (b.collectedAmount && b.collectedAmount > 0 && b.billNetAmt > b.collectedAmount) {
                        lineCut = b.billNetAmt - b.collectedAmount;
                      }

                      let amt = 0;
                      if (typeof b.billNetAmt === 'number') {
                        amt = isNaN(b.billNetAmt) ? 0 : b.billNetAmt;
                      } else if (b.billNetAmt) {
                        const parsed = parseFloat(String(b.billNetAmt).replace(/[^0-9.-]+/g, ''));
                        amt = isNaN(parsed) ? 0 : parsed;
                      }

                      let status: 'FBR' | 'CREDIT' | 'DEL PENDING' | 'LINE CUT' | null = null;
                      if (mode === 'FBR' || mode === 'CANCEL' || cancelLine === 'FBR' || cancelLine === 'CANCEL') {
                        status = 'FBR';
                      } else if (mode === 'CREDIT') {
                        status = 'CREDIT';
                      } else if (mode === 'DEL PENDING' || mode === 'DELIVERY PENDING' || mode === 'PENDING' || delStatus === 'PENDING' || delStatus === 'DEL PENDING') {
                        status = 'DEL PENDING';
                      } else if (lineCut > 0) {
                        status = 'LINE CUT';
                      }

                      if (!status) return;

                      matchedItems.push({
                        salesmanName: sp,
                        partyName: party,
                        delDate: targetDMY,
                        billAmt: amt,
                        driverName: driver,
                        billStatus: status
                      });
                    });

                    // Sort by salesman name then party name
                    matchedItems.sort((a, b) => {
                      const spCmp = a.salesmanName.localeCompare(b.salesmanName);
                      if (spCmp !== 0) return spCmp;
                      return a.partyName.localeCompare(b.partyName);
                    });

                    const doc = new jsPDF('p', 'mm', 'a4');
                    const ML = 6;

                    // Header: "<DATE> BILL REPORTS" in 12px RED BOLD
                    doc.setFontSize(12);
                    doc.setFont('helvetica', 'bold');
                    doc.setTextColor(220, 38, 38); // Red color
                    doc.text(`${targetDMY} BILL REPORTS`, ML, 10);

                    const tableRows: any[][] = [];
                    let grandTotalAmt = 0;

                    if (matchedItems.length > 0) {
                      matchedItems.forEach(item => {
                        grandTotalAmt += item.billAmt;
                        tableRows.push([
                          item.salesmanName,
                          item.partyName,
                          item.delDate,
                          Math.round(item.billAmt).toLocaleString('en-IN'),
                          item.driverName,
                          item.billStatus
                        ]);
                      });

                      // Grand total row
                      tableRows.push([
                        'TOTAL',
                        `${matchedItems.length} BILLS`,
                        '',
                        Math.round(grandTotalAmt).toLocaleString('en-IN'),
                        '',
                        ''
                      ]);
                    } else {
                      tableRows.push([
                        {
                          content: `NO FBR / CREDIT / DEL PENDING / LINE CUT BILLS FOUND FOR DATE: ${targetDMY}`,
                          colSpan: 6,
                          styles: { fontStyle: 'bold', fillColor: [254, 242, 242], textColor: [220, 38, 38], halign: 'center' }
                        }
                      ]);
                    }

                    autoTable(doc, {
                      startY: 13,
                      margin: { left: ML, right: ML, top: 4, bottom: 4 },
                      head: [['SALEMAN NAME', 'PARTY NAME', 'DEL DATE', 'BILL AMT', 'DRIVER NAME', 'BILL STATUS']],
                      body: tableRows,
                      styles: {
                        font: 'helvetica',
                        fontStyle: 'bold',
                        fontSize: 9,
                        textColor: [0, 0, 0], // Black text
                        cellPadding: { top: 0.7, bottom: 0.7, left: 1, right: 1 }, // 2px compact spacing
                        minCellHeight: 4,
                        lineColor: [200, 200, 200],
                        lineWidth: 0.1,
                        overflow: 'linebreak'
                      },
                      headStyles: {
                        fillColor: [240, 243, 246],
                        textColor: [0, 0, 0],
                        fontStyle: 'bold',
                        fontSize: 9,
                        cellPadding: { top: 0.8, bottom: 0.8, left: 1, right: 1 },
                        halign: 'left'
                      },
                      columnStyles: {
                        0: { cellWidth: 38, halign: 'left' },   // SALEMAN NAME
                        1: { cellWidth: 58, halign: 'left' },   // PARTY NAME
                        2: { cellWidth: 24, halign: 'center' }, // DEL DATE
                        3: { cellWidth: 26, halign: 'right' },  // BILL AMT
                        4: { cellWidth: 32, halign: 'left' },   // DRIVER NAME
                        5: { cellWidth: 24, halign: 'center' }  // BILL STATUS
                      },
                      didParseCell: (data) => {
                        const rawRow = data.row.raw as any;
                        const rawFirstCell = String(rawRow?.[0] || '');
                        if (rawFirstCell === 'TOTAL') {
                          data.cell.styles.fontStyle = 'bold';
                          data.cell.styles.fillColor = [226, 232, 240];
                          data.cell.styles.textColor = [0, 0, 0];
                          return;
                        }
                        if (data.section === 'body') {
                          const statusVal = String(rawRow?.[5] || '');
                          if (statusVal === 'FBR') {
                            data.cell.styles.fillColor = [254, 226, 226]; // Red
                            data.cell.styles.textColor = [0, 0, 0];
                          } else if (statusVal === 'CREDIT') {
                            data.cell.styles.fillColor = [220, 252, 231]; // Green
                            data.cell.styles.textColor = [0, 0, 0];
                          } else if (statusVal === 'DEL PENDING') {
                            data.cell.styles.fillColor = [254, 249, 195]; // Yellow
                            data.cell.styles.textColor = [0, 0, 0];
                          } else if (statusVal === 'LINE CUT') {
                            data.cell.styles.fillColor = [219, 234, 254]; // Blue
                            data.cell.styles.textColor = [0, 0, 0];
                          }
                        }
                      }
                    });

                    doc.save(`${targetDMY.replace(/\//g, '-')} BILL REPORTS.pdf`);
                    recordDriverDownload('RPT', selectedDate || displayDate, 'PDF');
                  }}
                >
                  <FileText className="w-3 h-3" /> PDF
                </button>

                {/* IMG Option */}
                <button
                  className="flex items-center gap-1.5 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-primary-foreground hover:bg-white/20 text-left"
                  onClick={async () => {
                    setShowRptMenu(false);
                    const res = await generateBillReportImages(bills, displayDate, selectedDate);
                    if (res.success) {
                      recordDriverDownload('RPT', selectedDate || displayDate, 'IMG');
                    } else if (res.message) {
                      alert(res.message);
                    }
                  }}
                >
                  <ImageIcon className="w-3 h-3" /> IMG
                </button>
              </div>
            </>
          )}
          </div>

          {/* XLS Upload button */}
          <button
            onClick={() => xlsRef.current?.click()}
            className={cn(
              "flex items-center gap-1 px-2.5 py-1.5 rounded-lg border font-black text-[9px] uppercase tracking-wider shrink-0 transition-colors",
              xlsStatus === 'loading' ? "bg-white/10 border-white/20 text-white/60" :
              xlsStatus === 'ok'      ? "bg-emerald-500/20 border-emerald-400/40 text-emerald-200" :
              xlsStatus === 'err'     ? "bg-red-500/20 border-red-400/40 text-red-200" :
                                        "bg-white/10 border-white/20 text-primary-foreground hover:bg-white/20"
            )}
          >
            {xlsStatus === 'loading' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
            {xlsStatus === 'ok' ? `✓ ${(xlsStats?.updated || 0) + (xlsStats?.created || 0)}` : xlsStatus === 'err' ? 'Wrong Format' : 'XLS'}
          </button>
          <input ref={xlsRef} type="file" accept=".xlsx,.xls" multiple onChange={handleXlsUpload} className="hidden" />

          {/* Bills Report Update — direct file picker */}
          <button
            onClick={() => { setBillsRptStatus(null); billsRptRef.current?.click(); }}
            disabled={billsRptStatus?.status === 'loading'}
            className={cn(
              "flex items-center gap-1 px-2 py-1.5 rounded-lg border font-black text-[9px] uppercase tracking-wider shrink-0 transition-colors",
              billsRptStatus?.status === 'loading' ? "bg-white/10 border-white/20 text-white/60" :
              billsRptStatus?.status === 'success'  ? "bg-emerald-500/20 border-emerald-400/40 text-emerald-200" :
              billsRptStatus?.status === 'error'    ? "bg-red-500/20 border-red-400/40 text-red-200" :
                                                      "bg-white/10 border-white/20 text-primary-foreground hover:bg-white/20"
            )}
            title="Bills Report Update"
          >
            {billsRptStatus?.status === 'loading' ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileBarChart2 className="w-3 h-3" />}
            {billsRptStatus?.status === 'loading' ? '…' : billsRptStatus?.status === 'success' ? '✓ RPT' : billsRptStatus?.status === 'error' ? 'ERR' : 'RPT'}
          </button>
          <input
            ref={billsRptRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              await processBillsReportFile(file, setBillsRptStatus);
            }}
          />

          {/* Date picker */}
          {(() => {
            const role = getRole();
            const canBackDate = role === 'owner' || (role === 'user' && getUserPerm(getLoggedInName()).canBackDate);
            return (
              <div className={cn("bg-white/10 px-2 py-1.5 rounded-xl flex items-center gap-1.5 border border-white/20 flex-1 min-w-0", !canBackDate && "opacity-70")}>
                <CalendarDays className="w-3.5 h-3.5 text-primary-foreground/70 shrink-0" />
                <input
                  type="date"
                  value={selectedDate}
                  disabled={!canBackDate}
                  onChange={e => setSelectedDate(e.target.value)}
                  className="bg-transparent border-0 text-[11px] font-black text-primary-foreground focus:outline-none uppercase text-right w-full min-w-0 disabled:cursor-not-allowed"
                  style={{ colorScheme: 'dark' }}
                />
              </div>
            );
          })()}
        </div>
        {xlsStatus === 'ok' && xlsStats && (
          <p className="text-[9px] font-black text-emerald-300 mt-1 text-right">
            Assigned: {xlsStats.updated} · Created: {xlsStats.created} · Total: {xlsStats.updated + xlsStats.created} bills
          </p>
        )}
        {billsRptStatus && billsRptStatus.status !== 'loading' && (
          <div className={cn("mt-1 px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider",
            billsRptStatus.status === 'success' ? "bg-emerald-500/20 text-emerald-200" : "bg-red-500/20 text-red-200"
          )}>
            {billsRptStatus.message}
            {billsRptStatus.details?.slice(0, 2).map((d, i) => (
              <div key={i} className="text-[8px] font-bold opacity-80 mt-0.5">{d}</div>
            ))}
          </div>
        )}
        {billsRptStatus?.status === 'loading' && (
          <p className="text-[9px] font-black text-primary-foreground/70 mt-1 animate-pulse">{billsRptStatus.message}</p>
        )}
      </div>

      <div className="max-w-full mx-auto px-2 mt-2 space-y-2">

        {/* ── Manual Bill Assignment Form ── */}
        <div className="bg-card rounded-xl border border-border p-3 shadow-sm">
          <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mb-2 flex items-center gap-1">
            <Plus className="w-3 h-3" /> Assign Bill to Driver
          </p>
          <div className="flex gap-2 items-end">
            <div className="flex-1 space-y-1">
              <label className="text-[8px] font-black text-muted-foreground uppercase">Bill No</label>
              <input
                type="text" inputMode="numeric" placeholder="e.g. 12345"
                value={assignBillNo}
                onChange={e => { setAssignBillNo(e.target.value); setAssignMsg(null); }}
                onKeyDown={e => e.key === 'Enter' && handleAssignBill()}
                className="w-full h-9 px-2 bg-muted rounded-lg text-[11px] font-black border-0 outline-none focus:ring-2 focus:ring-primary/30 uppercase"
              />
            </div>
            <div className="flex-1 space-y-1">
              <label className="text-[8px] font-black text-muted-foreground uppercase">Driver</label>
              <select
                value={assignDriver}
                onChange={e => { setAssignDriver(e.target.value); setAssignMsg(null); }}
                className="w-full h-9 px-2 bg-muted rounded-lg text-[11px] font-black border-0 outline-none focus:ring-2 focus:ring-primary/30 uppercase"
              >
                <option value="">Select</option>
                {drivers.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
              </select>
            </div>
            <Button
              onClick={handleAssignBill}
              disabled={assignSaving || !assignBillNo || !assignDriver}
              className="h-9 px-3 rounded-lg font-black text-[10px] uppercase shrink-0"
            >
              {assignSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save'}
            </Button>
          </div>
          {assignMsg && (
            <p className={cn("text-[9px] font-black mt-1.5 flex items-center gap-1", assignMsg.type === 'ok' ? "text-emerald-600" : "text-destructive")}>
              {assignMsg.type === 'ok' ? <CheckCircle2 className="w-3 h-3" /> : '✕'} {assignMsg.text}
            </p>
          )}
        </div>

        {/* ── Driver Cards ── */}
        <div className="flex items-center justify-between mb-1">
          <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">Driver Summary</p>
          <button
            onClick={() => setShowPendingOnly(v => !v)}
            className={cn(
              "flex items-center gap-1 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-wide border transition-colors",
              showPendingOnly
                ? "bg-amber-100 border-amber-400 text-amber-700"
                : "bg-muted border-border text-muted-foreground hover:border-primary/40"
            )}
          >
            <span>{showPendingOnly ? "⏳" : "📋"}</span>
            {showPendingOnly ? "Dispatched Unpaid" : "All Bills"}
          </button>
          <button
            onClick={handlePrintAllDriversPDF}
            className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-wide border bg-white/10 border-white/20 text-primary-foreground hover:bg-white/20"
            title="Download PDF for all drivers"
          >
            <FileText className="w-3 h-3" />
            ALL PDF
          </button>
        </div>
        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="animate-spin text-primary" /></div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
            {driverStats.filter(d => d.loadBillCount > 0).length === 0 ? (
              <div className="col-span-full py-10 text-center bg-card/60 rounded-xl border border-dashed border-border p-6 my-2">
                <p className="text-xs font-bold text-muted-foreground">Is date ({displayDate}) par kisi driver par bill assign nahi hai.</p>
                <p className="text-[11px] text-muted-foreground/80 mt-1">Upar HHT / Van XLS upload karein ya niche manual Bill Assign panel use karein.</p>
              </div>
            ) : (
              driverStats.filter(d => d.loadBillCount > 0).map((d) => (
              <div
                key={d.id}
                onClick={() => {
                  setPopupDriver(d);
                  setPopupBills(String(d.loadBillCount || ''));
                  setPopupAmt(String(d.loadAmt || ''));
                }}
                className="bg-card rounded-xl border border-border p-2 shadow-sm active:scale-[0.98] transition-transform cursor-pointer relative"
              >
                {/* Header: name + count badge + PDF button */}
                <div className="flex items-center justify-between mb-1.5 gap-1">
                  <h3 className="text-[11px] font-black uppercase text-primary truncate flex-1 min-w-0">{d.name}</h3>
                  <span className="text-[10px] font-black bg-primary/10 text-primary px-1.5 py-0.5 rounded-full shrink-0">
                    L:{d.loadBillCount || 0}
                  </span>
                  <button
                    onClick={e => handlePrintDriverPDF(d, e)}
                    title="Download PDF"
                    className="shrink-0 w-5 h-5 flex items-center justify-center rounded-lg bg-rose-50 text-rose-500 hover:bg-rose-500 hover:text-white transition-colors border border-rose-200"
                  >
                    <FileText className="w-3 h-3" />
                  </button>
                  <button
                    onClick={e => handleWABulkSend(d, e)}
                    title="Send WhatsApp to all bills"
                    disabled={waSending === d.name}
                    className="shrink-0 w-6 h-6 flex items-center justify-center rounded-lg bg-green-50 text-green-600 hover:bg-green-500 hover:text-white transition-colors border border-green-200 disabled:opacity-50"
                  >
                    {waSending === d.name ? <Loader2 className="w-3 h-3 animate-spin" /> : <MessageCircle className="w-3 h-3" />}
                  </button>
                </div>

                {/* Total load amount */}
                <div className="flex justify-between items-center mb-1">
                  <p className="text-[10px] font-black text-muted-foreground uppercase">Amt</p>
                  <p className="text-[10px] font-black text-foreground">₹{(d.loadAmt || 0).toLocaleString('en-IN')}</p>
                </div>

                {/* Date-grouped bill list with delete buttons */}
                {d.billNos.length > 0 && (
                  <div className="bg-muted/60 rounded-lg p-1 mb-1.5 max-h-44 overflow-y-auto space-y-1">
                    {(() => {
                      const grouped: Record<string, typeof bills> = {};
                      billsForDriver(d.name).forEach(b => {
                        const key = b.deliveryDate || '—';
                        if (!grouped[key]) grouped[key] = [];
                        grouped[key].push(b);
                      });
                      return Object.entries(grouped)
                        .sort(([a], [b]) => {
                          if (a === '—') return 1;
                          if (b === '—') return -1;
                          try {
                            const [da,ma,ya] = a.split('/');
                            const [db,mb,yb] = b.split('/');
                            return new Date(+ya,+ma-1,+da).getTime() - new Date(+yb,+mb-1,+db).getTime();
                          } catch { return 0; }
                        })
                        .map(([date, dBills]) => {
                          const paidCnt = dBills.filter(isBillPaidOrFbrOrDelPending).length;
                          const isSelDate = date === displayDate;
                          return (
                            <div key={date}>
                              <div className="flex items-center gap-1 px-0.5 mb-0.5">
                                <span className={cn("text-[7px] font-black px-1 py-0.5 rounded", isSelDate ? "bg-primary text-primary-foreground" : "bg-amber-100 text-amber-700")}>
                                  {date}
                                </span>
                                <span className={cn("text-[7px] font-bold", paidCnt === dBills.length ? "text-emerald-600" : "text-muted-foreground")}>
                                  {paidCnt}/{dBills.length} paid
                                </span>
                              </div>
                              <div className="space-y-0.5 pl-1">
                                {dBills.map(b => {
                                  const bn = b.billNo.replace(/^GST/i, '');
                                  const paid = !!b.paymentDate;
                                  const isFBRBill = b.paymentMode === 'FBR' || b.paymentMode === 'Cancel';
                                  const isCreditBill = b.paymentMode === 'Credit';
                                  const isPendingBill = b.paymentMode === 'Pending' || b.paymentMode === 'Del Pending';
                                  return (
                                    <div key={b.billNo} className={cn("flex items-center gap-1 rounded px-0.5",
                                      isFBRBill ? "bg-red-300" :
                                      isCreditBill ? "bg-green-300" :
                                      isPendingBill ? "bg-yellow-200" : ""
                                    )}>
                                      <span className={cn("text-[8px] font-black shrink-0", paid ? "text-emerald-600" : isCreditBill ? "text-black" : "text-foreground")}>
                                        {paid ? '✓' : '·'} {bn}
                                      </span>
                                      <span className="text-[7px] text-muted-foreground flex-1 truncate">
                                        ₹{(b.billNetAmt||0).toLocaleString('en-IN')}
                                      </span>
                                      {getRole() === 'owner' && (
                                        <button
                                          onClick={e => { e.stopPropagation(); handleDeleteBillAssignment(b.billNo, date, e); }}
                                          className="shrink-0 w-4 h-4 flex items-center justify-center rounded-full bg-destructive/10 text-destructive hover:bg-destructive hover:text-white transition-colors cursor-pointer"
                                          title="Remove assignment"
                                        >
                                          <Trash2 className="w-2.5 h-2.5" />
                                        </button>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        });
                    })()}
                  </div>
                )}

                <div className="border-t border-dashed border-border/50 pt-1 space-y-1">
                  <div className="flex justify-between items-center">
                    <p className="text-[10px] font-black text-muted-foreground uppercase">Rec</p>
                    <p className="text-[10px] font-black text-emerald-600">₹{d.totalCollected.toLocaleString('en-IN')}</p>
                  </div>
                  <div className="flex justify-between items-center">
                    <p className="text-[10px] font-black text-rose-600 uppercase">FBR</p>
                    <p className="text-[10px] font-black text-rose-600">{d.cancelCount}</p>
                  </div>
                  <div className="flex justify-between items-center">
                    <p className="text-[10px] font-black text-amber-600 uppercase">Baki</p>
                    <p className="text-[10px] font-black text-amber-600">{d.pendingCount}</p>
                  </div>
                  <div className="flex justify-between items-center pt-0.5 border-t border-border/20">
                    <p className="text-[10px] font-black text-destructive uppercase">Diff</p>
                    <p className={cn("text-[10px] font-black", d.shortage > 0 ? "text-destructive" : "text-emerald-600")}>
                      ₹{d.shortage.toLocaleString('en-IN')}
                    </p>
                  </div>
                </div>

              </div>
            )))}
          </div>
        )}

        {/* ── Del Pending Carry-Forward Table ── */}
        {delPendingBills.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[9px] font-black text-amber-600 uppercase tracking-widest">⏳ Delivery Pending</span>
              <span className="bg-amber-100 text-amber-700 text-[9px] font-black px-2 py-0.5 rounded-full">{delPendingBills.length}</span>
              <span className="text-[8px] font-bold text-muted-foreground uppercase ml-1">carry forward until paid / FBR</span>
            </div>

            {/* Bulk assign bar — visible when any rows are selected */}
            {selectedDpBills.size > 0 && (
              <div className="flex items-center gap-2 mb-2 p-2 bg-amber-50 border border-amber-300 rounded-xl">
                <span className="text-[9px] font-black text-amber-700 uppercase shrink-0">
                  {selectedDpBills.size} selected
                </span>
                <select
                  value={bulkDriver}
                  onChange={e => setBulkDriver(e.target.value)}
                  className="flex-1 bg-white border border-amber-300 rounded-lg px-2 py-1.5 text-[9px] font-black text-foreground focus:outline-none focus:ring-1 focus:ring-amber-400 uppercase cursor-pointer"
                >
                  <option value="">Select Driver</option>
                  {drivers.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                </select>
                <button
                  onClick={handleBulkAssign}
                  disabled={!bulkDriver}
                  className="shrink-0 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white text-[9px] font-black uppercase rounded-lg transition-colors"
                >
                  Assign All
                </button>
                <button
                  onClick={() => setSelectedDpBills(new Set())}
                  className="shrink-0 text-[9px] font-black text-muted-foreground hover:text-foreground uppercase"
                >
                  Clear
                </button>
              </div>
            )}

            <div className="rounded-xl border border-amber-200 overflow-hidden shadow-sm bg-white">
              <div className="overflow-x-auto">
                <table className="w-full text-[10px] font-black min-w-[420px]">
                  <thead>
                    <tr className="bg-amber-50 border-b border-amber-200">
                      <th className="px-2 py-2 text-center w-8">
                        <input
                          type="checkbox"
                          checked={selectedDpBills.size === delPendingBills.length && delPendingBills.length > 0}
                          onChange={() => toggleAllDpBills(delPendingBills.map(b => b.billNo))}
                          className="w-3.5 h-3.5 accent-amber-500 cursor-pointer"
                        />
                      </th>
                      {(['billNo', 'deliveryDate', 'driverName'] as const).map(col => (
                        <th
                          key={col}
                          onClick={() => { setDpSortCol(col); setDpSortDir(d => dpSortCol === col ? (d === 'asc' ? 'desc' : 'asc') : 'asc'); }}
                          className="px-3 py-2 text-left text-amber-700 uppercase tracking-wider cursor-pointer hover:bg-amber-100 select-none"
                        >
                          {col === 'billNo' ? 'Bill No' : col === 'deliveryDate' ? 'Del Date' : 'Driver'}
                          {dpSortCol === col && <span className="ml-1">{dpSortDir === 'asc' ? '▲' : '▼'}</span>}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-left text-amber-700 uppercase tracking-wider">Assign For Today</th>
                    </tr>
                  </thead>
                  <tbody>
                    {delPendingBills.map((b, i) => {
                      const isSelected = selectedDpBills.has(b.billNo);
                      return (
                        <tr
                          key={b.billNo}
                          onClick={() => toggleDpBill(b.billNo)}
                          className={cn(
                            "border-b border-amber-100 transition-colors cursor-pointer",
                            isSelected ? "bg-amber-100" : i % 2 === 0 ? "bg-white hover:bg-amber-50/50" : "bg-amber-50/30 hover:bg-amber-50/50"
                          )}
                        >
                          <td className="px-2 py-2 text-center" onClick={e => { e.stopPropagation(); toggleDpBill(b.billNo); }}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleDpBill(b.billNo)}
                              className="w-3.5 h-3.5 accent-amber-500 cursor-pointer"
                              onClick={e => e.stopPropagation()}
                            />
                          </td>
                          <td className="px-3 py-2 text-foreground font-black">{b.billNo.replace(/^GST/i, '')}</td>
                          <td className="px-3 py-2 text-muted-foreground">{b.deliveryDate || b.date || '—'}</td>
                          <td className="px-3 py-2 text-foreground truncate max-w-[90px]">{b.driverName || '—'}</td>
                          <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                            {dpSaving[b.billNo] ? (
                              <span className="flex items-center gap-1 text-emerald-600">
                                <Loader2 className="w-3 h-3 animate-spin" /> Saved
                              </span>
                            ) : (
                              <select
                                defaultValue=""
                                onChange={e => handleReassignDelPending(b.billNo, e.target.value)}
                                className="w-full bg-amber-50 border border-amber-300 rounded-lg px-1.5 py-1 text-[9px] font-black text-foreground focus:outline-none focus:ring-1 focus:ring-amber-400 uppercase cursor-pointer"
                              >
                                <option value="">Select Driver</option>
                                {drivers.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                              </select>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {popupDriver && (
        <div className="fixed inset-0 bg-black/60 z-[200] flex items-center justify-center p-6 backdrop-blur-sm">
          <div className="bg-card rounded-2xl p-5 w-full max-w-xs shadow-2xl animate-in zoom-in-95">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-black text-xs uppercase text-primary">{popupDriver.name}</h3>
              <button onClick={() => setPopupDriver(null)}><X className="w-5 h-5 text-muted-foreground" /></button>
            </div>
            <div className="space-y-3 mb-6">
              <div className="space-y-1">
                <label className="text-[8px] font-black text-muted-foreground uppercase tracking-widest">Total Bills</label>
                <input
                  type="number" inputMode="numeric" value={popupBills} onChange={e => setPopupBills(e.target.value)}
                  className="w-full h-10 px-3 bg-muted rounded-lg font-black text-xs border-0 focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[8px] font-black text-muted-foreground uppercase tracking-widest">Total Amount (₹)</label>
                <input
                  type="number" inputMode="numeric" value={popupAmt} onChange={e => setPopupAmt(e.target.value)}
                  className="w-full h-10 px-3 bg-muted rounded-lg font-black text-xs border-0 focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>
            <Button onClick={handleSaveSummary} disabled={saving} className="w-full h-11 rounded-xl uppercase font-black text-xs tracking-widest">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Load'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

