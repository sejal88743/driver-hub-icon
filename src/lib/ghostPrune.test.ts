// Test: full sync must drop stale local-only ghost bills (deleted/merged in the
// cloud), keeping only dirty-pending or recently-created local bills.
import { filterPendingLocalOnlyBills, GHOST_GRACE_MS } from './ghostPrune';
import type { Bill } from './billStore';

const keyOf = (b: { billNo?: string }) => (b.billNo || '').trim().toUpperCase();
const notDirty = () => false;
const now = 1_800_000_000_000;

function b(billNo: string, updatedAtDaysAgo: number): Bill {
  return { id: `id_${billNo}`, billNo, updatedAt: new Date(now - updatedAtDaysAgo * 86400_000).toISOString() } as Bill;
}

const fetchedKeys = new Set(['GST1']);

const cases: Array<[string, Bill[], Bill[]]> = [
  ['ghost older than 24h is dropped', [b('GSTGHOST', 30)], []],
  ['fresh local bill (< 24h) is kept', [b('GSTNEW', 0.1)], [b('GSTNEW', 0.1)]],
  ['dirty-pending bill is kept regardless of age', [{ ...b('GSTOLD', 40) }], [{ ...b('GSTOLD', 40) }]],
  ['bill present in fetched set is never duplicated', [b('GST1', 0)], []],
  ['exact grace boundary (>= 24h) is dropped', [b('GSTEDGE', GHOST_GRACE_MS / 86400_000)], []],
];

let failed = 0;
for (const [name, local, expected] of cases) {
  const dirty = name.includes('dirty');
  const out = filterPendingLocalOnlyBills(local, fetchedKeys, keyOf as any, dirty ? () => true : notDirty, now);
  const ok = out.length === expected.length && out.every((x, i) => x.billNo === expected[i].billNo);
  if (!ok) { failed++; console.error('FAIL:', name, out); } else console.log('PASS:', name);
}
if (failed) { console.error(`${failed} test(s) failed`); process.exit(1); }
console.log('All ghostPrune tests passed');
