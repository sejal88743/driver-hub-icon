// Reads VitraTrack_Other backup, finds bills with paymentMode = 'Paid',
// and patches payment_mode = 'Paid' in Supabase.
// payment_method (Cash/UPI/Cheque) and all amounts are left untouched.

import XLSX from '../node_modules/xlsx/xlsx.js';

const SUPABASE_URL = 'https://sgtjihrzpngktwnpihmx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNndGppaHJ6cG5na3R3bnBpaG14Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzNTczMzMsImV4cCI6MjA5NDkzMzMzM30.ZOE8BJbLMuS72k2OzOKlV-sD34Fy8punld3pJzV9dv8';

const hdr = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=minimal',
};

async function sbPatch(billNo, patch) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/bills?bill_no=eq.${encodeURIComponent(billNo)}`,
    { method: 'PATCH', headers: hdr, body: JSON.stringify(patch) }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
}

async function main() {
  // ── 1. Read Excel, pick paymentMode = 'Paid' rows ──────────────────────────
  const wb = XLSX.readFile('./attached_assets/VitraTrack_Other_12072026_0947_1783831164468.xlsx');
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Bills'], { defval: '' });
  console.log(`Total rows in Bills sheet: ${rows.length}`);

  const paidRows = rows.filter(r => String(r.paymentMode || '').trim() === 'Paid');
  const billNos  = [...new Set(paidRows.map(r => String(r.billNo || '').trim()).filter(Boolean))];
  console.log(`Paid bills in Excel : ${paidRows.length}  (unique bill_nos: ${billNos.length})`);

  // Sample
  console.log('\nSample (first 5):');
  paidRows.slice(0, 5).forEach(r =>
    console.log(`  ${r.billNo} | paymentMethod=${r.paymentMethod} | collected=${r.collectedAmount}`)
  );

  if (billNos.length === 0) { console.log('Nothing to update.'); return; }

  // ── 2. Check current status in Supabase (batch fetch) ──────────────────────
  const BATCH = 150;
  let supaRows = [];
  for (let i = 0; i < billNos.length; i += BATCH) {
    const chunk = billNos.slice(i, i + BATCH);
    const filter = `in.(${chunk.map(n => `"${n}"`).join(',')})`;
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/bills?select=bill_no,payment_mode,payment_method&bill_no=${encodeURIComponent(filter)}`,
      { headers: { ...hdr, Prefer: 'return=representation' } }
    );
    supaRows.push(...(await res.json()));
    process.stdout.write(`  Fetched ${Math.min(i + BATCH, billNos.length)}/${billNos.length}\r`);
  }
  console.log(`\nFetched from Supabase: ${supaRows.length}`);

  // Group by current payment_mode
  const byMode = {};
  supaRows.forEach(b => { byMode[b.payment_mode] = (byMode[b.payment_mode] || 0) + 1; });
  console.log('Current payment_mode in Supabase:', byMode);

  // Already Paid → skip; rest → update
  const toUpdate = supaRows.filter(b => b.payment_mode !== 'Paid');
  const alreadyPaid = supaRows.filter(b => b.payment_mode === 'Paid');
  console.log(`\nAlready Paid (skip) : ${alreadyPaid.length}`);
  console.log(`To update → Paid    : ${toUpdate.length}`);

  if (toUpdate.length === 0) { console.log('\nAll already Paid. Nothing to do.'); return; }

  // ── 3. Patch payment_mode = 'Paid' (leave everything else untouched) ────────
  let ok = 0, fail = 0;
  for (const b of toUpdate) {
    try {
      await sbPatch(b.bill_no, { payment_mode: 'Paid' });
      ok++;
      if (ok % 25 === 0) console.log(`  Updated: ${ok}/${toUpdate.length}`);
    } catch (e) {
      console.error(`  FAIL ${b.bill_no}: ${e.message}`);
      fail++;
    }
  }

  console.log(`\n✅ Done`);
  console.log(`   Updated → Paid : ${ok}`);
  console.log(`   Failed         : ${fail}`);
  console.log(`   Already Paid   : ${alreadyPaid.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
