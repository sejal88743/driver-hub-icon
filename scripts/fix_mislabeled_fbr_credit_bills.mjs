// Reproducible fix for bills that show as FBR/Credit despite an actual
// Cash/UPI/Cheque payment being recorded (collected_amount / cash_amount /
// upi_amount / cheque_amount > 0). See .agents/memory/credit-fbr-status-integrity.md
// for why this class of bug happens.
//
// Usage: node scripts/fix_mislabeled_fbr_credit_bills.mjs
// Requires VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY in .env.

import { readFileSync } from 'fs';

const envLines = readFileSync('.env', 'utf8').split('\n');
for (const l of envLines) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}

const URL = process.env.VITE_SUPABASE_URL;
const KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

async function fetchAll(filter) {
  let all = [];
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const res = await fetch(
      `${URL}/rest/v1/bills?select=id,bill_no,payment_mode,payment_method,collected_amount,cash_amount,upi_amount,cheque_amount,payment_date,bill_net_amt,line_cut_amt&${filter}&order=id&limit=${pageSize}&offset=${offset}`,
      { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } }
    );
    if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${await res.text()}`);
    const batch = await res.json();
    all = all.concat(batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

async function patchBill(id, patch) {
  const res = await fetch(`${URL}/rest/v1/bills?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      apikey: KEY, Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`PATCH ${id} failed: ${res.status} ${await res.text()}`);
}

const badStatuses = ['FBR', 'Cancel', 'Credit', 'Pending'];
const filter = `payment_mode=in.(${badStatuses.map(encodeURIComponent).join(',')})`;
const rows = await fetchAll(filter);

const mislabeled = rows.filter(r =>
  (Number(r.collected_amount) || 0) > 0 ||
  (Number(r.cash_amount) || 0) > 0 ||
  (Number(r.upi_amount) || 0) > 0 ||
  (Number(r.cheque_amount) || 0) > 0
);

console.log(`Scanned ${rows.length} FBR/Cancel/Credit/Pending bills, found ${mislabeled.length} with real payment amounts.`);

let fixed = 0, cleared = 0, failed = 0;
for (const r of mislabeled) {
  const collected = Number(r.collected_amount) || 0;
  const net = Number(r.bill_net_amt) || 0;
  const cash = Number(r.cash_amount) || 0;
  const upi = Number(r.upi_amount) || 0;
  const chq = Number(r.cheque_amount) || 0;

  if (collected === 0) {
    // collected_amount (source of truth) is 0 — the nonzero cash/upi/cheque
    // field is stale leftover data, not a real payment. Clear it, keep status.
    try { await patchBill(r.id, { cash_amount: 0, upi_amount: 0, cheque_amount: 0 }); cleared++; }
    catch (e) { failed++; console.error(e); }
    continue;
  }

  const nonZeroMethods = [cash > 0, upi > 0, chq > 0].filter(Boolean).length;
  let method;
  if (nonZeroMethods > 1) method = 'Split';
  else if (chq > 0) method = 'Cheque';
  else if (upi > 0) method = 'UPI';
  else if (cash > 0) method = 'Cash';
  else method = ['Cash', 'UPI', 'Cheque', 'Split'].includes(r.payment_method) ? r.payment_method : 'Cash';

  const lineCut = Math.max(0, net - collected);
  try {
    await patchBill(r.id, { payment_mode: 'Paid', payment_method: method, line_cut_amt: lineCut, outstanding_amount: 0 });
    fixed++;
  } catch (e) { failed++; console.error(e); }
}

console.log(`Done. Fixed to Paid: ${fixed}, cleared stale amount fields: ${cleared}, failed: ${failed}`);
