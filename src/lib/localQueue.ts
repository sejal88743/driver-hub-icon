/**
 * Local-first dirty write queue with instant parallel sync.
 *
 * Actions update in-memory state instantly for 0ms UI latency, while direct
 * Supabase calls sync the data immediately to the cloud.
 */

import type { Bill } from './billStore';

export const DIRTY_KEY = 'vt_dirty_queue_v2';

export type DirtyEntry = {
  id: string;        // bill UUID — primary dedup key
  billNo?: string;   // bill number  — fallback dedup key
  patch: Partial<Bill>;
  ts: number;        // ms timestamp of last enqueue (for debug / ordering)
};

// ─── localStorage I/O ─────────────────────────────────────────────────────────
export function readDirtyQueue(): DirtyEntry[] {
  try { return JSON.parse(localStorage.getItem(DIRTY_KEY) || '[]'); } catch { return []; }
}

function writeDirtyQueue(list: DirtyEntry[]) {
  try { localStorage.setItem(DIRTY_KEY, JSON.stringify(list.slice(-2000))); } catch { /* quota */ }
}

function broadcast(count: number) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('dirty-queue-count', { detail: count }));
  }
}

// ─── Enqueue a single patch ────────────────────────────────────────────────────
export function enqueueDirty(id: string, patch: Partial<Bill>, billNo?: string) {
  const list = readDirtyQueue();
  const idx = list.findIndex(e =>
    (id && e.id && e.id === id) ||
    (billNo && e.billNo && e.billNo === billNo)
  );
  if (idx >= 0) {
    // Merge: newer field values win
    list[idx] = {
      ...list[idx],
      id: id || list[idx].id,
      billNo: billNo || list[idx].billNo,
      patch: { ...list[idx].patch, ...patch },
      ts: Date.now(),
    };
  } else {
    list.push({ id, billNo, patch, ts: Date.now() });
  }
  writeDirtyQueue(list);
  broadcast(list.length);
}

// ─── Remove single patch on confirmed save ────────────────────────────────────
export function removeDirtyEntry(id?: string, billNo?: string) {
  if (!id && !billNo) return;
  const list = readDirtyQueue();
  const filtered = list.filter(e => !(
    (id && e.id === id) ||
    (billNo && e.billNo === billNo)
  ));
  if (filtered.length !== list.length) {
    writeDirtyQueue(filtered);
    broadcast(filtered.length);
  }
}

// ─── Enqueue multiple patches at once ─────────────────────────────────────────
export function enqueueDirtyBatch(
  entries: Array<{ id: string; patch: Partial<Bill>; billNo?: string }>,
) {
  if (entries.length === 0) return;
  const list = readDirtyQueue();
  for (const { id, patch, billNo } of entries) {
    const idx = list.findIndex(e =>
      (id && e.id && e.id === id) ||
      (billNo && e.billNo && e.billNo === billNo)
    );
    if (idx >= 0) {
      list[idx] = {
        ...list[idx],
        id: id || list[idx].id,
        billNo: billNo || list[idx].billNo,
        patch: { ...list[idx].patch, ...patch },
        ts: Date.now(),
      };
    } else {
      list.push({ id, billNo, patch, ts: Date.now() });
    }
  }
  writeDirtyQueue(list);
  broadcast(list.length);
}

// ─── Pending count ─────────────────────────────────────────────────────────────
export function getDirtyCount(): number {
  return readDirtyQueue().length;
}

// ─── Is a specific bill still un-flushed (i.e. NOT confirmed in Supabase)? ─────
export function isDirtyPending(id?: string, billNo?: string): boolean {
  if (!id && !billNo) return false;
  return readDirtyQueue().some(e =>
    (!!id && !!e.id && e.id === id) ||
    (!!billNo && !!e.billNo && e.billNo === billNo)
  );
}

// ─── Apply queued patches on top of a freshly synced bills array ──────────────
export function applyDirtyPatches(bills: Bill[]): Bill[] {
  const queue = readDirtyQueue();
  if (queue.length === 0) return bills;

  // Build O(1) lookup maps from the queue
  const byId     = new Map<string, Partial<Bill>>();
  const byBillNo = new Map<string, Partial<Bill>>();
  for (const entry of queue) {
    if (entry.id)     byId.set(entry.id,         { ...byId.get(entry.id),         ...entry.patch });
    if (entry.billNo) byBillNo.set(entry.billNo,  { ...byBillNo.get(entry.billNo), ...entry.patch });
  }

  return bills.map(b => {
    const p = byId.get(b.id) ?? byBillNo.get(b.billNo);
    return p ? { ...b, ...p } : b;
  });
}

// ─── Flush all pending patches to Supabase in parallel chunks ─────────────────
let isFlushing = false;

export async function flushDirtyQueue(): Promise<{ flushed: number; remaining: number }> {
  if (isFlushing) {
    return { flushed: 0, remaining: getDirtyCount() };
  }
  const list = readDirtyQueue();
  if (list.length === 0) return { flushed: 0, remaining: 0 };

  isFlushing = true;
  // Dynamic imports avoid circular deps
  const [syncMod, apiMod] = await Promise.all([
    import('./syncState'),
    import('./apiSync'),
  ]);

  syncMod.markWriteStart();
  const remain: DirtyEntry[] = [];
  let flushed = 0;

  try {
    // Process in parallel batches of 5 for speed without overwhelming network
    const BATCH_SIZE = 5;
    for (let i = 0; i < list.length; i += BATCH_SIZE) {
      const batch = list.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (entry) => {
          try {
            const res = await apiMod.apiPatchBill(entry.id, entry.patch, entry.billNo);
            return { entry, ok: !!res.ok };
          } catch {
            return { entry, ok: false };
          }
        })
      );

      for (const r of results) {
        if (r.ok) {
          flushed++;
        } else {
          remain.push(r.entry);
        }
      }
    }
  } finally {
    writeDirtyQueue(remain);
    broadcast(remain.length);
    syncMod.markWriteEnd();
    isFlushing = false;
  }

  if (flushed > 0 && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sync-status', { detail: 'ok' }));
  }

  return { flushed, remaining: remain.length };
}
