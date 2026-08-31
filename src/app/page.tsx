import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Check, Loader2, RotateCcw, Pencil, Wallet, Smartphone, Landmark, Hash, Trash2, X, Calendar, ListPlus, Mic, MicOff, Volume2, Banknote, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBillStore } from '@/hooks/use-bill-store';
import { savePayment, getSystemPassword, getBills, saveBills, patchBillInMemory, patchBillDirect, setDailyUnlocked, getBanks, getUserPerm, getBillSearchAutoResetSec, addBillsToMemoryOnly, getSalespersonContacts, saveSalespersonContacts, findSalespersonContact, cleanSalespersonName, calculateBillDiscountPercent, Bill } from '@/lib/billStore';
import { getRole, getLoggedInName } from '@/lib/auth';
import { cn } from '@/lib/utils';
import TopNav from '@/components/TopNav';
import DriverDayTable from '@/components/DriverDayTable';
import MultiBillEntryModal from '@/components/MultiBillEntryModal';
import BankCombobox from '@/components/BankCombobox';
import CashBreakdownModal from '@/components/CashBreakdownModal';
import { parseVoiceCommand, hasWakeWord, stripWakeWord } from '@/lib/voiceNumber';
import { isGreenParty } from '@/lib/greenParties';
import { getCommissionMocs, CommissionMoc, isMocBill, formatMocBillNo, formatMocPartyName, getNextMocSrNo, getMocEntries, isBillMatchingMocCode, extractMocNumber, extractMocSrNumber, formatMocSerialBillNo, getDisplayBillNo } from '@/lib/commissionMoc';
import { getDriverDownloadStatus } from '@/lib/driverDownloadStatus';

// Modular Modals
import FbrReasonModal from '@/components/FbrReasonModal';
import DatePickerModal from '@/components/DatePickerModal';
import DatePwModal from '@/components/DatePwModal';
import ResetPwModal from '@/components/ResetPwModal';
import BillDetailsModal from '@/components/BillDetailsModal';
import LineCutPopup from '@/components/LineCutPopup';
import OverflowModal from '@/components/OverflowModal';
import { getTodayISO, getTodayDMY, isoToDisplay, displayToIso } from '@/lib/dateUtils';

// Line-cut amounts are sometimes entered as a quick sum, e.g. "100+128+335".
// Keep this deliberately limited to numbers and plus signs; never evaluate input
// as JavaScript.
function parseAmountExpression(value: string | number | undefined | null): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const rawStr = String(value || '').trim();
  if (!rawStr) return 0;

  const cleaned = rawStr.replace(/,/g, '');

  if (cleaned.includes('+')) {
    const parts = cleaned.split('+');
    let sum = 0;
    let hasValid = false;
    for (const part of parts) {
      const numStr = part.replace(/[^\d.-]/g, '').trim();
      if (numStr && numStr !== '-' && numStr !== '.') {
        const n = parseFloat(numStr);
        if (!isNaN(n) && Number.isFinite(n)) {
          sum += n;
          hasValid = true;
        }
      }
    }
    if (hasValid) return Math.round(sum * 100) / 100;
  }

  const sanitized = cleaned.replace(/[^\d.-]/g, '').trim();
  if (sanitized && sanitized !== '-' && sanitized !== '.') {
    const n = parseFloat(sanitized);
    if (!isNaN(n) && Number.isFinite(n)) return Math.round(n * 100) / 100;
  }

  return 0;
}

