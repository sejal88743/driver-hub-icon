import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toaster';
import { ConnectionStatus } from '@/components/ConnectionStatus';
import { lazy, Suspense, useState, useEffect } from 'react';
import Dashboard from '@/app/page';
import LoginPage from '@/app/login/page';
import { getRole, Role } from '@/lib/auth';
import { useBillStore } from '@/hooks/use-bill-store';
import F1CalculatorModal from '@/components/F1CalculatorModal';
import { Calculator } from 'lucide-react';

const BillsPage = lazy(() => import('@/app/bills/page'));
const OutstandingPage = lazy(() => import('@/app/outstanding/page'));
const DriverPage = lazy(() => import('@/app/driver/page'));
const ReportsPage = lazy(() => import('@/app/reports/page'));
const SettingsPage = lazy(() => import('@/app/settings/page'));
const NotFound = lazy(() => import('@/pages/not-found'));
const DiagnosticsPage = lazy(() => import('@/app/diagnostics/page'));
const ChequeReturnPage = lazy(() => import('@/app/cheque-return/page'));
const HistoryPage = lazy(() => import('@/app/history/page'));

function RouteLoading() {
  return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <div className="text-xs font-black uppercase tracking-[0.2em] text-muted-foreground">
        Loading…
      </div>
    </div>
  );
}

function OfflineGate({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(true);
  const [dbReachable, setDbReachable] = useState(true);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    const goOnline = () => setIsOnline(true);
    const goOffline = () => { setIsOnline(false); setDbReachable(false); };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Supabase reachability check — pings Supabase every 10s.
  useEffect(() => {
    let cancelled = false;
    async function ping() {
      if (!navigator.onLine) { if (!cancelled) setDbReachable(false); return; }
      try {
        const { apiPingSupabase } = await import('@/lib/apiSync');
        const ok = await apiPingSupabase();
        if (!cancelled) setDbReachable(ok);
      } catch {
        if (!cancelled) setDbReachable(false);
      }
    }
    ping();
    const t = setInterval(ping, 60_000);
    const onFocus = () => ping();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      cancelled = true;
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, []);

  // Removed aggressive full-screen blocking to support offline first cache rendering.
  // The bottom-right ConnectionStatus floating pill already informs the user of actual status.
  return <>{children}</>;
}

function FontSizeApplier() {
  useEffect(() => {
    function applyZoom() {
      const zoom = localStorage.getItem('vitratrack_font_zoom') || '1';
      const root = document.getElementById('root');
      if (root) root.style.zoom = zoom;
    }
    applyZoom();
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'vitratrack_font_zoom') applyZoom();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('vitratrack-font-zoom', applyZoom);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('vitratrack-font-zoom', applyZoom);
    };
  }, []);
  return null;
}

function AuthGuard({ children, allowedRoles }: { children: React.ReactNode; allowedRoles?: Role[] }) {
  const role = getRole();
  const location = useLocation();

  if (!role) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allowedRoles && !allowedRoles.includes(role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  useBillStore();
  const [showCalc, setShowCalc] = useState(false);
  const role = getRole();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key?.toLowerCase();
      const code = e.code?.toLowerCase();
      if (key === 'f2' || code === 'f2' || e.keyCode === 113 || key === 'f1' || code === 'f1' || e.keyCode === 112) {
        e.preventDefault();
        e.stopPropagation();
        setShowCalc(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, []);

  return (
    <TooltipProvider>
      <FontSizeApplier />
      <OfflineGate>
        <ConnectionStatus />
        <Toaster />
        
        {/* Floating calculator button in bottom-left corner for mobile/touch screens */}
        {role && (
          <button
            onClick={() => setShowCalc(true)}
            className="fixed bottom-4 left-4 z-[100] w-10 h-10 bg-primary hover:bg-primary/90 text-primary-foreground rounded-full flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition-all cursor-pointer border border-primary/20"
            title="Calculator (F2)"
          >
            <Calculator className="w-5 h-5" />
          </button>
        )}

        <F1CalculatorModal isOpen={showCalc} onClose={() => setShowCalc(false)} />

        <Suspense fallback={<RouteLoading />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<AuthGuard><Dashboard /></AuthGuard>} />
            <Route path="/bills" element={<AuthGuard allowedRoles={['owner','user']}><BillsPage /></AuthGuard>} />
            <Route path="/outstanding" element={<AuthGuard allowedRoles={['owner','user']}><OutstandingPage /></AuthGuard>} />
            <Route path="/driver" element={<AuthGuard allowedRoles={['owner','user']}><DriverPage /></AuthGuard>} />
            <Route path="/reports" element={<AuthGuard allowedRoles={['owner','user']}><ReportsPage /></AuthGuard>} />
            <Route path="/settings" element={<AuthGuard allowedRoles={['owner']}><SettingsPage /></AuthGuard>} />
            <Route path="/cheque-return" element={<AuthGuard allowedRoles={['owner','user']}><ChequeReturnPage /></AuthGuard>} />
            <Route path="/history" element={<AuthGuard allowedRoles={['owner']}><HistoryPage /></AuthGuard>} />
            <Route path="/diagnostics" element={<AuthGuard allowedRoles={['owner']}><DiagnosticsPage /></AuthGuard>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </OfflineGate>
    </TooltipProvider>
  );
}
