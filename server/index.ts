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

// ─── Admin AI Agent endpoint (Gemini Powered DB Assistant & XLS Bulk Engine) ─
app.post('/api/admin/ai-agent', async (req, res) => {
  try {
    const { action, prompt, apiKey: clientApiKey, patches: inputPatches, bills: clientBills, billNos: inputBillNos, fileRows } = req.body ?? {};
    const apiKey = (typeof clientApiKey === 'string' && clientApiKey.trim())
      ? clientApiKey.trim()
      : (req.headers['x-gemini-api-key'] as string) || process.env.GEMINI_API_KEY;

    // 1. EXECUTE ACTION (WRITE / EDIT TO DATABASE)
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
              `UPDATE bills SET ${setClauses} WHERE bill_no = $${values.length} OR TRIM(UPPER(bill_no)) = TRIM(UPPER($${values.length}))`,
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
        message: `Successfully processed ${updatedCount || inputPatches.length} bills update in PostgreSQL database!`,
      });
    }

    // 2. ANALYZE ACTION (READ / FIND / PROPOSE EDITS)
    const userPrompt = typeof prompt === 'string' ? prompt.trim() : '';
    const hasXlsBills = Array.isArray(inputBillNos) && inputBillNos.length > 0;

    if (!userPrompt && !hasXlsBills) {
      return res.json({ ok: false, error: 'Prompt or XLS Bill Numbers required for analysis.' });
    }

    let allBills: any[] = [];
    try {
      const { rows: rawDbBills } = await pool.query('SELECT * FROM bills');
      allBills = rawDbBills.map(mapDbBill);
    } catch (dbErr) {
      console.warn('[AI Agent DB Query Warning]', dbErr);
    }

    // Fallback to client-side memory store if DB returned no rows
    if (allBills.length === 0 && Array.isArray(clientBills) && clientBills.length > 0) {
      allBills = clientBills;
    }

    // Helper date formatting (DD/MM/YYYY)
    const now = new Date();
    const todayDMY = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

    // Gemini Intent Analysis
    let aiExplanation = '';
    let targetPaymentMode = '';
    let targetPaymentMethod = '';
    let targetDate = '';
    let targetAmountMode = 'NET_AMOUNT'; // 'NET_AMOUNT' | 'ZERO' | 'CUSTOM'
    let discrepancyReason = '';
    let isWriteIntent = false;
    let searchKeyword = '';
    let filterRule = hasXlsBills ? 'XLS_BILLS' : 'CUSTOM';

    if (apiKey) {
      try {
        const ai = new GoogleGenAI({
          apiKey,
          httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
        });

        const promptContext = `You are the VitraTrack Billing AI Administrator.
Analyze this admin request for a billing database of ${allBills.length} records.
${hasXlsBills ? `User uploaded an XLS/Excel file with ${inputBillNos.length} Bill Numbers.` : ''}
User Command/Prompt: "${userPrompt || (hasXlsBills ? 'Process uploaded XLS bill numbers' : '')}"
Today's Date: "${todayDMY}"

Understand user's intent in Hindi, Hinglish, Gujarati, or English:
1. Target Payment Mode:
   - "Paid" (when user asks to mark bills as Paid, Jama, Cash me paid karo, UPI me paid karo, etc.)
   - "FBR" (when user asks to mark as FBR, Return, Cancel, Goods return, etc.)
   - "Credit" or "Del Pending" (when user asks for credit, delivery pending, etc.)
   - "Unpaid" (reset / unpaid)
   - "" (if only searching/filtering without updating)
2. Target Payment Method:
   - "Cash" (when user mentions cash, nakad, rokad)
   - "UPI" (when user mentions UPI, GPay, PhonePe, Paytm, online)
   - "Cheque" (when user mentions cheque, bank)
   - "Split" (when split payment is specified)
   - "" (none)
3. Target Date:
   - If user mentions specific date (e.g. "25/08/2026" or "2026-08-25" or "yesterday"), convert to DD/MM/YYYY.
   - If user asks for today / aaj ki date / default, use "${todayDMY}".
4. Discrepancy Reason (if FBR or discrepancy):
   - e.g. "Damage", "Rate Difference", "Party Closed", "Order Cancelled", "Excess Stock", "Goods Return"
5. Is this a Write/Edit/Update intent? (boolean: true if user wants to change/update/set/mark/paid/fbr/credit bills, false if just viewing)
6. Target Amount Mode: "NET_AMOUNT" (full collection equal to net - lineCut) | "ZERO" (for FBR/Credit) | "CUSTOM"

Respond ONLY in valid JSON matching schema:
{
  "explanation": "Clear Hinglish/English summary of what will be done",
  "isWriteIntent": boolean,
  "targetPaymentMode": "Paid" | "FBR" | "Credit" | "Del Pending" | "Unpaid" | "",
  "targetPaymentMethod": "Cash" | "UPI" | "Cheque" | "Split" | "",
  "targetDate": string,
  "targetAmountMode": "NET_AMOUNT" | "ZERO" | "CUSTOM",
  "discrepancyReason": string,
  "searchKeyword": string
}`;

        const geminiRes = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: promptContext,
          config: {
            responseMimeType: 'application/json',
          },
        });

        if (geminiRes.text) {
          try {
            const parsed = JSON.parse(geminiRes.text.trim());
            aiExplanation = parsed.explanation || '';
            isWriteIntent = Boolean(parsed.isWriteIntent);
            targetPaymentMode = parsed.targetPaymentMode || '';
            targetPaymentMethod = parsed.targetPaymentMethod || '';
            targetDate = parsed.targetDate || '';
            targetAmountMode = parsed.targetAmountMode || 'NET_AMOUNT';
            discrepancyReason = parsed.discrepancyReason || '';
            searchKeyword = parsed.searchKeyword || '';
          } catch {}
        }
      } catch (gemErr) {
        console.warn('[Gemini Admin Agent Warning]', gemErr);
      }
    }

    // Heuristic & rule-based fallbacks (guarantees accurate execution even without API key or if API was offline)
    const rawLower = userPrompt.toLowerCase();
    const writeVerbs = ['karo', 'set', 'update', 'badlo', 'change', 'maro', 'kijiye', 'mark', 'kar do', 'bharo', 'paid', 'fbr', 'credit'];
    const hasWriteVerb = writeVerbs.some(w => rawLower.includes(w)) || hasXlsBills;

    if (hasXlsBills) {
      isWriteIntent = true;
      if (!targetPaymentMode) {
        if (rawLower.includes('fbr') || rawLower.includes('cancel') || rawLower.includes('return')) {
          targetPaymentMode = 'FBR';
          targetAmountMode = 'ZERO';
          if (!discrepancyReason) discrepancyReason = 'Goods Return / FBR';
        } else if (rawLower.includes('credit') || rawLower.includes('del pending') || rawLower.includes('pending')) {
          targetPaymentMode = 'Del Pending';
          targetAmountMode = 'ZERO';
        } else if (rawLower.includes('unpaid') || rawLower.includes('reset')) {
          targetPaymentMode = 'Unpaid';
          targetAmountMode = 'ZERO';
        } else {
          // Default for XLS upload command is Paid in Cash (unless specified)
          targetPaymentMode = 'Paid';
          targetAmountMode = 'NET_AMOUNT';
        }
      }

      if (targetPaymentMode === 'Paid' && !targetPaymentMethod) {
        if (rawLower.includes('upi') || rawLower.includes('online') || rawLower.includes('gpay') || rawLower.includes('phonepe') || rawLower.includes('scanner')) {
          targetPaymentMethod = 'UPI';
        } else if (rawLower.includes('cheque') || rawLower.includes('check') || rawLower.includes('bank')) {
          targetPaymentMethod = 'Cheque';
        } else {
          targetPaymentMethod = 'Cash';
        }
      }

      // Extract explicit date if mentioned in prompt (e.g. 25/08/2026 or 25-08-2026)
      const dateMatch = userPrompt.match(/\b(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\b/);
      if (dateMatch && !targetDate) {
        const parts = dateMatch[1].replace(/[-.]/g, '/').split('/');
        if (parts.length === 3) {
          targetDate = `${parts[0].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[2].length === 2 ? '20' + parts[2] : parts[2]}`;
        }
      }
      if (!targetDate) targetDate = todayDMY;
    } else {
      if (rawLower.includes('fbr') && (rawLower.includes('rec') || rawLower.includes('collected') || rawLower.includes('amt') || rawLower.includes('amount') || rawLower.includes('jama'))) {
        filterRule = 'REC_AMT_WITH_FBR';
        if (hasWriteVerb || rawLower.includes('paid')) isWriteIntent = true;
        if (!targetPaymentMode) targetPaymentMode = 'Paid';
        if (!targetPaymentMethod) targetPaymentMethod = 'Cash';
      } else if ((rawLower.includes('diff') || rawLower.includes('difference')) && (rawLower.includes('0') || rawLower.includes('zero') || rawLower.includes('nil'))) {
        filterRule = 'DIFF_ZERO_UNPAID';
        isWriteIntent = true;
        targetPaymentMode = 'Paid';
        targetPaymentMethod = 'Cash';
      } else if (rawLower.includes('paid') && hasWriteVerb) {
        isWriteIntent = true;
        if (!targetPaymentMode) targetPaymentMode = 'Paid';
        if (rawLower.includes('upi')) targetPaymentMethod = 'UPI';
        else if (rawLower.includes('cheque')) targetPaymentMethod = 'Cheque';
        else if (!targetPaymentMethod) targetPaymentMethod = 'Cash';
      } else if (rawLower.includes('fbr') && hasWriteVerb) {
        isWriteIntent = true;
        targetPaymentMode = 'FBR';
        targetAmountMode = 'ZERO';
        if (!discrepancyReason) discrepancyReason = 'Goods Return / FBR';
      }
      if (!targetDate) targetDate = todayDMY;
    }

    // Build Bill Number Lookup Index for ultra fast and fuzzy matching
    const cleanBn = (s: string) => String(s || '').trim().toUpperCase().replace(/\s+/g, '');
    const stripGst = (s: string) => cleanBn(s).replace(/^GST[-_]?/i, '');

    const billMapByClean = new Map<string, any>();
    const billMapByStripped = new Map<string, any>();
    for (const b of allBills) {
      const c = cleanBn(b.billNo);
      if (c) billMapByClean.set(c, b);
      const st = stripGst(b.billNo);
      if (st) billMapByStripped.set(st, b);
    }

    const matchedBills: any[] = [];
    const patches: any[] = [];
    const matchedBillIds = new Set<string>();
    const unmatchedBillNos: string[] = [];

    if (hasXlsBills) {
      // ── Process Uploaded XLS Bill Numbers ──
      for (const rawBn of inputBillNos) {
        const c = cleanBn(rawBn);
        const st = stripGst(rawBn);
        const bill = billMapByClean.get(c) || billMapByStripped.get(st) || billMapByStripped.get(c);

        if (!bill) {
          unmatchedBillNos.push(String(rawBn));
          continue;
        }

        if (matchedBillIds.has(bill.id)) continue;
        matchedBillIds.add(bill.id);

        const netAmt = Number(bill.billNetAmt) || 0;
        const lc = Number(bill.lineCutAmt) || 0;
        const effectiveNet = Math.max(0, netAmt - lc);
        const curMode = String(bill.paymentMode || 'Unpaid').trim();

        let patchChanges: Record<string, any> = {};

        if (isWriteIntent && targetPaymentMode) {
          if (targetPaymentMode === 'Paid') {
            const method = targetPaymentMethod || 'Cash';
            patchChanges = {
              paymentMode: 'Paid',
              paymentMethod: method,
              paymentDate: targetDate || todayDMY,
              collectedAmount: effectiveNet,
              outstandingAmount: 0,
              cashAmount: method === 'Cash' ? effectiveNet : 0,
              upiAmount: method === 'UPI' ? effectiveNet : 0,
              chequeAmount: method === 'Cheque' ? effectiveNet : 0,
            };
          } else if (targetPaymentMode === 'FBR') {
            patchChanges = {
              paymentMode: 'FBR',
              paymentMethod: 'FBR',
              paymentDate: targetDate || todayDMY,
              discrepancyReason: discrepancyReason || 'Goods Return / FBR',
              collectedAmount: 0,
              cashAmount: 0,
              upiAmount: 0,
              chequeAmount: 0,
              outstandingAmount: 0,
            };
          } else if (targetPaymentMode === 'Del Pending' || targetPaymentMode === 'Credit') {
            patchChanges = {
              paymentMode: targetPaymentMode === 'Del Pending' ? 'Del Pending' : 'Credit',
              deliveryDate: targetDate || bill.deliveryDate || todayDMY,
              collectedAmount: 0,
              cashAmount: 0,
              upiAmount: 0,
              chequeAmount: 0,
              outstandingAmount: effectiveNet,
            };
          } else if (targetPaymentMode === 'Unpaid') {
            patchChanges = {
              paymentMode: 'Unpaid',
              collectedAmount: 0,
              cashAmount: 0,
              upiAmount: 0,
              chequeAmount: 0,
              outstandingAmount: effectiveNet,
            };
          }
        }

        matchedBills.push({
          id: bill.id,
          billNo: bill.billNo,
          partyName: bill.partyName || '',
          driverName: bill.driverName || '',
          billNetAmt: netAmt,
          collectedAmount: patchChanges.collectedAmount !== undefined ? patchChanges.collectedAmount : (Number(bill.collectedAmount) || 0),
          lineCutAmt: lc,
          diff: patchChanges.outstandingAmount !== undefined ? patchChanges.outstandingAmount : Math.max(0, netAmt - lc - (Number(bill.collectedAmount) || 0)),
          currentStatus: curMode,
          proposedStatus: patchChanges.paymentMode || curMode,
          proposedMethod: patchChanges.paymentMethod || bill.paymentMethod || '-',
          proposedDate: patchChanges.paymentDate || patchChanges.deliveryDate || bill.paymentDate || bill.deliveryDate || '-',
          changes: patchChanges,
        });

        if (Object.keys(patchChanges).length > 0) {
          patches.push({
            id: bill.id,
            billNo: bill.billNo,
            changes: patchChanges,
          });
        }
      }
    } else {
      // ── Process Natural Language DB Query / Filter ──
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
            if (isWriteIntent) {
              patchChanges = {
                paymentMode: 'Paid',
                paymentMethod: targetPaymentMethod || 'Cash',
                paymentDate: targetDate || todayDMY,
                cashAmount: (targetPaymentMethod === 'Cash' || !targetPaymentMethod) ? recAmt : 0,
                upiAmount: targetPaymentMethod === 'UPI' ? recAmt : 0,
                chequeAmount: targetPaymentMethod === 'Cheque' ? recAmt : 0,
                outstandingAmount: Math.max(0, netAmt - lc - recAmt),
              };
            }
          }
        } else if (filterRule === 'DIFF_ZERO_UNPAID') {
          if ((recAmt + lc >= netAmt - 1) && curMode !== 'Paid') {
            isMatch = true;
            if (isWriteIntent) {
              patchChanges = {
                paymentMode: 'Paid',
                paymentMethod: targetPaymentMethod || 'Cash',
                paymentDate: targetDate || todayDMY,
                collectedAmount: Math.max(recAmt, netAmt - lc),
                cashAmount: (targetPaymentMethod === 'Cash' || !targetPaymentMethod) ? Math.max(recAmt, netAmt - lc) : 0,
                outstandingAmount: 0,
              };
            }
          }
        } else {
          // Custom search
          const searchStr = `${b.billNo} ${b.partyName} ${b.driverName} ${b.salespersonName} ${curMode}`.toLowerCase();
          const keywords = userPrompt.toLowerCase().replace(/karo|set|update|badlo|dikhao|batao|sab|me|status|bill|bills/g, ' ').split(/\s+/).filter(w => w.length > 2);

          let keywordMatch = false;
          if (searchKeyword && searchStr.includes(searchKeyword.toLowerCase())) {
            keywordMatch = true;
          } else if (keywords.length > 0 && keywords.some(k => searchStr.includes(k))) {
            keywordMatch = true;
          } else if (isWriteIntent && keywords.length === 0) {
            if (curMode !== 'Paid') keywordMatch = true;
          }

          if (keywordMatch) {
            isMatch = true;
            if (isWriteIntent && targetPaymentMode) {
              const effectiveNet = Math.max(0, netAmt - lc);
              if (targetPaymentMode === 'Paid') {
                const method = targetPaymentMethod || 'Cash';
                patchChanges = {
                  paymentMode: 'Paid',
                  paymentMethod: method,
                  paymentDate: targetDate || todayDMY,
                  collectedAmount: effectiveNet,
                  outstandingAmount: 0,
                  cashAmount: method === 'Cash' ? effectiveNet : 0,
                  upiAmount: method === 'UPI' ? effectiveNet : 0,
                  chequeAmount: method === 'Cheque' ? effectiveNet : 0,
                };
              } else if (targetPaymentMode === 'FBR') {
                patchChanges = {
                  paymentMode: 'FBR',
                  paymentMethod: 'FBR',
                  paymentDate: targetDate || todayDMY,
                  discrepancyReason: discrepancyReason || 'Goods Return / FBR',
                  collectedAmount: 0,
                  cashAmount: 0,
                  upiAmount: 0,
                  chequeAmount: 0,
                  outstandingAmount: 0,
                };
              } else if (targetPaymentMode === 'Del Pending' || targetPaymentMode === 'Credit') {
                patchChanges = {
                  paymentMode: targetPaymentMode === 'Del Pending' ? 'Del Pending' : 'Credit',
                  deliveryDate: targetDate || todayDMY,
                  collectedAmount: 0,
                  outstandingAmount: effectiveNet,
                };
              }
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
            collectedAmount: patchChanges.collectedAmount !== undefined ? patchChanges.collectedAmount : recAmt,
            lineCutAmt: lc,
            diff,
            currentStatus: curMode,
            proposedStatus: patchChanges.paymentMode || curMode,
            proposedMethod: patchChanges.paymentMethod || b.paymentMethod || '-',
            proposedDate: patchChanges.paymentDate || patchChanges.deliveryDate || b.paymentDate || b.deliveryDate || '-',
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
    }

    if (!aiExplanation) {
      if (hasXlsBills) {
        aiExplanation = `Uploaded XLS file me se ${inputBillNos.length} Bill Numbers mile, jisme se ${matchedBills.length} bills database me match hue. Target: '${targetPaymentMode || 'Paid'}' (${targetPaymentMethod || 'Cash'}), Date: ${targetDate || todayDMY}.`;
      } else if (filterRule === 'REC_AMT_WITH_FBR') {
        aiExplanation = `Ese ${matchedBills.length} bills mile jisme Collected Amount (> 0) hai par status FBR/Cancel show ho raha hai.`;
      } else if (filterRule === 'DIFF_ZERO_UNPAID') {
        aiExplanation = `Ese ${matchedBills.length} bills mile jinka Collected Amount + Line Cut total Net Amount ke barabar hai (Diff = 0), par status Paid nahi hai.`;
      } else {
        aiExplanation = `Aapke prompt ke mutabiq ${matchedBills.length} bills match hue.`;
      }
    }

    const proposedActionText = isWriteIntent && patches.length > 0
      ? `${patches.length} bills ka status '${targetPaymentMode || 'Paid'}' (${targetPaymentMethod || 'Cash'}), Rec Date: '${targetDate || todayDMY}', Cash/Collection Amount = Net Amount update karne ka proposal tayar hai.`
      : `Filter result (${matchedBills.length} bills found).`;

    return res.json({
      ok: true,
      explanation: aiExplanation,
      matchedCount: matchedBills.length,
      unmatchedCount: unmatchedBillNos.length,
      unmatchedBillNos,
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
