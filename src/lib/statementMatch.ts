import { useState, useEffect, useCallback } from 'react';
import type { Bill } from '@/lib/billStore';
import { getEffAmt } from '@/lib/statementReport';
import { getDisplayBillNo } from '@/lib/commissionMoc';

export type StatementEntry = {
  id: string;
  date: string; // DD/MM/YYYY
  rawDate: string;
  description: string;
  creditAmount: number;
  matched: boolean;
  matchedBillNos: string[];
  matchedBillIds: string[];
  matchType?: 'single' | 'multi';
  matchGroupKey?: string;
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

// In-memory cache for ultra-fast render lookups
let _matchedBillIds = new Set<string>();
let _matchedBillNos = new Set<string>();
let _cachedStats: StatementMatchStats | null = null;
let _cachedEntries: StatementEntry[] | null = null;

function stripGST(bn: string) {
  return (bn || '').replace(/^GST[-_]/i, '').trim().toUpperCase();
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

// Hydrate from localStorage on boot
function hydrate() {
  if (typeof window === 'undefined') return;
  try {
    const rawIds = localStorage.getItem(LS_MATCHED_BILLS_KEY);
    if (rawIds) {
      const arr = JSON.parse(rawIds);
      if (Array.isArray(arr)) _matchedBillIds = new Set(arr);
    }
    const rawNos = localStorage.getItem(LS_MATCHED_NOS_KEY);
    if (rawNos) {
      const arr = JSON.parse(rawNos);
      if (Array.isArray(arr)) _matchedBillNos = new Set(arr.map(s => stripGST(s)));
    }
    const rawStats = localStorage.getItem(LS_STATEMENT_STATS_KEY);
    if (rawStats) {
      _cachedStats = JSON.parse(rawStats);
    }
    const rawEntries = localStorage.getItem(LS_STATEMENT_ENTRIES_KEY);
    if (rawEntries) {
      _cachedEntries = JSON.parse(rawEntries);
    }
  } catch {}
}

hydrate();

/**
 * Returns true if the bill was verified and matched against an uploaded bank statement.
 * Strictly enforced: Only GPAY (UPI) and CHEQUE entries can be matched and highlighted!
 */
export function isBillStatementMatched(b?: Bill | null): boolean {
  if (!b) return false;
  // Strict rule: ONLY GPay and Cheque entries match
  const mode = (b.paymentMode || '').toLowerCase();
  const isGpayOrChq = mode === 'upi' ||
                      mode === 'cheque' ||
                      (Number(b.upiAmount) || 0) > 0 ||
                      (Number(b.chequeAmount) || 0) > 0 ||
                      Boolean(b.chequeNo && b.chequeNo.trim().length > 0);
  if (!isGpayOrChq) return false;

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

/**
 * React hook to listen for statement match changes and trigger re-renders.
 */
export function useStatementMatch() {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const handler = () => setVersion(v => v + 1);
    window.addEventListener('vt-statement-match-updated', handler);
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
    clear: clearStatementMatchState,
  };
}

export function clearStatementMatchState() {
  _matchedBillIds = new Set();
  _matchedBillNos = new Set();
  _cachedStats = null;
  _cachedEntries = null;
  try {
    localStorage.removeItem(LS_MATCHED_BILLS_KEY);
    localStorage.removeItem(LS_MATCHED_NOS_KEY);
    localStorage.removeItem(LS_STATEMENT_STATS_KEY);
    localStorage.removeItem(LS_STATEMENT_ENTRIES_KEY);
    window.dispatchEvent(new CustomEvent('vt-statement-match-updated'));
  } catch {}
}

export function saveStatementMatchState(
  matchedIds: Set<string>,
  matchedNos: Set<string>,
  entries: StatementEntry[],
  stats: StatementMatchStats
) {
  _matchedBillIds = matchedIds;
  _matchedBillNos = matchedNos;
  _cachedEntries = entries;
  _cachedStats = stats;
  try {
    localStorage.setItem(LS_MATCHED_BILLS_KEY, JSON.stringify(Array.from(matchedIds)));
    localStorage.setItem(LS_MATCHED_NOS_KEY, JSON.stringify(Array.from(matchedNos)));
    localStorage.setItem(LS_STATEMENT_ENTRIES_KEY, JSON.stringify(entries));
    localStorage.setItem(LS_STATEMENT_STATS_KEY, JSON.stringify(stats));
    window.dispatchEvent(new CustomEvent('vt-statement-match-updated'));
  } catch {}
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
  const matchedBillIds = new Set<string>();
  const matchedBillNos = new Set<string>();
  const updatedEntries: StatementEntry[] = [];

  let matchedStmtCount = 0;
  let matchedStmtAmt = 0;
  let totalStmtAmt = 0;

  // Clone entries to preserve original
  const entriesCopy = statementEntries.map(e => ({
    ...e,
    matched: false,
    matchedBillNos: [] as string[],
    matchedBillIds: [] as string[],
  }));

  // PASS 1: Multi-bill groups matching (by exact amount + date)
  // Multi-bill groups take precedence so combined sums match their statement deposit!
  const multiGroups = allGroups.filter(g => g.items.length > 1);

  for (const entry of entriesCopy) {
    totalStmtAmt += entry.creditAmount;

    // Try matching multi-bill group
    for (const grp of multiGroups) {
      if (grp.matched) continue;
      // Date must match exactly
      if (grp.recDate !== entry.date) continue;
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
        matchedStmtCount++;
        matchedStmtAmt += entry.creditAmount;
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
        matchedStmtCount++;
        matchedStmtAmt += entry.creditAmount;
        break;
      }
    }

    updatedEntries.push(entry);
  }

  // Compute stats
  const now = new Date();
  const uploadedAt = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const stats: StatementMatchStats = {
    totalStatementRows: statementEntries.length,
    totalCreditAmount: Math.round(totalStmtAmt * 100) / 100,
    matchedStatementRows: matchedStmtCount,
    matchedStatementAmount: Math.round(matchedStmtAmt * 100) / 100,
    unmatchedStatementRows: statementEntries.length - matchedStmtCount,
    unmatchedStatementAmount: Math.round((totalStmtAmt - matchedStmtAmt) * 100) / 100,
    matchedBillsCount: matchedBillNos.size,
    matchedBillsTotalAmount: Math.round(matchedStmtAmt * 100) / 100,
    uploadedAt,
  };

  // Persist
  saveStatementMatchState(matchedBillIds, matchedBillNos, updatedEntries, stats);

  return {
    matchedBillIds,
    matchedBillNos,
    updatedEntries,
    stats,
  };
}
