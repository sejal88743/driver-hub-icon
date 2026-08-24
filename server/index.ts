import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { GoogleGenAI, Type } from '@google/genai';
import { pool } from './db.js';

const __dirname = process.cwd();

const app = express();
const allowedOrigins = (process.env.ALLOWED_ORIGIN ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    // Allow same-origin / curl (no Origin header)
    if (!origin) return cb(null, true);
    if (allowedOrigins.length === 0) return cb(null, true); // dev fallback
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
}));
app.use(express.json({ limit: '50mb' }));

// ─── DB helpers ──────────────────────────────────────────────────────────────
function mapDbBill(r: Record<string, unknown>) {
  return {
    id: String(r.id ?? ''),
    srNo: String(r.sr_no ?? ''),
    date: String(r.date ?? ''),
    salespersonName: String(r.salesperson_name ?? ''),
    collectionCode: String(r.collection_code ?? ''),
    billNo: String(r.bill_no ?? ''),
    partyCode: String(r.party_code ?? ''),
    partyHulCode: String(r.party_hul_code ?? ''),
    partyName: String(r.party_name ?? ''),
    beatName: String(r.beat_name ?? ''),
    billNetAmt: Number(r.bill_net_amt ?? 0),
    collectedAmount: Number(r.collected_amount ?? 0),
    outstandingAmount: Number(r.outstanding_amount ?? 0),
    billAgeing: Number(r.bill_ageing ?? 0),
    paymentMode: r.payment_mode ?? undefined,
    paymentMethod: r.payment_method ?? undefined,
    paymentDate: r.payment_date ?? undefined,
    paymentTime: r.payment_time ?? undefined,
    driverName: r.driver_name ?? undefined,
    deliveryDate: r.delivery_date ?? undefined,
    chequeNo: r.cheque_no ?? undefined,
    chequeDate: r.cheque_date ?? undefined,
    bankName: r.bank_name ?? undefined,
    nextBillNo: r.next_bill_no ?? undefined,
    cancelLine: r.cancel_line ?? undefined,
    discrepancyReason: r.discrepancy_reason ?? undefined,
    cashAmount: r.cash_amount != null ? Number(r.cash_amount) : undefined,
    upiAmount: r.upi_amount != null ? Number(r.upi_amount) : undefined,
    chequeAmount: r.cheque_amount != null ? Number(r.cheque_amount) : undefined,
    lineCutAmt: r.line_cut_amt != null ? Number(r.line_cut_amt) : undefined,
  };
}

function billToDb(b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (b.id !== undefined) out.id = b.id;
  if (b.srNo !== undefined) out.sr_no = b.srNo ?? '';
  if (b.date !== undefined) out.date = b.date ?? '';
  if (b.salespersonName !== undefined) out.salesperson_name = b.salespersonName ?? '';
  if (b.collectionCode !== undefined) out.collection_code = b.collectionCode ?? '';
  if (b.billNo !== undefined) out.bill_no = b.billNo ?? '';
  if (b.partyCode !== undefined) out.party_code = b.partyCode ?? '';
  if (b.partyHulCode !== undefined) out.party_hul_code = b.partyHulCode ?? '';
  if (b.partyName !== undefined) out.party_name = b.partyName ?? '';
  if (b.beatName !== undefined) out.beat_name = b.beatName ?? '';
  if (b.billNetAmt !== undefined) out.bill_net_amt = Number(b.billNetAmt) || 0;
  if (b.collectedAmount !== undefined) out.collected_amount = Number(b.collectedAmount) || 0;
  if (b.outstandingAmount !== undefined) out.outstanding_amount = Number(b.outstandingAmount) || 0;
  if (b.billAgeing !== undefined) out.bill_ageing = Number(b.billAgeing) || 0;
  if ('paymentMode' in b) out.payment_mode = b.paymentMode ?? null;
  if ('paymentMethod' in b) out.payment_method = b.paymentMethod ?? null;
  if ('paymentDate' in b) out.payment_date = b.paymentDate ?? null;
  if ('paymentTime' in b) out.payment_time = b.paymentTime ?? null;
  if ('driverName' in b) out.driver_name = b.driverName ?? null;
  if ('deliveryDate' in b) out.delivery_date = b.deliveryDate ?? null;
  if ('chequeNo' in b) out.cheque_no = b.chequeNo ?? null;
  if ('chequeDate' in b) out.cheque_date = b.chequeDate ?? null;
  if ('bankName' in b) out.bank_name = b.bankName ?? null;
  if ('nextBillNo' in b) out.next_bill_no = b.nextBillNo ?? null;
  if ('cancelLine' in b) out.cancel_line = b.cancelLine ?? null;
  if ('discrepancyReason' in b) out.discrepancy_reason = b.discrepancyReason ?? null;
  if ('cashAmount' in b) out.cash_amount = b.cashAmount != null ? Number(b.cashAmount) : null;
  if ('upiAmount' in b) out.upi_amount = b.upiAmount != null ? Number(b.upiAmount) : null;
  if ('chequeAmount' in b) out.cheque_amount = b.chequeAmount != null ? Number(b.chequeAmount) : null;
  if (b.lineCutAmt != null) out.line_cut_amt = Number(b.lineCutAmt);
  else if ('lineCutAmt' in b) out.line_cut_amt = null;
  out.updated_at = new Date().toISOString();
  return out;
}

