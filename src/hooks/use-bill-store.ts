import { useEffect, useSyncExternalStore } from 'react';
import { getBills, getDrivers, getBanks, getSummaries, getPartyContacts, getSalespersonContacts, setServerData, applyRealtimeBillChange, applyRealtimeTableChange, Bill, Driver, Bank, DriverDailySummary } from '@/lib/billStore';
import { apiFetchAllData, mapBillFromSupabase } from '@/lib/apiSync';
import { supabase } from '@/lib/supabase';
import { isWriteInProgress, getLastWriteAt } from '@/lib/syncState';
import { applyDirtyPatches, isDirtyPending, flushDirtyQueue } from '@/lib/localQueue';

// ─── Global singleton ─────────────────────────────────────────────────────
// Polling + Supabase Realtime WebSocket + BroadcastChannel multi-tab
// guarantees instant real-time live sync across all devices.

const POLL_INTERVAL_MS = 60_000;

export type StoreSnapshot = {
  bills: Bill[];
  drivers: Driver[];
  banks: Bank[];
  summaries: DriverDailySummary[];
  loading: boolean;
  syncing: boolean;
};

const initialBills = typeof window !== 'undefined' ? getBills() : [];
const initialDrivers = typeof window !== 'undefined' ? getDrivers() : [];
const initialBanks = typeof window !== 'undefined' ? getBanks() : [];
const initialSummaries = typeof window !== 'undefined' ? getSummaries() : [];

let currentSnapshot: StoreSnapshot = {
  bills: initialBills,
  drivers: initialDrivers,
  banks: initialBanks,
  summaries: initialSummaries,
  loading: initialBills.length === 0,
  syncing: false,
};

let serverVersion = 0;
const subs = new Set<() => void>();
let pollingTimer: ReturnType<typeof setInterval> | null = null;
let syncInFlight = false;
let initialized = false;
let fullSyncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let notifyScheduled = false;

function notify() {
  if (notifyScheduled) return;
  notifyScheduled = true;
  queueMicrotask(() => {
    notifyScheduled = false;
    subs.forEach(fn => {
      try { fn(); } catch (err) { console.warn('[useBillStore] subscriber error:', err); }
    });
  });
}

function patch(delta: Partial<StoreSnapshot>) {
  let hasChange = false;
  for (const k in delta) {
    const key = k as keyof StoreSnapshot;
    if (currentSnapshot[key] !== delta[key]) {
      hasChange = true;
      break;
    }
  }
  if (!hasChange) return;
  currentSnapshot = { ...currentSnapshot, ...delta };
  notify();
}

function readLocal() {
  patch({
    bills: getBills(),
    drivers: getDrivers(),
    banks: getBanks(),
    summaries: getSummaries(),
    loading: false,
  });
}

function scheduleDebouncedFullSync(delayMs = 1500) {
  if (fullSyncDebounceTimer) clearTimeout(fullSyncDebounceTimer);
  fullSyncDebounceTimer = setTimeout(() => {
    doFullSync();
  }, delayMs);
}

