import { markWriteStart, markWriteEnd } from './syncState';
import { cleanSalespersonName, cleanPartyName, standardizeBills, calculateSimilarity, isSimilar, findCanonicalName, buildCanonicalMap, areSalespersonNamesEquivalent } from './nameStandardizer';
import { getRole } from './auth';
import { getGreenPartyNameByCode, loadGreenPartiesFromSettings, getGreenParties } from './greenParties';
import { excelSerialToDate, isoToDisplay, displayToIso } from './dateUtils';

function getTodayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export { cleanSalespersonName, cleanPartyName, standardizeBills, calculateSimilarity, isSimilar, findCanonicalName, buildCanonicalMap, areSalespersonNamesEquivalent };

/** One immutable audit line for a bill — who did what, when. Never overwritten. */
export type BillEditEntry = {
  /** Sequence number: 1st, 2nd, 3rd edit … */
  seq: number;
  /** Entry date DD/MM/YYYY */
  date: string;
  /** Time HH:MM */
  time: string;
  /** Person name: user / owner / driver name */
  by: string;
  /** Role at the time of the edit */
  role: string;
  /** 'add' | 'edit' */
  action: string;
  /** Payment mode / status saved with this edit */
  mode?: string;
  /** Collected amount at this edit */
  amount?: number;
  /** Short list of changed fields */
  changes?: string;
};

function nowDMY(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}
function nowHM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function currentActor(explicit?: string): { by: string; role: string } {
  let role = '';
  let name = '';
  try { role = getRole() || ''; } catch { role = ''; }
  try { name = sessionStorage.getItem('vitratrack_user_name') || ''; } catch { name = ''; }
  const by = (explicit && explicit.trim()) || name || (role ? role.toUpperCase() : 'UNKNOWN');
  return { by: by.toUpperCase(), role: role || 'unknown' };
}

/** Appends an audit line to a bill's history (keeps max 100 entries). */
export function appendEditHistory(
  existing: BillEditEntry[] | undefined,
  entry: Omit<BillEditEntry, 'seq' | 'date' | 'time' | 'by' | 'role'> & { by?: string },
): BillEditEntry[] {
  const prev = Array.isArray(existing) ? existing : [];
  const actor = currentActor(entry.by);
  const line: BillEditEntry = {
    seq: prev.length + 1,
    date: nowDMY(),
    time: nowHM(),
    by: actor.by,
    role: actor.role,
    action: entry.action,
    mode: entry.mode,
    amount: entry.amount,
    changes: entry.changes,
  };
  const next = [...prev, line];
  return next.length > 100 ? next.slice(next.length - 100) : next;
}


export type Bill = {
  id: string;
  srNo: string;
  date: string;
  salespersonName: string;
  collectionCode: string;
  billNo: string;
  partyCode: string;
  partyHulCode: string;
  partyName: string;
  beatName: string;
  billNetAmt: number;
  collectedAmount: number;
  outstandingAmount: number;
  billAgeing: number;
  deliveryDate?: string;
  paymentMode?: string;
  paymentMethod?: string;
  paymentDate?: string;
  paymentTime?: string;
  driverName?: string;
  chequeNo?: string;
  chequeDate?: string;
  bankName?: string;
  nextBillNo?: string;
  cancelLine?: string;
  lineCutAmt?: number;
  discrepancyReason?: string;
  cashAmount?: number;
  upiAmount?: number;
  chequeAmount?: number;
  delPendingHistory?: Array<{ driverName: string; deliveryDate: string }>;
  editHistory?: BillEditEntry[];
  /** Last edit stamp: "DD/MM/YYYY HH:MM" */
  editDate?: string;
  /** Last non-owner (user/driver) who touched the bill */
  user?: string;
  /** Last owner who touched the bill */
  owner?: string;
  partPayments?: Array<{ date: string; cash: number; upi: number; cheque: number; amount: number; chequeNo?: string; bankName?: string; mode?: string; enteredBy?: string }>;
  deliveryStatus?: string;
};

export type Driver = {
  id: string;
  name: string;
  role?: 'driver' | 'owner' | 'user';
};

export function getDriverRole(id: string): 'driver' | 'owner' | 'user' {
  if (id.startsWith('own_')) return 'owner';
  if (id.startsWith('usr_')) return 'user';
  return 'driver';
}

export type Bank = {
  id: string;
  name: string;
};

export type Contact = {
  id?: string;
  name: string;
  mobile: string;
};

export type CashBreakdown = {
  n500: number;
  n200: number;
  n100: number;
  n50: number;
  n20: number;
  n10: number;
  coins: number;
};

export type DriverDailySummary = {
  id: string;
  driverName: string;
  date: string;
  totalBillCount: number;
  totalAmount: number;
  cashBreakdown?: CashBreakdown;
};

export type WhatsAppTemplates = {
  pending: string;
  fbr: string;
  returnCheque: string;
};

// ─── Local Persistence (localStorage + IndexedDB fallback) ─────────────────────
const LS_BILLS_KEY = 'vt_cached_bills_v2';
const LS_DRIVERS_KEY = 'vt_cached_drivers_v2';
const LS_BANKS_KEY = 'vt_cached_banks_v2';
const LS_SUMMARIES_KEY = 'vt_cached_summaries_v2';
const LS_PARTY_CONTACTS_KEY = 'vt_cached_party_contacts_v2';
const LS_SALESPERSON_CONTACTS_KEY = 'vt_cached_salesperson_contacts_v2';

const DB_NAME = 'vitratrack_db_v2';
const DB_VERSION = 1;
const STORE_KEYVAL = 'keyval';

let _idbInstance: Promise<IDBDatabase | null> | null = null;

function getIDB(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !window.indexedDB) return Promise.resolve(null);
  if (!_idbInstance) {
    _idbInstance = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_KEYVAL)) {
            db.createObjectStore(STORE_KEYVAL);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => {
          _idbInstance = null;
          resolve(null);
        };
      } catch {
        _idbInstance = null;
        resolve(null);
      }
    });
  }
  return _idbInstance;
}

export async function idbSet(key: string, val: any): Promise<void> {
  const db = await getIDB();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_KEYVAL, 'readwrite');
      const store = tx.objectStore(STORE_KEYVAL);
      store.put(val, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function idbSetMany(entries: Record<string, any>): Promise<void> {
  const db = await getIDB();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_KEYVAL, 'readwrite');
      const store = tx.objectStore(STORE_KEYVAL);
      for (const [k, v] of Object.entries(entries)) {
        if (v !== undefined) {
          store.put(v, k);
        }
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function idbGet<T>(key: string): Promise<T | null> {
  const db = await getIDB();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_KEYVAL, 'readonly');
      const store = tx.objectStore(STORE_KEYVAL);
      const req = store.get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

export function persistLocalState(immediate = false) {
  if (typeof window === 'undefined') return;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (immediate) {
    doPersistLocalState();
    return;
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      window.requestIdleCallback(() => doPersistLocalState(), { timeout: 1500 });
    } else {
      doPersistLocalState();
    }
  }, 1000);
}

function doPersistLocalState() {
  const idbPayload: Record<string, any> = {};
  try {
    if (_bills.length > 0) {
      localStorage.setItem(LS_BILLS_KEY, JSON.stringify(_bills.slice(0, 400)));
      idbPayload['cached_bills_full'] = _bills;
    }
    if (_drivers.length > 0) {
      localStorage.setItem(LS_DRIVERS_KEY, JSON.stringify(_drivers));
      idbPayload['cached_drivers'] = _drivers;
    }
    if (_banks.length > 0) {
      localStorage.setItem(LS_BANKS_KEY, JSON.stringify(_banks));
      idbPayload['cached_banks'] = _banks;
    }
    if (_summaries.length > 0) {
      localStorage.setItem(LS_SUMMARIES_KEY, JSON.stringify(_summaries));
      idbPayload['cached_summaries'] = _summaries;
    }
    if (_partyContacts.length > 0) {
      localStorage.setItem(LS_PARTY_CONTACTS_KEY, JSON.stringify(_partyContacts));
      idbPayload['cached_party_contacts'] = _partyContacts;
    }
    if (_salespersonContacts.length > 0) {
      localStorage.setItem(LS_SALESPERSON_CONTACTS_KEY, JSON.stringify(_salespersonContacts));
      idbPayload['cached_salesperson_contacts'] = _salespersonContacts;
    }
  } catch (err) {
    console.warn('[billStore] localStorage quota limit, offloading to IndexedDB', err);
    if (_bills.length > 0) idbPayload['cached_bills_full'] = _bills;
    if (_salespersonContacts.length > 0) idbPayload['cached_salesperson_contacts'] = _salespersonContacts;
    if (_partyContacts.length > 0) idbPayload['cached_party_contacts'] = _partyContacts;
  }

  if (Object.keys(idbPayload).length > 0) {
    idbSetMany(idbPayload).catch(() => {});
  }
}

// ─── In-memory store (server is the source of truth) ──────────────────────────
let _bills: Bill[] = [];
let _drivers: Driver[] = [];
let _banks: Bank[] = [];
let _summaries: DriverDailySummary[] = [];
let _partyContacts: Contact[] = [];
let _salespersonContacts: Contact[] = [];

// Hydrate state synchronously from localStorage on startup
if (typeof window !== 'undefined') {
  try {
    const rawBills = localStorage.getItem(LS_BILLS_KEY);
    if (rawBills) {
      const parsed = JSON.parse(rawBills);
      if (Array.isArray(parsed) && parsed.length > 0) _bills = parsed;
    }
    const rawDrivers = localStorage.getItem(LS_DRIVERS_KEY);
    if (rawDrivers) {
      const parsed = JSON.parse(rawDrivers);
      if (Array.isArray(parsed) && parsed.length > 0) _drivers = parsed;
    }
    const rawBanks = localStorage.getItem(LS_BANKS_KEY);
    if (rawBanks) {
      const parsed = JSON.parse(rawBanks);
      if (Array.isArray(parsed) && parsed.length > 0) _banks = parsed;
    }
    const rawSummaries = localStorage.getItem(LS_SUMMARIES_KEY);
    if (rawSummaries) {
      const parsed = JSON.parse(rawSummaries);
      if (Array.isArray(parsed) && parsed.length > 0) _summaries = parsed;
    }
    const rawPartyContacts = localStorage.getItem(LS_PARTY_CONTACTS_KEY);
    if (rawPartyContacts) {
      const parsed = JSON.parse(rawPartyContacts);
      if (Array.isArray(parsed) && parsed.length > 0) _partyContacts = parsed;
    }
    const rawSalesContacts = localStorage.getItem(LS_SALESPERSON_CONTACTS_KEY);
    if (rawSalesContacts) {
      const parsed = JSON.parse(rawSalesContacts);
      if (Array.isArray(parsed) && parsed.length > 0) _salespersonContacts = parsed;
    }
  } catch (e) {
    console.warn('[billStore] Sync hydration error', e);
  }

  // Check IndexedDB for cached contacts and full bills list asynchronously
  idbGet<Bill[]>('cached_bills_full').then((fullBills) => {
    if (fullBills && Array.isArray(fullBills) && fullBills.length > _bills.length) {
      _bills = fullBills;
      dispatchUpdate();
    }
  }).catch(() => {});

  idbGet<Contact[]>('cached_salesperson_contacts').then((cached) => {
    if (cached && Array.isArray(cached) && cached.length > 0) {
      // Merge with in-memory contacts
      const localMap = new Map(_salespersonContacts.map(c => [(c.name || '').trim().toLowerCase(), c]));
      let changed = false;
      for (const c of cached) {
        const k = (c.name || '').trim().toLowerCase();
        if (k && !localMap.has(k)) {
          _salespersonContacts.push(c);
          changed = true;
        }
      }
      if (changed) dispatchUpdate();
    }
  }).catch(() => {});
}

// ─── In-memory settings ───────────────────────────────────────────────────────
// pw_suffix is cached in localStorage so login works instantly on reload
// even before Supabase responds (cold-start protection).
const LS_PW_SUFFIX = 'vt_pw_suffix';
const LS_SEARCH_RESET_SEC = 'vt_search_reset_sec';
const LS_USER_PASSWORDS = 'vt_user_passwords';
const LS_USER_PERMS = 'vt_user_perms';
const LS_CREDIT_ASSIGNS = 'vitratrack_credit_assigns_v2';

export type CreditAssign = {
  givenTo?: string;
  giveDate?: string;
  giveTime?: string;
  isGiven?: boolean;
};

let _creditAssigns: Record<string, CreditAssign> = (() => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(LS_CREDIT_ASSIGNS) || localStorage.getItem('vitratrack_credit_assigns');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
})();

export function getCreditAssigns(): Record<string, CreditAssign> {
  return _creditAssigns;
}

export function saveCreditAssigns(assigns: Record<string, CreditAssign>) {
  _creditAssigns = { ...assigns };
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(LS_CREDIT_ASSIGNS, JSON.stringify(assigns));
      localStorage.setItem('vitratrack_credit_assigns', JSON.stringify(assigns));
    } catch {}
  }
  try {
    import('./apiSync').then(({ apiPushSetting }) => {
      void apiPushSetting('credit_assigns', JSON.stringify(assigns));
    }).catch(() => {});
  } catch {}
  dispatchUpdate();
}