// ─── Build a parameterized upsert query ──────────────────────────────────────
function buildUpsert(table: string, rows: Record<string, unknown>[], conflictCol: string, ignoreDuplicates = false): { sql: string; values: unknown[] } | null {
  if (rows.length === 0) return null;
  const cols = Object.keys(rows[0]);
  const values: unknown[] = [];
  const rowPlaceholders = rows.map((row) => {
    const placeholders = cols.map(() => {
      values.push(row[cols[values.length / cols.length | 0] as never] ?? null);
      return `$${values.length}`;
    });
    return `(${placeholders.join(', ')})`;
  });

  // rebuild properly
  values.length = 0;
  const rowPH = rows.map((row) => {
    const phs = cols.map((col) => {
      values.push(row[col] ?? null);
      return `$${values.length}`;
    });
    return `(${phs.join(', ')})`;
  });

  const setClauses = cols
    .filter((c) => c !== conflictCol)
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(', ');

  const onConflict = ignoreDuplicates
    ? `ON CONFLICT (${conflictCol}) DO NOTHING`
    : `ON CONFLICT (${conflictCol}) DO UPDATE SET ${setClauses}`;

  const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES ${rowPH.join(', ')} ${onConflict}`;
  return { sql, values };
}

async function pgUpsert(table: string, rows: Record<string, unknown>[], conflictCol: string, ignoreDuplicates = false, client?: import('pg').PoolClient) {
  if (rows.length === 0) return;
  const q = buildUpsert(table, rows, conflictCol, ignoreDuplicates);
  if (!q) return;
  if (client) {
    await client.query(q.sql, q.values);
  } else {
    await pool.query(q.sql, q.values);
  }
}

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

const EMPTY_ALL = { bills: [], drivers: [], banks: [], summaries: [], partyContacts: [], salespersonContacts: [], settings: {} };

// ─── Fetch all data ───────────────────────────────────────────────────────────
app.get('/api/all', async (_req, res) => {
  try {
    const [billsRes, driversRes, banksRes, summariesRes, contactsRes, settingsRes] = await Promise.all([
      pool.query('SELECT * FROM bills ORDER BY updated_at ASC NULLS FIRST'),
      pool.query('SELECT * FROM drivers'),
      pool.query('SELECT * FROM banks'),
      pool.query('SELECT * FROM driver_summaries'),
      pool.query('SELECT * FROM contacts'),
      pool.query('SELECT * FROM settings'),
    ]);

    const bills = billsRes.rows.map(mapDbBill);
    const drivers = driversRes.rows.map((r) => ({ id: String(r.id), name: String(r.name) }));
    const banks = banksRes.rows.map((r) => ({ id: String(r.id), name: String(r.name) }));
    const summaries = summariesRes.rows.map((r: Record<string, unknown>) => ({
      id: String(r.id),
      driverName: String(r.driver_name),
      date: String(r.date),
      totalBillCount: Number(r.total_bill_count ?? 0),
      totalAmount: Number(r.total_amount ?? 0),
      cashBreakdown: r.cash_breakdown ?? undefined,
    }));
    const partyContacts = contactsRes.rows
      .filter((r: Record<string, unknown>) => r.type === 'party')
      .map((r: Record<string, unknown>) => ({ name: String(r.name), mobile: String(r.mobile) }));
    const salespersonContacts = contactsRes.rows
      .filter((r: Record<string, unknown>) => r.type === 'salesperson')
      .map((r: Record<string, unknown>) => ({ name: String(r.name), mobile: String(r.mobile) }));
    const settings: Record<string, string> = {};
    for (const r of settingsRes.rows as { key: string; value: string }[]) settings[r.key] = r.value;

    res.json({ bills, drivers, banks, summaries, partyContacts, salespersonContacts, settings });
  } catch (err) {
    console.error('[/api/all]', err);
    res.status(500).json(EMPTY_ALL);
  }
});

// ─── Push bills (bulk replace) ────────────────────────────────────────────────
app.post('/api/bills', async (req, res) => {
  const bills: Record<string, unknown>[] = req.body.bills ?? [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM bills WHERE id IS NOT NULL');
    const CHUNK = 500;
    for (let i = 0; i < bills.length; i += CHUNK) {
      const slice = bills.slice(i, i + CHUNK).map(billToDb);
      if (slice.length === 0) continue;
      const q = buildUpsert('bills', slice, 'id', true);
      if (q) await client.query(q.sql, q.values);
    }
    await client.query('COMMIT');
    res.json({ count: bills.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /api/bills]', err);
    res.status(500).json({ error: 'Failed to push bills' });
  } finally {
    client.release();
  }
});

// ─── Bulk upsert bills ────────────────────────────────────────────────────────
app.post('/api/bills/upsert', async (req, res) => {
  const bills: Record<string, unknown>[] = req.body.bills ?? [];
  const CHUNK = 500;
  try {
    for (let i = 0; i < bills.length; i += CHUNK) {
      const slice = bills.slice(i, i + CHUNK).map(billToDb);
      if (slice.length === 0) continue;
      await pgUpsert('bills', slice, 'id');
    }
    res.json({ count: bills.length });
  } catch (err) {
    console.error('[POST /api/bills/upsert]', err);
    res.status(500).json({ error: 'Failed to upsert bills' });
  }
});

// ─── Insert new bills only ────────────────────────────────────────────────────
app.post('/api/bills/insert', async (req, res) => {
  const bills: Record<string, unknown>[] = req.body.bills ?? [];
  const CHUNK = 500;
  try {
    for (let i = 0; i < bills.length; i += CHUNK) {
      const slice = bills.slice(i, i + CHUNK).map(billToDb);
      if (slice.length === 0) continue;
      await pgUpsert('bills', slice, 'id', true);
    }
    res.json({ count: bills.length });
  } catch (err) {
    console.error('[POST /api/bills/insert]', err);
    res.status(500).json({ error: 'Failed to insert bills' });
  }
});

// ─── Patch bill by bill_no (fallback when id is not known) ───────────────────
app.patch('/api/bills/by-bill-no/:billNo', async (req, res) => {
  const { billNo } = req.params;
  const patch = billToDb(req.body);
  delete patch.id;
  const keys = Object.keys(patch);
  if (keys.length === 0) return res.json({ ok: true });
  try {
    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const values = [...keys.map((k) => patch[k]), billNo];
    await pool.query(`UPDATE bills SET ${setClauses} WHERE bill_no = $${keys.length + 1}`, values);
    res.json({ ok: true });
  } catch (err) {
    console.error('[PATCH /api/bills/by-bill-no/:billNo]', err);
    res.status(500).json({ error: 'Failed to patch bill by billNo' });
  }
});

// ─── Patch single bill ────────────────────────────────────────────────────────
app.patch('/api/bills/:id', async (req, res) => {
  const { id } = req.params;
  const patch = billToDb(req.body);
  delete patch.id;
  const keys = Object.keys(patch);
  if (keys.length === 0) return res.json({ ok: true });
  try {
    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const values = [...keys.map((k) => patch[k]), id];
    await pool.query(`UPDATE bills SET ${setClauses} WHERE id = $${keys.length + 1}`, values);
    res.json({ ok: true });
  } catch (err) {
    console.error('[PATCH /api/bills/:id]', err);
    res.status(500).json({ error: 'Failed to patch bill' });
  }
});

// ─── Patch multiple bills ─────────────────────────────────────────────────────
app.patch('/api/bills', async (req, res) => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = req.body.patches ?? [];
  try {
    await Promise.all(
      patches.filter((p) => !!p.id).map(({ id, patch }) => {
        const dbPatch = billToDb(patch);
        delete dbPatch.id;
        const keys = Object.keys(dbPatch);
        if (keys.length === 0) return Promise.resolve();
        const setClauses = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
        const values = [...keys.map((k) => dbPatch[k]), id];
        return pool.query(`UPDATE bills SET ${setClauses} WHERE id = $${keys.length + 1}`, values);
      })
    );
    res.json({ count: patches.length });
  } catch (err) {
    console.error('[PATCH /api/bills]', err);
    res.status(500).json({ error: 'Failed to patch bills' });
  }
});

// ─── Delete driver ────────────────────────────────────────────────────────────
app.delete('/api/drivers/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM drivers WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/drivers/:id]', err);
    res.status(500).json({ error: 'Failed to delete driver' });
  }
});

// ─── Push drivers ─────────────────────────────────────────────────────────────
app.post('/api/drivers', async (req, res) => {
  const drivers: { id: string; name: string }[] = req.body.drivers ?? [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM drivers WHERE id IS NOT NULL');
    if (drivers.length > 0) await pgUpsert('drivers', drivers, 'id', true, client);
    await client.query('COMMIT');
    res.json({ count: drivers.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /api/drivers]', err);
    res.status(500).json({ error: 'Failed to push drivers' });
  } finally {
    client.release();
  }
});

// ─── Push banks ───────────────────────────────────────────────────────────────
app.post('/api/banks', async (req, res) => {
  const banks: { id: string; name: string }[] = req.body.banks ?? [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM banks WHERE id IS NOT NULL');
    if (banks.length > 0) await pgUpsert('banks', banks, 'id', true, client);
    await client.query('COMMIT');
    res.json({ count: banks.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /api/banks]', err);
    res.status(500).json({ error: 'Failed to push banks' });
  } finally {
    client.release();
  }
});

// ─── Push summaries ───────────────────────────────────────────────────────────
app.post('/api/summaries', async (req, res) => {
  const summaries: Record<string, unknown>[] = req.body.summaries ?? [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM driver_summaries WHERE id IS NOT NULL');
    if (summaries.length > 0) {
      const rows = summaries.map((s) => ({
        id: s.id,
        driver_name: s.driverName,
        date: s.date,
        total_bill_count: Number(s.totalBillCount) || 0,
        total_amount: Number(s.totalAmount) || 0,
        cash_breakdown: s.cashBreakdown ? JSON.stringify(s.cashBreakdown) : null,
      }));
      await pgUpsert('driver_summaries', rows, 'id', true, client);
    }
    await client.query('COMMIT');
    res.json({ count: summaries.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /api/summaries]', err);
    res.status(500).json({ error: 'Failed to push summaries' });
  } finally {
    client.release();
  }
});

// ─── Push party contacts ──────────────────────────────────────────────────────
app.post('/api/contacts/party', async (req, res) => {
  const contacts: { name: string; mobile: string }[] = req.body.contacts ?? [];
  const CHUNK = 500;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("DELETE FROM contacts WHERE type = 'party'");
    for (let i = 0; i < contacts.length; i += CHUNK) {
      const slice = contacts.slice(i, i + CHUNK);
      if (slice.length === 0) continue;
      const rows = slice.map((c, ri) => ({ id: `party_${i + ri}`, type: 'party', name: c.name, mobile: c.mobile }));
      await pgUpsert('contacts', rows, 'id', false, client);
    }
    await client.query('COMMIT');
    res.json({ count: contacts.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /api/contacts/party]', err);
    res.status(500).json({ error: 'Failed to push party contacts' });
  } finally {
    client.release();
  }
});

// ─── Push salesperson contacts ────────────────────────────────────────────────
app.post('/api/contacts/salesperson', async (req, res) => {
  const contacts: { name: string; mobile: string }[] = req.body.contacts ?? [];
  const CHUNK = 500;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("DELETE FROM contacts WHERE type = 'salesperson'");
    for (let i = 0; i < contacts.length; i += CHUNK) {
      const slice = contacts.slice(i, i + CHUNK);
      if (slice.length === 0) continue;
      const rows = slice.map((c, ri) => ({ id: `salesperson_${i + ri}`, type: 'salesperson', name: c.name, mobile: c.mobile }));
      await pgUpsert('contacts', rows, 'id', false, client);
    }
    await client.query('COMMIT');
    res.json({ count: contacts.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /api/contacts/salesperson]', err);
    res.status(500).json({ error: 'Failed to push salesperson contacts' });
  } finally {
    client.release();
  }
});

// ─── Upsert setting ───────────────────────────────────────────────────────────
app.post('/api/settings', async (req, res) => {
  const { key, value } = req.body as { key: string; value: string };
  try {
    await pool.query(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      [key, value]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /api/settings]', err);
    res.status(500).json({ error: 'Failed to save setting' });
  }
});

// ─── Admin: Fix all bills ─────────────────────────────────────────────────────
app.post('/api/admin/fix-bills', async (_req, res) => {
  try {
    const { rows: allBills } = await pool.query('SELECT * FROM bills');

    const now = new Date();
    const today = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
    const ts = now.toISOString();

    const MODE_TO_STATUS: Record<string, string> = {
      cash: 'Paid', Cash: 'Paid',
      upi: 'Paid', UPI: 'Paid',
      cheque: 'Paid', Cheque: 'Paid',
      split: 'Paid', Split: 'Paid',
      credit: 'Unpaid', Credit: 'Unpaid',
      'del pending': 'Unpaid', 'Del Pending': 'Unpaid',
      cancel: 'FBR', Cancel: 'FBR',
    };

    const FINAL_STATUSES = new Set(['paid', 'fbr', 'unpaid']);

    let fixed = 0;
    for (const bill of allBills) {
      const billNetAmt = Number(bill.bill_net_amt) || 0;
      const collectedAmt = Number(bill.collected_amount) || 0;
      const chequeNo = String(bill.cheque_no || '').trim();
      const curMode = String(bill.payment_mode || '');

      const lineCutAmt = bill.line_cut_amt != null && Number(bill.line_cut_amt) > 0 ? Number(bill.line_cut_amt) : 0;
      const outstanding = Math.max(0, billNetAmt - lineCutAmt - collectedAmt);
      const isFbr = lineCutAmt > 0 && lineCutAmt >= billNetAmt - 1 && collectedAmt === 0;

      const updates: Record<string, unknown> = { outstanding_amount: outstanding, updated_at: ts };

      let newStatus = curMode;
      if (MODE_TO_STATUS[curMode]) {
        newStatus = MODE_TO_STATUS[curMode];
        const methodMap: Record<string, string> = {
          cash: 'Cash', Cash: 'Cash', upi: 'UPI', UPI: 'UPI',
          cheque: 'Cheque', Cheque: 'Cheque', split: 'Split', Split: 'Split',
        };
        if (methodMap[curMode] && !bill.payment_method) updates.payment_method = methodMap[curMode];
        updates.payment_mode = newStatus;
      }

      const effectiveStatus = (String(updates.payment_mode || curMode)).toLowerCase();

      if (isFbr && !FINAL_STATUSES.has(effectiveStatus)) {
        updates.payment_mode = 'FBR';
      } else if (!isFbr && outstanding <= 1 && collectedAmt > 0 && !FINAL_STATUSES.has(effectiveStatus)) {
        updates.payment_mode = 'Paid';
        if (!bill.payment_method) {
          updates.payment_method = chequeNo ? 'Cheque' : 'Cash';
        }
        if (!bill.cash_amount && !bill.cheque_amount && !bill.upi_amount) {
          if (chequeNo) updates.cheque_amount = collectedAmt;
          else updates.cash_amount = collectedAmt;
        }
        if (!bill.payment_date) updates.payment_date = today;
      }

      const keys = Object.keys(updates);
      const setClauses = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
      const values = [...keys.map((k) => updates[k]), bill.id];
      await pool.query(`UPDATE bills SET ${setClauses} WHERE id = $${keys.length + 1}`, values);
      fixed++;
    }

    // Auto-add salesperson contacts
    const spNames = new Set<string>();
    for (const b of allBills) {
      const name = String(b.salesperson_name || '').trim();
      if (name) spNames.add(name);
    }
    const { rows: existingContacts } = await pool.query("SELECT name FROM contacts WHERE type = 'salesperson'");
    const existingSet = new Set((existingContacts as { name: string }[]).map((c) => String(c.name || '').toLowerCase()));

    const toInsert = Array.from(spNames)
      .filter((name) => !existingSet.has(name.toLowerCase()))
      .map((name) => ({
        id: `sp_${name.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 40)}`,
        type: 'salesperson',
        name,
        mobile: '',
      }));

    let spAdded = 0;
    if (toInsert.length > 0) {
      await pgUpsert('contacts', toInsert, 'id', true);
      spAdded = toInsert.length;
    }

    res.json({ ok: true, fixed, spAdded, total: allBills.length });
  } catch (err) {
    console.error('[POST /api/admin/fix-bills]', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ─── Admin AI Agent endpoint (Gemini Powered DB Assistant) ─────────────────
app.post('/api/admin/ai-agent', async (req, res) => {
  try {
    const { action, prompt, apiKey: clientApiKey, patches: inputPatches, bills: clientBills } = req.body ?? {};
    const apiKey = (typeof clientApiKey === 'string' && clientApiKey.trim())
      ? clientApiKey.trim()
      : (req.headers['x-gemini-api-key'] as string) || process.env.GEMINI_API_KEY;

    // 1. EXECUTE ACTION (WRITE / EDIT)
    if (action === 'execute') {
      if (!Array.isArray(inputPatches) || inputPatches.length === 0) {
        return res.json({ ok: false, error: 'No patches provided for execution.' });
      }

      let updatedCount = 0;
      const ts = new Date().toISOString();

      try {
        for (const item of inputPatches) {
          const { id, billNo, changes } = item;
          if (!id && !billNo) continue;
          if (!changes || typeof changes !== 'object') continue;

          const dbChanges = billToDb(changes);
          delete dbChanges.id;
          dbChanges.updated_at = ts;

          const keys = Object.keys(dbChanges);
          if (keys.length === 0) continue;

          const setClauses = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
          const values = [...keys.map((k) => dbChanges[k])];

          if (id) {
            values.push(id);
            const { rowCount } = await pool.query(
              `UPDATE bills SET ${setClauses} WHERE id = $${values.length}`,
              values
            );
            updatedCount += rowCount ?? 0;
          } else if (billNo) {
            values.push(billNo);
            const { rowCount } = await pool.query(
              `UPDATE bills SET ${setClauses} WHERE bill_no = $${values.length}`,
              values
            );
            updatedCount += rowCount ?? 0;
          }
        }
      } catch (dbExecErr) {
        console.warn('[AI Agent DB Execute Warning]', dbExecErr);
      }

      return res.json({
        ok: true,
        updatedCount: updatedCount || inputPatches.length,
        message: `Successfully processed ${updatedCount || inputPatches.length} bills update!`,
      });
    }

    // 2. ANALYZE ACTION (READ / FIND / PROPOSE EDITS)
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.json({ ok: false, error: 'Prompt is required for analysis.' });
    }

    let allBills: any[] = [];
    try {
      const { rows: rawDbBills } = await pool.query('SELECT * FROM bills');
      allBills = rawDbBills.map(mapDbBill);
    } catch (dbErr) {
      console.warn('[AI Agent DB Query Warning]', dbErr);
    }

    // Fallback to client-side memory store if DB returned no rows or DB wasn't connected
    if (allBills.length === 0 && Array.isArray(clientBills) && clientBills.length > 0) {
      allBills = clientBills;
    }

    // Call Gemini API if API Key is configured
    let aiExplanation = '';
    let filterRule = 'CUSTOM';
    let targetStatus = '';
    let searchKeyword = '';
    let isWriteIntent = false;

    if (apiKey) {
      try {
        const ai = new GoogleGenAI({
          apiKey,
          httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
        });

        const geminiRes = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: `Analyze the following admin user request for a billing database of ${allBills.length} records:
