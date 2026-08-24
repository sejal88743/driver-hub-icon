import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, FileText, TrendingUp, Settings, BarChart2, Truck, LogOut, RotateCcw, History } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState, useEffect } from 'react';
import { getRole, clearRole } from '@/lib/auth';

const ownerTabs = [
  { path: '/',            label: 'Dash',    icon: LayoutDashboard },
  { path: '/bills',       label: 'Bills',   icon: FileText },
  { path: '/outstanding',    label: 'O/S',     icon: TrendingUp },
  { path: '/cheque-return', label: 'CHQ RET', icon: RotateCcw },
  { path: '/driver',      label: 'Driver',  icon: Truck },
  { path: '/reports',     label: 'Reports', icon: BarChart2 },
  { path: '/history',     label: 'History', icon: History },
  { path: '/settings',    label: 'Admin',   icon: Settings },
];

const driverTabs = [
  { path: '/', label: 'Dash', icon: LayoutDashboard },
];

function SyncDot() {
  const [status, setStatus] = useState<'ok' | 'error' | 'idle'>('idle');
  const [lastSync, setLastSync] = useState<number | null>(null);

  useEffect(() => {
    const onSyncStatus = (e: Event) => {
      const detail = (e as CustomEvent).detail as string;
      if (detail === 'ok') { setStatus('ok'); setLastSync(Date.now()); }
      else setStatus('error');
    };
    window.addEventListener('sync-status', onSyncStatus);
    return () => window.removeEventListener('sync-status', onSyncStatus);
  }, []);

  const age = lastSync ? Math.floor((Date.now() - lastSync) / 1000) : null;
  const label = age === null ? '...' : age < 10 ? 'Live' : `${age}s`;

  return (
    <div className="flex items-center gap-1 px-1.5 shrink-0">
      <span className={cn(
        'w-1.5 h-1.5 rounded-full shrink-0',
        status === 'ok' ? 'bg-emerald-500 animate-pulse' :
        status === 'error' ? 'bg-red-500' : 'bg-yellow-400 animate-pulse'
      )} />
      <span className="text-[7px] font-black uppercase tracking-tighter text-muted-foreground whitespace-nowrap hidden xs:inline">
        {label}
      </span>
    </div>
  );
}

export default function TopNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const role = getRole();
  const tabs = role === 'driver'
    ? driverTabs
    : role === 'owner' ? ownerTabs : ownerTabs.filter(t => t.path !== '/history' && t.path !== '/settings');

  function handleLogout() {
    clearRole();
    navigate('/login');
  }

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-card/95 border-b border-border backdrop-blur-lg safe-area-top">
      <div className="flex items-center h-10 max-w-full mx-auto px-0">
        <Link to="/" className="flex items-center gap-1 pl-2 pr-1 shrink-0">
          <img
            src="/icon-192.png"
            alt="Confiance"
            className="w-5 h-5 rounded-md object-cover"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
          <span className="text-[8px] font-black uppercase tracking-tighter text-primary leading-none hidden sm:block">Confiance</span>
        </Link>
        <div className="flex flex-1 items-center justify-around gap-0.5 px-0.5">
          {tabs.map(({ path, label, icon: Icon }) => {
            const active = pathname === path;
            return (
              <Link
                key={path}
                to={path}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 px-1 py-1 transition-all duration-200 flex-1 rounded-lg",
                  active
                    ? "text-primary font-black bg-primary/10 shadow-xs"
                    : "text-muted-foreground/80 hover:text-foreground hover:bg-muted/40 font-extrabold"
                )}
              >
                <Icon className={cn("w-4 h-4 shrink-0 transition-transform", active ? "scale-110" : "")} strokeWidth={active ? 2.8 : 2.2} />
                <span className={cn(
                  "text-[9px] sm:text-[10px] uppercase leading-none text-center whitespace-nowrap",
                  active ? "font-black text-primary tracking-tight" : "font-black tracking-tighter"
                )}>
                  {label}
                </span>
              </Link>
            );
          })}
        </div>
        <div className="flex items-center gap-1 pr-1">
          <SyncDot />
          <button
            onClick={handleLogout}
            title="Logout"
            className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </nav>
  );
}
