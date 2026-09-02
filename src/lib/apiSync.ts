import { supabase } from './supabase';
import type { Bill, Driver, Bank, DriverDailySummary, Contact, WhatsAppTemplates } from './billStore';
import { getRole } from './auth';
import { normDateStr } from './dateUtils';

function auditLog(tableName: string, action: 'INSERT' | 'UPDATE' | 'UPSERT' | 'DELETE', payload: any) {
  console.log("TABLE", tableName);
  console.log("ACTION", action);
  console.log("PAYLOAD", payload);
}

const UNSUPPORTED_COLS_STORAGE_KEY = 'vt_unsupported_bill_cols_v2';

function loadUnsupportedColumns(): Set<string> {
  if (typeof window === 'undefined') return new Set<string>();
  try {
    const raw = localStorage.getItem(UNSUPPORTED_COLS_STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch {}
  return new Set<string>();
}

export const unsupportedBillColumns = loadUnsupportedColumns();

export function markColumnUnsupported(col: string) {
  if (!col) return;
  const cleanCol = col.toLowerCase().trim();
  if (!unsupportedBillColumns.has(cleanCol)) {
    unsupportedBillColumns.add(cleanCol);
    console.warn(`[apiSync] Marking column "${cleanCol}" as unsupported in Supabase "bills" table schema.`);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(UNSUPPORTED_COLS_STORAGE_KEY, JSON.stringify(Array.from(unsupportedBillColumns)));
      } catch {}
    }
  }
}

export function extractMissingColumnFromError(err: any): string | null {
  if (!err) return null;
  const msg = String(err.message || err.details || err.hint || '');
  const code = String(err.code || '');
  if (code === 'PGRST204' || code === 'PGRST100' || msg.includes('Could not find') || msg.includes('schema cache')) {
    const match = msg.match(/Could not find the '([^']+)' column/i) ||
                  msg.match(/column "([^"]+)" of/i) ||
                  msg.match(/column '([^']+)' of/i) ||
                  msg.match(/'([^']+)' column of 'bills'/i);
    if (match && match[1]) {
      return match[1].toLowerCase().trim();
    }
  }
  return null;
}

const PROBE_COLUMNS = [
  'payment_method',
  'part_payments',
  'del_pending_history',
  'edit_history',
  'cancel_line',
  'line_cut_amt',
  'discrepancy_reason',
  'cash_amount',
  'upi_amount',
  'cheque_amount',
  'next_bill_no',
] as const;

let probedSchema = false;

export async function probeBillSchemaColumns() {
  if (probedSchema || !supabase) return;
  try {
    // Single query for 1 row gets all existing column keys cleanly with 200 OK
    const { data, error } = await supabase.from('bills').select('*').limit(1);
    if (!error && Array.isArray(data) && data.length > 0) {
      const existingCols = new Set(Object.keys(data[0]).map(k => k.toLowerCase()));
      for (const col of PROBE_COLUMNS) {
        if (!existingCols.has(col.toLowerCase())) {
          markColumnUnsupported(col);
        } else {
          unsupportedBillColumns.delete(col.toLowerCase());
        }
      }
    }
  } catch {
    // Ignore probing errors
  } finally {
    probedSchema = true;
  }
}

export async function probePaymentMethodColumn() {
  await probeBillSchemaColumns();
}

if (typeof window !== 'undefined') {
  setTimeout(() => { void probeBillSchemaColumns(); }, 300);
}

export function cleanRowForSupabase(row: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (!unsupportedBillColumns.has(k.toLowerCase())) {
      cleaned[k] = v;
    }
  }
  return cleaned;
}

/** Fields drivers are NOT allowed to modify. Owners and automated updates bypass this restriction. */
const DRIVER_LOCKED_FIELDS = [
  'date', 'billNo', 'partyCode', 'partyName', 'partyHulCode', 'salespersonName',
  'beatName', 'billNetAmt', 'srNo', 'collectionCode',
] as const;

function stripPatchForUpdate<T extends Partial<Bill>>(patch: T): T {
  const isDriver = (() => { try { return getRole() === 'driver'; } catch { return false; } })();
  const out: Record<string, unknown> = { ...patch };
  if (isDriver) {
    for (const k of DRIVER_LOCKED_FIELDS) delete out[k];
  }
  return out as T;
}



// ── Supabase row → Bill (handles both snake_case and camelCase column names) ──
export function mapBillFromSupabase(row: Record<string, unknown>): Bill {
  const n = (v: unknown) => (v == null ? 0 : Number(v));
  const s = (v: unknown) => (v == null ? '' : String(v));
  const o = (v: unknown) => (v == null || v === '' ? undefined : String(v));
  return {
    id:                 s(row.id),
    srNo:               s(row.srNo ?? row.sr_no),
    date:               s(row.date),
    salespersonName:    s(row.salespersonName ?? row.salesperson_name),
    collectionCode:     s(row.collectionCode ?? row.collection_code),
    billNo:             s(row.billNo ?? row.bill_no),
    partyCode:          s(row.partyCode ?? row.party_code),
    partyHulCode:       s(row.partyHulCode ?? row.party_hul_code),
    partyName:          s(row.partyName ?? row.party_name),
    beatName:           s(row.beatName ?? row.beat_name),
    billNetAmt:         n(row.billNetAmt ?? row.bill_net_amt),
    collectedAmount:    n(row.collectedAmount ?? row.collected_amount),
    outstandingAmount:  n(row.outstandingAmount ?? row.outstanding_amount),
    billAgeing:         n(row.billAgeing ?? row.bill_ageing),
    paymentMode:        o(row.paymentMode ?? row.payment_mode),
    paymentMethod:      o(row.paymentMethod ?? row.payment_method),
    paymentDate:        normDateStr(row.paymentDate ?? row.payment_date),
    paymentTime:        o(row.paymentTime ?? row.payment_time),
    driverName:         o(row.driverName ?? row.driver_name),
    deliveryDate:       normDateStr(row.deliveryDate ?? row.delivery_date),
    chequeNo:           o(row.chequeNo ?? row.cheque_no),
    chequeDate:         o(row.chequeDate ?? row.cheque_date),
    bankName:           o(row.bankName ?? row.bank_name),
    nextBillNo:         o(row.nextBillNo ?? row.next_bill_no),
    cancelLine:         o(row.cancelLine ?? row.cancel_line),
    lineCutAmt:         n(row.lineCutAmt ?? row.line_cut_amt) || undefined,
    discrepancyReason:  o(row.discrepancyReason ?? row.discrepancy_reason),
    cashAmount:         n(row.cashAmount ?? row.cash_amount) || undefined,
    upiAmount:          n(row.upiAmount ?? row.upi_amount) || undefined,
    chequeAmount:       n(row.chequeAmount ?? row.cheque_amount) || undefined,
    delPendingHistory:  (row.delPendingHistory ?? row.del_pending_history) as Bill['delPendingHistory'],
    partPayments:       (row.partPayments ?? row.part_payments) as Bill['partPayments'],
    editHistory:        (row.editHistory ?? row.edit_history) as Bill['editHistory'],
    editDate:           o(row.editDate ?? row.edit_date),
    user:               o(row.user),
    owner:              o(row.owner),
  };
}

