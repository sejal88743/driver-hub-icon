/**
 * Bulk-mark 3953 bills as FBR in Supabase.
 * payment_mode = 'FBR', line_cut_amt = bill_net_amt (Net Amt from XLS),
 * collected_amount = 0, outstanding_amount = 0
 * Run: node scripts/supabase_bulk_fbr.cjs
 */

const XLSX = require('../node_modules/xlsx');
const fs   = require('fs');

const SUPABASE_URL = 'https://sgtjihrzpngktwnpihmx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNndGppaHJ6cG5na3R3bnBpaG14Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzNTczMzMsImV4cCI6MjA5NDkzMzMzM30.ZOE8BJbLMuS72k2OzOKlV-sD34Fy8punld3pJzV9dv8';

const CONCURRENCY = 10;     // parallel requests at a time
const PAY_DATE    = '2026-07-21';  // loading sheet date

// DD/MM/YYYY → YYYY-MM-DD
function parseDate(val) {
  if (!val) return PAY_DATE;
  const m = String(val).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return PAY_DATE;
  return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
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

// Run `limit` tasks at a time from an array of async fns
async function pooled(tasks, limit) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < tasks.length) {
      const idx = i++;
      results[idx] = await tasks[idx]();
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

async function main() {
  const buf  = fs.readFileSync('./attached_assets/Loading_Sheets_21Jul2026_Converted_1784803050561.xlsx');
  const wb   = XLSX.read(buf, { type: 'buffer' });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

  // Filter valid rows
  const valid = rows.filter(r => r['Bill No'] && String(r['Bill No']).trim());
  console.log(`Total valid rows: ${valid.length}`);

  // ── Step 1: Fetch matching bills from Supabase for cross-check ─────────────
  // We need bill_no + party_name + bill_net_amt from Supabase.
  // Pull all bills in pages (500 at a time).
  console.log('Fetching existing bills from Supabase for verification...');
  const allBills = {};
  let page = 0;
  const PAGE = 500;
  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/bills?select=bill_no,party_name,bill_net_amt&limit=${PAGE}&offset=${page * PAGE}`;
    const res  = await fetch(url, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    data.forEach(b => { allBills[b.bill_no] = b; });
    if (data.length < PAGE) break;
    page++;
  }
  console.log(`Supabase bills loaded: ${Object.keys(allBills).length}`);

  // ── Step 2: Cross-check ────────────────────────────────────────────────────
  let notFound = 0, amtMismatch = 0, matched = 0;
  const toUpdate = [];
  const mismatches = [];

  for (const r of valid) {
    const billNo  = String(r['Bill No']).trim();
    const xlsAmt  = Number(r['Net Amt']) || 0;
    const xlsParty= String(r['Party'] || '').trim();
    const billDate= parseDate(r['Bill Date']);

    const sb = allBills[billNo];
    if (!sb) {
      notFound++;
      mismatches.push({ billNo, reason: 'NOT FOUND in Supabase', xlsParty, xlsAmt });
      // Still queue for update — bill might exist under slightly different key
      toUpdate.push({ billNo, xlsAmt, billDate });
      continue;
    }

    const sbAmt = Number(sb.bill_net_amt) || 0;
    if (sbAmt !== xlsAmt) {
      amtMismatch++;
      mismatches.push({ billNo, reason: 'AMT MISMATCH', xlsAmt, supabaseAmt: sbAmt, xlsParty, supabaseParty: sb.party_name });
    }

    matched++;
    toUpdate.push({ billNo, xlsAmt, billDate });
  }

  console.log(`\nVerification:`);
  console.log(`  Matched:       ${matched}`);
  console.log(`  Not in DB:     ${notFound}`);
  console.log(`  Amt mismatch:  ${amtMismatch}`);
  if (mismatches.length > 0) {
    const mFile = './scripts/fbr_mismatches.json';
    fs.writeFileSync(mFile, JSON.stringify(mismatches, null, 2));
    console.log(`  Mismatch details saved → ${mFile}`);
  }

  // ── Step 3: Bulk update with FBR ──────────────────────────────────────────
  console.log(`\nUpdating ${toUpdate.length} bills as FBR...`);
  let ok = 0, failed = 0;
  const errors = [];

  const tasks = toUpdate.map(({ billNo, xlsAmt, billDate }) => async () => {
    const patch = {
      payment_mode:       'FBR',
      payment_date:       billDate,
      collected_amount:   0,
      outstanding_amount: 0,
      line_cut_amt:       xlsAmt,
      cash_amount:        null,
      upi_amount:         null,
      cheque_amount:      null,
    };
    const res = await updateBill(billNo, patch);
    if (res.ok || res.status === 204) {
      ok++;
      if (ok % 100 === 0) console.log(`  ... ${ok} done`);
    } else {
      const body = await res.text();
      failed++;
      errors.push({ billNo, status: res.status, body });
    }
  });

  await pooled(tasks, CONCURRENCY);

  console.log(`\n=== DONE: ${ok} updated as FBR, ${failed} failed ===`);
  if (errors.length) {
    const eFile = './scripts/fbr_errors.json';
    fs.writeFileSync(eFile, JSON.stringify(errors, null, 2));
    console.log(`Errors saved → ${eFile}`);
    console.log('First 5 errors:', JSON.stringify(errors.slice(0,5), null, 2));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