let _pwSuffix: string = localStorage.getItem(LS_PW_SUFFIX) || 'manoj';
let _billSearchAutoResetSec: number = Number(localStorage.getItem(LS_SEARCH_RESET_SEC) ?? 4);
let _waTemplates: WhatsAppTemplates | null = null;
// User permissions: name → {canEdit, canAdd, canBackDate}
let _userPerms: Record<string, { canEdit: boolean; canAdd: boolean; canBackDate?: boolean }> = (() => {
  try {
    return JSON.parse(localStorage.getItem(LS_USER_PERMS) || '{}');
  } catch {
    return {};
  }
})();
// User passwords: name → custom password string (owner can set per-user)
let _userPasswords: Record<string, string> = (() => {
  try {
    return JSON.parse(localStorage.getItem(LS_USER_PASSWORDS) || '{}');
  } catch {
    return {};
  }
})();

export function setServerData(data: {
  bills?: Bill[];
  drivers?: Driver[];
  banks?: Bank[];
  summaries?: DriverDailySummary[];
  partyContacts?: Contact[];
  salespersonContacts?: Contact[];
  settings?: Record<string, string>;
}) {
  if (data.settings) {
    loadGreenPartiesFromSettings(data.settings);
  }

  if (data.bills !== undefined) {
    // Keep the sync path cheap: exact cleanup is deterministic and fast.
    const seen = new Map<string, Bill>();
    for (const b of data.bills) {
      const mode = (b.paymentMode || '').toLowerCase();
      const hasMoney = (Number(b.cashAmount) || 0) > 0 || (Number(b.upiAmount) || 0) > 0 || (Number(b.chequeAmount) || 0) > 0 || (Number(b.collectedAmount) || 0) > 0;
      const isCredit = mode === 'credit';
      const isDelPend = mode === 'del pending' || mode === 'pending';
      const isUnpaid = mode === 'unpaid';
      const isFBR = mode === 'fbr' || mode === 'cancel';
      const isPaid = mode === 'paid' || mode === 'cash' || mode === 'upi' || mode === 'cheque' || mode === 'split';
      // Credit / Del Pending / Unpaid without money received should not have paymentDate
      const shouldHaveDate = hasMoney || isFBR || isPaid || (!isCredit && !isDelPend && !isUnpaid && !!b.paymentDate);
      const cleanedPaymentDate = shouldHaveDate ? (b.paymentDate || '') : '';
      const cleanedPaymentTime = shouldHaveDate ? (b.paymentTime || '') : '';
      const greenName = getGreenPartyNameByCode(b.partyCode);
      const cleaned = {
        ...b,
        paymentDate: cleanedPaymentDate,
        paymentTime: cleanedPaymentTime,
        partyName: greenName || cleanPartyName(b.partyName),
        salespersonName: cleanSalespersonName(b.salespersonName),
      };
      const isMoc = (b.billNo || '').toUpperCase().startsWith('MOC') || b.collectionCode === 'MOC' || b.salespersonName === 'MOC' || (b.id && b.id.startsWith('moc_'));
      const key = isMoc ? (b.id || b.billNo) : (b.billNo || b.id);
      seen.set(key, cleaned);
    }
    _bills = Array.from(seen.values());
  }
  if (data.drivers !== undefined) {
    _drivers = data.drivers;
    // Cache only user-role names for login page chips (not drivers, not owners)
    try {
      const userNames = data.drivers
        .filter(d => d.role === 'user')
        .map(d => d.name);
      localStorage.setItem('vt_staff_names', JSON.stringify(userNames));
    } catch {}
  }
  if (data.banks !== undefined) {
    const seen = new Map<string, Bank>();
    for (const b of data.banks) {
      const name = String(b.name || '').trim().toUpperCase();
      if (!name) continue;
      if (!seen.has(name)) {
        seen.set(name, { id: b.id || `bn_${Math.random().toString(36).slice(2, 9)}`, name });
      }
    }
    _banks = Array.from(seen.values());
  }
  if (data.summaries !== undefined) _summaries = data.summaries;
  if (data.partyContacts !== undefined) {
    const localMap = new Map(_partyContacts.map(c => [c.id || (c.name || '').trim().toLowerCase(), c]));
    const merged = data.partyContacts.map(s => {
      const l = localMap.get(s.id || (s.name || '').trim().toLowerCase());
      if (l && l.mobile && (!s.mobile || s.mobile.trim() === '')) {
        return { ...s, mobile: l.mobile };
      }
      return s;
    });
    const serverKeys = new Set(data.partyContacts.map(c => c.id || (c.name || '').trim().toLowerCase()));
    for (const [k, l] of localMap) {
      if (k && !serverKeys.has(k) && l.mobile) merged.push(l);
    }
    _partyContacts = merged;
  }
  if (data.salespersonContacts !== undefined) {
    const localMap = new Map(_salespersonContacts.map(c => [
      cleanSalespersonName(c.name || '').trim().toLowerCase() || (c.name || '').trim().toLowerCase(),
      c
    ]));
    const merged = data.salespersonContacts.map(s => {
      const cleanName = cleanSalespersonName(s.name || '').trim() || (s.name || '').trim();
      const key = cleanName.toLowerCase();
      const l = localMap.get(key);
      if (l && l.mobile && (!s.mobile || s.mobile.trim() === '')) {
        return { ...s, name: cleanName, mobile: l.mobile };
      }
      return { ...s, name: cleanName };
    });
    const serverKeys = new Set(data.salespersonContacts.map(c => 
      cleanSalespersonName(c.name || '').trim().toLowerCase() || (c.name || '').trim().toLowerCase()
    ));
    for (const [k, l] of localMap) {
      if (k && !serverKeys.has(k) && l.mobile) merged.push({ ...l, name: cleanSalespersonName(l.name || '').trim() || l.name });
    }
    _salespersonContacts = merged;
  }

  persistLocalState();

  if (data.settings?.['pw_suffix']) {
    _pwSuffix = data.settings['pw_suffix'];
    localStorage.setItem(LS_PW_SUFFIX, _pwSuffix);   // cache for instant login on reload
  }
  if (data.settings?.['wa_templates']) {
    try { _waTemplates = JSON.parse(data.settings['wa_templates']); } catch { /* ignore */ }
  }
  if (data.settings?.['user_perms']) {
    try {
      _userPerms = JSON.parse(data.settings['user_perms']);
      localStorage.setItem(LS_USER_PERMS, JSON.stringify(_userPerms));
    } catch { /* ignore */ }
  }
  if (data.settings?.['user_passwords']) {
    try {
      _userPasswords = JSON.parse(data.settings['user_passwords']);
      localStorage.setItem(LS_USER_PASSWORDS, JSON.stringify(_userPasswords));
    } catch { /* ignore */ }
  }
  if (data.settings?.['bill_search_reset_sec']) {
    const sec = Number(data.settings['bill_search_reset_sec']);
    if (!isNaN(sec)) {
      _billSearchAutoResetSec = sec;
      localStorage.setItem(LS_SEARCH_RESET_SEC, String(sec));
    }
  }
  if (data.settings?.['credit_assigns']) {
    try {
      const serverAssigns = JSON.parse(data.settings['credit_assigns']);
      if (serverAssigns && typeof serverAssigns === 'object') {
        _creditAssigns = { ..._creditAssigns, ...serverAssigns };
        localStorage.setItem(LS_CREDIT_ASSIGNS, JSON.stringify(_creditAssigns));
        localStorage.setItem('vitratrack_credit_assigns', JSON.stringify(_creditAssigns));
      }
    } catch { /* ignore */ }
  }
}

// ─── Direct Realtime incremental mutators ──────────────────────────────────
export function applyRealtimeBillChange(
  eventType: 'INSERT' | 'UPDATE' | 'DELETE',
  newBill?: Bill,
  oldBillId?: string,
  oldBillNo?: string
) {
  if (eventType === 'DELETE') {
    const targetId = oldBillId || newBill?.id;
    const targetBillNo = oldBillNo || newBill?.billNo;
    if (!targetId && !targetBillNo) return;
    const normBn = (targetBillNo || '').trim().toUpperCase();
    _bills = _bills.filter(b => {
      if (targetId && b.id === targetId) return false;
      if (normBn && (b.billNo || '').trim().toUpperCase() === normBn) return false;
      return true;
    });
    dispatchUpdate();
    persistLocalState();
    return;
  }

  if (!newBill) return;

  const mode = (newBill.paymentMode || '').toLowerCase();
  const hasMoney = (Number(newBill.cashAmount) || 0) > 0 || (Number(newBill.upiAmount) || 0) > 0 || (Number(newBill.chequeAmount) || 0) > 0 || (Number(newBill.collectedAmount) || 0) > 0;
  const isCredit = mode === 'credit';
  const isDelPend = mode === 'del pending' || mode === 'pending';
  const isUnpaid = mode === 'unpaid';
  const isFBR = mode === 'fbr' || mode === 'cancel';
  const isPaid = mode === 'paid' || mode === 'cash' || mode === 'upi' || mode === 'cheque' || mode === 'split';
  const shouldHaveDate = hasMoney || isFBR || isPaid || (!isCredit && !isDelPend && !isUnpaid && !!newBill.paymentDate);
  const greenName = getGreenPartyNameByCode(newBill.partyCode);
  const cleaned: Bill = {
    ...newBill,
    paymentDate: shouldHaveDate ? (newBill.paymentDate || '') : '',
    paymentTime: shouldHaveDate ? (newBill.paymentTime || '') : '',
    partyName: greenName || cleanPartyName(newBill.partyName),
    salespersonName: cleanSalespersonName(newBill.salespersonName),
  };

  const normBn = (cleaned.billNo || '').trim().toUpperCase();
  const isMoc = normBn.startsWith('MOC') || cleaned.collectionCode === 'MOC' || cleaned.salespersonName === 'MOC' || (cleaned.id && cleaned.id.startsWith('moc_'));

  const idx = _bills.findIndex(b => {
    if (cleaned.id && b.id === cleaned.id) return true;
    if (!isMoc && normBn && (b.billNo || '').trim().toUpperCase() === normBn) return true;
    return false;
  });

  if (idx >= 0) {
    const nextBills = [..._bills];
    nextBills[idx] = { ...nextBills[idx], ...cleaned };
    _bills = nextBills;
  } else {
    _bills = [cleaned, ..._bills];
  }

  dispatchUpdate();
  persistLocalState();
}

export function applyRealtimeTableChange(
  table: string,
  eventType: 'INSERT' | 'UPDATE' | 'DELETE',
  record: any,
  oldRecord: any
) {
  if (table === 'bills') {
    return; // Handled by applyRealtimeBillChange
  }

  if (table === 'drivers') {
    const id = record?.id || oldRecord?.id;
    if (eventType === 'DELETE') {
      _drivers = _drivers.filter(d => d.id !== id);
    } else if (record) {
      const driver: Driver = {
        id: record.id,
        name: record.name,
        role: record.id?.startsWith('own_') ? 'owner' : record.id?.startsWith('usr_') ? 'user' : 'driver',
      };
      const dName = (driver.name || '').trim().toLowerCase();
      const idx = _drivers.findIndex(d => d.id === driver.id || (dName && (d.name || '').trim().toLowerCase() === dName));
      if (idx >= 0) _drivers[idx] = driver;
      else _drivers.push(driver);
    }
    dispatchUpdate();
    persistLocalState();
    return;
  }

  if (table === 'banks') {
    const id = record?.id || oldRecord?.id;
    const name = String(record?.name || oldRecord?.name || '').trim().toUpperCase();
    if (eventType === 'DELETE') {
      _banks = _banks.filter(b => b.id !== id && (b.name || '').toUpperCase() !== name);
    } else if (record && name) {
      const bank: Bank = { id: record.id || `bn_${Math.random().toString(36).slice(2, 9)}`, name };
      const idx = _banks.findIndex(b => b.id === bank.id || (b.name || '').toUpperCase() === name);
      if (idx >= 0) _banks[idx] = bank;
      else _banks.push(bank);
    }
    dispatchUpdate();
    persistLocalState();
    return;
  }

  if (table === 'contacts') {
    const id = record?.id || oldRecord?.id;
    const isParty = record?.type === 'party' || oldRecord?.type === 'party';
    const isSales = record?.type === 'salesperson' || oldRecord?.type === 'salesperson';

    if (eventType === 'DELETE') {
      if (isParty || !isSales) _partyContacts = _partyContacts.filter(c => c.id !== id);
      if (isSales || !isParty) _salespersonContacts = _salespersonContacts.filter(c => c.id !== id);
    } else if (record) {
      const contact: Contact = { id: record.id, name: record.name, mobile: record.mobile };
      if (record.type === 'party') {
        const idx = _partyContacts.findIndex(c => c.id === contact.id || (c.name || '').trim().toLowerCase() === (contact.name || '').trim().toLowerCase());
        if (idx >= 0) _partyContacts[idx] = contact;
        else _partyContacts.push(contact);
      } else if (record.type === 'salesperson') {
        const cleanSp = cleanSalespersonName(contact.name);
        const idx = _salespersonContacts.findIndex(c => c.id === contact.id || cleanSalespersonName(c.name || '').trim().toLowerCase() === cleanSp.trim().toLowerCase());
        if (idx >= 0) _salespersonContacts[idx] = contact;
        else _salespersonContacts.push(contact);
      }
    }
    dispatchUpdate();
    persistLocalState();
    return;
  }

  if (table === 'settings') {
    if (record && record.key) {
      const key = record.key;
      const value = record.value;
      if (key === 'pw_suffix') {
        _pwSuffix = value;
        localStorage.setItem(LS_PW_SUFFIX, _pwSuffix);
      } else if (key === 'wa_templates') {
        try { _waTemplates = JSON.parse(value); } catch {}
      } else if (key === 'user_perms') {
        try {
          _userPerms = JSON.parse(value);
          localStorage.setItem(LS_USER_PERMS, JSON.stringify(_userPerms));
        } catch {}
      } else if (key === 'user_passwords') {
        try {
          _userPasswords = JSON.parse(value);
          localStorage.setItem(LS_USER_PASSWORDS, JSON.stringify(_userPasswords));
        } catch {}
      } else if (key === 'bill_search_reset_sec') {
        const sec = Number(value);
        if (!isNaN(sec)) {
          _billSearchAutoResetSec = sec;
          localStorage.setItem(LS_SEARCH_RESET_SEC, String(sec));
        }
      }
      dispatchUpdate();
    }
    return;
  }
}

