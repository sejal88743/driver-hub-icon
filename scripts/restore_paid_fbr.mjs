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
  // ── 1. CREDIT bill nos from HUL Excel ───────────────────────────────────────
  const wb = XLSX.readFile('./attached_assets/VitraTrack_08-07-2026_1783779058994.xlsx');
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  const creditBillNos = [
    ...new Set(
      rows
        .filter(r => String(r['Status']).trim().toUpperCase() === 'CREDIT')
        .map(r => String(r['Bill No']).trim())
        .filter(Boolean)
    ),
  ];
  console.log(`HUL CREDIT bills: ${creditBillNos.length}`);

  // ── 2. Fetch those bills from Supabase with full payment fields ──────────────
  const BATCH = 150;
  let all = [];
  for (let i = 0; i < creditBillNos.length; i += BATCH) {
    const chunk = creditBillNos.slice(i, i + BATCH);
    const filter = `in.(${chunk.map(n => `"${n}"`).join(',')})`;
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/bills?select=bill_no,payment_mode,payment_method,collected_amount,cash_amount,upi_amount,cheque_amount,line_cut_amt,bill_net_amt&bill_no=${encodeURIComponent(filter)}`,
      { headers: { ...hdr, Prefer: 'return=representation' } }
    );
    all.push(...(await res.json()));
  }
  console.log(`Fetched from Supabase: ${all.length}`);

  // ── 3. Identify which bills need restoring ───────────────────────────────────
  // Paid: collected_amount > 0 (payment_method & amounts are intact)
  const paidBills = all.filter(b => (b.collected_amount || 0) > 0);

  // FBR: collected_amount = 0, line_cut_amt ≥ 90% of bill_net_amt
  const fbrBills  = all.filter(b => {
    const col  = b.collected_amount || 0;
    const lc   = Number(b.line_cut_amt) || 0;
    const net  = Number(b.bill_net_amt) || 0;
    return col === 0 && net > 0 && lc >= net * 0.9;
  });

  console.log(`\nTo restore as Paid : ${paidBills.length}`);
  console.log(`To restore as FBR  : ${fbrBills.length}`);

  if (paidBills.length === 0 && fbrBills.length === 0) {
    console.log('Nothing to restore.');
    return;
  }

  // Sample check
  console.log('\nSample Paid bills:');
  paidBills.slice(0, 3).forEach(b =>
    console.log(`  ${b.bill_no} | method=${b.payment_method} | cash=${b.cash_amount} | upi=${b.upi_amount} | chq=${b.cheque_amount} | collected=${b.collected_amount}`)
  );
  console.log('FBR bills:');
  fbrBills.forEach(b =>
    console.log(`  ${b.bill_no} | line_cut=${b.line_cut_amt} | net=${b.bill_net_amt}`)
  );

  // ── 4. Restore Paid bills ────────────────────────────────────────────────────
  let paidOk = 0, paidFail = 0;
  for (const b of paidBills) {
    try {
      await sbPatch(b.bill_no, { payment_mode: 'Paid' });
      paidOk++;
      if (paidOk % 20 === 0) console.log(`  Paid restored: ${paidOk}/${paidBills.length}`);
    } catch (e) {
      console.error(`  FAIL ${b.bill_no}:`, e.message);
      paidFail++;
    }
  }

  // ── 5. Restore FBR bills ─────────────────────────────────────────────────────
  let fbrOk = 0, fbrFail = 0;
  for (const b of fbrBills) {
    try {
      await sbPatch(b.bill_no, { payment_mode: 'FBR' });
      fbrOk++;
    } catch (e) {
      console.error(`  FAIL FBR ${b.bill_no}:`, e.message);
      fbrFail++;
    }
  }

  console.log(`\n✅ Done`);
  console.log(`   Paid restored : ${paidOk}  (failed: ${paidFail})`);
  console.log(`   FBR  restored : ${fbrOk}  (failed: ${fbrFail})`);
}

main().catch(e => { console.error(e); process.exit(1); });
