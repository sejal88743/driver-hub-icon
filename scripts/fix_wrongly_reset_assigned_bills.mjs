// Reproducible fix for bills that were genuinely paid (collected_amount > 0) but had
// their payment_mode reset back to "Assigned" by the apiFixAssignedCreditStatus sweep
// (src/lib/apiSync.ts) before that function respected "collected_amount > 0 = genuinely
// paid" the same way applyPaymentRules does. See
// .agents/memory/assigned-status-reset-bug.md for the root cause.
//
// Usage: node scripts/fix_wrongly_reset_assigned_bills.mjs
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
      `${URL}/rest/v1/bills?select=id,bill_no,driver_name,delivery_date,payment_mode,payment_method,collected_amount,cash_amount,upi_amount,cheque_amount,bill_net_amt,line_cut_amt&${filter}&order=bill_no&limit=${pageSize}&offset=${offset}`,
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

const rows = await fetchAll(`payment_mode=eq.Assigned`);
const mislabeled = rows.filter(r => (Number(r.collected_amount) || 0) > 0);
console.log(`Scanned ${rows.length} 'Assigned' bills, found ${mislabeled.length} with real payment collected.`);

let fixed = 0, failed = 0;
for (const r of mislabeled) {
  const collected = Number(r.collected_amount) || 0;
  const net = Number(r.bill_net_amt) || 0;
  const cash = Number(r.cash_amount) || 0;
  const upi = Number(r.upi_amount) || 0;
  const chq = Number(r.cheque_amount) || 0;
  const nonZeroMethods = [cash > 0, upi > 0, chq > 0].filter(Boolean).length;
  let method;
  if (nonZeroMethods > 1) method = 'Split';
  else if (chq > 0) method = 'Cheque';
  else if (upi > 0) method = 'UPI';
  else if (cash > 0) method = 'Cash';
  else method = ['Cash', 'UPI', 'Cheque', 'Split'].includes(r.payment_method) ? r.payment_method : 'Cash';

  const existingLineCut = Number(r.line_cut_amt) || 0;
  const outstanding = Math.max(0, net - collected - existingLineCut);
  try {
    await patchBill(r.id, { payment_mode: 'Paid', payment_method: method, outstanding_amount: outstanding });
    fixed++;
  } catch (e) { failed++; console.error(r.bill_no, String(e)); }
}
console.log(`Done. Fixed: ${fixed}, failed: ${failed}`);
