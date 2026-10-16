import { useEffect, useSyncExternalStore } from 'react';
import { getBills, getDrivers, getBanks, getSummaries, getPartyContacts, getSalespersonContacts, setServerData, applyRealtimeBillChange, applyRealtimeTableChange, applyBillsDelta, whenStoreHydrated, Bill, Driver, Bank, DriverDailySummary } from '@/lib/billStore';
import { apiFetchAllData, apiFetchBillsSince, mapBillFromSupabase, flushPendingWrites } from '@/lib/apiSync';
import { supabase } from '@/lib/supabase';
import { isWriteInProgress, getLastWriteAt } from '@/lib/syncState';
import { applyDirtyPatches, isDirtyPending, flushDirtyQueue } from '@/lib/localQueue';

// ─── Global singleton ─────────────────────────────────────────────────────
// Polling + Supabase Realtime WebSocket + BroadcastChannel multi-tab
// guarantees instant real-time live sync across all devices with minimal egress.

// Adaptive polling intervals:
// - Safety fallback when Realtime WebSocket is live: 8s
// - Fast fallback when Realtime WebSocket is offline: 10s
// - Idle backoff when user is away (> 2 min): 30s
// - Hidden tab / background: 0s (Completely pauses polling)
const POLL_SAFETY_MS = 8_000;
const POLL_FAST_MS = 10_000;
const POLL_IDLE_MS = 30_000;
const POLL_TICK_MS = 2_000;



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

function readLocal(force = false) {
  const b = getBills();
  const d = getDrivers();
  const bk = getBanks();
  const s = getSummaries();
  if (
    !force &&
    currentSnapshot.bills === b &&
    currentSnapshot.drivers === d &&
    currentSnapshot.banks === bk &&
    currentSnapshot.summaries === s &&
    currentSnapshot.loading === false
  ) {
    return;
  }
  currentSnapshot = {
    bills: [...b],
    drivers: [...d],
    banks: [...bk],
    summaries: [...s],
    loading: false,
    syncing: currentSnapshot.syncing,
  };
  notify();
}

let readLocalScheduled = false;
function scheduleReadLocal(force = false) {
  if (readLocalScheduled) return;
  readLocalScheduled = true;
  requestAnimationFrame(() => {
    readLocalScheduled = false;
    readLocal(force);
  });
}

let lastFullSyncTime = 0;
let deltaCursor: string | null = null;
let deltaInFlight = false;

function scheduleDebouncedFullSync(delayMs = 1500) {
  if (fullSyncDebounceTimer) clearTimeout(fullSyncDebounceTimer);
  fullSyncDebounceTimer = setTimeout(() => {
    doFullSync(true);
  }, delayMs);
}

// ─── Light incremental sync: only pull bills changed since last sync ─────────
export async function doDeltaSync(force = false) {
  const now = Date.now();
  if (!deltaCursor) {
    const savedTs = typeof window !== 'undefined' ? localStorage.getItem('vitratrack_last_sync_ts') : null;
    deltaCursor = savedTs || new Date(now - 24 * 3600 * 1000).toISOString();
  }
  // Sanity check: if stored timestamp is in the future or invalid, clamp to 5 min ago
  if (deltaCursor && new Date(deltaCursor).getTime() > now) {
    deltaCursor = new Date(now - 300_000).toISOString();
  }

  if (deltaInFlight || (syncInFlight && !force)) return;
  if (!force && (isWriteInProgress() || (now - getLastWriteAt() < 2500))) return;
  deltaInFlight = true;

  // Use a 3-minute rolling overlap to ensure mobile phone / laptop clock drift never skips entries made on other devices
  const rollingCursor = new Date(now - 180_000).toISOString();

  try {
    const changed = await apiFetchBillsSince(deltaCursor);

    let maxServerTs = 0;
    if (Array.isArray(changed) && changed.length > 0) {
      for (const b of changed) {
        if (b.updatedAt) {
          const t = new Date(b.updatedAt).getTime();
          if (!isNaN(t) && t > maxServerTs) maxServerTs = t;
        }
      }

      // Never let the server overwrite rows still waiting to be pushed up
      const safe = changed.filter(b => !isDirtyPending(b.id, b.billNo));
      if (safe.length > 0) {
        applyBillsDelta(safe);
        readLocal(true);
        if (syncChannel) {
          try { syncChannel.postMessage({ type: 'delta-synced', cursor: deltaCursor }); } catch {}
        }
      }
    }

    if (maxServerTs > 0) {
      const candidate = new Date(maxServerTs - 60_000).toISOString();
      deltaCursor = candidate < rollingCursor ? candidate : rollingCursor;
    } else {
      deltaCursor = rollingCursor;
    }

    try {
      if (typeof window !== 'undefined') localStorage.setItem('vitratrack_last_sync_ts', deltaCursor);
    } catch {}

    window.dispatchEvent(new CustomEvent('sync-status', { detail: 'ok' }));
  } catch (err) {
    console.warn('[useBillStore] delta sync failed:', err);
    // On transient failure, rewind cursor slightly so next poll retries recent modifications safely
    deltaCursor = new Date(now - 600_000).toISOString();
  } finally {
    deltaInFlight = false;
  }
}