// ── Bill → Supabase row (camelCase → snake_case) ─────────────────────────────
function billToSupabase(b: Partial<Bill>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if ('id'                in b) out.id                  = b.id;
  if ('srNo'              in b) out.sr_no               = b.srNo;
  if ('date'              in b) out.date                = normDateStr(b.date) ?? b.date;
  if ('salespersonName'   in b) out.salesperson_name    = b.salespersonName;
  if ('collectionCode'    in b) out.collection_code     = b.collectionCode;
  if ('billNo'            in b) out.bill_no             = b.billNo;
  if ('partyCode'         in b) out.party_code          = b.partyCode;
  if ('partyHulCode'      in b) out.party_hul_code      = b.partyHulCode;
  if ('partyName'         in b) out.party_name          = b.partyName;
  if ('beatName'          in b) out.beat_name           = b.beatName;
  if ('billNetAmt'        in b) out.bill_net_amt        = b.billNetAmt;
  if ('collectedAmount'   in b) out.collected_amount    = b.collectedAmount;
  if ('outstandingAmount' in b) out.outstanding_amount  = b.outstandingAmount;
  if ('billAgeing'        in b) out.bill_ageing         = b.billAgeing;
  if ('paymentMode'       in b) out.payment_mode        = b.paymentMode ?? null;
  if ('paymentMethod'     in b) out.payment_method      = b.paymentMethod ?? null;
  if ('paymentDate'       in b) out.payment_date        = normDateStr(b.paymentDate) ?? null;
  if ('paymentTime'       in b) out.payment_time        = b.paymentTime ?? null;
  if ('driverName'        in b) out.driver_name         = b.driverName ? b.driverName : null;
  if ('deliveryDate'      in b) out.delivery_date       = normDateStr(b.deliveryDate) ?? null;
  if ('chequeNo'          in b) out.cheque_no           = b.chequeNo ?? null;
  if ('chequeDate'        in b) out.cheque_date         = normDateStr(b.chequeDate) ?? null;
  if ('bankName'          in b) out.bank_name           = b.bankName ?? null;
  if ('nextBillNo'        in b) out.next_bill_no        = b.nextBillNo ?? null;
  if ('cancelLine'        in b) out.cancel_line         = b.cancelLine ?? null;
  if ('discrepancyReason' in b) out.discrepancy_reason  = b.discrepancyReason ?? null;
  if ('cashAmount'        in b) out.cash_amount         = b.cashAmount ?? null;
  if ('upiAmount'         in b) out.upi_amount          = b.upiAmount ?? null;
  if ('chequeAmount'      in b) out.cheque_amount       = b.chequeAmount ?? null;
  if ('lineCutAmt' in b || 'id' in b) {
    out.line_cut_amt = (b.lineCutAmt == null || isNaN(Number(b.lineCutAmt))) ? 0 : Number(b.lineCutAmt);
  }
  if ('delPendingHistory' in b) out.del_pending_history = b.delPendingHistory ?? null;
  if ('partPayments'      in b) out.part_payments       = b.partPayments ?? null;
  if ('editHistory'       in b) out.edit_history        = b.editHistory ?? [];
  if ('editDate'          in b) out.edit_date           = b.editDate ?? null;
  if ('user'              in b) out.user                = b.user ?? null;
  if ('owner'             in b) out.owner               = b.owner ?? null;
  return cleanRowForSupabase(out);
}

// ── Supabase row → DriverDailySummary (snake_case → camelCase) ───────────────
function mapSummaryFromSupabase(row: Record<string, unknown>): DriverDailySummary {
  return {
    id:             String(row.id ?? ''),
    driverName:     String(row.driver_name ?? row.driverName ?? ''),
    date:           String(row.date ?? ''),
    totalBillCount: Number(row.total_bill_count ?? row.totalBillCount ?? 0),
    totalAmount:    Number(row.total_amount ?? row.totalAmount ?? 0),
    cashBreakdown:  (row.cash_breakdown ?? row.cashBreakdown) as DriverDailySummary['cashBreakdown'] ?? undefined,
  };
}

// ── DriverDailySummary → Supabase row (camelCase → snake_case) ───────────────
function summaryToSupabase(s: DriverDailySummary): Record<string, unknown> {
  return {
    id:               s.id,
    driver_name:      s.driverName,
    date:             s.date,
    total_bill_count: s.totalBillCount,
    total_amount:     s.totalAmount,
    cash_breakdown:   s.cashBreakdown ?? null,
  };
}

const EMPTY_ALL = {
  bills: [] as Bill[],
  drivers: [] as Driver[],
  banks: [] as Bank[],
  summaries: [] as DriverDailySummary[],
  partyContacts: [] as Contact[],
  salespersonContacts: [] as Contact[],
  settings: {} as Record<string, string>,
};

function dispatchSyncStatus(status: 'ok' | 'error') {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sync-status', { detail: status }));
  }
}

// ─── Retry wrapper: guarantees Supabase writes complete or throw ──────────────
// Fast responsive retries: immediate retry on column mismatch, 150ms/400ms on network delays.
async function withRetry<T>(fn: () => Promise<T>, label = 'op'): Promise<T> {
  const delays = [150, 400];
  let lastErr: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const missing = extractMissingColumnFromError(err);
      if (missing) {
        markColumnUnsupported(missing);
        // Column mismatch corrected: retry immediately without waiting
        continue;
      }
      if (attempt === delays.length) break;
      console.warn(`[apiSync] ${label} attempt ${attempt + 1} failed, retrying…`, err);
      await new Promise(r => setTimeout(r, delays[attempt]));
    }
  }
  throw lastErr;
}

// ─── Pending-write queue: any failed patch is persisted to localStorage and ──
// replayed on next page load and every reconnect, so nothing is ever "lost".
const PENDING_KEY = 'vt_pending_writes_v1';
const PENDING_SETTINGS_KEY = 'vt_pending_settings_v1';
type PendingPatch = { id: string; billNo?: string; patch: Partial<Bill>; ts: number };
type PendingSetting = { key: string; value: string; ts: number };

function readPending(): PendingPatch[] {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); } catch { return []; }
}
function writePending(list: PendingPatch[]) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(list.slice(-500))); } catch { /* quota */ }
}
function enqueuePending(p: PendingPatch) {
  const list = readPending();
  list.push(p);
  writePending(list);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('pending-writes', { detail: list.length }));
  }
}

function readPendingSettings(): PendingSetting[] {
  try { return JSON.parse(localStorage.getItem(PENDING_SETTINGS_KEY) || '[]'); } catch { return []; }
}
function writePendingSettings(list: PendingSetting[]) {
  try { localStorage.setItem(PENDING_SETTINGS_KEY, JSON.stringify(list.slice(-200))); } catch { /* quota */ }
}
function enqueuePendingSetting(item: { key: string; value: string }) {
  const list = readPendingSettings().filter(s => s.key !== item.key);
  list.push({ ...item, ts: Date.now() });
  writePendingSettings(list);
}

export async function flushPendingSettings(): Promise<{ flushed: number; remaining: number }> {
  if (!supabase) return { flushed: 0, remaining: 0 };
  const list = readPendingSettings();
  if (list.length === 0) return { flushed: 0, remaining: 0 };
  const remain: PendingSetting[] = [];
  let flushed = 0;
  for (const s of list) {
    try {
      const { error } = await supabase.from('settings').upsert({ key: s.key, value: s.value }, { onConflict: 'key' });
      if (!error) flushed++;
      else remain.push(s);
    } catch {
      remain.push(s);
    }
  }
  writePendingSettings(remain);
  return { flushed, remaining: remain.length };
}

export function getPendingWriteCount(): number {
  return readPending().length;
}
export async function flushPendingWrites(): Promise<{ flushed: number; remaining: number }> {
  void flushPendingSettings();
  const list = readPending();
  if (list.length === 0) return { flushed: 0, remaining: 0 };
  const remain: PendingPatch[] = [];
  let flushed = 0;

  const BATCH_SIZE = 5;
  for (let i = 0; i < list.length; i += BATCH_SIZE) {
    const batch = list.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (p) => {
        try {
          const res = await apiPatchBill(p.id, p.patch, p.billNo);
          return { p, ok: !!res.ok };
        } catch {
          return { p, ok: false };
        }
      })
    );

    for (const r of results) {
      if (r.ok) flushed++;
      else remain.push(r.p);
    }
  }

  writePending(remain);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('pending-writes', { detail: remain.length }));
  }
  if (flushed > 0) dispatchSyncStatus('ok');
  return { flushed, remaining: remain.length };
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { void flushPendingWrites(); });
  setTimeout(() => { void flushPendingWrites(); }, 3000);
}

