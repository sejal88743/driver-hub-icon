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
  const now = Date.now();
  // Entries older than 3 minutes (180s) expire and must not permanently block incoming cross-device updates
  return readDirtyQueue().some(e =>
    (now - (e.ts || 0) < 180_000) &&
    ((!!id && !!e.id && e.id === id) ||
     (!!billNo && !!e.billNo && e.billNo === billNo))
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

// ─── Flush all pending patches to Supabase in parallel chunks / bulk upsert ──
let isFlushing = false;

export async function flushDirtyQueue(): Promise<{ flushed: number; remaining: number }> {
  if (isFlushing) {
    return { flushed: 0, remaining: getDirtyCount() };
  }
  const list = readDirtyQueue();
  if (list.length === 0) return { flushed: 0, remaining: 0 };

  isFlushing = true;
  const [syncMod, apiMod, billStoreMod] = await Promise.all([
    import('./syncState'),
    import('./apiSync'),
    import('./billStore'),
  ]);

  syncMod.markWriteStart();
  const remain: DirtyEntry[] = [];
  let flushed = 0;

  try {
    const allBills = billStoreMod.getBills();
    const billMap = new Map(allBills.map(b => [b.id, b]));
    const billNoMap = new Map(allBills.map(b => [(b.billNo || '').trim().toUpperCase(), b]));

    const billsToUpsert: Bill[] = [];
    const entriesWithoutBillObj: DirtyEntry[] = [];

    for (const entry of list) {
      let b = entry.id ? billMap.get(entry.id) : undefined;
      if (!b && entry.billNo) {
        b = billNoMap.get(entry.billNo.trim().toUpperCase());
      }
      if (b) {
        billsToUpsert.push({ ...b, ...entry.patch });
      } else {
        entriesWithoutBillObj.push(entry);
      }
    }

    if (billsToUpsert.length > 0) {
      const res = await apiMod.apiBulkUpsertBills(billsToUpsert);
      if (res.count > 0) {
        flushed += billsToUpsert.length;
      } else {
        for (const entry of list) {
          try {
            const r = await apiMod.apiPatchBill(entry.id, entry.patch, entry.billNo);
            if (r.ok) flushed++;
            else remain.push(entry);
          } catch {
            remain.push(entry);
          }
        }
      }
    }

    for (const entry of entriesWithoutBillObj) {
      try {
        const r = await apiMod.apiPatchBill(entry.id, entry.patch, entry.billNo);
        if (r.ok) flushed++;
        else remain.push(entry);
      } catch {
        remain.push(entry);
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
