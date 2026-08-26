
import { useState, useRef, useEffect, useMemo } from 'react';
import { AdminAiAgent } from '@/components/AdminAiAgent';
import GreenPartyManagerModal from '@/components/GreenPartyManagerModal';
import { getGreenParties } from '@/lib/greenParties';
import { FileSpreadsheet, Loader2, Trash2, Plus, Lock, MessageSquare, ShieldCheck, Download, AlertCircle, CheckCircle2, X, Archive, UploadCloud, Type, Smartphone, Phone, Pencil, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { 
  saveBills, 
  saveDrivers, 
  getDrivers, 
  getBills, 
  excelSerialToDate, 
  Bill, 
  Driver, 
  Bank, 
  getBanks, 
  saveBanks, 
  deleteBank,
  getAllUniqueBankNames,
  deduplicateBanks,
  mergeTwoBanks,
  WhatsAppTemplates, 
  getWhatsAppTemplates, 
  saveWhatsAppTemplates,
  getWABulkSendEnabled,
  saveWABulkSendEnabled,
  getBillSearchAutoResetSec,
  saveBillSearchAutoResetSec,
  addBillsToMemoryOnly,
  mergeBillsInMemoryOnly,
  getSystemPassword, 
  saveSystemPasswordSuffix,
  getPwSuffix,
  getUserPerm,
  saveUserPerm,
  getUserPassword,
  getAllUserPasswords,
  saveUserPassword,
  savePartyContacts, 
  saveSalespersonContacts, 
  getPartyContacts,
  getSalespersonContacts,
  getSummaries,
  saveSummaries,
  patchBillsInMemory,
  addBillsToStore,
  bulkMergeBillsInStore,
  deduplicateBills,
  cleanSalespersonName,
  cleanPartyName,
  consolidateSimilarPartyAndSalespersons,
  consolidateSimilarPartiesOnly,
  consolidateSimilarSalespersonsOnly,
  mergeTwoSalespersons,
  mergeTwoParties,
  findCanonicalName,
  findSalespersonContact,
  Contact,
  idbSet,
  idbGet,
  normDateStr
} from '@/lib/billStore';
import TopNav from '@/components/TopNav';
import { ConfirmModal } from '@/components/ConfirmModal';
import { cn } from '@/lib/utils';
import { apiFetchAllData } from '@/lib/apiSync';
import {
  getCommissionMocs,
  saveCommissionMocs,
  addCommissionMoc,
  deleteCommissionMoc,
  resetCommissionMocsToDefault,
  hasMocEntries,
  CommissionMoc
} from '@/lib/commissionMoc';
import { processBillsReportFile } from '@/lib/billsReport';

function getTodayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}

// Returns true for GRAND TOTAL / TOTAL / SUB TOTAL / NET TOTAL summary rows
// that must be filtered out from all XLS uploads.
function isSummaryRow(billNo: string): boolean {
  const upper = billNo.toUpperCase().replace(/\s+/g, ' ').trim();
  return upper === 'GRAND TOTAL' || upper === 'TOTAL' || upper === 'NET TOTAL'
    || upper.includes('GRAND TOTAL') || upper.includes('SUB TOTAL') || upper.includes('NET TOTAL');
}

// Returns true if a bill already has any payment/delivery data recorded.
// Such bills must never be overwritten by any XLS upload or restore.
function billHasPaymentData(b: Bill): boolean {
  return !!(
    b.paymentDate ||
    b.deliveryDate ||
    (Number(b.cashAmount) > 0) ||
    (Number(b.upiAmount) > 0) ||
    (Number(b.chequeAmount) > 0) ||
    b.chequeNo ||
    (Number(b.collectedAmount) > 0) ||
    b.bankName
  );
}

type UploadResult = {
  status: 'loading' | 'success' | 'error';
  message: string;
  details?: string[];
};

