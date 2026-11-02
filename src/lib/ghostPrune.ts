import type { Bill } from './billStore';

/**
 * Prune stale local-only bills during full sync.
 *
 * A bill that exists only on this device is kept ONLY while it may still be
 * genuinely unsaved: it is dirty-pending right now, or it was created/edited
 * locally within GHOST_GRACE_MS (24h). Anything older is a stale ghost — a bill
 * deleted or merged away in the cloud — and must be dropped so bill counts,
 * totals and bill-number search always match the real database.
 */
export const GHOST_GRACE_MS = 24 * 3600 * 1000;

export function filterPendingLocalOnlyBills(
  currentLocalBills: Bill[],
  fetchedKeys: Set<string>,
  getBillKey: (b: { id?: string; billNo?: string; collectionCode?: string; salespersonName?: string }) => string,
  isDirtyPendingFn: (id?: string, billNo?: string) => boolean,
  nowMs: number = Date.now(),
): Bill[] {
  return currentLocalBills.filter(b => {
    if (fetchedKeys.has(getBillKey(b))) return false;
    if (isDirtyPendingFn(b.id, b.billNo)) return true;
    const localTs = Date.parse(b.updatedAt || '');
    return !isNaN(localTs) && localTs > 0 && (nowMs - localTs) < GHOST_GRACE_MS;
  });
}
