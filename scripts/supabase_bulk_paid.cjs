/**
 * Bulk-mark bills as PAID in Supabase using Excel export data.
 * Run: node scripts/supabase_bulk_paid.cjs
 */

const XLSX = require('../node_modules/xlsx');
const fs   = require('fs');

const SUPABASE_URL = 'https://sgtjihrzpngktwnpihmx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNndGppaHJ6cG5na3R3bnBpaG14Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzNTczMzMsImV4cCI6MjA5NDkzMzMzM30.ZOE8BJbLMuS72k2OzOKlV-sD34Fy8punld3pJzV9dv8';

// DD/MM/YYYY → YYYY-MM-DD  (handles empty/blank gracefully)
function parseDate(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`;
}

// Cheque no: strip trailing ".0" that Excel adds to numeric values
function cleanCheqNo(val) {
  if (!val && val !== 0) return null;
  const s = String(val).trim();
  if (!s) return null;
  return s.replace(/\.0$/, '');
}

// Determine paymentMode from CASH / GPAY / CHQ columns
function deriveMode(cash, gpay, chq) {
  const hasCash  = Number(cash)  > 0;
  const hasGpay  = Number(gpay)  > 0;
  const hasChq   = Number(chq)   > 0;
  const count    = [hasCash, hasGpay, hasChq].filter(Boolean).length;
  if (count === 0) return null;          // zero-amount bill — skip mode
  if (count === 1) {
    if (hasCash) return 'Cash';
    if (hasGpay) return 'GPay';
    if (hasChq)  return 'Cheque';
  }
  // Mixed — pick dominant
  const max = Math.max(Number(cash), Number(gpay), Number(chq));
  if (max === Number(chq))  return 'Cheque';
  if (max === Number(gpay)) return 'GPay';
  return 'Cash';
}

async function updateBill(billNo, patch) {
  const url = `${SUPABASE_URL}/rest/v1/bills?bill_no=eq.${encodeURIComponent(billNo)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=minimal',
    },
    body: JSON.stringify(patch),
  });
  return res;
}

async function main() {
  const buf  = fs.readFileSync('./attached_assets/VitraTrack_23-07-2026_FINAL_BillWise_Collection_1784802329812.xlsx');
  const wb   = XLSX.read(buf, { type: 'buffer', cellDates: false });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

  // Filter valid rows only (must have a bill_no)
  const valid = rows.filter(r => r['BILL NO'] && String(r['BILL NO']).trim());
  console.log(`Total valid rows: ${valid.length}`);

  let ok = 0, failed = 0, skipped = 0;
  const errors = [];

  for (const r of valid) {
    const billNo = String(r['BILL NO']).trim();
    const cash   = Number(r['CASH'])  || 0;
    const gpay   = Number(r['GPAY'])  || 0;
    const chq    = Number(r['CHQ'])   || 0;
    const lcAmt  = Number(r['LINE CUT AMT']) || 0;
    const collAmt= Number(r['COLLECTED AMT'])|| 0;
    const status = String(r['STATUS'] || '').trim();

    // Only process PAID rows (skip completely blank status rows)
    if (status !== 'PAID') {
      console.log(`  SKIP ${billNo} — status="${status}"`);
      skipped++;
      continue;
    }

    const mode       = deriveMode(cash, gpay, chq);
    const payDate    = parseDate(r['COLLECTION DATE']) || parseDate(r['REC DATE']);
    const delDate    = parseDate(r['DEL DATE']);
    const cheqDate   = parseDate(r['CHEQ DATE']);
    const cheqNo     = cleanCheqNo(r['CHEQ NO']);
    const bankName   = String(r['BANK NAME'] || '').trim() || null;

    // Build Supabase patch (snake_case)
    const patch = {
      payment_date:       payDate,
      delivery_date:      delDate || undefined,
      collected_amount:   collAmt,
      outstanding_amount: 0,
      line_cut_amt:       lcAmt || 0,
    };

    if (mode)     patch.payment_mode   = mode;
    if (cash > 0) patch.cash_amount    = cash;
    if (gpay > 0) patch.upi_amount     = gpay;
    if (chq  > 0) patch.cheque_amount  = chq;
    if (cheqNo)   patch.cheque_no      = cheqNo;
    if (bankName) patch.bank_name      = bankName;
    if (cheqDate) patch.cheque_date    = cheqDate;

    // For zero-amount PAID bills (FBR/Credit type), still update date + outstanding
    // payment_mode left null if not derivable

    const res = await updateBill(billNo, patch);
    if (res.ok || res.status === 204) {
      console.log(`  ✅ ${billNo} — mode=${mode||'(none)'} collAmt=${collAmt} payDate=${payDate}`);
      ok++;
    } else {
      const body = await res.text();
      console.log(`  ❌ ${billNo} — HTTP ${res.status}: ${body}`);
      errors.push({ billNo, status: res.status, body });
      failed++;
    }

    // Small delay to avoid rate-limiting
    await new Promise(r => setTimeout(r, 30));
  }

  console.log(`\n=== DONE: ${ok} updated, ${failed} failed, ${skipped} skipped ===`);
  if (errors.length) {
    console.log('Errors:', JSON.stringify(errors, null, 2));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
