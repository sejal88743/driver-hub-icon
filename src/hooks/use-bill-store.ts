import { useState, useEffect } from 'react';
import { getBills, getDrivers, getBanks, getSummaries, setServerData, Bill, Driver, Bank, DriverDailySummary } from '@/lib/billStore';
import { apiFetchAllData, flushPendingWrites } from '@/lib/apiSync';
import { supabase } from '@/lib/supabase';
import { isWriteInProgress, getLastWriteAt } from '@/lib/syncState';
import { applyDirtyPatches, isDirtyPending, flushDirtyQueue } from '@/lib/localQueue';

// ─── Global singleton ─────────────────────────────────────────────────────
// Polling + Supabase Realtime WebSocket + BroadcastChannel multi-tab
// guarantees instant real-time live sync across all devices.

const POLL_INTERVAL_MS = 60_000;

type StoreState = {
  bills: Bill[];
  drivers: Driver[];
  banks: Bank[];
  summaries: DriverDailySummary[];
  loading: boolean;
  syncing: boolean;
};

let g: StoreState = {
  bills: [], drivers: [], banks: [], summaries: [],
  loading: true, syncing: false,
};

let serverVersion = 0;
const subs = new Set<() => void>();
let pollingTimer: ReturnType<typeof setInterval> | null = null;
let syncInFlight = false;
let initialized = false;

function notify() { subs.forEach(fn => fn()); }

function patch(delta: Partial<StoreState>) {
  g = { ...g, ...delta };
  notify();
}

function readLocal() {
  patch({
    bills: [...getBills()],
    drivers: [...getDrivers()],
    banks: [...getBanks()],
    summaries: [...getSummaries()],
    loading: false,
  });
}

async function doFullSync() {
  if (syncInFlight) return;
  // If a local write operation is currently in-flight or occurred in the last 5s, skip full refresh
  if (isWriteInProgress() || (Date.now() - getLastWriteAt() < 5000)) {
    return;
  }
  syncInFlight = true;
  patch({ syncing: true });
  try {
    const data = await apiFetchAllData();
    // 1. Merge any un-flushed local dirty patches on top of bills fetched from Supabase
    const patchedBills = applyDirtyPatches(data.bills);

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
    const fetchedDriverNames = new Set(data.drivers.map(d => d.name.toLowerCase().trim()));
    const pendingNewDrivers = currentLocalDrivers.filter(d => !fetchedDriverNames.has(d.name.toLowerCase().trim()));
    const mergedDrivers = [...data.drivers, ...pendingNewDrivers];

    // 4. Preserve any recently created local banks not yet in Supabase
    const currentLocalBanks = getBanks();
    const fetchedBankNames = new Set(data.banks.map(b => b.name.toLowerCase().trim()));
    const pendingNewBanks = currentLocalBanks.filter(b => !fetchedBankNames.has(b.name.toLowerCase().trim()));
    const mergedBanks = [...data.banks, ...pendingNewBanks];

    // 5. Preserve any local summaries not yet in Supabase
    const currentLocalSummaries = getSummaries();
    const fetchedSummaryIds = new Set(data.summaries.map(s => s.id));
    const pendingNewSummaries = currentLocalSummaries.filter(s => !fetchedSummaryIds.has(s.id));
    const mergedSummaries = [...data.summaries, ...pendingNewSummaries];

    // 6. Preserve any local party & salesperson contacts with mobile numbers
    const currentLocalParty = getPartyContacts();
    const currentLocalSales = getSalespersonContacts();

    setServerData({
      bills: finalBills,
      drivers: mergedDrivers,
      banks: mergedBanks,
      summaries: mergedSummaries,
      partyContacts: data.partyContacts || currentLocalParty,
      salespersonContacts: data.salespersonContacts || currentLocalSales,
      settings: data.settings,
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

// Removed pollVersion as there is no custom server-side version API.
// doFullSync() handles the direct Supabase fetch cleanly when needed.

// ─── Direct Supabase Realtime Subscription ──────────────────────────────────
let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;

function initSupabaseRealtime() {
  if (!supabase || realtimeChannel) return;
  try {
    realtimeChannel = supabase
      .channel('public_db_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public' },
        (payload) => {
          serverVersion = 0;
          doFullSync();
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Connected to Supabase Realtime live stream
        }
      });
  } catch (err) {
    // Silent catch
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
      serverVersion = 0;
      doFullSync();
    }
  };
}

// Removed EventSource/SSE helper since this is a static client-side SPA.

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
    if (document.visibilityState === 'visible') { doFullSync(); }
  });
  window.addEventListener('focus', () => { doFullSync(); });
  window.addEventListener('online', () => {
    import('@/lib/localQueue').then(m => m.flushDirtyQueue());
    doFullSync();
  });

  // Emergency local persistence & dirty queue flush on unload/close
  window.addEventListener('beforeunload', () => {
    import('@/lib/billStore').then(m => m.persistLocalState());
    import('@/lib/localQueue').then(m => m.flushDirtyQueue());
  });
  window.addEventListener('pagehide', () => {
    import('@/lib/billStore').then(m => m.persistLocalState());
    import('@/lib/localQueue').then(m => m.flushDirtyQueue());
  });

  // Background dirty queue flush every 15 seconds
  setInterval(() => {
    import('@/lib/localQueue').then(m => m.flushDirtyQueue());
  }, 15000);

  // Initial full load from Supabase
  doFullSync();
  pollingTimer = setInterval(doFullSync, POLL_INTERVAL_MS);
  initSupabaseRealtime();
}

// ─── React hook ───────────────────────────────────────────────────────────
export function useBillStore() {
  const [, tick] = useState(0);

  useEffect(() => {
    initGlobalSync();
    const cb = () => tick(n => n + 1);
    subs.add(cb);
    return () => { subs.delete(cb); };
  }, []);

  return {
    bills:      g.bills,
    drivers:    g.drivers,
    banks:      g.banks,
    summaries:  g.summaries,
    loading:    g.loading,
    syncing:    g.syncing,
    refresh:    readLocal,
    syncFromApi: () => { serverVersion = 0; doFullSync(); },
  };
}
