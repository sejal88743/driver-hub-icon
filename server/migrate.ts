import { pool } from './db.js';

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('[migrate] Running schema migration...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS bills (
        id text PRIMARY KEY,
        sr_no text NOT NULL DEFAULT '',
        date text NOT NULL DEFAULT '',
        salesperson_name text NOT NULL DEFAULT '',
        collection_code text NOT NULL DEFAULT '',
        bill_no text NOT NULL DEFAULT '',
        party_code text NOT NULL DEFAULT '',
        party_hul_code text NOT NULL DEFAULT '',
        party_name text NOT NULL DEFAULT '',
        beat_name text NOT NULL DEFAULT '',
        bill_net_amt real NOT NULL DEFAULT 0,
        collected_amount real NOT NULL DEFAULT 0,
        outstanding_amount real NOT NULL DEFAULT 0,
        bill_ageing real NOT NULL DEFAULT 0,
        payment_mode text,
        payment_method text,
        payment_date text,
        payment_time text,
        driver_name text,
        delivery_date text,
        cheque_no text,
        cheque_date text,
        bank_name text,
        next_bill_no text,
        cancel_line text,
        discrepancy_reason text,
        cash_amount real,
        upi_amount real,
        cheque_amount real,
        line_cut_amt real,
        updated_at timestamptz DEFAULT now()
      );
    `);
    await client.query(`ALTER TABLE bills ADD COLUMN IF NOT EXISTS line_cut_amt real;`);
    await client.query(`ALTER TABLE bills ADD COLUMN IF NOT EXISTS payment_method text;`);
    await client.query(`ALTER TABLE bills ADD COLUMN IF NOT EXISTS del_pending_history jsonb DEFAULT '[]'::jsonb;`);
    await client.query(`CREATE INDEX IF NOT EXISTS bills_bill_no_idx ON bills (bill_no);`);
    await client.query(`CREATE INDEX IF NOT EXISTS bills_driver_idx ON bills (driver_name);`);
    await client.query(`CREATE INDEX IF NOT EXISTS bills_delivery_idx ON bills (delivery_date);`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS drivers (
        id text PRIMARY KEY,
        name text NOT NULL
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS banks (
        id text PRIMARY KEY,
        name text NOT NULL
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS driver_summaries (
        id text PRIMARY KEY,
        driver_name text NOT NULL,
        date text NOT NULL,
        total_bill_count real NOT NULL DEFAULT 0,
        total_amount real NOT NULL DEFAULT 0,
        cash_breakdown jsonb
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key text PRIMARY KEY,
        value text NOT NULL
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS contacts (
        id text PRIMARY KEY,
        type text NOT NULL,
        name text NOT NULL,
        mobile text NOT NULL
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS contacts_type_idx ON contacts (type);`);

    console.log('[migrate] Schema migration complete.');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error('[migrate] Migration failed:', err);
  process.exit(1);
});
