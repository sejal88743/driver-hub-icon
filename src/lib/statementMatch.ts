import { useState, useEffect, useCallback } from 'react';
import type { Bill } from '@/lib/billStore';
import { getEffAmt } from '@/lib/statementReport';
import { getDisplayBillNo } from '@/lib/commissionMoc';
import { idbGet, idbSetMany } from '@/lib/billStore';
import { apiPushSetting } from '@/lib/apiSync';
import { supabase } from '@/lib/supabase';

export type StatementEntry = {
  id: string;
  date: string; // DD/MM/YYYY
  rawDate: string;
  description: string;
  creditAmount: number;
  chequeNo?: string;
  matched: boolean;
  matchedBillNos: string[];
  matchedBillIds: string[];
  matchType?: 'single' | 'multi';
  matchGroupKey?: string;
  isManual?: boolean;
};

export type ManualMatchRecord = {
  signature: string;
  entryId?: string;
  billNos: string[];
  billIds: string[];
  amount: number;
  date: string;
  updatedAt: string;
};

export type StatementMatchStats = {
  totalStatementRows: number;
  totalCreditAmount: number;
  matchedStatementRows: number;
  matchedStatementAmount: number;
  unmatchedStatementRows: number;
  unmatchedStatementAmount: number;
  matchedBillsCount: number;
  matchedBillsTotalAmount: number;
  uploadedAt: string;
  fileName?: string;
};

export const STATEMENT_MATCHED_AMOUNT_CLS = "bg-yellow-300 dark:bg-yellow-900 text-yellow-950 dark:text-yellow-100 font-black px-1.5 py-0.5 rounded border border-yellow-500 shadow-xs inline-block";
export const STATEMENT_MATCHED_CELL_CLS = "bg-yellow-200/90 dark:bg-yellow-950/80 text-yellow-950 dark:text-yellow-100 font-black";

const LS_MATCHED_BILLS_KEY = 'vitratrack_statement_matched_bills';
const LS_MATCHED_NOS_KEY = 'vitratrack_statement_matched_nos';
const LS_STATEMENT_ENTRIES_KEY = 'vitratrack_statement_entries';
const LS_STATEMENT_STATS_KEY = 'vitratrack_statement_stats';
const LS_STATEMENT_MANUAL_MATCHES_KEY = 'vitratrack_statement_manual_matches';
const IDB_STATEMENT_MATCH_KEY = 'vt_stmt_match_payload';
const SUPABASE_SETTING_KEY = 'statement_match_state';

// In-memory cache for ultra-fast render lookups
let _matchedBillIds = new Set<string>();
let _matchedBillNos = new Set<string>();
let _cachedStats: StatementMatchStats | null = null;
let _cachedEntries: StatementEntry[] | null = null;
let _manualMatches: Record<string, ManualMatchRecord> = {};
let _isHydratingRemote = false;

export function stripGST(bn: string): string {
  if (!bn) return '';
  let s = String(bn).trim().toUpperCase();
  // Strip LeverEdge / distributor prefix if present (e.g. "10C711-GST42155" or "10C711-42155")
  s = s.replace(/^[0-9A-Z]+[-_](GST)?/i, '');
  // Strip GST or GST- or GST_ prefix
  s = s.replace(/^GST[-_]?/i, '');
  return s.trim();
}

export function getStatementEntrySignature(entry: { date: string; creditAmount: number; description?: string }): string {
  const d = (entry.date || '').trim();
  const amt = Math.round((Number(entry.creditAmount) || 0) * 100) / 100;
  const cleanDesc = (entry.description || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 50);
  return `${d}_${amt}_${cleanDesc}`;
}

export function normDate(v?: string | number): string {
  if (v == null || v === '') return '';
  const raw = String(v).trim();
  if (!raw) return '';

  // Standard DD/MM/YYYY
  const dmyMatch = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dmyMatch) {
    const d = dmyMatch[1].padStart(2, '0');
    const m = dmyMatch[2].padStart(2, '0');
    let y = dmyMatch[3];
    if (y.length === 2) y = parseInt(y, 10) < 50 ? `20${y}` : `19${y}`;
    return `${d}/${m}/${y}`;
  }

  // YYYY-MM-DD
  const ymdMatch = raw.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (ymdMatch) {
    const y = ymdMatch[1];
    const m = ymdMatch[2].padStart(2, '0');
    const d = ymdMatch[3].padStart(2, '0');
    return `${d}/${m}/${y}`;
  }

  // Pure numeric Excel serial number (e.g. 45839)
  if (/^\d{5}$/.test(raw)) {
    const n = Number(raw);
    const date = new Date(Math.round((n - 25569) * 86400 * 1000));
    if (!isNaN(date.getTime())) {
      const d = String(date.getDate()).padStart(2, '0');
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const y = date.getFullYear();
      return `${d}/${m}/${y}`;
    }
  }

  return raw;
}

// Helper to save to localStorage
function saveToLocalStorage(
  matchedIds: Set<string>,
  matchedNos: Set<string>,
  entries: StatementEntry[],
  stats: StatementMatchStats | null,
  manualMatches?: Record<string, ManualMatchRecord>
) {
  try {
    localStorage.setItem(LS_MATCHED_BILLS_KEY, JSON.stringify(Array.from(matchedIds)));
    localStorage.setItem(LS_MATCHED_NOS_KEY, JSON.stringify(Array.from(matchedNos)));
    localStorage.setItem(LS_STATEMENT_ENTRIES_KEY, JSON.stringify(entries));
    if (manualMatches) {
      localStorage.setItem(LS_STATEMENT_MANUAL_MATCHES_KEY, JSON.stringify(manualMatches));
    }
    if (stats) {
      localStorage.setItem(LS_STATEMENT_STATS_KEY, JSON.stringify(stats));
    } else {
      localStorage.removeItem(LS_STATEMENT_STATS_KEY);
    }
  } catch {}
}