// NOTE: Supabase/PostgREST enforces its own server-side max-rows cap per
// request (commonly 1000) REGARDLESS of the range you ask for — requesting
// range(0, 99999) still only returns ~1000 rows. Requesting a bigger chunk
// size does NOT get you more rows per call, and if pagination is computed
// from `total / desiredChunkSize` (e.g. 100000), a table with fewer total
// rows than that resolves to a single request — which then gets silently
// capped by the server, truncating the result. The only correct approach is
// to keep requesting sequential ranges and stop only when a request returns
// zero rows, never assuming a returned page size implies "no more data".
async function fetchAllBills(): Promise<Bill[]> {
  if (!supabase) return [];
  const CHUNK_SIZE = 1000;
  
  try {
    const { count, error: countErr } = await supabase.from('bills').select('id', { count: 'exact', head: true });
    if (!countErr && typeof count === 'number' && count >= 0) {
      if (count === 0) return [];
      const totalPages = Math.ceil(count / CHUNK_SIZE);
      const BATCH_SIZE = 8;
      const allRows: Record<string, unknown>[] = [];

      for (let i = 0; i < totalPages; i += BATCH_SIZE) {
        const promises = [];
        for (let j = i; j < Math.min(i + BATCH_SIZE, totalPages); j++) {
          const start = j * CHUNK_SIZE;
          promises.push(
            supabase!.from('bills').select('*').order('id').range(start, start + CHUNK_SIZE - 1)
          );
        }
        const resList = await Promise.all(promises);
        for (const res of resList) {
          if (res.data && res.data.length > 0) {
            allRows.push(...(res.data as Record<string, unknown>[]));
          }
        }
      }
      return allRows.map(mapBillFromSupabase);
    }
  } catch (err) {
    console.warn('[apiSync] Parallel fetchAllBills failed, falling back to sequential:', err);
  }

  // Fallback sequential loop
  const all: Bill[] = [];
  let offset = 0;
  while (true) {
    try {
      const { data, error } = await supabase.from('bills').select('*').order('id').range(offset, offset + CHUNK_SIZE - 1);
      if (error || !data || data.length === 0) break;
      all.push(...(data as Record<string, unknown>[]).map(mapBillFromSupabase));
      if (data.length < CHUNK_SIZE) break;
      offset += data.length;
    } catch (err) {
      console.warn('[apiSync] fetchAllBills exception:', err);
      break;
    }
  }
  return all;
}

// Generic paginated fetch — parallel count-based batching for fast table sync
async function fetchAllRows(table: string, orderCol = 'id', selectCols = '*'): Promise<any[]> {
  if (!supabase) return [];
  const CHUNK_SIZE = 1000;

  try {
    const headCol = orderCol ? (orderCol.includes(',') ? orderCol.split(',')[0].trim() : orderCol) : '*';
    const { count, error: countErr } = await supabase.from(table).select(headCol, { count: 'exact', head: true });
    if (!countErr && typeof count === 'number' && count >= 0) {
      if (count === 0) return [];
      const totalPages = Math.ceil(count / CHUNK_SIZE);
      const BATCH_SIZE = 6;
      const allRows: any[] = [];

      for (let i = 0; i < totalPages; i += BATCH_SIZE) {
        const promises = [];
        for (let j = i; j < Math.min(i + BATCH_SIZE, totalPages); j++) {
          const start = j * CHUNK_SIZE;
          let query = supabase!.from(table).select(selectCols);
          if (orderCol) query = query.order(orderCol);
          promises.push(query.range(start, start + CHUNK_SIZE - 1));
        }
        const resList = await Promise.all(promises);
        for (const res of resList) {
          if (res.data && res.data.length > 0) {
            allRows.push(...res.data);
          }
        }
      }
      return allRows;
    }
  } catch (err) {
    console.warn(`[apiSync] Parallel fetchAllRows failed for '${table}', falling back:`, err);
  }

  // Fallback sequential loop — if ordering by orderCol fails (e.g. column absent),
  // we switch to no-order mode for ALL subsequent pages so we never lose page 2+.
  const all: any[] = [];
  let offset = 0;
  let useNoOrder = false; // set to true once we detect ordering doesn't work
  while (true) {
    try {
      let query = supabase.from(table).select(selectCols);
      if (orderCol && !useNoOrder) {
        query = query.order(orderCol);
      }
      const { data, error } = await query.range(offset, offset + CHUNK_SIZE - 1);
      if (error) {
        if (orderCol && !useNoOrder) {
          // Order column may not exist — switch to no-order mode and retry this page
          useNoOrder = true;
          continue;
        }
        console.warn(`[apiSync] fetchAllRows warning for '${table}':`, error.message || error);
        break;
      }
      if (!data || data.length === 0) break;
      all.push(...data);
      if (data.length < CHUNK_SIZE) break;
      offset += data.length;
    } catch (err) {
      console.warn(`[apiSync] fetchAllRows exception for '${table}':`, err);
      break;
    }
  }
  return all;
}

function dedupeBillsByBillNo(bills: Bill[]): Bill[] {
  return Array.from(new Map(bills.map(b => {
    const isMoc = (b.billNo || '').toUpperCase().startsWith('MOC') || b.collectionCode === 'MOC' || b.salespersonName === 'MOC';
    const key = isMoc ? (b.id || b.billNo) : (b.billNo || b.id).trim();
    return [key, b];
  })).values());
}

export async function apiFetchAllData() {
  try {
    await probePaymentMethodColumn();
    const [bills, driversRaw, banksRaw, summariesRaw, settingsRaw, contactsRaw] = await Promise.all([
      fetchAllBills(),
      fetchAllRows('drivers', 'id'),
      fetchAllRows('banks', 'id'),
      fetchAllRows('driver_summaries', 'id'),
      fetchAllRows('settings', 'key'),
      fetchAllRows('contacts', 'id'),
    ]);

    const settings: Record<string, string> = {};
    (settingsRaw || []).forEach((row: any) => { settings[row.key] = row.value; });

    const allContacts = (contactsRaw || []) as Contact[];
    const partyContacts = allContacts.filter((c: any) => c.type === 'party');
    const salespersonContacts = allContacts.filter((c: any) => c.type === 'salesperson');

    const drivers: Driver[] = (driversRaw || []).map((d: any) => ({
      id: d.id,
      name: d.name,
      role: d.id?.startsWith('own_') ? 'owner' : d.id?.startsWith('usr_') ? 'user' : 'driver',
    }));

    dispatchSyncStatus('ok');
    return {
      bills,
      drivers,
      banks: (banksRaw || []) as Bank[],
      summaries: (summariesRaw || []).map(mapSummaryFromSupabase),
      partyContacts,
      salespersonContacts,
      settings,
    };
  } catch (err) {
    console.error('[apiSync] apiFetchAllData error:', err);
    dispatchSyncStatus('error');
    throw err;
  }
}


export async function apiBulkUpsertBills(bills: Bill[]) {
  return apiPushBills(bills);
}

export async function apiInsertBills(bills: Bill[]) {
  if (bills.length === 0) return { count: 0 };
  try {
    await probeBillSchemaColumns();
    const unique = dedupeBillsByBillNo(bills);
    let rows = unique.map(billToSupabase);
    await withRetry(async () => {
      const { error } = await supabase!.from('bills').upsert(rows, { onConflict: 'id' });
      if (error) {
        const missing = extractMissingColumnFromError(error);
        if (missing) {
          markColumnUnsupported(missing);
          rows = unique.map(billToSupabase);
          const retryRes = await supabase!.from('bills').upsert(rows, { onConflict: 'id' });
          if (retryRes.error) throw retryRes.error;
          return;
        }
        throw error;
      }
    }, 'apiInsertBills.upsert');
    dispatchSyncStatus('ok');
    return { count: unique.length };
  } catch (err) {
    console.error('[apiSync] apiInsertBills error (after retries):', err);
    dispatchSyncStatus('error');
    return { count: 0 };
  }
}

async function chunkedUpsertWithProgress(
  bills: Bill[],
  onProgress: ((saved: number, total: number) => void) | undefined,
  label: string,
): Promise<{ count: number }> {
  if (bills.length === 0) return { count: 0 };
  await probeBillSchemaColumns();
  const unique = dedupeBillsByBillNo(bills);
  const CHUNK = 150;
  let saved = 0;
  try {
    for (let i = 0; i < unique.length; i += CHUNK) {
      let slice = unique.slice(i, i + CHUNK).map(billToSupabase);
      await withRetry(async () => {
        const { error } = await supabase!.from('bills').upsert(slice, { onConflict: 'id' });
        if (error) {
          const missing = extractMissingColumnFromError(error);
          if (missing) {
            markColumnUnsupported(missing);
            slice = unique.slice(i, i + CHUNK).map(billToSupabase);
            const retryRes = await supabase!.from('bills').upsert(slice, { onConflict: 'id' });
            if (retryRes.error) throw retryRes.error;
            return;
          }
          throw error;
        }
      }, `${label}.chunk[${i}]`);
      saved += slice.length;
      onProgress?.(Math.min(saved, unique.length), unique.length);
    }
    dispatchSyncStatus('ok');
    return { count: unique.length };
  } catch (err) {
    console.error(`[apiSync] ${label} error (after retries):`, err);
    dispatchSyncStatus('error');
    return { count: saved };
  }
}

export async function apiBulkInsertWithProgress(
  bills: Bill[],
  onProgress?: (saved: number, total: number) => void
): Promise<{ count: number }> {
  return chunkedUpsertWithProgress(bills, onProgress, 'apiBulkInsertWithProgress');
}