async function doFullSync(force = false) {
  if (syncInFlight) return;
  const now = Date.now();
  // Avoid spamming full network sync if completed recently unless explicitly forced
  if (!force && (now - lastFullSyncTime < 15_000)) {
    return;
  }
  // If a local write operation is currently in-flight or occurred in the last 2.5s, skip full refresh
  if (isWriteInProgress() || (now - getLastWriteAt() < 2500)) {
    return;
  }
  syncInFlight = true;
  deltaCursor = new Date(Date.now() - 60_000).toISOString();
  try {
    if (typeof window !== 'undefined') localStorage.setItem('vitratrack_last_sync_ts', deltaCursor);
  } catch {}
  patch({ syncing: true });
  try {

    const data = await apiFetchAllData();
    lastFullSyncTime = Date.now();
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
let isIntentionallyClosing = false;
let reconnectAttempts = 0;

export function broadcastBillChange(bill: Bill) {
  if (!bill) return;
  if (realtimeChannel) {
    try {
      realtimeChannel.send({
        type: 'broadcast',
        event: 'bill_updated',
        payload: { bill },
      }).catch?.(() => {});
    } catch {}
  }
}

export function broadcastBillsChange(bills: Bill[]) {
  if (!bills || bills.length === 0) return;
  if (realtimeChannel) {
    try {
      realtimeChannel.send({
        type: 'broadcast',
        event: 'bills_updated',
        payload: { bills: bills.slice(0, 50) },
      }).catch?.(() => {});
    } catch {}
  }
}

export function broadcastSyncTrigger() {
  if (realtimeChannel) {
    try {
      realtimeChannel.send({
        type: 'broadcast',
        event: 'sync_trigger',
        payload: { ts: Date.now() },
      }).catch?.(() => {});
    } catch {}
  }
}

// Window event listeners so other modules can trigger broadcast without circular imports
if (typeof window !== 'undefined') {
  window.addEventListener('broadcast-bill-update', ((e: CustomEvent) => {
    if (e.detail) broadcastBillChange(e.detail);
  }) as EventListener);
  window.addEventListener('broadcast-bills-update', ((e: CustomEvent) => {
    if (e.detail) broadcastBillsChange(e.detail);
  }) as EventListener);
  window.addEventListener('broadcast-sync-trigger', (() => {
    broadcastSyncTrigger();
  }) as EventListener);
}

function initSupabaseRealtime(force = false) {
  if (!supabase) return;
  if (realtimeChannel) {
    const channelState = (realtimeChannel as any)?.state;
    // If not forced and already connected or connecting, do not tear down
    if (!force && (channelState === 'joined' || channelState === 'joining')) {
      return;
    }
    try {
      isIntentionallyClosing = true;
      supabase.removeChannel(realtimeChannel);
    } catch {}
    realtimeChannel = null;
    setTimeout(() => { isIntentionallyClosing = false; }, 1000);
  }

  try {
    realtimeChannel = supabase
      .channel('vitratrack_realtime_all')
      // 1. Instant cross-device broadcast for manual bill entries & payments
      .on(
        'broadcast',
        { event: 'bill_updated' },
        (payload: any) => {
          const incomingBill = payload?.payload?.bill;
          if (incomingBill) {
            applyBillsDelta([incomingBill]);
            readLocal(true);
          }
        }
      )
      .on(
        'broadcast',
        { event: 'bills_updated' },
        (payload: any) => {
          const incomingBills = payload?.payload?.bills;
          if (Array.isArray(incomingBills) && incomingBills.length > 0) {
            applyBillsDelta(incomingBills);
            readLocal(true);
          }
        }
      )
      .on(
        'broadcast',
        { event: 'sync_trigger' },
        () => {
          void doDeltaSync(true);
        }
      )
      // 2. Postgres change listeners for driver summaries, drivers, banks, contacts, settings
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'driver_summaries' },
        (payload) => {
          applyRealtimeTableChange('driver_summaries', payload.eventType as any, payload.new, payload.old);
          scheduleReadLocal();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'drivers' },
        (payload) => {
          applyRealtimeTableChange('drivers', payload.eventType as any, payload.new, payload.old);
          scheduleReadLocal();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'banks' },
        (payload) => {
          applyRealtimeTableChange('banks', payload.eventType as any, payload.new, payload.old);
          scheduleReadLocal();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'contacts' },
        (payload) => {
          applyRealtimeTableChange('contacts', payload.eventType as any, payload.new, payload.old);
          scheduleReadLocal();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'settings' },
        (payload) => {
          applyRealtimeTableChange('settings', payload.eventType as any, payload.new, payload.old);
          if (payload.new && (payload.new as any).key === 'driver_download_records_v1') {
            window.dispatchEvent(new CustomEvent('driver-download-records-updated', { detail: (payload.new as any).value }));
          }
          scheduleReadLocal();
        }
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          reconnectAttempts = 0;
          if (realtimeReconnectTimer) {
            clearTimeout(realtimeReconnectTimer);
            realtimeReconnectTimer = null;
          }
          console.log('[Supabase Realtime] Connected and listening live across all devices.');
          window.dispatchEvent(new CustomEvent('sync-status', { detail: 'ok' }));
          void doDeltaSync();
        } else if (status === 'CLOSED') {
          // Closed is normal when removing channel or during intentional teardown.
          // Supabase's socket manages its own reconnect if disconnected. Do NOT trigger a loop here.
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          if (!isIntentionallyClosing) {
            const errStr = String(err?.message || err || '');
            if (errStr.includes('heartbeat timeout')) {
              // Heartbeat timeouts are normal transient network pauses; Supabase socket reconnects automatically.
              console.debug('[Supabase Realtime] Heartbeat pause, auto-reconnecting...');
            } else {
              console.warn('[Supabase Realtime] Channel status:', status, err);
            }
            // Provide a graceful fallback with exponential backoff if it stays in error state.
            if (navigator.onLine && !realtimeReconnectTimer) {
              reconnectAttempts++;
              const delay = Math.min(30000, 3000 * Math.pow(1.5, Math.min(reconnectAttempts, 5)));
              realtimeReconnectTimer = setTimeout(() => {
                realtimeReconnectTimer = null;
                const state = (realtimeChannel as any)?.state;
                if (!realtimeChannel || state === 'closed' || state === 'errored') {
                  initSupabaseRealtime(true);
                  void doDeltaSync();
                }
              }, delay);
            }
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
      scheduleReadLocal();
    } else if (event.data && typeof event.data === 'object' && event.data.type === 'delta-synced') {
      if (event.data.cursor && (!deltaCursor || event.data.cursor > deltaCursor)) {
        deltaCursor = event.data.cursor;
      }
      scheduleReadLocal();
    }
  };
}

let lastUserActivityAt = Date.now();
if (typeof window !== 'undefined') {
  const onUserActivity = () => { lastUserActivityAt = Date.now(); };
  window.addEventListener('mousemove', onUserActivity, { passive: true });
  window.addEventListener('keydown', onUserActivity, { passive: true });
  window.addEventListener('touchstart', onUserActivity, { passive: true });
}

function initGlobalSync() {
  if (initialized) return;
  initialized = true;

  // 1. Hydrate local state from memory/localStorage
  readLocal();

  window.addEventListener('bill-store-update', () => {
    readLocal(true);
    if (syncChannel) {
      try { syncChannel.postMessage('data-updated'); } catch { /* ignore */ }
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      lastUserActivityAt = Date.now();
      void doDeltaSync();
      void flushDirtyQueue();
      void flushPendingWrites();
      initSupabaseRealtime();
    }
  });
  window.addEventListener('focus', () => {
    lastUserActivityAt = Date.now();
    void doDeltaSync();
  });
  window.addEventListener('online', () => {
    void flushDirtyQueue();
    void flushPendingWrites();
    void doDeltaSync();
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

  // Background flush of pending queues every 15 seconds if items are pending
  setInterval(() => {
    if (document.visibilityState === 'hidden' && !navigator.onLine) return;
    void flushDirtyQueue();
    void flushPendingWrites();
  }, 15000);

  // Initial load: Hydrate immediately from cache with 0ms delay, then delta sync in background
  void (async () => {
    try {
      await whenStoreHydrated();
    } catch {}
    readLocal();
    const localBills = getBills();
    if (localBills && localBills.length > 0) {
      patch({ loading: false });
      const savedTs = typeof window !== 'undefined' ? localStorage.getItem('vitratrack_last_sync_ts') : null;
      deltaCursor = savedTs || new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      // Cache boot: ALWAYS delta sync — only changed rows since last visit are fetched.
      // 40k+ bills are already in local IndexedDB and never re-downloaded on normal boot.
      void doDeltaSync();
    } else {
      // Fresh device or empty local cache: do initial full sync
      void doFullSync(true);
    }
  })();

  let lastPollAt = Date.now();
  pollingTimer = setInterval(() => {
    if (document.visibilityState === 'hidden') return;
    const isIdle = (Date.now() - lastUserActivityAt) > 120_000;
    const realtimeLive = (realtimeChannel as any)?.state === 'joined';
    const wait = isIdle ? POLL_IDLE_MS : (realtimeLive ? POLL_SAFETY_MS : POLL_FAST_MS);
    if (Date.now() - lastPollAt < wait) return;
    lastPollAt = Date.now();
    void doDeltaSync();
  }, POLL_TICK_MS);

  // We intentionally do NOT run a 3-minute full sync timer here anymore!
  // Incremental delta sync above checks every few seconds and only fetches modified rows.
  // This keeps Egress under 20MB/month instead of 17.29 GB.
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