// Hydrate from localStorage synchronously on boot
let localHydrated = false;
function hydrate() {
  if (typeof window === 'undefined' || localHydrated) return;
  localHydrated = true;
  try {
    const rawIds = localStorage.getItem(LS_MATCHED_BILLS_KEY);
    if (rawIds) {
      const arr = JSON.parse(rawIds);
      if (Array.isArray(arr) && arr.length > 0) _matchedBillIds = new Set(arr);
    }
    const rawNos = localStorage.getItem(LS_MATCHED_NOS_KEY);
    if (rawNos) {
      const arr = JSON.parse(rawNos);
      if (Array.isArray(arr) && arr.length > 0) _matchedBillNos = new Set(arr.map(s => stripGST(s)));
    }
    const rawStats = localStorage.getItem(LS_STATEMENT_STATS_KEY);
    if (rawStats) {
      _cachedStats = JSON.parse(rawStats);
    }
    const rawEntries = localStorage.getItem(LS_STATEMENT_ENTRIES_KEY);
    if (rawEntries) {
      _cachedEntries = JSON.parse(rawEntries);
    }
    const rawManual = localStorage.getItem(LS_STATEMENT_MANUAL_MATCHES_KEY);
    if (rawManual) {
      const parsed = JSON.parse(rawManual);
      if (parsed && typeof parsed === 'object') _manualMatches = parsed;
    }
  } catch {}
}

hydrate();

// Other tabs can update the persisted match state; invalidate only on those writes.
if (typeof window !== 'undefined') {
  const matchStorageKeys = new Set([LS_MATCHED_BILLS_KEY, LS_MATCHED_NOS_KEY, LS_STATEMENT_STATS_KEY, LS_STATEMENT_ENTRIES_KEY, LS_STATEMENT_MANUAL_MATCHES_KEY]);
  window.addEventListener('storage', event => {
    if (event.key !== null && !matchStorageKeys.has(event.key)) return;
    _matchedBillIds = new Set();
    _matchedBillNos = new Set();
    _cachedStats = null;
    _cachedEntries = null;
    _manualMatches = {};
    localHydrated = false;
    hydrate();
    window.dispatchEvent(new CustomEvent('vt-statement-match-updated'));
  });
}

/**
 * Permanently loads statement match state from IndexedDB and Supabase settings table.
 * Ensures that matching is preserved across refreshes, devices, and sessions.
 */
export async function hydrateStatementMatchFromRemote(): Promise<boolean> {
  if (typeof window === 'undefined' || _isHydratingRemote) return false;
  _isHydratingRemote = true;
  let updated = false;

  try {
    // 1. Try IndexedDB if in-memory entries are empty
    if (!_cachedEntries || _cachedEntries.length === 0) {
      try {
        const idbData = await idbGet<any>(IDB_STATEMENT_MATCH_KEY);
        if (idbData && Array.isArray(idbData.entries) && idbData.entries.length > 0) {
          _matchedBillIds = new Set(idbData.matchedIds || []);
          _matchedBillNos = new Set((idbData.matchedNos || []).map((s: string) => stripGST(s)));
          _cachedEntries = idbData.entries;
          _cachedStats = idbData.stats || null;
          if (idbData.manualMatches && typeof idbData.manualMatches === 'object') {
            _manualMatches = { ..._manualMatches, ...idbData.manualMatches };
          }
          saveToLocalStorage(_matchedBillIds, _matchedBillNos, _cachedEntries || [], _cachedStats, _manualMatches);
          updated = true;
          window.dispatchEvent(new CustomEvent('vt-statement-match-updated'));
        }
      } catch {}
    }

    // 2. Fetch from Supabase settings table (Permanent Cloud Source of Truth)
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('settings')
          .select('value')
          .eq('key', SUPABASE_SETTING_KEY)
          .maybeSingle();

        if (!error && data?.value && data.value.trim().length > 0) {
          const parsed = JSON.parse(data.value);
          if (parsed && Array.isArray(parsed.entries) && parsed.entries.length > 0) {
            _matchedBillIds = new Set(parsed.matchedIds || []);
            _matchedBillNos = new Set((parsed.matchedNos || []).map((s: string) => stripGST(s)));
            _cachedEntries = parsed.entries;
            _cachedStats = parsed.stats || null;
            if (parsed.manualMatches && typeof parsed.manualMatches === 'object') {
              _manualMatches = { ..._manualMatches, ...parsed.manualMatches };
            }

            saveToLocalStorage(_matchedBillIds, _matchedBillNos, _cachedEntries || [], _cachedStats, _manualMatches);
            idbSetMany({
              [IDB_STATEMENT_MATCH_KEY]: parsed,
            }).catch(() => {});

            updated = true;
            window.dispatchEvent(new CustomEvent('vt-statement-match-updated'));
          }
        }
      } catch (cloudErr) {
        console.warn('[statementMatch] Supabase settings fetch warning:', cloudErr);
      }
    }
  } catch (err) {
    console.warn('[statementMatch] hydrateStatementMatchFromRemote error:', err);
  } finally {
    _isHydratingRemote = false;
  }

  return updated;
}

if (typeof window !== 'undefined') {
  setTimeout(() => { void hydrateStatementMatchFromRemote(); }, 300);
}

/**
 * Returns true if the bill was verified and matched against an uploaded bank statement.
 */
export function isBillStatementMatched(b?: Bill | null): boolean {
  if (!b) return false;
  hydrate();
  if (b.id && _matchedBillIds.has(b.id)) return true;
  if (b.billNo && _matchedBillNos.has(stripGST(b.billNo))) return true;
  return false;
}

export function isBillNoStatementMatched(billNo?: string): boolean {
  if (!billNo) return false;
  hydrate();
  return _matchedBillNos.has(stripGST(billNo));
}

export function getStatementMatchStats(): StatementMatchStats | null {
  hydrate();
  return _cachedStats;
}

