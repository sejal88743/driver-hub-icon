/**
 * Local-first dirty write queue.
 *
 * Individual bill patches (patchBillInMemory / patchBillsInMemory) are stored
 * here immediately — zero network latency on every user action.
 *
 * A 5-minute timer in use-bill-store.ts flushes the entire queue to Supabase
 * in one efficient batch. On next app load, any un-flushed entries (e.g. from
 * a crash) are replayed first, before the full Supabase sync.
 *
 * Dedup / merge: if the same bill is patched N times before the flush, all
 * patches are merged field-by-field (last write wins). Only ONE Supabase call
 * per bill per flush cycle — no duplicates.
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
// Used by save flows so a success popup only appears after Supabase confirms.
export function isDirtyPending(id?: string, billNo?: string): boolean {
  if (!id && !billNo) return false;
  return readDirtyQueue().some(e =>
    (!!id && !!e.id && e.id === id) ||
    (!!billNo && !!e.billNo && e.billNo === billNo)
  );
}


// ─── Apply queued patches on top of a freshly synced bills array ──────────────
// Called in doFullSync so a full Supabase refresh never overwrites local writes
// that haven't been flushed yet.
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

// ─── Flush all pending patches to Supabase ────────────────────────────────────
// Successful entries are removed from the queue.
// Failed entries stay and will retry on the next flush.
export async function flushDirtyQueue(): Promise<{ flushed: number; remaining: number }> {
  const list = readDirtyQueue();
  if (list.length === 0) return { flushed: 0, remaining: 0 };

  // Dynamic imports avoid circular deps
  const [syncMod, apiMod] = await Promise.all([
    import('./syncState'),
    import('./apiSync'),
  ]);

  syncMod.markWriteStart();
  const remain: DirtyEntry[] = [];
  let flushed = 0;

  try {
    for (const entry of list) {
      try {
        const res = await apiMod.apiPatchBill(entry.id, entry.patch, entry.billNo);
        if (res.ok) flushed++;
        else remain.push(entry);
      } catch {
        remain.push(entry);
      }
    }
  } finally {
    writeDirtyQueue(remain);
    broadcast(remain.length);
    syncMod.markWriteEnd();
  }

  if (flushed > 0 && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sync-status', { detail: 'ok' }));
    console.log(`[localQueue] Flushed ${flushed} patch(es) to Supabase (${remain.length} remaining)`);
  }

  return { flushed, remaining: remain.length };
}
