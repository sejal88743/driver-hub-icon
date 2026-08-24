import XLSX from '../node_modules/xlsx/xlsx.js';

const SUPABASE_URL = 'https://sgtjihrzpngktwnpihmx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNndGppaHJ6cG5na3R3bnBpaG14Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzNTczMzMsImV4cCI6MjA5NDkzMzMzM30.ZOE8BJbLMuS72k2OzOKlV-sD34Fy8punld3pJzV9dv8';

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=minimal',
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
  // ── 1. Read Excel — collect CREDIT bill nos ──────────────────────────────────
  const wb = XLSX.readFile('./attached_assets/VitraTrack_08-07-2026_1783779058994.xlsx');
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

  const creditBillNos = [
    ...new Set(
      rows
        .filter(r => String(r['Status']).trim().toUpperCase() === 'CREDIT')
        .map(r => String(r['Bill No']).trim())
        .filter(Boolean)
    ),
  ];
  console.log(`Excel CREDIT bills (unique): ${creditBillNos.length}`);

  // ── 2. Fetch matching bills from Supabase in batches ─────────────────────────
  const BATCH = 150;
  let allFound = [];
  for (let i = 0; i < creditBillNos.length; i += BATCH) {
    const chunk = creditBillNos.slice(i, i + BATCH);
    // PostgREST in() filter
    const filter = `in.(${chunk.map(n => `"${n}"`).join(',')})`;
    const data = await sbFetch(
      `/bills?select=id,bill_no,payment_mode&bill_no=${encodeURIComponent(filter)}`,
      { method: 'GET', headers: { Prefer: 'return=representation' } }
    );
    allFound.push(...data);
  }
  console.log(`Found in Supabase: ${allFound.length}`);

  const alreadyCredit = allFound.filter(b => b.payment_mode === 'Credit');
  const toUpdate      = allFound.filter(b => b.payment_mode !== 'Credit');
  console.log(`Already 'Credit': ${alreadyCredit.length}`);
  console.log(`Need update:      ${toUpdate.length}`);

  if (toUpdate.length === 0) {
    console.log('Nothing to update — all matching bills already Credit.');
    return;
  }

  // Show modes that will be overwritten
  const modeBefore = {};
  toUpdate.forEach(b => {
    const m = b.payment_mode ?? 'null';
    modeBefore[m] = (modeBefore[m] || 0) + 1;
  });
  console.log('Current modes being overwritten:', modeBefore);

  // ── 3. Update payment_mode = 'Credit' in batches ────────────────────────────
  let updated = 0, failed = 0;
  for (let i = 0; i < toUpdate.length; i += BATCH) {
    const chunk = toUpdate.slice(i, i + BATCH).map(b => b.bill_no);
    const filter = `in.(${chunk.map(n => `"${n}"`).join(',')})`;
    try {
      await sbFetch(
        `/bills?bill_no=${encodeURIComponent(filter)}`,
        { method: 'PATCH', body: JSON.stringify({ payment_mode: 'Credit' }) }
      );
      updated += chunk.length;
      console.log(`  Updated ${updated}/${toUpdate.length}...`);
    } catch (err) {
      console.error(`  Batch ${i}–${i + BATCH} failed:`, err.message);
      failed += chunk.length;
    }
  }

  console.log(`\n✅ Done — updated: ${updated}, failed: ${failed}, already correct: ${alreadyCredit.length}`);

  // Report bill nos from Excel not found in Supabase
  const foundNos = new Set(allFound.map(b => b.bill_no));
  const missing  = creditBillNos.filter(n => !foundNos.has(n));
  if (missing.length)
    console.log(`⚠️  ${missing.length} CREDIT bill(s) from Excel not found in Supabase:`, missing.slice(0, 20));
}

main().catch(err => { console.error(err); process.exit(1); });