export function getStatementEntries(): StatementEntry[] {
  hydrate();
  return _cachedEntries || [];
}

export function getManualMatches(): Record<string, ManualMatchRecord> {
  hydrate();
  return _manualMatches || {};
}

export function recalculateStats(entries: StatementEntry[], matchedNos: Set<string>): StatementMatchStats {
  let matchedCount = 0;
  let matchedAmt = 0;
  let totalAmt = 0;
  for (const e of entries) {
    totalAmt += Number(e.creditAmount) || 0;
    if (e.matched) {
      matchedCount++;
      matchedAmt += Number(e.creditAmount) || 0;
    }
  }
  const now = new Date();
  const uploadedAt = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return {
    totalStatementRows: entries.length,
    totalCreditAmount: Math.round(totalAmt * 100) / 100,
    matchedStatementRows: matchedCount,
    matchedStatementAmount: Math.round(matchedAmt * 100) / 100,
    unmatchedStatementRows: entries.length - matchedCount,
    unmatchedStatementAmount: Math.round((totalAmt - matchedAmt) * 100) / 100,
    matchedBillsCount: matchedNos.size,
    matchedBillsTotalAmount: Math.round(matchedAmt * 100) / 100,
    uploadedAt,
  };
}

export function parseBillNumbersQuery(query: string): string[] {
  if (!query) return [];
  // Split on '+', ',', '/', ';', spaces, or newlines
  const parts = query.split(/[+,\/\s;]+/).map(s => s.trim()).filter(Boolean);
  const cleanList: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const clean = stripGST(p);
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      cleanList.push(clean);
    }
  }
  return cleanList;
}

export function getBillAmountForMatch(b: Bill, targetAmt?: number): number {
  const os = Math.round((Number(b.outstandingAmount) || 0) * 100) / 100;
  const col = Math.round((Number(b.collectedAmount) || 0) * 100) / 100;
  const eff = getEffAmt(b);
  const effBank = Math.round(((eff.upi > 0 ? eff.upi : 0) + (eff.chq > 0 ? eff.chq : 0)) * 100) / 100;
  const net = Math.round(Math.max(0, (Number(b.billNetAmt) || 0) - (Number(b.lineCutAmt) || 0)) * 100) / 100;

  // If a target amount is specified and one candidate matches exactly
  if (targetAmt !== undefined && targetAmt > 0) {
    if (Math.abs(os - targetAmt) < 0.05) return os;
    if (Math.abs(col - targetAmt) < 0.05) return col;
    if (Math.abs(effBank - targetAmt) < 0.05) return effBank;
    if (Math.abs(net - targetAmt) < 0.05) return net;
  }

  // 1. If bank payment exists (UPI / Cheque)
  if (effBank > 0) return effBank;
  // 2. Outstanding amount for pending/credit/unpaid bills
  if (os > 0 && col === 0) return os;
  // 3. Collected amount if OS is 0
  if (col > 0 && os === 0) return col;
  // 4. Default prefer OS if positive
  if (os > 0) return os;
  // 5. Prefer collected if positive
  if (col > 0) return col;
  // 6. Net bill amount
  if (net > 0) return net;
  return 0;
}

export type BillMatchLookupResult = {
  queryNo: string;
  billNo: string;
  bill?: Bill;
  found: boolean;
  amount: number;
  osAmount: number;
  colAmount: number;
  netAmount: number;
  effBankAmount: number;
  partyName?: string;
  rawMode?: string;
  date?: string;
};

let _cachedBillsArrayRef: Bill[] | null = null;
let _cachedBillsArrayLength = 0;
let _cachedBillsLookupMap: Map<string, Bill> | null = null;

export function getBillsLookupMap(allBills: Bill[]): Map<string, Bill> {
  if (
    _cachedBillsLookupMap &&
    _cachedBillsArrayRef === allBills &&
    _cachedBillsArrayLength === allBills.length
  ) {
    return _cachedBillsLookupMap;
  }

  const map = new Map<string, Bill>();
  for (let i = 0; i < allBills.length; i++) {
    const b = allBills[i];
    if (!b || !b.billNo) continue;
    const raw = String(b.billNo).trim().toUpperCase();
    const clean = stripGST(raw);

    if (clean) map.set(clean, b);
    map.set(raw, b);
    if (clean && !raw.startsWith('GST')) {
      map.set(`GST${clean}`, b);
    }
    if (b.srNo) {
      map.set(String(b.srNo), b);
    }
  }

  _cachedBillsArrayRef = allBills;
  _cachedBillsArrayLength = allBills.length;
  _cachedBillsLookupMap = map;
  return map;
}