export default function SettingsPage() {
  const [unlocked, setUnlocked] = useState(true);
  const [pwInput] = useState('');
  const [pwError] = useState(false);
  const [isGreenPartyModalOpen, setIsGreenPartyModalOpen] = useState(false);

  const [billsReportResult, setBillsReportResult] = useState<UploadResult | null>(null);
  const [spCleanResult, setSpCleanResult] = useState<UploadResult | null>(null);
  const billsReportFileRef = useRef<HTMLInputElement>(null);

  const [contactResult, setContactResult] = useState<UploadResult | null>(null);
  const syncContactFileRef = useRef<HTMLInputElement>(null);

  const [salesResult, setSalesResult] = useState<UploadResult | null>(null);
  const syncSalesFileRef = useRef<HTMLInputElement>(null);

  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [newDriverName, setNewDriverName] = useState('');
  const [newPersonRole, setNewPersonRole] = useState<'driver' | 'owner' | 'user'>('driver');
  const [editDriverId, setEditDriverId] = useState<string | null>(null);
  const [editDriverName, setEditDriverName] = useState('');
  const [banks, setBanks] = useState<Bank[]>([]);
  const [newBankName, setNewBankName] = useState('');
  const [waTemplates, setWaTemplates] = useState<WhatsAppTemplates>({ pending: '', fbr: '', returnCheque: '' });
  const [waBulkEnabled, setWaBulkEnabled] = useState(true);
  const [deleteDateFrom, setDeleteDateFrom] = useState('');
  const [deleteDateTo, setDeleteDateTo] = useState('');
  const [fontZoom, setFontZoom] = useState<string>('1');
  const [commissionMocs, setCommissionMocs] = useState<CommissionMoc[]>([]);
  const [newMocMonth, setNewMocMonth] = useState('');
  const [newMocCode, setNewMocCode] = useState('');
  const [mocSavedMsg, setMocSavedMsg] = useState('');
  const [salesEditName, setSalesEditName] = useState('');
  const [salesEditMobile, setSalesEditMobile] = useState('');
  const [salesEditStatus, setSalesEditStatus] = useState<'idle' | 'saved'>('idle');
  const [spMergeFrom, setSpMergeFrom] = useState('');
  const [spMergeTo, setSpMergeTo] = useState('');
  const [spMergeStatus, setSpMergeStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [spMergeMsg, setSpMergeMsg] = useState('');
  const [pwSuffix, setPwSuffix] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const [backupFullStatus, setBackupFullStatus] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle');
  const [backupFullProgress, setBackupFullProgress] = useState('');
  const [backupStatus, setBackupStatus] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle');
  const [backupProgress, setBackupProgress] = useState('');
  const [backup2Status, setBackup2Status] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle');
  const [backup2Progress, setBackup2Progress] = useState('');
  const [restoreStatus, setRestoreStatus] = useState<UploadResult | null>(null);
  const restoreFileRef = useRef<HTMLInputElement>(null);
  const [pendingRestore, setPendingRestore] = useState<{
    fileName: string;
    stats: { label: string; count: number }[];
    wb: any;
  } | null>(null);

  // Helper helper to build shared sheets
  const [ledgerResult, setLedgerResult] = useState<UploadResult | null>(null);
  const [recPaymentResult, setRecPaymentResult] = useState<UploadResult | null>(null);
  const [collSummaryResult, setCollSummaryResult] = useState<UploadResult | null>(null);
  const [leveredgeResult, setLeveredgeResult] = useState<UploadResult | null>(null);
  const [leveredgeRows, setLeveredgeRows] = useState<any[]>([]);
  const [leveredgeFileName, setLeveredgeFileName] = useState<string>('');
  const leveredgeRawBufferRef = useRef<ArrayBuffer | null>(null);
  const [leveredgeSheetNames, setLeveredgeSheetNames] = useState<string[]>(['Collection', 'Retailer Bank', 'Collection Mode']);
  const [leveredgeSheet2Banks, setLeveredgeSheet2Banks] = useState<string[]>([]);
  const [leveredgeSheet3Aoa, setLeveredgeSheet3Aoa] = useState<any[][]>([]);
  const leveredgeFileRef = useRef<HTMLInputElement>(null);


  async function runAutoBackupBeforeRestore(): Promise<boolean> {
    try {
      const XLSX = await import('xlsx');
      const { apiFetchAllData } = await import('@/lib/apiSync');
      const serverData = await apiFetchAllData();
      
      const wb = XLSX.utils.book_new();
      
      // Bills
      const allBills: Bill[] = serverData.bills.length > 0 ? serverData.bills : getBills();
      XLSX.utils.book_append_sheet(wb, buildBillsSheet(XLSX, allBills), 'Bills');
      
      // Other sheets
      appendSharedSheets(XLSX, wb, serverData);
      
      downloadWb(XLSX, wb, `VitraTrack_Auto_PreRestore_Backup_${getStamp()}.xlsx`);
      return true;
    } catch (err) {
      console.error('[Auto Pre-Restore Backup Failed]', err);
      return false;
    }
  }

  async function executeRestore(wb: any) {
    setRestoreStatus({ status: 'loading', message: 'Creating automatic pre-restore backup...' });
    setPendingRestore(null);
    try {
      const backupOk = await runAutoBackupBeforeRestore();
      if (!backupOk) {
        setRestoreStatus({ status: 'error', message: 'Restore aborted: Automated pre-restore backup failed. Data must be backed up first for protection.' });
        return;
      }

      setRestoreStatus({ status: 'loading', message: 'Auto-backup complete. Executing transaction-safe restore...' });
      const XLSX = await import('xlsx');
      const stats: string[] = [];

      // Normalise a date value to dd/mm/yyyy
      const normDate = (v: any): string => {
        if (!v && v !== 0) return '';
        if (typeof v === 'number' && v > 1000) {
          const d = new Date(Math.round((v - 25569) * 86400 * 1000));
          const dd = String(d.getUTCDate()).padStart(2, '0');
          const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
          const yyyy = d.getUTCFullYear();
          return `${dd}/${mm}/${yyyy}`;
        }
        const s = String(v).trim();
        if (!s) return '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
          const [y, m, d] = s.split('-');
          return `${d}/${m}/${y}`;
        }
        if (/^\d{2}-\d{2}-\d{4}$/.test(s)) return s.replace(/-/g, '/');
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
        return s;
      };

      if (wb.SheetNames.includes('Bills')) {
        const rows: Bill[] = XLSX.utils.sheet_to_json(wb.Sheets['Bills'], { defval: '' });
        const incoming = rows
          .filter(r => r.billNo)
          .map(b => ({
            ...b,
            id: b.id || Math.random().toString(36).substr(2, 9),
            salespersonName: cleanSalespersonName(b.salespersonName),
            partyName:       cleanPartyName(b.partyName),
            date:         normDate((b as any).date),
            paymentDate:  normDate(b.paymentDate),
            deliveryDate: normDate(b.deliveryDate),
          }));
        if (incoming.length > 0) {
          const currentBillMap2 = new Map<string, Bill>(getBills().map(b => [b.billNo, b]));
          const toMerge = incoming.filter(b => {
            const cur = currentBillMap2.get(b.billNo);
            return !cur || !billHasPaymentData(cur);
          });
          const protectedCnt = incoming.length - toMerge.length;
          if (toMerge.length > 0) {
            mergeBillsInMemoryOnly(toMerge);
            setRestoreStatus({ status: 'loading', message: `Server me save ho raha hai... 0 / ${toMerge.length}` });
            const { apiBulkUpsertWithProgress } = await import('@/lib/apiSync');
            await apiBulkUpsertWithProgress(toMerge, (saved, total) => {
              setRestoreStatus({ status: 'loading', message: `Server me save ho raha hai... ${saved} / ${total}` });
            });
          }
          stats.push(`Bills: ${toMerge.length} merged${protectedCnt > 0 ? ` · ${protectedCnt} protected (payment data preserved)` : ''} (no deletions)`);
        }
      }

      if (wb.SheetNames.includes('Drivers')) {
        const rows: Driver[] = XLSX.utils.sheet_to_json(wb.Sheets['Drivers'], { defval: '' });
        const incoming = rows.filter(r => r.id && r.name);
        if (incoming.length > 0) {
          const existing = getDrivers();
          const merged = new Map<string, Driver>(existing.map(d => [d.name.trim().toLowerCase(), d]));
          let added = 0;
          for (const d of incoming) {
            const key = d.name.trim().toLowerCase();
            if (!merged.has(key)) { merged.set(key, d); added++; }
          }
          saveDrivers(Array.from(merged.values()));
          stats.push(`Drivers: ${added} new added (${existing.length} kept)`);
        }
      }

      if (wb.SheetNames.includes('Banks')) {
        const rows: Bank[] = XLSX.utils.sheet_to_json(wb.Sheets['Banks'], { defval: '' });
        const incoming = rows.filter(r => r.id && r.name);
        if (incoming.length > 0) {
          const existing = getBanks();
          const merged = new Map<string, Bank>(existing.map(b => [b.name.trim().toLowerCase(), b]));
          let added = 0;
          for (const b of incoming) {
            const key = b.name.trim().toLowerCase();
            if (!merged.has(key)) { merged.set(key, b); added++; }
          }
          saveBanks(Array.from(merged.values()));
          stats.push(`Banks: ${added} new added (${existing.length} kept)`);
        }
      }

      if (wb.SheetNames.includes('Summaries')) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets['Summaries'], { defval: '' }) as any[];
        const incoming = rows.filter(r => r.id && r.driverName);
        if (incoming.length > 0) {
          const existing = getSummaries();
          const merged = new Map<string, any>(existing.map(s => [s.id, s]));
          let added = 0;
          for (const s of incoming) { if (!merged.has(s.id)) added++; merged.set(s.id, s); }
          saveSummaries(Array.from(merged.values()));
          stats.push(`Summaries: ${added} new added (${existing.length} kept)`);
        }
      }

      if (wb.SheetNames.includes('Party_Contacts')) {
        const rows: Contact[] = XLSX.utils.sheet_to_json(wb.Sheets['Party_Contacts'], { defval: '' });
        const incoming = rows
          .filter(r => r.name && r.mobile)
          .map(c => ({ ...c, name: cleanPartyName(c.name) }));
        if (incoming.length > 0) {
          const existing = getPartyContacts();
          const merged = new Map<string, Contact>(existing.map(c => [c.name.toLowerCase(), c]));
          let added = 0, updated = 0;
          for (const c of incoming) {
            const key = c.name.toLowerCase();
            if (merged.has(key)) {
              // Do NOT change the stored name — only update mobile (and keep id)
              const prev = merged.get(key)!;
              if (prev.mobile !== c.mobile) {
                merged.set(key, { ...prev, mobile: c.mobile });
                updated++;
              }
            } else {
              merged.set(key, c);
              added++;
            }
          }
          savePartyContacts(Array.from(merged.values()));
          stats.push(`Party Contacts: ${added} new + ${updated} mobiles updated (no name changes)`);
        }
      }

      if (wb.SheetNames.includes('Salesperson_Contacts')) {
        const rows: Contact[] = XLSX.utils.sheet_to_json(wb.Sheets['Salesperson_Contacts'], { defval: '' });
        const incoming = rows
          .filter(r => r.name && r.mobile)
          .map(c => ({ ...c, name: cleanSalespersonName(c.name) }));
        if (incoming.length > 0) {
          const existing = getSalespersonContacts();
          const merged = new Map<string, Contact>(existing.map(c => [cleanSalespersonName(c.name || '').trim().toLowerCase(), c]));
          let added = 0, updated = 0;
          for (const c of incoming) {
            const clean = cleanSalespersonName(c.name || '').trim();
            if (!clean) continue;
            let matchKey = '';
            for (const [key, prev] of merged) {
              if (key === clean.toLowerCase() || areSalespersonNamesEquivalent(prev.name, clean)) {
                matchKey = key;
                break;
              }
            }
            if (matchKey) {
              const prev = merged.get(matchKey)!;
              const cleanDigits = String(c.mobile || '').replace(/\D/g, '').slice(-10);
              if (cleanDigits && prev.mobile !== cleanDigits) {
                merged.set(matchKey, { ...prev, name: cleanSalespersonName(prev.name || clean), mobile: cleanDigits });
                updated++;
              }
            } else {
              const cleanDigits = String(c.mobile || '').replace(/\D/g, '').slice(-10);
              merged.set(clean.toLowerCase(), { ...c, name: clean, mobile: cleanDigits });
              added++;
            }
          }
          saveSalespersonContacts(Array.from(merged.values()));
          stats.push(`Salesperson Contacts: ${added} new + ${updated} mobiles updated (no name changes)`);
        }
      }

      if (wb.SheetNames.includes('Settings')) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets['Settings'], { defval: '' }) as Array<{ key: string; value: string }>;
        const valid = rows.filter(r => r.key && r.value);
        if (valid.length > 0) {
          const { apiPushSetting } = await import('@/lib/apiSync');
          for (const r of valid) {
            await apiPushSetting(r.key, r.value);
            if (r.key === 'pw_suffix') { const { saveSystemPasswordSuffix } = await import('@/lib/billStore'); saveSystemPasswordSuffix(r.value); }
            if (r.key === 'wa_templates') { try { const { saveWhatsAppTemplates } = await import('@/lib/billStore'); saveWhatsAppTemplates(JSON.parse(r.value)); } catch {} }
          }
          stats.push(`Settings: ${valid.length} keys restored`);
        }
      }

      if (stats.length === 0) {
        setRestoreStatus({ status: 'error', message: 'No valid data sheets found in backup file.' });
      } else {
        setRestoreStatus({ status: 'success', message: 'Backup restored successfully!', details: stats });
      }
    } catch (err: any) {
      setRestoreStatus({ status: 'error', message: `Restore failed: ${err?.message || 'Unknown error'}` });
    }
  }
  const [assignCreditStatus, setAssignCreditStatus] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle');
  const [assignCreditResult, setAssignCreditResult] = useState<string>('');
  const [userPermChanging, setUserPermChanging] = useState<Record<string, boolean>>({});
  const [userPwInputs, setUserPwInputs] = useState<Record<string, string>>({});
  const [userPwSaving, setUserPwSaving] = useState<Record<string, boolean>>({});
  const [userPwSaved, setUserPwSaved] = useState<Record<string, boolean>>({});
  const [searchResetSec, setSearchResetSec] = useState<number>(4);
  const [searchResetSaved, setSearchResetSaved] = useState<boolean>(false);
  const [bankMergeFrom, setBankMergeFrom] = useState('');
  const [bankMergeTo, setBankMergeTo] = useState('');
  const [bankMergeCustomTo, setBankMergeCustomTo] = useState('');
  const [bankMergeStatus, setBankMergeStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [bankMergeMsg, setBankMergeMsg] = useState('');
  const [dedupBankStatus, setDedupBankStatus] = useState<'idle' | 'loading' | 'done'>('idle');
  const [dedupBankMsg, setDedupBankMsg] = useState('');
  const [purgeMsg, setPurgeMsg] = useState('');
  const [waSavedMsg, setWaSavedMsg] = useState('');
  const [suffixSavedMsg, setSuffixSavedMsg] = useState(false);
  const [salesEditMsg, setSalesEditMsg] = useState('');

  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message?: string;
    details?: React.ReactNode;
    confirmText?: string;
    cancelText?: string;
    variant?: 'danger' | 'warning' | 'primary' | 'success';
    onConfirm: () => void | Promise<void>;
  }>({
    isOpen: false,
    title: '',
    onConfirm: () => {},
  });
  const [confirmLoading, setConfirmLoading] = useState(false);

  function requestConfirm(options: {
    title: string;
    message?: string;
    details?: React.ReactNode;
    confirmText?: string;
    cancelText?: string;
    variant?: 'danger' | 'warning' | 'primary' | 'success';
    onConfirm: () => void | Promise<void>;
  }) {
    setConfirmDialog({
      ...options,
      isOpen: true,
    });
  }

  async function handleConfirmModal() {
    setConfirmLoading(true);
    try {
      await confirmDialog.onConfirm();
      setConfirmDialog(prev => ({ ...prev, isOpen: false }));
    } catch (e) {
      console.error(e);
    } finally {
      setConfirmLoading(false);
    }
  }

  const allAvailableBankNames = useMemo(() => {
    const list = getAllUniqueBankNames();
    // Also merge any currently loaded banks
    const set = new Set(list);
    for (const b of banks) {
      if (b.name) set.add(b.name.trim().toUpperCase());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [banks]);

  const effectiveBankMergeTo = (bankMergeTo === '__custom__' ? bankMergeCustomTo : bankMergeTo).trim().toUpperCase();

  const fromBankBillCount = useMemo(() => {
    if (!bankMergeFrom) return 0;
    const f = bankMergeFrom.trim().toUpperCase();
    const currentBills = getBills();
    let count = 0;
    for (const b of currentBills) {
      const isBankMatch = (b.bankName || '').trim().toUpperCase() === f;
      const hasPartMatch = Array.isArray(b.partPayments) && b.partPayments.some(p => (p.bankName || '').trim().toUpperCase() === f);
      if (isBankMatch || hasPartMatch) count++;
    }
    return count;
  }, [bankMergeFrom]);

  useEffect(() => {
    const today = getTodayISO();
    if (sessionStorage.getItem('admin_config_unlocked_date') === today) setUnlocked(true);
    setFontZoom(localStorage.getItem('vitratrack_font_zoom') || '1');
    setCommissionMocs(getCommissionMocs());
    setSearchResetSec(getBillSearchAutoResetSec());
  }, []);

  useEffect(() => {
    if (unlocked) {
      setDrivers(getDrivers());
      setBanks(getBanks());
      setCommissionMocs(getCommissionMocs());
      setWaTemplates(getWhatsAppTemplates());
      setWaBulkEnabled(getWABulkSendEnabled());
      setPwSuffix(getPwSuffix());
      setSearchResetSec(getBillSearchAutoResetSec());
    }
  }, [unlocked]);

  // Scroll to hashed section (e.g. #bills-report-update from driver page shortcut)
  useEffect(() => {
    if (window.location.hash) {
      const id = window.location.hash.slice(1);
      setTimeout(() => {
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 500);
    }
  }, []);

  // Load cached Leveredge raw buffer and info from IndexedDB / localStorage
  useEffect(() => {
    (async () => {
      try {
        const savedBuf = await idbGet<ArrayBuffer>('vt_leveredge_raw_buffer');
        if (savedBuf) {
          leveredgeRawBufferRef.current = savedBuf;
        }
        const savedName = (await idbGet<string>('vt_leveredge_filename')) || localStorage.getItem('vitratrack_leveredge_filename') || '';
        if (savedName) {
          setLeveredgeFileName(savedName);
        }
        const savedRows = localStorage.getItem('vitratrack_leveredge_rows');
        if (savedRows) {
          const parsed = JSON.parse(savedRows);
          if (Array.isArray(parsed)) setLeveredgeRows(parsed);
        }
        const savedSheets = localStorage.getItem('vitratrack_leveredge_sheet_names');
        if (savedSheets) {
          const parsed = JSON.parse(savedSheets);
          if (Array.isArray(parsed) && parsed.length > 0) setLeveredgeSheetNames(parsed);
        }
      } catch (e) {
        console.error('Error loading cached leveredge info:', e);
      }
    })();
  }, []);

  async function handleLeveredgeUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setLeveredgeResult({ status: 'loading', message: `Reading Leveredge Collection file '${file.name}'...` });
    e.target.value = '';
    try {
      const XLSX = await import('xlsx');
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const dataBuffer = evt.target?.result as ArrayBuffer;
          if (!dataBuffer) {
            setLeveredgeResult({ status: 'error', message: 'Could not read file buffer.' });
            return;
          }

          // Save the exact original raw ArrayBuffer into IndexedDB and ref
          await idbSet('vt_leveredge_raw_buffer', dataBuffer);
          await idbSet('vt_leveredge_filename', file.name);
          leveredgeRawBufferRef.current = dataBuffer;
          setLeveredgeFileName(file.name);

          // Read workbook preserving all formatting, fonts, types, NF, styles
          const data = new Uint8Array(dataBuffer);
          const wb = XLSX.read(data, { type: 'array', cellStyles: true, cellNF: true, cellDates: false, dense: false });
          const sNames = wb.SheetNames || [];
          const mainSheetName = sNames[0] || 'Collection';
          const ws = wb.Sheets[mainSheetName];
          if (!ws || !ws['!ref']) {
            setLeveredgeResult({ status: 'error', message: 'First sheet in file is empty or unreadable.' });
            return;
          }

          const range = XLSX.utils.decode_range(ws['!ref']);
          // Detect header row (row 0 to 15)
          let headerRow = -1;
          let billNoCol = -1;
          for (let r = range.s.r; r <= Math.min(range.e.r, 15); r++) {
            for (let c = range.s.c; c <= range.e.c; c++) {
              const cell = ws[XLSX.utils.encode_cell({ r, c })];
              if (cell && cell.v != null) {
                const str = String(cell.v).trim().toLowerCase().replace(/[\s_\-\/\.]+/g, '');
                if (str === 'billno' || str === 'billnumber' || str === 'invoiceno' || str === 'invno') {
                  headerRow = r;
                  billNoCol = c;
                  break;
                }
              }
            }
            if (headerRow !== -1) break;
          }

          if (headerRow === -1 || billNoCol === -1) {
            setLeveredgeResult({
              status: 'error',
              message: 'Missing "Bill No" column in uploaded file. Please ensure column names match Leveredge Collection format.'
            });
            return;
          }

          // Count valid bill rows in file
          const loadedBills: string[] = [];
          for (let r = headerRow + 1; r <= range.e.r; r++) {
            const cell = ws[XLSX.utils.encode_cell({ r, c: billNoCol })];
            if (cell && cell.v != null) {
              const val = String(cell.v).trim();
              if (val && !isSummaryRow(val)) {
                loadedBills.push(val);
              }
            }
          }

          setLeveredgeRows(loadedBills);
          setLeveredgeSheetNames(sNames);

          try {
            localStorage.setItem('vitratrack_leveredge_filename', file.name);
            localStorage.setItem('vitratrack_leveredge_rows', JSON.stringify(loadedBills));
            localStorage.setItem('vitratrack_leveredge_sheet_names', JSON.stringify(sNames));
          } catch (e) {}

          setLeveredgeResult({
            status: 'success',
            message: `LEVEREDGE COLLECTION file uploaded successfully! (${loadedBills.length} bills loaded from '${file.name}', ${sNames.length} sheets preserved with original formats and fonts).`
          });
        } catch (err: any) {
          setLeveredgeResult({ status: 'error', message: `Parse error: ${err?.message || 'Unknown error'}` });
        }
      };
      reader.readAsArrayBuffer(file);
    } catch (err: any) {
      setLeveredgeResult({ status: 'error', message: `File read error: ${err?.message || 'Unknown error'}` });
    }
  }

  async function handleLeveredgeDownload() {
    setLeveredgeResult({ status: 'loading', message: 'Updating original Leveredge Collection XLS with received payment entries...' });
    try {
      const XLSX = await import('xlsx');
      const { apiFetchAllData } = await import('@/lib/apiSync');

      // 1. Get raw uploaded file buffer
      let rawBuffer = leveredgeRawBufferRef.current;
      if (!rawBuffer) {
        rawBuffer = await idbGet<ArrayBuffer>('vt_leveredge_raw_buffer');
        if (rawBuffer) leveredgeRawBufferRef.current = rawBuffer;
      }

      if (!rawBuffer) {
        setLeveredgeResult({
          status: 'error',
          message: 'Pehle "UPLOAD XLS" par click karke Leveredge Collection file upload karein. Usi file me app ke received payments exact format aur font ke sath add hoke download honge.'
        });
        return;
      }

      // 2. Fetch all bills
      let allBills = getBills();
      try {
        const serverData = await apiFetchAllData();
        if (serverData.bills && serverData.bills.length > 0) {
          allBills = serverData.bills;
        }
      } catch (e) {
        console.warn('Using local bills for Leveredge download:', e);
      }

      const billMap = new Map<string, Bill>();
      allBills.forEach(b => {
        if (b.billNo) billMap.set(b.billNo.trim().toUpperCase(), b);
      });

      function isReceived(b: Bill): boolean {
        const mode = (b.paymentMode || '').toLowerCase();
        const collAmt = Number(b.collectedAmount) || 0;
        const cashAmt = Number(b.cashAmount) || 0;
        const upiAmt  = Number(b.upiAmount) || 0;
        const chqAmt  = Number(b.chequeAmount) || 0;
        return mode === 'paid' || mode === 'received' || collAmt > 0 || (cashAmt + upiAmt + chqAmt > 0) || !!b.paymentDate;
      }

      // 3. Read the original uploaded file with 100% cell styles and formatting intact
      const data = new Uint8Array(rawBuffer);
      const wb = XLSX.read(data, {
        type: 'array',
        cellStyles: true,
        cellNF: true,
        cellDates: false,
        dense: false
      });

      const sNames = wb.SheetNames || [];
      const mainSheetName = sNames[0] || 'Collection';
      const ws = wb.Sheets[mainSheetName];
      if (!ws || !ws['!ref']) {
        setLeveredgeResult({ status: 'error', message: 'Main collection sheet is empty or corrupted.' });
        return;
      }

      const range = XLSX.utils.decode_range(ws['!ref']);

      // Detect header row (row 0 to 15) and column positions
      let headerRow = -1;
      const colMap: Record<string, number> = {};

      for (let r = range.s.r; r <= Math.min(range.e.r, 15); r++) {
        let matchedCols = 0;
        const tempMap: Record<string, number> = {};
        for (let c = range.s.c; c <= range.e.c; c++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })];
          if (cell && cell.v != null) {
            const rawStr = String(cell.v).trim().toLowerCase();
            const norm = rawStr.replace(/[\s_\-\/\.]+/g, '');

            if (norm === 'billno' || norm === 'billnumber' || norm === 'invoiceno' || norm === 'invno') {
              tempMap['billNo'] = c; matchedCols++;
            } else if (norm === 'billdate' || norm === 'invoicedate' || norm === 'invdate') {
              tempMap['billDate'] = c; matchedCols++;
            } else if (norm === 'retailername' || norm === 'partyname' || norm === 'customername' || norm === 'retailer') {
              tempMap['retailerName'] = c; matchedCols++;
            } else if (norm === 'billamount' || norm === 'billamt' || norm === 'billnetamt' || norm === 'netamount' || norm === 'invoiceamount') {
              tempMap['billAmount'] = c; matchedCols++;
            } else if (norm === 'osamount' || norm === 'osamt' || norm === 'outstanding' || norm === 'outstandingamount') {
              tempMap['osAmount'] = c; matchedCols++;
            } else if (norm === 'discount' || norm === 'disc' || norm === 'schemedisc') {
              tempMap['discount'] = c; matchedCols++;
            } else if (norm === 'cnadj' || norm === 'cnamount' || norm === 'cnamt' || norm === 'creditnoteadj' || norm === 'linecut' || norm === 'linecutamt') {
              tempMap['cnAdj'] = c; matchedCols++;
            } else if (norm === 'dnadj' || norm === 'dnamount' || norm === 'dnamt' || norm === 'debitnoteadj') {
              tempMap['dnAdj'] = c; matchedCols++;
            } else if (norm === 'collectiondate' || norm === 'colldate' || norm === 'colldt' || norm === 'paymentdate' || norm === 'paydate' || norm === 'recdate' || norm === 'recdt') {
              tempMap['collectionDate'] = c; matchedCols++;
            } else if (norm === 'collectioncode' || norm === 'collcode' || norm === 'salesmancode' || norm === 'salespersoncode' || norm === 'smcode' || norm === 'smncode') {
              tempMap['collectionCode'] = c; matchedCols++;
            } else if (norm === 'mode' || norm === 'collectionmode' || norm === 'collmode' || norm === 'paymentmode' || norm === 'paymode') {
              tempMap['mode'] = c; matchedCols++;
            } else if (norm === 'retailerbankname' || norm === 'bankname' || norm === 'retailerbank' || norm === 'bank') {
              tempMap['retailerBankName'] = c; matchedCols++;
            } else if (norm === 'chqdddate' || norm === 'chqdate' || norm === 'chequedate' || norm === 'dddate' || norm === 'chqdt' || norm === 'chequedt') {
              tempMap['chqDate'] = c; matchedCols++;
            } else if (norm === 'chqddno' || norm === 'chqno' || norm === 'chequeno' || norm === 'ddno' || norm === 'chequenumber') {
              tempMap['chqNo'] = c; matchedCols++;
            } else if (norm === 'amount' || norm === 'collamount' || norm === 'collectedamount' || norm === 'recamount' || norm === 'collamt' || norm === 'recamt' || norm === 'paidamt') {
              tempMap['amount'] = c; matchedCols++;
            }
          }
        }
        if (tempMap['billNo'] !== undefined && matchedCols >= 3) {
          headerRow = r;
          Object.assign(colMap, tempMap);
          break;
        }
      }

      if (headerRow === -1 || colMap['billNo'] === undefined) {
        setLeveredgeResult({
          status: 'error',
          message: 'Header row with "Bill No" column could not be located in the uploaded file.'
        });
        return;
      }

      // Check date separator from the file (/ or -) to preserve exact date string format
      let sampleDateSeparator = '/';
      for (let r = headerRow + 1; r <= Math.min(range.e.r, headerRow + 20); r++) {
        const dateC = colMap['billDate'] ?? colMap['collectionDate'];
        if (dateC !== undefined) {
          const cCell = ws[XLSX.utils.encode_cell({ r, c: dateC })];
          if (cCell && cCell.v) {
            const sVal = String(cCell.v);
            if (sVal.includes('-')) sampleDateSeparator = '-';
            else if (sVal.includes('/')) sampleDateSeparator = '/';
            break;
          }
        }
      }

      const todayStr = (() => {
        const now = new Date();
        const d = String(now.getDate()).padStart(2, '0');
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const y = now.getFullYear();
        return sampleDateSeparator === '-' ? `${d}-${m}-${y}` : `${d}/${m}/${y}`;
      })();

      function formatDateForLeveredge(rawDate: any): string {
        if (!rawDate) return '';
        const norm = normDateStr(rawDate) || excelSerialToDate(rawDate);
        if (!norm) return String(rawDate).trim();
        if (sampleDateSeparator === '-') {
          return norm.replace(/\//g, '-');
        }
        return norm.replace(/-/g, '/');
      }

      // Helper to update a cell safely without losing font, style, borders, or alignment
      function updateCellPreservingFormat(
        targetWs: any,
        r: number,
        c: number,
        val: any,
        defaultType: 's' | 'n',
        sampleCell?: any
      ) {
        const cellAddress = XLSX.utils.encode_cell({ r, c });
        let cell = targetWs[cellAddress];
        if (!cell) {
          cell = {
            t: defaultType,
            v: val,
            s: sampleCell?.s,
            z: sampleCell?.z || (defaultType === 'n' ? '0.00' : undefined)
          };
          targetWs[cellAddress] = cell;
        } else {
          cell.v = val;
          cell.t = defaultType;
          if (defaultType === 'n' && !cell.z) {
            cell.z = '0.00';
          }
          delete cell.w; // force recalculation of display text matching format
        }
      }

      let totalBillsInFile = 0;
      let updatedCount = 0;
      const collectedChequeBanks = new Set<string>();

      // 4. Update each row in ws cell-by-cell in-place
      for (let r = headerRow + 1; r <= range.e.r; r++) {
        const billNoCell = ws[XLSX.utils.encode_cell({ r, c: colMap['billNo'] })];
        if (!billNoCell || billNoCell.v == null || String(billNoCell.v).trim() === '') continue;
        const rawBillNo = String(billNoCell.v).trim();
        if (isSummaryRow(rawBillNo)) continue;

        totalBillsInFile++;
        const b = billMap.get(rawBillNo.toUpperCase());

        if (b && isReceived(b)) {
          const cash = Number(b.cashAmount) || 0;
          const upi  = Number(b.upiAmount) || 0;
          const chq  = Number(b.chequeAmount) || 0;
          let mode = 'Cash';
          const methodLower = (b.paymentMethod || '').toLowerCase();
          if (chq > 0 || methodLower.includes('cheque') || methodLower.includes('chq') || b.chequeNo) {
            mode = 'Cheque/DD';
          } else if (upi > 0 || methodLower.includes('upi') || methodLower.includes('gpay') || methodLower.includes('online')) {
            mode = 'Gpay';
          } else {
            mode = 'Cash';
          }

          const recAmt = Number(b.collectedAmount) || (cash + upi + chq) || (Number(b.billNetAmt || 0) - Number(b.lineCutAmt || 0));
          const collDate = formatDateForLeveredge(b.paymentDate || b.deliveryDate || todayStr);
          const collCode = (b.collectionCode && String(b.collectionCode).trim()) || 'SMN00011';
          const bankName = mode === 'Cheque/DD' ? (b.bankName || '').trim() : '';
          const chqDate = mode === 'Cheque/DD' ? formatDateForLeveredge(b.chequeDate) : '';
          const chqNo = mode === 'Cheque/DD' ? String(b.chequeNo || '').trim() : '';
          const cnAdj = Number(b.lineCutAmt) > 0 ? Number(b.lineCutAmt) : null;

          // Sample cell for inheriting styles
          const sampleCell = (c: number) => ws[XLSX.utils.encode_cell({ r: headerRow + 1, c })] || ws[XLSX.utils.encode_cell({ r: headerRow, c })];

          // Collection Date
          if (colMap['collectionDate'] !== undefined) {
            const c = colMap['collectionDate'];
            updateCellPreservingFormat(ws, r, c, collDate, 's', sampleCell(c));
          }

          // Collection Code
          if (colMap['collectionCode'] !== undefined) {
            const c = colMap['collectionCode'];
            updateCellPreservingFormat(ws, r, c, collCode, 's', sampleCell(c));
          }

          // Mode
          if (colMap['mode'] !== undefined) {
            const c = colMap['mode'];
            updateCellPreservingFormat(ws, r, c, mode, 's', sampleCell(c));
          }

          // Retailer Bank Name
          if (colMap['retailerBankName'] !== undefined) {
            const c = colMap['retailerBankName'];
            updateCellPreservingFormat(ws, r, c, bankName, 's', sampleCell(c));
          }

          // Chq/DD Date
          if (colMap['chqDate'] !== undefined) {
            const c = colMap['chqDate'];
            updateCellPreservingFormat(ws, r, c, chqDate, 's', sampleCell(c));
          }

          // Chq/DD No
          if (colMap['chqNo'] !== undefined) {
            const c = colMap['chqNo'];
            updateCellPreservingFormat(ws, r, c, chqNo, 's', sampleCell(c));
          }

          // Amount (numeric)
          if (colMap['amount'] !== undefined) {
            const c = colMap['amount'];
            const numVal = Number(recAmt.toFixed(2));
            updateCellPreservingFormat(ws, r, c, numVal, 'n', sampleCell(c));
          }

          // CN Adj (Credit Note / Line Cut)
          if (cnAdj !== null && colMap['cnAdj'] !== undefined) {
            const c = colMap['cnAdj'];
            const numVal = Number(cnAdj.toFixed(2));
            updateCellPreservingFormat(ws, r, c, numVal, 'n', sampleCell(c));
          }

          updatedCount++;
          if (bankName) collectedChequeBanks.add(bankName);
        }
      }

      // 5. Update Sheet 2: Retailer Bank (if present)
      if (sNames.length > 1 && wb.Sheets[sNames[1]]) {
        const ws2 = wb.Sheets[sNames[1]];
        if (ws2 && ws2['!ref']) {
          const range2 = XLSX.utils.decode_range(ws2['!ref']);
          const existingBanks = new Set<string>();
          for (let r = range2.s.r + 1; r <= range2.e.r; r++) {
            const cell = ws2[XLSX.utils.encode_cell({ r, c: 0 })];
            if (cell && cell.v != null) {
              const bName = String(cell.v).trim();
              if (bName) existingBanks.add(bName.toLowerCase());
            }
          }

          let nextRow = range2.e.r + 1;
          const sampleCell2 = ws2[XLSX.utils.encode_cell({ r: 1, c: 0 })] || ws2[XLSX.utils.encode_cell({ r: 0, c: 0 })];
          for (const bk of collectedChequeBanks) {
            if (!existingBanks.has(bk.toLowerCase())) {
              const cellAddress = XLSX.utils.encode_cell({ r: nextRow, c: 0 });
              ws2[cellAddress] = {
                t: 's',
                v: bk,
                s: sampleCell2?.s,
                z: sampleCell2?.z
              };
              existingBanks.add(bk.toLowerCase());
              nextRow++;
            }
          }
          range2.e.r = Math.max(range2.e.r, nextRow - 1);
          ws2['!ref'] = XLSX.utils.encode_range(range2);
        }
      }

      // 6. Update Sheet 3: Collection Mode (Ensure Gpay at Row 7 if present)
      if (sNames.length > 2 && wb.Sheets[sNames[2]]) {
        const ws3 = wb.Sheets[sNames[2]];
        if (ws3) {
          const cellGpay = ws3['A7'];
          if (!cellGpay || !cellGpay.v || String(cellGpay.v).trim().toLowerCase() !== 'gpay') {
            const sampleCell3 = ws3['A2'] || ws3['A1'];
            ws3['A7'] = { t: 's', v: 'Gpay', s: sampleCell3?.s, z: sampleCell3?.z };
            if (ws3['!ref']) {
              const range3 = XLSX.utils.decode_range(ws3['!ref']);
              range3.e.r = Math.max(range3.e.r, 6);
              ws3['!ref'] = XLSX.utils.encode_range(range3);
            }
          }
        }
      }

      // 7. Write out the exact workbook with all cellStyles, formats, fonts intact
      const downloadFileName = leveredgeFileName
        ? `${leveredgeFileName.replace(/\.[^/.]+$/, '')}_Updated_${getStamp()}.xlsx`
        : `Leveredge_Collection_Received_${getStamp()}.xlsx`;

      downloadWb(XLSX, wb, downloadFileName);

      setLeveredgeResult({
        status: 'success',
        message: `Leveredge Collection XLS downloaded successfully! (${updatedCount} received bills payment entries added into uploaded file out of ${totalBillsInFile} bills, with same font, format, and structure).`
      });
    } catch (err: any) {
      setLeveredgeResult({ status: 'error', message: `Download error: ${err?.message || 'Unknown error'}` });
    }
  }

  async function downloadSample(type: 'party' | 'sales') {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();

    if (type === 'party') {
      const ws = XLSX.utils.aoa_to_sheet([
        ['PARTY CODE', 'PARTY NAME', 'ADDRESS'],
        ['P001', 'ABC TRADERS', 'Main Road, Surat PH : 9876543210'],
        ['P002', 'XYZ STORES', 'Market Road, Surat PH : 9123456789'],
      ]);
      ws['!cols'] = [14, 28, 48].map(w=>({wch:w}));
      XLSX.utils.book_append_sheet(wb, ws, 'Party Contacts');
      XLSX.writeFile(wb, 'Sample_Party_Master_Contacts.xlsx');
    } else if (type === 'sales') {
      const ws = XLSX.utils.aoa_to_sheet([
        ['Salesperson Name', 'Mobile No'],
        ['RAHUL SHARMA', '9876543210'],
        ['AMIT VERMA', '9123456789'],
      ]);
      ws['!cols'] = [22, 14].map(w=>({wch:w}));
      XLSX.utils.book_append_sheet(wb, ws, 'Salesperson Contacts');
      XLSX.writeFile(wb, 'Sample_Salesperson_Contacts.xlsx');
    }
  }

  async function handleLedgerFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setLedgerResult({ status: 'loading', message: 'Reading file...' }); e.target.value = '';
    try {
      const XLSX = await import('xlsx');
      // Always fetch latest bills from server before processing
      // so dedup check is accurate even if in-memory store hasn't fully loaded
      setLedgerResult({ status: 'loading', message: 'Checking existing bills...' });
      const { apiFetchAllData: freshFetch } = await import('@/lib/apiSync');
      const freshData = await freshFetch();
      const currentBillNosFromServer = new Set(freshData.bills.map((b: { billNo: string }) => b.billNo));
      // Merge with in-memory store (in case store has bills not yet pushed)
      const memBills = getBills();
      for (const b of memBills) currentBillNosFromServer.add(b.billNo);

      setLedgerResult({ status: 'loading', message: 'Processing...' });
      const reader = new FileReader();
      reader.onload = (evt) => {
        setTimeout(async () => {
          try {
            const dataBuffer = evt.target?.result;
            if (!dataBuffer) { setLedgerResult({ status: 'error', message: 'Could not read file.' }); return; }
            const data = new Uint8Array(dataBuffer as ArrayBuffer);
            const wb = XLSX.read(data, { type: 'array', dense: false, cellStyles: false, cellNF: false, cellFormula: false });
            const ws = wb.Sheets[wb.SheetNames[0]];
            if (!ws['!ref']) { setLedgerResult({ status: 'error', message: 'Sheet is empty or unreadable.' }); return; }

            let headerRow = -1;
            for (let r = 0; r <= 20; r++) {
              const cell = ws[XLSX.utils.encode_cell({ r, c: 0 })];
              if (cell && String(cell.v).toLowerCase().includes('sr no')) { headerRow = r; break; }
            }
            if (headerRow === -1) headerRow = 0;

            const jsonRows: any[] = XLSX.utils.sheet_to_json(ws, { range: headerRow, defval: '', raw: true });

            // Build a COMPLETE bill map: start with all server-fresh bills,
            // then overlay in-memory bills (memory may have unsaved new data).
            // This ensures bills that exist on server but haven't loaded into
            // memory yet still get updated properly instead of being skipped.
            const currentBillMap = new Map<string, Bill>(
              freshData.bills.map((b: Bill) => [b.billNo, b])
            );
            const currentBills = getBills();
            for (const b of currentBills) {
              currentBillMap.set(b.billNo, b);
              currentBillNosFromServer.add(b.billNo);
            }
            const seenInBatch = new Set<string>(); // prevent duplicates within the same file
            const newBills: Bill[] = [];
            const skipped: string[] = [];   // already exists → fully skipped (no update)
            const noKey: string[] = [];

            // Build list of known SP names for 60% similarity dedup
            const existingSpNamesLedger = Array.from(new Set([
              ...getSalespersonContacts().map(c => c.name).filter(Boolean),
              ...Array.from(currentBillMap.values()).map(b => b.salespersonName).filter(Boolean),
            ])) as string[];

            // Known standard column names (case variants) — everything else is kept as-is
            const KNOWN_COLS = new Set([
              'Sr No','SR NO','sr no','S No','S.No','S.NO',
              'Date','DATE','date',
              'Salesperson Name','SALESPERSON NAME','salesperson name',
              'Collection Code','COLLECTION CODE','collection code',
              'Bill No','BILL NO','bill no','Bill no','BILLNO',
              'Party Code','PARTY CODE','party code',
              'Party HUL Code','PARTY HUL CODE','party hul code',
              'Party Name','PARTY NAME','party name',
              'Beat Name','BEAT NAME','beat name',
              'Bill Net Amt','BILL NET AMT','bill net amt','Bill Net Amount','Bill Net Amt.',
              'Collected Amount','COLLECTED AMOUNT','collected amount',
              'Outstanding Amount','OUTSTANDING AMOUNT','outstanding amount',
              'Bill Ageing (In Days)','BILL AGEING (IN DAYS)','bill ageing (in days)','Bill Ageing','BILL AGEING','Bill Ageing(In Days)',
            ]);

            for (const row of jsonRows) {
              const bn = String(row['Bill No'] || row['bill no'] || row['BILL NO'] || '').trim();
              if (!bn) { noKey.push(`Row ${JSON.stringify(row).slice(0, 40)}`); continue; }
              if (isSummaryRow(bn)) continue;
              if (seenInBatch.has(bn)) { skipped.push(bn); continue; }
              seenInBatch.add(bn);

              // Collect ALL extra columns from the XLS (anything beyond the 13 standard ones)
              const extraCols: Record<string, unknown> = {};
              for (const [k, v] of Object.entries(row)) {
                if (!KNOWN_COLS.has(k)) extraCols[k] = v;
              }

              const xlsBillData = {
                ...extraCols,
                srNo: String(row['Sr No'] || row['SR NO'] || ''),
                date: excelSerialToDate(row['Date'] || row['DATE']),
                salespersonName: findCanonicalName(
                cleanSalespersonName(row['Salesperson Name'] || ''),
                existingSpNamesLedger,
                cleanSalespersonName,
                0.60
              ),
                collectionCode: String(row['Collection Code'] || ''),
                billNo: bn,
                partyCode: String(row['Party Code'] || ''),
                partyHulCode: String(row['Party HUL Code'] || ''),
                partyName: cleanPartyName(row['Party Name'] || ''),
                beatName: String(row['Beat Name'] || ''),
                billNetAmt: Number(row['Bill Net Amt'] ?? row['Bill Net Amt.'] ?? row['Bill Net Amount']) || 0,
                collectedAmount: Number(row['Collected Amount']) || 0,
                outstandingAmount: Number(row['Outstanding Amount']) || 0,
                billAgeing: Number(row['Bill Ageing (In Days)'] ?? row['Bill Ageing'] ?? row['Bill Ageing(In Days)']) || 0,
              };

              const existingBill = currentBillMap.get(bn);
              const onServer = currentBillNosFromServer.has(bn);

              if (existingBill || onServer) {
                // Bill already exists — skip completely, no update
                skipped.push(bn);
                continue;
              }
              // Brand new bill — add only
              newBills.push({ ...xlsBillData, id: Math.random().toString(36).substr(2, 9) } as unknown as Bill);
            }

            if (newBills.length === 0 && jsonRows.length > 0) {
              setLedgerResult({
                status: 'error',
                message: `Koi naya bill nahi mila. ${skipped.length} bills already exist (skipped). ${noKey.length} rows mein Bill No nahi tha.`,
                details: skipped.length > 0 ? [`Already exist (skipped): ${skipped.slice(0,15).join(', ')}${skipped.length>15?'…':''}`] : undefined,
              });
              return;
            }

            const details: string[] = [];
            if (newBills.length)  details.push(`Naye bills add: ${newBills.length}`);
            if (skipped.length)   details.push(`Already exist (skipped): ${skipped.length}`);
            if (noKey.length)     details.push(`Bill No nahi (skip): ${noKey.length}`);

            if (newBills.length > 0) {
              addBillsToMemoryOnly(newBills);
              setLedgerResult({ status: 'loading', message: `Server me save ho raha hai... 0 / ${newBills.length}` });
              const { apiBulkInsertWithProgress } = await import('@/lib/apiSync');
              await apiBulkInsertWithProgress(newBills, (saved) => {
                setLedgerResult({ status: 'loading', message: `Server me save ho raha hai... ${saved} / ${newBills.length}` });
              });
              setLedgerResult({ status: 'success', message: `${newBills.length} naye add · ${skipped.length} skip (already exist)`, details });
            }
          } catch (err: any) {
            setLedgerResult({ status: 'error', message: `Parse error: ${err?.message || 'Unknown error'}. Check file format — download sample for reference.` });
          }
        }, 0);
      };
      reader.readAsArrayBuffer(file);
    } catch (err: any) {
      setLedgerResult({ status: 'error', message: `Could not open file: ${err?.message || 'Unknown error'}` });
    }
  }

  async function handleRecPaymentFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setRecPaymentResult({ status: 'loading', message: 'Processing...' }); e.target.value = '';
    try {
      const XLSX = await import('xlsx');
      const reader = new FileReader();
      reader.onload = (evt) => {
        setTimeout(() => {
          try {
            const dataBuffer = evt.target?.result;
            if (!dataBuffer) { setRecPaymentResult({ status: 'error', message: 'Could not read file.' }); return; }
            const data = new Uint8Array(dataBuffer as ArrayBuffer);
            const wb = XLSX.read(data, { type: 'array', dense: false, cellStyles: false, cellNF: false, cellFormula: false });
            const ws = wb.Sheets[wb.SheetNames[0]];
            if (!ws['!ref']) { setRecPaymentResult({ status: 'error', message: 'Sheet is empty or unreadable.' }); return; }

            const jsonRows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });

            if (jsonRows.length === 0) {
              setRecPaymentResult({ status: 'error', message: 'No data rows found. Check that the file has a header row matching the sample format.' });
              return;
            }

            // Check required columns
            const firstRow = jsonRows[0];
            const hasBillNo = 'Bill No' in firstRow;
            const hasAmount = 'Amount' in firstRow;
            const hasMode = 'Mode' in firstRow;
            if (!hasBillNo || !hasAmount || !hasMode) {
              const missing = [!hasBillNo && 'Bill No', !hasAmount && 'Amount', !hasMode && 'Mode'].filter(Boolean);
              setRecPaymentResult({ status: 'error', message: `Missing required columns: ${missing.join(', ')}. Download the sample file to see the correct format.` });
              return;
            }

            // Known rec payment columns — any extras will be merged onto the bill
            const KNOWN_REC_COLS = new Set([
              'Bill No','bill no','BILL NO',
              'Bill Date','Bill date','BILL DATE',
              'Retailer Name','retailer name','RETAILER NAME',
              'Driver','driver','DRIVER',
              'Bill Amount','bill amount','BILL AMOUNT',
              'O/S Amount','o/s amount','OS Amount','os amount',
              'Discount','discount','DISCOUNT',
              'CN Adj','cn adj','CN ADJ','CnAdj',
              'DN Adj','dn adj','DN ADJ','DnAdj',
              'Collection Date','collection date','COLLECTION DATE',
              'Mode','mode','MODE',
              'Retailer Bank Name','retailer bank name','RETAILER BANK NAME',
              'Chq/DD Date','chq/dd date','CHQ/DD DATE','Cheque Date',
              'Chq/DD No','chq/dd no','CHQ/DD NO','Cheque No',
              'Amount','amount','AMOUNT',
            ]);

            const allBills = getBills();
            const billMap = new Map<string, Bill>(allBills.map((b) => [b.billNo, b]));

            let settled = 0;
            const notFoundNos: string[] = [];
            const noKeyRows: number[] = [];
            const skippedAlreadyPaid: string[] = [];
            const skippedDuplicateInFile: string[] = [];
            const seenInBatch = new Set<string>(); // skip same bill no appearing twice in one file
            const patches: Array<{ billNo: string; patch: Partial<Bill> }> = [];

            for (let ri = 0; ri < jsonRows.length; ri++) {
              const row = jsonRows[ri];
              const billNo = String(row['Bill No'] || '').trim();
              if (!billNo) { noKeyRows.push(ri + 2); continue; }
              if (isSummaryRow(billNo)) continue;

              // Skip duplicate bill nos within the same file
              if (seenInBatch.has(billNo)) { skippedDuplicateInFile.push(billNo); continue; }
              seenInBatch.add(billNo);

              const existing = billMap.get(billNo);
              if (!existing) { notFoundNos.push(billNo); continue; }

              // Skip bills that already have any payment/delivery data recorded
              if (billHasPaymentData(existing)) { skippedAlreadyPaid.push(billNo); continue; }

              const amountRaw = String(row['Amount'] ?? '').trim();
              const amountRawLower = amountRaw.toLowerCase();
              const amount = Number(row['Amount']) || 0;
              const cnAdj = Number(row['CN Adj']) || 0;
              const modeRaw = String(row['Mode'] || '').toLowerCase().trim();
              const collectionDate = excelSerialToDate(row['Collection Date'] || '');
              const driverName = String(row['Driver'] || '').trim();
              const bankName = String(row['Retailer Bank Name'] || '').trim();
              const chequeNo = String(row['Chq/DD No'] || '').trim();
              const chequeDate = excelSerialToDate(row['Chq/DD Date'] || '');
              const billAmt = Number(row['Bill Amount']) || 0;
              const osAmount = Number(row['O/S Amount']) || 0;

              // Collect ALL extra columns beyond known rec payment columns
              const extraRecCols: Record<string, unknown> = {};
              for (const [k, v] of Object.entries(row)) {
                if (!KNOWN_REC_COLS.has(k) && v !== '' && v != null) extraRecCols[k] = v;
              }

              // Amount column contains "FBR" or "cancel" text → paymentMode = FBR
              if (amountRawLower === 'fbr' || amountRawLower.includes('fbr') || amountRawLower.includes('cancel')) {
                patches.push({ billNo, patch: {
                  ...extraRecCols,
                  paymentMode: 'FBR',
                  deliveryDate: existing.deliveryDate || collectionDate,
                  driverName: driverName || existing.driverName || '',
                  ...(cnAdj > 0 ? { lineCutAmt: cnAdj } : {}),
                  ...(billAmt > 0 ? { billNetAmt: billAmt } : {}),
                  ...(osAmount > 0 ? { outstandingAmount: osAmount } : {}),
                } as Partial<Bill>});
                settled++;
                continue;
              }

              // Amount column contains "CREDIT" text → paymentMode = Unpaid
              if (amountRawLower === 'credit' || amountRawLower.includes('credit')) {
                patches.push({ billNo, patch: {
                  ...extraRecCols,
                  paymentMode: 'Unpaid',
                  deliveryDate: existing.deliveryDate || collectionDate,
                  driverName: driverName || existing.driverName || '',
                  ...(cnAdj > 0 ? { lineCutAmt: cnAdj } : {}),
                  ...(billAmt > 0 ? { billNetAmt: billAmt } : {}),
                  ...(osAmount > 0 ? { outstandingAmount: osAmount } : {}),
                } as Partial<Bill>});
                settled++;
                continue;
              }

              if (modeRaw.includes('cancel') || modeRaw.includes('cansel') || modeRaw === 'c') {
                patches.push({ billNo, patch: {
                  ...extraRecCols,
                  paymentMode: 'FBR',
                  deliveryDate: existing.deliveryDate || collectionDate,
                  driverName: driverName || existing.driverName || '',
                  ...(cnAdj > 0 ? { lineCutAmt: cnAdj } : {}),
                  ...(billAmt > 0 ? { billNetAmt: billAmt } : {}),
                  ...(osAmount > 0 ? { outstandingAmount: osAmount } : {}),
                } as Partial<Bill>});
                settled++;
                continue;
              }

              if (modeRaw.includes('credit') || modeRaw.includes('del pending') || modeRaw.includes('del pend') || modeRaw === 'credit') {
                patches.push({ billNo, patch: {
                  ...extraRecCols,
                  paymentMode: 'Unpaid',
                  deliveryDate: existing.deliveryDate || collectionDate,
                  driverName: driverName || existing.driverName || '',
                  ...(cnAdj > 0 ? { lineCutAmt: cnAdj } : {}),
                  ...(billAmt > 0 ? { billNetAmt: billAmt } : {}),
                  ...(osAmount > 0 ? { outstandingAmount: osAmount } : {}),
                } as Partial<Bill>});
                settled++;
                continue;
              }

              // Skip rows with no actual payment amount
              if (amount <= 0) { notFoundNos.push(`(0 amt) ${billNo}`); continue; }

              // Determine paymentMethod (Cash/UPI/Cheque) — paymentMode is always 'Paid'
              let paymentMethod = 'Cash';
              let cashAmt = 0, upiAmt = 0, chequeAmt = 0;

              if (modeRaw.includes('chq') || modeRaw.includes('cheque') || modeRaw.includes('dd')) {
                paymentMethod = 'Cheque'; chequeAmt = amount;
              } else if (modeRaw.includes('upi') || modeRaw.includes('gpay') || modeRaw.includes('neft') || modeRaw.includes('online')) {
                paymentMethod = 'UPI'; upiAmt = amount;
              } else {
                paymentMethod = 'Cash'; cashAmt = amount;
              }

              patches.push({ billNo, patch: {
                ...extraRecCols,
                paymentMode: 'Paid',
                paymentMethod,
                collectedAmount: amount,
                driverName: driverName || existing.driverName || '',
                paymentDate: collectionDate,
                deliveryDate: existing.deliveryDate || collectionDate,
                chequeNo,
                chequeDate,
                bankName,
                cashAmount: cashAmt,
                upiAmount: upiAmt,
                chequeAmount: chequeAmt,
                ...(cnAdj > 0 ? { lineCutAmt: cnAdj } : {}),
                ...(billAmt > 0 ? { billNetAmt: billAmt } : {}),
                ...(osAmount > 0 ? { outstandingAmount: osAmount } : {}),
              } as Partial<Bill>});
              settled++;
            }

            if (patches.length > 0) patchBillsInMemory(patches);

            const details: string[] = [];
            if (skippedAlreadyPaid.length) details.push(`Already paid (skipped ${skippedAlreadyPaid.length}): ${skippedAlreadyPaid.slice(0,15).join(', ')}${skippedAlreadyPaid.length>15?` +${skippedAlreadyPaid.length-15} more`:''}`);
            if (notFoundNos.length) details.push(`Not in ledger (${notFoundNos.length}): ${notFoundNos.slice(0,15).join(', ')}${notFoundNos.length>15?` +${notFoundNos.length-15} more`:''}`);
            if (noKeyRows.length) details.push(`Rows with blank Bill No (row #): ${noKeyRows.slice(0,10).join(', ')}`);
            if (skippedDuplicateInFile.length) details.push(`Duplicate bill nos in file (skipped): ${skippedDuplicateInFile.slice(0,10).join(', ')}${skippedDuplicateInFile.length>10?` +${skippedDuplicateInFile.length-10} more`:''}`);

            if (settled === 0) {
              setRecPaymentResult({ status: 'error', message: `0 bills settled. ${notFoundNos.length} not in ledger, ${skippedAlreadyPaid.length} already paid.`, details });
            } else {
              setRecPaymentResult({ status: 'success', message: `${settled} bill${settled > 1 ? 's' : ''} settled successfully.`, details });
            }
          } catch (err: any) {
            setRecPaymentResult({ status: 'error', message: `Parse error: ${err?.message || 'Unknown error'}. Download the sample file to see the correct column format.` });
          }
        }, 0);
      };
      reader.readAsArrayBuffer(file);
    } catch (err: any) {
      setRecPaymentResult({ status: 'error', message: `Could not open file: ${err?.message || 'Unknown error'}` });
    }
  }

  async function handleCollectionSummaryFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setCollSummaryResult({ status: 'loading', message: 'Processing...' }); e.target.value = '';
    try {
      const XLSX = await import('xlsx');
      const reader = new FileReader();
      reader.onload = (evt) => {
        setTimeout(() => {
          try {
            const dataBuffer = evt.target?.result;
            if (!dataBuffer) { setCollSummaryResult({ status: 'error', message: 'Could not read file.' }); return; }
            const data = new Uint8Array(dataBuffer as ArrayBuffer);
            const wb = XLSX.read(data, { type: 'array', raw: false });
            const ws = wb.Sheets[wb.SheetNames[0]];
            if (!ws['!ref']) { setCollSummaryResult({ status: 'error', message: 'Sheet is empty.' }); return; }

            const jsonRows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
            if (jsonRows.length === 0) { setCollSummaryResult({ status: 'error', message: 'No data rows found.' }); return; }

            // ── Flexible column detection ─────────────────────────────────
            const keys = Object.keys(jsonRows[0]);
            const findCol = (...candidates: string[]) =>
              keys.find(k => candidates.some(c => k.trim().toLowerCase() === c.toLowerCase())) ?? null;

            const billNoCol  = findCol('Bill No', 'Bill No.', 'Doc No', 'Doc No.', 'Document No', 'BillNo', 'Bill Number', 'Inv No', 'Invoice No');
            const amtCol     = findCol('Coll Amt', 'Coll Amount', 'Collected Amt', 'Collected Amount', 'Amount', 'Collection Amount', 'Rec Amt', 'Rec Amount', 'Paid Amt');
            const modeCol    = findCol('Mode', 'Pay Mode', 'Payment Mode', 'Coll Mode', 'Collection Mode', 'Rec Mode');
            const dateCol    = findCol('Coll Date', 'Collection Date', 'Payment Date', 'Rec Date', 'Rec Dt', 'Coll Dt');

            if (!billNoCol) {
              setCollSummaryResult({ status: 'error', message: 'Bill No column not found. Expected: "Bill No", "Doc No", etc.', details: [`Columns found: ${keys.slice(0,12).join(', ')}`] });
              return;
            }
            if (!amtCol) {
              setCollSummaryResult({ status: 'error', message: 'Amount column not found. Expected: "Coll Amt", "Amount", etc.', details: [`Columns found: ${keys.slice(0,12).join(', ')}`] });
              return;
            }
            if (!modeCol) {
              setCollSummaryResult({ status: 'error', message: 'Mode column not found. Expected: "Mode" with values CSH/IMPS/CHQ.', details: [`Columns found: ${keys.slice(0,12).join(', ')}`] });
              return;
            }

            const allBills = getBills();
            // Build map: billNo → bill (also try stripped GST prefix)
            const billMap = new Map<string, Bill>();
            for (const b of allBills) {
              billMap.set(b.billNo.trim(), b);
              const stripped = b.billNo.replace(/^GST[-\/]?/i, '').trim();
              if (stripped !== b.billNo.trim()) billMap.set(stripped, b);
            }

            let settled = 0;
            const notFound: string[] = [];
            const skippedPaid: string[] = [];
            const skippedZero: string[] = [];
            const seenInBatch = new Set<string>();
            const patches: Array<{ billNo: string; patch: Partial<Bill> }> = [];

            for (const row of jsonRows) {
              const rawBillNo = String(row[billNoCol] || '').trim();
              if (!rawBillNo || isSummaryRow(rawBillNo)) continue;

              const existing = billMap.get(rawBillNo) ?? billMap.get(rawBillNo.replace(/^GST[-\/]?/i, '').trim());
              if (!existing) { notFound.push(rawBillNo); continue; }

              const billNo = existing.billNo;
              if (seenInBatch.has(billNo)) continue;
              seenInBatch.add(billNo);

              // Skip already-paid bills (any collected amount recorded)
              const alreadyPaid =
                (Number(existing.collectedAmount) || 0) > 0 ||
                (Number(existing.cashAmount) || 0) > 0 ||
                (Number(existing.upiAmount) || 0) > 0 ||
                (Number(existing.chequeAmount) || 0) > 0;
              if (alreadyPaid) { skippedPaid.push(billNo); continue; }

              const amount = Number(String(row[amtCol] || '').replace(/,/g, '')) || 0;
              if (amount <= 0) { skippedZero.push(rawBillNo); continue; }

              const modeRaw = String(row[modeCol] || '').trim().toUpperCase();
              let cashAmt = 0, upiAmt = 0, chequeAmt = 0, paymentMethod = 'Cash';

              if (modeRaw === 'CSH' || modeRaw === 'CASH') {
                cashAmt = amount; paymentMethod = 'Cash';
              } else if (modeRaw === 'IMPS' || modeRaw === 'UPI' || modeRaw === 'GPAY' || modeRaw === 'NEFT' || modeRaw === 'ONLINE') {
                upiAmt = amount; paymentMethod = 'UPI';
              } else if (modeRaw === 'CHQ' || modeRaw === 'CHEQUE' || modeRaw === 'DD' || modeRaw === 'CHQ/DD') {
                chequeAmt = amount; paymentMethod = 'Cheque';
              } else {
                // Unknown mode — treat as Cash
                cashAmt = amount; paymentMethod = 'Cash';
              }

              const collDate = dateCol ? excelSerialToDate(row[dateCol]) : '';

              patches.push({ billNo, patch: {
                paymentMode: 'Paid',
                paymentMethod,
                collectedAmount: amount,
                cashAmount: cashAmt,
                upiAmount: upiAmt,
                chequeAmount: chequeAmt,
                ...(collDate ? { paymentDate: collDate } : {}),
              } as Partial<Bill>});
              settled++;
            }

            if (patches.length > 0) patchBillsInMemory(patches);

            const details: string[] = [];
            if (skippedPaid.length) details.push(`Already paid — skipped (${skippedPaid.length}): ${skippedPaid.slice(0, 15).join(', ')}${skippedPaid.length > 15 ? ` +${skippedPaid.length - 15} more` : ''}`);
            if (notFound.length)    details.push(`Not in ledger (${notFound.length}): ${notFound.slice(0, 15).join(', ')}${notFound.length > 15 ? ` +${notFound.length - 15} more` : ''}`);
            if (skippedZero.length) details.push(`Zero-amount rows skipped (${skippedZero.length})`);

            if (settled === 0) {
              setCollSummaryResult({ status: 'error', message: `0 bills updated. ${notFound.length} not found, ${skippedPaid.length} already paid.`, details });
            } else {
              setCollSummaryResult({ status: 'success', message: `${settled} bill${settled > 1 ? 's' : ''} updated. CSH→Cash, IMPS→GPay, CHQ→Cheque.`, details });
            }
          } catch (err: any) {
            setCollSummaryResult({ status: 'error', message: `Parse error: ${err?.message || 'Unknown error'}` });
          }
        }, 0);
      };
      reader.readAsArrayBuffer(file);
    } catch (err: any) {
      setCollSummaryResult({ status: 'error', message: `Could not open file: ${err?.message || 'Unknown error'}` });
    }
  }

  async function handleBillsReportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    e.target.value = '';
    await processBillsReportFile(file, (status) => setBillsReportResult(status));
    return;
  }

  async function handleContactSync(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    e.target.value = '';
    setContactResult({ status: 'loading', message: 'Reading Party Master XLS...' });
    try {
      const XLSX = await import('xlsx');
      const data = new Uint8Array(await file.arrayBuffer());
      const wb = XLSX.read(data, { type: 'array', cellStyles: false, cellNF: false, cellFormula: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws?.['!ref']) { setContactResult({ status: 'error', message: 'Sheet is empty.' }); return; }

      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '', raw: true });
      if (rows.length === 0) {
        setContactResult({ status: 'error', message: 'No data rows found.' });
        return;
      }
      const keys = Object.keys(rows[0]);
      const findKey = (...patterns: RegExp[]) => keys.find(key => patterns.some(pattern => pattern.test(key)));
      const partyCodeKey = findKey(/^party\s*code$/i, /party\s*id/i);
      const partyNameKey = findKey(/^party\s*name$/i, /party\s*name/i);
      const addressKey = findKey(/^address$/i);
      if (!partyCodeKey || !partyNameKey || !addressKey) {
        setContactResult({
          status: 'error',
          message: `Required columns not found. Need PARTY CODE, PARTY NAME, ADDRESS. Found: ${keys.join(', ')}`,
        });
        return;
      }

      const extractMobile = (value: unknown): string => {
        const address = String(value ?? '');
        const phIndex = address.search(/\bph\b/i);
        if (phIndex < 0) return '';
        const afterPhone = address.slice(phIndex + 2);
        const digits = afterPhone.replace(/\D/g, '');
        return digits.length >= 10 ? digits.slice(-10) : '';
      };

      const incomingByCode = new Map<string, Contact>();
      const skipped: number[] = [];
      rows.forEach((row, index) => {
        const partyCode = String(row[partyCodeKey] ?? '').trim();
        const partyName = String(row[partyNameKey] ?? '').trim();
        const mobile = extractMobile(row[addressKey]);
        if (!partyCode || !partyName || !mobile) {
          skipped.push(index + 2);
          return;
        }
        // Party code is the stable identity. ADDRESS is intentionally not
        // stored; only the extracted 10-digit mobile is retained.
        incomingByCode.set(partyCode, {
          id: `party_${partyCode}`,
          name: partyName,
          mobile,
        });
      });

      if (incomingByCode.size === 0) {
        setContactResult({ status: 'error', message: 'No valid party rows with PH mobile numbers found.' });
        return;
      }

      setContactResult({ status: 'loading', message: `Supabase me ${incomingByCode.size} party contacts save ho rahe hain...` });
      const existing = getPartyContacts();
      const mergedMap = new Map<string, Contact>();
      for (const contact of existing) {
        const id = contact.id ? `id:${contact.id}` : `legacy:${contact.name.toLowerCase()}`;
        mergedMap.set(id, contact);
      }

      let added = 0;
      let updated = 0;
      for (const contact of incomingByCode.values()) {
        const stableKey = `id:${contact.id}`;
        const hadStableContact = mergedMap.has(stableKey);
        // Replace an old name-keyed party contact when its name matches the
        // Party Master row, preventing duplicate directory entries after the
        // first party-code-based upload.
        for (const [key, old] of mergedMap) {
          if (key.startsWith('legacy:') && old.name.trim().toLowerCase() === contact.name.trim().toLowerCase()) {
            mergedMap.delete(key);
          }
        }
        mergedMap.set(stableKey, contact);
        if (hadStableContact) updated++;
        else added++;
      }

      const merged = Array.from(mergedMap.values());
      const saved = await savePartyContacts(merged);
      if (!saved) {
        setContactResult({ status: 'error', message: 'Party contacts could not be saved to Supabase.' });
        return;
      }
      const details: string[] = [
        `Party code-wise upsert: ${incomingByCode.size}`,
        `Mobile saved from PH only; ADDRESS was not stored`,
      ];
      if (skipped.length) details.push(`Rows skipped (missing party code/name/PH mobile): ${skipped.length}`);
      setContactResult({ status: 'success', message: `${added} new + ${updated} updated party contacts (${merged.length} total).`, details });
    } catch (err: any) {
      setContactResult({ status: 'error', message: `Could not open file: ${err?.message || 'Unknown error'}` });
    }
  }

  async function handleSalespersonContactSync(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setSalesResult({ status: 'loading', message: 'Processing...' }); e.target.value = '';
    try {
      const XLSX = await import('xlsx');
      const reader = new FileReader();
      reader.onload = (evt) => {
        setTimeout(() => {
          try {
            const dataBuffer = evt.target?.result;
            if (!dataBuffer) { setSalesResult({ status: 'error', message: 'Could not read file.' }); return; }
            const data = new Uint8Array(dataBuffer as ArrayBuffer);
            const wb = XLSX.read(data, { type: 'array', cellStyles: false, cellNF: false, cellFormula: false });
            const ws = wb.Sheets[wb.SheetNames[0]];
            if (!ws['!ref']) { setSalesResult({ status: 'error', message: 'Sheet is empty.' }); return; }
            const range = XLSX.utils.decode_range(ws['!ref']!);
            const incoming: Contact[] = [];
            const skipped: number[] = [];

            for (let r = range.s.r + 1; r <= range.e.r; r++) {
              const nameCell   = ws[XLSX.utils.encode_cell({ r, c: 0 })];
              const mobileCell = ws[XLSX.utils.encode_cell({ r, c: 1 })];
              const name   = String(nameCell?.v || '').trim();
              const mobile = String(mobileCell?.v || '').trim();
              if (!name || !mobile) { skipped.push(r + 1); continue; }
              incoming.push({ name, mobile });
            }

            if (incoming.length === 0) {
              setSalesResult({ status: 'error', message: 'No valid contacts found. Ensure Col A = Salesperson Name, Col B = Mobile No.' });
              return;
            }

            // Merge with existing — update mobile if name already exists,
            // or if equivalent / 60%+ similar name found use that canonical name instead of adding a new entry.
            const existing = getSalespersonContacts();
            const existingNames = existing.map(c => cleanSalespersonName(c.name || '').trim()).filter(Boolean);
            const mergedMap = new Map<string, Contact>(existing.map(c => [cleanSalespersonName(c.name || '').trim().toLowerCase(), c]));
            let added = 0, updated = 0;
            for (const c of incoming) {
              const cleanedIncomingName = cleanSalespersonName(c.name || '').trim();
              if (!cleanedIncomingName) continue;
              // Resolve against existing names at 60% similarity threshold & token equivalence
              const canonical = findCanonicalName(cleanedIncomingName, existingNames, cleanSalespersonName, 0.60) || cleanedIncomingName;
              const resolvedContact: Contact = { ...c, name: canonical, mobile: c.mobile.replace(/\D/g, '').slice(-10) };
              const key = canonical.toLowerCase();
              if (mergedMap.has(key)) { updated++; } else { added++; }
              mergedMap.set(key, resolvedContact);
            }
            const merged = Array.from(mergedMap.values());
            saveSalespersonContacts(merged);
            const details: string[] = [];
            if (skipped.length) details.push(`Rows skipped (missing name/mobile): rows ${skipped.slice(0,10).join(', ')}`);
            if (updated > 0) details.push(`Updated existing: ${updated}`);
            setSalesResult({ status: 'success', message: `${added} new + ${updated} updated salesperson contacts (${merged.length} total).`, details });
          } catch (err: any) {
            setSalesResult({ status: 'error', message: `Parse error: ${err?.message || 'Unknown error'}` });
          }
        }, 0);
      };
      reader.readAsArrayBuffer(file);
    } catch (err: any) {
      setSalesResult({ status: 'error', message: `Could not open file: ${err?.message || 'Unknown error'}` });
    }
  }

  function handleAddDriver() {
    const name = newDriverName.trim();
    if (!name) return;
    const current = getDrivers();
    if (current.some(d => d.name.trim().toLowerCase() === name.toLowerCase())) return;
    const prefix = newPersonRole === 'owner' ? 'own_' : newPersonRole === 'user' ? 'usr_' : 'drv_';
    saveDrivers([...current, { id: prefix + Math.random().toString(36).substr(2,9), name, role: newPersonRole }]);
    setNewDriverName('');
    setDrivers(getDrivers());
  }

  function handleRemoveDriver(id: string) {
    saveDrivers(getDrivers().filter(d => d.id !== id));
    setDrivers(getDrivers());
    import('@/lib/apiSync').then(m => m.apiDeleteDriver(id));
  }

  function handleEditDriverStart(d: Driver) {
    setEditDriverId(d.id);
    setEditDriverName(d.name);
  }

  function handleSaveEditDriver() {
    const name = editDriverName.trim();
    if (!name || !editDriverId) { setEditDriverId(null); return; }
    const current = getDrivers();
    saveDrivers(current.map(d => d.id === editDriverId ? { ...d, name } : d));
    setDrivers(getDrivers());
    setEditDriverId(null);
  }

  async function handleAddBank() {
    const name = newBankName.trim().toUpperCase();
    if (!name) return;
    const current = getBanks();
    if (current.some(b => b.name.trim().toUpperCase() === name)) {
      setBankMergeMsg(`Bank "${name}" already exists in the directory.`);
      setTimeout(() => setBankMergeMsg(''), 4000);
      return;
    }
    const newId = `bn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    await saveBanks([...current, { id: newId, name }]);
    setNewBankName('');
    setBanks(getBanks());
  }

  async function handleRemoveBank(id: string) {
    const target = banks.find(b => b.id === id);
    const bankName = target?.name || '';
    requestConfirm({
      title: 'Remove Bank',
      message: `Are you sure you want to remove "${bankName || 'this bank'}" from the directory?`,
      confirmText: 'Remove Bank',
      variant: 'danger',
      onConfirm: async () => {
        await deleteBank(id, bankName);
        setBanks(getBanks());
      }
    });
  }

  async function handleFixAssignedCreditStatus() {
    setAssignCreditStatus('loading');
    setAssignCreditResult('Sabhi bills fetch ho rahe hain...');
    try {
      const { apiRecalcAllBillStatus } = await import('@/lib/apiSync');
      const { ok, fixed, total, error } = await apiRecalcAllBillStatus((done: number, tot: number) => {
        setAssignCreditResult(`${done} / ${tot} bills check ho gaye...`);
      });
      if (ok) {
        setAssignCreditStatus('ok');
        setAssignCreditResult(`${total} bills check kiye · ${fixed} bills fix hue (Assigned / Credit / Unpaid correct)`);
        const fresh = await apiFetchAllData();
        const { setServerData } = await import('@/lib/billStore');
        setServerData(fresh);
        window.dispatchEvent(new Event('bill-store-update'));
      } else {
        setAssignCreditStatus('err');
        setAssignCreditResult(error || 'Fix failed');
      }
    } catch (e) {
      setAssignCreditStatus('err');
      setAssignCreditResult(String(e));
    }
  }

  // ── Shared: build Bills worksheet (filtered) ──────────────────────────────
  const EXCEL_MAX = 32767;

  // Sanitize any value to a safe Excel cell value (clamp strings, stringify objects)
  function sanitizeVal(v: unknown): unknown {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v.length > EXCEL_MAX ? v.slice(0, EXCEL_MAX) : v;
    if (typeof v === 'number' || typeof v === 'boolean') return v;
    // objects / arrays → stringify then clamp
    const s = JSON.stringify(v);
    return s.length > EXCEL_MAX ? s.slice(0, EXCEL_MAX) : s;
  }

  function sanitizeRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
    return rows.map(row =>
      Object.fromEntries(Object.entries(row).map(([k, v]) => [k, sanitizeVal(v)]))
    );
  }

  function safeSheet(XLSX: any, rows: Record<string, unknown>[], minCapacityRows = 0) {
    const ws = XLSX.utils.json_to_sheet(sanitizeRows(rows));
    if (minCapacityRows > 0 && ws['!ref']) {
      const range = XLSX.utils.decode_range(ws['!ref']);
      if (range.e.r < minCapacityRows - 1) {
        range.e.r = minCapacityRows - 1;
        ws['!ref'] = XLSX.utils.encode_range(range);
      }
    }
    return ws;
  }

  function buildBillsSheet(XLSX: any, bills: Bill[], minCapacityRows = 100000) {
    if (bills.length === 0) {
      const emptyWs = XLSX.utils.aoa_to_sheet([['id', 'billNo', 'partyName', 'salespersonName', 'billNetAmt', 'collectedAmount', 'outstandingAmount', 'paymentMode', 'cashAmount', 'upiAmount', 'chequeAmount', 'paymentDate', 'deliveryDate', 'driverName', 'beatName', 'partyCode']]);
      const range = { s: { r: 0, c: 0 }, e: { r: minCapacityRows - 1, c: 15 } };
      emptyWs['!ref'] = XLSX.utils.encode_range(range);
      return emptyWs;
    }
    const billsData = sanitizeRows(bills.map(b => ({
      ...b,
      paymentDate:  b.paymentDate  ? String(b.paymentDate).trim()  : '',
      deliveryDate: b.deliveryDate ? String(b.deliveryDate).trim() : '',
    })));
    const ws = XLSX.utils.json_to_sheet(billsData);
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    const dateCols: number[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const hdr = ws[XLSX.utils.encode_cell({ r: 0, c })];
      if (hdr && (hdr.v === 'paymentDate' || hdr.v === 'deliveryDate')) dateCols.push(c);
    }
    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      for (const col of dateCols) {
        const addr = XLSX.utils.encode_cell({ r, c: col });
        if (ws[addr]) ws[addr] = { t: 's', v: String(ws[addr].v || '') };
      }
    }
    if (minCapacityRows > 0 && range.e.r < minCapacityRows - 1) {
      range.e.r = minCapacityRows - 1;
      ws['!ref'] = XLSX.utils.encode_range(range);
    }
    return ws;
  }

  // ── Shared: append Drivers · Banks · Party_Contacts · Salesperson_Contacts · Settings ──
  function appendSharedSheets(XLSX: any, wb: any, serverData: ReturnType<typeof apiFetchAllData> extends Promise<infer T> ? T : never) {
    const driversSource = (serverData as any).drivers?.length > 0 ? (serverData as any).drivers : getDrivers();
    XLSX.utils.book_append_sheet(wb, safeSheet(XLSX, driversSource.length ? driversSource : [{ id: '', name: '' }], 1000), 'Drivers');
    const banksSource = (serverData as any).banks?.length > 0 ? (serverData as any).banks : getBanks();
    XLSX.utils.book_append_sheet(wb, safeSheet(XLSX, banksSource.length ? banksSource : [{ id: '', name: '' }], 1000), 'Banks');
    const partyContacts   = (serverData as any).partyContacts  || [];
    const salesContacts   = (serverData as any).salespersonContacts || [];
    const partyInMem      = getPartyContacts();
    const salesInMem      = getSalespersonContacts();
    const partySource     = partyInMem.length > partyContacts.length ? partyInMem : (partyContacts.length > 0 ? partyContacts : partyInMem);
    const salesSource     = salesInMem.length > salesContacts.length ? salesInMem : (salesContacts.length > 0 ? salesContacts : salesInMem);
    XLSX.utils.book_append_sheet(wb, safeSheet(XLSX, partySource.length ? partySource : [{ name: '', mobile: '' }], 10000), 'Party_Contacts');
    XLSX.utils.book_append_sheet(wb, safeSheet(XLSX, salesSource.length ? salesSource : [{ name: '', mobile: '' }], 1000), 'Salesperson_Contacts');
    const settingsRows = Object.entries((serverData as any).settings || {}).map(([key, value]) => ({ key: String(key), value: sanitizeVal(value) }));
    XLSX.utils.book_append_sheet(wb, safeSheet(XLSX, settingsRows.length > 0 ? settingsRows : [{ key: '', value: '' }]), 'Settings');
  }

  function downloadWb(XLSX: any, wb: any, filename: string) {
    const wbArray = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbArray], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function getStamp() {
    const now = new Date();
    return `${String(now.getDate()).padStart(2,'0')}${String(now.getMonth()+1).padStart(2,'0')}${now.getFullYear()}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
  }

  // ── Backup 0: Full Backup (All ~4500+ Bills with Total Data) ──────────────
  async function handleBackupFull() {
    setBackupFullStatus('loading');
    setBackupFullProgress('Data fetch ho raha hai...');
    try {
      const XLSX = await import('xlsx');
      const { apiFetchAllData } = await import('@/lib/apiSync');
      const serverData = await apiFetchAllData();
      const allBills: Bill[] = serverData.bills.length > 0 ? serverData.bills : getBills();
      setBackupFullProgress(`Full Backup: ${allBills.length} bills...`);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, buildBillsSheet(XLSX, allBills, 100000), 'Bills');
      const summariesSource = serverData.summaries.length > 0 ? serverData.summaries : getSummaries();
      XLSX.utils.book_append_sheet(wb, safeSheet(XLSX, summariesSource.length ? summariesSource : [{ id: '', driverName: '', date: '', totalBillCount: 0, totalAmount: 0 }]), 'Summaries');
      appendSharedSheets(XLSX, wb, serverData);
      setBackupFullProgress('File generate ho rahi hai...');
      downloadWb(XLSX, wb, `VitraTrack_FullBackup_All_${getStamp()}.xlsx`);
      setBackupFullProgress('');
      setBackupFullStatus('ok');
      setTimeout(() => setBackupFullStatus('idle'), 3000);
    } catch (err: any) {
      console.error('[Backup Full] error:', err);
      setBackupFullProgress('');
      setBackupFullStatus('err');
      setTimeout(() => setBackupFullStatus('idle'), 4000);
    }
  }

  // ── File 1: Paid + FBR bills backup ──────────────────────────────────────
  async function handleBackupPaidFbr() {
    setBackupStatus('loading');
    setBackupProgress('Data fetch ho raha hai...');
    try {
      const XLSX = await import('xlsx');
      const { apiFetchAllData } = await import('@/lib/apiSync');
      const serverData = await apiFetchAllData();
      const allBills: Bill[] = serverData.bills.length > 0 ? serverData.bills : getBills();
      const paidFbrBills = allBills.filter(b => {
        const m = (b.paymentMode || '').toLowerCase();
        return m === 'paid' || m === 'fbr' || m === 'cash' || m === 'upi' || m === 'cheque' || m === 'split';
      });
      setBackupProgress(`Paid+FBR: ${paidFbrBills.length} bills...`);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, buildBillsSheet(XLSX, paidFbrBills, 100000), 'Bills');
      appendSharedSheets(XLSX, wb, serverData);
      setBackupProgress('File generate ho rahi hai...');
      downloadWb(XLSX, wb, `VitraTrack_PaidFBR_${getStamp()}.xlsx`);
      setBackupProgress('');
      setBackupStatus('ok');
      setTimeout(() => setBackupStatus('idle'), 3000);
    } catch (err: any) {
      console.error('[Backup PaidFBR] error:', err);
      setBackupProgress('');
      setBackupStatus('err');
      setTimeout(() => setBackupStatus('idle'), 4000);
    }
  }

  // ── File 2: Other bills backup (Credit · Unpaid · Del Pending · etc.) ────
  async function handleBackupOther() {
    setBackup2Status('loading');
    setBackup2Progress('Data fetch ho raha hai...');
    try {
      const XLSX = await import('xlsx');
      const { apiFetchAllData } = await import('@/lib/apiSync');
      const serverData = await apiFetchAllData();
      const allBills: Bill[] = serverData.bills.length > 0 ? serverData.bills : getBills();
      const otherBills = allBills.filter(b => {
        const m = (b.paymentMode || '').toLowerCase();
        return m !== 'paid' && m !== 'fbr' && m !== 'cash' && m !== 'upi' && m !== 'cheque' && m !== 'split';
      });
      setBackup2Progress(`Other bills: ${otherBills.length} bills...`);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, buildBillsSheet(XLSX, otherBills, 100000), 'Bills');
      // Summaries only in Other file (driver daily operational data)
      const summariesSource = serverData.summaries.length > 0 ? serverData.summaries : getSummaries();
      XLSX.utils.book_append_sheet(wb, safeSheet(XLSX, summariesSource.length ? summariesSource : [{ id: '', driverName: '', date: '', totalBillCount: 0, totalAmount: 0 }]), 'Summaries');
      appendSharedSheets(XLSX, wb, serverData);
      setBackup2Progress('File generate ho rahi hai...');
      downloadWb(XLSX, wb, `VitraTrack_Other_${getStamp()}.xlsx`);
      setBackup2Progress('');
      setBackup2Status('ok');
      setTimeout(() => setBackup2Status('idle'), 3000);
    } catch (err: any) {
      console.error('[Backup Other] error:', err);
      setBackup2Progress('');
      setBackup2Status('err');
      setTimeout(() => setBackup2Status('idle'), 4000);
    }
  }

  async function handleRestoreFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setRestoreStatus({ status: 'loading', message: 'Reading and validating backup...' });
    const fName = file.name;
    e.target.value = '';
    try {
      const XLSX = await import('xlsx');
      const reader = new FileReader();
      reader.onload = (evt) => {
        setTimeout(async () => {
          try {
            const data = new Uint8Array(evt.target?.result as ArrayBuffer);
            const wb = XLSX.read(data, { type: 'array', cellStyles: false, cellNF: false, cellFormula: false });
            
            const statsList: { label: string; count: number }[] = [];
            let isValid = false;

            if (wb.SheetNames.includes('Bills')) {
              const rows = XLSX.utils.sheet_to_json(wb.Sheets['Bills'], { defval: '' });
              statsList.push({ label: 'Bills', count: rows.length });
              isValid = true;
            }
            if (wb.SheetNames.includes('Drivers')) {
              const rows = XLSX.utils.sheet_to_json(wb.Sheets['Drivers'], { defval: '' });
              statsList.push({ label: 'Drivers', count: rows.length });
              isValid = true;
            }
            if (wb.SheetNames.includes('Banks')) {
              const rows = XLSX.utils.sheet_to_json(wb.Sheets['Banks'], { defval: '' });
              statsList.push({ label: 'Banks', count: rows.length });
              isValid = true;
            }
            if (wb.SheetNames.includes('Summaries')) {
              const rows = XLSX.utils.sheet_to_json(wb.Sheets['Summaries'], { defval: '' });
              statsList.push({ label: 'Driver Summaries', count: rows.length });
              isValid = true;
            }
            if (wb.SheetNames.includes('Party_Contacts')) {
              const rows = XLSX.utils.sheet_to_json(wb.Sheets['Party_Contacts'], { defval: '' });
              statsList.push({ label: 'Party Contacts', count: rows.length });
              isValid = true;
            }
            if (wb.SheetNames.includes('Salesperson_Contacts')) {
              const rows = XLSX.utils.sheet_to_json(wb.Sheets['Salesperson_Contacts'], { defval: '' });
              statsList.push({ label: 'Salesperson Contacts', count: rows.length });
              isValid = true;
            }
            if (wb.SheetNames.includes('Settings')) {
              const rows = XLSX.utils.sheet_to_json(wb.Sheets['Settings'], { defval: '' });
              statsList.push({ label: 'Settings Keys', count: rows.length });
              isValid = true;
            }

            if (!isValid || statsList.length === 0) {
              setRestoreStatus({ status: 'error', message: 'Validation failed: No valid database sheets (Bills, Drivers, etc.) found in the backup file. Aborting restore.' });
              setPendingRestore(null);
            } else {
              setRestoreStatus(null);
              setPendingRestore({
                fileName: fName,
                stats: statsList,
                wb,
              });
            }
          } catch (err: any) {
            setRestoreStatus({ status: 'error', message: `Read failed: ${err?.message || 'Unknown error'}` });
            setPendingRestore(null);
          }
        }, 0);
      };
      reader.readAsArrayBuffer(file);
    } catch (err: any) {
      setRestoreStatus({ status: 'error', message: `Could not open file: ${err?.message || 'Unknown error'}` });
      setPendingRestore(null);
    }
  }

  function handleDeleteDateRecords() {
    if (!deleteDateFrom || !deleteDateTo) return;
    const toDisplayDate = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
    const parseDisplay = (dStr: string) => { const [d, m, y] = dStr.split('/').map(Number); return new Date(y, m - 1, d).getTime(); };
    const fromTs = parseDisplay(toDisplayDate(deleteDateFrom));
    const toTs   = parseDisplay(toDisplayDate(deleteDateTo));
    requestConfirm({
      title: 'Data Purge Confirmation',
      message: `Are you sure you want to permanently delete all ledger records between ${toDisplayDate(deleteDateFrom)} and ${toDisplayDate(deleteDateTo)}?`,
      confirmText: 'Permanently Delete',
      variant: 'danger',
      onConfirm: () => {
        const allBills = getBills();
        const kept = allBills.filter(b => {
          if (!b.date) return true;
          const parts = b.date.split('/');
          if (parts.length !== 3) return true;
          const ts = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0])).getTime();
          return ts < fromTs || ts > toTs;
        });
        const removed = allBills.length - kept.length;
        saveBills(kept);
        setPurgeMsg(`DELETED ${removed} RECORDS FROM ${toDisplayDate(deleteDateFrom)} TO ${toDisplayDate(deleteDateTo)}`);
        setDeleteDateFrom('');
        setDeleteDateTo('');
        setTimeout(() => setPurgeMsg(''), 8000);
      }
    });
  }

  function handleSaveSuffix() {
    setSavingPw(true);
    saveSystemPasswordSuffix(pwSuffix);
    setTimeout(() => {
      setSavingPw(false);
      setSuffixSavedMsg(true);
      setTimeout(() => setSuffixSavedMsg(false), 3000);
    }, 400);
  }

  function ResultBox({ result, onClear }: { result: UploadResult; onClear: () => void }) {
    const isError = result.status === 'error';
    const isLoading = result.status === 'loading';
    return (
      <div className={cn("mt-3 p-3 rounded-2xl border animate-in fade-in zoom-in-95 relative",
        isLoading ? "bg-blue-50 border-blue-100" :
        isError ? "bg-red-50 border-red-200" :
        "bg-emerald-50 border-emerald-100"
      )}>
        <button onClick={onClear} className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"><X className="w-3 h-3" /></button>
        <div className="flex items-start gap-2 pr-4">
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin text-blue-500 mt-0.5 shrink-0" /> :
           isError ? <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" /> :
           <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />}
          <div className="min-w-0">
            <p className={cn("text-[10px] font-black uppercase leading-tight",
              isError ? "text-red-700" : isLoading ? "text-blue-700" : "text-emerald-700"
            )}>{result.message}</p>
            {result.details?.map((d, i) => (
              <p key={i} className="text-[9px] font-bold text-muted-foreground mt-1 break-all leading-tight">{d}</p>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-6 pt-10 w-full bg-background">
      <TopNav />
      <div className="bg-primary px-3 py-2 rounded-b-xl shadow-md w-full">
        <h1 className="text-sm font-black text-primary-foreground uppercase tracking-widest">Admin Config</h1>
        <p className="text-[9px] font-bold text-primary-foreground/60 uppercase tracking-tighter">System Maintenance & Global Sync</p>
      </div>

      <div className="w-full px-3 mt-3 space-y-3">

        {/* AI Admin Database Agent */}
        <AdminAiAgent />

        {/* Bills Report Update */}
        <div id="bills-report-update" className="bg-card rounded-xl p-3 border border-amber-200 shadow-sm">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-[11px] font-black uppercase flex items-center gap-2 text-amber-600"><FileSpreadsheet className="w-4 h-4" /> Bills Report Update</h2>
            <span className="text-[8px] font-black bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full uppercase tracking-wider">Bill Wise Sync</span>
          </div>
          <p className="text-[8px] font-bold text-muted-foreground uppercase mb-1 leading-tight">
            Sales Register file (Excel/XLS). Columns: <span className="text-amber-700">BillRefNo · BillDate · Party Name · Party Code · Beat Name · BillValue</span>
          </p>
          <p className="text-[8px] font-bold text-muted-foreground uppercase mb-2 leading-tight">
            Bill No wise Bill Date, Party Name, Party Code, Beat Name, Bill Value Supabase me Add/Update hoga. Duplicate Bill No me (-) negative value <span className="text-red-600 font-black">Line Cut Amt</span> me aur (+) positive value <span className="text-emerald-600 font-black">Bill Net Amt</span> me update hogi.
          </p>
          <div onClick={() => billsReportFileRef.current?.click()} className="border-2 border-dashed rounded-xl p-3 flex items-center gap-3 cursor-pointer hover:bg-amber-50 transition-all border-amber-300">
            {billsReportResult?.status === 'loading' ? <Loader2 className="w-5 h-5 animate-spin text-amber-600 shrink-0" /> : <FileSpreadsheet className="w-5 h-5 text-amber-600 shrink-0" />}
            <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">{billsReportResult?.status === 'loading' ? 'Processing...' : 'Upload Bills Report XLS'}</p>
          </div>
          {billsReportResult && billsReportResult.status !== 'loading' && <ResultBox result={billsReportResult} onClear={() => setBillsReportResult(null)} />}
          <input ref={billsReportFileRef} type="file" accept=".xlsx,.xls" onChange={handleBillsReportFile} className="hidden" />
        </div>

        {/* LEVEREDGE COLLECTION */}
        <div id="leveredge-collection" className="bg-card rounded-xl p-3 border border-indigo-200 shadow-sm">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-[11px] font-black uppercase flex items-center gap-2 text-indigo-600">
              <FileSpreadsheet className="w-4 h-4" /> LEVEREDGE COLLECTION
            </h2>
            <span className="text-[8px] font-black bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full uppercase tracking-wider">
              {leveredgeRows.length > 0 ? `${leveredgeRows.length} Bills Loaded` : 'XLS Upload / Download'}
            </span>
          </div>
          <p className="text-[8px] font-bold text-muted-foreground uppercase mb-2 leading-tight">
            Leveredge collection file upload karo. Usi file me same font, format, column & row structure me App ke bills ka received payment data add hoke download hoga.
          </p>
          {leveredgeFileName && (
            <div className="mb-2 p-1.5 bg-indigo-50 border border-indigo-200 rounded-lg flex items-center justify-between text-[9px] font-bold text-indigo-900">
              <span className="truncate flex items-center gap-1.5">
                <FileSpreadsheet className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                <span className="truncate">{leveredgeFileName}</span>
              </span>
              <span className="shrink-0 bg-indigo-200 text-indigo-800 px-1.5 py-0.5 rounded text-[8px]">
                {leveredgeRows.length} Bills
              </span>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div
              onClick={() => leveredgeFileRef.current?.click()}
              className="border-2 border-dashed rounded-xl p-3 flex items-center justify-center gap-2 cursor-pointer hover:bg-indigo-50 transition-all border-indigo-300"
            >
              {leveredgeResult?.status === 'loading' ? (
                <Loader2 className="w-4 h-4 animate-spin text-indigo-600 shrink-0" />
              ) : (
                <UploadCloud className="w-4 h-4 text-indigo-600 shrink-0" />
              )}
              <p className="text-[10px] font-black uppercase tracking-wider text-indigo-700">
                UPLOAD XLS
              </p>
            </div>
            <button
              onClick={handleLeveredgeDownload}
              className="border-2 border-indigo-500 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl p-3 flex items-center justify-center gap-2 transition-all cursor-pointer font-black text-[10px] uppercase tracking-wider shadow-sm"
            >
              <Download className="w-4 h-4 text-white shrink-0" />
              DOWNLOAD XLS
            </button>
          </div>
          {leveredgeResult && leveredgeResult.status !== 'loading' && (
            <ResultBox result={leveredgeResult} onClear={() => setLeveredgeResult(null)} />
          )}
          <input
            ref={leveredgeFileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleLeveredgeUpload}
            className="hidden"
          />
        </div>

        {/* Row 2: Green Party Master + Party + Salesperson Contacts */}
        <div className="space-y-3">
          {/* Green Background Party Master Banner */}
          <div className="bg-gradient-to-r from-emerald-900 to-emerald-950 text-emerald-100 rounded-xl p-3 border border-emerald-700/50 shadow-md flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <span className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse shrink-0" />
              <div>
                <h2 className="text-xs font-black uppercase tracking-wider text-emerald-100 flex items-center gap-2">
                  Green Background Party Master ({getGreenParties().length} Parties Loaded)
                </h2>
                <p className="text-[10px] text-emerald-300 font-medium">
                  Parties set to highlight with Green Background in all Driver Tables, Reports & PDFs
                </p>
              </div>
            </div>
            <Button
              size="sm"
              onClick={() => setIsGreenPartyModalOpen(true)}
              className="bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-black text-xs uppercase px-3 py-1.5 shadow cursor-pointer shrink-0"
            >
              Manage Green Parties List
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

          {/* Party Contacts */}
          <div className="bg-card rounded-xl p-3 border border-border shadow-sm">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-[11px] font-black uppercase flex items-center gap-2 text-emerald-600"><Smartphone className="w-4 h-4" /> Party Mobile Directory</h2>
              <button onClick={() => downloadSample('party')} className="flex items-center gap-1 text-[9px] font-black text-emerald-600 uppercase tracking-wider border border-emerald-300 rounded-xl px-2 py-1 hover:bg-emerald-50 transition-all">
                <Download className="w-3 h-3" /> Sample
              </button>
            </div>
            <p className="text-[9px] font-bold text-muted-foreground uppercase mb-3">PARTY CODE = Party ID &nbsp;|&nbsp; PARTY NAME = Name &nbsp;|&nbsp; ADDRESS se PH ke baad last 10 digits = Mobile</p>
            <div onClick={() => syncContactFileRef.current?.click()} className="border-2 border-dashed rounded-xl p-3 flex items-center gap-3 cursor-pointer hover:bg-emerald-50 transition-all border-emerald-200">
              {contactResult?.status === 'loading' ? <Loader2 className="w-5 h-5 animate-spin text-emerald-600 shrink-0" /> : <Phone className="w-5 h-5 text-emerald-600 shrink-0" />}
              <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">{contactResult?.status === 'loading' ? 'Processing...' : 'Upload Party Contacts'}</p>
            </div>
            {contactResult && contactResult.status !== 'loading' && <ResultBox result={contactResult} onClear={() => setContactResult(null)} />}
            <input ref={syncContactFileRef} type="file" accept=".xlsx,.xls" onChange={handleContactSync} className="hidden" />
          </div>

          {/* Salesperson Contacts */}
          <div className="bg-card rounded-xl p-3 border border-border shadow-sm">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-[11px] font-black uppercase flex items-center gap-2 text-orange-500"><Smartphone className="w-4 h-4" /> Salesperson Mobile Directory</h2>
              <button onClick={() => downloadSample('sales')} className="flex items-center gap-1 text-[9px] font-black text-orange-500 uppercase tracking-wider border border-orange-300 rounded-xl px-2 py-1 hover:bg-orange-50 transition-all">
                <Download className="w-3 h-3" /> Sample
              </button>
            </div>
            <p className="text-[9px] font-bold text-muted-foreground uppercase mb-3">Col A = Salesperson Name &nbsp;|&nbsp; Col B = Mobile No</p>
            <div onClick={() => syncSalesFileRef.current?.click()} className="border-2 border-dashed rounded-xl p-3 flex items-center gap-3 cursor-pointer hover:bg-orange-50 transition-all border-orange-200">
              {salesResult?.status === 'loading' ? <Loader2 className="w-5 h-5 animate-spin text-orange-500 shrink-0" /> : <Phone className="w-5 h-5 text-orange-500 shrink-0" />}
              <p className="text-[10px] font-black uppercase tracking-widest text-orange-600">{salesResult?.status === 'loading' ? 'Processing...' : 'Upload Salesperson Contacts'}</p>
            </div>
            {salesResult && salesResult.status !== 'loading' && <ResultBox result={salesResult} onClear={() => setContactResult(null)} />}
            <input ref={syncSalesFileRef} type="file" accept=".xlsx,.xls" onChange={handleSalespersonContactSync} className="hidden" />

            {/* ── Single-salesperson mobile edit ──────────────────────────── */}
            {(() => {
              const contacts = getSalespersonContacts();
              const namesSet = new Set<string>();
              for (const c of contacts) if (c.name) namesSet.add(c.name);
              for (const b of getBills()) if (b.salespersonName) namesSet.add(b.salespersonName);
              const names = Array.from(namesSet).sort((a, b) => a.localeCompare(b));
              return (
                <div className="mt-3 pt-3 border-t border-border/60">
                  <p className="text-[9px] font-black uppercase text-orange-600 mb-2 tracking-widest">Update Single Salesperson Mobile</p>
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2">
                    <select
                      value={salesEditName}
                      onChange={(e) => {
                        const nm = e.target.value;
                        setSalesEditName(nm);
                        const existing = findSalespersonContact(nm) || contacts.find(c => (c.name || '').trim().toLowerCase() === nm.trim().toLowerCase());
                        setSalesEditMobile(existing?.mobile || '');
                        setSalesEditStatus('idle');
                      }}
                      className="h-9 px-3 bg-muted rounded-xl text-[11px] font-black uppercase outline-none border-0 focus:ring-2 focus:ring-orange-300"
                    >
                      <option value="">-- Select Salesperson --</option>
                      {names.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <input
                      type="tel"
                      inputMode="numeric"
                      placeholder="MOBILE NO"
                      value={salesEditMobile}
                      onChange={(e) => { setSalesEditMobile(e.target.value.replace(/\D/g, '').slice(0, 15)); setSalesEditStatus('idle'); }}
                      className="h-9 px-3 bg-muted rounded-xl text-[11px] font-black outline-none border-0 focus:ring-2 focus:ring-orange-300 w-full sm:w-40"
                    />
                    <Button
                      onClick={async () => {
                        if (!salesEditName) {
                          setSalesEditMsg('Please select a salesperson first.');
                          setTimeout(() => setSalesEditMsg(''), 3000);
                          return;
                        }
                        if (!salesEditMobile || salesEditMobile.length < 7) {
                          setSalesEditMsg('Please enter a valid mobile number.');
                          setTimeout(() => setSalesEditMsg(''), 3000);
                          return;
                        }
                        const current = getSalespersonContacts();
                        const targetClean = cleanSalespersonName(salesEditName).trim();
                        const targetCleanLower = targetClean.toLowerCase();
                        const targetRaw = salesEditName.trim().toLowerCase();
                        const idx = current.findIndex(c => {
                          const cRaw = (c.name || '').trim().toLowerCase();
                          const cClean = cleanSalespersonName(c.name || '').trim().toLowerCase();
                          return cRaw === targetRaw || (targetCleanLower && cClean === targetCleanLower) || areSalespersonNamesEquivalent(c.name, targetClean);
                        });
                        let next: Contact[];
                        const stableId = `sp_${targetCleanLower.replace(/[^a-z0-9]/g, '_').slice(0, 44)}`;
                        const cleanDigits = salesEditMobile.replace(/\D/g, '').slice(-10);
                        if (idx >= 0) {
                          next = current.slice();
                          const existing = next[idx];
                          next[idx] = {
                            ...existing,
                            id: existing.id || stableId,
                            name: cleanSalespersonName(existing.name || targetClean),
                            mobile: cleanDigits,
                          };
                        } else {
                          next = [...current, {
                            id: stableId,
                            name: targetClean,
                            mobile: cleanDigits,
                          }];
                        }
                        await saveSalespersonContacts(next);
                        setSalesEditStatus('saved');
                        setSalesEditMsg('');
                        setTimeout(() => setSalesEditStatus('idle'), 2500);
                      }}
                      className="h-9 px-4 rounded-xl font-black uppercase text-[10px] tracking-widest bg-orange-500 hover:bg-orange-600 text-white"
                    >
                      {salesEditStatus === 'saved' ? <CheckCircle2 className="w-4 h-4" /> : 'Save'}
                    </Button>
                  </div>
                  {salesEditMsg && (
                    <p className="text-[9px] font-black uppercase text-destructive mt-1">{salesEditMsg}</p>
                  )}
                  {salesEditStatus === 'saved' && (
                    <p className="text-[9px] font-black uppercase text-emerald-600 mt-1">✓ Mobile updated for {salesEditName}</p>
                  )}
                </div>
              );
            })()}

            {/* ── Merge Two Salespersons ───────────────────────────────────── */}
            {(() => {
              const contacts = getSalespersonContacts();
              const namesSet = new Set<string>();
              for (const c of contacts) if (c.name) namesSet.add(c.name);
              for (const b of getBills()) if (b.salespersonName) namesSet.add(b.salespersonName);
              const names = Array.from(namesSet).sort((a, b) => a.localeCompare(b));
              return (
                <div className="mt-3 pt-3 border-t border-border/60">
                  <p className="text-[9px] font-black uppercase text-orange-600 mb-1 tracking-widest">Merge Two Salespersons</p>
                  <p className="text-[8px] font-bold text-muted-foreground mb-2 leading-tight">
                    "From" salesperson ke saare bills "To" salesperson me merge ho jayenge. Supabase me bhi update hoga.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
                    <select
                      value={spMergeFrom}
                      onChange={(e) => { setSpMergeFrom(e.target.value); setSpMergeStatus('idle'); }}
                      className="h-9 px-3 bg-muted rounded-xl text-[11px] font-black uppercase outline-none border-0 focus:ring-2 focus:ring-orange-300"
                    >
                      <option value="">-- Merge FROM --</option>
                      {names.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <select
                      value={spMergeTo}
                      onChange={(e) => { setSpMergeTo(e.target.value); setSpMergeStatus('idle'); }}
                      className="h-9 px-3 bg-muted rounded-xl text-[11px] font-black uppercase outline-none border-0 focus:ring-2 focus:ring-orange-300"
                    >
                      <option value="">-- Merge INTO --</option>
                      {names.filter(n => n !== spMergeFrom).map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <Button
                      disabled={!spMergeFrom || !spMergeTo || spMergeStatus === 'loading'}
                      onClick={() => {
                        if (!spMergeFrom || !spMergeTo) return;
                        requestConfirm({
                          title: 'Merge Salespersons',
                          message: `"${spMergeFrom}" ke saare bills "${spMergeTo}" me merge ho jayenge.\n\n"${spMergeFrom}" database se update ho jayega.`,
                          confirmText: 'Merge Salespersons',
                          variant: 'warning',
                          onConfirm: async () => {
                            setSpMergeStatus('loading');
                            setSpMergeMsg('');
                            try {
                              const res = await mergeTwoSalespersons(spMergeFrom, spMergeTo);
                              if (res.ok) {
                                setSpMergeStatus('done');
                                setSpMergeMsg(`✓ ${res.billsUpdated} bills "${spMergeFrom}" → "${spMergeTo}" merge ho gaye.`);
                                setSpMergeFrom('');
                                setSpMergeTo('');
                              } else {
                                setSpMergeStatus('error');
                                setSpMergeMsg(`Error: ${res.error || 'Unknown error'}`);
                              }
                            } catch (err: any) {
                              setSpMergeStatus('error');
                              setSpMergeMsg(`Error: ${String(err?.message ?? err)}`);
                            }
                          }
                        });
                      }}
                      className="h-9 px-4 rounded-xl font-black uppercase text-[10px] tracking-widest bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-50"
                    >
                      {spMergeStatus === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Merge'}
                    </Button>
                  </div>
                  {spMergeMsg && (
                    <p className={`text-[9px] font-black uppercase mt-1 ${spMergeStatus === 'done' ? 'text-emerald-600' : 'text-destructive'}`}>
                      {spMergeMsg}
                    </p>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
        </div>

        {/* Row 3: Drivers + Banks */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="bg-card rounded-xl p-3 border border-border shadow-sm">
            <h2 className="text-[12px] font-black uppercase mb-2 text-primary">Roster — Driver / Owner / User</h2>
            {/* Role selector */}
            <div className="flex gap-1 mb-2">
              {(['driver', 'owner', 'user'] as const).map(r => (
                <button key={r} onClick={() => setNewPersonRole(r)}
                  className={cn("flex-1 h-7 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all border",
                    newPersonRole === r
                      ? r === 'driver' ? "bg-primary text-primary-foreground border-primary"
                        : r === 'owner' ? "bg-amber-500 text-white border-amber-500"
                        : "bg-violet-600 text-white border-violet-600"
                      : "bg-muted text-muted-foreground border-border hover:bg-muted/80"
                  )}
                >{r === 'driver' ? '🚛 Driver' : r === 'owner' ? '👑 Owner' : '👤 User'}</button>
              ))}
            </div>
            <div className="flex gap-2 mb-3">
               <input type="text" placeholder={`NEW ${newPersonRole.toUpperCase()} NAME`} value={newDriverName} onChange={e => setNewDriverName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddDriver()} className="flex-1 h-9 px-3 bg-muted rounded-xl text-xs font-black uppercase outline-none focus:ring-2 focus:ring-primary/20" />
               <Button onClick={handleAddDriver} className="h-9 px-4 rounded-xl font-black uppercase text-[10px] tracking-widest">Add</Button>
            </div>
            {/* Driver section */}
            {(['driver', 'owner', 'user'] as const).map(roleGroup => {
              const group = drivers.filter(d => (d.role ?? 'driver') === roleGroup);
              if (group.length === 0) return null;
              const labelColor = roleGroup === 'driver' ? 'text-primary' : roleGroup === 'owner' ? 'text-amber-600' : 'text-violet-600';
              const rowColor = roleGroup === 'driver' ? 'bg-muted/50 border-border/30' : roleGroup === 'owner' ? 'bg-amber-50 border-amber-200/50' : 'bg-violet-50 border-violet-200/50';
              const label = roleGroup === 'driver' ? '🚛 Drivers' : roleGroup === 'owner' ? '👑 Owners' : '👤 Users';
              return (
                <div key={roleGroup} className="mb-2">
                  <p className={cn("text-[8px] font-black uppercase tracking-widest mb-1", labelColor)}>{label}</p>
                  <div className="space-y-1 max-h-36 overflow-auto no-scrollbar pr-1">
                    {group.map(d => (
                      <div key={d.id} className={cn("flex items-center justify-between p-2 rounded-xl border transition-colors", rowColor)}>
                        {editDriverId === d.id ? (
                          <input
                            autoFocus
                            type="text"
                            value={editDriverName}
                            onChange={e => setEditDriverName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleSaveEditDriver(); if (e.key === 'Escape') setEditDriverId(null); }}
                            className="flex-1 h-6 px-2 bg-white rounded-lg text-[11px] font-black uppercase outline-none focus:ring-2 focus:ring-primary/20 mr-2 border border-primary/30"
                          />
                        ) : (
                          <span className="text-[11px] font-black uppercase flex-1">{d.name}</span>
                        )}
                        <div className="flex items-center gap-1 shrink-0">
                          {editDriverId === d.id ? (
                            <>
                              <button onClick={handleSaveEditDriver} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded-lg text-[9px] font-black uppercase transition-all">Save</button>
                              <button onClick={() => setEditDriverId(null)} className="p-1 text-muted-foreground hover:bg-muted rounded-lg transition-all"><X className="w-3 h-3" /></button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => handleEditDriverStart(d)} className="p-1.5 text-primary/60 hover:bg-primary/10 rounded-lg transition-all"><Pencil className="w-3 h-3" /></button>
                              <button onClick={() => handleRemoveDriver(d.id)} className="p-1.5 text-destructive hover:bg-destructive/10 rounded-lg transition-all"><Trash2 className="w-3.5 h-3.5" /></button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="bg-card rounded-xl p-3 border border-border shadow-sm flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-[12px] font-black uppercase text-primary">Bank Directory</h2>
              <button
                disabled={dedupBankStatus === 'loading'}
                onClick={async () => {
                  setDedupBankStatus('loading');
                  const { deduplicateBanks } = await import('@/lib/billStore');
                  const res = await deduplicateBanks();
                  setBanks(getBanks());
                  setDedupBankStatus('done');
                  setDedupBankMsg(res.removed > 0 ? `${res.removed} duplicate bank name(s) merged!` : 'Koi duplicate bank nahi mila.');
                  setTimeout(() => setDedupBankMsg(''), 4000);
                }}
                className="px-2 py-1 rounded-lg text-[9px] font-black uppercase bg-primary/10 text-primary hover:bg-primary/20 transition-all"
              >
                {dedupBankStatus === 'loading' ? 'Merging...' : '⚡ Clean / Merge Duplicates'}
              </button>
            </div>
            {dedupBankMsg && (
              <p className="text-[9px] font-black uppercase text-emerald-600 mb-2 bg-emerald-50 p-1.5 rounded-lg border border-emerald-200">
                {dedupBankMsg}
              </p>
            )}
            <div className="flex gap-2 mb-2">
               <input type="text" placeholder="NEW BANK NAME" value={newBankName} onChange={e => setNewBankName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddBank()} className="flex-1 h-9 px-3 bg-muted rounded-xl text-xs font-black uppercase outline-none focus:ring-2 focus:ring-primary/20" />
               <Button onClick={handleAddBank} className="h-9 px-4 rounded-xl font-black uppercase text-[10px] tracking-widest">Add</Button>
            </div>
            <div className="space-y-1.5 max-h-40 overflow-auto no-scrollbar pr-1 mb-3">
              {banks.map(b => (
                <div key={b.id} className="flex items-center justify-between p-2 bg-muted/50 rounded-xl border border-border/30 hover:bg-muted transition-colors">
                  <span className="text-[11px] font-black uppercase">{b.name}</span>
                  <button onClick={() => handleRemoveBank(b.id)} className="p-1.5 text-destructive hover:bg-destructive/10 rounded-lg transition-all"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>

            {/* Merge Specific Bank Tool */}
            <div className="mt-auto pt-2 border-t border-border/50 bg-amber-50/70 rounded-xl p-2.5 border border-amber-200">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[9px] font-black text-amber-900 uppercase tracking-wider">Merge Duplicate Bank Into One</p>
                {fromBankBillCount > 0 && (
                  <span className="px-1.5 py-0.5 bg-amber-200/70 text-amber-900 rounded text-[8px] font-black">
                    {fromBankBillCount} bills matched
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mb-2">
                <div>
                  <label className="text-[8px] font-black text-muted-foreground uppercase block mb-0.5">From Bank (Old / Duplicate):</label>
                  <select
                    value={bankMergeFrom}
                    onChange={e => setBankMergeFrom(e.target.value)}
                    className="w-full h-8 px-2 bg-white rounded-lg text-[10px] font-black uppercase border border-amber-300 outline-none focus:ring-1 focus:ring-amber-400"
                  >
                    <option value="">-- Select Bank --</option>
                    {allAvailableBankNames.map(name => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-0.5">
                    <label className="text-[8px] font-black text-muted-foreground uppercase block">Into Target Bank:</label>
                    <button
                      type="button"
                      onClick={() => {
                        if (bankMergeTo === '__custom__') {
                          setBankMergeTo('');
                          setBankMergeCustomTo('');
                        } else {
                          setBankMergeTo('__custom__');
                        }
                      }}
                      className="text-[8px] font-black text-amber-800 hover:underline uppercase"
                    >
                      {bankMergeTo === '__custom__' ? '← Select Existing' : '+ Type New Name'}
                    </button>
                  </div>
                  {bankMergeTo === '__custom__' ? (
                    <input
                      type="text"
                      placeholder="ENTER TARGET BANK NAME"
                      value={bankMergeCustomTo}
                      onChange={e => setBankMergeCustomTo(e.target.value.toUpperCase())}
                      className="w-full h-8 px-2 bg-white rounded-lg text-[10px] font-black uppercase border border-amber-300 outline-none focus:ring-1 focus:ring-amber-400 placeholder:text-muted-foreground/50"
                    />
                  ) : (
                    <select
                      value={bankMergeTo}
                      onChange={e => setBankMergeTo(e.target.value)}
                      className="w-full h-8 px-2 bg-white rounded-lg text-[10px] font-black uppercase border border-amber-300 outline-none focus:ring-1 focus:ring-amber-400"
                    >
                      <option value="">-- Select Target --</option>
                      {allAvailableBankNames.filter(name => name !== bankMergeFrom).map(name => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
              <Button
                disabled={!bankMergeFrom || !effectiveBankMergeTo || bankMergeFrom.toUpperCase() === effectiveBankMergeTo.toUpperCase() || bankMergeStatus === 'loading'}
                onClick={() => {
                  if (!bankMergeFrom || !effectiveBankMergeTo || bankMergeFrom.toUpperCase() === effectiveBankMergeTo.toUpperCase()) return;
                  requestConfirm({
                    title: 'Confirm Bank Merge',
                    message: `Are you sure you want to merge "${bankMergeFrom}" into "${effectiveBankMergeTo}"?`,
                    details: (
                      <div className="space-y-1 text-xs">
                        <div><span className="text-muted-foreground">From Bank:</span> <span className="font-bold">{bankMergeFrom}</span></div>
                        <div><span className="text-muted-foreground">Target Bank:</span> <span className="font-bold">{effectiveBankMergeTo}</span></div>
                        <div><span className="text-muted-foreground">Matching Bills:</span> <span className="font-bold text-amber-700">{fromBankBillCount}</span></div>
                      </div>
                    ),
                    confirmText: 'Merge Bank Entries',
                    variant: 'warning',
                    onConfirm: async () => {
                      setBankMergeStatus('loading');
                      setBankMergeMsg('Merging bank entries across bills & database...');
                      try {
                        const res = await mergeTwoBanks(bankMergeFrom, effectiveBankMergeTo);
                        if (res.ok) {
                          setBanks(getBanks());
                          setBankMergeStatus('done');
                          setBankMergeMsg(`Merged "${bankMergeFrom}" into "${effectiveBankMergeTo}" (${res.billsUpdated} bills updated in DB & local store)`);
                          setBankMergeFrom('');
                          setBankMergeTo('');
                          setBankMergeCustomTo('');
                          setTimeout(() => setBankMergeMsg(''), 8000);
                        } else {
                          setBankMergeStatus('error');
                          setBankMergeMsg(res.error || 'Merge failed.');
                        }
                      } catch (err: any) {
                        setBankMergeStatus('error');
                        setBankMergeMsg(`Error: ${String(err?.message ?? err)}`);
                      }
                    }
                  });
                }}
                className="w-full h-8 rounded-lg font-black uppercase text-[9px] tracking-widest bg-amber-600 hover:bg-amber-700 text-white shadow-sm"
              >
                {bankMergeStatus === 'loading' ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                Merge Bank Entries & Bills {fromBankBillCount > 0 ? `(${fromBankBillCount})` : ''}
              </Button>
              {bankMergeMsg && (
                <p className={`text-[9px] font-black uppercase mt-1.5 text-center p-1 rounded ${bankMergeStatus === 'done' ? 'text-emerald-700 bg-emerald-50' : 'text-destructive bg-destructive/10'}`}>
                  {bankMergeMsg}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* User Permissions Section — only shown when there are user-role staff members */}
        {drivers.filter(d => (d.role ?? 'driver') === 'user').length > 0 && (
          <div className="bg-card rounded-xl p-3 border border-violet-200 shadow-sm">
            <h2 className="text-[12px] font-black uppercase mb-2 flex items-center gap-2 text-violet-600">
              <ShieldCheck className="w-4 h-4" /> User Permissions
            </h2>
            <p className="text-[9px] font-bold text-muted-foreground uppercase mb-2 leading-tight">
              Toggle <span className="text-violet-700">Edit</span> (can save/edit bills), <span className="text-blue-700">Add</span> (can add entries), and <span className="text-amber-700">Back Date</span> (can change date on dashboard).
            </p>
            <div className="space-y-1.5">
              {drivers.filter(d => (d.role ?? 'driver') === 'user').map(u => {
                const perm = getUserPerm(u.name);
                const isChanging = !!userPermChanging[u.name];
                return (
                  <div key={u.id} className="flex items-center justify-between p-2 bg-violet-50 rounded-xl border border-violet-200/50">
                    <span className="text-[11px] font-black uppercase flex-1">{u.name}</span>
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        disabled={isChanging}
                        onClick={async () => {
                          setUserPermChanging(p => ({ ...p, [u.name]: true }));
                          await saveUserPerm(u.name, { ...perm, canEdit: !perm.canEdit });
                          setDrivers(getDrivers()); // re-render
                          setUserPermChanging(p => ({ ...p, [u.name]: false }));
                        }}
                        className={cn("h-7 px-2 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all border",
                          perm.canEdit ? "bg-violet-600 text-white border-violet-600" : "bg-muted text-muted-foreground border-border hover:bg-violet-50"
                        )}
                      >
                        {isChanging ? '…' : perm.canEdit ? '✓ Edit' : 'Edit'}
                      </button>
                      <button
                        disabled={isChanging}
                        onClick={async () => {
                          setUserPermChanging(p => ({ ...p, [u.name]: true }));
                          await saveUserPerm(u.name, { ...perm, canAdd: !perm.canAdd });
                          setDrivers(getDrivers()); // re-render
                          setUserPermChanging(p => ({ ...p, [u.name]: false }));
                        }}
                        className={cn("h-7 px-2 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all border",
                          perm.canAdd ? "bg-blue-600 text-white border-blue-600" : "bg-muted text-muted-foreground border-border hover:bg-blue-50"
                        )}
                      >
                        {isChanging ? '…' : perm.canAdd ? '✓ Add' : 'Add'}
                      </button>
                      <button
                        disabled={isChanging}
                        onClick={async () => {
                          setUserPermChanging(p => ({ ...p, [u.name]: true }));
                          await saveUserPerm(u.name, { ...perm, canBackDate: !perm.canBackDate });
                          setDrivers(getDrivers()); // re-render
                          setUserPermChanging(p => ({ ...p, [u.name]: false }));
                        }}
                        className={cn("h-7 px-2 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all border",
                          perm.canBackDate ? "bg-amber-600 text-white border-amber-600" : "bg-muted text-muted-foreground border-border hover:bg-amber-50"
                        )}
                      >
                        {isChanging ? '…' : perm.canBackDate ? '✓ Back Date' : 'Back Date'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* User Passwords Section — set per-user passwords (only when user-role staff exist) */}
        {drivers.filter(d => (d.role ?? 'driver') === 'user').length > 0 && (
          <div className="bg-card rounded-xl p-3 border border-orange-200 shadow-sm">
            <h2 className="text-[12px] font-black uppercase mb-1 flex items-center gap-2 text-orange-600">
              <Lock className="w-4 h-4" /> User Passwords
            </h2>
            <p className="text-[9px] font-bold text-muted-foreground uppercase mb-2 leading-tight">
              Har user ke liye alag password set karo. Woh apne password se directly login karenge (without name selection).
            </p>
            <div className="space-y-2">
              {drivers.filter(d => (d.role ?? 'driver') === 'user').map(u => {
                const isSaving = !!userPwSaving[u.name];
                const isSaved  = !!userPwSaved[u.name];
                const curPw = userPwInputs[u.name] ?? (getUserPassword(u.name) || '');
                return (
                  <div key={u.id} className="flex items-center gap-2 p-2 bg-orange-50 rounded-xl border border-orange-200/50">
                    <span className="text-[10px] font-black uppercase w-24 shrink-0 truncate">{u.name}</span>
                    <input
                      type="text"
                      placeholder="Password set karo..."
                      value={curPw}
                      onChange={e => setUserPwInputs(p => ({ ...p, [u.name]: e.target.value }))}
                      className="flex-1 h-7 px-2 bg-white rounded-lg text-[10px] font-black uppercase outline-none border border-orange-200 focus:border-orange-400 min-w-0"
                    />
                    <button
                      disabled={isSaving}
                      onClick={async () => {
                        setUserPwSaving(p => ({ ...p, [u.name]: true }));
                        setUserPwSaved(p => ({ ...p, [u.name]: false }));
                        const ok = await saveUserPassword(u.name, curPw.trim());
                        setUserPwSaving(p => ({ ...p, [u.name]: false }));
                        if (ok) {
                          setUserPwSaved(p => ({ ...p, [u.name]: true }));
                          setTimeout(() => setUserPwSaved(p => ({ ...p, [u.name]: false })), 2500);
                        }
                      }}
                      className={cn(
                        "h-7 px-2.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all border shrink-0",
                        isSaved ? "bg-emerald-600 text-white border-emerald-600" :
                        "bg-orange-600 text-white border-orange-600 hover:bg-orange-700"
                      )}
                    >
                      {isSaving ? '…' : isSaved ? '✓' : 'Save'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Row 4: Password + Data Purge */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="bg-card rounded-xl p-3 border border-border shadow-sm">
            <h2 className="text-[12px] font-black uppercase mb-2 flex items-center gap-2 text-primary"><ShieldCheck className="w-4 h-4" /> System Password</h2>
            <div className="bg-primary/5 p-2 rounded-xl border border-primary/10 mb-2">
               <p className="text-[9px] font-black text-primary uppercase tracking-widest leading-none mb-0.5">Live Password</p>
               <p className="text-lg font-black text-primary leading-tight">{getSystemPassword()}</p>
            </div>
            <div className="flex gap-2">
               <input type="text" inputMode="numeric" placeholder="PASSWORD SUFFIX" value={pwSuffix} onChange={e => setPwSuffix(e.target.value)} className="flex-1 h-9 px-3 bg-muted rounded-xl text-xs font-black uppercase outline-none border-0 focus:ring-2 focus:ring-primary/20" />
               <Button onClick={handleSaveSuffix} disabled={savingPw} className="h-9 px-4 rounded-xl font-black uppercase text-[10px] tracking-widest">
                 {savingPw ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Update Suffix'}
               </Button>
            </div>
          </div>

          <div className="bg-card rounded-xl p-3 border border-border shadow-sm">
            <h2 className="text-[12px] font-black uppercase mb-2 flex items-center gap-2 text-destructive"><Trash2 className="w-4 h-4" /> Data Purge</h2>
            <p className="text-[9px] font-bold text-muted-foreground uppercase mb-2 leading-tight">Careful! Permanently removes all ledger records between the selected dates (inclusive).</p>
            <div className="grid grid-cols-2 gap-2 mb-2">
               <div className="space-y-0.5">
                 <label className="text-[8px] font-black text-muted-foreground uppercase">From Date</label>
                 <input type="date" value={deleteDateFrom} onChange={e => setDeleteDateFrom(e.target.value)} className="w-full h-9 px-3 bg-muted rounded-xl text-xs font-black outline-none border-0 focus:ring-2 focus:ring-destructive/20" />
               </div>
               <div className="space-y-0.5">
                 <label className="text-[8px] font-black text-muted-foreground uppercase">To Date</label>
                 <input type="date" value={deleteDateTo} onChange={e => setDeleteDateTo(e.target.value)} className="w-full h-9 px-3 bg-muted rounded-xl text-xs font-black outline-none border-0 focus:ring-2 focus:ring-destructive/20" />
               </div>
            </div>
            <Button variant="destructive" onClick={handleDeleteDateRecords} disabled={!deleteDateFrom || !deleteDateTo} className="w-full h-9 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-destructive/10">Delete Range</Button>

            {/* ── Salesperson Merge (Replaced Merge Duplicate Bills) ──────── */}
            <div className="mt-2 pt-2 border-t border-border/50">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-black uppercase text-orange-600 tracking-wider">Salesperson Merge</span>
                <span className="text-[8px] font-bold text-muted-foreground uppercase">Updates all bills in DB</span>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  requestConfirm({
                    title: 'Merge Similar Salesperson Names (70%+ Match)',
                    message: 'All similar salesperson names across all bills and directory will be consolidated into standard clean names and synced to Supabase.',
                    confirmText: 'Merge Similar SPs',
                    variant: 'warning',
                    onConfirm: async () => {
                      const res = await consolidateSimilarSalespersonsOnly();
                      setPurgeMsg(`Salespersons Merge Complete! Merged: ${res.mergedSPs}, Bills Updated: ${res.updatedCount}`);
                      setTimeout(() => setPurgeMsg(''), 8000);
                    }
                  });
                }}
                className="w-full h-9 mb-2 rounded-xl font-black uppercase text-[10px] tracking-widest border-orange-400 text-orange-700 hover:bg-orange-50"
              >
                Merge Similar Salesperson Names (70% Match)
              </Button>
              {(() => {
                const contacts = getSalespersonContacts();
                const namesSet = new Set<string>();
                for (const c of contacts) if (c.name) namesSet.add(c.name);
                for (const b of getBills()) if (b.salespersonName) namesSet.add(b.salespersonName);
                const names = Array.from(namesSet).sort((a, b) => a.localeCompare(b));
                return (
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-1.5 mb-2">
                    <select
                      value={spMergeFrom}
                      onChange={(e) => { setSpMergeFrom(e.target.value); setSpMergeStatus('idle'); }}
                      className="h-8 px-2 bg-muted rounded-lg text-[10px] font-black uppercase outline-none border border-border focus:ring-1 focus:ring-orange-400"
                    >
                      <option value="">FROM SP</option>
                      {names.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <select
                      value={spMergeTo}
                      onChange={(e) => { setSpMergeTo(e.target.value); setSpMergeStatus('idle'); }}
                      className="h-8 px-2 bg-muted rounded-lg text-[10px] font-black uppercase outline-none border border-border focus:ring-1 focus:ring-orange-400"
                    >
                      <option value="">INTO SP</option>
                      {names.filter(n => n !== spMergeFrom).map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <Button
                      size="sm"
                      disabled={!spMergeFrom || !spMergeTo || spMergeStatus === 'loading'}
                      onClick={() => {
                        if (!spMergeFrom || !spMergeTo) return;
                        requestConfirm({
                          title: 'Merge Salespersons',
                          message: `"${spMergeFrom}" ke saare bills "${spMergeTo}" me merge ho jayenge aur sabhi bills me new name update ho jayega.`,
                          confirmText: 'Merge SPs',
                          variant: 'warning',
                          onConfirm: async () => {
                            setSpMergeStatus('loading');
                            try {
                              const res = await mergeTwoSalespersons(spMergeFrom, spMergeTo);
                              if (res.ok) {
                                setSpMergeStatus('done');
                                setPurgeMsg(`✓ ${res.billsUpdated} bills "${spMergeFrom}" → "${spMergeTo}" me merge ho gaye.`);
                                setSpMergeFrom('');
                                setSpMergeTo('');
                                setTimeout(() => setPurgeMsg(''), 8000);
                              } else {
                                setSpMergeStatus('error');
                                setPurgeMsg(`Error: ${res.error || 'Unknown error'}`);
                                setTimeout(() => setPurgeMsg(''), 8000);
                              }
                            } catch (err: any) {
                              setSpMergeStatus('error');
                              setPurgeMsg(`Error: ${String(err?.message ?? err)}`);
                              setTimeout(() => setPurgeMsg(''), 8000);
                            }
                          }
                        });
                      }}
                      className="h-8 px-3 rounded-lg font-black uppercase text-[9px] tracking-wider bg-orange-600 hover:bg-orange-700 text-white"
                    >
                      {spMergeStatus === 'loading' ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Merge'}
                    </Button>
                  </div>
                );
              })()}
            </div>

            <Button
              variant="outline"
              onClick={() => {
                requestConfirm({
                  title: 'Deduplicate Bank Names',
                  message: 'Deduplicate & clean all bank names in database and bills?',
                  confirmText: 'Clean Banks',
                  variant: 'warning',
                  onConfirm: async () => {
                    const { deduplicateBanks: dedupFn } = await import('@/lib/billStore');
                    const res = await dedupFn();
                    setBanks(getBanks());
                    setPurgeMsg(`Bank Deduplication Complete! Duplicate entries merged & cleaned: ${res.removed}`);
                    setTimeout(() => setPurgeMsg(''), 8000);
                  }
                });
              }}
              className="w-full h-9 mt-2 rounded-xl font-black uppercase text-[10px] tracking-widest border-sky-400 text-sky-800 hover:bg-sky-50"
            >
              Deduplicate Bank Names (DB)
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                requestConfirm({
                  title: 'Merge Similar Party Names (70%+ Match)',
                  message: 'All similar party names (like MAHALAXMI TRADERS & MAHALAXMI TRADER) will be consolidated into standard clean names across all bills and database.',
                  confirmText: 'Consolidate Parties',
                  variant: 'warning',
                  onConfirm: async () => {
                    const res = await consolidateSimilarPartiesOnly();
                    setPurgeMsg(`Similar Party Names Merging Complete! Parties: ${res.mergedParties}, Bills Updated: ${res.updatedCount}`);
                    setTimeout(() => setPurgeMsg(''), 8000);
                  }
                });
              }}
              className="w-full h-9 mt-2 rounded-xl font-black uppercase text-[10px] tracking-widest border-emerald-400 text-emerald-800 hover:bg-emerald-50"
            >
              Merge Similar Party Names (70% Match)
            </Button>
            {purgeMsg && (
              <p className="text-[10px] font-black uppercase text-center p-2 mt-2 rounded-xl bg-muted border border-border text-foreground">
                {purgeMsg}
              </p>
            )}
          </div>
        </div>

        {/* Bill Search Auto-Reset Timer */}
        <div className="bg-card rounded-xl p-3 border border-amber-300 shadow-sm">
          <h2 className="text-[12px] font-black uppercase mb-1 flex items-center gap-2 text-amber-700">
            <RotateCcw className="w-4 h-4" /> Bill Search Auto-Reset Time (Dashboard)
          </h2>
          <p className="text-[9px] font-bold text-muted-foreground uppercase mb-3 leading-tight">
            Dashboard par Bill No search input karne par kitne seconds baad auto reset / clear hoga (e.g. 2s, 4s, or OFF).
          </p>
          <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
            {[
              { label: '2 SEC', val: 2 },
              { label: '3 SEC', val: 3 },
              { label: '4 SEC', val: 4 },
              { label: '5 SEC', val: 5 },
              { label: 'OFF', val: 0 },
            ].map(opt => (
              <button
                key={opt.val}
                onClick={async () => {
                  setSearchResetSec(opt.val);
                  await saveBillSearchAutoResetSec(opt.val);
                  setSearchResetSaved(true);
                  setTimeout(() => setSearchResetSaved(false), 2000);
                }}
                className={cn(
                  "h-10 rounded-xl font-black text-[12px] uppercase border-2 transition-all flex items-center justify-center gap-1",
                  searchResetSec === opt.val
                    ? "bg-amber-600 text-white border-amber-600 shadow-md"
                    : "bg-muted text-foreground border-transparent hover:border-amber-300"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {searchResetSaved && (
            <p className="text-[9px] font-black uppercase text-emerald-600 mt-2 text-center">✓ Auto-reset time saved to {searchResetSec === 0 ? 'OFF' : `${searchResetSec} Seconds`}</p>
          )}
        </div>

        {/* Commission Months (MOC Master) */}
        <div className="bg-card rounded-xl p-3 border border-emerald-200 shadow-sm">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-[12px] font-black uppercase flex items-center gap-2 text-emerald-700">
              <span className="w-4 h-4 rounded bg-emerald-100 text-emerald-800 flex items-center justify-center font-black text-[10px]">₹</span>
              Commission Months (MOC Master)
            </h2>
            <button
              onClick={() => {
                const res = resetCommissionMocsToDefault(getBills());
                setCommissionMocs(res);
                setMocSavedMsg('Reset default MOC months (months with entries preserved)');
                setTimeout(() => setMocSavedMsg(''), 2500);
              }}
              className="text-[8px] font-black uppercase text-muted-foreground hover:text-emerald-700 border border-border px-1.5 py-0.5 rounded bg-muted/50 transition-colors"
            >
              Reset 12 Months
            </button>
          </div>
          <p className="text-[9px] font-bold text-muted-foreground uppercase mb-3 leading-tight">
            Configure commission MOC months (e.g. MAY = MOC 5, JUN = MOC 6, JUL = MOC 7, AUG = MOC 8). Dashboard me ye Bill No ke jese select hoga aur cash commission entry hogi. Agar kisi MOC month me entry exist karti hai to vah remove nahi hoga.
          </p>

          {/* Add New MOC Form */}
          <div className="flex flex-wrap gap-2 items-center mb-3 bg-emerald-50/60 p-2 rounded-xl border border-emerald-200/70">
            <input
              type="text"
              value={newMocMonth}
              onChange={e => setNewMocMonth(e.target.value.toUpperCase())}
              placeholder="MONTH (E.G. MAY)"
              className="flex-1 min-w-[120px] h-9 px-3 rounded-lg border border-emerald-300 bg-white text-xs font-black text-emerald-900 outline-none uppercase placeholder:text-muted-foreground/60 focus:border-emerald-500"
            />
            <input
              type="text"
              value={newMocCode}
              onChange={e => setNewMocCode(e.target.value.toUpperCase())}
              onKeyDown={e => {
                if (e.key === 'Enter' && newMocMonth.trim() && newMocCode.trim()) {
                  const updated = addCommissionMoc(newMocMonth, newMocCode);
                  setCommissionMocs(updated);
                  setNewMocMonth('');
                  setNewMocCode('');
                  setMocSavedMsg(`✓ Added ${newMocMonth.trim().toUpperCase()} = ${newMocCode.trim().toUpperCase()}`);
                  setTimeout(() => setMocSavedMsg(''), 2500);
                }
              }}
              placeholder="CODE (E.G. MOC 5)"
              className="flex-1 min-w-[120px] h-9 px-3 rounded-lg border border-emerald-300 bg-white text-xs font-black text-emerald-900 outline-none uppercase placeholder:text-muted-foreground/60 focus:border-emerald-500"
            />
            <button
              disabled={!newMocMonth.trim() || !newMocCode.trim()}
              onClick={() => {
                if (!newMocMonth.trim() || !newMocCode.trim()) return;
                const updated = addCommissionMoc(newMocMonth, newMocCode);
                setCommissionMocs(updated);
                setNewMocMonth('');
                setNewMocCode('');
                setMocSavedMsg(`✓ Added ${newMocMonth.trim().toUpperCase()} = ${newMocCode.trim().toUpperCase()}`);
                setTimeout(() => setMocSavedMsg(''), 2500);
              }}
              className="h-9 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black text-[11px] uppercase transition-all flex items-center gap-1 shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Month
            </button>
          </div>

          {/* List of Configured MOCs */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5 max-h-[220px] overflow-y-auto pr-1">
            {commissionMocs.map(moc => {
              const currentBills = getBills();
              const hasEntries = hasMocEntries(moc, currentBills);
              return (
                <div
                  key={moc.id}
                  className={cn(
                    "flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-xs font-black shadow-xs transition-all",
                    hasEntries
                      ? "border-emerald-300 bg-emerald-100/50 text-emerald-950"
                      : "border-emerald-200 bg-emerald-50/40 text-emerald-900"
                  )}
                >
                  <div className="flex flex-col">
                    <span className="text-[11px] tracking-tight">{moc.month} = {moc.code}</span>
                    {hasEntries && (
                      <span className="text-[7.5px] font-black text-emerald-700 uppercase tracking-tighter">
                        ● HAS ENTRIES
                      </span>
                    )}
                  </div>
                  {hasEntries ? (
                    <button
                      onClick={() => {
                        setMocSavedMsg(`⚠️ CANNOT REMOVE ${moc.month} = ${moc.code}: ENTRY EXISTS IN BILLS (LOCKED)`);
                        setTimeout(() => setMocSavedMsg(''), 4000);
                      }}
                      className="w-5 h-5 rounded flex items-center justify-center text-amber-600 hover:bg-amber-100/70 transition-colors ml-1"
                      title="Locked: Entries exist for this MOC month in bills"
                    >
                      <Lock className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        const res = deleteCommissionMoc(moc.id, getBills());
                        if (!res.success) {
                          setMocSavedMsg(`⚠️ ${res.error}`);
                          setTimeout(() => setMocSavedMsg(''), 4000);
                          return;
                        }
                        setCommissionMocs(res.updated);
                        setMocSavedMsg(`Removed ${moc.label}`);
                        setTimeout(() => setMocSavedMsg(''), 2000);
                      }}
                      className="w-5 h-5 rounded flex items-center justify-center text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-colors ml-1"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {mocSavedMsg && (
            <p className="text-[9px] font-black uppercase text-emerald-700 mt-2 text-center bg-emerald-100/70 py-1 rounded">
              {mocSavedMsg}
            </p>
          )}
          <p className="text-[8px] font-bold text-muted-foreground/70 uppercase mt-2 leading-tight">
            Dashboard search me type karein "MOC" ya Month name (e.g. MAY, MOC 5) — direct select hokar Commission Cash entry ho jayegi.
          </p>
        </div>

        {/* Font Size Control */}
        <div className="bg-card rounded-xl p-3 border border-border shadow-sm">
          <h2 className="text-[12px] font-black uppercase mb-2 flex items-center gap-2 text-primary"><Type className="w-4 h-4" /> App Font Size</h2>
          <p className="text-[9px] font-bold text-muted-foreground uppercase mb-3 leading-tight">Adjust the text size across the entire app.</p>
          <div className="grid grid-cols-4 gap-2">
            {([['XS', '0.82'], ['S', '0.9'], ['M', '1'], ['L', '1.12'], ['XL', '1.25']] as const).map(([label, val]) => (
              <button
                key={val}
                onClick={() => {
                  localStorage.setItem('vitratrack_font_zoom', val);
                  setFontZoom(val);
                  const root = document.getElementById('root');
                  if (root) root.style.zoom = val;
                  window.dispatchEvent(new Event('vitratrack-font-zoom'));
                }}
                className={cn(
                  "h-10 rounded-xl font-black text-[13px] uppercase border-2 transition-all",
                  fontZoom === val
                    ? "bg-primary text-primary-foreground border-primary shadow-md"
                    : "bg-muted text-foreground border-transparent hover:border-primary/40"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Backup & Restore */}
        <div className="bg-card rounded-xl p-3 border border-indigo-200 shadow-sm">
          <h2 className="text-[12px] font-black uppercase mb-1 flex items-center gap-2 text-indigo-600"><Archive className="w-4 h-4" /> Backup & Restore</h2>
          <p className="text-[9px] font-bold text-muted-foreground uppercase mb-0.5 leading-tight">
            Backup exports: Bills (100k min rows), Party (10k min rows), Salesperson (1k min rows), Banks (1k min rows), Drivers (1k min rows). Total 4500+ backup sheets data supported.
          </p>
          <p className="text-[9px] font-bold text-muted-foreground/60 uppercase mb-2 leading-tight">
            Restore: Backup file upload kijiye — bill no se match hoga, duplicate nahi banega
          </p>

          {/* ── Backup buttons row ── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
            {/* Full Backup */}
            <div className="space-y-1">
              <p className="text-[8px] font-black text-blue-700 uppercase tracking-wider px-0.5">Full Backup — All Bills (~4500+)</p>
              <Button
                onClick={handleBackupFull}
                disabled={backupFullStatus === 'loading'}
                className={cn(
                  "w-full h-9 rounded-xl font-black uppercase text-[10px] tracking-widest flex items-center justify-center gap-1.5",
                  backupFullStatus === 'ok'  ? "bg-emerald-600 hover:bg-emerald-700" :
                  backupFullStatus === 'err' ? "bg-destructive hover:bg-destructive/90" :
                  "bg-blue-600 hover:bg-blue-700"
                )}
              >
                {backupFullStatus === 'loading' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                {backupFullStatus === 'ok' ? '✓ Done!' : backupFullStatus === 'err' ? 'Retry' : 'Full Data Backup'}
              </Button>
              {backupFullStatus === 'loading' && backupFullProgress && (
                <p className="text-[8px] font-black text-blue-700 uppercase tracking-wider animate-pulse px-0.5">{backupFullProgress}</p>
              )}
            </div>

            {/* File 1: Paid + FBR */}
            <div className="space-y-1">
              <p className="text-[8px] font-black text-emerald-700 uppercase tracking-wider px-0.5">Paid + FBR Bills</p>
              <Button
                onClick={handleBackupPaidFbr}
                disabled={backupStatus === 'loading'}
                className={cn(
                  "w-full h-9 rounded-xl font-black uppercase text-[10px] tracking-widest flex items-center justify-center gap-1.5",
                  backupStatus === 'ok'  ? "bg-emerald-600 hover:bg-emerald-700" :
                  backupStatus === 'err' ? "bg-destructive hover:bg-destructive/90" :
                  "bg-emerald-700 hover:bg-emerald-800"
                )}
              >
                {backupStatus === 'loading' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                {backupStatus === 'ok' ? '✓ Done!' : backupStatus === 'err' ? 'Retry' : 'Paid+FBR Backup'}
              </Button>
              {backupStatus === 'loading' && backupProgress && (
                <p className="text-[8px] font-black text-emerald-700 uppercase tracking-wider animate-pulse px-0.5">{backupProgress}</p>
              )}
            </div>

            {/* File 2: Other bills */}
            <div className="space-y-1">
              <p className="text-[8px] font-black text-indigo-700 uppercase tracking-wider px-0.5">Credit · Unpaid · Del Pend</p>
              <Button
                onClick={handleBackupOther}
                disabled={backup2Status === 'loading'}
                className={cn(
                  "w-full h-9 rounded-xl font-black uppercase text-[10px] tracking-widest flex items-center justify-center gap-1.5",
                  backup2Status === 'ok'  ? "bg-emerald-600 hover:bg-emerald-700" :
                  backup2Status === 'err' ? "bg-destructive hover:bg-destructive/90" :
                  "bg-indigo-600 hover:bg-indigo-700"
                )}
              >
                {backup2Status === 'loading' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                {backup2Status === 'ok' ? '✓ Done!' : backup2Status === 'err' ? 'Retry' : 'Other Backup'}
              </Button>
              {backup2Status === 'loading' && backup2Progress && (
                <p className="text-[8px] font-black text-indigo-700 uppercase tracking-wider animate-pulse px-0.5">{backup2Progress}</p>
              )}
            </div>
          </div>

          {/* ── Restore button ── */}
          <div className="border-t border-indigo-100 pt-2">
            <p className="text-[8px] font-black text-muted-foreground uppercase tracking-wider mb-1 px-0.5">Restore — backup file upload kijiye</p>
            <Button
              onClick={() => restoreFileRef.current?.click()}
              disabled={restoreStatus?.status === 'loading'}
              variant="outline"
              className="w-full h-9 rounded-xl font-black uppercase text-[10px] tracking-widest flex items-center justify-center gap-1.5 border-indigo-300 text-indigo-600 hover:bg-indigo-50"
            >
              {restoreStatus?.status === 'loading' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
              Restore from Backup
            </Button>
            <input ref={restoreFileRef} type="file" accept=".xlsx,.xls" onChange={handleRestoreFile} className="hidden" />
            
            {pendingRestore && (
              <div className="mt-2 p-3 bg-indigo-50 border border-indigo-200 rounded-xl space-y-2">
                <p className="text-[10px] font-black uppercase text-indigo-800 tracking-wider">Confirm Restore Details</p>
                <p className="text-[9px] font-bold text-muted-foreground uppercase leading-tight">
                  File name: <span className="font-black text-indigo-950">{pendingRestore.fileName}</span>
                </p>
                <div className="bg-white rounded-lg p-2 border border-indigo-150 space-y-1">
                  <p className="text-[8px] font-black uppercase text-indigo-400 tracking-widest mb-1">Incoming Row Counts:</p>
                  {pendingRestore.stats.map((st, sidx) => (
                    <div key={sidx} className="flex justify-between items-center text-[9px] font-bold uppercase text-indigo-900">
                      <span>{st.label}</span>
                      <span className="font-black">{st.count.toLocaleString()} rows</span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() => executeRestore(pendingRestore.wb)}
                    className="flex-1 h-8 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[9px] font-black uppercase tracking-widest"
                  >
                    Confirm & Restore
                  </Button>
                  <Button
                    onClick={() => setPendingRestore(null)}
                    variant="outline"
                    className="h-8 border-indigo-300 text-indigo-600 hover:bg-indigo-100 rounded-xl text-[9px] font-black uppercase tracking-widest"
                  >
                    Cancel
                  </Button>
                </div>
                <p className="text-[8px] font-bold text-indigo-500 uppercase leading-normal">
                  * System will automatically download a backup file of your current data before executing the restore.
                </p>
              </div>
            )}

            {restoreStatus && restoreStatus.status !== 'loading' && (
              <ResultBox result={restoreStatus} onClear={() => setRestoreStatus(null)} />
            )}
            {restoreStatus?.status === 'loading' && (
              <p className="text-[9px] font-black text-indigo-600 uppercase tracking-wider animate-pulse px-1 mt-1">{restoreStatus.message}</p>
            )}
          </div>
        </div>



        {/* WhatsApp Templates */}
        <div className="bg-card rounded-3xl p-6 border border-border shadow-md">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[12px] font-black uppercase flex items-center gap-2 text-primary"><MessageSquare className="w-4 h-4" /> Intelligence Templates</h2>
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-black uppercase text-muted-foreground">Bulk WA Send</span>
              <button
                onClick={() => { const next = !waBulkEnabled; setWaBulkEnabled(next); saveWABulkSendEnabled(next); }}
                className={cn(
                  "relative w-10 h-5 rounded-full transition-colors duration-200 focus:outline-none shrink-0",
                  waBulkEnabled ? "bg-green-500" : "bg-muted-foreground/30"
                )}
              >
                <span className={cn(
                  "absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all duration-200",
                  waBulkEnabled ? "left-5" : "left-0.5"
                )} />
              </button>
              <span className={cn("text-[9px] font-black uppercase", waBulkEnabled ? "text-green-600" : "text-muted-foreground")}>
                {waBulkEnabled ? "ON" : "OFF"}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
             <div className="space-y-2">
               <label className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">Pending Bill Alert</label>
               <textarea value={waTemplates.pending} onChange={e => setWaTemplates({...waTemplates, pending: e.target.value})} className="h-40 w-full p-4 bg-muted rounded-2xl text-[10px] font-bold uppercase outline-none border border-border/50 focus:border-primary/50 transition-colors" />
             </div>
             <div className="space-y-2">
               <label className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">FBR Return Alert</label>
               <textarea value={waTemplates.fbr} onChange={e => setWaTemplates({...waTemplates, fbr: e.target.value})} className="h-40 w-full p-4 bg-muted rounded-2xl text-[10px] font-bold uppercase outline-none border border-border/50 focus:border-primary/50 transition-colors" />
             </div>
             <div className="space-y-2">
               <label className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">Cheque Return Alert</label>
               <textarea value={waTemplates.returnCheque} onChange={e => setWaTemplates({...waTemplates, returnCheque: e.target.value})} className="h-40 w-full p-4 bg-muted rounded-2xl text-[10px] font-bold uppercase outline-none border border-border/50 focus:border-primary/50 transition-colors" />
               <p className="text-[8px] text-muted-foreground font-bold uppercase">Variables: {'{{allBillNos}} {{totalAmt}} {{chequeAmt}} {{chequeNo}} {{chequeDate}} {{bankName}} {{partyName}}'}</p>
             </div>
          </div>
          <Button
            onClick={async () => {
              const ok = await saveWhatsAppTemplates(waTemplates);
              setWaSavedMsg(ok ? '✓ TEMPLATES SAVED TO DATABASE' : '✕ SAVE FAILED — CHECK INTERNET');
              setTimeout(() => setWaSavedMsg(''), 4000);
            }}
            className="w-full mt-6 h-14 rounded-2xl font-black uppercase text-xs tracking-widest shadow-lg shadow-primary/10"
          >
            Save Global Templates
          </Button>
          {waSavedMsg && (
            <p className="text-[11px] font-black uppercase text-center mt-2 p-2 rounded-xl bg-primary/10 text-primary">
              {waSavedMsg}
            </p>
          )}
        </div>

        <GreenPartyManagerModal
          isOpen={isGreenPartyModalOpen}
          onClose={() => setIsGreenPartyModalOpen(false)}
        />

        <ConfirmModal
          isOpen={confirmDialog.isOpen}
          title={confirmDialog.title}
          message={confirmDialog.message}
          details={confirmDialog.details}
          confirmText={confirmDialog.confirmText}
          cancelText={confirmDialog.cancelText}
          variant={confirmDialog.variant}
          loading={confirmLoading}
          onConfirm={handleConfirmModal}
          onCancel={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
        />
      </div>
    </div>
  );
}