export default function Dashboard() {
  const { bills, drivers, banks, loading, refresh } = useBillStore();
  
  const [selectedBillNo, setSelectedBillNo] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [dropdownIndex, setDropdownIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  
  const [cashAmt, setCashAmt] = useState('');
  const [upiAmt, setUpiAmt] = useState('');
  const [chqAmt, setChqAmt] = useState('');
  const [bankName, setBankName] = useState('');
  const [chequeNo, setChequeNo] = useState('');
  const [chequeDate, setChequeDate] = useState('');
  const [chqDateDD, setChqDateDD] = useState(''); // only DD part shown in input
  
  const [paymentMode, setPaymentMode] = useState('');
  const [confirmInput, setConfirmInput] = useState('');
  const [delPendingDriver, setDelPendingDriver] = useState('');
  
  const billInputRef = useRef<HTMLInputElement>(null);
  const cashInputRef = useRef<HTMLInputElement>(null);
  const upiInputRef = useRef<HTMLInputElement>(null);
  const chqInputRef = useRef<HTMLInputElement>(null);
  const chequeNoRef = useRef<HTMLInputElement>(null);
  const chqDateRef  = useRef<HTMLInputElement>(null);
  const bankInputRef = useRef<HTMLInputElement>(null);
  const fbrBtnRef = useRef<HTMLButtonElement>(null);
  const creditBtnRef = useRef<HTMLButtonElement>(null);
  const delPendBtnRef = useRef<HTMLButtonElement>(null);
  const highlightedItemRef = useRef<HTMLButtonElement>(null);

  const [selectedDriver, setSelectedDriver] = useState('');
  const [dashDate, setDashDate] = useState(() => getTodayISO());
  const [commissionMocs, setCommissionMocs] = useState<CommissionMoc[]>(() => getCommissionMocs());
  const [showMocModal, setShowMocModal] = useState(false);
  const [showSalespersonPhoneModal, setShowSalespersonPhoneModal] = useState(false);
  const [spModalSalespersonName, setSpModalSalespersonName] = useState('');
  const [spModalPhone, setSpModalPhone] = useState('');
  const [spPendingBill, setSpPendingBill] = useState<Bill | null>(null);
  const [downloadStatus, setDownloadStatus] = useState(() => getDriverDownloadStatus(dashDate));
  const [autoCreditWa, setAutoCreditWa] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('vitratrack_auto_credit_wa');
      return saved !== null ? saved === 'true' : true;
    } catch {
      return true;
    }
  });

  const toggleAutoCreditWa = () => {
    setAutoCreditWa(prev => {
      const next = !prev;
      try {
        localStorage.setItem('vitratrack_auto_credit_wa', String(next));
      } catch {}
      return next;
    });
  };

  useEffect(() => {
    setDownloadStatus(getDriverDownloadStatus(dashDate));
    const handleDownloadUpdate = () => {
      setDownloadStatus(getDriverDownloadStatus(dashDate));
    };
    window.addEventListener('vt-driver-downloads-updated', handleDownloadUpdate);
    window.addEventListener('storage', handleDownloadUpdate);
    return () => {
      window.removeEventListener('vt-driver-downloads-updated', handleDownloadUpdate);
      window.removeEventListener('storage', handleDownloadUpdate);
    };
  }, [dashDate]);

  useEffect(() => {
    setCommissionMocs(getCommissionMocs());
    const onMocUpdate = () => setCommissionMocs(getCommissionMocs());
    window.addEventListener('vt-commission-mocs-updated', onMocUpdate);
    return () => window.removeEventListener('vt-commission-mocs-updated', onMocUpdate);
  }, []);

  const assignedDriverNames = useMemo(() => {
    const s = new Set<string>();
    const disp = isoToDisplay(dashDate);
    for (const b of bills) {
      if (b.driverName) {
        const dName = b.driverName.trim().toUpperCase();
        if (dName && (b.deliveryDate === disp || (!b.deliveryDate && b.paymentDate === disp))) {
          s.add(dName);
        }
      }
    }
    return s;
  }, [bills, dashDate]);

  const [showDiffConfirm, setShowDiffConfirm] = useState(false);
  const [showPaidPopup, setShowPaidPopup] = useState(false);
  const [showCashBreakdownModal, setShowCashBreakdownModal] = useState(false);
  const [lastSavedBill, setLastSavedBill] = useState<{ billNo: string; partyName?: string; diff: number } | null>(null);
  const [pendingSelectBill, setPendingSelectBill] = useState<string | null>(null);

  // Overflow chain state — all bills collected first, saved together at end
  const [showOverflowModal, setShowOverflowModal] = useState(false);
  const [overflowPendingItems, setOverflowPendingItems] = useState<Array<{ billNo: string; partyName: string; billNetAmt: number; lineCutInput: string }>>([]);
  const [overflowTotalCollected, setOverflowTotalCollected] = useState(0);
  const [overflowMode, setOverflowMode] = useState('');
  const [overflowEffectiveDriver, setOverflowEffectiveDriver] = useState('');
  const [overflowChequeSaved, setOverflowChequeSaved] = useState('');
  const [overflowBankSaved, setOverflowBankSaved] = useState('');
  const [overflowChequeDateSaved, setOverflowChequeDateSaved] = useState('');
  const [overflowRecDateSaved, setOverflowRecDateSaved] = useState('');
  const [overflowNextBillInput, setOverflowNextBillInput] = useState('');
  const [overflowNextBillErr, setOverflowNextBillErr] = useState('');
  const [overflowSaving, setOverflowSaving] = useState(false);
  const overflowInputRef = useRef<HTMLInputElement>(null);

  // Voice Search & Audio Speech Synthesis State
  const [isListening, setIsListening] = useState(false);
  const isListeningRef = useRef(false);
  const [voiceFeedback, setVoiceFeedback] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const [wakeMode, setWakeMode] = useState(false);
  const wakeRecRef = useRef<any>(null);
  const [voiceAutoSave, setVoiceAutoSave] = useState<{ billNo: string; amount: number } | null>(null);

  const [editLocked, setEditLocked] = useState(true);

  const [showMultiBillModal, setShowMultiBillModal] = useState(false);
  const [showFbrReasonModal, setShowFbrReasonModal] = useState(false);

  // ── Line Cut Amount Popup (partial payment confirm) ──────────────────────────
  const [showLineCutPopup, setShowLineCutPopup] = useState(false);
  const [lcInputVal, setLcInputVal] = useState('');
  const [lcAsOutstanding, setLcAsOutstanding]   = useState(false); // OS checkbox in LC popup


  const saveBtnRef = useRef<HTMLButtonElement>(null);

  const [showDatePwModal, setShowDatePwModal] = useState(false);
  const [showResetPwModal, setShowResetPwModal] = useState(false);
  const [datePwInput, setDatePwInput] = useState('');
  const [datePwError, setDatePwError] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [pendingDate, setPendingDate] = useState('');

  // ── REC DATE confirmation on edit of an already-paid bill ────────────────────
  // When an already-saved bill (has paymentDate) is unlocked & re-edited, show the
  // existing REC date for confirmation before saving. If changed, the new date is
  // what gets written to Supabase; otherwise the original date is kept as-is.
  const [showRecDateConfirm, setShowRecDateConfirm] = useState(false);
  const [recDateInput, setRecDateInput] = useState(''); // ISO yyyy-mm-dd for the date input
  const [recDateOverride, setRecDateOverride] = useState<string | null>(null); // DD/MM/YYYY to force on save

  // ── Draft auto-save / restore ─────────────────────────────────────────────────
  const [showDraftRestored, setShowDraftRestored] = useState(false);
  const draftRestoredRef = useRef(false);

  // Track all bills saved by owner (persisted per date in Supabase so driver entries are excluded)
  const [ownerSavedBillNos, setOwnerSavedBillNos] = useState<string[]>([]);
  // Tracks which dashDate's owner-entries have been fully loaded from Supabase.
  // Guards the persist effect against cross-date writes when dashDate changes mid-flight.
  const ownerEntriesLoadedDateRef = useRef<string>('');

  useEffect(() => {
    const role = getRole();
    // For user role: auto-set selectedDriver to their name so they see their own entries
    if (role === 'user') {
      const name = getLoggedInName();
      if (name) {
        setSelectedDriver(name);
        sessionStorage.setItem('vitratrack_selected_driver', name);
        return;
      }
    }
    const savedDriver = sessionStorage.getItem('vitratrack_selected_driver');
    if (savedDriver) {
      setSelectedDriver(savedDriver);
    }
  }, []);

  // Persist dashDate in localStorage so it survives tab close/reopen
  useEffect(() => { localStorage.setItem('vitratrack_dash_date', dashDate); }, [dashDate]);

  // ── Draft auto-save: save form state to localStorage whenever user is mid-entry ──
  // Debounced by 400ms so typing digits doesn't freeze the main thread on every keypress.
  useEffect(() => {
    if (!selectedBillNo) return;
    const timer = setTimeout(() => {
      const draft = {
        dashDate, selectedBillNo, selectedDriver,
        cashAmt, upiAmt, chqAmt,
        chequeNo, bankName, chequeDate, chqDateDD,
        paymentMode, confirmInput, recDateOverride,
      };
      try { localStorage.setItem('vt_dash_draft', JSON.stringify(draft)); } catch {}
    }, 400);
    return () => clearTimeout(timer);
  }, [selectedBillNo, selectedDriver, cashAmt, upiAmt, chqAmt, chequeNo, bankName, chequeDate, chqDateDD, paymentMode, confirmInput, recDateOverride, dashDate]);

  // When date changes, load owner entries for that date from Supabase.
  // State is immediately reset to [] to prevent stale previous-date data from showing.
  // The loaded-date ref is reset to gate the persist effect until the fetch completes.
  // The cleanup sets `cancelled = true` so out-of-order responses from rapid date
  // switches are discarded — only the latest dashDate's response is applied.
  // On fetch failure the ref is still set (with [] fallback) so subsequent owner saves
  // for the active date can still persist to Supabase.
  useEffect(() => {
    ownerEntriesLoadedDateRef.current = targetDateForEffect(dashDate);
    const targetDate = dashDate;
    // Check local session cache first for instant zero-flicker display
    try {
      const cached = sessionStorage.getItem(`vt_owner_saved_${targetDate}`);
      if (cached) setOwnerSavedBillNos(JSON.parse(cached));
      else setOwnerSavedBillNos([]);
    } catch {
      setOwnerSavedBillNos([]);
    }
    let cancelled = false;
    import('@/lib/apiSync')
      .then(m => m.apiGetOwnerEntries(targetDate))
      .then(({ ok, data }) => {
        if (cancelled) return;
        ownerEntriesLoadedDateRef.current = targetDate;
        if (ok && Array.isArray(data)) {
          setOwnerSavedBillNos(prev => {
            const combined = Array.from(new Set([...prev, ...data]));
            try { sessionStorage.setItem(`vt_owner_saved_${targetDate}`, JSON.stringify(combined)); } catch {}
            return combined;
          });
        }
      })
      .catch(() => {
        if (cancelled) return;
        ownerEntriesLoadedDateRef.current = targetDate;
      });
    return () => { cancelled = true; };
  }, [dashDate]);

  function targetDateForEffect(d: string) { return d; }

  // Persist owner-saved bill nos to Supabase whenever they change.
  useEffect(() => {
    if (ownerEntriesLoadedDateRef.current !== dashDate) return;
    try { sessionStorage.setItem(`vt_owner_saved_${dashDate}`, JSON.stringify(ownerSavedBillNos)); } catch {}
    import('@/lib/apiSync')
      .then(m => m.apiPushSetting(`owner_entries_${dashDate}`, JSON.stringify(ownerSavedBillNos)))
      .catch(() => {});
  }, [ownerSavedBillNos, dashDate]);

  // Debounce search query so heavy filter doesn't fire on every keystroke
  useEffect(() => {
    if (!searchQuery) { setDebouncedQuery(''); return; }
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 60);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Auto-reset search input query after configured seconds (e.g. 2s, 4s, or 0 = disabled) so the field clears for next input
  const searchResetTimerRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (!searchQuery) return;
    const resetSec = getBillSearchAutoResetSec();
    if (resetSec <= 0) return; // 0 = disabled

    if (searchResetTimerRef.current) clearTimeout(searchResetTimerRef.current);

    searchResetTimerRef.current = setTimeout(() => {
      setSearchQuery('');
      setShowDropdown(false);
    }, resetSec * 1000);

    return () => {
      if (searchResetTimerRef.current) clearTimeout(searchResetTimerRef.current);
    };
  }, [searchQuery]);

  const displayDate = isoToDisplay(dashDate);

  const billMap = useMemo(() => {
    const m = new Map<string, typeof bills[0]>();
    for (const b of bills) {
      if (b.billNo) m.set(b.billNo, b);
      if (b.id) m.set(b.id, b);
    }
    for (const moc of commissionMocs) {
      if (!m.has(moc.code)) {
        const mocNum = extractMocNumber(moc.code) || '1';
        m.set(moc.code, {
          id: `moc_virtual_${moc.code.replace(/\s+/g, '_')}`,
          srNo: '1',
          date: displayDate,
          deliveryDate: displayDate,
          salespersonName: 'MOC',
          collectionCode: 'MOC',
          billNo: moc.code,
          partyCode: `MOC${mocNum}`,
          partyHulCode: `MOC${mocNum}`,
          partyName: formatMocPartyName('', moc.code),
          beatName: 'COMMISSION',
          billNetAmt: 0,
          collectedAmount: 0,
          outstandingAmount: 0,
          billAgeing: 0,
          paymentMode: 'Cash',
          driverName: selectedDriver || 'OWNER',
        } as any);
      }
    }
    return m;
  }, [bills, commissionMocs, displayDate, selectedDriver]);

  // ── Draft restore: once bills load, check for a saved draft and apply it ──────
  // Must be placed after billMap so the map is accessible in the effect body.
  useEffect(() => {
    if (loading || draftRestoredRef.current) return;
    draftRestoredRef.current = true;
    try {
      const raw = localStorage.getItem('vt_dash_draft');
      if (!raw) return;
      const d = JSON.parse(raw);
      if (!d.selectedBillNo || d.dashDate !== dashDate) return; // different date = stale
      if (!billMap.has(d.selectedBillNo)) return;              // bill not in memory
      // Restore form state directly (skip handleBillSelect to preserve draft amounts)
      setSelectedBillNo(d.selectedBillNo);
      setSearchQuery(d.selectedBillNo);
      setSelectedDriver(d.selectedDriver || '');
      setCashAmt(d.cashAmt || '');
      setUpiAmt(d.upiAmt || '');
      setChqAmt(d.chqAmt || '');
      setChequeNo(d.chequeNo || '');
      setBankName(d.bankName || '');
      setChequeDate(d.chequeDate || '');
      setChqDateDD(d.chqDateDD || '');
      setPaymentMode(d.paymentMode || '');
      setConfirmInput(d.confirmInput || '');
      setRecDateOverride(d.recDateOverride || null);
      // Determine edit lock same way as handleBillSelect
      const bill = billMap.get(d.selectedBillNo)!;
      const hasNoAmounts = !bill.cashAmount && !bill.upiAmount && !bill.chequeAmount;
      if (!bill.paymentDate || hasNoAmounts) {
        setEditLocked(false);
      } else {
        const sessionUnlocked = sessionStorage.getItem(`vitratrack_edit_unlocked_${isoToDisplay(dashDate)}`) === '1';
        setEditLocked(!sessionUnlocked);
      }
      setShowDraftRestored(true);
      setTimeout(() => setShowDraftRestored(false), 3500);
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, billMap]);

  // Previous cheque numbers grouped by bank name (for datalist suggestions)
  const chqNosByBank = useMemo(() => {
    const map = new Map<string, string[]>();
    bills.forEach(b => {
      if (b.bankName && b.chequeNo) {
        const key = b.bankName.toLowerCase();
        if (!map.has(key)) map.set(key, []);
        const arr = map.get(key)!;
        if (!arr.includes(b.chequeNo)) arr.push(b.chequeNo);
      }
    });
    return map;
  }, [bills]);

  const selectedBill = useMemo(() => {
    if (!selectedBillNo) return undefined;
    return billMap.get(selectedBillNo);
  }, [billMap, selectedBillNo]);
  const _selMode = (selectedBill?.paymentMode || '').toLowerCase();
  const hasSelMoneyRec = (Number(selectedBill?.cashAmount) || 0) > 0 || (Number(selectedBill?.upiAmount) || 0) > 0 || (Number(selectedBill?.chequeAmount) || 0) > 0 || (Number(selectedBill?.collectedAmount) || 0) > 0;
  const hasSelRecDate = !!selectedBill?.paymentDate && selectedBill.paymentDate.trim() !== '' && selectedBill.paymentDate !== '—';
  const isSelFBR = (_selMode === 'fbr' || _selMode === 'cancel') && ((Number(selectedBill?.lineCutAmt) || 0) >= (selectedBill?.billNetAmt || 0) - 0.5 || hasSelRecDate || !!selectedBill?.discrepancyReason || (Number(selectedBill?.cancelLine) || 0) >= (selectedBill?.billNetAmt || 0) - 0.5);

  // A bill is only paid if money is received + rec date or genuine FBR
  const isSelectedBillPaid = selectedBill
    ? (isSelFBR || (hasSelMoneyRec && hasSelRecDate) || (hasSelMoneyRec && (_selMode === 'paid' || _selMode === 'cash' || _selMode === 'upi' || _selMode === 'cheque' || _selMode === 'split')))
    : false;
  const totalCollected = (Number(cashAmt) || 0) + (Number(upiAmt) || 0) + (Number(chqAmt) || 0);

  // ── Voice auto-save: fires ONLY when the selected bill + typed amount exactly
  // match what was spoken AND the amount equals the bill amount. Any mismatch
  // clears the queue so nothing is ever saved on the wrong bill/amount.
  useEffect(() => {
    if (!voiceAutoSave) return;
    if (selectedBillNo !== voiceAutoSave.billNo) { setVoiceAutoSave(null); return; }
    const net = Number(selectedBill?.billNetAmt) || 0;
    if (Math.abs(totalCollected - voiceAutoSave.amount) > 0.5 || Math.abs(net - voiceAutoSave.amount) > 0.5) return;
    setVoiceAutoSave(null);
    const t = setTimeout(() => saveBtnRef.current?.click(), 250);
    return () => clearTimeout(t);
  }, [voiceAutoSave, selectedBillNo, selectedBill, totalCollected]);



  // Bills assigned to selected driver for the selected date
  const driverBillNos = useMemo(() => {
    if (!selectedDriver) return new Set<string>();
    const selUpper = selectedDriver.trim().toUpperCase();
    return new Set(
      bills
        .filter(b => b.driverName?.trim().toUpperCase() === selUpper && b.deliveryDate === displayDate)
        .map(b => b.billNo)
    );
  }, [bills, selectedDriver, displayDate]);

  const filteredBillNos = useMemo(() => {
    const q = debouncedQuery.toLowerCase().trim();
    if (!q) return [];

    const stripGst = (s: string) => s.replace(/^gst[-/]?/i, '').toLowerCase();
    const stripGstAndZeros = (s: string) => stripGst(s).replace(/^0+/, '');

    const qStripped = stripGst(q);
    const qNoZeros = stripGstAndZeros(q);
    const isOwner = selectedDriver === 'OWNER' || !!(selectedDriver && drivers.find(d => d.name === selectedDriver && d.role === 'user'));
    const MAX_PER_TIER = 25;

    // Tiers:
    // Tier 0: Exact string OR exact numeric match (e.g., searching "426" matches "00426" / "GST00426" as Tier 0)
    // Tier 1: Bill ending with search query (e.g., "01426" ends with "426")
    // Tier 2: Bill starting with search query
    // Tier 3: Bill containing search query (e.g., "14426")
    // Tier 4: Exact party match
    // Tier 5: Party starts-with
    // Tier 6: Party contains
    const t: string[][] = [[], [], [], [], [], [], []];
    const seen = new Set<string>(); // deduplicates bills with same billNo

    for (const b of bills) {
      // Driver/date filter
      if (!isOwner && selectedDriver) {
        if (b.driverName?.trim().toUpperCase() !== selectedDriver.trim().toUpperCase() || b.deliveryDate !== displayDate) continue;
      }

      // DO NOT show old MOC serial bills in entry dropdown (each MOC entry must be a fresh new serial number)
      if (isMocBill(b) || (b.billNo || '').toUpperCase().startsWith('MOC') || b.salespersonName === 'MOC' || b.collectionCode === 'MOC' || b.beatName === 'COMMISSION') continue;

      const bn = b.billNo;
      if (seen.has(bn)) continue;

      const bl = bn.toLowerCase();
      const bs = stripGst(bn);
      const bNoZeros = stripGstAndZeros(bn);
      const pl = (b.partyName || '').toLowerCase();

      let tier = -1;
      const isExactStr = bl === q || bs === qStripped;
      const isExactNum = qNoZeros !== '' && bNoZeros === qNoZeros;

      if (isExactStr || isExactNum) {
        tier = 0;
      } else if (qStripped !== '' && (bs.endsWith(qStripped) || (qNoZeros !== '' && bNoZeros.endsWith(qNoZeros)))) {
        tier = 1;
      } else if (bl.startsWith(q) || bs.startsWith(qStripped) || (qNoZeros !== '' && bNoZeros.startsWith(qNoZeros))) {
        tier = 2;
      } else if (bl.includes(q) || bs.includes(qStripped) || (qNoZeros !== '' && bNoZeros.includes(qNoZeros))) {
        tier = 3;
      } else if (pl === q) {
        tier = 4;
      } else if (pl.startsWith(q)) {
        tier = 5;
      } else if (pl.includes(q)) {
        tier = 6;
      }

      if (tier >= 0 && t[tier].length < MAX_PER_TIER) {
        t[tier].push(bn);
        seen.add(bn);
      }
    }

    // Include Commission MOC matches (e.g. MOC 8, MOC8, COMMISSION)
    for (const moc of commissionMocs) {
      const code = moc.code;
      const codeNoSpace = code.replace(/\s+/g, '').toLowerCase();
      const codeNum = code.replace(/\D/g, '');

      const isExact = q === code.toLowerCase() || q === codeNoSpace || (qNoZeros !== '' && codeNum === qNoZeros && qStripped.startsWith('moc'));
      const isPart = code.toLowerCase().includes(q) || codeNoSpace.includes(q) || (q === 'commission' || q === 'moc' || q === 'comison' || q === 'com');

      if (isExact) {
        if (!seen.has(code)) {
          t[0].push(code);
          seen.add(code);
        }
      } else if (isPart) {
        if (!seen.has(code)) {
          t[2].push(code);
          seen.add(code);
        }
      }
    }

    const sortTier0 = (a: string, b: string) => {
      const aNoZeros = stripGstAndZeros(a);
      const bNoZeros = stripGstAndZeros(b);
      const aExactNum = qNoZeros !== '' && aNoZeros === qNoZeros;
      const bExactNum = qNoZeros !== '' && bNoZeros === qNoZeros;
      if (aExactNum && !bExactNum) return -1;
      if (!aExactNum && bExactNum) return 1;
      return a.length - b.length || a.localeCompare(b);
    };

    const sortByLen = (a: string, b: string) => a.length - b.length || a.localeCompare(b);

    // If an exact bill match exists (e.g. searching 102 matches bill 00102), show ONLY exact match card(s)
    if (t[0].length > 0) {
      return t[0].sort(sortTier0);
    }

    return [
      ...t[1].sort(sortByLen),
      ...t[2].sort(sortByLen),
      ...t[3].sort(sortByLen),
      ...t[4].sort(sortByLen),
      ...t[5].sort(sortByLen),
      ...t[6].sort(sortByLen),
    ];
  }, [bills, debouncedQuery, selectedDriver, displayDate, drivers, commissionMocs]);

  // Whether the typed search query matches no bill
  const billNotFound = useMemo(() => {
    if (!debouncedQuery || filteredBillNos.length > 0 || selectedBillNo) return false;
    return true;
  }, [debouncedQuery, filteredBillNos, selectedBillNo]);

  const driverStats = useMemo(() => {
    if (!selectedDriver) return null;
    const isOwner = selectedDriver === 'OWNER';
    const selUpper = selectedDriver.trim().toUpperCase();
    const isUserStaff = !isOwner && (selUpper === 'PRATIXA' || !!drivers.find(d => d.name?.trim().toUpperCase() === selUpper && d.role === 'user'));

    let dbills: typeof bills = [];
    if (isOwner || isUserStaff) {
      // OWNER and USER selections show the complete database position (UNCHANGED)
      dbills = bills;
    } else {
      // Regular drivers: bills assigned to driver on selected date OR in delPendingHistory snapshot
      const snapshotBillNos = new Set<string>();
      const nameLower = selectedDriver.toLowerCase().trim();
      for (const b of bills) {
        if (Array.isArray(b.delPendingHistory)) {
          if (b.delPendingHistory.some(h => h.driverName?.toLowerCase().trim() === nameLower && h.deliveryDate === displayDate)) {
            snapshotBillNos.add(b.billNo);
          }
        }
      }
      dbills = bills.filter(b =>
        (b.driverName?.trim().toUpperCase() === selUpper && b.deliveryDate === displayDate) ||
        snapshotBillNos.has(b.billNo)
      );
    }

    const totalCount = dbills.length;
    let doneCount = 0;

    if (isOwner || isUserStaff) {
      // OWNER / USER logic (UNCHANGED)
      for (const b of dbills) {
        const mode = (b.paymentMode || '').toLowerCase();
        const hasMoneyReceived =
          (Number(b.collectedAmount) || 0) > 0 ||
          (Number(b.cashAmount) || 0) > 0 ||
          (Number(b.upiAmount) || 0) > 0 ||
          (Number(b.chequeAmount) || 0) > 0;
        const isPaid = hasMoneyReceived || mode === 'paid' || mode === 'cash' || mode === 'upi' || mode === 'cheque' || mode === 'split';
        const isFBR = mode === 'fbr' || mode === 'cancel';
        if (isPaid || isFBR) doneCount++;
      }
    } else {
      // REGULAR DRIVER logic: Paid = paid + FBR + del pending, Pand = LOAD - PAID
      for (const b of dbills) {
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

        if (isPaid || isFBR || isDelPending || isCredit) {
          doneCount++;
        }
      }
    }

    const pendingCount = Math.max(0, totalCount - doneCount);
    return { total: totalCount, paid: doneCount, pending: pendingCount, isStaff: isOwner || isUserStaff };
  }, [selectedDriver, displayDate, bills, drivers]);

  // ── Total Cash Count & Collection for Selected Date (Driver, User, Owner) ──
  // Deduplicates by billNo to ensure duplicate entries don't double count cash.
  const cashStats = useMemo(() => {
    let totalCash = 0;
    let billsCount = 0;
    let driverCash = 0;
    let userCash = 0;
    let ownerCash = 0;
    let driverBillsCount = 0;
    let userBillsCount = 0;
    let ownerBillsCount = 0;

    const breakdownByPerson = new Map<string, { role: 'driver' | 'user' | 'owner'; amount: number; count: number }>();
    const seenBillNos = new Set<string>();

    const getPersonRole = (name: string): { role: 'driver' | 'user' | 'owner'; cleanName: string } => {
      const u = (name || '').trim().toUpperCase();
      if (!u || u === 'OWNER' || u === '👑 OWNER') return { role: 'owner', cleanName: 'OWNER' };
      const d = drivers.find(drv => (drv.name || '').trim().toUpperCase() === u);
      if (d?.role === 'owner') return { role: 'owner', cleanName: d.name || u };
      if (d?.role === 'user' || u === 'PRATIXA' || u === 'KHUSHI' || u === 'TARACHAND' || u === 'SEJAL') {
        return { role: 'user', cleanName: d?.name || u };
      }
      return { role: 'driver', cleanName: d?.name || u };
    };

    const addPersonRecord = (name: string, amt: number) => {
      if (amt <= 0) return;
      const { role, cleanName } = getPersonRole(name);
      const existing = breakdownByPerson.get(cleanName) || { role, amount: 0, count: 0 };
      existing.amount += amt;
      existing.count += 1;
      breakdownByPerson.set(cleanName, existing);
    };

    for (const b of bills) {
      if (!b.billNo) continue;
      const normBillNo = b.billNo.trim().toUpperCase();
      if (seenBillNos.has(normBillNo)) continue;

      let billCash = 0;
      let handledByPartPayments = false;

      // 1. Part payments check for this date
      if (b.partPayments && b.partPayments.length > 0) {
        for (const p of b.partPayments) {
          const pDate = p.date || '';
          if (pDate === displayDate || pDate === dashDate) {
            handledByPartPayments = true;
            const mode = (p.mode || '').toLowerCase();
            if (mode === 'cash' || (!mode && (Number(p.amount) || 0) > 0)) {
              const amt = Number(p.amount) || 0;
              if (amt > 0) {
                billCash += amt;
                const collector = p.enteredBy || b.paymentTime || b.driverName || 'DRIVER';
                addPersonRecord(collector, amt);
              }
            }
          }
        }
      }

      // 2. Direct payment if not handled by part payments
      if (!handledByPartPayments) {
        const isPaidToday = b.paymentDate === displayDate || b.paymentDate === dashDate;
        const isDeliveredToday = b.deliveryDate === displayDate || b.deliveryDate === dashDate;

        if (isPaidToday || (isDeliveredToday && (!b.paymentDate || b.paymentDate.trim() === '' || b.paymentDate === '—'))) {
          const directCash = Number(b.cashAmount) || 0;
          const upi = Number(b.upiAmount) || 0;
          const chq = Number(b.chequeAmount) || 0;
          const col = Number(b.collectedAmount) || 0;
          const _bm = (b.paymentMode || '').toLowerCase();

          if (_bm === 'fbr' || _bm === 'cancel' || _bm === 'assigned') {
            billCash = 0;
          } else if (directCash > 0 || upi > 0 || chq > 0) {
            billCash = directCash;
          } else if (directCash === 0 && upi === 0 && chq === 0 && col > 0 && (_bm === 'cash' || _bm === 'paid')) {
            billCash = col;
          }

          if (billCash > 0) {
            const collector = b.paymentTime || b.driverName || 'DRIVER';
            addPersonRecord(collector, billCash);
          }
        }
      }

      if (billCash > 0) {
        seenBillNos.add(normBillNo);
        totalCash += billCash;
        billsCount++;

        const pTime = (b.paymentTime || '').trim();
        const dName = (b.driverName || '').trim();
        const { role } = getPersonRole(pTime || dName);

        if (role === 'owner') {
          ownerCash += billCash;
          ownerBillsCount++;
        } else if (role === 'user') {
          userCash += billCash;
          userBillsCount++;
        } else {
          driverCash += billCash;
          driverBillsCount++;
        }
      }
    }

    const personList = Array.from(breakdownByPerson.entries()).map(([name, data]) => ({
      name,
      role: data.role,
      amount: data.amount,
      count: data.count,
    })).sort((a, b) => b.amount - a.amount);

    return {
      totalCash,
      billsCount,
      driverCash,
      userCash,
      ownerCash,
      driverBillsCount,
      userBillsCount,
      ownerBillsCount,
      personList,
    };
  }, [bills, displayDate, dashDate, drivers]);

  // Specific cash total & count for the currently selected driver / owner / user in the dropdown
  // Deduplicates billNo so duplicate items in state don't double count
  const selectedDriverCashStats = useMemo(() => {
    if (!selectedDriver) {
      return {
        amount: cashStats.totalCash,
        count: cashStats.billsCount,
        label: 'ALL CASH',
        title: `Total Cash (${displayDate}): ₹${cashStats.totalCash.toLocaleString('en-IN')} (${cashStats.billsCount} bills)\nClick for full breakdown`,
      };
    }

    const selUpper = selectedDriver.trim().toUpperCase();
    const matchedDriver = drivers.find(drv => (drv.name || '').trim().toUpperCase() === selUpper);
    const isOwner = selUpper === 'OWNER' || selUpper === '👑 OWNER' || matchedDriver?.role === 'owner';
    const isUserStaff = !isOwner && (
      matchedDriver?.role === 'user' ||
      selUpper === 'PRATIXA' ||
      selUpper === 'KHUSHI' ||
      selUpper === 'TARACHAND' ||
      selUpper === 'SEJAL'
    );

    let amount = 0;
    let count = 0;
    const seenBillNos = new Set<string>();

    const getEffCash = (b: Bill) => {
      const cash = Number(b.cashAmount) || 0;
      const upi = Number(b.upiAmount) || 0;
      const chq = Number(b.chequeAmount) || 0;
      const col = Number(b.collectedAmount) || 0;
      const mode = (b.paymentMode || '').toLowerCase();
      if (mode === 'fbr' || mode === 'cancel' || mode === 'assigned') return 0;
      if (cash > 0 || upi > 0 || chq > 0) return cash;
      if (mode === 'cash' || mode === 'paid') return col;
      return 0;
    };

    for (const b of bills) {
      if (!b.billNo) continue;
      const normBillNo = b.billNo.trim().toUpperCase();
      if (seenBillNos.has(normBillNo)) continue;

      const pTime = (b.paymentTime || '').trim().toUpperCase();
      const dName = (b.driverName || '').trim().toUpperCase();
      const pDate = b.paymentDate || '';
      const dDate = b.deliveryDate || '';

      if (isOwner) {
        // Owner must be explicit payment date matching displayDate and entered by OWNER
        // Exclude bills that were assigned to a driver on deliveryDate
        if (dDate === displayDate && dName && dName !== 'OWNER') continue;
        const isOtherStaff = drivers.some(d => d.role === 'user' && (d.name || '').trim().toUpperCase() !== 'OWNER' && (pTime === (d.name || '').trim().toUpperCase() || pTime.startsWith((d.name || '').trim().toUpperCase() + ':')));
        if (isOtherStaff) continue;

        const isOwnerPaid = pDate === displayDate && (
          pTime === 'OWNER' ||
          pTime.startsWith('OWNER:') ||
          pTime.startsWith('OWNER ') ||
          dName === 'OWNER' ||
          (Array.isArray(ownerSavedBillNos) && ownerSavedBillNos.includes(b.billNo)) ||
          (!pTime && getRole() === 'owner') ||
          /^\d{1,2}:\d{2}/.test(pTime)
        );
        if (isOwnerPaid) {
          const c = getEffCash(b);
          if (c > 0) {
            seenBillNos.add(normBillNo);
            amount += c;
            count++;
          }
        }
      } else if (isUserStaff) {
        // Must be genuinely entered by this specific user and paymentDate === displayDate
        // Exclude any deliveryDate === displayDate entry from user table cash stats
        if (dDate === displayDate) continue;

        const isThisUser = (
          pTime === selUpper ||
          pTime.startsWith(selUpper + ':') ||
          pTime.startsWith(selUpper + ' ')
        );
        if (isThisUser && pDate === displayDate) {
          const c = getEffCash(b);
          if (c > 0) {
            seenBillNos.add(normBillNo);
            amount += c;
            count++;
          }
        }
      } else {
        // Driver view (e.g. DINESH PATIL, MANOHAR)
        const isDriverBill = dName === selUpper && (dDate === displayDate || (!dDate && b.date === displayDate));
        if (isDriverBill) {
          const c = getEffCash(b);
          if (c > 0) {
            seenBillNos.add(normBillNo);
            amount += c;
            count++;
          }
        }
      }
    }

    return {
      amount,
      count,
      label: `${selectedDriver} CASH`,
      title: `${selectedDriver} Real Cash (${displayDate}): ₹${amount.toLocaleString('en-IN')} (${count} bills)\nClick for full breakdown`,
    };
  }, [selectedDriver, bills, displayDate, drivers, cashStats, ownerSavedBillNos]);

  function handleDriverChange(name: string) {
    setSelectedDriver(name);
    sessionStorage.setItem('vitratrack_selected_driver', name);
    handleReset();
  }

  const isMocBillCb = useCallback((bn?: string, b?: Bill | null) => {
    if (!bn && !b) return false;
    const code = (bn || b?.billNo || '').toUpperCase().trim();
    if (code.startsWith('MOC') || code.includes('MOC')) return true;
    if (b?.collectionCode === 'MOC' || b?.salespersonName === 'MOC' || b?.beatName === 'COMMISSION') return true;
    return commissionMocs.some(m => (m?.code || '').toUpperCase() === code);
  }, [commissionMocs]);

  function handleBillSelect(bn: string) {
    const cleanBn = (bn || '').trim();
    if (!cleanBn) return;

    // ── MOC COMMISSION SELECTION ──────────────────────────────────────────────
    // When ANY MOC is selected or typed (e.g., 'MOC 8', 'MOC', 'moc 7', 'MOC8-SR1', etc.),
    // ALWAYS generate a brand new fresh entry with the next auto-incremented Serial Number!
    // Old MOC entries are NEVER loaded or edited on the entry page.
    const mocMatch = commissionMocs.find(m => 
      (m?.code || '').toUpperCase() === cleanBn.toUpperCase() || 
      (m?.code || '').toUpperCase().replace(/\s+/g, '') === cleanBn.toUpperCase().replace(/\s+/g, '')
    );
    const isMocSelection = !!mocMatch || isMocBillCb(cleanBn) || isMocBill(cleanBn) || cleanBn.toUpperCase().startsWith('MOC');

    if (isMocSelection) {
      const code = mocMatch ? (mocMatch.code || `MOC 1`) : (cleanBn.toUpperCase().startsWith('MOC') ? cleanBn.toUpperCase() : `MOC ${cleanBn.toUpperCase()}`);
      const mocNum = extractMocNumber(code) || extractMocNumber(cleanBn) || '1';
      const pName = formatMocPartyName('', `MOC ${mocNum}`);
      const allCurrentBills = getBills();
      const nextSr = getNextMocSrNo(mocNum, allCurrentBills);
      const serialBillNo = formatMocSerialBillNo(mocNum, nextSr);
      const newMocBill: Bill = {
        id: `moc_${mocNum}_${nextSr}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        srNo: String(nextSr),
        date: displayDate,
        deliveryDate: displayDate,
        salespersonName: 'MOC',
        collectionCode: 'MOC',
        billNo: serialBillNo,
        partyCode: `MOC${mocNum}`,
        partyHulCode: `MOC${mocNum}`,
        partyName: pName,
        beatName: 'COMMISSION',
        billNetAmt: 0,
        collectedAmount: 0,
        outstandingAmount: 0,
        billAgeing: 0,
        driverName: selectedDriver || 'OWNER',
        paymentMode: 'Cash',
      };
      addBillsToMemoryOnly([newMocBill]);
      setSelectedBillNo(newMocBill.id);
      setSearchQuery(serialBillNo);
      setShowDropdown(false);
      setPaymentMode('');
      setRecDateInput(dashDate);
      setRecDateOverride('');
      setEditLocked(false);
      setCashAmt('');
      setUpiAmt('');
      setChqAmt('');
      setBankName('');
      setChequeNo('');
      setChequeDate('');
      setChqDateDD('');
      setConfirmInput('');
      setLcInputVal('');
      setTimeout(() => cashInputRef.current?.focus(), 120);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    // ── STANDARD REGULAR BILL SELECTION ───────────────────────────────────────
    const existingBill = bills.find(b => b.id === cleanBn || b.billNo?.toUpperCase() === cleanBn.toUpperCase() || b.billNo === bn);
    if (!existingBill) return;

    const bill = existingBill;
    setSelectedBillNo(bill.id || bill.billNo);
    setSearchQuery(getDisplayBillNo(bill));
    setShowDropdown(false);

    const _bMode = (bill.paymentMode || '').toLowerCase();
    const isPaid = (bill.collectedAmount || 0) > 0 || !!bill.paymentDate
      || _bMode === 'paid' || _bMode === 'fbr' || _bMode === 'cancel'
      || _bMode === 'cash' || _bMode === 'upi' || _bMode === 'cheque' || _bMode === 'split'
      || _bMode === 'unpaid' || _bMode === 'del pending' || _bMode === 'pending' || _bMode === 'credit';

    setEditLocked(isPaid);
    const effMode = (bill.paymentMode || '').toLowerCase();
    if (effMode === 'fbr' || effMode === 'cancel') {
      setPaymentMode('FBR');
    } else if (effMode === 'credit') {
      setPaymentMode('Credit');
    } else if (effMode === 'del pending') {
      setPaymentMode('Del Pending');
    } else if (effMode === 'unpaid') {
      setPaymentMode('Unpaid');
    } else if (bill.collectedAmount && bill.collectedAmount > 0) {
      setPaymentMode('Paid');
    } else {
      setPaymentMode('');
    }

    setConfirmInput('');
    setLcInputVal(bill.lineCutAmt != null && bill.lineCutAmt > 0 ? String(bill.lineCutAmt) : '');
    if (bill.paymentDate && bill.paymentDate.trim() !== '' && bill.paymentDate !== '—') {
      const savedIso = displayToIso(bill.paymentDate);
      const savedDisp = isoToDisplay(savedIso) || bill.paymentDate;
      setRecDateInput(savedIso);
      setRecDateOverride(savedDisp);
    } else {
      setRecDateInput(dashDate);
      setRecDateOverride(isoToDisplay(dashDate) || getTodayDMY());
    }

    // User rule: Any bill with payment received (Cash, GPay, Cheque, collected) OR in FBR OR in Credit must be locked by default!
    const isMoc = isMocBill(bn, bill);
    const ca = Number(bill.cashAmount) || 0;
    const up = Number(bill.upiAmount) || 0;
    const ch = Number(bill.chequeAmount) || 0;
    const col = Number(bill.collectedAmount) || 0;
    const hasMoneyOrDate = ca > 0 || up > 0 || ch > 0 || col > 0 || (!!bill.paymentDate && bill.paymentDate.trim() !== '' && bill.paymentDate !== '—') || _bMode === 'paid' || _bMode === 'cash' || _bMode === 'upi' || _bMode === 'cheque' || _bMode === 'split';
    const isSpecialLock = _bMode === 'fbr' || _bMode === 'cancel' || _bMode === 'credit';
    const requiresLock = !isMoc && (hasMoneyOrDate || isSpecialLock);

    if (requiresLock) {
      const sessionUnlocked = sessionStorage.getItem(`vitratrack_edit_unlocked_${displayDate}`) === '1';
      setEditLocked(!sessionUnlocked);
    } else {
      setEditLocked(false);
    }

    if (isPaid && !(bill.partPayments && bill.partPayments.length > 0)) {
      if (ca === 0 && up === 0 && ch === 0 && col > 0) {
        const m = _bMode;
        if (m === 'upi') { setCashAmt(''); setUpiAmt(String(col)); setChqAmt(''); }
        else if (m === 'cheque') { setCashAmt(''); setUpiAmt(''); setChqAmt(String(col)); }
        else if (m === 'credit') { setCashAmt(''); setUpiAmt(''); setChqAmt(''); setPaymentMode('Credit'); }
        else if (m === 'fbr' || m === 'cancel') { setCashAmt(''); setUpiAmt(''); setChqAmt(''); setPaymentMode('FBR'); }
        else { setCashAmt(String(col)); setUpiAmt(''); setChqAmt(''); }
      } else {
        setCashAmt(ca > 0 ? String(ca) : '');
        setUpiAmt(up > 0 ? String(up) : '');
        setChqAmt(ch > 0 ? String(ch) : '');
      }
      setBankName(bill.bankName || '');
      setChequeNo(bill.chequeNo || '');
      const _cd = bill.chequeDate || '';
      setChequeDate(_cd);
      setChqDateDD(_cd ? _cd.split('/').slice(0, 2).join('/') : '');
      setPaymentMode(bill.paymentMode || '');
      setConfirmInput(bill.cancelLine || '');
      const _bLC = (bill.lineCutAmt || 0) || Number(bill.cancelLine) || 0;
      setLcInputVal(_bLC > 0 ? String(_bLC) : '');
    } else {
      setCashAmt('');
      setUpiAmt('');
      setChqAmt('');
      setBankName('');
      setChequeNo('');
      setPaymentMode(bill.paymentMode || '');
      setConfirmInput(bill.cancelLine || '');
      const _bLC = (bill.lineCutAmt || 0) || Number(bill.cancelLine) || 0;
      setLcInputVal(_bLC > 0 ? String(_bLC) : '');
    }

    setTimeout(() => cashInputRef.current?.focus(), 120);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.getVoices();
      const updateVoices = () => { window.speechSynthesis.getVoices(); };
      window.speechSynthesis.onvoiceschanged = updateVoices;
      return () => { window.speechSynthesis.onvoiceschanged = null; };
    }
  }, []);

  // ── Voice Search & Text-to-Speech Synthesis Handler ──────────────────────────
  const speakText = useCallback((text: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.resume();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      const voices = window.speechSynthesis.getVoices();
      const voice = voices.find(v => v.lang.includes('hi') || v.lang.includes('HI')) ||
                    voices.find(v => v.lang.includes('en-IN')) || null;
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang || 'hi-IN';
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.error('Speech synthesis error:', e);
    }
  }, []);

  // Flexible exact bill lookup — handles GST/ prefix, zero padded, or numeric digits
  const findExactBill = useCallback((num: string) => {
    if (!num) return undefined;
    const cleanNum = num.toString().toLowerCase().trim();

    const norm = (s: string) => (s || '').toString().toLowerCase()
      .replace(/^gst[-/]?/i, '')
      .replace(/^inv[-/]?/i, '')
      .replace(/^bill[-/]?/i, '')
      .replace(/[^0-9a-z]/g, '')
      .replace(/^0+/, '');

    const getDigits = (s: string) => (s || '').toString().replace(/\D/g, '').replace(/^0+/, '');

    const qNorm = norm(cleanNum);
    const qDigits = getDigits(cleanNum);

    if (!qNorm && !qDigits) return undefined;

    // 1. Exact raw match
    let match = bills.find(b => b.billNo.toLowerCase().trim() === cleanNum);
    // 2. Exact normalized match
    if (!match && qNorm) {
      match = bills.find(b => norm(b.billNo) === qNorm);
    }
    // 3. Pure digit match
    if (!match && qDigits) {
      match = bills.find(b => getDigits(b.billNo) === qDigits);
    }
    // NOTE: no suffix / partial matching — "613" must never open 12613 or 22613.
    return match;
  }, [bills]);

  // Among speech alternatives, prefer the one whose bill number actually exists.
  const pickBestTranscript = useCallback((result: any): string => {
    const alts: string[] = [];
    for (let k = 0; k < (result.length || 1); k++) {
      const t = String(result[k]?.transcript || '').trim();
      if (t) alts.push(t);
    }
    if (!alts.length) return '';

    // Collect transcripts that resolve to an existing bill
    const resolved: { t: string; cmd: ReturnType<typeof parseVoiceCommand>; billNoDigits: string; matched: any | null }[] = [];
    for (const t of alts) {
      const c = parseVoiceCommand(t);
      const billNoDigits = String(c.billNo || '').replace(/\D/g, '');
      const matched = c.billNo ? findExactBill(c.billNo) : null;
      if (matched) resolved.push({ t, cmd: c, billNoDigits, matched });
    }

    if (resolved.length === 0) {
      // No transcript resolves to an exact bill — fall back to first alt
      return alts[0];
    }

    // Prefer the resolved transcript with the longest numeric bill string (e.g., 14312 over 14)
    resolved.sort((a, b) => b.billNoDigits.length - a.billNoDigits.length);
    return resolved[0].t;
  }, [findExactBill]);



  const processVoiceInput = useCallback((rawTranscript: string) => {
    const rawLower = rawTranscript.toLowerCase();
    const cmd = parseVoiceCommand(rawTranscript);

    // Check for save / submit command first
    if (/\b(save|submit|seve|सेव|सबमिट)\b/i.test(rawLower)) {
      if (selectedBillNo) {
        speakText("Save kiya ja raha hai");
        proceedToSave();
        return;
      }
    }

    const billNoToUse = cmd.billNo || selectedBillNo;

    if (!billNoToUse) {
      const errStr = "Pehle bill select ya number bolein";
      setVoiceFeedback("Awaaz samajh nahi aayi, dobara bolein");
      speakText(errStr);
      return;
    }

    setSearchQuery(billNoToUse);
    setShowDropdown(true);

    let matched = findExactBill(billNoToUse);
    // Name search only — NEVER partial bill-number matching (payment safety)
    if (!matched && billNoToUse && !/^\d+$/.test(billNoToUse.trim())) {
      const q = billNoToUse.toLowerCase().trim();
      matched = bills.find(b => b.partyName && b.partyName.toLowerCase().includes(q));
    }

    if (!matched) {
      const notFoundDisplay = `Bill "${billNoToUse}" nahi mila`;
      setVoiceFeedback(notFoundDisplay);
      speakText("Nahi mila");
      return;
    }

    handleBillSelect(matched.billNo);

    // Check status change commands (fbr, credit, del pending)
    if (/\b(fbr|cancel|कैंसल)\b/i.test(rawLower)) {
      clearReceivedAmounts();
      setShowFbrReasonModal(true);
      setPaymentMode('FBR');
      setVoiceFeedback(`Bill ${matched.billNo} — FBR`);
      speakText("FBR");
      return;
    }

    if (/\b(credit|udhaar|उधार|क्रेडिट)\b/i.test(rawLower)) {
      openCreditLineCutPopup();
      setVoiceFeedback(`Bill ${matched.billNo} — Credit`);
      speakText("Credit");
      return;
    }

    if (/\b(del pending|delivery pending|pending delivery|डिलीवरी पेंडिंग)\b/i.test(rawLower)) {
      clearReceivedAmounts();
      setPaymentMode('Del Pending');
      setVoiceFeedback(`Bill ${matched.billNo} — Delivery Pending`);
      speakText("Delivery Pending");
      return;
    }

    // Calculate net bill amount after line cut
    const _lc = (matched.lineCutAmt || 0) || Number(matched.cancelLine) || 0;
    const net = Math.max(0, (Number(matched.billNetAmt) || 0) - _lc);

    // ── Mode Conversion command (e.g. "ye cash ko gpay me paid karo", "cash to gpay", "gpay ko cash karo") ────
    if (cmd.isConvert && cmd.toMode) {
      const targetFromMode = cmd.fromMode || 'Cash';
      const targetToMode = cmd.toMode;

      const existingCash = Number(matched.cashAmount) || 0;
      const existingUpi = Number(matched.upiAmount) || 0;
      const existingChq = Number(matched.chequeAmount) || 0;
      const existingCol = Number(matched.collectedAmount) || (existingCash + existingUpi + existingChq);

      let amountToTransfer = 0;
      if (targetFromMode === 'Cash') {
        amountToTransfer = existingCash > 0 ? existingCash : (existingCol > 0 ? existingCol : net);
      } else if (targetFromMode === 'UPI') {
        amountToTransfer = existingUpi > 0 ? existingUpi : (existingCol > 0 ? existingCol : net);
      } else if (targetFromMode === 'Cheque') {
        amountToTransfer = existingChq > 0 ? existingChq : (existingCol > 0 ? existingCol : net);
      } else {
        amountToTransfer = existingCol > 0 ? existingCol : net;
      }

      if (amountToTransfer <= 0) amountToTransfer = net;

      let newCash = 0;
      let newUpi = 0;
      let newChq = 0;

      if (targetToMode === 'UPI') {
        newUpi = amountToTransfer;
        newCash = targetFromMode === 'Cash' ? 0 : existingCash;
        newChq = targetFromMode === 'Cheque' ? 0 : existingChq;
      } else if (targetToMode === 'Cash') {
        newCash = amountToTransfer;
        newUpi = targetFromMode === 'UPI' ? 0 : existingUpi;
        newChq = targetFromMode === 'Cheque' ? 0 : existingChq;
      } else if (targetToMode === 'Cheque') {
        newChq = amountToTransfer;
        newCash = targetFromMode === 'Cash' ? 0 : existingCash;
        newUpi = targetFromMode === 'UPI' ? 0 : existingUpi;
      }

      setCashAmt(newCash > 0 ? String(newCash) : '');
      setUpiAmt(newUpi > 0 ? String(newUpi) : '');
      setChqAmt(newChq > 0 ? String(newChq) : '');
      setPaymentMode(targetToMode);
      setEditLocked(false);

      // User preference: GPay and Cheque are never auto-matched or auto-saved silently
      setVoiceFeedback(`Bill ${matched.billNo} — ${targetFromMode} se ${targetToMode} ₹${amountToTransfer} set kiya. Save karein.`);
      speakText(`${targetToMode} set kiya, check karke save karein`);
      setVoiceAutoSave(null);
      return;
    }

    // ── Direct Mode Pay Command by Voice: e.g. "gpay me paid karo", "cash me paid karo", "poora paid karo" ──
    const isDirectPaidCommand = cmd.isFullPaid || (cmd.mode && /\b(paid|karo|save|kar do|daalo|pay)\b/i.test(rawLower));
    if (isDirectPaidCommand && (cmd.mode || /\b(paid|pay)\b/i.test(rawLower))) {
      const targetMode = cmd.mode || 'Cash';
      const existingCash = Number(matched.cashAmount) || 0;
      const existingUpi = Number(matched.upiAmount) || 0;

      let amountToPay = cmd.amount || (existingCash > 0 ? existingCash : (existingUpi > 0 ? existingUpi : net));
      if (amountToPay <= 0) amountToPay = net;

      let newCash = targetMode === 'Cash' ? amountToPay : 0;
      let newUpi = targetMode === 'UPI' ? amountToPay : 0;
      let newChq = targetMode === 'Cheque' ? amountToPay : 0;

      const totalCol = newCash + newUpi + newChq;
      const targetRecDate = matched.paymentDate || recDateOverride || isoToDisplay(dashDate) || dashDate;
      const existingLc = (matched.lineCutAmt || 0) || Number(matched.cancelLine) || 0;

      setCashAmt(newCash > 0 ? String(newCash) : '');
      setUpiAmt(newUpi > 0 ? String(newUpi) : '');
      setChqAmt(newChq > 0 ? String(newChq) : '');
      setPaymentMode(targetMode);
      setEditLocked(false);

      if (targetMode === 'Cash') {
        savePayment(
          matched.billNo,
          targetMode,
          null,
          totalCol,
          matched.cancelLine || null,
          selectedDriver || matched.driverName || '',
          dashDate,
          matched.chequeNo || null,
          matched.bankName || null,
          null,
          { cash: newCash, upi: newUpi, cheque: newChq },
          existingLc > 0 ? existingLc : null,
          targetRecDate,
          selectedDriver === 'OWNER' ? 'OWNER' : (getLoggedInName() || selectedDriver || 'OWNER'),
          matched.chequeDate || null,
          matched.discrepancyReason || null,
        ).then(ok => {
          if (ok) {
            setLastSavedBill({
              billNo: matched.billNo,
              partyName: matched.partyName,
              diff: 0,
            });
            setOwnerSavedBillNos(prev => [...prev.filter(x => x !== matched.billNo), matched.billNo]);
            setShowPaidPopup(true);
            setTimeout(() => setShowPaidPopup(false), 2000);
            setVoiceFeedback(`Bill ${matched.billNo} — Cash me ₹${amountToPay} Paid`);
            speakText("Cash me save kar diya");
            refresh();
          } else {
            speakText("Save fail ho gaya, dobara try karein");
          }
        });
      } else {
        // GPay and Cheque: Do not auto-match/auto-save; populate fields and let user review and confirm
        setVoiceFeedback(`Bill ${matched.billNo} — ${targetMode === 'UPI' ? 'GPay' : targetMode} ₹${amountToPay} set kiya. Verify karke Save karein.`);
        speakText(`${targetMode === 'UPI' ? 'GPay' : targetMode} amount daala hai, save dabayein`);
        setVoiceAutoSave(null);
      }
      return;
    }

    // ── Payment command with explicit amount: "<bill> ko cash me <amount> paid karo" ──────────────
    let targetAmount = cmd.amount;
    if (cmd.mode && (cmd.isFullPaid || targetAmount == null || targetAmount === 0)) {
      targetAmount = net;
    }

    if (cmd.mode && targetAmount != null && targetAmount > 0) {
      setCashAmt(cmd.mode === 'Cash' ? String(targetAmount) : '');
      setUpiAmt(cmd.mode === 'UPI' ? String(targetAmount) : '');
      setChqAmt(cmd.mode === 'Cheque' ? String(targetAmount) : '');

      if (Math.abs(net - targetAmount) < 0.5 && cmd.mode === 'Cash') {
        const okMsg = `Bill ${matched.billNo} — ${targetAmount} Cash Paid`;
        setVoiceFeedback(okMsg);
        speakText("Paid");
        setVoiceAutoSave({ billNo: matched.billNo, amount: targetAmount });
      } else {
        const warnMsg = cmd.mode === 'Cheque'
          ? `Bill ${matched.billNo} — Cheque details bharkar save karein`
          : cmd.mode === 'UPI'
          ? `Bill ${matched.billNo} — GPay ₹${targetAmount} verify karke save karein`
          : `Bill ${matched.billNo} — Amount ${targetAmount} verify karein`;
        setVoiceFeedback(warnMsg);
        speakText("Amount check karein");
        setVoiceAutoSave(null);
      }
      return;
    }

    // ── Standard Bill Search Result Voice Announcement ──
    const isFBR = matched.paymentMode === 'FBR' || matched.paymentMode === 'Cancel';
    const isCredit = matched.paymentMode === 'Credit';
    const isDelPend = matched.paymentMode === 'Del Pending';
    const _ddLC = (matched.lineCutAmt || 0) || Number(matched.cancelLine) || 0;
    const _ddNet = (matched.billNetAmt || 0) - _ddLC;
    const _ddColl = matched.collectedAmount || 0;
    const isPaid = _ddColl > 0 || (!!matched.paymentDate && matched.paymentMode !== 'Unpaid' && matched.paymentMode !== 'Credit' && matched.paymentMode !== 'FBR' && matched.paymentMode !== 'Del Pending');

    let spokenStatus = "";
    let visualStatus = "";
    const lcSpoken = _ddLC > 0 ? `aur line cut ${_ddLC} hai` : `aur line cut zero hai`;

    if (isFBR) {
      spokenStatus = `FBR hai, ${lcSpoken}`;
      visualStatus = `Bill ${matched.billNo} — FBR | Line Cut: ₹${_ddLC}`;
    } else if (isCredit) {
      spokenStatus = `Credit hai, ${lcSpoken}`;
      visualStatus = `Bill ${matched.billNo} — CREDIT | Line Cut: ₹${_ddLC}`;
    } else if (isDelPend) {
      spokenStatus = `Delivery Pending hai`;
      visualStatus = `Bill ${matched.billNo} — DELIVERY PENDING`;
    } else if (isPaid) {
      const cAmt = Number(matched.cashAmount) || 0;
      const uAmt = Number(matched.upiAmount) || 0;
      const qAmt = Number(matched.chequeAmount) || 0;

      const modeList: string[] = [];
      if (qAmt > 0 || matched.paymentMode?.toLowerCase() === 'cheque') modeList.push('Cheque');
      if (cAmt > 0 || (matched.paymentMode?.toLowerCase() === 'cash' && uAmt === 0 && qAmt === 0)) modeList.push('Cash');
      if (uAmt > 0 || (matched.paymentMode?.toLowerCase() === 'upi' && cAmt === 0 && qAmt === 0)) modeList.push('GPAY');

      const modesSpoken = modeList.length > 0 ? modeList.join(' aur ') : 'Cash';
      const modesDisplay = modeList.length > 0 ? modeList.join(', ') : 'Cash';
      spokenStatus = `Paid hai ${modesSpoken} se, ${lcSpoken}`;
      visualStatus = `Bill ${matched.billNo} — PAID (${modesDisplay}) | Line Cut: ₹${_ddLC}`;
    } else if (matched.paymentMode === 'Pending') {
      spokenStatus = `Pending hai, ${lcSpoken}`;
      visualStatus = `Bill ${matched.billNo} — PENDING | Line Cut: ₹${_ddLC}`;
    } else {
      spokenStatus = `Unpaid hai, ${lcSpoken}`;
      visualStatus = `Bill ${matched.billNo} — UNPAID (₹${matched.billNetAmt || 0}) | Line Cut: ₹${_ddLC}`;
    }

    setVoiceFeedback(visualStatus);
    // Speaks ONLY the status and payment details without repeating the bill number
    speakText(spokenStatus);
  }, [bills, findExactBill, handleBillSelect, speakText, selectedBillNo, proceedToSave, openCreditLineCutPopup, recDateOverride, dashDate, selectedDriver, refresh]);

  const toggleVoiceSearch = useCallback(() => {
    if (isListeningRef.current) {
      isListeningRef.current = false;
      setIsListening(false);
      setVoiceFeedback("Voice mic band kiya gaya");
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
        recognitionRef.current = null;
      }
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Voice recognition browser me support nahi karta. Please Chrome or Edge Browser use karein.");
      return;
    }

    try {
      isListeningRef.current = true;
      setIsListening(true);
      let lastProcessedTranscript = '';
      let speechDebounceTimer: any = null;
      let accumulatedFinal = '';

      const startRecognition = () => {
        if (!isListeningRef.current) return;

        const rec = new SpeechRecognition();
        recognitionRef.current = rec;
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = 'hi-IN';
        rec.maxAlternatives = 5;

        rec.onstart = () => {
          if (isListeningRef.current) {
            setIsListening(true);
            setVoiceFeedback("Listening... Bolein Bill Number");
          }
        };

        rec.onresult = (event: any) => {
          if (!isListeningRef.current) return;

          let currentInterim = '';
          let newlyFinal = '';

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            const trans = event.results[i].isFinal
              ? pickBestTranscript(event.results[i])
              : String(event.results[i][0]?.transcript || '');
            if (event.results[i].isFinal) {
              newlyFinal += trans + ' ';
            } else {
              currentInterim += trans + ' ';
            }
          }

          if (newlyFinal) {
            accumulatedFinal = (accumulatedFinal + ' ' + newlyFinal).trim();
          }

          const activePhrase = (accumulatedFinal + ' ' + currentInterim).trim();

          if (activePhrase) {
            setVoiceFeedback(`Listening: "${activePhrase}"`);
          }

          // Listen completely! Wait for silence debounce before finding and announcing the bill
          if (speechDebounceTimer) clearTimeout(speechDebounceTimer);
          const debounceMs = newlyFinal ? 600 : 1100;

          speechDebounceTimer = setTimeout(() => {
            if (!isListeningRef.current) return;
            const fullTranscript = (accumulatedFinal || currentInterim).trim();
            if (fullTranscript && fullTranscript !== lastProcessedTranscript) {
              lastProcessedTranscript = fullTranscript;
              accumulatedFinal = ''; // reset buffer for next phrase
              processVoiceInput(fullTranscript);
            }
          }, debounceMs);
        };

        rec.onerror = (event: any) => {
          const err = event?.error;
          if (err === 'no-speech' || err === 'aborted') {
            // Normal pause or interrupt, gracefully ignore
            return;
          }
          if (err === 'not-allowed' || err === 'service-not-allowed') {
            isListeningRef.current = false;
            setIsListening(false);
            setVoiceFeedback("Mic permission block hai! Browser me mic allow karein.");
            speakText("Microphone permission denied");
          }
        };

        rec.onend = () => {
          if (recognitionRef.current === rec) {
            recognitionRef.current = null;
          }
          if (isListeningRef.current) {
            setTimeout(() => {
              if (isListeningRef.current) startRecognition();
            }, 300);
          } else {
            setIsListening(false);
          }
        };

        try {
          rec.start();
        } catch (e) {
          console.error('Speech start err:', e);
        }
      };

      startRecognition();
    } catch (err) {
      console.error('Speech start error:', err);
      isListeningRef.current = false;
      setIsListening(false);
    }
  }, [processVoiceInput, pickBestTranscript, speakText]);

  // ── "HEY HUL" wake-word: background continuous listening ────────────────────
  useEffect(() => {
    if (!wakeMode) return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      alert("Voice recognition browser me support nahi karta. Chrome/Edge use karein.");
      setWakeMode(false);
      return;
    }
    let stopped = false;
    let rec: any = null;
    let lastProcessed = 0;

    const start = () => {
      if (stopped) return;
      try {
        rec = new SR();
        rec.continuous = true;
        rec.interimResults = false;
        rec.lang = 'hi-IN';
        rec.maxAlternatives = 5;
        rec.onresult = (event: any) => {
          for (let i = event.resultIndex; i < event.results.length; i++) {
            if (!event.results[i].isFinal) continue;
            const t = pickBestTranscript(event.results[i]).trim();
            if (hasWakeWord(t)) {
              const cmdText = stripWakeWord(t);
              if (cmdText) {
                const now = Date.now();
                if (now - lastProcessed > 1500) {
                  lastProcessed = now;
                  processVoiceInput(cmdText);
                }
              } else {
                setVoiceFeedback("HEY HUL — boliye bill number");
              }
            }
          }
        };
        rec.onerror = (e: any) => {
          if (e?.error === 'not-allowed') {
            stopped = true;
            setWakeMode(false);
            setVoiceFeedback("Mic access block hai! Browser me mic allow karein.");
          }
        };
        rec.onend = () => { if (!stopped) setTimeout(start, 500); };
        rec.start();
      } catch { /* ignore */ }
    };
    start();
    wakeRecRef.current = rec;
    return () => {
      stopped = true;
      try { rec?.stop(); } catch {}
      wakeRecRef.current = null;
    };
  }, [wakeMode, processVoiceInput, pickBestTranscript]);


  function deriveMode(pm: string) {
    // Del Pending is always non-collection — honour it regardless of amounts
    if (pm === 'Del Pending') return pm;

    // Amounts ALWAYS take priority — even over FBR / Credit.
    // Entering any cash/gpay/cheque means the bill is being collected now
    // and must save as Paid (Cash/UPI/Cheque/Split) with a collection date,
    // even if the bill was previously FBR/Credit.
    const active: string[] = [];
    if (Number(cashAmt) > 0) active.push('Cash');
    if (Number(upiAmt) > 0) active.push('UPI');
    if (Number(chqAmt) > 0) active.push('Cheque');
    if (active.length > 0) return active.length > 1 ? 'Split' : active[0];

    // No amounts typed — use whatever mode button was pressed (FBR/Credit/Unpaid/etc.)
    return pm || 'Unknown';
  }

  function clearReceivedAmounts() {
    setCashAmt('');
    setUpiAmt('');
    setChqAmt('');
    setChequeNo('');
    setBankName('');
    setChequeDate('');
    setChqDateDD('');
  }

  function openCreditLineCutPopup() {
    if (!selectedBill) return;
    clearReceivedAmounts();
    const existingLineCut = Math.max(
      0,
      Number(selectedBill.lineCutAmt) || Number(selectedBill.cancelLine) || 0,
    );
    setPaymentMode('Credit');
    setLcInputVal(existingLineCut > 0 ? String(existingLineCut) : '0');
    setLcAsOutstanding(true);
    setShowLineCutPopup(true);
  }

  // ── Save as Credit with outstanding ─────────────────────────────────────────
  // Credit must keep the bill's accumulated line-cut amount. The remaining
  // balance is the amount shown in Credit; line-cut must never be reset to 0.
  async function doSaveAsOutstanding(lineCutTotal?: number, discrepancyReason?: string | null) {
    if (!selectedBill || !selectedDriver || saving) return;
    setSaving(true);
    setSaveError(null);
    const effectiveDriver = selectedDriver || selectedBill?.driverName || '';
    const effectiveLineCut = Math.min(
      Number(selectedBill.billNetAmt) || 0,
      Math.max(0, lineCutTotal ?? 0),
    );
    const outstandingAmt = Math.max(
      0,
      (Number(selectedBill.billNetAmt) || 0) - effectiveLineCut - totalCollected,
    );

    const ok = await savePayment(
      selectedBillNo, 'Credit', null, totalCollected,
      confirmInput || null, effectiveDriver, dashDate,
      chequeNo || null, bankName || null, null,
      { cash: Number(cashAmt) || 0, upi: Number(upiAmt) || 0, cheque: Number(chqAmt) || 0 },
      effectiveLineCut,
      recDateOverride || null,
      selectedDriver,
      chequeDate || null,
      discrepancyReason || null
    );
    if (!ok) {
      setSaving(false);
      setSaveError('Save nahi hua — dobara try karein.');
      return;
    }

    const savedBill = getBills().find(b => b.billNo === selectedBillNo);
    const finalPayDate = totalCollected > 0 ? (savedBill?.paymentDate || recDateOverride || isoToDisplay(dashDate) || dashDate) : '';
    const finalPayTime = totalCollected > 0 ? (savedBill?.paymentTime || getLoggedInName() || selectedDriver) : '';
    if (savedBill?.id) {
      const { apiPatchBill } = await import('@/lib/apiSync');
      await apiPatchBill(savedBill.id, {
        outstandingAmount: outstandingAmt,
        lineCutAmt:        effectiveLineCut,
        collectedAmount:   totalCollected,
        cashAmount:        Number(cashAmt) || 0,
        upiAmount:         Number(upiAmt) || 0,
        chequeAmount:      Number(chqAmt) || 0,
        paymentMode:       'Credit',
        chequeNo:          chequeNo || '',
        bankName:          bankName || '',
        chequeDate:        chequeDate || '',
        paymentDate:       finalPayDate,
        paymentTime:       finalPayTime,
        discrepancyReason: discrepancyReason || undefined,
      }, selectedBillNo);
      patchBillInMemory(selectedBillNo, {
        outstandingAmount: outstandingAmt,
        lineCutAmt:        effectiveLineCut,
        collectedAmount:   totalCollected,
        cashAmount:        Number(cashAmt) || 0,
        upiAmount:         Number(upiAmt) || 0,
        chequeAmount:      Number(chqAmt) || 0,
        paymentMode:       'Credit',
        chequeNo:          chequeNo || '',
        bankName:          bankName || '',
        chequeDate:        chequeDate || '',
        paymentDate:       finalPayDate,
        paymentTime:       finalPayTime,
        discrepancyReason: discrepancyReason || undefined,
      });
    }

    setOwnerSavedBillNos(prev => [...prev.filter(x => x !== selectedBillNo), selectedBillNo]);

    // ── Auto WhatsApp to Salesperson on CREDIT Save: SEND FIRST ──
    const billToNotify: Bill = {
      ...(savedBill || selectedBill),
      paymentMode: 'Credit',
      lineCutAmt: effectiveLineCut,
      collectedAmount: totalCollected,
      driverName: effectiveDriver,
    };
    handleSendWhatsAppToSalesperson(billToNotify);

    // ── FIR SAVE SHOW HOGA ──
    setLastSavedBill({
      billNo: selectedBillNo,
      partyName: selectedBill.partyName,
      diff: 0,
    });
    setShowPaidPopup(true);
    setSaving(false);
    setTimeout(() => {
      setShowPaidPopup(false);
      billInputRef.current?.focus();
    }, 2000);
    handleReset();
    refresh();
  }

  async function doSaveFBR(reason: string) {
    if (!selectedBill || !selectedDriver || saving) return;
    setSaving(true);
    setSaveError(null);
    setShowFbrReasonModal(false);
    const effectiveDriver = selectedDriver || selectedBill?.driverName || '';
    // FBR = full bill amount goes into line cut (nothing collected) so the
    // rule engine locks the status as FBR instead of re-deriving it as Unpaid/Paid.
    const fullBillAmt = Number(selectedBill.billNetAmt);
    if (!fullBillAmt || fullBillAmt <= 0) {
      setSaving(false);
      setSaveError('FBR save nahi hua — bill amount invalid hai.');
      return;
    }
    const ok = await savePayment(
      selectedBillNo, 'FBR', null, 0,
      null, effectiveDriver, dashDate,
      null, null, null,
      { cash: 0, upi: 0, cheque: 0 },
      fullBillAmt,
      null,
      selectedDriver   // enteredBy
    );
    if (!ok) {
      setSaving(false);
      setSaveError('FBR save nahi hua — dobara try karein.');
      return;
    }
    if (reason) patchBillInMemory(selectedBillNo, { discrepancyReason: reason });
    setLastSavedBill({ billNo: selectedBillNo, partyName: selectedBill.partyName, diff: 0 });
    setOwnerSavedBillNos(prev => [...prev.filter(x => x !== selectedBillNo), selectedBillNo]);
    setShowPaidPopup(true);
    setSaving(false);
    setTimeout(() => { setShowPaidPopup(false); billInputRef.current?.focus(); }, 2000);
    handleReset();
    refresh();
  }

  // lcOverride: user-entered line cut from the Line Cut Popup (overrides auto-computed diff)
  // recDateParam: explicit rec date passed from confirmRecDateAndSave to avoid stale-closure issue
  async function doSave(lcOverride?: number | null, recDateParam?: string | null, discrepancyReason?: string | null) {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    setShowDiffConfirm(false);

    const isDriverRole = getRole() === 'driver' || isDriverMode;
    const isMoc = isMocBill(selectedBillNo, selectedBill);
    const finalMode = deriveMode(paymentMode);
    const diff = isMoc ? 0 : (selectedBill ? selectedBill.billNetAmt - totalCollected : 0);
    const effectiveDriver = selectedDriver || selectedBill?.driverName || '';

    console.log(`[doSave] Saving ${selectedBillNo} | mode=${finalMode} | amount=${totalCollected} | isMoc=${isMoc} | bills in memory=${getBills().length} | bill in memory=${!!getBills().find(b=>b.billNo===selectedBillNo)}`);

    // If lcOverride provided (from line cut popup), use it; else calculate Line Cut = Bill Amt - Rec Amt
    const existingBillLc = (selectedBill?.lineCutAmt || 0) || Number(selectedBill?.cancelLine) || 0;
    const maxAllowedLc = selectedBill ? Math.max(0, selectedBill.billNetAmt - totalCollected) : 0;
    let lineCutToSave: number | null = null;
    if (isMoc) {
      lineCutToSave = 0;
    } else if (finalMode === 'Credit') {
      lineCutToSave = (lcOverride !== undefined && lcOverride !== null) ? Math.min(lcOverride, maxAllowedLc) : 0;
    } else if (finalMode === 'FBR') {
      lineCutToSave = selectedBill ? selectedBill.billNetAmt : null;
    } else if (lcOverride !== undefined && lcOverride !== null) {
      lineCutToSave = Math.min(lcOverride, maxAllowedLc);
    } else if (totalCollected > 0 && selectedBill) {
      lineCutToSave = Math.max(0, selectedBill.billNetAmt - totalCollected);
    } else {
      lineCutToSave = existingBillLc > 0 ? existingBillLc : null;
    }

    // recDateParam takes priority (avoids stale-closure issue when called from confirmRecDateAndSave)
    const isZeroColMode = finalMode === 'Credit' || finalMode === 'Unpaid' || finalMode === 'FBR' || finalMode === 'Del Pending' || totalCollected === 0;
    const effectiveRecDate = isDriverRole
      ? getTodayISO()
      : isZeroColMode
        ? dashDate
        : (recDateParam !== undefined && recDateParam !== null && String(recDateParam).trim() !== ''
            ? recDateParam
            : (recDateOverride && String(recDateOverride).trim() !== ''
                ? recDateOverride
                : getTodayDMY()));
    const effectiveChequeDate = chequeDate || (chqDateDD.trim() ? `${chqDateDD.trim().padStart(2, '0')}/${String(new Date().getMonth() + 1).padStart(2, '0')}/${new Date().getFullYear()}` : (Number(chqAmt) > 0 ? (isoToDisplay(effectiveRecDate) || dashDate) : null));

    const todayDMY = getTodayDMY();
    const dashDateDMY = isoToDisplay(dashDate) || todayDMY;
    const recDateDMY = isoToDisplay(effectiveRecDate) || effectiveRecDate || dashDateDMY;
    const isDiffRecDate = !isZeroColMode && !!(recDateDMY && recDateDMY !== todayDMY && recDateDMY !== dashDateDMY);

    const isSelectedStaffOrOwner = selectedDriver && (
      selectedDriver === 'OWNER' ||
      drivers.some(d => (d.name || '').trim().toUpperCase() === selectedDriver.trim().toUpperCase() && (d.role === 'user' || d.role === 'owner'))
    );

    const effectivePaymentTime = (selectedDriver === 'OWNER' || getRole() === 'owner')
      ? 'OWNER'
      : (getLoggedInName() || (isSelectedStaffOrOwner ? selectedDriver : (isDiffRecDate ? 'PRATIXA' : selectedDriver)));

    const ok = await savePayment(
      selectedBill?.billNo || selectedBillNo, finalMode, null, totalCollected,
      confirmInput || null, effectiveDriver, dashDate,
      chequeNo || null, bankName || null, null,
      { cash: Number(cashAmt) || 0, upi: Number(upiAmt) || 0, cheque: Number(chqAmt) || 0 },
      lineCutToSave,
      effectiveRecDate,
      effectivePaymentTime,   // enteredBy: who made this entry
      effectiveChequeDate || null,  // chequeDate — saved immediately
      discrepancyReason || null,
      selectedBill?.id || null,     // exact billId
    );
    if (!ok) {
      setSaving(false);
      setSaveError('Save nahi hua — dobara Save dabayein. Baar baar fail ho to page refresh karein aur dobara try karein.');
      return;
    }

    const savedIdentifier = selectedBill?.billNo || selectedBillNo;

    // ── Auto WhatsApp to Salesperson on CREDIT Save: SEND FIRST ──
    if (finalMode === 'Credit') {
      const billToNotify: Bill | undefined = selectedBill
        ? {
            ...selectedBill,
            paymentMode: 'Credit',
            lineCutAmt: lineCutToSave != null ? lineCutToSave : selectedBill.lineCutAmt,
            collectedAmount: totalCollected,
            driverName: selectedBill.driverName || (selectedDriver !== 'OWNER' ? selectedDriver : '') || selectedDriver,
          }
        : getBills().find(b => b.billNo === savedIdentifier);
      if (billToNotify) {
        handleSendWhatsAppToSalesperson(billToNotify);
      }
    }

    // ── FIR SAVE SHOW HOGA ──
    setLastSavedBill({ 
      billNo: savedIdentifier, 
      partyName: selectedBill?.partyName,
      diff: totalCollected > 0 ? diff : 0
    });
    setOwnerSavedBillNos(prev => [...prev.filter(x => x !== savedIdentifier && x !== (selectedBill?.id || '')), savedIdentifier, ...(selectedBill?.id ? [selectedBill.id] : [])]);
    setShowPaidPopup(true);
    setSaving(false);
    
    setTimeout(() => {
      setShowPaidPopup(false);
      billInputRef.current?.focus();
    }, 2000);

    handleReset();
    refresh();
  }

  // ── Cheque Metadata Save: update only chequeDate + bankName on a locked paid bill ──
  // Also propagates to all sibling bills that share the same chequeNo + driver.
  async function doSaveChequeMetadata() {
    if (!selectedBill || !selectedBillNo || saving) return;
    setSaving(true);
    setSaveError(null);
    const metaPatch: Record<string, unknown> = {};
    if (chequeNo)   metaPatch.chequeNo   = chequeNo.trim();
    if (chequeDate) metaPatch.chequeDate = chequeDate;
    if (bankName)   metaPatch.bankName   = bankName;
    if (Object.keys(metaPatch).length === 0) { setSaving(false); return; }

    // patchBillDirect: memory + immediate Supabase save (cheque data must sync instantly)
    const ok = await patchBillDirect(selectedBillNo, metaPatch as any);
    if (!ok) {
      setSaving(false);
      setSaveError('Cheque details save nahi hua. Dobara try karein.');
      return;
    }

    setLastSavedBill({ billNo: selectedBillNo, partyName: selectedBill.partyName, diff: 0 });
    setOwnerSavedBillNos(prev => [...prev.filter(x => x !== selectedBillNo), selectedBillNo]);
    setShowPaidPopup(true);
    setSaving(false);
    setTimeout(() => { setShowPaidPopup(false); billInputRef.current?.focus(); }, 2000);
    handleReset();
    refresh();
  }

  // ── Overflow: open modal with first bill pending (nothing saved yet) ──────────
  function doSaveOverflow(recDateParam?: string | null) {
    if (!canSave || !selectedBill) return;
    const finalMode = deriveMode(paymentMode);
    const effectiveDriver = selectedDriver || selectedBill?.driverName || '';
    const isDriverRole = getRole() === 'driver' || isDriverMode;
    const isZeroColMode = finalMode === 'Credit' || finalMode === 'Unpaid' || finalMode === 'FBR' || finalMode === 'Del Pending' || totalCollected === 0;
    
    const effectiveRecDate = isDriverRole
      ? getTodayISO()
      : isZeroColMode
        ? dashDate
        : (recDateParam !== undefined && recDateParam !== null
            ? recDateParam
            : (recDateOverride || (recDateInput ? isoToDisplay(recDateInput) : null) || selectedBill?.paymentDate || isoToDisplay(dashDate) || dashDate));

    const effectiveChequeDate = chequeDate || (chqDateDD.trim() ? `${chqDateDD.trim().padStart(2, '0')}/${String(new Date().getMonth() + 1).padStart(2, '0')}/${new Date().getFullYear()}` : (Number(chqAmt) > 0 ? (isoToDisplay(effectiveRecDate) || dashDate) : ''));

    setOverflowMode(finalMode);
    setOverflowTotalCollected(totalCollected);
    setOverflowEffectiveDriver(effectiveDriver);
    setOverflowChequeSaved(chequeNo || '');
    setOverflowBankSaved(bankName || '');
    setOverflowChequeDateSaved(effectiveChequeDate || '');
    setOverflowRecDateSaved(effectiveRecDate || '');
    const existingLc = (Number(selectedBill.lineCutAmt) || 0) || (Number(selectedBill.cancelLine) || 0);
    const initLineCut = existingLc > 0 ? String(existingLc) : '0';
    setOverflowPendingItems([{ billNo: selectedBillNo, partyName: selectedBill.partyName, billNetAmt: selectedBill.billNetAmt, lineCutInput: initLineCut }]);
    setOverflowNextBillInput('');
    setOverflowNextBillErr('');
    setShowOverflowModal(true);
    handleReset();
    setTimeout(() => overflowInputRef.current?.focus(), 300);
  }

  // ── Add another bill to the pending overflow chain ────────────────────────────
  function handleOverflowAddNextBill() {
    const bn = overflowNextBillInput.trim();
    if (!bn) return;
    const bill = getBills().find(b => b.billNo === bn || b.billNo.endsWith(bn) || bn.endsWith(b.billNo));
    if (!bill) { setOverflowNextBillErr(`Bill "${bn}" not found`); return; }
    if (overflowPendingItems.some(x => x.billNo === bill.billNo)) { setOverflowNextBillErr('Already in chain'); return; }
    setOverflowNextBillErr('');
    const existingLc = (Number(bill.lineCutAmt) || 0) || (Number(bill.cancelLine) || 0);
    const nextLineCut = existingLc > 0 ? String(existingLc) : '0';
    setOverflowPendingItems(prev => [...prev, { billNo: bill.billNo, partyName: bill.partyName, billNetAmt: bill.billNetAmt, lineCutInput: nextLineCut }]);
    setOverflowNextBillInput('');
    setTimeout(() => overflowInputRef.current?.focus(), 50);
  }

  // ── Save ALL pending overflow bills together ──────────────────────────────────
  async function handleOverflowSaveAll(itemsSnap: Array<{ billNo: string; partyName: string; billNetAmt: number; lineCutInput: string; applied?: number; lineCut?: number; netPayable?: number }>) {
    if (overflowSaving || itemsSnap.length === 0) return;
    setOverflowSaving(true);
    setSaveError(null);
    const chainRecDate = overflowRecDateSaved || isoToDisplay(dashDate) || dashDate;
    const chainChequeDate = overflowChequeDateSaved || null;
    let rem = Number(overflowTotalCollected) || 0;

    for (const item of itemsSnap) {
      const allBills = getBills();
      const bill = allBills.find(b => (b.billNo || '').toLowerCase() === (item.billNo || '').toLowerCase());
      const billNet = Number(item.billNetAmt) || Number(bill?.billNetAmt) || Number(bill?.outstandingAmount) || 0;
      const existingLc = (Number(bill?.lineCutAmt) || 0) || (Number(bill?.cancelLine) || 0);

      let lineCut = item.lineCut !== undefined
        ? item.lineCut
        : (item.lineCutInput !== ''
            ? Math.max(0, Math.min(Number(item.lineCutInput) || 0, billNet))
            : (existingLc > 0 ? existingLc : Math.max(0, billNet - rem)));

      const netPayable = Math.max(0, billNet - lineCut);
      const applied = item.applied !== undefined ? item.applied : Math.min(rem, netPayable);
      rem = Math.max(0, rem - applied);

      // Auto-cover remaining shortfall with Line Cut so every bill in the chain is marked PAID
      const effectiveLineCut = (lineCut > 0) ? lineCut : Math.max(0, billNet - applied);

      const appliedSplit = {
        cash:   (overflowMode === 'Cash' || overflowMode === 'Split') ? applied : 0,
        upi:    overflowMode === 'UPI'    ? applied : 0,
        cheque: overflowMode === 'Cheque' ? applied : 0,
      };
      const ok = await savePayment(
        item.billNo,
        overflowMode,
        null,
        applied,
        null,
        overflowEffectiveDriver,
        dashDate,
        overflowChequeSaved || null,
        overflowBankSaved || null,
        null,
        appliedSplit,
        effectiveLineCut > 0 ? effectiveLineCut : null,
        chainRecDate,
        getLoggedInName(),
        chainChequeDate
      );
      if (!ok) {
        setOverflowSaving(false);
        setSaveError(`Bill ${item.billNo} database me save nahi hua. Dobara try karein.`);
        return;
      }
    }

    setOwnerSavedBillNos(prev => {
      let arr = [...prev];
      for (const item of itemsSnap) { arr = arr.filter(x => x !== item.billNo); arr.push(item.billNo); }
      return arr;
    });
    setOverflowSaving(false);
    setShowOverflowModal(false);
    setOverflowPendingItems([]);
    setLastSavedBill({ billNo: itemsSnap[0]?.billNo || '', partyName: itemsSnap[0]?.partyName, diff: 0 });
    setShowPaidPopup(true);
    setTimeout(() => { setShowPaidPopup(false); billInputRef.current?.focus(); }, 2000);
    refresh();
  }

  // ── Part Payment Save: saves Credit status + appends to partPayments array ────
  async function doPartSave() {
    if (!selectedBill || !selectedDriver || saving) return;
    setSaving(true);
    setSaveError(null);
    const cash   = Number(cashAmt) || 0;
    const upi    = Number(upiAmt)  || 0;
    const cheque = Number(chqAmt)  || 0;
    const partAmt = cash + upi + cheque;
    if (partAmt <= 0) { setSaving(false); return; }

    const effectiveDriver = selectedDriver || selectedBill?.driverName || '';

    const now = new Date();
    const todayDisp = recDateOverride || `${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()}`;

    const existingParts = selectedBill.partPayments || [];
    const newPart = { date: todayDisp, cash, upi, cheque, amount: partAmt, chequeNo: chequeNo || undefined, bankName: bankName || undefined };
    const allParts = [...existingParts, newPart];

    const totalCollectedAll = allParts.reduce((s, p) => s + p.amount, 0);
    const lineCutTotal = Number(selectedBill.lineCutAmt) || 0;
    const outstanding = Math.max(0, selectedBill.billNetAmt - lineCutTotal - totalCollectedAll);
    const primaryDate = existingParts.length > 0 ? existingParts[0].date : todayDisp;
    const totalCash   = allParts.reduce((s, p) => s + p.cash,   0);
    const totalUpi    = allParts.reduce((s, p) => s + p.upi,    0);
    const totalCheque = allParts.reduce((s, p) => s + p.cheque, 0);

    const patch: Partial<import('@/lib/billStore').Bill> = {
      paymentMode:      'Credit',
      collectedAmount:  totalCollectedAll,
      outstandingAmount: outstanding,
      cashAmount:       totalCash,
      upiAmount:        totalUpi,
      chequeAmount:     totalCheque,
      paymentDate:      primaryDate,
      paymentTime:      selectedDriver === 'OWNER' ? 'OWNER' : (getLoggedInName() || selectedDriver),
      driverName:       effectiveDriver,
      partPayments:     allParts,
    };

    patchBillInMemory(selectedBillNo, patch);

    const billInMem = getBills().find(b => b.billNo === selectedBillNo);
    const billId = billInMem?.id || '';

    try {
      const { apiPatchBill } = await import('@/lib/apiSync');
      let result = await apiPatchBill(billId, patch, selectedBillNo);
      if (!result.ok) {
        // part_payments column may not exist yet — retry without it
        const { partPayments: _pp, ...patchNoPP } = patch as any;
        result = await apiPatchBill(billId, patchNoPP, selectedBillNo);
        if (!result.ok) {
          setSaving(false);
          setSaveError('Part payment save nahi hua. Dobara try karein.');
          return;
        }
      }
    } catch {
      setSaving(false);
      setSaveError('Part payment save nahi hua. Dobara try karein.');
      return;
    }

    // ── Auto WhatsApp to Salesperson on Part/Credit Save: SEND FIRST ──
    const billToNotify: Bill | undefined = selectedBill
      ? { ...selectedBill, ...patch }
      : getBills().find(b => b.billNo === selectedBillNo);
    if (billToNotify) {
      handleSendWhatsAppToSalesperson(billToNotify);
    }

    // ── FIR SAVE SHOW HOGA ──
    setLastSavedBill({ billNo: selectedBillNo, partyName: selectedBill.partyName, diff: outstanding });
    setOwnerSavedBillNos(prev => [...prev.filter(x => x !== selectedBillNo), selectedBillNo]);
    setShowPaidPopup(true);
    setSaving(false);

    setTimeout(() => { setShowPaidPopup(false); billInputRef.current?.focus(); }, 2500);
    handleReset();
    refresh();
  }

  // Decides which save path to take (special status / overflow / diff-confirm / normal save).
  // recDateParam: explicit rec date from confirmRecDateAndSave — passed through to doSave to
  // avoid the stale-closure problem (recDateOverride state may not be committed yet).
  function proceedToSave(recDateParam?: string | null) {
    const isDriverRole = getRole() === 'driver' || isDriverMode;
    const isSpecial = paymentMode === 'FBR' || paymentMode === 'Del Pending';
    const netAmt = selectedBill?.billNetAmt;
    const recDate = isDriverRole ? getTodayISO() : recDateParam;

    const isMoc = isMocBill(selectedBillNo, selectedBill);
    // MOC bills: ALWAYS save directly without Chain Payment (overflow) or Line Cut popup
    if (isMoc) {
      doSave(0, recDate);
      return;
    }

    // Overflow (rec amount > bill amount) always takes priority — open chain modal.
    if (!isSpecial && netAmt != null && totalCollected > netAmt) { doSaveOverflow(recDateParam); return; }

    // Cheque metadata-only update (editLocked or received bill — only update chequeNo + chequeDate + bankName)
    if (isChqMetaOnlyEdit || isEditLockedChqMeta) { doSaveChequeMetadata(); return; }

    if (isSpecial) doSave(null, recDate);
    else if (netAmt != null && totalCollected < netAmt && totalCollected > 0) {
      // Partial payment → Line Cut automatically calculated as: Bill Net Amt - Received Amt
      const calculatedLc = Math.max(0, netAmt - totalCollected);
      setLcInputVal(String(calculatedLc));
      setLcAsOutstanding(false);
      setShowLineCutPopup(true);
    }
    else doSave(null, recDate);
  }

  // Entry point for the Save button/Enter key. Open Save Time Popup with editable REC DATE.
  function handleSaveClick() {
    if (getRole() === 'driver' || isDriverMode) {
      proceedToSave(getTodayISO());
      return;
    }
    const isMoc = isMocBill(selectedBillNo, selectedBill);
    const _m = (selectedBill?.paymentMode || '').toLowerCase();
    const isCreditMode = paymentMode === 'Credit' || (paymentMode === '' && totalCollected === 0 && _m === 'credit');
    const isUnpaidMode = paymentMode === 'Unpaid' || (paymentMode === '' && totalCollected === 0 && (_m === 'unpaid' || _m === 'pending'));
    const isFbrMode = paymentMode === 'FBR' || (paymentMode === '' && totalCollected === 0 && (_m === 'fbr' || _m === 'cancel'));
    const isDelPendMode = paymentMode === 'Del Pending' || (paymentMode === '' && _m === 'del pending');
    const isAssignedOrZero = totalCollected === 0 && !selectedBill?.paymentDate;

    if (isMoc || isCreditMode || isUnpaidMode || isFbrMode || isDelPendMode || isAssignedOrZero) {
      // Direct save in current date (dashDate) without showing Rec Date option / confirm modal
      proceedToSave(dashDate);
      return;
    }

    const initialDateIso = recDateInput || dashDate;
    setRecDateInput(initialDateIso);
    setShowRecDateConfirm(true);
  }

  function confirmRecDateAndSave() {
    const isoVal = recDateInput || dashDate;
    const chosenDisplay = isoToDisplay(isoVal) || isoToDisplay(dashDate);
    setRecDateOverride(chosenDisplay);
    setShowRecDateConfirm(false);
    setTimeout(() => proceedToSave(chosenDisplay), 0);
  }

  function handleReset() {
    // Clear draft — save was successful, no need to restore anything
    try { localStorage.removeItem('vt_dash_draft'); } catch {}
    setSelectedBillNo('');
    setSearchQuery('');
    setCashAmt('');
    setUpiAmt('');
    setChqAmt('');
    setBankName('');
    setChequeNo('');
    setChequeDate('');
    setChqDateDD('');
    setPaymentMode('');
    setConfirmInput('');
    setDelPendingDriver('');
    setEditLocked(true);
    setRecDateInput(dashDate);
    setRecDateOverride(isoToDisplay(dashDate));
    billInputRef.current?.focus();
  }

  function handleFormReset() {
    // Clear all form fields
    setCashAmt('');
    setUpiAmt('');
    setChqAmt('');
    setBankName('');
    setChequeNo('');
    setChequeDate('');
    setChqDateDD('');
    setPaymentMode('');
    setConfirmInput('');

    // If a bill is selected, wipe its payment data on the server too
    // but keep driverName + deliveryDate (driver assignment stays)
    if (selectedBillNo) {
      patchBillInMemory(selectedBillNo, {
        cashAmount: 0,
        upiAmount: 0,
        chequeAmount: 0,
        chequeNo: undefined,
        bankName: undefined,
        chequeDate: undefined,
        paymentMode: undefined,
        paymentDate: undefined,
        paymentTime: undefined,
        collectedAmount: 0,
        cancelLine: undefined,
        lineCutAmt: 0,
      });
      refresh();
    }
  }

  // Helper to calculate due days from delivery date (or bill date) to current date: DUE DAYS = CURRENT DATE - DEL DATE
  const calculateBillDueDays = (dateStr?: string): number => {
    if (!dateStr) return 0;
    const iso = displayToIso(dateStr) || (dateStr.includes('-') ? dateStr : '');
    if (!iso) return 0;
    const parts = iso.split('-');
    if (parts.length !== 3) return 0;
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return 0;

    const delDateObj = new Date(y, m, d);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const delDay = new Date(delDateObj.getFullYear(), delDateObj.getMonth(), delDateObj.getDate());
    const diffMs = today.getTime() - delDay.getTime();
    return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  };

  // Helper to format WhatsApp message based on bill status (CREDIT vs PAID)
  const formatSalespersonWhatsAppMessage = useCallback((
    b: Bill,
    customSalespersonName?: string,
    useFormContext: boolean = true
  ) => {
    const rawSalespersonName = customSalespersonName || (b.salespersonName || '').trim();
    const salespersonName = cleanSalespersonName(rawSalespersonName).trim() || rawSalespersonName || 'N/A';
    const partyName = b.partyName || '-';
    const billNo = b.billNo || '-';
    const delDate = isoToDisplay(b.deliveryDate || b.date) || '-';
    const driverName = b.driverName || (selectedDriver && selectedDriver !== 'OWNER' ? selectedDriver : '') || selectedDriver || '-';
    const billAmt = b.billNetAmt || 0;

    // Line cut calculation
    let lineCut = (b.lineCutAmt || 0) || Number(b.cancelLine) || 0;
    if (useFormContext && selectedBill && selectedBill.billNo === b.billNo && lcInputVal) {
      const parsedLc = parseAmountExpression(lcInputVal);
      if (parsedLc > 0) lineCut = parsedLc;
    }

    // Collected calculation
    let collected = b.collectedAmount || 0;
    if (useFormContext && selectedBill && selectedBill.billNo === b.billNo) {
      const formCash = Number(cashAmt) || 0;
      const formUpi = Number(upiAmt) || 0;
      const formChq = Number(chqAmt) || 0;
      const formSum = formCash + formUpi + formChq;
      if (formSum > 0) collected = formSum;
    }

    const pendingAmt = Math.max(0, billAmt - lineCut - collected);
    const effectiveRec = isoToDisplay(b.paymentDate) || (recDateOverride ? recDateOverride : (recDateInput ? isoToDisplay(recDateInput) : '')) || getTodayDMY();

    const currentMode = (
      (useFormContext && selectedBill && selectedBill.billNo === b.billNo && paymentMode) ||
      b.paymentMode ||
      ''
    ).trim().toLowerCase();

    // Check if status is PAID vs CREDIT
    const isPaid = (collected > 0) || currentMode === 'paid' || (!!b.paymentDate && pendingAmt === 0);
    const isCredit = currentMode === 'credit' || (!isPaid && currentMode !== 'fbr' && currentMode !== 'cancel' && currentMode !== 'del pending');

    if (isCredit) {
      const dueDays = calculateBillDueDays(b.deliveryDate || b.date);
      return `*PAYMENT  PENDING ALERT*
━━━━━━━━━━━━━━━━━━━━
👤 Salesperson: ${salespersonName}
🏢 Party: ${partyName}
📄 Bill No: ${billNo}
🚚 Driver: ${driverName}
📅 Del Date: ${delDate}
💰 Bill Net Amt: ₹${billAmt.toLocaleString('en-IN')}
*DUE DAYS= ${dueDays} Days*
📌 Status: CREDIT
━━━━━━━━━━━━━━━━━━━━
Kripya party se is bill ka payment collection coordinate karein.`;
    }

    if (isPaid) {
      return `🔔 VitraTrack - REC PAYMENT 
━━━━━━━━━━━━━━━━━━━━
👤 Salesperson: ${salespersonName}
🏢 Party: ${partyName}
📄 Bill No: ${billNo}
🚚 Driver: ${driverName}
📅 Del Date: ${delDate}
🗓️ Rec Date: ${effectiveRec}
💰 Bill Net Amt: ₹${billAmt.toLocaleString('en-IN')}
📉 Line Cut: ₹${lineCut.toLocaleString('en-IN')}
💵 Collected Amt: ₹${collected.toLocaleString('en-IN')}
⚠️ Pending Amt: ₹${pendingAmt.toLocaleString('en-IN')}
📌 *Status: PAID*`;
    }

    // Default / FBR / Del Pending fallback
    const dueDays = calculateBillDueDays(b.deliveryDate || b.date);
    const modeUpper = (currentMode || 'PENDING').toUpperCase();
    return `*PAYMENT  PENDING ALERT*
━━━━━━━━━━━━━━━━━━━━
👤 Salesperson: ${salespersonName}
🏢 Party: ${partyName}
📄 Bill No: ${billNo}
🚚 Driver: ${driverName}
📅 Del Date: ${delDate}
💰 Bill Net Amt: ₹${billAmt.toLocaleString('en-IN')}
*DUE DAYS= ${dueDays} Days*
📌 Status: ${modeUpper}
━━━━━━━━━━━━━━━━━━━━
Kripya party se is bill ka payment collection coordinate karein.`;
  }, [selectedBill, selectedDriver, lcInputVal, cashAmt, upiAmt, chqAmt, paymentMode, recDateOverride, recDateInput]);

  // ── WhatsApp Direct Reminder to Salesperson ─────────────────────────────────
  const handleSendWhatsAppToSalesperson = useCallback((targetBill?: Bill | null) => {
    const b = targetBill || selectedBill;
    if (!b) return;

    const rawSalespersonName = (b.salespersonName || '').trim();
    const salespersonName = cleanSalespersonName(rawSalespersonName).trim() || rawSalespersonName;
    const msg = formatSalespersonWhatsAppMessage(b, rawSalespersonName, true);

    // Robust search using findSalespersonContact (handles exact, clean name without SMN suffix, id, etc.)
    const contact = findSalespersonContact(rawSalespersonName) || findSalespersonContact(salespersonName);

    const cleanDigits = (contact?.mobile || '').replace(/\D/g, '');
    if (cleanDigits.length >= 10) {
      const phone = cleanDigits.length === 10 ? `91${cleanDigits}` : cleanDigits;
      const encodedMsg = encodeURIComponent(msg);
      window.location.href = `whatsapp://send?phone=${phone}&text=${encodedMsg}`;
    } else {
      // Prompt modal to enter & save salesperson mobile number
      setSpModalSalespersonName(rawSalespersonName || salespersonName || 'Salesperson');
      setSpModalPhone(contact?.mobile || '');
      setSpPendingBill(b);
      setShowSalespersonPhoneModal(true);
    }
  }, [selectedBill, formatSalespersonWhatsAppMessage]);

  const handleSaveSalespersonPhoneAndSend = async () => {
    if (!spPendingBill) return;
    const cleanDigits = spModalPhone.replace(/\D/g, '');
    if (cleanDigits.length < 10) {
      alert('Kripya valid 10-digit mobile number enter karein.');
      return;
    }

    const rawName = spModalSalespersonName.trim();
    const cleanName = cleanSalespersonName(rawName).trim() || rawName;
    const rawLower = rawName.toLowerCase();
    const cleanLower = cleanName.toLowerCase();

    const contacts = [...getSalespersonContacts()];
    const idx = contacts.findIndex(c => {
      const cRaw = (c.name || '').trim().toLowerCase();
      const cClean = cleanSalespersonName(c.name || '').trim().toLowerCase();
      return cRaw === rawLower || (cleanLower && cClean === cleanLower);
    });

    const stableId = `sp_${cleanLower.replace(/[^a-z0-9]/g, '_').slice(0, 44)}`;

    if (idx >= 0) {
      contacts[idx] = { ...contacts[idx], id: contacts[idx].id || stableId, name: cleanName, mobile: cleanDigits };
    } else {
      contacts.push({ id: stableId, name: cleanName, mobile: cleanDigits });
    }
    await saveSalespersonContacts(contacts);
    setShowSalespersonPhoneModal(false);

    const phone = cleanDigits.length === 10 ? `91${cleanDigits}` : cleanDigits;
    const msg = formatSalespersonWhatsAppMessage(spPendingBill, cleanName || rawName, true);

    const encodedMsg = encodeURIComponent(msg);
    window.location.href = `whatsapp://send?phone=${phone}&text=${encodedMsg}`;
  };

  // Scroll highlighted dropdown item into view when navigating with arrow keys
  useEffect(() => {
    highlightedItemRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [dropdownIndex]);

  const onKeyDownBillSearch = (e: React.KeyboardEvent) => {
    if (e.key === '+' || e.code === 'NumpadAdd') {
      e.preventDefault();
      handleReset();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setShowDropdown(true);
      setDropdownIndex(prev => Math.min(prev + 1, filteredBillNos.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setShowDropdown(true);
      setDropdownIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredBillNos.length === 0) return;
      // Always select the currently highlighted item (index 0 by default)
      const safeIdx = Math.min(dropdownIndex, filteredBillNos.length - 1);
      handleBillSelect(filteredBillNos[safeIdx]);
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  };

  // Auto-clear special modes when the user enters any cash/upi/cheque amount
  // so the bill saves as Paid (Cash/UPI/Cheque) not the special mode.
  // Includes 'Unpaid' — if Unpaid button was pressed but user then types an amount,
  // the mode must reset so deriveMode picks up Cash/UPI/Cheque correctly.
  useEffect(() => {
    if ((paymentMode === 'Credit' || paymentMode === 'FBR' || paymentMode === 'Del Pending' || paymentMode === 'Unpaid') && totalCollected > 0) {
      setPaymentMode('');
    }
  }, [totalCollected, paymentMode]);

  const isDriverMode = getRole() === 'driver';
  // User role: can only enter payment on current date; cannot change date or edit rec date
  const isUserRole = getRole() === 'user';

  // Check if bill has payment received (cash/gpay/cheq/collected/paymentDate) or is in FBR or Credit
  const hasCashRec = (Number(selectedBill?.cashAmount) || 0) > 0;
  const hasUpiRec = (Number(selectedBill?.upiAmount) || 0) > 0;
  const hasChqRec = (Number(selectedBill?.chequeAmount) || 0) > 0;
  const hasColRec = (Number(selectedBill?.collectedAmount) || 0) > 0;
  const hasDateRec = !!selectedBill?.paymentDate && selectedBill.paymentDate.trim() !== '' && selectedBill.paymentDate !== '—';
  const isPaidMode = _selMode === 'paid' || _selMode === 'cash' || _selMode === 'upi' || _selMode === 'cheque' || _selMode === 'split';
  const isFbrBill = _selMode === 'fbr' || _selMode === 'cancel';
  const isCreditBill = _selMode === 'credit';

  // Any bill with payment rec (Cash, GPay, Cheque) or FBR or Credit must require unlock to edit!
  const isProtectedBill = !!selectedBill && (hasCashRec || hasUpiRec || hasChqRec || hasColRec || hasDateRec || isPaidMode || isFbrBill || isCreditBill);
  const isBillCurrentlyLocked = isProtectedBill && editLocked;

  const isSpecialStatus = _selMode === 'fbr' || _selMode === 'credit' || _selMode === 'del pending';

  const userPerms = getUserPerm(getLoggedInName());
  const canUserBackDate = isUserRole ? userPerms.canBackDate : true;
  // Paid/Protected-bill editing follows Admin > Users > Edit. Back Date remains date-only.
  const userCannotEditReceivedBill = isUserRole && isProtectedBill && !userPerms.canEdit;

  // Cheque valid: chequeNo required (>=3 digits); bank required for owner/user, optional for driver
  const chqAmt_num = Number(chqAmt);
  const chqValid = chqAmt_num <= 0 || (
    chequeNo.trim().length >= 3 &&
    (isDriverMode || !!bankName.trim())
  );

  // Cheque metadata-only update: editLocked bill or received bill with existing cheque details updated — allow saving
  // just chequeNo + chequeDate + bankName without touching amounts
  // Cheque metadata-only update: ONLY when no fresh amount is being entered.
  // If cash/upi/cheque amount is typed, this is a real payment entry — never a metadata-only edit.
  const isChqMetaOnlyEdit = !!(
    selectedBillNo && selectedDriver && !isDriverMode && totalCollected <= 0 &&
    (
      (chequeNo.trim() && chequeNo.trim() !== (selectedBill?.chequeNo || '').trim()) ||
      (chequeDate && chequeDate !== (selectedBill?.chequeDate || '')) ||
      (bankName.trim() && bankName.trim() !== (selectedBill?.bankName || '').trim())
    )
  );

  const isEditLockedChqMeta = !!(
    selectedBillNo && selectedDriver && !isDriverMode &&
    editLocked && isProtectedBill &&
    Number(chqAmt) > 0
  );

  const isMocCurrent = isMocBill(selectedBillNo, selectedBill);

  const canSave = !saving && (!isUserRole || userPerms.canEdit) && (
    (selectedBillNo && selectedDriver && chqValid &&
     (totalCollected > 0 || isMocCurrent || paymentMode === 'FBR' || paymentMode === 'Credit' || paymentMode === 'Del Pending' || paymentMode === 'Unpaid') &&
     (isMocCurrent || !isProtectedBill || !editLocked) &&
     !userCannotEditReceivedBill)
    || isChqMetaOnlyEdit
    || isEditLockedChqMeta
  );

  // ── Global Keyboard Shortcuts: 'Escape' (Close any modal / reset), '+' (Close Bill & Clear Search), 1/2/3 (FBR/Credit/Del Pending), Ctrl+E (Edit), Ctrl+S (Save) ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // ── Escape Key: Close ANY open window, modal, popup or clear bill/search ──
      if (e.key === 'Escape') {
        e.preventDefault();
        const hasOpenModal = showFbrReasonModal || showLineCutPopup || showDiffConfirm || 
          showRecDateConfirm || showMocModal || showDatePicker || showDatePwModal || showResetPwModal ||
          showMultiBillModal || showPaidPopup || showOverflowModal || !!pendingSelectBill || 
          !!saveError || showDropdown || showDraftRestored;

        setShowFbrReasonModal(false);
        setShowLineCutPopup(false);
        setLcAsOutstanding(false);
        setShowDiffConfirm(false);
        setShowRecDateConfirm(false);
        setShowMocModal(false);
        setShowDatePicker(false);
        setShowDatePwModal(false);
        setShowResetPwModal(false);
        setShowMultiBillModal(false);
        setShowPaidPopup(false);
        setShowOverflowModal(false);
        setOverflowPendingItems([]);
        setPendingSelectBill(null);
        setSaveError(null);
        setShowDropdown(false);
        setShowDraftRestored(false);

        // If no modal was open, reset form and refocus search
        if (!hasOpenModal) {
          handleReset();
          setTimeout(() => {
            billInputRef.current?.focus();
            billInputRef.current?.select();
          }, 30);
        }
        return;
      }

      // ── Key '+' or Numpad '+' : Close open bill without saving & clear search bar ──
      if (e.key === '+' || e.code === 'NumpadAdd') {
        e.preventDefault();
        setShowFbrReasonModal(false);
        setShowLineCutPopup(false);
        setLcAsOutstanding(false);
        setShowDiffConfirm(false);
        setShowRecDateConfirm(false);
        setShowMocModal(false);
        setShowDatePicker(false);
        setShowDatePwModal(false);
        setShowResetPwModal(false);
        setShowMultiBillModal(false);
        setShowPaidPopup(false);
        setShowOverflowModal(false);
        setOverflowPendingItems([]);
        setPendingSelectBill(null);
        setSaveError(null);
        setShowDropdown(false);
        setShowDraftRestored(false);
        handleReset();
        setTimeout(() => {
          billInputRef.current?.focus();
          billInputRef.current?.select();
        }, 30);
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase();
        if (key === 'e') {
          e.preventDefault();
          const canEditSelectedBill = !isUserRole || userPerms.canEdit;
          if (selectedBillNo && canEditSelectedBill && !userCannotEditReceivedBill) {
            setEditLocked(false);
            setTimeout(() => cashInputRef.current?.focus(), 50);
          }
        } else if (key === 's') {
          e.preventDefault();
          if (selectedBillNo) {
            handleSaveClick();
          }
        }
        return;
      }

      // ── Entry Shortcuts: 1 = FBR, 2 = Credit, 3 = Del Pending ──
      // Active when a bill is selected and no modal is blocking
      if (selectedBillNo && !showFbrReasonModal && !showLineCutPopup && !showDiffConfirm && !showRecDateConfirm && !showDatePicker && !showMocModal && !showMultiBillModal && !showOverflowModal && !showResetPwModal && !pendingSelectBill) {
        const target = e.target as HTMLElement | null;
        const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
        const isSearchInput = target === billInputRef.current;

        // If user presses Alt+1/2/3 anywhere, OR presses 1/2/3 when not typing inside an input
        const isAlt123 = e.altKey && (e.key === '1' || e.key === '2' || e.key === '3');
        const isDirect123 = !e.altKey && !e.ctrlKey && !e.metaKey && !isInput && (e.key === '1' || e.key === '2' || e.key === '3' || e.code === 'Numpad1' || e.code === 'Numpad2' || e.code === 'Numpad3');

        if ((isAlt123 || isDirect123) && !isSearchInput) {
          if (isBillCurrentlyLocked || userCannotEditReceivedBill) {
            return;
          }
          const num = isAlt123 ? e.key : (e.key === '1' || e.code === 'Numpad1' ? '1' : e.key === '2' || e.code === 'Numpad2' ? '2' : '3');
          if (num === '1') {
            e.preventDefault();
            clearReceivedAmounts();
            setShowFbrReasonModal(true);
            setPaymentMode('FBR');
          } else if (num === '2') {
            e.preventDefault();
            openCreditLineCutPopup();
          } else if (num === '3') {
            e.preventDefault();
            clearReceivedAmounts();
            setPaymentMode('Del Pending');
            setTimeout(() => saveBtnRef.current?.focus(), 30);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    selectedBillNo, canSave, displayDate, isUserRole, editLocked, isBillCurrentlyLocked, userCannotEditReceivedBill, selectedBill, recDateOverride,
    showFbrReasonModal, showLineCutPopup, showDiffConfirm, showRecDateConfirm, showDatePicker,
    showMocModal, showMultiBillModal, showDatePwModal, showResetPwModal, showPaidPopup, showOverflowModal,
    pendingSelectBill, saveError, showDropdown, showDraftRestored
  ]);

  if (loading) return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin text-primary" /></div>;

  return (
    <div className="min-h-screen bg-background pb-4 pt-10 px-0 w-full max-w-none">
      <TopNav />
      <div className="bg-primary px-3 py-1 rounded-b shadow-md sticky top-10 z-40 w-full">
        <div className="flex items-center justify-between gap-1.5 h-9 max-w-full">
          <div className="flex items-center gap-1 shrink-0">
            {(() => {
              const role = getRole();
              const canBackDate = !isDriverMode && (role === 'owner' || (isUserRole && getUserPerm(getLoggedInName()).canBackDate));
              if (canBackDate) {
                return (
                  <button
                    onClick={() => {
                      setPendingDate(dashDate);
                      setShowDatePicker(true);
                    }}
                    className="flex items-center gap-1 bg-white/15 px-2 py-1 rounded-lg border border-white/10 shrink-0 shadow-inner hover:bg-white/20 transition-colors cursor-pointer"
                    title="Change Date"
                  >
                    <Calendar className="w-3 h-3 text-primary-foreground/70" />
                    <span className="text-[10px] font-black text-primary-foreground">{displayDate}</span>
                  </button>
                );
              }
              return (
                <div className="flex items-center gap-1 bg-white/10 px-2 py-1 rounded-lg border border-white/10 shrink-0 shadow-inner opacity-80" title="Date Locked">
                  <Calendar className="w-3 h-3 text-primary-foreground/40" />
                  <span className="text-[10px] font-black text-primary-foreground">{displayDate}</span>
                </div>
              );
            })()}

            {/* Mandatory Driver Downloads Indicator (TPL & PDF RPT) */}
            <Link
              to="/driver"
              className="flex items-center gap-1.5 bg-black/25 hover:bg-black/35 border border-white/20 px-2 py-1 rounded-lg shrink-0 transition-all cursor-pointer shadow-inner"
              title={`Driver Downloads (${displayDate}):\n• TPL Assignment: ${downloadStatus.tplDownloaded ? '✓ DOWNLOADED (GREEN)' : '✗ NOT DOWNLOADED (RED)'}\n• PDF RPT: ${downloadStatus.rptDownloaded ? '✓ DOWNLOADED (GREEN)' : '✗ NOT DOWNLOADED (RED)'}\nClick to open Driver Center`}
            >
              {/* TPL Indicator */}
              <div className="flex items-center gap-1" title={downloadStatus.tplDownloaded ? `TPL: Downloaded` : `TPL: Download Pending`}>
                <span className="text-[8px] font-black text-primary-foreground/90 uppercase tracking-tight">TPL</span>
                <span
                  className={cn(
                    "w-2 h-2 rounded-full shrink-0 transition-all",
                    downloadStatus.tplDownloaded
                      ? "bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse ring-1 ring-emerald-300"
                      : "bg-red-500 shadow-[0_0_8px_#ef4444] animate-pulse ring-1 ring-red-400"
                  )}
                />
              </div>

              <span className="w-px h-3 bg-white/25 shrink-0" />

              {/* RPT Indicator */}
              <div className="flex items-center gap-1" title={downloadStatus.rptDownloaded ? `RPT: Downloaded` : `RPT: Download Pending`}>
                <span className="text-[8px] font-black text-primary-foreground/90 uppercase tracking-tight">RPT</span>
                <span
                  className={cn(
                    "w-2 h-2 rounded-full shrink-0 transition-all",
                    downloadStatus.rptDownloaded
                      ? "bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse ring-1 ring-emerald-300"
                      : "bg-red-500 shadow-[0_0_8px_#ef4444] animate-pulse ring-1 ring-red-400"
                  )}
                />
              </div>
            </Link>

            {/* Auto Credit WhatsApp Dispatch Toggle (ON / OFF) */}
            <button
              type="button"
              onClick={toggleAutoCreditWa}
              className={cn(
                "flex items-center gap-1 px-1.5 py-1 rounded-lg border shrink-0 transition-all cursor-pointer shadow-inner select-none",
                autoCreditWa
                  ? "bg-emerald-950/50 hover:bg-emerald-900/60 border-emerald-400/50 text-emerald-200 ring-1 ring-emerald-400/30"
                  : "bg-black/30 hover:bg-black/40 border-white/20 text-primary-foreground/70"
              )}
              title={`Credit Auto WhatsApp: ${autoCreditWa ? 'ON (Auto Send Enabled)' : 'OFF (Auto Send Disabled)'}\nClick to toggle automatic WhatsApp message when saving Credit bills`}
            >
              <MessageCircle className={cn("w-3 h-3 shrink-0", autoCreditWa ? "text-emerald-400" : "text-primary-foreground/50")} />
              <span className="text-[8px] font-black uppercase tracking-tight hidden sm:inline">CR WA</span>
              <span
                className={cn(
                  "text-[7.5px] font-black px-1 py-0.5 rounded leading-none transition-all",
                  autoCreditWa
                    ? "bg-emerald-500 text-white shadow-[0_0_6px_#34d399]"
                    : "bg-red-500/80 text-white"
                )}
              >
                {autoCreditWa ? 'ON' : 'OFF'}
              </span>
            </button>
          </div>

          {driverStats && (
            <div className="flex gap-2.5 font-black items-center py-0 flex-1 justify-center scale-90">
              <div className="flex flex-col items-center">
                <span className="text-lg text-primary-foreground leading-none">{driverStats.total}</span>
                <span className="text-[7px] text-primary-foreground/50 uppercase tracking-tighter">{driverStats.isStaff ? 'TOTAL' : 'LOAD'}</span>
              </div>
              <div className="flex flex-col items-center">
                <span className="text-lg text-emerald-300 leading-none">{driverStats.paid}</span>
                <span className="text-[7px] text-primary-foreground/50 uppercase tracking-tighter">DONE</span>
              </div>
              <div className="flex flex-col items-center">
                <span className={cn("text-lg leading-none", driverStats.pending === 0 ? "text-emerald-300" : "text-amber-300")}>{driverStats.pending}</span>
                <span className="text-[7px] text-primary-foreground/50 uppercase tracking-tighter">{driverStats.isStaff ? 'PAND' : 'PEND'}</span>
              </div>
            </div>
          )}

          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
            {/* ── Simple Total Rec Cash Display next to Driver Selection ── */}
            <div className="flex items-center bg-emerald-500/20 text-emerald-100 border border-emerald-400/40 px-2 py-1 rounded-lg shrink-0 select-none">
              <span className="text-[10px] sm:text-[11px] font-black tracking-tight leading-none">
                ₹{selectedDriverCashStats.amount.toLocaleString('en-IN')}
              </span>
            </div>

            <select
              value={selectedDriver}
              onChange={e => handleDriverChange(e.target.value)}
              className="bg-white/15 px-2 py-1 rounded-lg text-[10px] font-black text-primary-foreground border border-white/10 uppercase focus:outline-none min-w-[95px] sm:min-w-[100px] shrink-0 shadow-inner cursor-pointer"
            >
              <option value="" className="text-slate-900 bg-white font-medium">SELECT DRIVER</option>
              {getRole() === 'owner' && <option value="OWNER" className="text-slate-900 bg-white font-black">👑 OWNER</option>}
              {(() => {
                const curRole = getRole();
                const seenNames = new Set<string>();
                return drivers
                  .filter(d => isDriverMode ? (!d.role || d.role === 'driver') : true)
                  .filter(d => {
                    const dRole = d.role || (d.id?.startsWith('own_') ? 'owner' : d.id?.startsWith('usr_') ? 'user' : 'driver');
                    if (curRole === 'user' && dRole === 'owner') return false;
                    return true;
                  })
                  .filter(d => {
                    const key = (d.name || '').trim().toUpperCase();
                    if (!key || seenNames.has(key)) return false;
                    const dRole = d.role || (d.id?.startsWith('own_') ? 'owner' : d.id?.startsWith('usr_') ? 'user' : 'driver');

                    // OWNER & USER role staff (e.g. Khushi, Tarachand, Pratixa, etc.) are COMPULSORY shown in dropdown
                    if (dRole === 'user' || dRole === 'owner') {
                      seenNames.add(key);
                      return true;
                    }

                    // Regular DRIVERS: ONLY show if assigned delivery on the selected date (or currently selected)
                    const isAssigned = assignedDriverNames.has(key) || (selectedDriver && selectedDriver.trim().toUpperCase() === key);
                    if (isAssigned) {
                      seenNames.add(key);
                      return true;
                    }
                    return false;
                  })
                  .map(d => {
                    const dRole = d.role || (d.id?.startsWith('own_') ? 'owner' : d.id?.startsWith('usr_') ? 'user' : 'driver');
                    const prefix = !isDriverMode && dRole === 'owner' ? '👑 ' : !isDriverMode && dRole === 'user' ? '👤 ' : '';
                    return <option key={d.id} value={d.name} className="text-slate-900 bg-white font-medium">{prefix}{d.name}</option>;
                  });
              })()}
            </select>
          </div>
        </div>
      </div>

      <div className="w-full px-0 mt-0.5 space-y-0.5 max-w-none mx-auto">
        <div className="bg-card p-2 shadow-sm border-b border-border">
          <div className="relative w-full px-2 flex items-center gap-1.5 h-10">
            <div className="relative flex-1">
              <div className="relative flex items-center w-full">
                <input
                  ref={billInputRef}
                  type="text"
                  inputMode="numeric"
                  placeholder={selectedDriver ? "ENTER BILL NO OR PARTY NAME..." : "ENTER BILL NO OR PARTY NAME..."}
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setShowDropdown(true); setDropdownIndex(0); if (!e.target.value) { setSelectedBillNo(''); setDebouncedQuery(''); } }}
                  onFocus={() => setShowDropdown(true)}
                  onKeyDown={onKeyDownBillSearch}
                  className="w-full h-9 pl-4 pr-36 bg-muted/50 rounded-2xl border-2 border-primary/30 text-[19px] sm:text-[20px] font-black tracking-wide uppercase focus:outline-none focus:ring-4 focus:ring-primary/20 shadow-md"
                />
                <button
                  type="button"
                  onClick={() => setShowMocModal(true)}
                  title="Commission MOC Month select karein"
                  className="absolute right-24 px-2 py-1.5 rounded-xl transition-all font-black text-[10px] shrink-0 z-10 bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm flex items-center gap-0.5 uppercase"
                >
                  <span>MOC</span>
                </button>
                <button
                  type="button"
                  onClick={() => setWakeMode(v => !v)}
                  title='"HEY HUL" bolkar voice entry chalu karein'
                  className={cn(
                    "absolute right-12 px-2 py-1.5 rounded-xl transition-all font-black text-[10px] shrink-0 z-10",
                    wakeMode
                      ? "bg-emerald-600 text-white animate-pulse ring-2 ring-emerald-300"
                      : "bg-muted text-muted-foreground hover:bg-muted/70"
                  )}
                >
                  HEY HUL
                </button>
                <button
                  type="button"
                  onClick={toggleVoiceSearch}
                  title={isListening ? "Listening... Click to stop" : "Voice Search (Bolein Bill No)"}
                  className={cn(
                    "absolute right-2 p-2 rounded-xl transition-all flex items-center justify-center gap-1 font-black text-xs shrink-0 z-10",
                    isListening
                      ? "bg-red-600 text-white animate-pulse ring-4 ring-red-300 shadow-md"
                      : "bg-primary/10 text-primary hover:bg-primary/20"
                  )}
                >
                  {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                </button>

              </div>

              {voiceFeedback && (
                <div className="mt-1 flex items-center gap-1.5 text-xs font-black text-primary bg-primary/10 px-3 py-1.5 rounded-xl border border-primary/20 shadow-xs animate-fadeIn">
                  <Volume2 className="w-4 h-4 animate-bounce shrink-0 text-primary" />
                  <span className="truncate">{voiceFeedback}</span>
                  <button type="button" onClick={() => setVoiceFeedback(null)} className="ml-auto p-0.5 text-muted-foreground hover:text-foreground">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {showDropdown && searchQuery && filteredBillNos.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-2xl shadow-2xl max-h-72 overflow-auto z-50 no-scrollbar ring-4 ring-primary/5">
                {filteredBillNos.map((bn, idx) => {
                  const b = billMap.get(bn);
                  const isHighlighted = dropdownIndex === idx;

                  // ── Dedicated MOC Commission Row ──
                  if (!b && ((bn || '').toUpperCase().startsWith('MOC') || commissionMocs.some(m => (m?.code || '').toUpperCase() === (bn || '').toUpperCase()))) {
                    const mocNum = extractMocNumber(bn) || '1';
                    const nextSrPreview = getNextMocSrNo(mocNum, getBills());
                    return (
                      <button
                        key={bn}
                        ref={isHighlighted ? highlightedItemRef : null}
                        onClick={() => handleBillSelect(bn)}
                        className={cn(
                          "w-full text-left p-2.5 border-b border-border/30 last:border-0 transition-colors flex items-center justify-between gap-2.5",
                          isHighlighted ? "bg-emerald-600 text-white" : "bg-emerald-50/50 hover:bg-emerald-100"
                        )}
                      >
                        <div className="flex-1 min-w-0 flex flex-col gap-1">
                          <div className="flex items-center gap-2 flex-wrap leading-tight text-[12px] font-bold">
                            <span className={cn("text-[13px] font-black uppercase tracking-wide shrink-0", isHighlighted ? "text-white" : "text-emerald-800")}>
                              ⭐ {bn}
                            </span>
                            <span className={cn("text-[12px] font-bold uppercase px-2 py-0.5 rounded-md border shrink-0", isHighlighted ? "bg-white/20 text-white border-white/30" : "bg-emerald-100 text-emerald-950 border-emerald-300")}>
                              COMMISSION (MOC {mocNum})
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-[12px] font-bold">
                            <span className={cn("text-[11px] font-bold", isHighlighted ? "text-emerald-100" : "text-emerald-700")}>
                              Create new serial entry: <strong className="underline">MOC{mocNum}-SR{nextSrPreview}</strong>
                            </span>
                          </div>
                        </div>
                        <div className="shrink-0 flex items-center justify-center self-stretch my-auto">
                          <span className={cn(
                            "text-[12px] font-black uppercase px-2.5 py-1.5 rounded-xl shadow-xs text-center flex items-center justify-center min-h-[36px] tracking-wide",
                            isHighlighted ? "bg-white text-emerald-900 font-black" : "bg-emerald-600 text-white font-black"
                          )}>
                            NEW MOC
                          </span>
                        </div>
                      </button>
                    );
                  }

                  const isFBR = b?.paymentMode === 'FBR' || b?.paymentMode === 'Cancel';
                  const isCredit = b?.paymentMode === 'Credit';
                  const isDelPend = b?.paymentMode === 'Del Pending';
                  const _ddLC = (b?.lineCutAmt || 0) || Number(b?.cancelLine) || 0;
                  const _ddNet = (b?.billNetAmt || 0) - _ddLC;
                  const _ddColl = b?.collectedAmount || 0;
                  const _ddFull = _ddColl > 0 && (_ddNet - _ddColl) <= 1;
                  const _ddIsUnpaid = !b?.deliveryDate && _ddColl === 0;
                  const statusLabel = isFBR ? 'FBR' : isCredit ? 'CREDIT' : isDelPend ? 'DEL PEND' : _ddFull ? 'PAID' : b?.paymentMode === 'Pending' ? 'PENDING' : _ddIsUnpaid ? 'UNPAID' : '';
                  const statusCls = isFBR ? 'bg-red-500 text-white' : isCredit ? 'bg-green-500 text-white' : isDelPend ? 'bg-yellow-400 text-black' : _ddFull ? 'bg-emerald-500 text-white' : statusLabel === 'PENDING' ? 'bg-amber-400 text-black' : 'bg-muted text-muted-foreground';
                  const rowBg = isHighlighted ? "bg-primary text-primary-foreground" : isFBR ? "bg-red-50 hover:bg-red-100" : isCredit ? "bg-green-50 hover:bg-green-100" : isDelPend ? "bg-yellow-50 hover:bg-yellow-100" : "hover:bg-primary/5";
                  const modeDisplay = b?.cashAmount && b.cashAmount > 0 && b?.upiAmount && b.upiAmount > 0 ? 'SPLIT'
                    : b?.cashAmount && b.cashAmount > 0 ? 'CASH'
                    : b?.upiAmount && b.upiAmount > 0 ? 'GPAY'
                    : b?.chequeAmount && b.chequeAmount > 0 ? 'CHEQ'
                    : (b?.paymentMode && b.paymentMode !== 'Del Pending' && b.paymentMode !== 'FBR' && b.paymentMode !== 'Credit') ? (b.paymentMode === 'UPI' ? 'GPAY' : b.paymentMode) : (b?.paymentMode ? b.paymentMode : '');
                  const _ddLineCut = (b?.lineCutAmt || 0) || Number(b?.cancelLine) || 0;
                  const disObj = calculateBillDiscountPercent(b);
                  return (
                    <button key={bn} ref={isHighlighted ? highlightedItemRef : null} onClick={() => handleBillSelect(bn)} className={cn("w-full text-left p-2.5 border-b border-border/30 last:border-0 transition-colors flex items-center justify-between gap-2.5", rowBg)}>
                      {/* Left Side: Row 1 & Row 2 */}
                      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                        {/* 1st ROW: BILL NO, PARTY NAME, DRIVER NAME, DEL DATE (FONT BOLD 12PX) */}
                        <div className="flex items-center gap-2 flex-wrap leading-tight text-[12px] font-bold">
                          <span className={cn("text-[12px] font-black uppercase tracking-wide shrink-0", isHighlighted ? "text-primary-foreground" : "text-primary")}>{bn}</span>
                          {b?.partyName && (
                            <span className={cn(
                              "text-[12px] font-bold uppercase transition-all truncate max-w-[180px] sm:max-w-[280px]",
                              isGreenParty(b.partyCode, b.partyName)
                                ? "bg-emerald-300 text-emerald-950 dark:bg-emerald-800 dark:text-emerald-100 px-1.5 py-0.5 rounded border border-emerald-500 font-extrabold shadow-xs"
                                : (isHighlighted ? "text-primary-foreground/90" : "text-foreground")
                            )}>
                              {b.partyName}
                            </span>
                          )}
                          {b?.driverName && (
                            <span className={cn("text-[12px] font-bold uppercase px-1.5 py-0.5 rounded-md shrink-0", isHighlighted ? "bg-white/20 text-white" : "bg-amber-100 text-amber-950 border border-amber-300")}>
                              🚗 {b.driverName}
                            </span>
                          )}
                          {b?.deliveryDate && (
                            <span className={cn("text-[12px] font-bold px-1.5 py-0.5 rounded-md shrink-0", isHighlighted ? "bg-white/20 text-white" : "bg-slate-100 text-slate-900 border border-slate-300")}>
                              📅 DEL: {b.deliveryDate}
                            </span>
                          )}
                        </div>

                        {/* 2nd ROW: REC DATE, BILL AMT, REC AMT, LINE CUT AMT (FONT 14PX BOLD) */}
                        <div className="flex items-center gap-2 flex-wrap leading-tight text-[14px] font-bold">
                          {b?.paymentDate && (
                            <span className={cn("text-[14px] font-black shrink-0", isHighlighted ? "text-primary-foreground/90" : "text-purple-700 dark:text-purple-300")}>
                              📅 REC: {b.paymentDate}
                            </span>
                          )}
                          <span className={cn("text-[14px] font-black shrink-0", isHighlighted ? "text-primary-foreground" : "text-primary")}>
                            BILL: ₹{(b?.billNetAmt||0).toLocaleString('en-IN')}
                          </span>
                          <span className={cn("text-[14px] font-black shrink-0", isHighlighted ? "text-emerald-200" : "text-emerald-700 dark:text-emerald-400")}>
                            REC: ₹{_ddColl.toLocaleString('en-IN')}
                          </span>
                          {_ddLineCut > 0 && (
                            <span className={cn("text-[14px] font-black shrink-0", isHighlighted ? "text-red-200" : "text-red-600 dark:text-red-400")}>
                              LINE CUT: ₹{_ddLineCut.toLocaleString('en-IN')}
                            </span>
                          )}
                          {modeDisplay && (
                            <span className={cn(
                              "text-[12px] font-bold uppercase px-1.5 py-0.5 rounded-md border shrink-0",
                              isHighlighted
                                ? "bg-white/20 text-white border-white/30"
                                : modeDisplay === 'GPAY' || modeDisplay === 'UPI' ? "bg-blue-100 text-blue-950 border-blue-300"
                                : modeDisplay === 'CASH' ? "bg-emerald-100 text-emerald-950 border-emerald-300"
                                : modeDisplay === 'CHEQ' || modeDisplay === 'CHEQUE' ? "bg-purple-100 text-purple-950 border-purple-300"
                                : "bg-muted text-muted-foreground border-border"
                            )}>
                              💳 {modeDisplay}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Right Side: DIS% + Big BILL STATUS badge fitting both rows */}
                      <div className="shrink-0 flex items-center justify-center self-stretch my-auto gap-2">
                        <span className={cn(
                          "text-[14px] font-bold px-2 py-1 rounded-xl border shrink-0 whitespace-nowrap shadow-xs",
                          isHighlighted
                            ? "bg-white/20 text-white border-white/30"
                            : "bg-amber-100 text-amber-950 border-amber-300 dark:bg-amber-950/70 dark:text-amber-200 dark:border-amber-700"
                        )}>
                          {disObj.disText}
                        </span>
                        <span className={cn(
                          "text-[13px] sm:text-[14px] font-black uppercase px-3 py-2 rounded-xl shadow-xs text-center flex items-center justify-center min-h-[44px] min-w-[70px] tracking-wider leading-none",
                          isHighlighted ? (statusLabel==='UNPAID'?'bg-white/20 text-primary-foreground':statusCls) : statusCls
                        )}>
                          {statusLabel || 'UNPAID'}
                        </span>
                      </div>
                    </button>
                  );
                })}

              </div>
            )}
            {billNotFound && showDropdown && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-card border-2 border-destructive/30 rounded-2xl shadow-2xl z-50 px-4 py-3 text-center">
                <p className="text-[11px] font-black text-destructive uppercase tracking-widest">⚠ BILL NOT FOUND</p>
                <p className="text-[9px] font-bold text-muted-foreground mt-0.5 uppercase">{selectedDriver ? "Not assigned to this driver / date" : "No matching bill in ledger"}</p>
              </div>
            )}
            </div>
            {/* Multi Bill Entry Button */}
            <button
              onClick={() => setShowMultiBillModal(true)}
              title="Multi Bill Entry"
              className="shrink-0 h-9 px-2.5 flex items-center gap-1 bg-primary/10 hover:bg-primary/20 text-primary rounded-xl border border-primary/20 transition-colors shadow-sm"
            >
              <ListPlus className="w-4 h-4" />
              <span className="text-[9px] font-black uppercase tracking-widest">Multi</span>
            </button>
          </div>
        </div>


        {selectedBill && (() => {
          const _m2 = (selectedBill.paymentMode || '').toLowerCase();
          const isMoc2 = isMocBill(selectedBill.billNo, selectedBill);
          // Live form state overrides saved status for the badge preview
          const _liveMode = paymentMode; // e.g. 'FBR', 'Credit', 'Del Pending', or ''
          const _liveTotal = totalCollected; // cash+upi+cheque typed so far
          // When amounts are typed, saved FBR/Unpaid status must NOT show — bill is being collected now.
          const isFBR2    = _liveMode === 'FBR'         || (_liveMode === '' && _liveTotal === 0 && (_m2 === 'fbr' || _m2 === 'cancel'));
          const isCredit2 = _liveMode === 'Credit'      || (_liveMode === '' && _liveTotal === 0 && _m2 === 'credit');
          const isDelPend2= _liveMode === 'Del Pending' || (_liveMode === '' && _m2 === 'del pending');
          const isUnpaid2 = _liveMode === 'Unpaid'      || (_liveMode === '' && _liveTotal === 0 && (_m2 === 'unpaid' || _m2 === 'pending'));
          // Paid = explicit Paid/legacy mode, OR has paymentDate + collected (data consistency guard)
          const isPaidMode2 = isMoc2 || (!_liveMode && (_m2 === 'paid' || _m2 === 'cash' || _m2 === 'upi' || _m2 === 'cheque' || _m2 === 'split'))
            || (!isFBR2 && !isCredit2 && !isDelPend2 && !isUnpaid2 && !!selectedBill.paymentDate && (selectedBill.collectedAmount || 0) > 0)
            || (!isFBR2 && !isCredit2 && !isDelPend2 && !isUnpaid2 && _liveTotal > 0);
          const savedLineCut2 = (selectedBill.lineCutAmt || 0) || Number(selectedBill.cancelLine) || 0;
          const lineCut2 = isMoc2 ? 0 : ((!isFBR2 && !isCredit2 && !isDelPend2 && !isUnpaid2)
            ? (_liveTotal > 0
                ? Math.max(0, selectedBill.billNetAmt - _liveTotal)
                : ((selectedBill.collectedAmount || 0) >= selectedBill.billNetAmt
                    ? 0
                    : ((selectedBill.collectedAmount || 0) > 0
                        ? Math.max(0, Math.min(savedLineCut2, selectedBill.billNetAmt - (selectedBill.collectedAmount || 0)))
                        : savedLineCut2)))
            : (isFBR2 ? selectedBill.billNetAmt : savedLineCut2));
          const net2 = isMoc2 ? (selectedBill.billNetAmt || _liveTotal || 0) : (selectedBill.billNetAmt - lineCut2);
          const collected2 = _liveTotal > 0 ? _liveTotal : (selectedBill.collectedAmount || 0);
          const isFullyPaid2 = isMoc2 || (isPaidMode2 && collected2 > 0 && Math.abs(net2 - collected2) <= 1);
          // Status label: FBR > DEL PEND > CREDIT > PAID (with amount) > UNPAID
          const statusLabel2 = isFBR2     ? 'FBR'
            : isDelPend2 ? 'DEL PEND'
            : isCredit2  ? 'CREDIT'
            : isUnpaid2  ? 'UNPAID'
            : isPaidMode2 ? (collected2 > 0 ? `PAID ₹${collected2.toLocaleString('en-IN')}` : 'PAID')
            : 'UNPAID';
          const statusCls2 = isFBR2     ? 'bg-red-500 text-white'
            : isDelPend2 ? 'bg-amber-400 text-black'
            : isCredit2  ? 'bg-green-600 text-white'
            : isUnpaid2  ? 'bg-muted text-muted-foreground'
            : isPaidMode2 ? 'bg-emerald-500 text-white'
            : 'bg-muted text-muted-foreground';
          const modeDisplay = selectedBill.cashAmount && selectedBill.cashAmount > 0 && selectedBill.upiAmount && selectedBill.upiAmount > 0 ? 'SPLIT'
            : selectedBill.cashAmount && selectedBill.cashAmount > 0 ? 'CASH'
            : selectedBill.upiAmount && selectedBill.upiAmount > 0 ? 'UPI'
            : selectedBill.chequeAmount && selectedBill.chequeAmount > 0 ? 'CHQ'
            : selectedBill.paymentMode || '';
          const disObj2 = calculateBillDiscountPercent(selectedBill);
          return (
            <div className="px-2 mt-3 space-y-3 animate-in slide-in-from-top-2 duration-200">
              {/* ── Bill Info Card ── */}
              <div className="bg-card border border-border rounded-2xl p-3 sm:p-4 shadow-sm space-y-2.5">

                {/* ── Row 1: Bill No + Party Name + Status Badge ── */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-2">
                  <div className="flex items-center gap-3 flex-wrap min-w-0">
                    <span className="text-[22px] sm:text-[25px] font-black text-primary uppercase tracking-wider">{selectedBill.billNo}</span>
                    <span className="text-[17px] sm:text-[19px] font-black text-foreground uppercase">{selectedBill.partyName}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[14px] font-bold text-amber-950 dark:text-amber-200 bg-amber-100 dark:bg-amber-950/70 border border-amber-300 dark:border-amber-700 px-2.5 py-1 rounded-xl shadow-xs shrink-0 whitespace-nowrap">
                      {disObj2.disText}
                    </span>
                    <span className={cn("text-[13px] sm:text-[14px] font-black px-3.5 py-1 rounded-full uppercase shrink-0 shadow-xs", statusCls2)}>{statusLabel2}</span>
                  </div>
                </div>

                {/* ── Row 2: DRIVER NAME · SALSMAN NAME · REC AMOUNT · PAYMENT MODE (Clean Badges with Option Values Only) ── */}
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  {/* DRIVER NAME */}
                  {selectedBill.driverName && (
                    <div className="flex items-center bg-amber-100 dark:bg-amber-950/70 border border-amber-300 dark:border-amber-700 text-amber-950 dark:text-amber-200 px-3 py-1.5 rounded-xl shadow-xs">
                      <span className="text-[15px] sm:text-[16px] font-black uppercase">{selectedBill.driverName}</span>
                    </div>
                  )}

                  {/* SALESMAN NAME */}
                  {selectedBill.salespersonName && (
                    <div className="flex items-center bg-lime-200/90 dark:bg-lime-950/70 border border-lime-400 dark:border-lime-700 text-lime-950 dark:text-lime-200 px-3 py-1.5 rounded-xl shadow-xs">
                      <span className="text-[15px] sm:text-[16px] font-black uppercase">{selectedBill.salespersonName}</span>
                    </div>
                  )}

                  {/* REC AMOUNT */}
                  {collected2 > 0 && (
                    <div className="flex items-center bg-emerald-100 dark:bg-emerald-950/70 border border-emerald-300 dark:border-emerald-700 text-emerald-950 dark:text-emerald-200 px-3 py-1.5 rounded-xl shadow-xs">
                      <span className="text-[15px] sm:text-[16px] font-black">₹{collected2.toLocaleString('en-IN')}</span>
                    </div>
                  )}

                  {/* PAYMENT MODE */}
                  {(modeDisplay || isPaidMode2 || isFBR2 || isCredit2 || isDelPend2) && (
                    <div className="flex items-center bg-blue-100 dark:bg-blue-950/70 border border-blue-300 dark:border-blue-700 text-blue-950 dark:text-blue-200 px-3 py-1.5 rounded-xl shadow-xs">
                      <span className="text-[15px] sm:text-[16px] font-black uppercase">
                        {modeDisplay || (isPaidMode2 ? 'PAID' : isFBR2 ? 'FBR' : isCredit2 ? 'CREDIT' : isDelPend2 ? 'DEL PEND' : 'UNPAID')}
                      </span>
                    </div>
                  )}

                  {/* BILL DATE (if present) */}
                  {(selectedBill.date || selectedBill.deliveryDate) && (
                    <div className="flex items-center bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 px-2.5 py-1.5 rounded-xl shadow-xs">
                      <span className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 mr-1">BILL:</span>
                      <span className="text-[14px] font-bold">{selectedBill.date || selectedBill.deliveryDate}</span>
                    </div>
                  )}

                  {/* REC DATE (Editable Date Picker) — Displays Supabase saved date, defaults to current date */}
                  <div className="flex items-center gap-1.5 bg-purple-100 dark:bg-purple-950/70 border border-purple-300 dark:border-purple-700 text-purple-950 dark:text-purple-200 px-2.5 py-1 rounded-xl shadow-xs">
                    <span className="text-[10px] font-black uppercase text-purple-800 dark:text-purple-300">REC:</span>
                    <input
                      type="date"
                      value={recDateInput || (selectedBill.paymentDate ? displayToIso(selectedBill.paymentDate) : dashDate)}
                      onChange={e => {
                        const iso = e.target.value;
                        setRecDateInput(iso);
                        const disp = isoToDisplay(iso);
                        setRecDateOverride(disp);
                      }}
                      className="bg-transparent text-[14px] font-bold outline-none cursor-pointer uppercase text-purple-950 dark:text-purple-100"
                    />
                  </div>

                  {/* WHATSAPP TO SALESPERSON BUTTON */}
                  <button
                    type="button"
                    id="whatsapp-salesperson-btn"
                    onClick={() => handleSendWhatsAppToSalesperson(selectedBill)}
                    title={`Send WhatsApp pending bill reminder to ${selectedBill.salespersonName || 'Salesperson'}`}
                    className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white px-3 py-1.5 rounded-xl shadow-xs font-bold text-[13px] transition-all cursor-pointer shrink-0"
                  >
                    <MessageCircle className="w-4 h-4 fill-white/20 text-white" />
                    <span className="text-[12px] font-black tracking-wide uppercase">WhatsApp</span>
                  </button>

                  {/* CHEQUE NO (if present) */}
                  {selectedBill.chequeNo && (
                    <div className="flex items-center bg-pink-100 dark:bg-pink-950/70 border border-pink-300 dark:border-pink-700 text-pink-950 dark:text-pink-200 px-2.5 py-1.5 rounded-xl shadow-xs">
                      <span className="text-[14px] font-bold">{selectedBill.chequeNo}</span>
                    </div>
                  )}
                </div>

                {/* ── Row 3: Financial Summary (Bill Amt | Line Cut | O/S | Paid) ── */}
                <div className="flex items-stretch gap-0 rounded-xl overflow-hidden border border-border mt-2">
                  <div className="flex-1 flex flex-col items-center justify-center py-2 px-1 bg-primary/5">
                    <span className="text-[9px] font-black text-primary/70 uppercase tracking-wide leading-none mb-0.5">Bill Amt</span>
                    <span className="text-[16px] sm:text-[17px] font-black text-primary leading-none">
                      ₹{(isMoc2 ? (collected2 > 0 ? collected2 : (_liveTotal > 0 ? _liveTotal : (selectedBill.billNetAmt || 0))) : (selectedBill.billNetAmt || 0)).toLocaleString('en-IN')}
                    </span>
                  </div>
                  <div className="w-px bg-border" />
                  <div className="flex-1 flex flex-col items-center justify-center py-2 px-1 bg-red-50 dark:bg-red-950/30">
                    <span className="text-[9px] font-black text-red-500 uppercase tracking-wide leading-none mb-0.5">Line Cut</span>
                    <span className="text-[16px] sm:text-[17px] font-black text-red-600 leading-none">₹{lineCut2.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="w-px bg-border" />
                  <div className="flex-1 flex flex-col items-center justify-center py-2 px-1 bg-orange-50 dark:bg-orange-950/30">
                    <span className="text-[9px] font-black text-orange-500 uppercase tracking-wide leading-none mb-0.5">O/S Amt</span>
                    <span className="text-[16px] sm:text-[17px] font-black text-orange-600 leading-none">₹{(isMoc2 ? 0 : Math.max(0, net2 - collected2)).toLocaleString('en-IN')}</span>
                  </div>
                  <div className="w-px bg-border" />
                  <div className="flex-1 flex flex-col items-center justify-center py-2 px-1 bg-emerald-50 dark:bg-emerald-950/30">
                    <span className="text-[9px] font-black text-emerald-600 uppercase tracking-wide leading-none mb-0.5">Paid</span>
                    <span className="text-[16px] sm:text-[17px] font-black text-emerald-700 leading-none">₹{collected2.toLocaleString('en-IN')}</span>
                  </div>
                </div>
              </div>

              {/* ── Entry Form ── */}
              <div className="bg-card border border-border rounded-2xl px-4 pt-3 pb-4 shadow-sm space-y-3">

                <div className="grid grid-cols-3 gap-2">
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-emerald-600"><Wallet className="w-3.5 h-3.5" /></div>
                    <input
                      ref={cashInputRef}
                      type="number" inputMode="numeric" placeholder="CASH"
                      disabled={isBillCurrentlyLocked || userCannotEditReceivedBill}
                      value={cashAmt} onChange={e => setCashAmt(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === '+' || e.code === 'NumpadAdd') { e.preventDefault(); handleReset(); }
                        else if (e.altKey && e.key === '1') { e.preventDefault(); if (isBillCurrentlyLocked || userCannotEditReceivedBill) return; clearReceivedAmounts(); setShowFbrReasonModal(true); setPaymentMode('FBR'); }
                        else if (e.altKey && e.key === '2') { e.preventDefault(); if (isBillCurrentlyLocked || userCannotEditReceivedBill) return; openCreditLineCutPopup(); }
                        else if (e.altKey && e.key === '3') { e.preventDefault(); if (isBillCurrentlyLocked || userCannotEditReceivedBill) return; clearReceivedAmounts(); setPaymentMode('Del Pending'); setTimeout(() => saveBtnRef.current?.focus(), 30); }
                        else if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); upiInputRef.current?.focus(); upiInputRef.current?.select(); }
                        else if (e.key === 'ArrowUp') { e.preventDefault(); billInputRef.current?.focus(); billInputRef.current?.select(); }
                        else if (e.key === 'Escape') { e.preventDefault(); handleReset(); }
                      }}
                      className="w-full h-10 pl-8 pr-2 bg-muted/50 rounded-xl text-[13px] font-black focus:ring-2 focus:ring-emerald-500/30 uppercase outline-none disabled:opacity-50 border border-border/30"
                      style={{ fontSize: '18px', fontFamily: 'Verdana' }}
                    />
                  </div>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-blue-600"><Smartphone className="w-3.5 h-3.5" /></div>
                    <input
                      ref={upiInputRef}
                      type="number" inputMode="numeric" placeholder="GPAY"
                      disabled={isBillCurrentlyLocked || userCannotEditReceivedBill}
                      value={upiAmt} onChange={e => setUpiAmt(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === '+' || e.code === 'NumpadAdd') { e.preventDefault(); handleReset(); }
                        else if (e.altKey && e.key === '1') { e.preventDefault(); if (isBillCurrentlyLocked || userCannotEditReceivedBill) return; clearReceivedAmounts(); setShowFbrReasonModal(true); setPaymentMode('FBR'); }
                        else if (e.altKey && e.key === '2') { e.preventDefault(); if (isBillCurrentlyLocked || userCannotEditReceivedBill) return; openCreditLineCutPopup(); }
                        else if (e.altKey && e.key === '3') { e.preventDefault(); if (isBillCurrentlyLocked || userCannotEditReceivedBill) return; clearReceivedAmounts(); setPaymentMode('Del Pending'); setTimeout(() => saveBtnRef.current?.focus(), 30); }
                        else if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); chqInputRef.current?.focus(); chqInputRef.current?.select(); }
                        else if (e.key === 'ArrowUp') { e.preventDefault(); cashInputRef.current?.focus(); cashInputRef.current?.select(); }
                        else if (e.key === 'Escape') { e.preventDefault(); handleReset(); }
                      }}
                      className="w-full h-10 pl-8 pr-2 bg-muted/50 rounded-xl text-[13px] font-black focus:ring-2 focus:ring-blue-500/30 uppercase outline-none disabled:opacity-50 border border-border/30"
                      style={{ fontSize: '16px', fontFamily: 'Times New Roman' }}
                    />
                  </div>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-violet-600"><Landmark className="w-3.5 h-3.5" /></div>
                    <input
                      ref={chqInputRef}
                      type="number" inputMode="numeric" placeholder="CHQ"
                      disabled={isBillCurrentlyLocked || userCannotEditReceivedBill}
                      value={chqAmt} onChange={e => setChqAmt(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === '+' || e.code === 'NumpadAdd') { e.preventDefault(); handleReset(); }
                        else if (e.altKey && e.key === '1') { e.preventDefault(); if (isBillCurrentlyLocked || userCannotEditReceivedBill) return; clearReceivedAmounts(); setShowFbrReasonModal(true); setPaymentMode('FBR'); }
                        else if (e.altKey && e.key === '2') { e.preventDefault(); if (isBillCurrentlyLocked || userCannotEditReceivedBill) return; openCreditLineCutPopup(); }
                        else if (e.altKey && e.key === '3') { e.preventDefault(); if (isBillCurrentlyLocked || userCannotEditReceivedBill) return; clearReceivedAmounts(); setPaymentMode('Del Pending'); setTimeout(() => saveBtnRef.current?.focus(), 30); }
                        else if (e.key === 'Enter' || e.key === 'ArrowDown') {
                          e.preventDefault();
                          if (Number(chqAmt) > 0) { setTimeout(() => chequeNoRef.current?.focus(), 30); }
                          else if (totalCollected === 0) { setTimeout(() => fbrBtnRef.current?.focus(), 30); }
                          else { setTimeout(() => saveBtnRef.current?.focus(), 30); }
                        }
                        else if (e.key === 'ArrowUp') { e.preventDefault(); upiInputRef.current?.focus(); upiInputRef.current?.select(); }
                        else if (e.key === 'Escape') { e.preventDefault(); handleReset(); }
                      }}
                      className="w-full h-10 pl-8 pr-2 bg-muted/50 rounded-xl text-[13px] font-black focus:ring-2 focus:ring-violet-500/30 uppercase outline-none disabled:opacity-50 border border-border/30"
                      style={{ fontSize: '17px', fontFamily: 'Times New Roman' }}
                    />
                  </div>
                </div>

                {Number(chqAmt) > 0 && (
                  <div className="animate-in slide-in-from-top-1 duration-150">
                    {/* CHQ NO · CHQ DATE (DD only) · BANK — all 3 in one row */}
                    <div className="grid grid-cols-3 gap-2">
                      {/* CHQ NO */}
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-muted-foreground"><Hash className="w-3.5 h-3.5" /></div>
                        <input
                          ref={chequeNoRef}
                          type="text" inputMode="numeric" placeholder="CHQ NO (6 DIGIT)"
                          maxLength={6}
                          value={chequeNo} onChange={e => {
                            const v = e.target.value.replace(/\D/g, '').slice(0, 6);
                            setChequeNo(v);
                          }}
                          disabled={saving}
                          onKeyDown={e => {
                            if (e.key === '+' || e.code === 'NumpadAdd') { e.preventDefault(); handleReset(); }
                            else if (e.key === 'Enter') {
                              e.preventDefault();
                              setTimeout(() => chqDateRef.current?.focus(), 30);
                            }
                            else if (e.key === 'Escape') { e.preventDefault(); handleReset(); }
                          }}
                          className="w-full h-10 pl-8 pr-1 bg-muted/50 rounded-xl text-[11px] font-black uppercase outline-none disabled:opacity-50 border border-border/30 focus:ring-2 focus:ring-violet-500/30"
                        />
                      </div>
                      {/* CHQ DATE — DD only, MM/YYYY auto from current month */}
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-muted-foreground"><Calendar className="w-3.5 h-3.5" /></div>
                        <input
                          ref={chqDateRef}
                          type="text" inputMode="numeric" placeholder="DD/MM"
                          maxLength={5}
                          value={chqDateDD}
                          onKeyDown={e => {
                            if (e.key === '+' || e.code === 'NumpadAdd') { e.preventDefault(); handleReset(); }
                            else if (e.key === 'Enter') { e.preventDefault(); setTimeout(() => bankInputRef.current?.focus(), 30); }
                          }}
                          onChange={e => {
                            // Allow digits and "/" only; auto-insert "/" after 2 digits
                            let raw = e.target.value.replace(/[^\d/]/g, '');
                            // Strip any existing slash to re-format cleanly
                            const digits = raw.replace(/\//g, '');
                            if (digits.length > 2) {
                              raw = digits.slice(0, 2) + '/' + digits.slice(2, 4);
                            } else {
                              raw = digits;
                            }
                            setChqDateDD(raw);
                            const parts = raw.split('/');
                            const dd = (parts[0] || '').padStart(2, '0');
                            const now = new Date();
                            const mm = parts[1]
                              ? parts[1].padStart(2, '0')
                              : String(now.getMonth() + 1).padStart(2, '0');
                            const yyyy = String(now.getFullYear());
                            if (parts[0]) {
                              setChequeDate(`${dd}/${mm}/${yyyy}`);
                            } else {
                              setChequeDate('');
                            }
                          }}
                          className={cn(
                            "w-full h-10 pl-8 pr-1 bg-muted/50 rounded-xl text-[11px] font-black text-center outline-none disabled:opacity-50 focus:ring-2 focus:ring-violet-500/30",
                            chqAmt_num > 0 && !chqDateDD.trim()
                              ? "border-2 border-red-400 bg-red-50/60"
                              : "border border-border/30"
                          )}
                        />
                      </div>
                      {/* BANK NAME */}
                      <BankCombobox
                        banks={getBanks()}
                        value={bankName}
                        onChange={setBankName}
                        placeholder={isDriverMode ? "BANK (OPTIONAL)" : "BANK *"}
                        inputRef={bankInputRef}
                        onEnterKey={() => saveBtnRef.current?.focus()}
                        className={cn(
                          "w-full h-10 px-2 bg-muted/50 rounded-xl text-[10px] font-black outline-none disabled:opacity-50 focus:ring-2 focus:ring-violet-500/30",
                          chqAmt_num > 0 && !bankName.trim() && !isDriverMode
                            ? "border-2 border-red-400 bg-red-50/60"
                            : "border border-border/30"
                        )}
                      />
                    </div>
                  </div>
                )}

                {!isDriverMode && (
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { mode: 'FBR',         keyNum: '1', ref: fbrBtnRef,    next: creditBtnRef,  prev: null,         label: 'FBR',      cls: 'bg-destructive text-white', style: { fontSize: '16px' }   },
                    { mode: 'Credit',      keyNum: '2', ref: creditBtnRef, next: delPendBtnRef, prev: fbrBtnRef,    label: 'CREDIT',   cls: 'bg-green-600 text-white', style: { fontSize: '15px' }     },
                    { mode: 'Del Pending', keyNum: '3', ref: delPendBtnRef,next: null,          prev: creditBtnRef, label: 'DEL PEND', cls: 'bg-amber-600 text-white', style: { fontSize: '15px', fontFamily: 'Times New Roman' }     },
                  ] as const).map(item => (
                    <button
                      key={item.mode}
                      ref={item.ref as any}
                      style={item.style}
                      onClick={() => {
                        if (item.mode === 'FBR') {
                          clearReceivedAmounts();
                          setShowFbrReasonModal(true);
                          setPaymentMode('FBR');
                        } else if (item.mode === 'Credit') {
                          if (paymentMode === item.mode) {
                            setPaymentMode('');
                            setLcAsOutstanding(false);
                            setShowLineCutPopup(false);
                          } else {
                            openCreditLineCutPopup();
                          }
                        } else {
                          clearReceivedAmounts();
                          setPaymentMode(prev => prev === item.mode ? '' : item.mode);
                          if (item.mode !== 'Del Pending') setDelPendingDriver('');
                        }
                      }}
                      disabled={isBillCurrentlyLocked || userCannotEditReceivedBill}
                      onKeyDown={e => {
                        if (e.key === '+' || e.code === 'NumpadAdd') {
                          e.preventDefault();
                          handleReset();
                        }
                        else if (e.key === '1' || e.code === 'Numpad1') {
                          e.preventDefault();
                          if (isBillCurrentlyLocked || userCannotEditReceivedBill) return;
                          clearReceivedAmounts();
                          setShowFbrReasonModal(true);
                          setPaymentMode('FBR');
                        }
                        else if (e.key === '2' || e.code === 'Numpad2') {
                          e.preventDefault();
                          if (isBillCurrentlyLocked || userCannotEditReceivedBill) return;
                          openCreditLineCutPopup();
                        }
                        else if (e.key === '3' || e.code === 'Numpad3') {
                          e.preventDefault();
                          if (isBillCurrentlyLocked || userCannotEditReceivedBill) return;
                          clearReceivedAmounts();
                          setPaymentMode('Del Pending');
                          setTimeout(() => saveBtnRef.current?.focus(), 30);
                        }
                        else if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          chqInputRef.current?.focus();
                          chqInputRef.current?.select();
                        }
                        else if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          saveBtnRef.current?.focus();
                        }
                        else if (e.key === ' ' || e.key === 'Spacebar') {
                          e.preventDefault();
                          if (isBillCurrentlyLocked || userCannotEditReceivedBill) return;
                          if (item.mode === 'FBR') { clearReceivedAmounts(); setShowFbrReasonModal(true); setPaymentMode('FBR'); }
                          else if (item.mode === 'Credit') {
                            if (paymentMode === item.mode) {
                              setPaymentMode('');
                              setLcAsOutstanding(false);
                              setShowLineCutPopup(false);
                            } else {
                              openCreditLineCutPopup();
                            }
                          }
                          else { clearReceivedAmounts(); setPaymentMode(prev => prev === item.mode ? '' : item.mode); }
                        }
                        else if (e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)) { if (item.next) { e.preventDefault(); item.next.current?.focus(); } else { e.preventDefault(); saveBtnRef.current?.focus(); } }
                        else if (e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey)) { if (item.prev) { e.preventDefault(); item.prev.current?.focus(); } }
                        else if (e.key === 'Enter') {
                          e.preventDefault();
                          if (isBillCurrentlyLocked || userCannotEditReceivedBill) return;
                          if (item.mode === 'FBR') {
                            clearReceivedAmounts();
                            setShowFbrReasonModal(true);
                            setPaymentMode('FBR');
                          } else if (item.mode === 'Credit') {
                            if (paymentMode === item.mode) {
                              setPaymentMode('');
                              setLcAsOutstanding(false);
                              setShowLineCutPopup(false);
                            } else {
                              openCreditLineCutPopup();
                            }
                          } else {
                            clearReceivedAmounts();
                            const newMode = paymentMode === item.mode ? '' : item.mode;
                            setPaymentMode(newMode);
                            setTimeout(() => saveBtnRef.current?.focus(), 30);
                          }
                        }
                      }}
                      className={cn("h-9 rounded-xl text-[10px] font-black uppercase transition-all disabled:opacity-40 shadow-sm focus:ring-2 focus:ring-primary/50 focus:outline-none border flex items-center justify-center gap-1", paymentMode === item.mode ? item.cls + ' border-transparent' : "bg-muted text-muted-foreground border-border/30")}
                    >
                      <span className={cn("inline-flex items-center justify-center w-4 h-4 rounded text-[9px] font-black", paymentMode === item.mode ? "bg-black/25 text-white" : "bg-muted-foreground/20 text-foreground")}>
                        {item.keyNum}
                      </span>
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
                )}

                <div className="flex gap-2">
                  {!isDriverMode && (
                    <Button
                      variant="outline"
                      onClick={() => setShowResetPwModal(true)}
                      className="flex-1 h-10 rounded-xl font-black uppercase text-[11px] p-0 shadow-sm hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5 mr-1.5" />Reset
                    </Button>
                  )}
                  {!isDriverMode && isProtectedBill && (
                    <Button
                      variant="outline"
                      disabled={(getRole() === 'user' && !userPerms.canEdit) || userCannotEditReceivedBill}
                      title={userCannotEditReceivedBill ? "Admin page me is user ka Edit right ON hona chahiye" : undefined}
                      onClick={() => {
                        if ((getRole() === 'user' && !userPerms.canEdit) || userCannotEditReceivedBill) return;
                        setEditLocked(false);
                        setTimeout(() => cashInputRef.current?.focus(), 50);
                      }}
                      className={cn(
                        "flex-1 h-10 rounded-xl font-black uppercase text-[11px] p-0 shadow-sm transition-all",
                        editLocked ? "bg-amber-500/10 border-amber-500/40 text-amber-600 hover:bg-amber-500/20" : "bg-muted"
                      )}
                    >
                      <Pencil className="w-3.5 h-3.5 mr-1.5" />{editLocked ? 'Unlock' : 'Edit'}
                    </Button>
                  )}
                  <Button
                    ref={saveBtnRef}
                    onClick={handleSaveClick}
                    onKeyDown={e => {
                      if (e.key === '+' || e.code === 'NumpadAdd') {
                        e.preventDefault();
                        handleReset();
                      } else if (e.key === '1' || e.code === 'Numpad1') {
                        e.preventDefault();
                        clearReceivedAmounts();
                        setShowFbrReasonModal(true);
                        setPaymentMode('FBR');
                      } else if (e.key === '2' || e.code === 'Numpad2') {
                        e.preventDefault();
                        openCreditLineCutPopup();
                      } else if (e.key === '3' || e.code === 'Numpad3') {
                        e.preventDefault();
                        clearReceivedAmounts();
                        setPaymentMode('Del Pending');
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        fbrBtnRef.current?.focus();
                      } else if (e.key === 'Enter') {
                        e.preventDefault();
                        handleSaveClick();
                      }
                    }}
                    disabled={!canSave}
                    className="flex-[1.5] h-10 rounded-xl font-black uppercase text-[11px] p-0 shadow-lg bg-primary hover:bg-primary/90"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Check className="w-4 h-4 mr-1.5" />Save ₹{totalCollected.toLocaleString('en-IN')}</>}
                  </Button>
                </div>
              </div>
            </div>
          );
        })()}

        <div className="px-1 w-full max-w-none mx-auto">
          {selectedDriver && (
            <DriverDayTable 
              bills={bills} 
              selectedDriver={selectedDriver} 
              displayDate={displayDate} 
              onSelectBill={bn => handleBillSelect(bn)}
              ownerSavedBillNos={ownerSavedBillNos}
              isDriverMode={isDriverMode}
              selectedDriverIsOwnerOrUser={Boolean(
                selectedDriver === 'OWNER' ||
                drivers.some(d => (d.name || '').trim().toUpperCase() === selectedDriver.trim().toUpperCase() && (d.role === 'user' || d.role === 'owner'))
              )}
              enteredByFilter={selectedDriver || undefined}
            />
          )}
        </div>
      </div>

      {showDiffConfirm && (
        <div className="fixed inset-0 bg-black/60 z-[200] flex items-start justify-center pt-4 px-4 backdrop-blur-sm">
          <div className="bg-card rounded-3xl p-6 w-full max-w-xs shadow-2xl animate-in zoom-in-95 text-center border border-border">
            <h3 className="font-black text-xl uppercase text-destructive mb-1">LINE CUT = ₹{(selectedBill?.billNetAmt || 0) - totalCollected}</h3>
            <p className="text-[10px] font-black text-muted-foreground mb-4 uppercase">Reason (optional):</p>
            <input
              type="text" placeholder="REASON..." autoFocus value={confirmInput} onChange={e => setConfirmInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && doSave()}
              className="w-full h-12 px-4 bg-muted rounded-2xl mb-4 text-sm font-black border-2 border-destructive/10 focus:border-destructive outline-none uppercase text-center"
            />
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowDiffConfirm(false)} className="flex-1 rounded-2xl uppercase font-black text-[11px] h-12">Back</Button>
              <Button onClick={() => doSave()} className="flex-1 rounded-2xl bg-destructive text-white uppercase font-black text-[11px] h-12">Confirm</Button>
            </div>
          </div>
        </div>
      )}

      {showRecDateConfirm && (
        <div className="fixed inset-0 bg-black/60 z-[200] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-card rounded-3xl p-6 w-full max-w-sm shadow-2xl animate-in zoom-in-95 text-center border border-border">
            <div className="flex items-center justify-center gap-2 mb-2 text-primary">
              <Calendar className="w-5 h-5" />
              <h3 className="font-black text-base uppercase">CONFIRM REC DATE</h3>
            </div>

            {selectedBill && (
              <div className="bg-muted/60 p-3 rounded-2xl mb-4 text-left border border-border/50 space-y-1">
                <div className="flex justify-between items-center">
                  <span className="text-[12px] font-black uppercase text-foreground">{selectedBill.billNo}</span>
                  <span className="text-[13px] font-black text-emerald-600">₹{totalCollected.toLocaleString('en-IN')}</span>
                </div>
                {selectedBill.partyName && (
                  <p className="text-[10px] font-bold text-muted-foreground uppercase truncate">{selectedBill.partyName}</p>
                )}
              </div>
            )}

            <label className="block text-[11px] font-black text-purple-700 dark:text-purple-300 mb-1.5 uppercase text-left">
              REC DATE (RECEIPT DATE):
            </label>
            <input
              type="date"
              autoFocus
              value={recDateInput || dashDate}
              onChange={e => setRecDateInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  confirmRecDateAndSave();
                }
              }}
              className="w-full h-12 px-4 bg-purple-50 dark:bg-purple-950/50 rounded-2xl mb-5 text-base font-black border-2 border-purple-400 focus:border-purple-600 outline-none text-center uppercase text-purple-950 dark:text-purple-100 cursor-pointer shadow-sm"
            />

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowRecDateConfirm(false)} className="flex-1 rounded-2xl uppercase font-black text-[11px] h-12">
                Cancel
              </Button>
              <Button onClick={confirmRecDateAndSave} className="flex-1 rounded-2xl bg-primary text-primary-foreground uppercase font-black text-[11px] h-12 shadow-lg">
                Confirm & Save
              </Button>
            </div>
          </div>
        </div>
      )}

      {saveError && (
        <div className="fixed inset-0 bg-black/60 z-[260] flex items-start justify-center pt-4 px-4 backdrop-blur-sm">
          <div className="bg-card rounded-3xl p-6 w-full max-w-sm shadow-2xl border-2 border-destructive text-center">
            <div className="w-14 h-14 bg-destructive rounded-full flex items-center justify-center mx-auto mb-3">
              <X className="w-7 h-7 text-destructive-foreground stroke-[3]" />
            </div>
            <p className="text-[11px] font-black text-destructive uppercase tracking-widest">Database Save Failed</p>
            <p className="text-sm text-foreground mt-2">{saveError}</p>
            <button onClick={() => setSaveError(null)} className="mt-4 w-full bg-primary text-primary-foreground rounded-xl py-2 text-xs font-black uppercase tracking-widest">OK</button>
          </div>
        </div>
      )}

      {/* ── Overflow Chain Modal — collect all bills, save together ── */}
      <OverflowModal
        isOpen={showOverflowModal}
        onClose={() => {
          setShowOverflowModal(false);
          setOverflowPendingItems([]);
        }}
        overflowTotalCollected={overflowTotalCollected}
        overflowMode={overflowMode}
        initialItems={overflowPendingItems}
        bills={bills}
        onSaveAll={handleOverflowSaveAll}
        overflowSaving={overflowSaving}
      />

      {/* ── Draft Restored Banner ─────────────────────────────────────────────── */}
      {showDraftRestored && (
        <div className="fixed top-0 left-0 right-0 z-[300] flex justify-center pt-2 px-3 pointer-events-none">
          <div className="bg-card rounded-2xl px-4 py-3 w-full max-w-sm shadow-2xl border-2 border-amber-400 animate-in slide-in-from-top-3 duration-200 pointer-events-auto">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-400 rounded-full flex items-center justify-center text-white shadow-lg shrink-0">
                <span className="text-lg">⚡</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[9px] font-black text-amber-600 uppercase tracking-widest">Draft Restored</p>
                <h4 className="text-sm font-black uppercase text-foreground truncate">Pichli entry wapas aayi</h4>
                <p className="text-[9px] font-bold text-muted-foreground uppercase">Light jane se pehle ki entry — check karke Save karo</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {showPaidPopup && lastSavedBill && (
        <div className="fixed top-0 left-0 right-0 z-[300] flex justify-center pt-2 px-3 pointer-events-none">
          <div className="bg-card rounded-2xl px-4 py-3 w-full max-w-sm shadow-2xl border-2 border-emerald-500 animate-in slide-in-from-top-3 duration-200 pointer-events-auto">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-emerald-500 rounded-full flex items-center justify-center text-white shadow-lg shrink-0"><Check className="w-5 h-5 stroke-[4]" /></div>
              <div className="flex-1 min-w-0">
                <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest">Saved Successfully</p>
                <h4 className="text-base font-black uppercase text-foreground truncate">{lastSavedBill.billNo}</h4>
                {lastSavedBill.partyName && <p className="text-[9px] font-bold text-muted-foreground truncate uppercase">{lastSavedBill.partyName}</p>}
              </div>
              {lastSavedBill.diff !== 0 && (
                <div className="shrink-0 text-right">
                  <p className="text-[9px] font-black text-destructive uppercase">SHORT</p>
                  <p className="text-sm font-black text-destructive">₹{lastSavedBill.diff.toLocaleString('en-IN')}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <DatePwModal
        isOpen={showDatePwModal}
        onClose={() => setShowDatePwModal(false)}
        onSuccess={() => {
          setDailyUnlocked();
          setShowDatePwModal(false);
          setPendingDate(dashDate);
          setShowDatePicker(true);
        }}
        systemPassword={getSystemPassword()}
      />

      <ResetPwModal
        isOpen={showResetPwModal}
        onClose={() => setShowResetPwModal(false)}
        onSuccess={handleFormReset}
        billNo={selectedBillNo || undefined}
      />

      <BillDetailsModal
        billNo={pendingSelectBill}
        bill={pendingSelectBill ? billMap.get(pendingSelectBill) : undefined}
        onClose={() => setPendingSelectBill(null)}
        onOpenEntry={(billNo) => {
          setPendingSelectBill(null);
          handleBillSelect(billNo);
        }}
      />

      <DatePickerModal
        isOpen={showDatePicker}
        onClose={() => setShowDatePicker(false)}
        onConfirm={(pendingDate) => {
          setDashDate(pendingDate);
          setShowDatePicker(false);
        }}
        initialDate={pendingDate}
      />

      {showMultiBillModal && (
        <MultiBillEntryModal
          bills={bills}
          banks={banks}
          selectedDriver={selectedDriver}
          displayDate={displayDate}
          dashDate={dashDate}
          onClose={() => { setShowMultiBillModal(false); setTimeout(() => billInputRef.current?.focus(), 50); }}
          onSaved={() => refresh()}
        />
      )}

      <LineCutPopup
        isOpen={showLineCutPopup}
        selectedBill={selectedBill}
        totalCollected={totalCollected}
        isDriverMode={isDriverMode}
        onClose={() => {
          setShowLineCutPopup(false);
          setLcAsOutstanding(false);
        }}
        onSaveNormal={(enteredLineCut, discrepancyReason) => {
          setShowLineCutPopup(false);
          doSave(enteredLineCut, null, discrepancyReason);
        }}
        onSaveAsOutstanding={(enteredLineCut, discrepancyReason) => {
          setShowLineCutPopup(false);
          doSaveAsOutstanding(enteredLineCut, discrepancyReason);
        }}
        initialLcAsOutstanding={lcAsOutstanding}
        initialLineCutValue={parseAmountExpression(lcInputVal)}
      />

      <FbrReasonModal
        isOpen={showFbrReasonModal}
        onClose={() => setShowFbrReasonModal(false)}
        onSelectReason={doSaveFBR}
        saving={saving}
      />

      {/* ── MOC Commission Code Picker Modal ── */}
      {showMocModal && (
        <div className="fixed inset-0 bg-black/60 z-[280] flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-card rounded-3xl p-5 w-full max-w-md shadow-2xl border-2 border-emerald-500/40 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-border mb-4">
              <div>
                <h3 className="text-base font-black uppercase text-emerald-700 flex items-center gap-1.5">
                  <span className="w-6 h-6 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center text-xs font-black">₹</span>
                  Commission (MOC)
                </h3>
                <p className="text-[10px] font-bold text-muted-foreground uppercase">
                  Select MOC code to enter cash commission
                </p>
              </div>
              <button
                onClick={() => setShowMocModal(false)}
                className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-[320px] overflow-y-auto pr-1">
              {commissionMocs.map(moc => (
                <button
                  key={moc.id}
                  onClick={() => {
                    setShowMocModal(false);
                    handleBillSelect(moc.code);
                  }}
                  className="flex flex-col items-center justify-center p-3.5 rounded-2xl border-2 border-emerald-300 bg-emerald-50/50 hover:bg-emerald-500 hover:text-white hover:border-emerald-600 transition-all text-center group shadow-xs active:scale-95"
                >
                  <span className="text-base font-black text-emerald-950 group-hover:text-white uppercase tracking-wide">{moc.code}</span>
                </button>
              ))}
            </div>

            <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-[10px] font-bold text-muted-foreground uppercase">
              <span>Admin settings me naye MOC add kar sakte hain</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowMocModal(false)}
                className="rounded-xl text-[10px] font-black uppercase h-8 px-3"
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Cash Breakdown Modal ── */}
      <CashBreakdownModal
        isOpen={showCashBreakdownModal}
        onClose={() => setShowCashBreakdownModal(false)}
        displayDate={displayDate}
        cashStats={cashStats}
      />

      {/* ── Salesperson Mobile Number Input Modal (for WhatsApp direct message) ── */}
      {showSalespersonPhoneModal && (
        <div className="fixed inset-0 bg-black/60 z-[290] flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-card rounded-3xl p-6 w-full max-w-sm shadow-2xl border-2 border-emerald-500/40 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-border mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-950/70 text-emerald-600 dark:text-emerald-300 flex items-center justify-center">
                  <MessageCircle className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-black uppercase text-foreground">Salesperson WhatsApp</h3>
                  <p className="text-[11px] font-bold text-muted-foreground uppercase">{spModalSalespersonName}</p>
                </div>
              </div>
              <button
                onClick={() => setShowSalespersonPhoneModal(false)}
                className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-[12px] text-muted-foreground mb-3">
              Salesperson <strong className="text-foreground">{spModalSalespersonName}</strong> ka WhatsApp number saved nahi hai. Kripya 10-digit mobile number enter karein:
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-black uppercase text-muted-foreground block mb-1">Mobile Number (10 Digits)</label>
                <div className="flex items-center rounded-xl border border-input bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-emerald-500">
                  <span className="text-sm font-bold text-muted-foreground mr-2">+91</span>
                  <input
                    type="tel"
                    maxLength={10}
                    placeholder="9876543210"
                    value={spModalPhone}
                    onChange={e => setSpModalPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    autoFocus
                    className="w-full bg-transparent text-sm font-black outline-none"
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleSaveSalespersonPhoneAndSend();
                      }
                    }}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setShowSalespersonPhoneModal(false)}
                  className="flex-1 rounded-xl font-bold uppercase text-[12px]"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSaveSalespersonPhoneAndSend}
                  disabled={spModalPhone.replace(/\D/g, '').length < 10}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-black uppercase text-[12px] gap-1.5"
                >
                  <MessageCircle className="w-4 h-4" />
                  Send
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