export function findBillsForManualMatch(query: string, allBills: Bill[], targetEntryAmt?: number): BillMatchLookupResult[] {
  const tokens = parseBillNumbersQuery(query);
  if (tokens.length === 0) return [];

  const billMap = getBillsLookupMap(allBills);

  const results: BillMatchLookupResult[] = tokens.map(token => {
    const cleanToken = stripGST(token);
    const b = billMap.get(cleanToken) || billMap.get(token) || (cleanToken ? billMap.get(`GST${cleanToken}`) : undefined);
    if (b) {
      const os = Math.round((Number(b.outstandingAmount) || 0) * 100) / 100;
      const col = Math.round((Number(b.collectedAmount) || 0) * 100) / 100;
      const eff = getEffAmt(b);
      const effBank = Math.round(((eff.upi > 0 ? eff.upi : 0) + (eff.chq > 0 ? eff.chq : 0)) * 100) / 100;
      const net = Math.round(Math.max(0, (Number(b.billNetAmt) || 0) - (Number(b.lineCutAmt) || 0)) * 100) / 100;

      return {
        queryNo: token,
        billNo: b.billNo,
        bill: b,
        found: true,
        amount: getBillAmountForMatch(b, targetEntryAmt),
        osAmount: os,
        colAmount: col,
        netAmount: net,
        effBankAmount: effBank,
        partyName: b.partyName || '',
        rawMode: b.paymentMode || '',
        date: b.paymentDate || b.deliveryDate || b.date || '',
      };
    }
    return {
      queryNo: token,
      billNo: token,
      found: false,
      amount: 0,
      osAmount: 0,
      colAmount: 0,
      netAmount: 0,
      effBankAmount: 0,
      partyName: '',
      rawMode: '',
      date: '',
    };
  });

  // If all bills were found and targetEntryAmt is specified:
  // Dynamically check if OS, Col, Bank, or Net amounts equal targetEntryAmt exactly (e.g. 2600 + 2400 = 5000!)
  if (targetEntryAmt && targetEntryAmt > 0 && results.every(r => r.found)) {
    const sumOs = Math.round(results.reduce((s, r) => s + r.osAmount, 0) * 100) / 100;
    const sumCol = Math.round(results.reduce((s, r) => s + r.colAmount, 0) * 100) / 100;
    const sumNet = Math.round(results.reduce((s, r) => s + r.netAmount, 0) * 100) / 100;
    const sumBank = Math.round(results.reduce((s, r) => s + r.effBankAmount, 0) * 100) / 100;

    if (Math.abs(sumOs - targetEntryAmt) < 0.05) {
      results.forEach(r => { r.amount = r.osAmount; });
    } else if (Math.abs(sumCol - targetEntryAmt) < 0.05) {
      results.forEach(r => { r.amount = r.colAmount; });
    } else if (Math.abs(sumBank - targetEntryAmt) < 0.05) {
      results.forEach(r => { r.amount = r.effBankAmount; });
    } else if (Math.abs(sumNet - targetEntryAmt) < 0.05) {
      results.forEach(r => { r.amount = r.netAmount; });
    }
  }

  return results;
}

export function manualMatchStatementEntry(
  entryId: string,
  billQueryOrNos: string | string[],
  allBills: Bill[],
  allowTolerance = false
): { ok: boolean; message: string; diff?: number; totalBillsAmt?: number; entryAmt?: number } {
  hydrate();
  const entries = _cachedEntries ? [..._cachedEntries] : [];
  const entryIdx = entries.findIndex(e => e.id === entryId);
  if (entryIdx === -1) {
    return { ok: false, message: 'Statement entry nahi mili.' };
  }
  const entry = { ...entries[entryIdx] };

  const queryStr = Array.isArray(billQueryOrNos) ? billQueryOrNos.join('+') : billQueryOrNos;
  const lookup = findBillsForManualMatch(queryStr, allBills, entry.creditAmount);

  if (lookup.length === 0) {
    return { ok: false, message: 'Koi valid bill number nahi mila.' };
  }

  const notFound = lookup.filter(x => !x.found);
  if (notFound.length > 0) {
    return { ok: false, message: `Bill(s) nahi mile: ${notFound.map(n => n.queryNo).join(', ')}` };
  }

  const totalBillsAmt = Math.round(lookup.reduce((s, x) => s + x.amount, 0) * 100) / 100;
  const diff = Math.round((totalBillsAmt - entry.creditAmount) * 100) / 100;

  if (Math.abs(diff) > 1 && !allowTolerance) {
    return {
      ok: false,
      message: `Amount match nahi hua: Bills Total ₹${totalBillsAmt.toLocaleString('en-IN')}, Statement Deposit ₹${entry.creditAmount.toLocaleString('en-IN')} (Diff: ₹${diff.toLocaleString('en-IN')})`,
      diff,
      totalBillsAmt,
      entryAmt: entry.creditAmount,
    };
  }

  const resolvedBillNos = lookup.map(x => x.billNo);
  const resolvedBillIds = lookup.map(x => x.bill?.id).filter(Boolean) as string[];

  entry.matched = true;
  entry.matchedBillNos = resolvedBillNos;
  entry.matchedBillIds = resolvedBillIds;
  entry.matchType = resolvedBillNos.length > 1 ? 'multi' : 'single';
  entry.matchGroupKey = `MANUAL_${resolvedBillNos.map(stripGST).join('+')}`;
  entry.isManual = true;

  entries[entryIdx] = entry;

  for (const id of resolvedBillIds) _matchedBillIds.add(id);
  for (const no of resolvedBillNos) _matchedBillNos.add(stripGST(no));

  const sig = getStatementEntrySignature(entry);
  const dateAmtKey = `${entry.date}_${Math.round(entry.creditAmount * 100) / 100}`;
  const rec: ManualMatchRecord = {
    signature: sig,
    entryId: entry.id,
    billNos: resolvedBillNos,
    billIds: resolvedBillIds,
    amount: entry.creditAmount,
    date: entry.date,
    updatedAt: new Date().toISOString(),
  };
  _manualMatches[sig] = rec;
  _manualMatches[entry.id] = rec;
  _manualMatches[dateAmtKey] = rec;
  for (const bn of resolvedBillNos) {
    _manualMatches[`BILL_${stripGST(bn)}`] = rec;
  }

  const stats = recalculateStats(entries, _matchedBillNos);
  saveStatementMatchState(_matchedBillIds, _matchedBillNos, entries, stats, _manualMatches);

  return {
    ok: true,
    message: `Match successful! Bill(s): ${resolvedBillNos.join(' + ')} (₹${totalBillsAmt.toLocaleString('en-IN')})`,
    diff,
    totalBillsAmt,
    entryAmt: entry.creditAmount,
  };
}

