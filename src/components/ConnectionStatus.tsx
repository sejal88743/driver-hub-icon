import { useState, useEffect, useRef } from 'react';
import { Wifi, WifiOff, RefreshCw, CloudUpload } from 'lucide-react';
import { getPendingWriteCount, flushPendingWrites } from '@/lib/apiSync';
import { getDirtyCount, flushDirtyQueue } from '@/lib/localQueue';
import { supabase } from '@/lib/supabase';

type Status = 'live' | 'syncing' | 'offline';

export function ConnectionStatus() {
  const [status, setStatus] = useState<Status>('live');
  const [lastSync, setLastSync] = useState<string>('');
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState<number>(() => {
    try { return (getPendingWriteCount() || 0) + (getDirtyCount() || 0); } catch { return 0; }
  });
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const consecutiveErrors = useRef(0);

  useEffect(() => {
    function updatePending() {
      try {
        const total = (getPendingWriteCount() || 0) + (getDirtyCount() || 0);
        setPending(total);
      } catch {
        // ignore
      }
    }

    function show(newStatus: Status) {
      setStatus(newStatus);
      setVisible(true);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (newStatus === 'live') {
        hideTimer.current = setTimeout(() => setVisible(false), 3000);
      }
    }

    function onOnline() {
      consecutiveErrors.current = 0;
      show('live');
      void flushPendingWrites();
      void flushDirtyQueue();
      updatePending();
    }

    function onOffline() {
      show('offline');
    }

    function onSyncStatus(e: Event) {
      const detail = (e as CustomEvent<string>).detail;
      if (detail === 'ok') {
        consecutiveErrors.current = 0;
        setLastSync(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
        show('live');
      } else {
        consecutiveErrors.current++;
        // Only show offline if actually offline or if 3 consecutive failures occurred
        if (!navigator.onLine || consecutiveErrors.current >= 3) {
          show('offline');
        }
      }
      updatePending();
    }

    function onPending() {
      updatePending();
    }

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('sync-status', onSyncStatus);
    window.addEventListener('pending-writes', onPending);
    window.addEventListener('dirty-queue-count', onPending);

    if (!navigator.onLine) {
      setStatus('offline');
    } else {
      setStatus('live');
      setLastSync(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }

    // Active heartbeat: Ping Supabase every 20s to ensure live connectivity and flush pending writes
    const heartbeatTimer = setInterval(async () => {
      if (!navigator.onLine) {
        setStatus('offline');
        return;
      }
      updatePending();
      try {
        if (supabase) {
          const { error } = await supabase.from('settings').select('key').limit(1);
          if (!error) {
            consecutiveErrors.current = 0;
            if (status === 'offline') {
              setStatus('live');
              show('live');
            }
            // Auto flush any pending offline writes
            void flushDirtyQueue();
            void flushPendingWrites();
            updatePending();
          }
        }
      } catch {
        // Silent heartbeat catch
      }
    }, 20_000);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('sync-status', onSyncStatus);
      window.removeEventListener('pending-writes', onPending);
      window.removeEventListener('dirty-queue-count', onPending);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      clearInterval(heartbeatTimer);
    };
  }, [status]);

  const showStatus = (newStatus: Status) => {
    setStatus(newStatus);
    setVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (newStatus === 'live') {
      hideTimer.current = setTimeout(() => setVisible(false), 3000);
    }
  };

  const handleManualFlush = async () => {
    showStatus('syncing');
    try {
      await Promise.all([flushDirtyQueue(), flushPendingWrites()]);
      setPending((getPendingWriteCount() || 0) + (getDirtyCount() || 0));
      setLastSync(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      showStatus('live');
    } catch {
      showStatus('live');
    }
  };

  const cfg = {
    live: {
      bg: 'bg-emerald-600',
      text: 'text-white',
      icon: <Wifi className="w-3 h-3" />,
      label: 'Online',
    },
    syncing: {
      bg: 'bg-blue-600',
      text: 'text-white',
      icon: <RefreshCw className="w-3 h-3 animate-spin" />,
      label: 'Syncing…',
    },
    offline: {
      bg: 'bg-red-600',
      text: 'text-white',
      icon: <WifiOff className="w-3 h-3" />,
      label: 'Offline',
    },
  }[status];

  const alwaysShow = status === 'offline' || status === 'syncing';

  return (
    <>
      <div
        id="connection-status-badge"
        className={`
          fixed bottom-4 right-4 z-50 flex items-center gap-1.5 px-3 py-1.5 rounded-full shadow-lg
          text-xs font-semibold select-none cursor-pointer
          transition-all duration-300
          ${cfg.bg} ${cfg.text}
          ${alwaysShow || visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'}
        `}
        onClick={handleManualFlush}
        title="Click to refresh connection & sync data"
      >
        {cfg.icon}
        <span>{cfg.label}</span>
        {status === 'live' && lastSync && (
          <span className="opacity-80 font-normal ml-1">({lastSync})</span>
        )}
      </div>
      {pending > 0 && (
        <button
          id="btn-flush-pending-writes"
          onClick={handleManualFlush}
          className="fixed bottom-14 right-4 z-50 flex items-center gap-1.5 px-3 py-1.5 rounded-full shadow-lg text-xs font-semibold bg-amber-500 text-white hover:bg-amber-600 active:scale-95 transition-transform"
          title="Retry pending writes now"
        >
          <CloudUpload className="w-3 h-3 animate-bounce" />
          <span>{pending} PENDING — TAP TO SYNC</span>
        </button>
      )}
    </>
  );
}