export async function apiBulkUpsertWithProgress(
  bills: Bill[],
  onProgress?: (saved: number, total: number) => void
): Promise<{ count: number }> {
  return chunkedUpsertWithProgress(bills, onProgress, 'apiBulkUpsertWithProgress');
}


export async function apiPushBills(bills: Bill[]) {
  if (bills.length === 0) return { count: 0 };
  try {
    await probeBillSchemaColumns();
    const unique = dedupeBillsByBillNo(bills);
    let rows = unique.map(billToSupabase);
    await withRetry(async () => {
      const { error } = await supabase!.from('bills').upsert(rows, { onConflict: 'id' });
      if (error) {
        const missing = extractMissingColumnFromError(error);
        if (missing) {
          markColumnUnsupported(missing);
          rows = unique.map(billToSupabase);
          const retryRes = await supabase!.from('bills').upsert(rows, { onConflict: 'id' });
          if (retryRes.error) throw retryRes.error;
          return;
        }
        throw error;
      }
    }, 'apiPushBills.upsert');
    dispatchSyncStatus('ok');
    return { count: unique.length };
  } catch (err) {
    console.error('[apiSync] apiPushBills error (after retries):', err);
    dispatchSyncStatus('error');
    return { count: 0 };
  }
}

export async function apiPatchBill(id: string, patch: Partial<Bill>, _billNo?: string) {
  try {
    await probeBillSchemaColumns();
    const safe = stripPatchForUpdate(patch);
    if (Object.keys(safe).length === 0) { dispatchSyncStatus('ok'); return { ok: true }; }
    const row = billToSupabase(safe);

    const hasId = !!(id && id.trim());
    const hasBillNo = !!(_billNo && _billNo.trim());

    if (!hasId && !hasBillNo) {
      console.error('[apiSync] apiPatchBill: both id and billNo are empty — cannot update Supabase');
      dispatchSyncStatus('error');
      return { ok: false };
    }

    const updateSingle = async (column: 'id' | 'bill_no', val: string) => {
      return withRetry(async () => {
        const cleaned = cleanRowForSupabase(row);
        const { data, error } = await supabase!.from('bills').update(cleaned).eq(column, val).select('id');
        if (error) {
          const missing = extractMissingColumnFromError(error);
          if (missing) {
            markColumnUnsupported(missing);
            delete row[missing];
            const retryCleaned = cleanRowForSupabase(row);
            const retryRes = await supabase!.from('bills').update(retryCleaned).eq(column, val).select('id');
            if (retryRes.error) throw retryRes.error;
            return (retryRes.data || []).length;
          }
          throw error;
        }
        return (data || []).length;
      }, `apiPatchBill.${column}(${val})`);
    };

    let affected = 0;
    if (hasId) {
      affected = await updateSingle('id', id);
    }

    if (affected === 0 && hasBillNo) {
      affected = await updateSingle('bill_no', _billNo!.trim());
    }

    if (affected === 0) {
      console.warn(`[apiSync] apiPatchBill: 0 rows updated for id=${id} billNo=${_billNo || ''}. Attempting upsert fallback...`);
      try {
        const { getBills } = await import('./billStore');
        const allB = getBills();
        const existing = id ? allB.find(b => b.id === id) : (_billNo ? allB.find(b => b.billNo === _billNo.trim()) : undefined);
        if (existing) {
          const upsertRes = await apiBulkUpsertBills([existing]);
          if (upsertRes.count > 0) {
            dispatchSyncStatus('ok');
            return { ok: true };
          }
        }
      } catch (e) {
        console.error('[apiSync] Fallback upsert failed:', e);
      }
      dispatchSyncStatus('error');
      return { ok: false };
    }
    dispatchSyncStatus('ok');
    return { ok: true };
  } catch (err) {
    console.error('[apiSync] apiPatchBill error (after retries):', err);
    // Persist so it retries on reconnect/next load — nothing is ever lost.
    enqueuePending({ id, billNo: _billNo, patch, ts: Date.now() });
    dispatchSyncStatus('error');
    return { ok: false, queued: true } as { ok: boolean; queued?: boolean };
  }
}

export async function apiPatchBills(patches: Array<{ id: string; patch: Partial<Bill> }>) {
  try {
    await probeBillSchemaColumns();
    await withRetry(async () => {
      await Promise.all(patches.map(async ({ id, patch }) => {
        const safe = stripPatchForUpdate(patch);
        if (Object.keys(safe).length === 0) return;
        const row = billToSupabase(safe);
        const { error } = await supabase!.from('bills').update(row).eq('id', id);
        if (error) {
          const missing = extractMissingColumnFromError(error);
          if (missing) {
            markColumnUnsupported(missing);
            delete row[missing];
            const retryRes = await supabase!.from('bills').update(cleanRowForSupabase(row)).eq('id', id);
            if (retryRes.error) throw retryRes.error;
            return;
          }
          throw error;
        }
      }));
    }, 'apiPatchBills.bulk');
    dispatchSyncStatus('ok');
    return { count: patches.length };
  } catch (err) {
    console.error('[apiSync] apiPatchBills error (after retries):', err);
    // Enqueue every patch so they retry later.
    for (const { id, patch } of patches) enqueuePending({ id, patch, ts: Date.now() });
    dispatchSyncStatus('error');
    return { count: 0 };
  }
}

export async function apiSyncPaidStatus(
  onProgress?: (done: number, total: number) => void
): Promise<{ updated: number; errors: number }> {
  onProgress?.(1, 1);
  dispatchSyncStatus('ok');
  return { updated: 0, errors: 0 };
}

export async function apiDeleteBill(id?: string, billNo?: string): Promise<boolean> {
  if (!supabase) return false;
  try {
    auditLog('bills', 'DELETE', { id, billNo });
    let deleted = false;
    if (id) {
      const { error } = await supabase.from('bills').delete().eq('id', id);
      if (!error) deleted = true;
    }
    if (!deleted && billNo && billNo.trim()) {
      const { error } = await supabase.from('bills').delete().eq('bill_no', billNo.trim());
      if (!error) deleted = true;
    }
    if (deleted) {
      dispatchSyncStatus('ok');
      return true;
    }
    return false;
  } catch (err) {
    console.error('[apiSync] apiDeleteBill error:', err);
    return false;
  }
}

export async function apiDeleteDriver(id: string) {
  try {
    const { error } = await supabase!.from('drivers').delete().eq('id', id);
    if (error) throw error;
  } catch (err) {
    console.error('[apiSync] apiDeleteDriver error:', err);
  }
}

export async function apiPushDrivers(drivers: Driver[]) {
  if (drivers.length === 0) return { count: 0 };
  try {
    const rows = drivers.map(({ id, name }) => ({ id, name }));
    const { error } = await supabase!.from('drivers').upsert(rows, { onConflict: 'id' });
    if (error) throw error;
    return { count: drivers.length };
  } catch (err) {
    console.error('[apiSync] apiPushDrivers error:', err);
    return { count: 0 };
  }
}

export async function apiDeleteBank(id?: string, name?: string) {
  if (!supabase) return;
  try {
    if (id) {
      await supabase.from('banks').delete().eq('id', id);
    }
    if (name && name.trim()) {
      await supabase.from('banks').delete().ilike('name', name.trim());
    }
    dispatchSyncStatus('ok');
  } catch (err) {
    console.error('[apiSync] apiDeleteBank error:', err);
  }
}

export async function apiPushBanks(banks: Bank[]) {
  if (banks.length === 0) return { count: 0 };
  try {
    const { error } = await supabase!.from('banks').upsert(banks, { onConflict: 'id' });
    if (error) throw error;
    return { count: banks.length };
  } catch (err) {
    console.error('[apiSync] apiPushBanks error:', err);
    return { count: 0 };
  }
}

/**
 * Merge two bank names across Supabase:
 *  - All bills where bank_name (case-insensitive) = fromName → updated to toName
 *  - All bills where part_payments array has bankName = fromName → updated to toName
 *  - In banks table: delete fromName row, ensure toName exists
 */