export function unmatchStatementEntry(entryId: string): { ok: boolean; message: string } {
  hydrate();
  const entries = _cachedEntries ? [..._cachedEntries] : [];
  const entryIdx = entries.findIndex(e => e.id === entryId);
  if (entryIdx === -1) {
    return { ok: false, message: 'Statement entry nahi mili.' };
  }
  const entry = { ...entries[entryIdx] };
  const oldBillNos = [...entry.matchedBillNos];
  const oldBillIds = [...entry.matchedBillIds];
  const sig = getStatementEntrySignature(entry);

  entry.matched = false;
  entry.matchedBillNos = [];
  entry.matchedBillIds = [];
  delete entry.matchType;
  delete entry.matchGroupKey;
  delete entry.isManual;

  entries[entryIdx] = entry;

  const dateAmtKey = `${entry.date}_${Math.round(entry.creditAmount * 100) / 100}`;
  delete _manualMatches[sig];
  delete _manualMatches[entry.id];
  delete _manualMatches[dateAmtKey];
  for (const bn of oldBillNos) {
    delete _manualMatches[`BILL_${stripGST(bn)}`];
  }

  for (const bn of oldBillNos) {
    const clean = stripGST(bn);
    const stillInOther = entries.some(e => e.matched && e.matchedBillNos.some(x => stripGST(x) === clean));
    if (!stillInOther) {
      _matchedBillNos.delete(clean);
    }
  }
  for (const id of oldBillIds) {
    const stillInOther = entries.some(e => e.matched && e.matchedBillIds.includes(id));
    if (!stillInOther) {
      _matchedBillIds.delete(id);
    }
  }

  const stats = recalculateStats(entries, _matchedBillNos);
  saveStatementMatchState(_matchedBillIds, _matchedBillNos, entries, stats, _manualMatches);

  return { ok: true, message: 'Entry unmatch kar di gayi.' };
}

/**
 * React hook to listen for statement match changes and trigger re-renders.
 */
export function useStatementMatch() {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const handler = () => setVersion(v => v + 1);
    window.addEventListener('vt-statement-match-updated', handler);
    // Remote hydration ensures permanent loading across reloads and devices
    void hydrateStatementMatchFromRemote();
    return () => window.removeEventListener('vt-statement-match-updated', handler);
  }, []);

  return {
    isMatched: useCallback((b?: Bill | null) => {
      if (version < 0) return false;
      return isBillStatementMatched(b);
    }, [version]),
    isBillNoMatched: useCallback((bn?: string) => {
      if (version < 0) return false;
      return isBillNoStatementMatched(bn);
    }, [version]),
    stats: getStatementMatchStats(),
    entries: getStatementEntries(),
    manualMatches: getManualMatches(),
    manualMatch: useCallback((entryId: string, billQueryOrNos: string | string[], bills: Bill[], allowTolerance?: boolean) => {
      return manualMatchStatementEntry(entryId, billQueryOrNos, bills, allowTolerance);
    }, []),
    unmatch: useCallback((entryId: string) => {
      return unmatchStatementEntry(entryId);
    }, []),
    findBills: useCallback((query: string, bills: Bill[], targetEntryAmt?: number) => {
      return findBillsForManualMatch(query, bills, targetEntryAmt);
    }, []),
    getBillAmt: getBillAmountForMatch,
    clear: clearStatementMatchState,
    reload: hydrateStatementMatchFromRemote,
  };
}

export function clearStatementMatchState() {
  _matchedBillIds = new Set();
  _matchedBillNos = new Set();
  _cachedStats = null;
  _cachedEntries = null;
  _manualMatches = {};

  try {
    localStorage.removeItem(LS_MATCHED_BILLS_KEY);
    localStorage.removeItem(LS_MATCHED_NOS_KEY);
    localStorage.removeItem(LS_STATEMENT_STATS_KEY);
    localStorage.removeItem(LS_STATEMENT_ENTRIES_KEY);
    localStorage.removeItem(LS_STATEMENT_MANUAL_MATCHES_KEY);
  } catch {}

  // Clear from IndexedDB
  idbSetMany({
    [IDB_STATEMENT_MATCH_KEY]: null,
  }).catch(() => {});

  // Clear from Supabase settings
  apiPushSetting(SUPABASE_SETTING_KEY, '').catch(() => {});

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('vt-statement-match-updated'));
  }
}

export function saveStatementMatchState(
  matchedIds: Set<string>,
  matchedNos: Set<string>,
  entries: StatementEntry[],
  stats: StatementMatchStats,
  manualMatches?: Record<string, ManualMatchRecord>
) {
  _matchedBillIds = matchedIds;
  _matchedBillNos = matchedNos;
  _cachedEntries = entries;
  _cachedStats = stats;
  if (manualMatches) {
    _manualMatches = manualMatches;
  }

  // 1. LocalStorage
  saveToLocalStorage(matchedIds, matchedNos, entries, stats, _manualMatches);

  const payload = {
    matchedIds: Array.from(matchedIds),
    matchedNos: Array.from(matchedNos),
    entries,
    stats,
    manualMatches: _manualMatches,
    updatedAt: new Date().toISOString(),
  };

  // 2. IndexedDB (Persistent browser storage)
  idbSetMany({
    [IDB_STATEMENT_MATCH_KEY]: payload,
  }).catch(() => {});

  // 3. Supabase settings table (Permanent Cloud Storage across all devices & sessions)
  apiPushSetting(SUPABASE_SETTING_KEY, JSON.stringify(payload)).catch((err) => {
    console.warn('[statementMatch] Failed to push statement match to Supabase settings:', err);
  });

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('vt-statement-match-updated'));
  }
}

/**
 * Generates and downloads an Excel file (.xlsx) containing all unmatched entries
 * from the bank statement, and optionally the list of unmatched bank bills.
 */
