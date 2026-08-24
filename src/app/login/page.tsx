import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Truck, Lock, Eye, EyeOff, X, FileSpreadsheet, Receipt, CalendarCheck } from 'lucide-react';
import { setRole, setLoggedInName } from '@/lib/auth';
import { getSystemPassword, getOwnerPassword, findUserByPassword, getUserPassword, setServerData } from '@/lib/billStore';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

type ModalMode = 'main' | 'owner' | 'xlsx' | 'bankslip';


export default function LoginPage() {
  const navigate = useNavigate();

  const [modalMode, setModalMode] = useState<ModalMode | null>(null);
  // Name pre-selected when user clicks their chip
  const [pendingUserName, setPendingUserName] = useState('');

  const [pwInput, setPwInput] = useState('');
  const [pwError, setPwError] = useState('');
  const [showPw, setShowPw] = useState(false);

  // Only user-role names (not drivers, not owners)
  const [staffNames, setStaffNames] = useState<string[]>(() => {
    try {
      const cached = JSON.parse(localStorage.getItem('vt_staff_names') || '[]');
      return Array.isArray(cached) ? cached : [];
    } catch {
      return [];
    }
  });

  // Mobile → only Driver + Attendance
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    // Fetch fresh user-role names and settings from Supabase on every page load
    (async () => {
      try {
        const [{ data: driverData }, { data: settingsData }] = await Promise.all([
          supabase
            .from('drivers')
            .select('id,name,role')
            .like('id', 'usr_%'),
          supabase
            .from('settings')
            .select('key,value'),
        ]);

        if (driverData) {
          const names = (driverData || [])
            .map((d: any) => d.name)
            .filter((n: string) => !!n);
          if (names.length) {
            setStaffNames(names);
            try { localStorage.setItem('vt_staff_names', JSON.stringify(names)); } catch {}
          }
        }

        if (settingsData && Array.isArray(settingsData)) {
          const settingsMap: Record<string, string> = {};
          for (const s of settingsData) {
            if (s.key && s.value) settingsMap[s.key] = s.value;
          }
          setServerData({ settings: settingsMap });
        }
      } catch (err) {
        console.warn('[LoginPage] Hydration note:', err);
      }
    })();
  }, []);


  function openModal(mode: ModalMode, preSelectedName = '') {
    setModalMode(mode);
    setPendingUserName(preSelectedName);
    setPwInput('');
    setPwError('');
    setShowPw(false);
  }

  function closeModal() {
    setModalMode(null);
    setPendingUserName('');
    setPwInput('');
    setPwError('');
    setShowPw(false);
  }

  function handlePwSubmit() {
    const cleanPw = (pwInput || '').trim();
    const sysPw = (getSystemPassword() || '').trim();
    const ownPw = (getOwnerPassword() || '').trim();

    if (modalMode === 'owner') {
      if (cleanPw === ownPw || cleanPw.toLowerCase() === ownPw.toLowerCase()) {
        setRole('owner');
        setLoggedInName('OWNER');
        navigate('/');
      } else {
        setPwError('Wrong Password');
        setTimeout(() => setPwError(''), 1500);
      }
      return;
    }

    if (modalMode === 'main') {
      // 1. Check if password matches a personal user password
      const matchedUser = findUserByPassword(cleanPw);
      if (matchedUser) {
        setRole('user');
        setLoggedInName(matchedUser);
        navigate('/');
        return;
      }

      // 2. Check if selected chip has a matching password
      if (pendingUserName) {
        const userSpecificPw = getUserPassword(pendingUserName);
        if (userSpecificPw && (userSpecificPw.trim() === cleanPw || userSpecificPw.trim().toLowerCase() === cleanPw.toLowerCase())) {
          setRole('user');
          setLoggedInName(pendingUserName);
          navigate('/');
          return;
        }
      }

      // 3. System password → for users without personal password
      if (cleanPw === sysPw || cleanPw.toLowerCase() === sysPw.toLowerCase()) {
        if (!pendingUserName) {
          setPwError('Pehle upar se apna naam select karo');
          setTimeout(() => setPwError(''), 2500);
          return;
        }
        if (getUserPassword(pendingUserName)) {
          setPwError('Apna personal password use karo');
          setTimeout(() => setPwError(''), 2500);
          return;
        }
        setRole('user');
        setLoggedInName(pendingUserName);
        navigate('/');
        return;
      }

      setPwError('Wrong Password');
      setTimeout(() => setPwError(''), 1500);

    } else if (modalMode === 'xlsx') {
      const isMatchedUser = findUserByPassword(cleanPw) !== null;
      if (cleanPw === sysPw || cleanPw === ownPw || cleanPw.toLowerCase() === sysPw.toLowerCase() || cleanPw.toLowerCase() === ownPw.toLowerCase() || isMatchedUser) {
        window.open('https://smart-excel-shaper.lovable.app/', '_blank');
        closeModal();
      } else {
        setPwError('Wrong Password');
        setTimeout(() => setPwError(''), 1500);
      }
    } else if (modalMode === 'bankslip') {
      const isMatchedUser = findUserByPassword(cleanPw) !== null;
      if (cleanPw === sysPw || cleanPw === ownPw || cleanPw.toLowerCase() === sysPw.toLowerCase() || cleanPw.toLowerCase() === ownPw.toLowerCase() || isMatchedUser) {
        window.open('https://cheque-champ-59.lovable.app/', '_blank');
        closeModal();
      } else {
        setPwError('Wrong Password');
        setTimeout(() => setPwError(''), 1500);
      }
    }
  }

  function handleDriver() {
    setRole('driver');
    navigate('/');
  }

  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-center relative overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 40%, #4c1d95 100%)' }}
    >
      {/* Background glow */}
      <div className="absolute top-[-80px] right-[-80px] w-64 h-64 rounded-full opacity-10"
        style={{ background: 'radial-gradient(circle, #a78bfa, transparent)' }} />
      <div className="absolute bottom-[-60px] left-[-60px] w-52 h-52 rounded-full opacity-10"
        style={{ background: 'radial-gradient(circle, #818cf8, transparent)' }} />

      {/* Top-left owner button (desktop only) */}
      {!isMobile && (
        <button
          onClick={() => openModal('owner')}
          title="Owner Login"
          className="absolute top-4 left-4 z-20 flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl font-black uppercase text-[9px] tracking-widest transition-all active:scale-95"
          style={{
            background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
            boxShadow: '0 2px 10px rgba(99,102,241,0.4)',
            color: '#fff',
          }}
        >
          <Shield className="w-3.5 h-3.5" />
          <span>Owner</span>
          <Lock className="w-2.5 h-2.5 opacity-70" />
        </button>
      )}

      {/* Top-right tool buttons (desktop only) */}
      {!isMobile && (
        <div className="absolute top-4 right-4 flex gap-2 z-20">
          <button
            onClick={() => openModal('xlsx')}
            title="XLSX Tool"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl font-black uppercase text-[9px] tracking-widest transition-all active:scale-95"
            style={{
              background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
              boxShadow: '0 2px 10px rgba(5,150,105,0.4)',
              color: '#fff',
            }}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>XLSX</span>
            <Lock className="w-2.5 h-2.5 opacity-70" />
          </button>

          <button
            onClick={() => openModal('bankslip')}
            title="Bank Slip Tool"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl font-black uppercase text-[9px] tracking-widest transition-all active:scale-95"
            style={{
              background: 'linear-gradient(135deg, #d97706 0%, #b45309 100%)',
              boxShadow: '0 2px 10px rgba(217,119,6,0.4)',
              color: '#fff',
            }}
          >
            <Receipt className="w-3.5 h-3.5" />
            <span>Slip</span>
            <Lock className="w-2.5 h-2.5 opacity-70" />
          </button>
        </div>
      )}

      {/* Main content */}
      <div className="relative z-10 w-full max-w-sm px-4">

        {/* Logo + App Name */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-24 h-24 rounded-3xl overflow-hidden shadow-2xl mb-5 border-2 border-white/20"
            style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}
          >
            <img
              src="/icon-512.png"
              alt="VitraTrack"
              className="w-full h-full object-cover"
              onError={e => {
                const t = e.target as HTMLImageElement;
                t.style.display = 'none';
                t.parentElement!.style.background = 'linear-gradient(135deg,#6366f1,#8b5cf6)';
              }}
            />
          </div>
          <h1 className="text-3xl font-black text-white uppercase tracking-widest leading-none">
            VitraTrack
          </h1>
          <p className="text-indigo-300 text-[11px] font-bold uppercase tracking-[0.3em] mt-1.5">
            Distribution Management
          </p>
        </div>

        {/* ── User name chips (desktop only) ── */}
        {!isMobile && staffNames.length > 0 && (
          <div className="flex flex-wrap gap-2 justify-center mb-5">
            {staffNames.map(name => (
              <button
                key={name}
                onClick={() => openModal('main', name)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider transition-all active:scale-95 border",
                  pendingUserName === name && modalMode === 'main'
                    ? "bg-white/30 border-white/60 text-white"
                    : "bg-white/10 border-white/20 text-white/80 hover:bg-white/20"
                )}
                style={{ backdropFilter: 'blur(8px)' }}
              >
                {name}
              </button>
            ))}
          </div>
        )}

        {/* Login cards */}
        <div className="space-y-3">
          {/* Driver login */}
          <button
            onClick={handleDriver}
            className="w-full flex items-center gap-4 px-6 py-5 rounded-2xl font-black uppercase tracking-widest text-sm transition-all duration-200 active:scale-95 shadow-xl"
            style={{
              background: 'rgba(255,255,255,0.08)',
              backdropFilter: 'blur(12px)',
              border: '1.5px solid rgba(255,255,255,0.18)',
              color: '#fff',
              boxShadow: '0 4px 24px rgba(0,0,0,0.2)',
            }}
          >
            <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center shrink-0 shadow-inner">
              <Truck className="w-6 h-6 text-white" />
            </div>
            <div className="text-left flex-1">
              <p className="text-base font-black leading-none">Driver</p>
              <p className="text-[10px] font-semibold text-indigo-200 mt-0.5 normal-case tracking-normal">Payment entry · Dashboard only</p>
            </div>
          </button>

          {/* Attendance */}
          <button
            onClick={() => window.open('https://attendo-tempo-pro.lovable.app/worker', '_blank')}
            className="w-full flex items-center gap-4 px-6 py-5 rounded-2xl font-black uppercase tracking-widest text-sm transition-all duration-200 active:scale-95 shadow-xl"
            style={{
              background: 'rgba(255,255,255,0.08)',
              backdropFilter: 'blur(12px)',
              border: '1.5px solid rgba(255,255,255,0.18)',
              color: '#fff',
              boxShadow: '0 4px 24px rgba(0,0,0,0.2)',
            }}
          >
            <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center shrink-0 shadow-inner">
              <CalendarCheck className="w-6 h-6 text-white" />
            </div>
            <div className="text-left flex-1">
              <p className="text-base font-black leading-none">Attendance</p>
              <p className="text-[10px] font-semibold text-indigo-200 mt-0.5 normal-case tracking-normal">Worker attendance portal</p>
            </div>
          </button>
        </div>


        <p className="text-center text-indigo-400/60 text-[9px] font-bold uppercase tracking-widest mt-10">
          Confiance Distribution · Secure Access
        </p>
      </div>

      {/* ── Password Modal ── */}
      {modalMode && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
          onClick={e => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div className="bg-white rounded-3xl p-6 w-full max-w-xs shadow-2xl animate-in zoom-in-95 duration-200">

            {/* Modal header */}
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <div className={cn(
                  "w-9 h-9 rounded-xl flex items-center justify-center",
                  (modalMode === 'main' || modalMode === 'owner') ? "bg-indigo-100" :
                  modalMode === 'xlsx' ? "bg-emerald-100" : "bg-amber-100"
                )}>
                  {(modalMode === 'main' || modalMode === 'owner') && <Shield className="w-5 h-5 text-indigo-600" />}
                  {modalMode === 'xlsx' && <FileSpreadsheet className="w-5 h-5 text-emerald-600" />}
                  {modalMode === 'bankslip' && <Receipt className="w-5 h-5 text-amber-600" />}
                </div>
                <div>
                  <p className="text-sm font-black text-gray-900 uppercase tracking-widest leading-none">
                    {modalMode === 'owner' ? 'Owner Login'
                      : modalMode === 'main'
                      ? (pendingUserName ? pendingUserName : 'Enter Password')
                      : modalMode === 'xlsx' ? 'XLSX Access' : 'Bank Slip Access'}
                  </p>

                  <p className="text-[9px] text-gray-400 font-semibold mt-0.5 normal-case">
                    {modalMode === 'owner' ? 'Owner password enter karo'
                      : modalMode === 'main'
                      ? (pendingUserName ? 'Password enter karo' : 'Apna password enter karo')
                      : 'Enter password to unlock'}
                  </p>

                </div>
              </div>
              <button
                onClick={closeModal}
                className="w-8 h-8 rounded-xl bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
              >
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>

            {/* Password input */}
            <div className="relative mb-4">
              <input
                type={showPw ? 'text' : 'password'}
                placeholder="PASSWORD"
                autoFocus
                value={pwInput}
                onChange={e => {
                  const val = e.target.value;
                  setPwInput(val);
                  setPwError('');
                  if (modalMode === 'main' && val) {
                    const matched = findUserByPassword(val);
                    if (matched) {
                      setPendingUserName(matched);
                    }
                  }
                }}
                onKeyDown={e => e.key === 'Enter' && handlePwSubmit()}
                className={cn(
                  "w-full h-12 px-4 pr-11 rounded-xl border-2 text-sm font-black uppercase text-center tracking-widest focus:outline-none transition-all",
                  pwError
                    ? "border-red-400 bg-red-50 text-red-600"
                    : "border-gray-200 bg-gray-50 text-gray-900 focus:border-indigo-400"
                )}
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {pwError && (
              <p className="text-center text-xs font-black text-red-500 mb-3 tracking-wide">
                {pwError}
              </p>
            )}

            <button
              onClick={handlePwSubmit}
              className="w-full h-12 rounded-xl font-black uppercase text-sm tracking-widest text-white transition-all active:scale-95"
              style={{
                background:
                  (modalMode === 'main' || modalMode === 'owner') ? 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)' :
                  modalMode === 'xlsx'     ? 'linear-gradient(135deg, #059669 0%, #047857 100%)' :
                  'linear-gradient(135deg, #d97706 0%, #b45309 100%)',
              }}
            >
              {(modalMode === 'main' || modalMode === 'owner') ? 'Login' : 'Unlock'}
            </button>

          </div>
        </div>
      )}
    </div>
  );
}