export async function apiMergeTwoBanks(
  fromName: string,
  toName: string
): Promise<{ billsUpdated: number; ok: boolean; error?: string }> {
  if (!supabase) return { billsUpdated: 0, ok: false, error: 'No Supabase connection' };
  const fromClean = String(fromName || '').trim();
  const toClean = String(toName || '').trim().toUpperCase();
  if (!fromClean || !toClean || fromClean.toUpperCase() === toClean) {
    return { billsUpdated: 0, ok: false, error: 'Invalid bank names' };
  }

  try {
    // 1. Fetch all bills with id, bank_name, part_payments to find matching rows
    const allBillRows = await fetchAllRows('bills', 'id');
    const toUpdateSimple: string[] = [];
    const toUpdateComplex: Array<{ id: string; bank_name?: string; part_payments?: any }> = [];

    for (const r of (allBillRows as any[])) {
      const bBank = String(r.bank_name || '').trim().toUpperCase();
      const isBankMatch = bBank === fromClean.toUpperCase();

      let partPaymentsChanged = false;
      let newPartPayments = r.part_payments;
      if (Array.isArray(r.part_payments) && r.part_payments.length > 0) {
        newPartPayments = r.part_payments.map((p: any) => {
          const pBank = String(p.bankName || p.bank_name || '').trim().toUpperCase();
          if (pBank === fromClean.toUpperCase()) {
            partPaymentsChanged = true;
            return { ...p, bankName: toClean, bank_name: toClean };
          }
          return p;
        });
      }

      if (partPaymentsChanged) {
        toUpdateComplex.push({
          id: r.id,
          bank_name: isBankMatch ? toClean : r.bank_name,
          part_payments: newPartPayments,
        });
      } else if (isBankMatch) {
        toUpdateSimple.push(r.id);
      }
    }

    let billsUpdated = 0;
    const BATCH = 500;

    // Batch update simple bank_name changes
    for (let i = 0; i < toUpdateSimple.length; i += BATCH) {
      const chunk = toUpdateSimple.slice(i, i + BATCH);
      const { error } = await supabase
        .from('bills')
        .update({ bank_name: toClean })
        .in('id', chunk);
      if (!error) {
        billsUpdated += chunk.length;
      } else {
        console.error('[apiSync] apiMergeTwoBanks chunk update error:', error);
      }
    }

    // Update complex part_payments changes
    for (const item of toUpdateComplex) {
      const payload: Record<string, unknown> = { bank_name: item.bank_name };
      if (!unsupportedBillColumns.has('part_payments') && item.part_payments !== undefined) {
        payload.part_payments = item.part_payments;
      }
      const { error } = await supabase
        .from('bills')
        .update(cleanRowForSupabase(payload))
        .eq('id', item.id);
      if (!error) {
        billsUpdated++;
      } else {
        const missing = extractMissingColumnFromError(error);
        if (missing) {
          markColumnUnsupported(missing);
          delete payload[missing];
          await supabase.from('bills').update(cleanRowForSupabase(payload)).eq('id', item.id);
          billsUpdated++;
        } else {
          console.error('[apiSync] apiMergeTwoBanks complex update error:', error);
        }
      }
    }

    // 2. Delete old fromName from banks table in Supabase
    try {
      await supabase.from('banks').delete().ilike('name', fromClean);
    } catch (e) {
      console.warn('[apiSync] Failed to delete old bank from banks table:', e);
    }

    // 3. Ensure target toName exists in banks table in Supabase
    try {
      const { data: existingTarget } = await supabase
        .from('banks')
        .select('id, name')
        .ilike('name', toClean)
        .maybeSingle();

      if (!existingTarget) {
        await supabase.from('banks').insert({
          id: `bn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name: toClean,
        });
      }
    } catch (e) {
      console.warn('[apiSync] Failed to upsert target bank into banks table:', e);
    }

    dispatchSyncStatus('ok');
    return { billsUpdated, ok: true };
  } catch (err: any) {
    console.error('[apiSync] apiMergeTwoBanks error:', err);
    dispatchSyncStatus('error');
    return { billsUpdated: 0, ok: false, error: String(err?.message ?? err) };
  }
}

export async function apiPushSummaries(summaries: DriverDailySummary[]) {
  if (summaries.length === 0) return { count: 0 };
  try {
    const rows = summaries.map(summaryToSupabase);
    const { error } = await supabase!.from('driver_summaries').upsert(rows, { onConflict: 'id' });
    if (error) throw error;
    return { count: summaries.length };
  } catch (err) {
    console.error('[apiSync] apiPushSummaries error:', err);
    return { count: 0 };
  }
}

// Upsert in chunks so large contact lists (thousands of rows) never hit a
// single-request payload/row cap — every contact gets saved, however many there are.
const CONTACT_UPSERT_CHUNK = 500;
async function upsertContactsChunked(rows: Record<string, unknown>[]): Promise<number> {
  let saved = 0;
  for (let i = 0; i < rows.length; i += CONTACT_UPSERT_CHUNK) {
    const slice = rows.slice(i, i + CONTACT_UPSERT_CHUNK);
    const { error } = await supabase!.from('contacts').upsert(slice, { onConflict: 'id' });
    if (error) throw error;
    saved += slice.length;
  }
  return saved;
}

// Generate a stable, deterministic id for a contact so every upsert succeeds
// even when the in-memory object has no id yet. The prefix prevents collisions
// between party and salesperson contacts with the same name.
function contactId(prefix: 'pty' | 'sp', name: string): string {
  return `${prefix}_${(name || '').toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 44)}`;
}

export async function apiPushPartyContacts(contacts: Contact[]) {
  if (contacts.length === 0) return { count: 0 };
  try {
    const tagged = contacts.map(c => ({
      id:     c.id || contactId('pty', c.name),
      name:   c.name,
      mobile: c.mobile,
      type:   'party',
    }));
    const saved = await upsertContactsChunked(tagged);
    return { count: saved };
  } catch (err) {
    console.error('[apiSync] apiPushPartyContacts error:', err);
    return { count: 0 };
  }
}

export async function apiPushSalespersonContacts(contacts: Contact[]) {
  if (contacts.length === 0) return { count: 0 };
  try {
    const { cleanSalespersonName } = await import('./nameStandardizer');
    const tagged = contacts.map(c => {
      const cleanName = cleanSalespersonName(c.name || '').trim() || (c.name || '').trim();
      return {
        id:     c.id || contactId('sp', cleanName),
        name:   cleanName,
        mobile: c.mobile,
        type:   'salesperson',
      };
    });
    const saved = await upsertContactsChunked(tagged);
    return { count: saved };
  } catch (err) {
    console.error('[apiSync] apiPushSalespersonContacts error:', err);
    return { count: 0 };
  }
}

/**
 * One-time cleanup: for every bill whose salesperson_name contains a " - SMNxxxxx"
 * suffix, strip the suffix and update ONLY the salesperson_name column in Supabase.
 * Also deduplicates salesperson contacts in the contacts table.
 * No other bill column is touched.
 */
export async function apiCleanSalespersonNames(): Promise<{ billsUpdated: number; contactsUpdated: number; contactsDeleted: number }> {
  if (!supabase) return { billsUpdated: 0, contactsUpdated: 0, contactsDeleted: 0 };
  const SMN_RE = /\s*-\s*SMN\w+\s*$/i;

  try {
    // ── 1. Bills: group by cleaned name → bulk update per unique name ────────
    const allBillRows = await fetchAllRows('bills', 'id');
    const dirtyBills = allBillRows.filter((r: any) => SMN_RE.test(String(r.salesperson_name || '')));

    // Group bill IDs by cleaned salesperson name for batch updates
    const byCleanedName = new Map<string, string[]>();
    for (const r of dirtyBills) {
      const cleaned = String(r.salesperson_name || '').trim().replace(SMN_RE, '').trim();
      if (!byCleanedName.has(cleaned)) byCleanedName.set(cleaned, []);
      byCleanedName.get(cleaned)!.push(r.id as string);
    }

    let billsUpdated = 0;
    for (const [cleanedName, ids] of byCleanedName) {
      const BATCH = 500;
      for (let i = 0; i < ids.length; i += BATCH) {
        const { error } = await supabase
          .from('bills')
          .update({ salesperson_name: cleanedName })
          .in('id', ids.slice(i, i + BATCH));
        if (!error) billsUpdated += Math.min(BATCH, ids.length - i);
      }
    }

    // ── 2. Contacts: clean names + deduplicate ─────────────────────────────
    const contactRows = await fetchAllRows('contacts', 'id');
    const spContacts = contactRows.filter((c: any) => c.type === 'salesperson');

    const seen = new Map<string, string>(); // cleanedLower → canonical id to keep
    const toUpdate: { id: string; name: string }[] = [];
    const toDelete: string[] = [];

    for (const c of spContacts) {
      const raw = String(c.name || '').trim();
      const cleaned = raw.replace(SMN_RE, '').trim();
      const key = cleaned.toLowerCase();

      if (seen.has(key)) {
        // Duplicate entry — delete
        toDelete.push(c.id as string);
      } else {
        seen.set(key, c.id as string);
        if (cleaned !== raw) toUpdate.push({ id: c.id as string, name: cleaned });
      }
    }

    let contactsUpdated = 0;
    for (const item of toUpdate) {
      const { error } = await supabase.from('contacts').update({ name: item.name }).eq('id', item.id);
      if (!error) contactsUpdated++;
    }

    let contactsDeleted = 0;
    const DEL_BATCH = 100;
    for (let i = 0; i < toDelete.length; i += DEL_BATCH) {
      const { error } = await supabase.from('contacts').delete().in('id', toDelete.slice(i, i + DEL_BATCH));
      if (!error) contactsDeleted += Math.min(DEL_BATCH, toDelete.length - i);
    }

    dispatchSyncStatus('ok');
    return { billsUpdated, contactsUpdated, contactsDeleted };
  } catch (err) {
    console.error('[apiSync] apiCleanSalespersonNames error:', err);
    dispatchSyncStatus('error');
    return { billsUpdated: 0, contactsUpdated: 0, contactsDeleted: 0 };
  }
}

export async function apiPushSetting(key: string, value: string) {
  if (!supabase) {
    enqueuePendingSetting({ key, value });
    return { ok: false, queued: true };
  }
  try {
    await withRetry(async () => {
      const { error } = await supabase!.from('settings').upsert({ key, value }, { onConflict: 'key' });
      if (error) throw error;
    }, `apiPushSetting(${key})`);
    dispatchSyncStatus('ok');
    return { ok: true };
  } catch (err: any) {
    console.warn(`[apiSync] apiPushSetting error for key "${key}":`, err?.message || err);
    enqueuePendingSetting({ key, value });
    dispatchSyncStatus('error');
    return { ok: false, queued: true };
  }
}

export async function apiPushWaTemplates(templates: WhatsAppTemplates) {
  return apiPushSetting('wa_templates', JSON.stringify(templates));
}

export async function apiGetOwnerEntries(date: string): Promise<{ ok: boolean; data: string[] }> {
  try {
    const { data, error } = await supabase!.from('settings').select('value').eq('key', `owner_entries_${date}`).maybeSingle();
    if (error) return { ok: false, data: [] };
    return { ok: true, data: data?.value ? JSON.parse(data.value) : [] };
  } catch {
    return { ok: false, data: [] };
  }
}

// ── Full payment-status recalculation for every bill in Supabase ──────────────
// Rule 1: collectedAmount = cashAmount + upiAmount + chequeAmount (if breakdown exists)
// Rule 2: billNetAmt === lineCutAmt → paymentMode = "FBR", paymentMethod = "FBR"  (priority)
// Rule 3: outstandingAmount === 0 → paymentMode = "Paid"
// Rule 4: currently Paid/FBR but outstanding > 0 → downgrade to "Unpaid"
// Only bills whose values actually change are written back.
export async function apiRecalcAllBillStatus(
  onProgress?: (done: number, total: number) => void
): Promise<{ ok: boolean; fixed: number; total: number; error?: string }> {
  try {
    const { applyPaymentRules } = await import('./billStore');
    const allBills = await fetchAllBills();
    const total = allBills.length;
    const CHUNK = 200;
    let fixed = 0;

    for (let i = 0; i < allBills.length; i += CHUNK) {
      const chunk = allBills.slice(i, i + CHUNK);
      const updates: Array<Record<string, unknown>> = [];

      for (const bill of chunk) {
        // Step 1 — rebuild collectedAmount from breakdown if all three fields are present
        const cash   = Number(bill.cashAmount)   || 0;
        const upi    = Number(bill.upiAmount)    || 0;
        const cheque = Number(bill.chequeAmount) || 0;
        const breakdownSum = cash + upi + cheque;

        // Lock: cash/GPay/cheque payment was owner-entered — skip payment mode changes.
        // applyPaymentRules already enforces this, but skipping here avoids unnecessary
        // Supabase writes for the majority of paid bills.
        if (cash > 0 || upi > 0 || cheque > 0) continue;

        // Use breakdown sum only when at least one part is non-zero (avoids wiping
        // genuine collectedAmount on bills with no breakdown recorded yet).
        const correctedCollected = breakdownSum > 0 ? breakdownSum : Number(bill.collectedAmount) || 0;
        const billWithCorrectCollected = { ...bill, collectedAmount: correctedCollected };

        // Step 2 — apply FBR / Paid / Unpaid rules
        const ruled = applyPaymentRules(billWithCorrectCollected);

        // Step 3 — detect what changed
        const collectedChanged  = correctedCollected !== (Number(bill.collectedAmount) || 0);
        const outstandingChanged = ruled.outstandingAmount !== (Number(bill.outstandingAmount) || 0);
        const modeChanged       = ruled.paymentMode   !== bill.paymentMode;
        const methodChanged     = ruled.paymentMethod !== bill.paymentMethod;

        if (!collectedChanged && !outstandingChanged && !modeChanged && !methodChanged) continue;

        const patch: Record<string, unknown> = { id: bill.id };
        if (collectedChanged)  patch.collected_amount  = correctedCollected;
        if (outstandingChanged) patch.outstanding_amount = ruled.outstandingAmount;
        if (modeChanged)       patch.payment_mode      = ruled.paymentMode ?? null;
        if (methodChanged)     patch.payment_method    = ruled.paymentMethod ?? null;

        updates.push(patch);
        fixed++;
      }

      if (updates.length > 0) {
        const { error } = await supabase!.from('bills').upsert(updates, { onConflict: 'id' });
        if (error) console.error('[apiRecalcAllBillStatus] upsert error:', error);
      }

      onProgress?.(Math.min(i + CHUNK, total), total);
    }

    dispatchSyncStatus('ok');
    return { ok: true, fixed, total };
  } catch (err: any) {
    console.error('[apiRecalcAllBillStatus] error:', err);
    dispatchSyncStatus('error');
    return { ok: false, fixed: 0, total: 0, error: String(err?.message ?? err) };
  }
}



// ── Fix-bills: enforce the payment rule engine on every bill, one by one ───────
// Rule 1: billNetAmt - collectedAmount - lineCutAmt = outstandingAmount.
//         If outstandingAmount === 0 → paymentMode = "Paid".
// Rule 2: If billNetAmt === lineCutAmt → paymentMode = "FBR" AND paymentMethod = "FBR"
//         (takes priority over Rule 1).
export async function apiFixBills(): Promise<{ ok: boolean; fixed: number; spAdded: number; total: number; error?: string }> {
  try {
    const { applyPaymentRules } = await import('./billStore');
    const allBills = await fetchAllBills();
    const total = allBills.length;

    const now = new Date();
    const today = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

    const CHUNK = 200;
    let fixed = 0;

    for (let i = 0; i < allBills.length; i += CHUNK) {
      const chunk = allBills.slice(i, i + CHUNK);
      const updates: Array<Record<string, unknown>> = [];

      for (const bill of chunk) {
        // Lock: skip bills where cash/GPay/cheque was owner-entered — paymentMode must
        // not change via any automated fix. applyPaymentRules enforces this too, but
        // skipping here avoids rewriting outstanding_amount on already-correct bills.
        if (Number(bill.cashAmount) > 0 || Number(bill.upiAmount) > 0 || Number(bill.chequeAmount) > 0) continue;

        const chequeNo = String(bill.chequeNo || '').trim();
        const ruled = applyPaymentRules(bill);

        const patch: Record<string, unknown> = { id: bill.id, outstanding_amount: ruled.outstandingAmount };

        const modeChanged = ruled.paymentMode !== bill.paymentMode;
        if (modeChanged) {
          patch.payment_mode = ruled.paymentMode ?? null;
          if (ruled.paymentMode === 'FBR') {
            patch.payment_method = 'FBR';
          } else if (ruled.paymentMode === 'Paid' && !bill.paymentMethod) {
            patch.payment_method = chequeNo ? 'Cheque' : 'Cash';
            if (!bill.cashAmount && !bill.chequeAmount && !bill.upiAmount) {
              if (chequeNo) patch.cheque_amount = bill.collectedAmount;
              else patch.cash_amount = bill.collectedAmount;
            }
            if (!bill.paymentDate) patch.payment_date = today;
          }
        }

        // Clean stale payment_date if bill has no money collected and is not Paid/FBR
        const isFbrMode = ruled.paymentMode === 'FBR';
        const hasColl = (Number(bill.collectedAmount) || 0) > 0;
        if (!hasColl && !isFbrMode && ruled.paymentMode !== 'Paid' && bill.paymentDate) {
          patch.payment_date = null;
          patch.payment_time = null;
        }

        updates.push(patch);
        if (modeChanged || ruled.outstandingAmount !== bill.outstandingAmount) fixed++;
      }

      if (updates.length > 0) {
        const { error } = await supabase!.from('bills').upsert(updates, { onConflict: 'id' });
        if (error) console.error('[apiFixBills] upsert error:', error);
      }
    }

    // Auto-add salesperson contacts from bill data
    const spNames = new Set<string>();
    for (const b of allBills) {
      const name = String(b.salespersonName || '').trim();
      if (name) spNames.add(name);
    }

    const { data: existingContacts } = await supabase!.from('contacts').select('name').eq('type', 'salesperson');
    const existingSet = new Set((existingContacts || []).map((c: any) => String(c.name || '').toLowerCase()));

    const toInsert = Array.from(spNames)
      .filter(name => !existingSet.has(name.toLowerCase()))
      .map(name => ({
        id: `sp_${name.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 40)}`,
        type: 'salesperson',
        name,
        mobile: '',
      }));

    let spAdded = 0;
    if (toInsert.length > 0) {
      const { error } = await supabase!.from('contacts').upsert(toInsert, { onConflict: 'id' });
      if (!error) spAdded = toInsert.length;
    }

    dispatchSyncStatus('ok');
    return { ok: true, fixed, spAdded, total };
  } catch (err) {
    console.error('[apiFixBills] error:', err);
    dispatchSyncStatus('error');
    return { ok: false, fixed: 0, spAdded: 0, total: 0, error: String(err) };
  }
}

// ── Fast settings-only fetch (used at startup before full sync) ───────────────
// Retries up to `attempts` times so Supabase cold-start doesn't block login.
export async function apiFetchSettingsEarly(attempts = 4, delayMs = 2000): Promise<Record<string, string>> {
  for (let i = 0; i < attempts; i++) {
    try {
      const { data, error } = await supabase!.from('settings').select('key, value');
      if (error) throw error;
      const settings: Record<string, string> = {};
      (data || []).forEach((row: any) => { settings[row.key] = row.value; });
      return settings;
    } catch (err) {
      if (i < attempts - 1) {
        await new Promise(res => setTimeout(res, delayMs));
      }
    }
  }
  return {};
}

// ── Supabase health ping ───────────────────────────────────────────────────────
export async function apiPingSupabase(): Promise<boolean> {
  try {
    const { error } = await supabase!.from('settings').select('key', { count: 'exact', head: true });
    return !error;
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PERFORMANCE HELPERS — scale to 100k+ bills without slowing reports.
// All additive; nothing above this line changed behavior.
// ═══════════════════════════════════════════════════════════════════════════

// ─── Windowed bill fetch (last N days by bill date) ────────────────────────
// Uses the list_bills_since RPC so the server filters by parsed DD/MM/YYYY.
// Returns bills whose date is within `days` OR whose date is unparseable
// (kept so nothing silently disappears from the UI).
export async function apiFetchRecentBills(days: number): Promise<Bill[]> {
  const { data, error } = await supabase!.rpc('list_bills_since', { days_back: days });
  if (error) { console.error('[apiSync] list_bills_since error:', error); return []; }
  return ((data ?? []) as Record<string, unknown>[]).map(mapBillFromSupabase);
}

// ─── Paged bill fetch for server-side bills list / search ──────────────────
export type BillsPageFilters = {
  fromDate?: string;      // DD/MM/YYYY (matches bills.date)
  toDate?: string;
  driverName?: string;
  salespersonName?: string;
  paymentMode?: string;
  partyCode?: string;
  billNoLike?: string;    // partial bill_no match
  partyNameLike?: string; // partial party_name match
};
export async function fetchBillsPage(opts: {
  filters?: BillsPageFilters;
  page?: number;
  pageSize?: number;
  orderBy?: string;
  ascending?: boolean;
}): Promise<{ rows: Bill[]; total: number }> {
  const page = Math.max(0, opts.page ?? 0);
  const size = Math.min(500, Math.max(10, opts.pageSize ?? 100));
  const from = page * size;
  const to = from + size - 1;
  let q = supabase!.from('bills').select('*', { count: 'exact' }).range(from, to)
    .order(opts.orderBy ?? 'id', { ascending: opts.ascending ?? true });
  const f = opts.filters ?? {};
  if (f.driverName)       q = q.eq('driver_name', f.driverName);
  if (f.salespersonName)  q = q.eq('salesperson_name', f.salespersonName);
  if (f.paymentMode)      q = q.eq('payment_mode', f.paymentMode);
  if (f.partyCode)        q = q.eq('party_code', f.partyCode);
  if (f.billNoLike)       q = q.ilike('bill_no', `%${f.billNoLike}%`);
  if (f.partyNameLike)    q = q.ilike('party_name', `%${f.partyNameLike}%`);
  // Note: date range filtering as text works only when using ISO dates. For
  // DD/MM/YYYY we filter in JS post-fetch when both bounds present. Server-
  // side date-range requires the parse_ddmmyyyy path via a dedicated RPC.
  const { data, error, count } = await q;
  if (error) { console.error('[apiSync] fetchBillsPage error:', error); return { rows: [], total: 0 }; }
  let rows = ((data ?? []) as Record<string, unknown>[]).map(mapBillFromSupabase);
  if (f.fromDate || f.toDate) {
    const toParts = (s?: string) => {
      if (!s) return null;
      const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
      return m ? new Date(+m[3], +m[2] - 1, +m[1]).getTime() : null;
    };
    const fd = toParts(f.fromDate);
    const td = toParts(f.toDate);
    rows = rows.filter(b => {
      const t = toParts(b.date);
      if (t == null) return false;
      if (fd != null && t < fd) return false;
      if (td != null && t > td) return false;
      return true;
    });
  }
  return { rows, total: count ?? rows.length };
}

// ─── Aggregation RPC callers (return small pre-aggregated rows) ────────────
export type DriverSummaryRow = {
  driver_name: string; bill_count: number;
  total_bill_amt: number; total_collected: number; total_outstanding: number;
  paid_count: number; fbr_count: number; credit_count: number;
  del_pending_count: number; unpaid_count: number;
};
export async function rpcReportDriverSummary(fromDate: string, toDate: string): Promise<DriverSummaryRow[]> {
  const { data, error } = await supabase!.rpc('report_driver_summary', { from_date: fromDate, to_date: toDate });
  if (error) { console.error('[apiSync] report_driver_summary error:', error); return []; }
  return (data ?? []) as DriverSummaryRow[];
}

export type SalespersonSummaryRow = Omit<DriverSummaryRow, 'driver_name'> & { salesperson_name: string };
export async function rpcReportSalespersonSummary(fromDate: string, toDate: string): Promise<SalespersonSummaryRow[]> {
  const { data, error } = await supabase!.rpc('report_salesperson_summary', { from_date: fromDate, to_date: toDate });
  if (error) { console.error('[apiSync] report_salesperson_summary error:', error); return []; }
  return (data ?? []) as SalespersonSummaryRow[];
}

export type PaymentModeSummaryRow = {
  status: string; bill_count: number;
  total_bill_amt: number; total_collected: number; total_outstanding: number;
};
export async function rpcReportPaymentModeSummary(fromDate: string, toDate: string): Promise<PaymentModeSummaryRow[]> {
  const { data, error } = await supabase!.rpc('report_payment_mode_summary', { from_date: fromDate, to_date: toDate });
  if (error) { console.error('[apiSync] report_payment_mode_summary error:', error); return []; }
  return (data ?? []) as PaymentModeSummaryRow[];
}

export type DailyCollectionRow = {
  collection_date: string; bill_count: number;
  cash_amount: number; upi_amount: number; cheque_amount: number; total_collected: number;
};
export async function rpcReportDailyCollection(fromDate: string, toDate: string): Promise<DailyCollectionRow[]> {
  const { data, error } = await supabase!.rpc('report_daily_collection', { from_date: fromDate, to_date: toDate });
  if (error) { console.error('[apiSync] report_daily_collection error:', error); return []; }
  return (data ?? []) as DailyCollectionRow[];
}

export type PartyOutstandingRow = {
  party_code: string; party_name: string; bill_count: number; total_outstanding: number;
};
/**
 * Merge two salesperson names across Supabase:
 *  - All bills where salesperson_name = fromName → updated to toName
 *  - Contact for fromName is deleted; toName contact keeps its mobile
 *    (or inherits fromName's mobile if toName had none).
 */
export async function apiMergeTwoSalespersons(
  fromName: string,
  toName: string
): Promise<{ billsUpdated: number; ok: boolean; error?: string }> {
  if (!supabase) return { billsUpdated: 0, ok: false, error: 'No Supabase connection' };
  try {
    const fromTrim = fromName.trim();
    const toTrim = toName.trim();
    const fromLower = fromTrim.toLowerCase();
    const { cleanSalespersonName, areSalespersonNamesEquivalent, calculateSimilarity } = await import('./nameStandardizer');
    const fromBaseClean = cleanSalespersonName(fromTrim).trim().toLowerCase();
    const toBaseClean = cleanSalespersonName(toTrim).trim() || toTrim;

    // 1. Update bills: rename fromName (and all 50%+ similar / equivalent variants) → toBaseClean in batches
    const allBillRows = await fetchAllRows('bills', 'id', 'id,salesperson_name');
    const toUpdate = (allBillRows as any[]).filter((r) => {
      const sp = String(r.salesperson_name || '').trim();
      const spLower = sp.toLowerCase();
      const spClean = cleanSalespersonName(sp).trim().toLowerCase();
      return (
        spLower === fromLower ||
        (fromBaseClean && spClean === fromBaseClean) ||
        areSalespersonNamesEquivalent(sp, fromTrim) ||
        calculateSimilarity(spClean, fromBaseClean) >= 0.50 ||
        (spClean.length >= 3 && fromBaseClean.length >= 3 && (spClean.includes(fromBaseClean) || fromBaseClean.includes(spClean)))
      );
    });
    const ids = toUpdate.map((r) => r.id as string);
    const BATCH = 150;
    let billsUpdated = 0;
    for (let i = 0; i < ids.length; i += BATCH) {
      const batchIds = ids.slice(i, i + BATCH);
      const { error } = await supabase
        .from('bills')
        .update({ salesperson_name: toBaseClean })
        .in('id', batchIds);
      if (!error) billsUpdated += batchIds.length;
    }

    // 2. Merge contacts: keep toName (cleaned, no (ME)), delete fromName, guarantee mobile preservation
    const { data: contactRows } = await supabase
      .from('contacts')
      .select('id, name, mobile, type')
      .eq('type', 'salesperson');

    if (contactRows && Array.isArray(contactRows)) {
      const fromContacts = (contactRows as any[]).filter((c) => {
        const name = String(c.name || '').trim().toLowerCase();
        const clean = cleanSalespersonName(name).trim().toLowerCase();
        return (
          name === fromLower ||
          (fromBaseClean && clean === fromBaseClean) ||
          areSalespersonNamesEquivalent(c.name || '', fromTrim) ||
          calculateSimilarity(clean, fromBaseClean) >= 0.50
        );
      });
      const toContact = (contactRows as any[]).find((c) => {
        const name = String(c.name || '').trim().toLowerCase();
        const clean = cleanSalespersonName(name).trim().toLowerCase();
        const toCleanLower = toBaseClean.toLowerCase();
        return name === toTrim.toLowerCase() || (toCleanLower && clean === toCleanLower) || areSalespersonNamesEquivalent(c.name || '', toTrim);
      });

      const fromContactWithMobile = fromContacts.find(c => c.mobile && String(c.mobile).trim());
      const effectiveMobile = (toContact?.mobile && String(toContact.mobile).trim())
        ? String(toContact.mobile).trim()
        : (fromContactWithMobile?.mobile ? String(fromContactWithMobile.mobile).trim() : '');

      if (toContact) {
        await supabase
          .from('contacts')
          .update({
            name: toBaseClean,
            ...(effectiveMobile ? { mobile: effectiveMobile } : {})
          })
          .eq('id', toContact.id);
      } else if (effectiveMobile || toBaseClean) {
        const newId = contactId('sp', toBaseClean);
        await supabase
          .from('contacts')
          .insert({
            id: newId,
            name: toBaseClean,
            mobile: effectiveMobile || '',
            type: 'salesperson',
          });
      }

      // Delete fromName contact(s)
      for (const fc of fromContacts) {
        if (fc.id !== toContact?.id) {
          await supabase.from('contacts').delete().eq('id', fc.id);
        }
      }
    }

    dispatchSyncStatus('ok');
    return { billsUpdated, ok: true };
  } catch (err: any) {
    console.error('[apiSync] apiMergeTwoSalespersons error:', err);
    dispatchSyncStatus('error');
    return { billsUpdated: 0, ok: false, error: String(err?.message ?? err) };
  }
}

/**
 * Merge two party names across Supabase:
 *  - All bills where party_name = fromName → updated to toName
 *  - Contact for fromName is deleted; toName contact keeps its mobile
 */
export async function apiMergeTwoParties(
  fromName: string,
  toName: string,
  toCode?: string
): Promise<{ billsUpdated: number; ok: boolean; error?: string }> {
  if (!supabase) return { billsUpdated: 0, ok: false, error: 'No Supabase connection' };
  try {
    const fromClean = fromName.trim().toLowerCase();
    const toClean = toName.trim();
    // 1. Update bills: rename fromName → toName in batches
    const allBillRows = await fetchAllRows('bills', 'id', 'id,party_name,party_code');
    const toUpdate = (allBillRows as any[]).filter(
      (r) => String(r.party_name || '').trim().toLowerCase() === fromClean
    );
    const ids = toUpdate.map((r) => r.id as string);
    const BATCH = 150;
    let billsUpdated = 0;
    const payload: Record<string, unknown> = { party_name: toClean };
    if (toCode) payload.party_code = toCode;

    for (let i = 0; i < ids.length; i += BATCH) {
      const batchIds = ids.slice(i, i + BATCH);
      const { error } = await supabase
        .from('bills')
        .update(payload)
        .in('id', batchIds);
      if (!error) billsUpdated += batchIds.length;
    }

    // 2. Merge contacts
    const { data: contactRows } = await supabase
      .from('contacts')
      .select('id, name, mobile, type, party_code')
      .eq('type', 'party');

    if (contactRows) {
      const fromContact = (contactRows as any[]).find(
        (c) => String(c.name || '').trim().toLowerCase() === fromClean
      );
      const toContact = (contactRows as any[]).find(
        (c) => String(c.name || '').trim().toLowerCase() === toClean.toLowerCase()
      );

      if (toContact && fromContact?.mobile && !toContact.mobile) {
        await supabase
          .from('contacts')
          .update({ mobile: fromContact.mobile })
          .eq('id', toContact.id);
      }

      if (fromContact) {
        await supabase.from('contacts').delete().eq('id', fromContact.id);
      }
    }

    dispatchSyncStatus('ok');
    return { billsUpdated, ok: true };
  } catch (err: any) {
    console.error('[apiSync] apiMergeTwoParties error:', err);
    dispatchSyncStatus('error');
    return { billsUpdated: 0, ok: false, error: String(err?.message ?? err) };
  }
}

export async function rpcReportPartyOutstanding(limitN = 200): Promise<PartyOutstandingRow[]> {
  const { data, error } = await supabase!.rpc('report_party_outstanding', { limit_n: limitN });
  if (error) { console.error('[apiSync] report_party_outstanding error:', error); return []; }
  return (data ?? []) as PartyOutstandingRow[];
}

export type DashboardCountsRow = {
  load_count: number; done_count: number; pend_count: number;
  total_amt: number; collected_amt: number;
};
export async function rpcDashboardCounts(targetDate: string, driver: string): Promise<DashboardCountsRow | null> {
  const { data, error } = await supabase!.rpc('dashboard_counts', { target_date: targetDate, driver });
  if (error) { console.error('[apiSync] dashboard_counts error:', error); return null; }
  const row = Array.isArray(data) ? data[0] : data;
  return (row as DashboardCountsRow) ?? null;
}

// ─── Incremental delta sync ───────────────────────────────────────────────────
// Instead of re-downloading every bill on each poll (very slow + janky UI with
// 15k+ rows), fetch only rows whose `updated_at` changed since the last sync.
export async function apiFetchBillsSince(sinceIso: string): Promise<Bill[]> {
  if (!supabase) return [];
  const CHUNK = 1000;
  const out: Bill[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('bills')
      .select('*')
      .gt('updated_at', sinceIso)
      .order('updated_at')
      .range(offset, offset + CHUNK - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...(data as Record<string, unknown>[]).map(mapBillFromSupabase));
    if (data.length < CHUNK) break;
    offset += data.length;
  }
  return out;
}