export async function downloadUnmatchedStatementEntries(
  entries: StatementEntry[],
  bills?: Bill[]
) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  // 1. Sheet 1: Unmatched Statement Rows
  const unmatchedStmt = (entries || []).filter(e => !e.matched);
  const stmtData: any[][] = [
    [
      'Sr No',
      'Transaction Date',
      'Description / Narration',
      'Credit Deposit (₹)',
      'Match Status',
      'Reconciliation Remarks'
    ]
  ];

  unmatchedStmt.forEach((e, idx) => {
    stmtData.push([
      idx + 1,
      e.date,
      e.description || '—',
      e.creditAmount,
      'UNMATCHED',
      'No matching GPay (UPI) or Cheque bill found for this date & amount'
    ]);
  });

  const wsStmt = XLSX.utils.aoa_to_sheet(stmtData);
  wsStmt['!cols'] = [
    { wch: 8 },  // Sr No
    { wch: 16 }, // Date
    { wch: 45 }, // Description
    { wch: 18 }, // Amount
    { wch: 14 }, // Status
    { wch: 55 }, // Remarks
  ];
  XLSX.utils.book_append_sheet(wb, wsStmt, 'Unmatched Statement');

  // 2. Sheet 2: Unmatched Bank Bills (eligible bills with UPI or Cheque on statement dates that were not matched)
  if (Array.isArray(bills) && bills.length > 0) {
    const isMatched = (b: Bill) => isBillStatementMatched(b);

    const unmatchedBankBills = bills.filter(b => {
      const mode = (b.paymentMode || '').toLowerCase();
      const hasBankPay = mode === 'upi' ||
                         mode === 'cheque' ||
                         (Number(b.upiAmount) || 0) > 0 ||
                         (Number(b.chequeAmount) || 0) > 0 ||
                         Boolean(b.chequeNo && b.chequeNo.trim().length > 0);
      return hasBankPay && !isMatched(b);
    });

    const billsData: any[][] = [
      [
        'Sr No',
        'Bill No',
        'Party Name',
        'Bill Date',
        'Rec Date',
        'Payment Mode',
        'Cheque No',
        'Received Amount (₹)',
        'Net Bill Amount (₹)',
        'Status'
      ]
    ];

    unmatchedBankBills.forEach((b, idx) => {
      const eff = getEffAmt(b);
      const recAmt = (eff.upi > 0 ? eff.upi : 0) + (eff.chq > 0 ? eff.chq : 0) || (b.collectedAmount || 0);
      billsData.push([
        idx + 1,
        getDisplayBillNo(b),
        b.partyName || '—',
        b.date || '—',
        b.paymentDate || b.deliveryDate || '—',
        b.paymentMode || '—',
        b.chequeNo || '—',
        recAmt,
        b.billNetAmt || 0,
        'NOT FOUND IN STATEMENT'
      ]);
    });

    const wsBills = XLSX.utils.aoa_to_sheet(billsData);
    wsBills['!cols'] = [
      { wch: 8 },
      { wch: 14 },
      { wch: 32 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 16 },
      { wch: 18 },
      { wch: 18 },
      { wch: 25 },
    ];
    XLSX.utils.book_append_sheet(wb, wsBills, 'Unmatched Bank Bills');
  }

  // 3. Trigger Excel File Download
  const now = new Date();
  const dateStr = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`;
  const fileName = `Unmatched_Statement_Entries_${dateStr}.xlsx`;

  XLSX.writeFile(wb, fileName);
}

/**
 * Parses Bank Statement file (CSV or XLSX/XLS).
 * Supports standard Indian Bank formats (HDFC, ICICI, SBI, Bank of Baroda, etc.)
 */
export async function parseStatementFile(file: File): Promise<StatementEntry[]> {
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', raw: true });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rawRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });

  if (rawRows.length < 2) return [];

  // 1. Locate header row
  let headerRowIdx = -1;
  let dateCol = -1;
  let descCol = -1;
  let creditCol = -1;
  let chqCol = -1;

  for (let r = 0; r < Math.min(25, rawRows.length); r++) {
    const row = rawRows[r].map(c => String(c || '').trim().toLowerCase());
    const dIdx = row.findIndex(c =>
      c.includes('txn date') || c.includes('txndate') || c === 'date' || c.includes('transaction date') || c.includes('value date')
    );
    const crIdx = row.findIndex(c =>
      c.includes('credit amount') || c.includes('credit amt') || c === 'credit' || c === 'cr' || c.includes('deposit') || c.includes('credit (inr)')
    );

    if (dIdx !== -1 && crIdx !== -1) {
      headerRowIdx = r;
      dateCol = dIdx;
      creditCol = crIdx;
      descCol = row.findIndex(c =>
        c.includes('description') || c.includes('narration') || c.includes('particular') || c.includes('remarks')
      );
      if (descCol === -1) descCol = 1;
      chqCol = row.findIndex(c =>
        c.includes('cheq') || c.includes('chq') || c.includes('cheque') || c.includes('inst no') || c.includes('instrument')
      );
      break;
    }
  }

  // Fallback: If no explicit 'credit amount' found, check if there is 'Amount' and 'Type' or generic 'Amount'
  if (headerRowIdx === -1) {
    for (let r = 0; r < Math.min(25, rawRows.length); r++) {
      const row = rawRows[r].map(c => String(c || '').trim().toLowerCase());
      const dIdx = row.findIndex(c => c.includes('date'));
      const amtIdx = row.findIndex(c => c.includes('amount') || c.includes('amt'));
      if (dIdx !== -1 && amtIdx !== -1) {
        headerRowIdx = r;
        dateCol = dIdx;
        creditCol = amtIdx;
        descCol = row.findIndex(c => c.includes('desc') || c.includes('narration') || c.includes('particular'));
        if (descCol === -1) descCol = dIdx === 0 ? 1 : 0;
        break;
      }
    }
  }

  if (headerRowIdx === -1) {
    throw new Error('Bank statement header me "Date" aur "Credit Amount" column nahi mila. Kripya valid bank statement file chunein.');
  }

  const entries: StatementEntry[] = [];
  let seq = 1;

  for (let r = headerRowIdx + 1; r < rawRows.length; r++) {
    const row = rawRows[r];
    if (!row || row.length === 0) continue;

    const rawDateStr = String(row[dateCol] || '').trim();
    const rawDesc = String(row[descCol] || '').trim();
    const rawCredit = String(row[creditCol] || '').trim();

    if (!rawDateStr || !rawCredit) continue;

    // Clean amount (remove commas, Currency symbols, Cr suffix)
    const cleanedAmt = rawCredit.replace(/[₹$,]/g, '').replace(/cr/i, '').trim();
    const numAmt = parseFloat(cleanedAmt);
    if (isNaN(numAmt) || numAmt <= 0) continue;

    // Clean date
    const dmy = normDate(rawDateStr);
    if (!dmy || !dmy.includes('/')) continue;

    entries.push({
      id: `stmt_${seq++}_${dmy.replace(/\//g, '')}_${Math.round(numAmt)}`,
      date: dmy,
      rawDate: rawDateStr,
      description: rawDesc,
      creditAmount: Math.round(numAmt * 100) / 100,
      matched: false,
      matchedBillNos: [],
      matchedBillIds: [],
    });
  }

  return entries;
}