// ─── Read functions ─────────────────────────────────────────────────────────
export function getBills(): Bill[] { return _bills; }
export function getDrivers(): Driver[] {
  const hasPratixa = _drivers.some(d => (d.name || '').trim().toUpperCase() === 'PRATIXA');
  if (!hasPratixa) {
    return [..._drivers, { id: 'usr_pratixa', name: 'Pratixa', role: 'user' }];
  }
  return _drivers;
}
export function getBanks(): Bank[] { return _banks; }
export function getSummaries(): DriverDailySummary[] { return _summaries; }
export function getPartyContacts(): Contact[] { return _partyContacts; }
export function getSalespersonContacts(): Contact[] { return _salespersonContacts; }

/**
 * Robust lookup helper for salesperson contact:
 * Handles exact match, clean names (without (ME), TL, (TL), (FL) suffix or prefix codes),
 * token reordering (surname front/back), ID match, and case-insensitive matching.
 */
export function findSalespersonContact(spName: string): Contact | undefined {
  if (!spName) return undefined;
  const raw = String(spName).trim();
  if (!raw) return undefined;
  const rawLower = raw.toLowerCase();
  const clean = cleanSalespersonName(raw).trim();
  const cleanLower = clean.toLowerCase();

  let contacts = _salespersonContacts;
  if ((!contacts || contacts.length === 0) && typeof window !== 'undefined') {
    try {
      const cached = localStorage.getItem(LS_SALESPERSON_CONTACTS_KEY);
      if (cached) contacts = JSON.parse(cached);
    } catch {}
  }
  if (!contacts || contacts.length === 0) return undefined;

  // 1. Exact name match
  let found = contacts.find(c => (c.name || '').trim().toLowerCase() === rawLower);
  if (found) return found;

  // 2. Clean name match (e.g. without code prefix/suffix or (ME)/(TL)/(FL))
  if (cleanLower) {
    found = contacts.find(c => {
      const cClean = cleanSalespersonName(c.name || '').trim().toLowerCase();
      const cRaw = (c.name || '').trim().toLowerCase();
      return cClean === cleanLower || cRaw === cleanLower;
    });
    if (found) return found;
  }

  // 3. Match equivalent salesperson name (handles surname front vs back e.g. "SHARMA RAHUL" vs "RAHUL SHARMA")
  found = contacts.find(c => areSalespersonNamesEquivalent(c.name || '', raw) || areSalespersonNamesEquivalent(c.name || '', clean));
  if (found) return found;

  // 4. Match by ID
  const spId = `sp_${cleanLower.replace(/[^a-z0-9]/g, '_').slice(0, 44)}`;
  found = contacts.find(c => (c.id && (c.id.toLowerCase() === rawLower || c.id.toLowerCase() === spId)));
  if (found) return found;

  // 5. Match if names contain each other (for minor differences)
  if (cleanLower.length >= 3) {
    found = contacts.find(c => {
      const cClean = cleanSalespersonName(c.name || '').trim().toLowerCase();
      return (cClean.length >= 3 && (cleanLower.includes(cClean) || cClean.includes(cleanLower)));
    });
    if (found) return found;
  }

  // 6. Fuzzy similarity match (>= 70%)
  if (cleanLower.length >= 3) {
    let bestMatch: Contact | undefined;
    let highest = 0;
    for (const c of contacts) {
      const cClean = cleanSalespersonName(c.name || '').trim().toLowerCase();
      if (!cClean) continue;
      const score = calculateSimilarity(cleanLower, cClean);
      if (score >= 0.70 && score > highest) {
        highest = score;
        bestMatch = c;
      }
    }
    if (bestMatch) return bestMatch;
  }

  return undefined;
}

// ─── Bulk write (for imports) ─────────────────────────────────────────────────
let dispatchScheduled = false;
function dispatchUpdate() {
  if (typeof window === 'undefined') return;
  if (dispatchScheduled) return;
  dispatchScheduled = true;
  queueMicrotask(() => {
    dispatchScheduled = false;
    window.dispatchEvent(new Event('bill-store-update'));
  });
}

export async function saveBills(bills: Bill[]): Promise<boolean> {
  const seen = new Map<string, Bill>();
  for (const b of bills) {
    const isMoc = (b.billNo || '').toUpperCase().startsWith('MOC') || b.collectionCode === 'MOC' || b.salespersonName === 'MOC';
    const key = isMoc ? (b.id || b.billNo) : (b.billNo || b.id);
    seen.set(key, b);
  }
  const deduped = Array.from(seen.values());
  _bills = deduped;
  dispatchUpdate();
  persistLocalState();
  if (deduped.length === 0) return true;
  markWriteStart();
  try {
    const m = await import('@/lib/apiSync');
    const res = await m.apiPushBills(deduped);
    return (res?.count ?? 0) > 0;
  } catch {
    return false;
  } finally {
    markWriteEnd();
  }
}

export async function saveDrivers(drivers: Driver[]): Promise<boolean> {
  const seen = new Map<string, Driver>();
  for (const d of drivers) {
    const k = (d.name || '').trim().toLowerCase();
    if (k) seen.set(k, d);
  }
  const deduped = Array.from(seen.values());
  _drivers = deduped;
  dispatchUpdate();
  persistLocalState();
  markWriteStart();
  try {
    const m = await import('@/lib/apiSync');
    await m.apiPushDrivers(deduped);
    return true;
  } catch {
    return false;
  } finally {
    markWriteEnd();
  }
}

export async function saveBanks(banks: Bank[]): Promise<boolean> {
  // Normalize bank names to UPPERCASE and merge similar names (>= 50% similarity)
  const inputs = banks
    .map(b => ({ id: b.id, name: String(b.name || '').trim() }))
    .filter(b => b.name);

  // Start with existing banks to prefer existing ids/names when merging
  const existing = _banks.map(b => ({ id: b.id, name: String(b.name || '').trim() }));
  const merged: { id?: string; name: string }[] = [];

  const threshold = 0.50;

  function addOrMerge(item: { id?: string; name: string }) {
    const nameNorm = String(item?.name || '').trim().toUpperCase();
    for (const m of merged) {
      const score = calculateSimilarity(nameNorm, m.name);
      if (score >= threshold) {
        // Prefer existing id/name if present
        if (!m.id && item.id) m.id = item.id;
        // Keep m.name as canonical (prefer earlier/existing)
        return;
      }
    }
    merged.push({ id: item.id, name: nameNorm });
  }

  // Seed with existing banks first
  for (const e of existing) addOrMerge(e);
  // Then merge incoming banks
  for (const inp of inputs) addOrMerge(inp);

  const deduped = merged.map((m, i) => ({ id: m.id || `bn_${i}_${m.name.slice(0,6)}`, name: m.name }));
  _banks = deduped as Bank[];
  dispatchUpdate();
  persistLocalState();
  markWriteStart();
  try {
    const m = await import('@/lib/apiSync');
    await m.apiPushBanks(deduped);
    return true;
  } catch {
    return false;
  } finally {
    markWriteEnd();
  }
}

