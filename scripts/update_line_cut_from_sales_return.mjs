// Applies "LINE CUT Amt" values from a LeverEDGE Sales Return Register export
// onto the matching bills in Supabase.
//
// For every Bill No present in the sheet:
//   - sums all "LINE CUT Amt" rows for that bill (a bill can have several
//     return-line rows) and writes the total to bills.line_cut_amt
//   - sets bills.cancel_line = '1'
//
// Usage: node scripts/update_line_cut_from_sales_return.mjs <path-to-xlsx>
import XLSX from '../node_modules/xlsx/xlsx.js';

const SUPABASE_URL = 'https://sgtjihrzpngktwnpihmx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNndGppaHJ6cG5na3R3bnBpaG14Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzNTczMzMsImV4cCI6MjA5NDkzMzMzM30.ZOE8BJbLMuS72k2OzOKlV-sD34Fy8punld3pJzV9dv8';

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

async function sbFetch(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...opts,
    headers: { ...headers, ...(opts.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  return text ? JSON.parse(text) : [];
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/update_line_cut_from_sales_return.mjs <path-to-xlsx>');
    process.exit(1);
  }

  // ── 1. Read the "Sales Return Register" sheet: Sr No | Bill No | LINE CUT Amt
  const wb = XLSX.readFile(file);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  const totalsByBillNo = {};
  for (let i = 1; i < data.length; i++) {
    const [, billNo, amt] = data[i];
    if (!billNo) continue; // skips the trailing grand-total row (blank Bill No)
    const key = String(billNo).trim();
    totalsByBillNo[key] = (totalsByBillNo[key] || 0) + Number(amt || 0);
  }
  const billNos = Object.keys(totalsByBillNo);
  console.log(`Sheet: unique bills = ${billNos.length}`);

  // ── 2. Fetch matching bills from Supabase in batches ─────────────────────────
  const BATCH = 150;
  let rows = [];
  for (let i = 0; i < billNos.length; i += BATCH) {
    const chunk = billNos.slice(i, i + BATCH);
    const filter = `bill_no=in.(${chunk.map(b => `"${b}"`).join(',')})`;
    const found = await sbFetch(`/bills?select=id,bill_no&${filter}`);
    rows = rows.concat(found);
  }
  console.log(`Supabase: matched rows = ${rows.length}`);
  const foundSet = new Set(rows.map(r => r.bill_no));
  const notFound = billNos.filter(b => !foundSet.has(b));
  if (notFound.length) console.warn(`Not found in Supabase (${notFound.length}):`, notFound.slice(0, 20));

  // ── 3. Patch line_cut_amt + cancel_line='1' for each matched bill ────────────
  const CONCURRENCY = 15;
  let idx = 0, success = 0, failed = 0;
  async function worker() {
    while (idx < rows.length) {
      const row = rows[idx++];
      const amt = totalsByBillNo[row.bill_no];
      try {
        await sbFetch(`/bills?id=eq.${row.id}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ line_cut_amt: amt, cancel_line: '1' }),
        });
        success++;
      } catch (e) {
        failed++;
        console.error('FAILED', row.bill_no, e.message);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`Done. Updated: ${success}, Failed: ${failed}`);
}

main();