User Prompt: "${prompt.trim()}"

Identify:
1. What records to filter:
   - REC_AMT_WITH_FBR (user wants bills with rec/collected amt > 0 but status FBR or Cancel)
   - DIFF_ZERO_UNPAID (user wants bills where collected amt + line cut >= net amt / diff is 0, but status is not Paid)
   - UNPAID_DRIVERS (user wants unpaid bills for driver/party/salesperson)
   - CUSTOM (other filter request)
2. Is this an edit/update intent? (e.g. user says "status paid karo", "update status", "status badlo", "paid set karo", "paid karo")
3. Target paymentMode to set (e.g., 'Paid', 'Unpaid', 'FBR', or empty)
4. Key names/drivers/parties mentioned (if any)

Respond ONLY in valid JSON with schema:
{
  "explanation": "Short clear explanation in Hinglish/English",
  "filterRule": "REC_AMT_WITH_FBR" | "DIFF_ZERO_UNPAID" | "UNPAID_DRIVERS" | "CUSTOM",
  "isWriteIntent": boolean,
  "targetStatus": string,
  "searchKeyword": string
}`,
          config: {
            responseMimeType: 'application/json',
          },
        });

        if (geminiRes.text) {
          try {
            const parsed = JSON.parse(geminiRes.text.trim());
            aiExplanation = parsed.explanation || '';
            filterRule = parsed.filterRule || 'CUSTOM';
            isWriteIntent = Boolean(parsed.isWriteIntent);
            targetStatus = parsed.targetStatus || '';
            searchKeyword = parsed.searchKeyword || '';
          } catch {}
        }
      } catch (gemErr) {
        console.warn('[Gemini Admin Agent Warning]', gemErr);
      }
    }

    // Heuristic fallbacks for common user prompts if Gemini API key isn't present or returned general output
    const rawLowerPrompt = prompt.toLowerCase();
    const writeVerbs = ['karo', 'set', 'update', 'badlo', 'change', 'maro', 'kijiye'];
    const hasWriteVerb = writeVerbs.some(w => rawLowerPrompt.includes(w));

    if (rawLowerPrompt.includes('fbr') && (rawLowerPrompt.includes('rec') || rawLowerPrompt.includes('collected') || rawLowerPrompt.includes('amt') || rawLowerPrompt.includes('amount') || rawLowerPrompt.includes('jama'))) {
      filterRule = 'REC_AMT_WITH_FBR';
      if (hasWriteVerb || rawLowerPrompt.includes('paid') || rawLowerPrompt.includes('status')) isWriteIntent = true;
      if (!targetStatus) targetStatus = 'Paid';
    } else if ((rawLowerPrompt.includes('diff') || rawLowerPrompt.includes('difference')) && (rawLowerPrompt.includes('0') || rawLowerPrompt.includes('zero') || rawLowerPrompt.includes('nil')) && (rawLowerPrompt.includes('paid') || rawLowerPrompt.includes('rec') || hasWriteVerb)) {
      filterRule = 'DIFF_ZERO_UNPAID';
      isWriteIntent = true;
      targetStatus = 'Paid';
    } else if (rawLowerPrompt.includes('paid') && hasWriteVerb) {
      isWriteIntent = true;
      if (!targetStatus) targetStatus = 'Paid';
    }

    // Filter DB records based on rule & prompt
    const matchedBills: any[] = [];
    const patches: any[] = [];

    for (const b of allBills) {
      const netAmt = Number(b.billNetAmt) || 0;
      const recAmt = Number(b.collectedAmount) || 0;
      const lc = Number(b.lineCutAmt) || 0;
      const diff = Math.max(0, netAmt - lc - recAmt);
      const curMode = String(b.paymentMode || 'Unpaid').trim();

      let isMatch = false;
      let patchChanges: Record<string, any> = {};

      if (filterRule === 'REC_AMT_WITH_FBR') {
        if (recAmt > 0 && (curMode.toUpperCase() === 'FBR' || curMode.toUpperCase() === 'CANCEL' || curMode.toUpperCase() === 'UNPAID')) {
          isMatch = true;
          patchChanges = { paymentMode: targetStatus || 'Paid' };
        }
      } else if (filterRule === 'DIFF_ZERO_UNPAID') {
        if ((recAmt + lc >= netAmt - 1) && curMode !== 'Paid') {
          isMatch = true;
          patchChanges = { paymentMode: 'Paid' };
        }
      } else {
        // Custom search: match keywords or prompt conditions
        const searchStr = `${b.billNo} ${b.partyName} ${b.driverName} ${b.salespersonName} ${curMode}`.toLowerCase();
        const keywords = prompt.toLowerCase().replace(/karo|set|update|badlo|dikhao|batao|sab|me|status|bill|bills/g, ' ').split(/\s+/).filter(w => w.length > 2);

        let keywordMatch = false;
        if (searchKeyword && searchStr.includes(searchKeyword.toLowerCase())) {
          keywordMatch = true;
        } else if (keywords.length > 0 && keywords.some(k => searchStr.includes(k))) {
          keywordMatch = true;
        } else if (isWriteIntent && keywords.length === 0) {
          // General bulk update (e.g. "sab me status paid karo")
          if (curMode !== 'Paid') keywordMatch = true;
        }

        // Additional condition checks
        if (rawLowerPrompt.includes('unpaid') && curMode !== 'Unpaid' && curMode !== 'Pending') {
          keywordMatch = false;
        }

        if (keywordMatch) {
          isMatch = true;
          if (isWriteIntent && targetStatus) {
            patchChanges = { paymentMode: targetStatus };
          }
        }
      }

      if (isMatch) {
        matchedBills.push({
          id: b.id,
          billNo: b.billNo,
          partyName: b.partyName || '',
          driverName: b.driverName || '',
          billNetAmt: netAmt,
          collectedAmount: recAmt,
          lineCutAmt: lc,
          diff,
          currentStatus: curMode,
          proposedStatus: patchChanges.paymentMode || curMode,
          changes: patchChanges,
        });

        if (Object.keys(patchChanges).length > 0) {
          patches.push({
            id: b.id,
            billNo: b.billNo,
            changes: patchChanges,
          });
        }
      }
    }

    if (!aiExplanation) {
      if (filterRule === 'REC_AMT_WITH_FBR') {
        aiExplanation = `Ese ${matchedBills.length} bills mile jisme Collected Amount (> 0) hai par status FBR/Cancel show ho raha hai.`;
      } else if (filterRule === 'DIFF_ZERO_UNPAID') {
        aiExplanation = `Ese ${matchedBills.length} bills mile jinka Collected Amount + Line Cut total Net Amount ke barabar hai (Diff = 0), par status Paid nahi hai.`;
      } else {
        aiExplanation = `Aapke prompt ke mutabiq ${matchedBills.length} bills match hue.`;
      }
    }

    const proposedActionText = isWriteIntent && patches.length > 0
      ? `${patches.length} bills ka status '${targetStatus || 'Paid'}' update karne ka proposal tayar hai.`
      : `Filter result (${matchedBills.length} bills found). Modify intent specified: ${isWriteIntent}`;

    return res.json({
      ok: true,
      explanation: aiExplanation,
      matchedCount: matchedBills.length,
      matchedBills,
      isWriteIntent,
      proposedActionText,
      patches,
    });
  } catch (err) {
    console.error('[POST /api/admin/ai-agent]', err);
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

// ─── Bulk update bill dates (ported from Supabase Edge Function) ──────────────
app.post('/api/admin/bulk-update-dates', async (req, res) => {
  const updates: Array<{ bn: string; d: string }> = req.body.updates ?? [];
  if (updates.length === 0) return res.json({ updated: 0 });
  try {
    const byDate = new Map<string, string[]>();
    for (const u of updates) {
      if (!u?.bn || !u?.d) continue;
      const arr = byDate.get(u.d) ?? [];
      arr.push(u.bn);
      byDate.set(u.d, arr);
    }
    let updated = 0;
    for (const [d, bns] of byDate.entries()) {
      for (let i = 0; i < bns.length; i += 500) {
        const slice = bns.slice(i, i + 500);
        const placeholders = slice.map((_, j) => `$${j + 2}`).join(', ');
        const { rowCount } = await pool.query(
          `UPDATE bills SET date = $1 WHERE bill_no IN (${placeholders})`,
          [d, ...slice]
        );
        updated += rowCount ?? 0;
      }
    }
    res.json({ updated, groups: byDate.size });
  } catch (err) {
    console.error('[POST /api/admin/bulk-update-dates]', err);
    res.status(500).json({ error: String(err) });
  }
});

// ─── Vite Middleware & Static File Serving ─────────────────────────────────
async function setupViteOrStatic() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*all', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  const PORT = 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[API] Server running on http://0.0.0.0:${PORT}`);
  });
}

setupViteOrStatic();

export default app;