async function doFullSync() {
  if (syncInFlight) return;
  // If a local write operation is currently in-flight or occurred in the last 2.5s, skip full refresh
  if (isWriteInProgress() || (Date.now() - getLastWriteAt() < 2500)) {
    return;
  }
  syncInFlight = true;
  patch({ syncing: true });
  try {
    const data = await apiFetchAllData();
    // 1. Merge any un-flushed local dirty patches on top of bills fetched from Supabase
    const patchedBills = applyDirtyPatches(data?.bills || []);

    // 2. Preserve local bills & field values that are newer or not yet in Supabase
    const currentLocalBills = getBills();
    const getBillKey = (b: { id?: string; billNo?: string; collectionCode?: string; salespersonName?: string }) => {
      const isMoc = (b.billNo || '').toUpperCase().startsWith('MOC') || b.collectionCode === 'MOC' || b.salespersonName === 'MOC';
      return isMoc ? (b.id || b.billNo || '') : (b.billNo || b.id || '').trim().toUpperCase();
    };
    const localMap = new Map(currentLocalBills.map(b => [getBillKey(b), b]));

    const mergedBills = patchedBills.map(sBill => {
      const lBill = localMap.get(getBillKey(sBill));
      if (!lBill) return sBill;

      // If local bill has any pending writes in dirty queue, preserve local bill completely
      if (isDirtyPending(lBill.id, lBill.billNo) || isDirtyPending(sBill.id, sBill.billNo)) {
        return { ...sBill, ...lBill };
      }

      // Check edit history length: if local has more edits, preserve local version
      const lHistLen = lBill.editHistory?.length || 0;
      const sHistLen = sBill.editHistory?.length || 0;
      if (lHistLen > sHistLen) {
        return { ...sBill, ...lBill };
      }

      // If local bill has payment data and server lacks it, keep local
      const lHasPayment = (lBill.collectedAmount || 0) > 0 || !!lBill.paymentDate || (!!lBill.paymentMode && lBill.paymentMode !== 'Unpaid');
      const sHasPayment = (sBill.collectedAmount || 0) > 0 || !!sBill.paymentDate || (!!sBill.paymentMode && sBill.paymentMode !== 'Unpaid');
      if (lHasPayment && !sHasPayment) {
        return { ...sBill, ...lBill };
      }

      // Merge specific non-empty local fields if server version is missing them
      const merged: Bill = {
        ...sBill,
        chequeNo: sBill.chequeNo || lBill.chequeNo || '',
        bankName: sBill.bankName || lBill.bankName || '',
        chequeDate: sBill.chequeDate || lBill.chequeDate || '',
        driverName: sBill.driverName || lBill.driverName || '',
        lineCutAmt: sBill.lineCutAmt != null ? sBill.lineCutAmt : lBill.lineCutAmt,
        cancelLine: sBill.cancelLine || lBill.cancelLine || '',
        discrepancyReason: sBill.discrepancyReason || lBill.discrepancyReason || '',
      };

      if ((lBill.partPayments?.length || 0) > (sBill.partPayments?.length || 0)) {
        merged.partPayments = lBill.partPayments;
      }

      return merged;
    });

    const fetchedKeys = new Set(mergedBills.map(b => getBillKey(b)));
    const pendingNewBills = currentLocalBills.filter(b => !fetchedKeys.has(getBillKey(b)));
    const finalBills = [...mergedBills, ...pendingNewBills];

    // 3. Preserve any recently created local drivers not yet in Supabase
    const currentLocalDrivers = getDrivers();
    const fetchedDriverNames = new Set((data?.drivers || []).map(d => (d?.name || '').toLowerCase().trim()).filter(Boolean));
    const pendingNewDrivers = currentLocalDrivers.filter(d => (d?.name || '').trim() && !fetchedDriverNames.has((d.name || '').toLowerCase().trim()));
    const mergedDrivers = [...(data?.drivers || []), ...pendingNewDrivers];

    // 4. Preserve any recently created local banks not yet in Supabase
    const currentLocalBanks = getBanks();
    const fetchedBankNames = new Set((data?.banks || []).map(b => (b?.name || '').toLowerCase().trim()).filter(Boolean));
    const pendingNewBanks = currentLocalBanks.filter(b => (b?.name || '').trim() && !fetchedBankNames.has((b.name || '').toLowerCase().trim()));
    const mergedBanks = [...(data?.banks || []), ...pendingNewBanks];

    // 5. Preserve any local summaries not yet in Supabase
    const currentLocalSummaries = getSummaries();
    const fetchedSummaryIds = new Set((data?.summaries || []).map(s => s?.id).filter(Boolean));
    const pendingNewSummaries = currentLocalSummaries.filter(s => s?.id && !fetchedSummaryIds.has(s.id));
    const mergedSummaries = [...(data?.summaries || []), ...pendingNewSummaries];

    // 6. Preserve any local party & salesperson contacts with mobile numbers
    const currentLocalParty = getPartyContacts();
    const currentLocalSales = getSalespersonContacts();

    setServerData({
      bills: finalBills,
      drivers: mergedDrivers,
      banks: mergedBanks,
      summaries: mergedSummaries,
      partyContacts: data?.partyContacts || currentLocalParty,
      salespersonContacts: data?.salespersonContacts || currentLocalSales,
      settings: data?.settings,
    });
    window.dispatchEvent(new CustomEvent('sync-status', { detail: 'ok' }));
    readLocal();
  } catch {
    window.dispatchEvent(new CustomEvent('sync-status', { detail: 'error' }));
  } finally {
    syncInFlight = false;
    patch({ syncing: false });
  }
}

// ─── Direct Supabase Realtime Subscription ──────────────────────────────────
let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;
let realtimeReconnectTimer: ReturnType<typeof setTimeout> | null = null;