export function getAllUniqueBankNames(): string[] {
  const set = new Set<string>();
  for (const b of _banks) {
    const n = String(b?.name || '').trim().toUpperCase();
    if (n) set.add(n);
  }
  for (const bill of _bills) {
    if (bill?.bankName) {
      const n = String(bill.bankName || '').trim().toUpperCase();
      if (n) set.add(n);
    }
    if (bill?.partPayments && Array.isArray(bill.partPayments)) {
      for (const p of bill.partPayments) {
        if (p?.bankName) {
          const n = String(p.bankName || '').trim().toUpperCase();
          if (n) set.add(n);
        }
      }
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export async function deleteBank(id: string, name?: string): Promise<boolean> {
  const normSearch = (name || '').trim().toUpperCase();
  const bank = _banks.find(b => b.id === id || (normSearch && (b.name || '').trim().toUpperCase() === normSearch));
  const bankName = bank?.name || name;
  const normBankName = (bankName || '').trim().toUpperCase();
  _banks = _banks.filter(b => b.id !== id && (!normBankName || (b.name || '').trim().toUpperCase() !== normBankName));
  dispatchUpdate();
  persistLocalState();
  try {
    const { apiDeleteBank } = await import('@/lib/apiSync');
    await apiDeleteBank(id, bankName);
    return true;
  } catch {
    return false;
  }
}

export async function mergeTwoBanks(fromName: string, toName: string): Promise<{ ok: boolean; billsUpdated: number; error?: string }> {
  const fromClean = String(fromName || '').trim().toUpperCase();
  const toClean = String(toName || '').trim().toUpperCase();
  if (!fromClean || !toClean || fromClean === toClean) {
    return { ok: false, billsUpdated: 0, error: 'Kripya do alag alag bank select karein.' };
  }

  // 1. Update in-memory bills (both bankName & partPayments)
  let billsUpdated = 0;
  const modifiedPatches: Array<{ id: string; billNo?: string; patch: Partial<Bill> }> = [];
  _bills = _bills.map(b => {
    let changed = false;
    let newBank = b.bankName;
    if (b.bankName && b.bankName.trim().toUpperCase() === fromClean) {
      newBank = toClean;
      changed = true;
    }
    let newParts = b.partPayments;
    if (b.partPayments && b.partPayments.length > 0) {
      const mappedParts = b.partPayments.map(p => {
        if (p.bankName && p.bankName.trim().toUpperCase() === fromClean) {
          changed = true;
          return { ...p, bankName: toClean };
        }
        return p;
      });
      if (changed) newParts = mappedParts;
    }
    if (changed) {
      billsUpdated++;
      const patch: Partial<Bill> = { bankName: newBank };
      if (newParts) patch.partPayments = newParts;
      modifiedPatches.push({ id: b.id, billNo: b.billNo, patch });
      return { ...b, bankName: newBank, partPayments: newParts };
    }
    return b;
  });

  // 2. Update banks directory in memory
  const currentBanks = getBanks();
  const keptBanks = currentBanks.filter(b => (b?.name || '').trim().toUpperCase() !== fromClean);
  if (!keptBanks.some(b => (b?.name || '').trim().toUpperCase() === toClean)) {
    keptBanks.push({ id: `bn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, name: toClean });
  }
  _banks = keptBanks;

  // 3. Update dirty queue so pending write patches don't send stale bank name
  try {
    const { readDirtyQueue, enqueueDirtyBatch } = await import('./localQueue');
    const q = readDirtyQueue();
    const updatedQ = q.map(entry => {
      let qChanged = false;
      const p = { ...entry.patch };
      if (p.bankName && (p.bankName || '').trim().toUpperCase() === fromClean) {
        p.bankName = toClean;
        qChanged = true;
      }
      if (Array.isArray(p.partPayments)) {
        p.partPayments = p.partPayments.map(item => {
          if (item?.bankName && (item.bankName || '').trim().toUpperCase() === fromClean) {
            qChanged = true;
            return { ...item, bankName: toClean };
          }
          return item;
        });
      }
      return qChanged ? { ...entry, patch: p } : null;
    }).filter(Boolean) as Array<{ id: string; patch: Partial<Bill>; billNo?: string }>;

    if (updatedQ.length > 0) {
      enqueueDirtyBatch(updatedQ);
    }
    if (modifiedPatches.length > 0) {
      enqueueDirtyBatch(modifiedPatches);
    }
  } catch (e) {
    console.warn('[mergeTwoBanks] dirtyQueue note:', e);
  }

  dispatchUpdate();
  persistLocalState();

  // 4. Sync to Supabase
  markWriteStart();
  try {
    const { apiMergeTwoBanks } = await import('@/lib/apiSync');
    const res = await apiMergeTwoBanks(fromClean, toClean);
    return { ok: true, billsUpdated: Math.max(billsUpdated, res.billsUpdated) };
  } catch (err: any) {
    console.error('[mergeTwoBanks] sync error:', err);
    return { ok: true, billsUpdated };
  } finally {
    markWriteEnd();
  }
}

export async function deduplicateBanks(): Promise<{ removed: number; mergedList: Bank[] }> {
  const currentBanks = getBanks();
  const seen = new Map<string, Bank>();
  const removedNames: string[] = [];
  let removed = 0;
  for (const b of currentBanks) {
    const key = (b?.name || '').trim().toUpperCase();
    if (!key) continue;
    if (seen.has(key)) {
      removed++;
      removedNames.push(b.name);
    } else {
      seen.set(key, { ...b, name: key });
    }
  }
  const deduped = Array.from(seen.values());
  _banks = deduped;

  // Clean bank names in all bills
  let billsChanged = 0;
  _bills = _bills.map(b => {
    let changed = false;
    let newBank = b.bankName;
    if (b.bankName) {
      const cleanUpper = (b.bankName || '').trim().toUpperCase();
      if (b.bankName !== cleanUpper) {
        newBank = cleanUpper;
        changed = true;
      }
    }
    let newParts = b.partPayments;
    if (b.partPayments && b.partPayments.length > 0) {
      const mappedParts = b.partPayments.map(p => {
        if (p?.bankName) {
          const cleanUpper = (p.bankName || '').trim().toUpperCase();
          if (p.bankName !== cleanUpper) {
            changed = true;
            return { ...p, bankName: cleanUpper };
          }
        }
        return p;
      });
      if (changed) newParts = mappedParts;
    }
    if (changed) {
      billsChanged++;
      return { ...b, bankName: newBank, partPayments: newParts };
    }
    return b;
  });

  dispatchUpdate();
  persistLocalState();
  try {
    const { apiPushBanks, apiDeleteBank, apiBulkUpsertWithProgress } = await import('@/lib/apiSync');
    await apiPushBanks(deduped);
    for (const rName of removedNames) {
      await apiDeleteBank(undefined, rName);
    }
    if (billsChanged > 0) {
      await apiBulkUpsertWithProgress(_bills);
    }
  } catch {}
  return { removed, mergedList: deduped };
}

export async function saveSummaries(summaries: DriverDailySummary[]): Promise<boolean> {
  _summaries = summaries;
  dispatchUpdate();
  persistLocalState();
  markWriteStart();
  try {
    const m = await import('@/lib/apiSync');
    await m.apiPushSummaries(summaries);
    return true;
  } catch {
    return false;
  } finally {
    markWriteEnd();
  }
}

export async function savePartyContacts(contacts: Contact[]): Promise<boolean> {
  _partyContacts = contacts;
  dispatchUpdate();
  persistLocalState();
  markWriteStart();
  try {
    const m = await import('@/lib/apiSync');
    await m.apiPushPartyContacts(contacts);
    return true;
  } catch {
    return false;
  } finally {
    markWriteEnd();
  }
}

export async function saveSalespersonContacts(contacts: Contact[]): Promise<boolean> {
  // Ensure every contact has a stable id, cleaned salesperson name without (ME)/(TL)/(FL), and valid mobile digits
  const mergedMap = new Map<string, Contact>();
  for (const c of contacts) {
    const cleanName = cleanSalespersonName(c.name || '').trim();
    if (!cleanName) continue;
    const digits = (c.mobile || '').replace(/\D/g, '');
    const cleanMobile = digits.length >= 10 ? digits.slice(-10) : digits;
    const stableId = c.id || `sp_${cleanName.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 44)}`;

    // Check if equivalent contact already exists in map (handles surname front vs back)
    let existingKey = '';
    for (const [key, existing] of mergedMap) {
      if (areSalespersonNamesEquivalent(existing.name, cleanName)) {
        existingKey = key;
        break;
      }
    }

    if (existingKey) {
      const existing = mergedMap.get(existingKey)!;
      mergedMap.set(existingKey, {
        ...existing,
        mobile: cleanMobile || existing.mobile,
      });
    } else {
      const key = cleanName.toLowerCase();
      mergedMap.set(key, {
        id: stableId,
        name: cleanName,
        mobile: cleanMobile,
      });
    }
  }

  const normalizedContacts = Array.from(mergedMap.values());
  _salespersonContacts = normalizedContacts;
  dispatchUpdate();
  persistLocalState();
  markWriteStart();
  try {
    const m = await import('@/lib/apiSync');
    await m.apiPushSalespersonContacts(normalizedContacts);
    return true;
  } catch {
    return false;
  } finally {
    markWriteEnd();
  }
}


// ─── Bulk merge bills (update existing + add new — no delete, no individual API calls) ─
export function bulkMergeBillsInStore(mergedBills: Bill[]) {
  if (mergedBills.length === 0) return;
  const billMap = new Map(_bills.map(b => {
    const isMoc = (b.billNo || '').toUpperCase().startsWith('MOC') || b.collectionCode === 'MOC' || b.salespersonName === 'MOC' || (b.id && b.id.startsWith('moc_'));
    return [isMoc ? (b.id || b.billNo) : b.billNo, b];
  }));
  for (const b of mergedBills) {
    const isMoc = (b.billNo || '').toUpperCase().startsWith('MOC') || b.collectionCode === 'MOC' || b.salespersonName === 'MOC' || (b.id && b.id.startsWith('moc_'));
    billMap.set(isMoc ? (b.id || b.billNo) : b.billNo, b);
  }
  _bills = Array.from(billMap.values());
  dispatchUpdate();
  persistLocalState();
  const deduped = Array.from(new Map(mergedBills.map(b => [b.id, b])).values());
  markWriteStart();
  import('@/lib/apiSync')
    .then(m => m.apiBulkUpsertBills(deduped))
    .catch(() => {})
    .finally(() => markWriteEnd());
}

// ─── Add new bills (from XLS import — no delete) ─────────────────────────────
export function addBillsToStore(newBills: Bill[]) {
  if (newBills.length === 0) return;
  const existingKeys = new Set(_bills.map(b => {
    const isMoc = (b.billNo || '').toUpperCase().startsWith('MOC') || b.collectionCode === 'MOC' || b.salespersonName === 'MOC' || (b.id && b.id.startsWith('moc_'));
    return isMoc ? (b.id || b.billNo) : b.billNo;
  }));
  const toAdd: Bill[] = [];
  for (const b of newBills) {
    const isMoc = (b.billNo || '').toUpperCase().startsWith('MOC') || b.collectionCode === 'MOC' || b.salespersonName === 'MOC' || (b.id && b.id.startsWith('moc_'));
    const key = isMoc ? (b.id || b.billNo) : b.billNo;
    if (!existingKeys.has(key)) {
      existingKeys.add(key);
      toAdd.push(b);
    }
  }
  if (toAdd.length === 0) return;
  _bills = [..._bills, ...toAdd];
  dispatchUpdate();
  persistLocalState();
  markWriteStart();
  import('@/lib/apiSync')
    .then(m => m.apiInsertBills(toAdd))
    .catch(() => {})
    .finally(() => markWriteEnd());
}

// ─── Add bills to memory only — no API call; caller handles Supabase save ────
export function addBillsToMemoryOnly(newBills: Bill[]): Bill[] {
  if (newBills.length === 0) return [];
  const existingKeys = new Set(_bills.map(b => {
    const isMoc = (b.billNo || '').toUpperCase().startsWith('MOC') || b.collectionCode === 'MOC' || b.salespersonName === 'MOC' || (b.id && b.id.startsWith('moc_'));
    return isMoc ? (b.id || b.billNo) : b.billNo;
  }));
  const toAdd: Bill[] = [];
  for (const b of newBills) {
    const isMoc = (b.billNo || '').toUpperCase().startsWith('MOC') || b.collectionCode === 'MOC' || b.salespersonName === 'MOC' || (b.id && b.id.startsWith('moc_'));
    const key = isMoc ? (b.id || b.billNo) : b.billNo;
    if (!existingKeys.has(key)) {
      existingKeys.add(key);
      toAdd.push(b);
    }
  }
  if (toAdd.length === 0) return [];
  _bills = [..._bills, ...toAdd];
  dispatchUpdate();
  persistLocalState();
  return toAdd;
}

// ─── Merge bills in memory only — no API call; caller handles Supabase save ──
export function mergeBillsInMemoryOnly(mergedBills: Bill[]): void {
  if (mergedBills.length === 0) return;
  const billMap = new Map(_bills.map(b => {
    const isMoc = (b.billNo || '').toUpperCase().startsWith('MOC') || b.collectionCode === 'MOC' || b.salespersonName === 'MOC' || (b.id && b.id.startsWith('moc_'));
    return [isMoc ? (b.id || b.billNo) : b.billNo, b];
  }));
  for (const b of mergedBills) {
    const isMoc = (b.billNo || '').toUpperCase().startsWith('MOC') || b.collectionCode === 'MOC' || b.salespersonName === 'MOC' || (b.id && b.id.startsWith('moc_'));
    billMap.set(isMoc ? (b.id || b.billNo) : b.billNo, b);
  }
  _bills = Array.from(billMap.values());
  dispatchUpdate();
  persistLocalState();
}

// ─── Merge duplicate bill nos (keep the bill with the most payment data) ─────
export function deduplicateBills(): number {
  const before = _bills.length;
  const score = (b: Bill) =>
    (b.paymentDate ? 8 : 0) +
    (b.deliveryDate ? 4 : 0) +
    (Number(b.collectedAmount) > 0 ? 4 : 0) +
    (Number(b.cashAmount) > 0 ? 1 : 0) +
    (Number(b.upiAmount) > 0 ? 1 : 0) +
    (Number(b.chequeAmount) > 0 ? 1 : 0) +
    (b.chequeNo ? 1 : 0) +
    (b.bankName ? 1 : 0) +
    (b.paymentMode ? 1 : 0) +
    (b.driverName ? 1 : 0) +
    (b.cancelLine ? 1 : 0);
  const best = new Map<string, Bill>();
  for (const b of _bills) {
    const isMoc = (b.billNo || '').toUpperCase().startsWith('MOC') || b.collectionCode === 'MOC' || b.salespersonName === 'MOC' || (b.id && b.id.startsWith('moc_'));
    const key = isMoc ? (b.id || b.billNo) : (b.billNo || b.id);
    const cur = best.get(key);
    if (!cur || score(b) > score(cur)) best.set(key, b);
  }
  _bills = Array.from(best.values());
  const removed = before - _bills.length;
  if (removed > 0) {
    dispatchUpdate();
    markWriteStart();
    import('@/lib/apiSync')
      .then(m => m.apiPushBills(_bills))
      .catch(() => {})
      .finally(() => markWriteEnd());
  }
  return removed;
}

// ─── Merge duplicate / similar party & salesperson names (70%+ threshold) ────
/**
 * Merge fromName into toName:
 * - Updates in-memory bills instantly
 * - Calls Supabase to rename bills + fix contacts
 * - Returns stats
 */
export async function mergeTwoSalespersons(
  fromName: string,
  toName: string
): Promise<{ billsUpdated: number; ok: boolean; error?: string }> {
  const fromClean = cleanSalespersonName(fromName).trim() || fromName.trim();
  const toClean = cleanSalespersonName(toName).trim() || toName.trim();
  const fromLower = fromClean.toLowerCase();
  const toLower = toClean.toLowerCase();
  if (!fromClean || !toClean || fromLower === toLower) {
    return { billsUpdated: 0, ok: false, error: 'Invalid salesperson names' };
  }

  const fromBaseClean = fromClean.toLowerCase();
  const toBaseClean = toClean;

  // 1. Update in-memory bills immediately across ALL bills so UI updates instantly
  let changed = 0;
  const modifiedPatches: Array<{ id: string; billNo?: string; patch: Partial<Bill> }> = [];
  _bills = _bills.map((b) => {
    const spRaw = (b.salespersonName || '').trim();
    const spLower = spRaw.toLowerCase();
    const spClean = cleanSalespersonName(spRaw).trim().toLowerCase();
    const isMatch = (
      spLower === fromLower ||
      (fromBaseClean && spClean === fromBaseClean) ||
      areSalespersonNamesEquivalent(spRaw, fromClean) ||
      calculateSimilarity(spClean, fromBaseClean) >= 0.50 ||
      (spClean.length >= 3 && fromBaseClean.length >= 3 && (spClean.includes(fromBaseClean) || fromBaseClean.includes(spClean)))
    );
    if (isMatch) {
      changed++;
      modifiedPatches.push({ id: b.id, billNo: b.billNo, patch: { salespersonName: toBaseClean } });
      return { ...b, salespersonName: toBaseClean };
    }
    return b;
  });

  // 2. Merge contacts in memory: preserve mobile number!
  const fromContact = findSalespersonContact(fromClean);
  const toContact = findSalespersonContact(toClean);
  const inheritedMobile = (toContact?.mobile && toContact.mobile.trim())
    ? toContact.mobile.trim()
    : (fromContact?.mobile ? fromContact.mobile.trim() : '');

  // Filter out any contact matching fromName (or fromBaseClean)
  const remaining = _salespersonContacts.filter((c) => {
    const cLower = (c.name || '').trim().toLowerCase();
    const cClean = cleanSalespersonName(c.name || '').trim().toLowerCase();
    const isMatch = (
      cLower === fromLower ||
      (fromBaseClean && cClean === fromBaseClean) ||
      areSalespersonNamesEquivalent(c.name || '', fromClean) ||
      calculateSimilarity(cClean, fromBaseClean) >= 0.50
    );
    return !isMatch;
  });

  // Update or insert toName contact with preserved mobile number
  const toIdx = remaining.findIndex((c) => {
    const cLower = (c.name || '').trim().toLowerCase();
    const cClean = cleanSalespersonName(c.name || '').trim().toLowerCase();
    return cLower === toLower || (toBaseClean && cClean === toBaseClean.toLowerCase()) || areSalespersonNamesEquivalent(c.name || '', toClean);
  });

  const stableToId = toContact?.id || `sp_${toBaseClean.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 44)}`;

  if (toIdx >= 0) {
    remaining[toIdx] = {
      ...remaining[toIdx],
      id: remaining[toIdx].id || stableToId,
      name: toBaseClean,
      mobile: inheritedMobile || remaining[toIdx].mobile || '',
    };
  } else {
    // toName was not in contacts yet - create it so the number is NEVER lost!
    remaining.push({
      id: stableToId,
      name: toBaseClean,
      mobile: inheritedMobile,
    });
  }

  _salespersonContacts = remaining;

  // 3. Update dirty queue so pending write patches don't send stale salesperson name
  try {
    const { readDirtyQueue, enqueueDirtyBatch } = await import('./localQueue');
    const q = readDirtyQueue();
    const updatedQ = q.map(entry => {
      let qChanged = false;
      const p = { ...entry.patch };
      if (p.salespersonName) {
        const pLower = p.salespersonName.trim().toLowerCase();
        const pClean = cleanSalespersonName(p.salespersonName).trim().toLowerCase();
        if (pLower === fromLower || (fromBaseClean && pClean === fromBaseClean)) {
          p.salespersonName = toClean;
          qChanged = true;
        }
      }
      return qChanged ? { ...entry, patch: p } : null;
    }).filter(Boolean) as Array<{ id: string; patch: Partial<Bill>; billNo?: string }>;

    if (updatedQ.length > 0) {
      enqueueDirtyBatch(updatedQ);
    }
    if (modifiedPatches.length > 0) {
      enqueueDirtyBatch(modifiedPatches);
    }
  } catch (e) {
    console.warn('[mergeTwoSalespersons] dirtyQueue note:', e);
  }

  dispatchUpdate();
  persistLocalState();

  // 4. Persist to Supabase
  markWriteStart();
  try {
    const m = await import('@/lib/apiSync');
    await m.apiPushSalespersonContacts(_salespersonContacts);
    const result = await m.apiMergeTwoSalespersons(fromClean, toClean);
    return { ok: true, billsUpdated: Math.max(changed, result.billsUpdated) };
  } catch (err: any) {
    return { billsUpdated: changed, ok: false, error: String(err?.message ?? err) };
  } finally {
    markWriteEnd();
  }
}

export async function mergeTwoParties(
  fromName: string,
  toName: string,
  toCode?: string
): Promise<{ billsUpdated: number; ok: boolean; error?: string }> {
  const fromClean = fromName.trim();
  const toClean = toName.trim();
  const fromLower = fromClean.toLowerCase();
  if (!fromClean || !toClean || fromLower === toClean.toLowerCase()) {
    return { billsUpdated: 0, ok: false, error: 'Invalid party names' };
  }

  // 1. Update in-memory bills immediately across ALL bills so UI updates instantly
  let changed = 0;
  const modifiedPatches: Array<{ id: string; billNo?: string; patch: Partial<Bill> }> = [];
  _bills = _bills.map((b) => {
    if ((b.partyName || '').trim().toLowerCase() === fromLower) {
      changed++;
      const p: Partial<Bill> = { partyName: toClean };
      if (toCode) p.partyCode = toCode;
      modifiedPatches.push({ id: b.id, billNo: b.billNo, patch: p });
      return { ...b, partyName: toClean, ...(toCode ? { partyCode: toCode } : {}) };
    }
    return b;
  });

  // 2. Merge contacts in memory
  const fromContact = _partyContacts.find(
    (c) => (c.name || '').trim().toLowerCase() === fromLower
  );
  const toIdx = _partyContacts.findIndex(
    (c) => (c.name || '').trim().toLowerCase() === toClean.toLowerCase()
  );
  if (fromContact || changed > 0) {
    _partyContacts = _partyContacts
      .map((c, i) => {
        if (i === toIdx && fromContact?.mobile && !c.mobile) {
          return { ...c, mobile: fromContact.mobile };
        }
        return c;
      })
      .filter((c) => (c.name || '').trim().toLowerCase() !== fromLower);
  }

  // 3. Update dirty queue
  try {
    const { readDirtyQueue, enqueueDirtyBatch } = await import('./localQueue');
    const q = readDirtyQueue();
    const updatedQ = q.map(entry => {
      let qChanged = false;
      const p = { ...entry.patch };
      if (p.partyName && p.partyName.trim().toLowerCase() === fromLower) {
        p.partyName = toClean;
        if (toCode) p.partyCode = toCode;
        qChanged = true;
      }
      return qChanged ? { ...entry, patch: p } : null;
    }).filter(Boolean) as Array<{ id: string; patch: Partial<Bill>; billNo?: string }>;

    if (updatedQ.length > 0) {
      enqueueDirtyBatch(updatedQ);
    }
    if (modifiedPatches.length > 0) {
      enqueueDirtyBatch(modifiedPatches);
    }
  } catch (e) {
    console.warn('[mergeTwoParties] dirtyQueue note:', e);
  }

  dispatchUpdate();
  persistLocalState();

  // 4. Persist to Supabase
  markWriteStart();
  try {
    const m = await import('@/lib/apiSync');
    const result = await m.apiMergeTwoParties(fromClean, toClean, toCode);
    return { ok: true, billsUpdated: Math.max(changed, result.billsUpdated) };
  } catch (err: any) {
    return { billsUpdated: changed, ok: false, error: String(err?.message ?? err) };
  } finally {
    markWriteEnd();
  }
}

export async function consolidateSimilarPartiesOnly(threshold = 0.70): Promise<{
  updatedCount: number;
  mergedParties: number;
}> {
  const rawParties = _bills.map(b => b.partyName).filter(Boolean);
  const partyMap = buildCanonicalMap(rawParties, cleanPartyName, threshold);

  let mergedPartiesCount = 0;
  let changed = 0;
  const changedBills: Bill[] = [];
  const updatedBills = _bills.map(bill => {
    if (bill.partyName) {
      const cleaned = cleanPartyName(bill.partyName);
      const canonical = partyMap.get(cleaned) || cleaned;
      if (canonical !== bill.partyName) {
        changed++;
        mergedPartiesCount++;
        const nb = { ...bill, partyName: canonical };
        changedBills.push(nb);
        return nb;
      }
    }
    return bill;
  });

  if (changed > 0) {
    _bills = updatedBills;
    dispatchUpdate();
    persistLocalState();
    markWriteStart();
    try {
      const m = await import('@/lib/apiSync');
      await m.apiBulkUpsertWithProgress(changedBills);
    } catch (err) {
      console.error('Failed to persist merged party names:', err);
    } finally {
      markWriteEnd();
    }
  }

  return { updatedCount: changed, mergedParties: mergedPartiesCount };
}

export async function consolidateSimilarSalespersonsOnly(threshold = 0.50): Promise<{
  updatedCount: number;
  mergedSPs: number;
}> {
  const rawSPs = [
    ..._bills.map(b => b.salespersonName),
    ..._salespersonContacts.map(c => c.name)
  ].filter(Boolean) as string[];
  const spMap = buildCanonicalMap(rawSPs, cleanSalespersonName, threshold);

  let mergedSPCount = 0;
  let changed = 0;
  const changedBills: Bill[] = [];
  const updatedBills = _bills.map(bill => {
    if (bill.salespersonName) {
      const cleaned = cleanSalespersonName(bill.salespersonName);
      const canonical = spMap.get(cleaned) || cleaned;
      if (canonical !== bill.salespersonName) {
        changed++;
        mergedSPCount++;
        const nb = { ...bill, salespersonName: canonical };
        changedBills.push(nb);
        return nb;
      }
    }
    return bill;
  });

  // Also clean & deduplicate salesperson contacts with deep mobile preservation
  const cleanContactsMap = new Map<string, Contact>();
  for (const c of _salespersonContacts) {
    const cleanName = cleanSalespersonName(c.name || '').trim();
    if (!cleanName) continue;
    const canonical = spMap.get(cleanName) || cleanName;
    const key = canonical.toLowerCase();
    const existing = cleanContactsMap.get(key);
    const cDigits = (c.mobile || '').replace(/\D/g, '');
    const cMobile = cDigits.length >= 10 ? cDigits.slice(-10) : cDigits;
    const stableId = c.id || `sp_${key.replace(/[^a-z0-9]/g, '_').slice(0, 44)}`;

    if (!existing) {
      cleanContactsMap.set(key, { ...c, id: stableId, name: canonical, mobile: cMobile });
    } else {
      const existingDigits = (existing.mobile || '').replace(/\D/g, '');
      const bestMobile = existingDigits.length >= 10 ? existing.mobile : (cMobile || existing.mobile || '');
      cleanContactsMap.set(key, {
        ...existing,
        id: existing.id || stableId,
        name: canonical,
        mobile: bestMobile,
      });
    }
  }

  // Also ensure every canonical name in spMap has an entry in contacts so mobile can be entered
  for (const canon of Array.from(spMap.values())) {
    const key = canon.toLowerCase();
    if (!cleanContactsMap.has(key)) {
      cleanContactsMap.set(key, {
        id: `sp_${key.replace(/[^a-z0-9]/g, '_').slice(0, 44)}`,
        name: canon,
        mobile: '',
      });
    }
  }

  _salespersonContacts = Array.from(cleanContactsMap.values());
  if (changed > 0) {
    _bills = updatedBills;
  }

  dispatchUpdate();
  persistLocalState();
  markWriteStart();
  try {
    const m = await import('@/lib/apiSync');
    if (changed > 0) {
      await m.apiBulkUpsertWithProgress(changedBills);
    }
    await m.apiPushSalespersonContacts(_salespersonContacts);
  } catch (err) {
    console.error('Failed to persist merged salesperson names:', err);
  } finally {
    markWriteEnd();
  }

  return { updatedCount: changed, mergedSPs: mergedSPCount };
}

export async function consolidateSimilarPartyAndSalespersons(customBills?: Bill[]): Promise<{
  updatedCount: number;
  mergedParties: number;
  mergedSPs: number;
}> {
  const target = customBills || _bills;
  const { updatedBills, mergedPartiesCount, mergedSPCount } = standardizeBills(target, 0.70);

  let changed = 0;
  const changedBills: Bill[] = [];
  for (let i = 0; i < target.length; i++) {
    if (
      target[i].partyName !== updatedBills[i].partyName ||
      target[i].salespersonName !== updatedBills[i].salespersonName
    ) {
      changed++;
      changedBills.push(updatedBills[i]);
    }
  }

  if (changed > 0) {
    _bills = updatedBills;
    dispatchUpdate();
    persistLocalState();
    markWriteStart();
    try {
      const m = await import('@/lib/apiSync');
      await m.apiBulkUpsertWithProgress(changedBills);
    } catch (err) {
      console.error('Failed to persist merged party/salesperson names:', err);
    } finally {
      markWriteEnd();
    }
  }

  return { updatedCount: changed, mergedParties: mergedPartiesCount, mergedSPs: mergedSPCount };
}
export async function patchBillInMemory(billNo: string, patch: Partial<Bill>): Promise<boolean> {
  const norm = (billNo || '').trim().toLowerCase();
  const idx = _bills.findIndex(b => (b.billNo || '').trim().toLowerCase() === norm || b.id === billNo);
  if (idx === -1) return false;
  if (!('editHistory' in patch)) {
    patch = {
      ...patch,
      editHistory: appendEditHistory(_bills[idx].editHistory, {
        action: 'edit',
        mode: (patch.paymentMode ?? _bills[idx].paymentMode) || undefined,
        amount: patch.collectedAmount ?? _bills[idx].collectedAmount,
        changes: Object.keys(patch).map(k => `${k}=${String((patch as Record<string, unknown>)[k] ?? '')}`).join(' | '),
      }),
      editDate: `${nowDMY()} ${nowHM()}`,
    };
  }
  const nextBills = [..._bills];
  nextBills[idx] = { ...nextBills[idx], ...patch };
  _bills = nextBills;
  dispatchUpdate();
  persistLocalState();
  const bill = _bills[idx];
  markWriteStart();
  let confirmed = false;
  try {
    const { apiPatchBill } = await import('@/lib/apiSync');
    const res = await apiPatchBill(bill.id, patch, bill.billNo);
    confirmed = !!res?.ok;
    if (confirmed) {
      const { removeDirtyEntry } = await import('@/lib/localQueue');
      removeDirtyEntry(bill.id, bill.billNo);
    } else {
      const { enqueueDirty } = await import('@/lib/localQueue');
      enqueueDirty(bill.id, patch, bill.billNo);
    }
  } catch {
    confirmed = false;
    const { enqueueDirty } = await import('@/lib/localQueue');
    enqueueDirty(bill.id, patch, bill.billNo);
  } finally {
    markWriteEnd();
  }
  return confirmed;
}

// ─── Batch patch — local update + immediate parallel Supabase sync ───────────
export async function patchBillsInMemory(patches: Array<{ billNo: string; patch: Partial<Bill> }>): Promise<boolean> {
  const toSync: Array<{ id: string; patch: Partial<Bill>; billNo: string }> = [];
  for (const { billNo, patch } of patches) {
    const idx = _bills.findIndex(b => b.billNo === billNo);
    if (idx === -1) continue;
    const withHist: Partial<Bill> = ('editHistory' in patch) ? patch : {
      ...patch,
      editHistory: appendEditHistory(_bills[idx].editHistory, {
        action: 'edit',
        mode: (patch.paymentMode ?? _bills[idx].paymentMode) || undefined,
        amount: patch.collectedAmount ?? _bills[idx].collectedAmount,
        changes: Object.keys(patch).map(k => `${k}=${String((patch as Record<string, unknown>)[k] ?? '')}`).join(' | '),
      }),
      editDate: `${nowDMY()} ${nowHM()}`,
    };
    _bills[idx] = { ..._bills[idx], ...withHist };
    toSync.push({ id: _bills[idx].id, patch: withHist, billNo });
  }
  if (toSync.length === 0) return false;
  dispatchUpdate();
  persistLocalState();
  markWriteStart();
  let allSuccess = true;
  try {
    const { apiPatchBill } = await import('@/lib/apiSync');
    const { removeDirtyEntry, enqueueDirty } = await import('@/lib/localQueue');
    const results = await Promise.all(
      toSync.map(async (item) => {
        try {
          const res = await apiPatchBill(item.id, item.patch, item.billNo);
          if (res?.ok) {
            removeDirtyEntry(item.id, item.billNo);
            return true;
          } else {
            enqueueDirty(item.id, item.patch, item.billNo);
            return false;
          }
        } catch {
          enqueueDirty(item.id, item.patch, item.billNo);
          return false;
        }
      })
    );
    allSuccess = results.every(Boolean);
  } catch {
    allSuccess = false;
  } finally {
    markWriteEnd();
  }
  return allSuccess;
}



// ─── Settings — in-memory (from Supabase), session-only state in sessionStorage ─
const DEFAULT_WA_TEMPLATES: WhatsAppTemplates = {
  pending: `PANDDING BILL 
BILL DATE : {{billDate}}
BILL NO :- {{billNo}}
PARTY :- {{partyName}}
BILL AMT: {{billAmt}}
DAYS={{days}}
REC AND PAID OFFICE.`,
  fbr: `Dear ..
Bill No: {{billNo}}
Bill Date:- {{billDate}}
Party :- {{partyName}}
Bill Amt:- {{billAmt}}
 
YE PURA BILL FBR HUA HE PARTY SE BAT KARO BHAI`,
  returnCheque: `⚠️ CHEQUE RETURN ⚠️
PARTY :- {{partyName}}
BILL NO :- {{allBillNos}}
TOTAL BILL AMT :- ₹{{totalAmt}}
CHQ AMT :- ₹{{chequeAmt}}
CHQ NO :- {{chequeNo}}
CHQ DATE :- {{chequeDate}}
BANK :- {{bankName}}
CHEQUE RETURN HUA HE — DOBARA PAYMENT ARRANGE KARO`
};

export function getWhatsAppTemplates(): WhatsAppTemplates {
  if (!_waTemplates) return DEFAULT_WA_TEMPLATES;
  // Migrate old 'lineCut' key → 'returnCheque' (DB may still have the old shape)
  const t = _waTemplates as WhatsAppTemplates & { lineCut?: string };
  return {
    pending:      t.pending      || DEFAULT_WA_TEMPLATES.pending,
    fbr:          t.fbr          || DEFAULT_WA_TEMPLATES.fbr,
    returnCheque: t.returnCheque || t.lineCut || DEFAULT_WA_TEMPLATES.returnCheque,
  };
}

export async function saveWhatsAppTemplates(templates: WhatsAppTemplates): Promise<boolean> {
  _waTemplates = templates;
  try {
    const m = await import('@/lib/apiSync');
    const r = await m.apiPushWaTemplates(templates);
    return !!r?.ok;
  } catch {
    return false;
  }
}


export function getWABulkSendEnabled(): boolean {
  return sessionStorage.getItem('vitratrack_wa_bulk_enabled') !== '0';
}

export function saveWABulkSendEnabled(enabled: boolean) {
  sessionStorage.setItem('vitratrack_wa_bulk_enabled', enabled ? '1' : '0');
}

export function getBillSearchAutoResetSec(): number {
  return _billSearchAutoResetSec;
}

export async function saveBillSearchAutoResetSec(sec: number): Promise<boolean> {
  _billSearchAutoResetSec = sec;
  localStorage.setItem(LS_SEARCH_RESET_SEC, String(sec));
  dispatchUpdate();
  try {
    const m = await import('@/lib/apiSync');
    const r = await m.apiPushSetting('bill_search_reset_sec', String(sec));
    return !!r?.ok;
  } catch {
    return false;
  }
}

// ─── Daily password unlock — persists in localStorage per date ─────────────────
export function getDailyUnlocked(): boolean {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  return localStorage.getItem('vitratrack_daily_unlocked') === today;
}

export function setDailyUnlocked() {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  localStorage.setItem('vitratrack_daily_unlocked', today);
}

export function getPwSuffix(): string { return _pwSuffix; }

export function getSystemPassword(): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  return `${dd}${mm}${_pwSuffix}`;
}

// Owner password = suffix+DDMM (parts swapped)
export function getOwnerPassword(): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  return `${_pwSuffix}${dd}${mm}`;
}

// ─── User permissions (canEdit, canAdd, canBackDate) — stored in settings table ───────────
export function getUserPerm(name: string): { canEdit: boolean; canAdd: boolean; canBackDate: boolean } {
  const p = _userPerms[name];
  return {
    canEdit: p?.canEdit ?? true,
    canAdd: p?.canAdd ?? true,
    canBackDate: p?.canBackDate ?? false,
  };
}

export async function saveUserPerm(name: string, perm: { canEdit: boolean; canAdd: boolean; canBackDate: boolean }): Promise<boolean> {
  _userPerms[name] = perm;
  try {
    const m = await import('@/lib/apiSync');
    const r = await m.apiPushSetting('user_perms', JSON.stringify(_userPerms));
    return !!r?.ok;
  } catch {
    return false;
  }
}

// ─── User passwords (per-user custom password set by owner) ──────────────────
export function getUserPassword(name: string): string | null {
  return _userPasswords[name] ?? null;
}

export function getAllUserPasswords(): Record<string, string> {
  return { ..._userPasswords };
}

// Find which user name matches a given password string (for direct login)
export function findUserByPassword(password: string): string | null {
  const p = (password || '').trim();
  if (!p) return null;
  for (const [name, pw] of Object.entries(_userPasswords)) {
    if (pw && pw.trim() === p) return name;
  }
  return null;
}

export async function saveUserPassword(name: string, password: string): Promise<boolean> {
  if (password) {
    _userPasswords[name] = password;
  } else {
    delete _userPasswords[name];
  }
  try {
    localStorage.setItem(LS_USER_PASSWORDS, JSON.stringify(_userPasswords));
  } catch {}
  try {
    const m = await import('@/lib/apiSync');
    const r = await m.apiPushSetting('user_passwords', JSON.stringify(_userPasswords));
    return !!r?.ok;
  } catch {
    return false;
  }
}

export function saveSystemPasswordSuffix(suffix: string) {
  _pwSuffix = suffix;
  import('@/lib/apiSync').then(m => m.apiPushSetting('pw_suffix', suffix)).catch(() => {});
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
export { excelSerialToDate, getTodayDMY, getTodayISO, displayToIso, isoToDisplay, normDateStr } from '@/lib/dateUtils';

// ─── savePayment: patches the bill and AWAITS Supabase confirmation ───────────
// Returns true if Supabase saved successfully, false otherwise.
const METHOD_MAP: Record<string, { status: string; method?: string }> = {
  'Cash':        { status: 'Paid',        method: 'Cash'   },
  'UPI':         { status: 'Paid',        method: 'UPI'    },
  'Cheque':      { status: 'Paid',        method: 'Cheque' },
  'Split':       { status: 'Paid',        method: 'Split'  },
  'FBR':         { status: 'FBR'                           },
  'Cancel':      { status: 'FBR'                           },
  'Credit':      { status: 'Credit'                        },
  'Del Pending': { status: 'Del Pending'                   },
  'Pending':     { status: 'Del Pending'                   },
  'Unpaid':      { status: 'Unpaid'                        },
};

// Returns true for bills considered fully paid/settled (Paid or FBR).
export function isBillPaid(bill: Bill): boolean {
  const mode = (bill.paymentMode || '').toLowerCase();
  return mode === 'paid' || mode === 'fbr'
    || mode === 'cash' || mode === 'upi' || mode === 'cheque' || mode === 'split'
    || mode === 'cancel';
}

// ─── Payment rule engine (single source of truth) ─────────────────────────────
// Rule 0 (LOCK): If cashAmount/upiAmount/chequeAmount > 0, the bill was paid by
//         the owner manually. No automated process may change its paymentMode.
//         Exception: if the mode was accidentally left as "Unpaid", fix it to "Paid".
// Rule 1: billNetAmt - collectedAmount - lineCutAmt = outstandingAmount.
//         If outstandingAmount === 0 → paymentMode = "Paid".
// Rule 2: If billNetAmt === lineCutAmt → paymentMode = "FBR" AND paymentMethod = "FBR"
//         (takes priority over Rule 1, but NOT over the lock above).
// Rule 3: Unpaid + collectedAmount > 0 → paymentMode = "Paid"
//         (covers legacy bills stored without cash/upi/cheque breakdown).
// Applied on every save (payment entry, bulk import, restore, fix-bills) so the
// invariant always holds going forward.
export function applyPaymentRules(bill: Bill): Bill {
  const billNetAmt = Number(bill.billNetAmt) || 0;
  const collectedAmount = Number(bill.collectedAmount) || 0;
  // Legacy bills sometimes store the cut amount in `cancelLine` instead of
  // `lineCutAmt` (same convention used everywhere else in the app, e.g.
  // reports/outstanding pages: (lineCutAmt || 0) || Number(cancelLine) || 0).
  const rawLineCut = (Number(bill.lineCutAmt) || 0) || (Number(bill.cancelLine) || 0);
  const lineCutAmt = collectedAmount > 0
    ? Math.max(0, Math.min(rawLineCut, Math.max(0, billNetAmt - collectedAmount)))
    : rawLineCut;

  const rawOutstanding = billNetAmt - collectedAmount - lineCutAmt;
  const outstandingAmount = Math.abs(rawOutstanding) < 0.5 ? 0 : Math.max(0, rawOutstanding);

  let paymentMode = bill.paymentMode;
  let paymentMethod = bill.paymentMethod;
  const curMode = (bill.paymentMode || '').toLowerCase();

  // ── Rule 0: Payment lock ──────────────────────────────────────────────────────
  // Cash / GPay / Cheque amount was recorded — this bill is owner-entered.
  // Never let any automated process (fix-bills, recalc, file upload) change the
  // payment status. Only correct non-paid modes to Paid when money is received.
  const cashAmt   = Number(bill.cashAmount)   || 0;
  const upiAmt    = Number(bill.upiAmount)    || 0;
  const chequeAmt = Number(bill.chequeAmount) || 0;
  const isPaymentLocked = cashAmt > 0 || upiAmt > 0 || chequeAmt > 0 || (Number(bill.collectedAmount) || 0) > 0;

  if (isPaymentLocked) {
    if (curMode !== 'credit' || outstandingAmount === 0) {
      paymentMode = 'Paid';
    }
    return { ...bill, outstandingAmount, paymentMode, paymentMethod };
  }

  // ── Rules 1-3: standard (no cash/GPay/cheque breakdown recorded) ─────────────
  if (curMode === 'credit') {
    return { ...bill, outstandingAmount, paymentMode: 'Credit', paymentMethod };
  }

  if (curMode === 'del pending' || curMode === 'pending') {
    return { ...bill, outstandingAmount, paymentMode: 'Del Pending', paymentMethod };
  }

  const isFbrCondition = billNetAmt > 0 && Math.abs(billNetAmt - lineCutAmt) < 0.5;

  if (isFbrCondition || curMode === 'fbr' || curMode === 'cancel') {
    paymentMode = 'FBR';
    paymentMethod = 'FBR';
  } else if (outstandingAmount === 0 && billNetAmt > 0) {
    paymentMode = 'Paid';
  } else if (curMode === 'unpaid' && collectedAmount > 0) {
    // Rule 3: Unpaid but money was collected (legacy format) → fix to Paid.
    paymentMode = 'Paid';
  } else if ((curMode === 'paid' || curMode === 'fbr') && outstandingAmount > 0) {
    if (collectedAmount === 0) {
      paymentMode = 'Unpaid';
      paymentMethod = undefined;
    }
  }

  return { ...bill, outstandingAmount, paymentMode, paymentMethod };
}

// ── patchBillDirect: update memory + Supabase immediately (bypasses dirty queue) ──
// Use for cheque metadata saves and sibling propagation where instant sync matters.
export async function patchBillDirect(billNo: string, patch: Partial<Bill>): Promise<boolean> {
  const normBillNo = (billNo || '').trim().toUpperCase();
  const idx = _bills.findIndex(b => (b.billNo || '').trim().toUpperCase() === normBillNo || b.id === billNo);
  if (idx === -1) return false;
  _bills[idx] = { ..._bills[idx], ...patch };
  dispatchUpdate();
  persistLocalState();
  const bill = _bills[idx];

  markWriteStart();
  (async () => {
    try {
      const m = await import('@/lib/apiSync');
      const r = await m.apiPatchBill(bill.id, patch, bill.billNo);
      if (r.ok) {
        const { removeDirtyEntry } = await import('@/lib/localQueue');
        removeDirtyEntry(bill.id, bill.billNo);
      } else {
        const { enqueueDirty } = await import('@/lib/localQueue');
        enqueueDirty(bill.id, patch, bill.billNo);
      }
    } catch {
      const { enqueueDirty } = await import('@/lib/localQueue');
      enqueueDirty(bill.id, patch, bill.billNo);
    } finally {
      markWriteEnd();
    }
  })();

  return true;
}

export async function savePayment(
  billNo: string,
  paymentMode: string,
  imageUrl: string | null,
  totalAmount: number,
  cancelLine: string | null,
  driverName: string,
  customDate: string | null,
  chequeNo: string | null,
  bankName: string | null,
  nextBillNo: string | null,
  splitDetails?: { cash: number; upi: number; cheque: number },
  lineCutAmt?: number | null,
  forceRecDate?: string | null,
  enteredBy?: string,              // who made the entry (selectedDriver name / OWNER / user name)
  chequeDate?: string | null,      // cheque date — saved immediately with payment data
  discrepancyReason?: string | null,
  billId?: string | null,          // exact bill ID to update/create
): Promise<boolean> {
  const now = new Date();
  const todayDisp = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
  const paymentDate = customDate ? excelSerialToDate(customDate) : todayDisp;
  const rawTargetRecDate = (forceRecDate && forceRecDate.trim() !== '') ? forceRecDate : paymentDate;
  const normTargetRecDate = rawTargetRecDate ? excelSerialToDate(rawTargetRecDate) : '';
  const isDiffRecDate = !enteredBy && !!(normTargetRecDate && normTargetRecDate !== todayDisp && (customDate ? normTargetRecDate !== excelSerialToDate(customDate) : true));
  
  // If entry is added/edited with a different Rec Date than today and no enteredBy provided, attribute to PRATIXA
  const effectiveEnteredBy = enteredBy ? enteredBy : (isDiffRecDate ? 'PRATIXA' : '');

  // paymentTime: store entry-maker's name for tracking who entered which bill.
  // Falls back to HH:MM if no enteredBy (backward compat for old callers).
  let paymentTime = effectiveEnteredBy
    ? effectiveEnteredBy
    : `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  if (effectiveEnteredBy && effectiveEnteredBy.toUpperCase() === 'PRATIXA' && !paymentTime.includes(':')) {
    paymentTime = `PRATIXA:${paymentDate}`;
  }

  const mapped = METHOD_MAP[paymentMode];
  const finalStatus = mapped ? mapped.status : 'Paid';
  const paymentMethod = mapped?.method;

  const isUnpaid    = finalStatus === 'Unpaid';
  const isFBR       = finalStatus === 'FBR';
  const isCredit    = finalStatus === 'Credit';
  const isDelPend   = finalStatus === 'Del Pending';
  const isAssigned  = finalStatus === 'Assigned';
  
  const hasCollection = (totalAmount || 0) > 0 || (splitDetails?.cash || 0) > 0 || (splitDetails?.upi || 0) > 0 || (splitDetails?.cheque || 0) > 0;
  const isZeroCollectionMode = isUnpaid || isFBR || ((isCredit || isDelPend || isAssigned) && !hasCollection);
  const collected = isZeroCollectionMode ? 0 : (totalAmount || 0);

  const normBillNo = (billNo || '').trim().toUpperCase();
  const isMocBn = normBillNo.startsWith('MOC') || normBillNo.includes('MOC') || (billId && billId.startsWith('moc_'));

  let index = -1;
  if (billId) {
    index = _bills.findIndex(b => b.id === billId);
  }
  if (index === -1 && billNo) {
    if (!isMocBn) {
      index = _bills.findIndex(b => (b.billNo || '').trim().toUpperCase() === normBillNo);
      if (index === -1) {
        index = _bills.findIndex(b => b.id === billNo || (b.billNo || '').trim() === billNo.trim());
      }
    }
  }

  // ── FALLBACK: bill not in memory → save directly to Supabase by billNo ────────
  // This happens when the page loaded but Supabase sync hasn't completed yet,
  // OR when memory was cleared, OR when creating a brand new MOC entry.
  if (index === -1) {
    console.warn(`[savePayment] Bill ${billNo} (id=${billId || ''}) not in memory (${_bills.length} bills loaded). Saving directly to Supabase.`);
    const isNoPaymentDateMode = (isCredit && !hasCollection) || (isDelPend && !hasCollection) || isUnpaid;
    const fallbackRawRecDate = (forceRecDate && forceRecDate.trim() !== '') ? forceRecDate : paymentDate;
    const fallbackPaymentDate = (!isNoPaymentDateMode && (hasCollection || isFBR || finalStatus === 'Paid'))
      ? excelSerialToDate(fallbackRawRecDate)
      : '';
    const fallbackPatch: Partial<Bill> = {
      paymentMode: finalStatus === 'Paid' ? 'Paid' : finalStatus,
      collectedAmount: collected,
      cancelLine: cancelLine || '',
      driverName: driverName || '',
      paymentDate: fallbackPaymentDate,
      paymentTime: (!isNoPaymentDateMode && (hasCollection || isFBR || finalStatus === 'Paid')) ? paymentTime : '',
      chequeNo: chequeNo || '',
      bankName: bankName || '',
      nextBillNo: nextBillNo || '',
      cashAmount:   isZeroCollectionMode ? 0 : (splitDetails?.cash || 0),
      upiAmount:    isZeroCollectionMode ? 0 : (splitDetails?.upi || 0),
      chequeAmount: isZeroCollectionMode ? 0 : (splitDetails?.cheque || 0),
      outstandingAmount: isZeroCollectionMode ? undefined : 0,
    };
    if (paymentMethod) fallbackPatch.paymentMethod = paymentMethod;
    if (lineCutAmt != null) fallbackPatch.lineCutAmt = lineCutAmt;
    if (isDelPend) fallbackPatch.deliveryDate = forceRecDate || paymentDate;
    if (chequeDate) fallbackPatch.chequeDate = excelSerialToDate(chequeDate);
    if (discrepancyReason != null) fallbackPatch.discrepancyReason = discrepancyReason;
    
    const { extractMocNumber, formatMocSerialBillNo, getNextMocSrNo, formatMocPartyName } = await import('@/lib/commissionMoc');
    const mocNum = isMocBn ? (extractMocNumber(normBillNo) || '1') : '';
    const autoSrNo = isMocBn ? String(getNextMocSrNo(mocNum, _bills)) : '';
    const finalBillNo = isMocBn ? formatMocSerialBillNo(mocNum, autoSrNo) : billNo;
    const stableId = billId || (isMocBn ? `moc_${mocNum}_${autoSrNo}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` : `bill_${Math.random().toString(36).slice(2, 9)}`);

    // Put in local memory immediately so table shows it
    const stubBill: Bill = {
      srNo: autoSrNo,
      date: fallbackPaymentDate || paymentDate,
      deliveryDate: fallbackPaymentDate || paymentDate,
      partyCode: isMocBn ? `MOC${mocNum}` : '',
      partyHulCode: isMocBn ? `MOC${mocNum}` : '',
      billAgeing: 0,
      id: stableId,
      billNo: finalBillNo,
      partyName: isMocBn ? (formatMocPartyName('', `MOC ${mocNum}`) || `COMMISSION (MOC ${mocNum})`) : '',
      salespersonName: isMocBn ? 'MOC' : '',
      collectionCode: isMocBn ? 'MOC' : '',
      beatName: isMocBn ? 'COMMISSION' : '',
      billNetAmt: collected || 0,
      collectedAmount: collected || 0,
      outstandingAmount: 0,
      driverName: driverName || '',
      ...fallbackPatch,
    };
    _bills.push(stubBill);
    dispatchUpdate();
    persistLocalState();

    // Async background sync
    markWriteStart();
    (async () => {
      try {
        const { apiBulkUpsertBills } = await import('@/lib/apiSync');
        await apiBulkUpsertBills([stubBill]);
      } catch (err) {
        console.error(`[savePayment] Fallback save warning for ${billNo}:`, err);
      } finally {
        markWriteEnd();
      }
    })();

    return true;
  }

  const isDriverRole = (() => { try { return getRole() === 'driver'; } catch { return false; } })();

  const isMocBill = normBillNo.startsWith('MOC') || normBillNo.includes('MOC') || _bills[index].collectionCode === 'MOC' || _bills[index].salespersonName === 'MOC';
  if (isMocBill && collected > 0) {
    _bills[index].billNetAmt = collected;
  }

  const billNetAmt = _bills[index].billNetAmt;
  const savedLc = _bills[index].lineCutAmt || 0;
  const maxAllowedLc = Math.max(0, billNetAmt - collected);

  let effectiveLc: number;
  if (isMocBill) {
    effectiveLc = 0;
  } else if (isFBR) {
    effectiveLc = billNetAmt;
  } else if (isCredit) {
    effectiveLc = lineCutAmt != null ? Math.max(0, Math.min(lineCutAmt, maxAllowedLc)) : 0;
  } else if (collected >= billNetAmt) {
    // When bill is fully collected, Line Cut MUST be 0
    effectiveLc = 0;
  } else if (collected > 0) {
    // When partial payment is received: Line Cut = Bill Net - Collected (or user-specified capped at balance)
    effectiveLc = lineCutAmt != null ? Math.max(0, Math.min(lineCutAmt, maxAllowedLc)) : maxAllowedLc;
  } else {
    effectiveLc = lineCutAmt != null ? lineCutAmt : savedLc;
  }

  const diff = isMocBill ? 0 : (billNetAmt - effectiveLc - collected);
  const autoFullyPaid = isMocBill || (!isZeroCollectionMode && !isFBR && diff <= 1 && diff >= -1);
  const computedStatus = autoFullyPaid ? 'Paid' : finalStatus;

  const outstanding = isMocBill ? 0 : Math.max(0, billNetAmt - effectiveLc - collected);

  // Enforce the payment rule engine: FBR when billNetAmt === lineCutAmt,
  // Paid when outstandingAmount === 0 — regardless of the manually chosen mode.
  const ruled = isMocBill
    ? { paymentMode: 'Paid', paymentMethod: paymentMethod || 'Cash', outstandingAmount: 0 }
    : applyPaymentRules({
        billNetAmt,
        collectedAmount: collected,
        lineCutAmt: effectiveLc,
        paymentMode: computedStatus,
        paymentMethod,
      } as Bill);
  const finalPaymentMode = isZeroCollectionMode ? computedStatus : ruled.paymentMode;
  const finalPaymentMethod = isZeroCollectionMode ? paymentMethod : ruled.paymentMethod;
  const finalOutstanding = isZeroCollectionMode ? outstanding : ruled.outstandingAmount;

  // Preserve existing driver assignment — once a bill is assigned to a driver,
  // payment entry (by OWNER or any user) must not clear or overwrite that assignment.
  // Only the Driver page's explicit remove/reassign action should change driverName.
  const existingDriver = _bills[index].driverName?.trim();
  const finalDriverName = existingDriver ? existingDriver : driverName;

  // PaymentDate & PaymentTime:
  // User explicitly requested: when Credit, Del Pending, or Unpaid is selected without collected money, NO paid/rec date should be added!
  const isNoPaymentDateMode = (isCredit && !hasCollection) || (isDelPend && !hasCollection) || isUnpaid;

  const existingPaymentDate = _bills[index].paymentDate?.trim() || '';
  const rawRecDate = (forceRecDate && forceRecDate.trim() !== '')
    ? forceRecDate
    : (existingPaymentDate || (customDate ? excelSerialToDate(customDate) : paymentDate));
  const normalizedPaymentDate = rawRecDate ? excelSerialToDate(rawRecDate) : '';
  const shouldSetPaymentDate = !isNoPaymentDateMode && (hasCollection || isFBR || finalPaymentMode === 'Paid' || (!!forceRecDate && forceRecDate.trim() !== '' && !isCredit && !isDelPend && !isUnpaid));
  const finalPaymentDate = shouldSetPaymentDate
    ? normalizedPaymentDate
    : '';
  const finalPaymentTime = shouldSetPaymentDate
    ? (paymentTime || _bills[index].paymentTime || '')
    : '';

  const patch: Partial<Bill> = {
    paymentMode: finalPaymentMode,
    collectedAmount: collected,
    cancelLine: cancelLine || '',
    driverName: finalDriverName,
    paymentDate: finalPaymentDate,
    paymentTime: finalPaymentTime,
    chequeNo: chequeNo || '',
    bankName: bankName || '',
    nextBillNo: nextBillNo || '',
    cashAmount:   isZeroCollectionMode ? 0 : (splitDetails?.cash || 0),
    upiAmount:    isZeroCollectionMode ? 0 : (splitDetails?.upi || 0),
    chequeAmount: isZeroCollectionMode ? 0 : (splitDetails?.cheque || 0),
    outstandingAmount: finalOutstanding,
    ...(isMocBill ? { billNetAmt: collected, lineCutAmt: 0, salespersonName: 'MOC', collectionCode: 'MOC', beatName: 'COMMISSION' } : {}),
  };
  if (isMocBill) {
    const { extractMocNumber, extractMocSrNumber, formatMocSerialBillNo, formatMocPartyName, getNextMocSrNo } = await import('@/lib/commissionMoc');
    const mocNum = extractMocNumber(normBillNo) || extractMocNumber(_bills[index].billNo) || extractMocNumber(_bills[index].partyName) || '1';
    let srNo = _bills[index].srNo;
    const existingSrInBn = extractMocSrNumber(_bills[index].billNo);
    if (existingSrInBn && existingSrInBn > 0) {
      srNo = String(existingSrInBn);
    } else if (!srNo || srNo === '0') {
      srNo = String(getNextMocSrNo(mocNum, _bills));
    }
    const formattedBn = formatMocSerialBillNo(mocNum, srNo);
    patch.billNo = formattedBn;
    patch.srNo = String(srNo);
    patch.partyCode = `MOC${mocNum}`;
    patch.partyHulCode = `MOC${mocNum}`;
    patch.partyName = formatMocPartyName('', `MOC ${mocNum}`);
    patch.salespersonName = 'MOC';
    patch.collectionCode = 'MOC';
    patch.beatName = 'COMMISSION';
    patch.billNetAmt = collected;
    patch.lineCutAmt = 0;
  }
  // Save chequeDate immediately with payment data when provided
  if (chequeDate) patch.chequeDate = excelSerialToDate(chequeDate);

  if (finalPaymentMethod) patch.paymentMethod = finalPaymentMethod;
  if (discrepancyReason != null) patch.discrepancyReason = discrepancyReason;
  // Write lineCutAmt: strictly follow effectiveLc
  patch.lineCutAmt = effectiveLc;
  // Del Pending: set deliveryDate only if not already set — once assigned, del date is immutable
  if (isDelPend && !_bills[index].deliveryDate) patch.deliveryDate = excelSerialToDate(paymentDate);

  // ── Audit trail: append one immutable line per entry/edit ──────────────────
  const prevHist = _bills[index].editHistory;
  patch.editHistory = appendEditHistory(prevHist, {
    action: (prevHist && prevHist.length > 0) ? 'edit' : 'add',
    by: effectiveEnteredBy || undefined,
    mode: finalPaymentMode,
    amount: collected,
    changes: [
      `mode=${finalPaymentMode}`,
      `amt=${collected}`,
      chequeNo ? `chq=${chequeNo}` : '',
      bankName ? `bank=${bankName}` : '',
      finalPaymentDate ? `rec=${finalPaymentDate}` : '',
      finalDriverName ? `driver=${finalDriverName}` : '',
    ].filter(Boolean).join(' | '),
  });
  patch.editDate = `${nowDMY()} ${nowHM()}`;
  {
    const actor = currentActor(effectiveEnteredBy || undefined);
    if (actor.role === 'owner') patch.owner = actor.by;
    else patch.user = actor.by;
  }

  // Update in-memory and local storage immediately for 0ms UI responsiveness
  _bills[index] = { ..._bills[index], ...patch };
  dispatchUpdate();
  persistLocalState();

  const targetBillId = _bills[index].id;

  // Save to Supabase in background immediately without blocking the UI
  markWriteStart();
  (async () => {
    try {
      const { apiPatchBill } = await import('@/lib/apiSync');
      const directRes = await apiPatchBill(targetBillId, patch, billNo);
      if (directRes.ok) {
        const { removeDirtyEntry } = await import('@/lib/localQueue');
        removeDirtyEntry(targetBillId, billNo);
      } else {
        const { enqueueDirty } = await import('@/lib/localQueue');
        enqueueDirty(targetBillId, patch, billNo);
      }
    } catch (err) {
      console.warn(`[savePayment] Background sync for ${billNo} queued:`, err);
      const { enqueueDirty } = await import('@/lib/localQueue');
      enqueueDirty(targetBillId, patch, billNo);
    } finally {
      markWriteEnd();
    }
  })();

  return true;
}


// ─── resetBill: clears all payment fields, keeps billNetAmt unchanged ──────────
export async function resetBill(billNo: string) {
  const normBillNo = (billNo || '').trim().toUpperCase();
  const index = _bills.findIndex(b => (b.billNo || '').trim().toUpperCase() === normBillNo || b.id === billNo);
  if (index === -1) return;
  const patch: Partial<Bill> = {
    paymentMode: '',
    collectedAmount: 0,
    cancelLine: '',
    lineCutAmt: 0,
    paymentDate: '',
    paymentTime: '',
    driverName: '',
    chequeNo: '',
    bankName: '',
    cashAmount: 0,
    upiAmount: 0,
    chequeAmount: 0,
    outstandingAmount: _bills[index].billNetAmt,
  };
  _bills[index] = { ..._bills[index], ...patch };
  dispatchUpdate();
  persistLocalState();
  const billId = _bills[index].id;
  
  import('@/lib/localQueue').then(({ enqueueDirty }) => {
    enqueueDirty(billId, patch, billNo);
  }).catch(() => {});

  (async () => {
    markWriteStart();
    try {
      const { apiPatchBill } = await import('@/lib/apiSync');
      const res = await apiPatchBill(billId, patch, billNo);
      if (res.ok) {
        const { readDirtyQueue, DIRTY_KEY } = await import('@/lib/localQueue');
        const queue = readDirtyQueue().filter(e => !(e.id === billId || (billNo && e.billNo === billNo)));
        try { localStorage.setItem(DIRTY_KEY, JSON.stringify(queue)); } catch {}
      }
    } catch (err) {
      console.warn(`[resetBill] Background sync warning for ${billNo}:`, err);
    } finally {
      markWriteEnd();
    }
  })();
}

// ─── deleteBill: permanently deletes a bill from store, local cache, and Supabase ──────────
export async function deleteBill(billNo: string, id?: string): Promise<boolean> {
  const normBillNo = (billNo || '').trim().toUpperCase();
  const targetId = id;
  const targetBill = _bills.find(b => (targetId && b.id === targetId) || (normBillNo && (b.billNo || '').trim().toUpperCase() === normBillNo));
  const effectiveId = targetId || targetBill?.id || '';
  const effectiveBillNo = targetBill?.billNo || billNo;

  // 1. Remove from in-memory store
  _bills = _bills.filter(b => {
    if (effectiveId && b.id === effectiveId) return false;
    if (normBillNo && (b.billNo || '').trim().toUpperCase() === normBillNo) return false;
    return true;
  });

  // 2. Remove from dirty queue
  try {
    const { removeDirtyEntry } = await import('@/lib/localQueue');
    removeDirtyEntry(effectiveId, effectiveBillNo);
  } catch {}

  // 3. Dispatch update and persist
  dispatchUpdate();
  persistLocalState(true);

  // 4. Delete from Supabase
  markWriteStart();
  try {
    const { apiDeleteBill } = await import('@/lib/apiSync');
    const ok = await apiDeleteBill(effectiveId, effectiveBillNo);
    return ok;
  } catch (err) {
    console.error('[deleteBill] Supabase deletion error:', err);
    return false;
  } finally {
    markWriteEnd();
  }
}

export async function applyGreenPartyUpdatesToBillsAndContacts(): Promise<{ billsUpdated: number; contactsUpdated: number }> {
  let billsUpdated = 0;
  let contactsUpdated = 0;

  const greenParties = getGreenParties();
  if (greenParties.length === 0) return { billsUpdated: 0, contactsUpdated: 0 };

  const updatedBills = _bills.map(b => {
    const officialName = getGreenPartyNameByCode(b.partyCode);
    if (officialName && b.partyName !== officialName) {
      billsUpdated++;
      return { ...b, partyName: officialName };
    }
    return b;
  });

  if (billsUpdated > 0) {
    _bills = updatedBills;
    persistLocalState();
    dispatchUpdate();
    markWriteStart();
    try {
      const m = await import('@/lib/apiSync');
      await m.apiPushBills(updatedBills);
    } catch (e) {
      console.error('[applyGreenPartyUpdatesToBillsAndContacts] Error pushing bills:', e);
    } finally {
      markWriteEnd();
    }
  }

  const updatedContacts = _partyContacts.map(c => {
    const officialName = getGreenPartyNameByCode(c.id) || getGreenPartyNameByCode(c.name);
    if (officialName && c.name !== officialName) {
      contactsUpdated++;
      return { ...c, name: officialName };
    }
    return c;
  });

  if (contactsUpdated > 0) {
    _partyContacts = updatedContacts;
    try {
      const m = await import('@/lib/apiSync');
      await m.apiPushPartyContacts(updatedContacts);
    } catch (e) {
      console.error('[applyGreenPartyUpdatesToBillsAndContacts] Error pushing contacts:', e);
    }
  }

  try {
    const m = await import('@/lib/apiSync');
    await m.apiPushSetting('green_party_list', JSON.stringify(greenParties));
  } catch (e) {
    console.error('[applyGreenPartyUpdatesToBillsAndContacts] Error saving setting:', e);
  }

  return { billsUpdated, contactsUpdated };
}

/**
 * Calculates DIS% for a bill based on CashDisc (srNo), Adjustments (collectionCode), and Taxable Amt (billNetAmt).
 * Formula: DIS% = ((CashDisc + Adjustments) * 100) / (Taxable Amt + CashDisc + Adjustments)
 */
export function calculateBillDiscountPercent(b: Partial<Bill> | null | undefined): {
  disPercent: number;
  disText: string;
  cashDisc: number;
  adjustments: number;
  taxableAmt: number;
} {
  if (!b) return { disPercent: 0, disText: '0.00%', cashDisc: 0, adjustments: 0, taxableAmt: 0 };

  const rawCashDisc = Number(b.srNo) || 0;
  const rawAdj = (b.collectionCode && b.collectionCode.toUpperCase() !== 'MOC') ? (Number(b.collectionCode) || 0) : 0;
  const taxableAmt = Number(b.billNetAmt) || 0;

  const totalDisc = rawCashDisc + rawAdj;
  const denominator = taxableAmt + rawCashDisc + rawAdj;

  let disPercent = 0;
  if (denominator > 0 && totalDisc > 0) {
    disPercent = (totalDisc * 100) / denominator;
  }

  const disText = `${disPercent.toFixed(2)}%`;
  return {
    disPercent,
    disText,
    cashDisc: rawCashDisc,
    adjustments: rawAdj,
    taxableAmt,
  };
}


// ─── Batched delta merge (used by incremental polling sync) ───────────────────
// Merges many changed bills in ONE pass instead of copying the array per row.
export function applyBillsDelta(changed: Bill[]) {
  if (!changed || changed.length === 0) return 0;
  const byId = new Map<string, number>();
  const byBillNo = new Map<string, number>();
  _bills.forEach((b, i) => {
    if (b.id) byId.set(b.id, i);
    const bn = (b.billNo || '').trim().toUpperCase();
    if (bn) byBillNo.set(bn, i);
  });

  const next = [..._bills];
  const prepend: Bill[] = [];
  let applied = 0;

  for (const raw of changed) {
    const greenName = getGreenPartyNameByCode(raw.partyCode);
    const cleaned: Bill = {
      ...raw,
      partyName: greenName || cleanPartyName(raw.partyName),
      salespersonName: cleanSalespersonName(raw.salespersonName),
    };
    const bn = (cleaned.billNo || '').trim().toUpperCase();
    const isMoc = bn.startsWith('MOC') || cleaned.collectionCode === 'MOC' || cleaned.salespersonName === 'MOC' || (cleaned.id || '').startsWith('moc_');
    let idx = cleaned.id ? (byId.get(cleaned.id) ?? -1) : -1;
    if (idx < 0 && !isMoc && bn) idx = byBillNo.get(bn) ?? -1;
    if (idx >= 0) {
      next[idx] = { ...next[idx], ...cleaned };
    } else {
      prepend.push(cleaned);
      if (cleaned.id) byId.set(cleaned.id, -1);
    }
    applied++;
  }

  _bills = prepend.length > 0 ? [...prepend, ...next] : next;
  dispatchUpdate();
  persistLocalState();
  return applied;
}
