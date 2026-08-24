// One-off script: import the uploaded XLSX backup into Supabase and enforce
// the payment rule engine (Paid/FBR) across every bill.
//
// Run with: npx tsx scripts/import-payment-backup.ts <path-to-xlsx>
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import ws from 'ws';
import { applyPaymentRules, cleanSalespersonName, type Bill } from '../src/lib/billStore';

(globalThis as any).WebSocket = (globalThis as any).WebSocket || ws;

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: npx tsx scripts/import-payment-backup.ts <path-to-xlsx>');
  process.exit(1);
}

function num(v: unknown): number {
  if (v === '' || v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

function normDate(v: unknown): string {
  if (v === '' || v == null) return '';
  if (typeof v === 'number' && v > 1000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${d.getUTCFullYear()}`;
  }
  const s = String(v).trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; }
  if (/^\d{2}-\d{2}-\d{4}$/.test(s)) return s.replace(/-/g, '/');
  return s;
}

// Force a brand-new HTTP connection per request (no keep-alive reuse). The
// Supabase pooler/PostgREST layer has been observed to serve stale results
// over reused keep-alive connections (a cached query plan or stale replica
// pinned to that connection) — fresh connections consistently return the
// true current state. This matters a lot for reconciliation passes that
// read the whole table repeatedly in one script run.
async function freshFetch(url: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Connection', 'close');
  return fetch(url, { ...init, headers });
}

async function main() {
  const { createClient } = await import('@supabase/supabase-js');
  const SUPABASE_URL = 'https://sgtjihrzpngktwnpihmx.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNndGppaHJ6cG5na3R3bnBpaG14Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzNTczMzMsImV4cCI6MjA5NDkzMzMzM30.ZOE8BJbLMuS72k2OzOKlV-sD34Fy8punld3pJzV9dv8';
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { fetch: freshFetch as typeof fetch },
  });
  console.log(`Reading ${filePath} ...`);
  const fileBuf = fs.readFileSync(filePath);
  const wb = XLSX.read(fileBuf, { type: 'buffer' });
  if (!wb.SheetNames.includes('Bills')) {
    console.error('No "Bills" sheet found in workbook. Sheets:', wb.SheetNames);
    process.exit(1);
  }

  const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets['Bills'], { defval: '' });
  console.log(`Found ${rows.length} bill rows in XLSX.`);

  const bills: Bill[] = rows
    .filter(r => r.billNo)
    .map(r => {
      const raw: Bill = {
        id: str(r.id) || `imp_${Math.random().toString(36).slice(2, 11)}`,
        srNo: str(r.srNo),
        date: normDate(r.date),
        salespersonName: cleanSalespersonName(str(r.salespersonName)),
        collectionCode: str(r.collectionCode),
        billNo: str(r.billNo),
        partyCode: str(r.partyCode),
        partyHulCode: str(r.partyHulCode),
        partyName: str(r.partyName),
        beatName: str(r.beatName),
        billNetAmt: num(r.billNetAmt),
        collectedAmount: num(r.collectedAmount),
        outstandingAmount: num(r.outstandingAmount),
        billAgeing: num(r.billAgeing),
        deliveryDate: normDate(r.deliveryDate) || undefined,
        paymentMode: str(r.paymentMode) || undefined,
        paymentMethod: str(r.paymentMethod) || undefined,
        paymentDate: normDate(r.paymentDate) || undefined,
        paymentTime: str(r.paymentTime) || undefined,
        driverName: str(r.driverName) || undefined,
        chequeNo: str(r.chequeNo) || undefined,
        chequeDate: str(r.chequeDate) || undefined,
        bankName: str(r.bankName) || undefined,
        nextBillNo: str(r.nextBillNo) || undefined,
        cancelLine: str(r.cancelLine) || undefined,
        lineCutAmt: num(r.lineCutAmt) || undefined,
        discrepancyReason: str(r.discrepancyReason) || undefined,
        cashAmount: num(r.cashAmount) || undefined,
        upiAmount: num(r.upiAmount) || undefined,
        chequeAmount: num(r.chequeAmount) || undefined,
      };
      return applyPaymentRules(raw);
    });

  console.log(`Prepared ${bills.length} bills after applying payment rules. Upserting into Supabase...`);

  const toRow = (b: Bill) => ({
    id: b.id,
    sr_no: b.srNo,
    date: b.date,
    salesperson_name: b.salespersonName,
    collection_code: b.collectionCode,
    bill_no: b.billNo,
    party_code: b.partyCode,
    party_hul_code: b.partyHulCode,
    party_name: b.partyName,
    beat_name: b.beatName,
    bill_net_amt: b.billNetAmt,
    collected_amount: b.collectedAmount,
    outstanding_amount: b.outstandingAmount,
    bill_ageing: b.billAgeing,
    payment_mode: b.paymentMode ?? null,
    payment_method: b.paymentMethod ?? null,
    payment_date: b.paymentDate ?? null,
    payment_time: b.paymentTime ?? null,
    driver_name: b.driverName ?? null,
    delivery_date: b.deliveryDate ?? null,
    cheque_no: b.chequeNo ?? null,
    cheque_date: b.chequeDate ?? null,
    bank_name: b.bankName ?? null,
    next_bill_no: b.nextBillNo ?? null,
    cancel_line: b.cancelLine ?? null,
    line_cut_amt: b.lineCutAmt ?? 0,
    discrepancy_reason: b.discrepancyReason ?? null,
    cash_amount: b.cashAmount ?? null,
    upi_amount: b.upiAmount ?? null,
    cheque_amount: b.chequeAmount ?? null,
  });

  const CHUNK = 500;
  let saved = 0;
  for (let i = 0; i < bills.length; i += CHUNK) {
    const slice = bills.slice(i, i + CHUNK).map(toRow);
    const { error } = await supabase!.from('bills').upsert(slice, { onConflict: 'id' });
    if (error) {
      console.error(`Upsert error at chunk ${i}:`, error);
      process.exit(1);
    }
    saved += slice.length;
    console.log(`  Upserted ${saved} / ${bills.length}`);
  }

  console.log('Import complete. Waiting for replication to settle before reconciling...');
  await new Promise(r => setTimeout(r, 8000));
  console.log('Now reconciling ALL bills in Supabase against the payment rule engine...');

  const PAGE = 1000;
  const { count } = await supabase!.from('bills').select('*', { count: 'exact', head: true });
  const total = count ?? 0;
  console.log(`Total bills currently in Supabase: ${total}`);

  const pages = Math.ceil(total / PAGE);
  let fixedCount = 0;
  let checked = 0;
  for (let p = 0; p < pages; p++) {
    const { data, error } = await supabase!.from('bills').select('*').order('id').range(p * PAGE, (p + 1) * PAGE - 1);
    if (error) { console.error('Fetch error:', error); process.exit(1); }
    const updates: Array<Record<string, unknown>> = [];
    for (const row of data || []) {
      checked++;
      const bill: Bill = {
        id: str(row.id),
        srNo: str(row.sr_no),
        date: str(row.date),
        salespersonName: str(row.salesperson_name),
        collectionCode: str(row.collection_code),
        billNo: str(row.bill_no),
        partyCode: str(row.party_code),
        partyHulCode: str(row.party_hul_code),
        partyName: str(row.party_name),
        beatName: str(row.beat_name),
        billNetAmt: num(row.bill_net_amt),
        collectedAmount: num(row.collected_amount),
        outstandingAmount: num(row.outstanding_amount),
        billAgeing: num(row.bill_ageing),
        paymentMode: row.payment_mode ?? undefined,
        paymentMethod: row.payment_method ?? undefined,
        lineCutAmt: num(row.line_cut_amt) || undefined,
        cancelLine: str(row.cancel_line) || undefined,
      };
      const ruled = applyPaymentRules(bill);
      if (ruled.paymentMode !== bill.paymentMode || ruled.outstandingAmount !== bill.outstandingAmount) {
        const patch: Record<string, unknown> = { id: bill.id, outstanding_amount: ruled.outstandingAmount };
        if (ruled.paymentMode !== bill.paymentMode) {
          patch.payment_mode = ruled.paymentMode ?? null;
          patch.payment_method = ruled.paymentMode === 'FBR' ? 'FBR' : (ruled.paymentMethod ?? null);
        }
        updates.push(patch);
        fixedCount++;
      }
    }
    if (updates.length > 0) {
      // Use per-row .update().eq('id', ...) instead of bulk upsert. Bulk
      // upsert (INSERT ... ON CONFLICT) was observed to report success
      // (sent === returned, no error) while silently NOT persisting the
      // change for a subset of rows — plain UPDATE is confirmed reliable.
      let okCount = 0;
      for (const patch of updates) {
        const { id, ...rest } = patch;
        const { error: updErr } = await supabase!.from('bills').update(rest).eq('id', id as string);
        if (updErr) console.error(`Fix-pass update error for id=${id}:`, updErr);
        else okCount++;
      }
      console.log(`    fix-pass update: sent ${updates.length}, ok ${okCount}`);
    }
    console.log(`  Checked ${checked} / ${total} (fixed so far: ${fixedCount})`);
  }

  console.log(`\nDone. Bills imported/updated: ${bills.length}. Additional bills fixed in reconciliation pass: ${fixedCount}. Total bills checked: ${checked}.`);
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