/**
 * Matches bank statement entries against bill payment data.
 *
 * Rules:
 * 1. ONLY GPay (UPI) and Cheque entries match! Cash, Credit, Del Pending without cash are excluded.
 * 2. Date match: statement Date === bill recDate.
 * 3. Multi-bill support: If multiple bills share a single GPay transaction or Cheque,
 *    their combined single amount matches the statement credit amount!
 * 4. Single-bill support: Single bill received amount matches the statement credit amount!
 */
export function matchStatementWithBills(
  statementEntries: StatementEntry[],
  bills: Bill[]
): {
  matchedBillIds: Set<string>;
  matchedBillNos: Set<string>;
  updatedEntries: StatementEntry[];
  stats: StatementMatchStats;
} {
  // 1. Filter eligible bills (GPay and Cheque only) and group them
  type BillBankItem = {
    bill: Bill;
    billNo: string;
    recDate: string;
    recAmt: number;
    mode: 'GPAY' | 'CHEQUE';
    chequeNo: string;
    groupKey: string;
    partyName: string;
  };

  const bankItems: BillBankItem[] = [];

  for (const b of bills) {
    const eff = getEffAmt(b);
    const cleanBn = stripGST(getDisplayBillNo(b));
    const recDate = normDate(b.paymentDate) || normDate(b.deliveryDate) || normDate(b.date);
    if (!recDate) continue;

    // GPay (UPI)
    if (eff.upi > 0 || (b.paymentMode || '').toLowerCase() === 'upi') {
      const upiAmt = eff.upi > 0 ? eff.upi : (b.collectedAmount || 0);
      if (upiAmt > 0) {
        let gKey = '';
        const nb = (b.nextBillNo || '').trim();
        if (nb.startsWith('GPAY:')) {
          gKey = nb;
        } else if (nb.includes('+')) {
          gKey = `GPAY:${nb}`;
        } else {
          const pName = (b.partyName || '').trim().toLowerCase();
          const pTime = (b.paymentTime || '').trim();
          if (pTime && pTime !== '—') {
            gKey = `GPAY_${pName}_${recDate}_${pTime}`;
          } else {
            gKey = `GPAY_SINGLE_${b.id || cleanBn}`;
          }
        }

        bankItems.push({
          bill: b,
          billNo: cleanBn,
          recDate,
          recAmt: Math.round(upiAmt * 100) / 100,
          mode: 'GPAY',
          chequeNo: '',
          groupKey: gKey,
          partyName: b.partyName || '',
        });
      }
    }

    // Cheque
    if (eff.chq > 0 || (b.paymentMode || '').toLowerCase() === 'cheque' || (b.chequeNo && b.chequeNo.trim().length > 0)) {
      const chqAmt = eff.chq > 0 ? eff.chq : (b.collectedAmount || 0);
      if (chqAmt > 0) {
        const chqNo = (b.chequeNo || '').trim();
        const nb = (b.nextBillNo || '').trim();
        let gKey = '';
        if (chqNo) {
          gKey = `CHQ_${chqNo.toUpperCase()}`;
        } else if (nb.startsWith('CHQ:')) {
          gKey = nb;
        } else if (nb.includes('+')) {
          gKey = `CHQ:${nb}`;
        } else {
          gKey = `CHQ_SINGLE_${b.id || cleanBn}`;
        }

        bankItems.push({
          bill: b,
          billNo: cleanBn,
          recDate,
          recAmt: Math.round(chqAmt * 100) / 100,
          mode: 'CHEQUE',
          chequeNo: chqNo,
          groupKey: gKey,
          partyName: b.partyName || '',
        });
      }
    }
  }

  // 2. Build bill groups (single & multi)
  type BankGroup = {
    groupKey: string;
    recDate: string;
    mode: 'GPAY' | 'CHEQUE';
    chequeNo: string;
    partyName: string;
    totalAmount: number;
    items: BillBankItem[];
    matched: boolean;
  };

  const groupsMap = new Map<string, BankGroup>();
  for (const item of bankItems) {
    let grp = groupsMap.get(item.groupKey);
    if (!grp) {
      grp = {
        groupKey: item.groupKey,
        recDate: item.recDate,
        mode: item.mode,
        chequeNo: item.chequeNo,
        partyName: item.partyName,
        totalAmount: 0,
        items: [],
        matched: false,
      };
      groupsMap.set(item.groupKey, grp);
    }
    grp.totalAmount += item.recAmt;
    grp.items.push(item);
    if (item.chequeNo) grp.chequeNo = item.chequeNo;
  }

  // Round group totals
  for (const g of groupsMap.values()) {
    g.totalAmount = Math.round(g.totalAmount * 100) / 100;
  }

  const allGroups = Array.from(groupsMap.values());

  // 3. Match against statement entries
  hydrate();
  const matchedBillIds = new Set<string>(_matchedBillIds);
  const matchedBillNos = new Set<string>(_matchedBillNos);
  const manualMatches = { ..._manualMatches };

  // Map existing cached entries by ID and signature to preserve any previous match
  const existingMap = new Map<string, StatementEntry>();
  if (_cachedEntries && Array.isArray(_cachedEntries)) {
    for (const ex of _cachedEntries) {
      if (ex.matched) {
        existingMap.set(ex.id, ex);
        existingMap.set(getStatementEntrySignature(ex), ex);
      }
    }
  }

  const updatedEntries: StatementEntry[] = [];
  let totalStmtAmt = 0;

  // Clone entries to preserve original
  const entriesCopy: StatementEntry[] = [];

  for (const rawEntry of statementEntries) {
    totalStmtAmt += rawEntry.creditAmount;
    const sig = getStatementEntrySignature(rawEntry);
    const entry: StatementEntry = {
      ...rawEntry,
      matched: false,
      matchedBillNos: [],
      matchedBillIds: [],
    };

    // Priority 1: Check manual match record
    const dateAmtKey = `${rawEntry.date}_${Math.round(rawEntry.creditAmount * 100) / 100}`;
    const manMatch = manualMatches[sig] || manualMatches[entry.id] || manualMatches[dateAmtKey];
    if (manMatch && manMatch.billNos.length > 0) {
      entry.matched = true;
      entry.matchedBillNos = [...manMatch.billNos];
      entry.matchedBillIds = [...(manMatch.billIds || [])];
      entry.matchType = manMatch.billNos.length > 1 ? 'multi' : 'single';
      entry.matchGroupKey = `MANUAL_${manMatch.billNos.map(stripGST).join('+')}`;
      entry.isManual = true;
      for (const bn of manMatch.billNos) matchedBillNos.add(stripGST(bn));
      for (const id of manMatch.billIds || []) matchedBillIds.add(id);
      entriesCopy.push(entry);
      continue;
    }

    // Priority 2: Check previously matched existing entry
    const existing = existingMap.get(entry.id) || existingMap.get(sig);
    if (existing && existing.matched && existing.matchedBillNos.length > 0) {
      entry.matched = true;
      entry.matchedBillNos = [...existing.matchedBillNos];
      entry.matchedBillIds = [...existing.matchedBillIds];
      entry.matchType = existing.matchType;
      entry.matchGroupKey = existing.matchGroupKey;
      entry.isManual = existing.isManual;
      for (const bn of existing.matchedBillNos) matchedBillNos.add(stripGST(bn));
      for (const id of existing.matchedBillIds) matchedBillIds.add(id);
      entriesCopy.push(entry);
      continue;
    }

    entriesCopy.push(entry);
  }

  // Preserve previously matched historical statement entries if not in the new upload
  const currentSigs = new Set(entriesCopy.map(getStatementEntrySignature));
  const currentIds = new Set(entriesCopy.map(e => e.id));
  if (_cachedEntries && Array.isArray(_cachedEntries)) {
    for (const ex of _cachedEntries) {
      if (ex.matched && !currentIds.has(ex.id) && !currentSigs.has(getStatementEntrySignature(ex))) {
        entriesCopy.push(ex);
        totalStmtAmt += ex.creditAmount;
        for (const bn of ex.matchedBillNos) matchedBillNos.add(stripGST(bn));
        for (const id of ex.matchedBillIds) matchedBillIds.add(id);
      }
    }
  }

  // PASS 1: Multi-bill groups matching (by exact amount + date)
  // Multi-bill groups take precedence so combined sums match their statement deposit!
  // Exclude groups where any bill is already matched
  const multiGroups = allGroups.filter(g => g.items.length > 1);

  for (const entry of entriesCopy) {
    if (entry.matched) continue;

    // Try matching multi-bill group
    for (const grp of multiGroups) {
      if (grp.matched) continue;
      // Date must match exactly
      if (grp.recDate !== entry.date) continue;
      // Do not use bills that are already matched
      if (grp.items.some(item => matchedBillNos.has(stripGST(item.billNo)))) continue;
      // Amount must match
      if (Math.abs(grp.totalAmount - entry.creditAmount) < 0.05) {
        grp.matched = true;
        entry.matched = true;
        entry.matchType = 'multi';
        entry.matchGroupKey = grp.groupKey;
        for (const item of grp.items) {
          if (item.bill.id) matchedBillIds.add(item.bill.id);
          matchedBillNos.add(stripGST(item.billNo));
          entry.matchedBillNos.push(item.billNo);
          if (item.bill.id) entry.matchedBillIds.push(item.bill.id);
        }
        break;
      }
    }
  }

  // PASS 2: Single-bill groups matching (by exact amount + date)
  const singleGroups = allGroups.filter(g => g.items.length === 1);

  for (const entry of entriesCopy) {
    if (entry.matched) {
      updatedEntries.push(entry);
      continue;
    }

    for (const grp of singleGroups) {
      if (grp.matched) continue;
      // Date must match exactly
      if (grp.recDate !== entry.date) continue;
      // Do not use bills that are already matched
      if (grp.items.some(item => matchedBillNos.has(stripGST(item.billNo)))) continue;
      // Amount must match
      if (Math.abs(grp.totalAmount - entry.creditAmount) < 0.05) {
        grp.matched = true;
        entry.matched = true;
        entry.matchType = 'single';
        entry.matchGroupKey = grp.groupKey;
        const item = grp.items[0];
        if (item.bill.id) matchedBillIds.add(item.bill.id);
        matchedBillNos.add(stripGST(item.billNo));
        entry.matchedBillNos.push(item.billNo);
        if (item.bill.id) entry.matchedBillIds.push(item.bill.id);
        break;
      }
    }

    updatedEntries.push(entry);
  }

  // Compute stats using shared recalculateStats
  const stats = recalculateStats(updatedEntries, matchedBillNos);

  // Persist with manualMatches
  saveStatementMatchState(matchedBillIds, matchedBillNos, updatedEntries, stats, manualMatches);

  return {
    matchedBillIds,
    matchedBillNos,
    updatedEntries,
    stats,
  };
}