function initSupabaseRealtime() {
  if (!supabase) return;
  if (realtimeChannel) {
    try { supabase.removeChannel(realtimeChannel); } catch {}
    realtimeChannel = null;
  }

  try {
    realtimeChannel = supabase
      .channel('vitratrack_realtime_all')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bills' },
        (payload) => {
          const eventType = payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE';
          const newRow = payload.new as Record<string, unknown> | null;
          const oldRow = payload.old as Record<string, unknown> | null;

          if (eventType === 'DELETE') {
            const oldId = String(oldRow?.id || '');
            const oldBillNo = String(oldRow?.bill_no || oldRow?.billNo || '');
            applyRealtimeBillChange('DELETE', undefined, oldId, oldBillNo);
          } else if (newRow && typeof newRow === 'object') {
            const mapped = mapBillFromSupabase(newRow);
            applyRealtimeBillChange(eventType, mapped);
          }

          readLocal();
          window.dispatchEvent(new CustomEvent('sync-status', { detail: 'ok' }));
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'drivers' },
        (payload) => {
          applyRealtimeTableChange('drivers', payload.eventType as any, payload.new, payload.old);
          readLocal();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'banks' },
        (payload) => {
          applyRealtimeTableChange('banks', payload.eventType as any, payload.new, payload.old);
          readLocal();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'contacts' },
        (payload) => {
          applyRealtimeTableChange('contacts', payload.eventType as any, payload.new, payload.old);
          readLocal();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'settings' },
        (payload) => {
          applyRealtimeTableChange('settings', payload.eventType as any, payload.new, payload.old);
          readLocal();
        }
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Supabase Realtime] Connected and listening live across all devices.');
          window.dispatchEvent(new CustomEvent('sync-status', { detail: 'ok' }));
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[Supabase Realtime] Channel status:', status, err);
          if (navigator.onLine && !realtimeReconnectTimer) {
            realtimeReconnectTimer = setTimeout(() => {
              realtimeReconnectTimer = null;
              initSupabaseRealtime();
            }, 10000);
          }
        }
      });
  } catch (err) {
    console.warn('[Supabase Realtime] Setup error:', err);
  }
}

// ─── BroadcastChannel for Multi-tab Local Sync ──────────────────────────────
const syncChannel = typeof window !== 'undefined' && 'BroadcastChannel' in window
  ? new BroadcastChannel('vitratrack_sync')
  : null;

if (syncChannel) {
  syncChannel.onmessage = (event) => {
    if (event.data === 'data-updated') {
      readLocal();
    }
  };
}

function initGlobalSync() {
  if (initialized) return;
  initialized = true;

  // Hydrate local cache into state immediately on boot before network fetch
  readLocal();

  window.addEventListener('bill-store-update', () => {
    readLocal();
    if (syncChannel) {
      try { syncChannel.postMessage('data-updated'); } catch { /* ignore */ }
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      doFullSync();
      initSupabaseRealtime();
    }
  });
  window.addEventListener('focus', () => {
    doFullSync();
  });
  window.addEventListener('online', () => {
    flushDirtyQueue();
    doFullSync();
    initSupabaseRealtime();
  });

  // Emergency local persistence & dirty queue flush on unload/close
  window.addEventListener('beforeunload', () => {
    import('@/lib/billStore').then(m => m.persistLocalState());
    flushDirtyQueue();
  });
  window.addEventListener('pagehide', () => {
    import('@/lib/billStore').then(m => m.persistLocalState());
    flushDirtyQueue();
  });

  // Background dirty queue flush every 10 seconds
  setInterval(() => {
    flushDirtyQueue();
  }, 10000);

  // Initial full load from Supabase
  doFullSync();
  pollingTimer = setInterval(doFullSync, POLL_INTERVAL_MS);
  initSupabaseRealtime();
}

function subscribe(callback: () => void) {
  subs.add(callback);
  return () => {
    subs.delete(callback);
  };
}

function getSnapshot(): StoreSnapshot {
  return currentSnapshot;
}

function getServerSnapshot(): StoreSnapshot {
  return currentSnapshot;
}

// ─── React hook ───────────────────────────────────────────────────────────
export function useBillStore() {
  useEffect(() => {
    initGlobalSync();
  }, []);

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return {
    bills: snapshot.bills,
    drivers: snapshot.drivers,
    banks: snapshot.banks,
    summaries: snapshot.summaries,
    loading: snapshot.loading,
    syncing: snapshot.syncing,
    refresh: readLocal,
    syncFromApi: () => { serverVersion = 0; doFullSync(); },
  };
}
