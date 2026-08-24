import { useEffect, useState } from 'react';
import { apiFetchAllData } from '@/lib/apiSync';

type TableResult = {
  table: string;
  count: number | null;
  error: string | null;
  latencyMs: number;
};

type DiagState = {
  status: 'idle' | 'running' | 'done';
  apiReachable: boolean | null;
  apiMs: number | null;
  apiError: string | null;
  tables: TableResult[];
  overallError: string | null;
};

const TABLES = ['bills', 'drivers', 'banks', 'contacts', 'driver_summaries', 'settings'];

async function runDiagnostics(): Promise<Omit<DiagState, 'status'>> {
  let apiReachable: boolean | null = null;
  let apiMs: number | null = null;
  let apiError: string | null = null;
  const tables: TableResult[] = [];

  const t0 = Date.now();
  try {
    const data = await apiFetchAllData();
    apiMs = Date.now() - t0;

    const hasBills = Array.isArray(data.bills);
    apiReachable = hasBills;

    if (hasBills) {
      const countMap: Record<string, number> = {
        bills: data.bills?.length ?? 0,
        drivers: data.drivers?.length ?? 0,
        banks: data.banks?.length ?? 0,
        contacts: (data.partyContacts?.length ?? 0) + (data.salespersonContacts?.length ?? 0),
        driver_summaries: data.summaries?.length ?? 0,
        settings: Object.keys(data.settings ?? {}).length,
      };
      for (const table of TABLES) {
        tables.push({ table, count: countMap[table] ?? 0, error: null, latencyMs: apiMs ?? 0 });
      }
    } else {
      apiReachable = false;
      apiError = 'apiFetchAllData returned empty/invalid data';
      for (const table of TABLES) {
        tables.push({ table, count: null, error: 'No data', latencyMs: 0 });
      }
    }
  } catch (e: unknown) {
    apiMs = Date.now() - t0;
    apiReachable = false;
    apiError = String(e);
    for (const table of TABLES) {
      tables.push({ table, count: null, error: String(e), latencyMs: 0 });
    }
  }

  return { apiReachable, apiMs, apiError, tables, overallError: null };
}

export default function DiagnosticsPage() {
  const [state, setState] = useState<DiagState>({
    status: 'idle',
    apiReachable: null,
    apiMs: null,
    apiError: null,
    tables: [],
    overallError: null,
  });

  const run = async () => {
    setState(s => ({ ...s, status: 'running' }));
    try {
      const result = await runDiagnostics();
      setState({ ...result, status: 'done' });
    } catch (e: unknown) {
      setState(s => ({ ...s, status: 'done', overallError: String(e) }));
    }
  };

  useEffect(() => { run(); }, []);

  const billsRow = state.tables.find(t => t.table === 'bills');
  const billsEmpty = billsRow && billsRow.count === 0 && !billsRow.error;

  return (
    <div style={{ fontFamily: 'monospace', padding: 24, maxWidth: 900, margin: '0 auto', color: '#e2e8f0', background: '#0f172a', minHeight: '100vh' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <span style={{ fontSize: 28 }}>🔍</span>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#a5b4fc', margin: 0 }}>VitraTrack — Diagnostics</h1>
        <button
          onClick={run}
          disabled={state.status === 'running'}
          style={{ marginLeft: 'auto', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 16px', cursor: 'pointer', fontWeight: 600 }}
        >
          {state.status === 'running' ? '⏳ Running...' : '🔄 Re-run'}
        </button>
        <a href="/" style={{ background: '#1e293b', color: '#94a3b8', border: 'none', borderRadius: 6, padding: '6px 16px', textDecoration: 'none', fontWeight: 600 }}>← App</a>
      </div>

      <Section title="🔗 Supabase Connection">
        <Row label="Backend" value="Supabase (direct client)" />
        <Row label="Connection test" value={
          state.status === 'running' ? '⏳ testing...' :
          state.apiReachable === true ? `✅ OK (${state.apiMs}ms)` :
          state.apiReachable === false ? `❌ FAILED — ${state.apiError}` : '...'
        } alert={state.apiReachable === false} />
      </Section>

      <Section title="📊 Table Row Counts">
        {state.status === 'running' && state.tables.length === 0 && (
          <div style={{ color: '#94a3b8', padding: 8 }}>⏳ Querying tables...</div>
        )}
        {state.tables.map(t => (
          <div key={t.table} style={{ display: 'flex', gap: 12, padding: '6px 0', borderBottom: '1px solid #1e293b', alignItems: 'flex-start' }}>
            <span style={{ width: 160, color: '#94a3b8', flexShrink: 0 }}>{t.table}</span>
            <span style={{ color: t.error ? '#f87171' : t.count === 0 ? '#fbbf24' : '#4ade80', fontWeight: 700, flexShrink: 0 }}>
              {t.error ? `❌ ERROR` : t.count === null ? '⏳' : `✅ ${t.count} rows`}
            </span>
            <span style={{ color: '#64748b', fontSize: 12, flexShrink: 0 }}>{t.latencyMs}ms</span>
            {t.error && <span style={{ color: '#f87171', fontSize: 12, wordBreak: 'break-all' }}>{t.error}</span>}
          </div>
        ))}
      </Section>

      {billsEmpty && (
        <div style={{ background: '#7c2d12', border: '1px solid #ef4444', borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <div style={{ color: '#fca5a5', fontWeight: 700, fontSize: 15, marginBottom: 8 }}>⚠️ BILLS TABLE IS EMPTY</div>
          <div style={{ color: '#fcd34d', fontSize: 13, lineHeight: 1.8 }}>
            The bills table is empty. Import bills via the Settings page.
          </div>
        </div>
      )}

      {state.overallError && (
        <Section title="❌ Overall Error">
          <div style={{ color: '#f87171', wordBreak: 'break-all' }}>{state.overallError}</div>
        </Section>
      )}

      {state.status === 'done' && !state.overallError && (
        <div style={{ color: '#4ade80', fontSize: 13, marginTop: 8 }}>
          ✅ Diagnostics complete.
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16, border: '1px solid #334155' }}>
      <div style={{ color: '#a5b4fc', fontWeight: 700, marginBottom: 10, fontSize: 14 }}>{title}</div>
      {children}
    </div>
  );
}

function Row({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '5px 0', borderBottom: '1px solid #0f172a', flexWrap: 'wrap' }}>
      <span style={{ width: 240, color: '#64748b', flexShrink: 0, fontSize: 13 }}>{label}</span>
      <span style={{ color: alert ? '#f87171' : '#e2e8f0', fontSize: 13, wordBreak: 'break-all' }}>{value}</span>
    </div>
  );
}
