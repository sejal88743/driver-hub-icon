import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquare, Loader2, Power, PowerOff, CheckCircle2, XCircle,
  Users, Smartphone, BellRing, Sparkles, Check, Edit3, QrCode, RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type BotStatus = {
  running: boolean;
  connected: boolean;
  qrDataUrl: string | null;
  error: string | null;
  lastMessageAt?: string | null;
  groups: { jid: string; name: string }[];
  selectedGroup: { jid: string; name: string } | null;
  hasSession?: boolean;
};

export function WhatsAppLiveBot() {
  const [status, setStatus] = useState<BotStatus | null>(() => {
    // Initial optimistic hydrate from local storage
    try {
      const saved = localStorage.getItem('wa_bot_saved_group');
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          running: false,
          connected: false,
          qrDataUrl: null,
          error: null,
          groups: parsed.name ? [{ jid: parsed.jid || '', name: parsed.name }] : [],
          selectedGroup: parsed,
        };
      }
    } catch {}
    return null;
  });

  const [busy, setBusy] = useState(false);
  const [customGroupName, setCustomGroupName] = useState('');
  const [isEditingGroupName, setIsEditingGroupName] = useState(false);
  const [testTriggering, setTestTriggering] = useState(false);
  const [testSuccess, setTestSuccess] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Instant real-time SSE listener for QR code generation and connection changes
  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource('/api/admin/whatsapp-bot/events');
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data?.type === 'status' && data.status) {
            setStatus(data.status);
            if (data.status.selectedGroup) {
              try {
                localStorage.setItem('wa_bot_saved_group', JSON.stringify(data.status.selectedGroup));
              } catch {}
            }
          }
        } catch {}
      };
    } catch {}
    return () => {
      try { es?.close(); } catch {}
    };
  }, []);

  // Poll bot status as reliable fallback
  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch('/api/admin/whatsapp-bot/status');
        if (res.status === 404 || !(res.headers.get('content-type') || '').includes('application/json')) {
          setStatus((prev) => ({
            running: false,
            connected: false,
            qrDataUrl: null,
            error: 'WhatsApp Bot ke liye Node.js server chahiye.',
            groups: prev?.groups || [],
            selectedGroup: prev?.selectedGroup || null,
          }));
          return;
        }
        const data = await res.json();
        if (data?.ok && data.status) {
          setStatus(data.status);
          if (data.status.selectedGroup) {
            try {
              localStorage.setItem('wa_bot_saved_group', JSON.stringify(data.status.selectedGroup));
            } catch {}
          }
          // Auto-start only if a valid persistent session already exists
          if (data.status?.hasSession && !data.status?.running) {
            fetch('/api/admin/whatsapp-bot/start', { method: 'POST' })
              .then((r) => r.json())
              .then((d) => { if (d?.ok) setStatus(d.status); })
              .catch(() => {});
          }
        }
      } catch {}
    }

    poll();
    const intervalMs = status?.running && !status?.connected ? 1500 : 4000;
    pollRef.current = setInterval(poll, intervalMs);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [status?.running, status?.connected]);

  async function control(action: 'start' | 'stop' | 'reset') {
    if (action === 'stop') {
      const ok = window.confirm(
        'Kya aap WhatsApp bot disconnect karke NAYA QR code generate karna chahte hain?\n\nPurana connection disconnect ho jayega aur naya QR code show hoga jise scan karke naya connection banaya ja sakega.'
      );
      if (!ok) return;
    }
    setBusy(true);

    // If stopping or resetting, immediately show generating state
    if (action === 'stop' || action === 'reset') {
      setStatus((prev) => prev ? { ...prev, running: true, connected: false, qrDataUrl: null } : null);
    }

    try {
      const res = await fetch(`/api/admin/whatsapp-bot/${action}`, { method: 'POST' });
      const data = await res.json();
      if (data?.ok && data.status) {
        setStatus(data.status);
      }

      if (action === 'start' || action === 'reset' || action === 'stop') {
        setTimeout(async () => {
          try {
            const r = await fetch('/api/admin/whatsapp-bot/status');
            const d = await r.json();
            if (d?.ok) setStatus(d.status);
          } catch {}
        }, 800);
      }
    } catch {}
    setBusy(false);
  }

  const [refreshingGroups, setRefreshingGroups] = useState(false);

  async function handleRefreshGroups() {
    setRefreshingGroups(true);
    try {
      const res = await fetch('/api/admin/whatsapp-bot/refresh-groups', { method: 'POST' });
      const data = await res.json();
      if (data?.ok && data.status) {
        setStatus(data.status);
      }
    } catch {}
    setRefreshingGroups(false);
  }

  async function pickGroup(jid: string, manualName?: string) {
    let name = manualName;
    if (jid === 'all' || !jid) {
      jid = 'all';
      name = 'All Groups (Sabhi Groups)';
    } else if (!name) {
      const group = status?.groups?.find((g) => g.jid === jid);
      name = group?.name || jid;
    }

    try {
      const res = await fetch('/api/admin/whatsapp-bot/select-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jid: jid || '', name: name || '' }),
      });
      const data = await res.json();
      if (data?.ok) {
        setStatus(data.status);
        if (data.status.selectedGroup) {
          localStorage.setItem('wa_bot_saved_group', JSON.stringify(data.status.selectedGroup));
        }
        setIsEditingGroupName(false);
      }
    } catch {}
  }

  async function saveManualGroup() {
    const trimmed = customGroupName.trim();
    if (!trimmed) return;
    const matched = status?.groups?.find((g) => g.name.toLowerCase() === trimmed.toLowerCase());
    await pickGroup(matched ? matched.jid : '', trimmed);
    setCustomGroupName('');
  }

  async function triggerTestPopup() {
    setTestTriggering(true);
    setTestSuccess(false);
    try {
      const res = await fetch('/api/admin/whatsapp-bot/test-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          billNo: '42911',
          amount: 5000,
          method: 'GPay',
          accountName: 'LAXMI TRADERS',
        }),
      });
      const d = await res.json();
      if (d?.ok) {
        setTestSuccess(true);
        setTimeout(() => setTestSuccess(false), 3000);
      }
    } catch {}
    setTestTriggering(false);
  }

  const connected = Boolean(status?.connected);
  const running = Boolean(status?.running);
  const groups = status?.groups || [];
  const selectedGroup = status?.selectedGroup;

  return (
    <div className="bg-card border-2 border-green-500/25 rounded-2xl p-4 sm:p-6 shadow-xl space-y-4 my-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between pb-3 border-b border-border/70 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className={cn(
            'p-3 rounded-2xl border shadow-sm',
            connected ? 'bg-green-500/20 text-green-600 border-green-500/40' : 'bg-gradient-to-tr from-green-500/15 to-emerald-600/15 text-green-600 border-green-500/30'
          )}>
            <MessageSquare className={cn('w-6 h-6', connected && 'animate-pulse')} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-black uppercase text-foreground tracking-wider">
                WhatsApp AI Payment Bot
              </h2>
              <span className={cn(
                'text-white text-[9.5px] font-black px-2.5 py-0.5 rounded-full flex items-center gap-1 tracking-wide shadow-xs',
                connected ? 'bg-green-600' : running ? 'bg-amber-500' : 'bg-muted-foreground'
              )}>
                {connected ? <><CheckCircle2 className="w-3 h-3" /> CONNECTED</> : null}
                {!connected && running ? <><Loader2 className="w-3 h-3 animate-spin" /> WAITING FOR QR SCAN</> : null}
                {!running ? <><XCircle className="w-3 h-3" /> OFF</> : null}
              </span>
              {connected && (
                <span className="text-[9.5px] font-black px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 flex items-center gap-1 shadow-xs">
                  ⚡ ALWAYS ACTIVE (Auto-Scan On)
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground font-semibold mt-0.5">
              WhatsApp group me salesman ya driver ka payment message ya screenshot aate hi, bot auto-detect karke screen par confirmation popup show karega.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Test Popup Trigger */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={triggerTestPopup}
            disabled={testTriggering}
            className="font-bold text-[10px] uppercase tracking-wider px-3 py-1.5 rounded-xl border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10 flex items-center gap-1.5"
            title="App me payment popup test karne ke liye click karein"
          >
            {testTriggering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : testSuccess ? <Check className="w-3.5 h-3.5 text-green-600" /> : <BellRing className="w-3.5 h-3.5" />}
            {testSuccess ? 'Popup Sent!' : 'Test Popup'}
          </Button>

          {/* Quick Change WhatsApp / New QR button when connected */}
          {connected && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => control('stop')}
              disabled={busy}
              className="font-bold text-[10px] uppercase tracking-wider px-2.5 py-1.5 rounded-xl border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10 flex items-center gap-1"
              title="Purana WhatsApp disconnect karke naye WhatsApp ke liye QR code generate karein"
            >
              <QrCode className="w-3.5 h-3.5 text-emerald-600" /> New QR / Change Phone
            </Button>
          )}

          {/* Stop Bot / Connect WhatsApp button */}
          <Button
            type="button"
            size="sm"
            onClick={() => control(running ? 'stop' : 'start')}
            disabled={busy}
            className={cn(
              'font-black text-[11px] uppercase tracking-wider px-4 py-2 rounded-xl shadow-md gap-1.5 text-white',
              running ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'
            )}
            title={running ? 'Bot stop karein aur fresh QR code generate karein' : 'WhatsApp bot start karein'}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : running ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
            {running ? 'Stop Bot' : 'Connect WhatsApp'}
          </Button>
        </div>
      </div>

      {/* ── QR link (shown when linking or when Stop Bot is clicked) ── */}
      {running && !connected && (
        <div className="border-2 border-emerald-500/40 rounded-2xl p-5 bg-gradient-to-br from-emerald-500/10 to-green-500/5 space-y-4 shadow-sm animate-in fade-in">
          <div className="flex items-center justify-between pb-2 border-b border-emerald-500/20">
            <span className="text-xs font-black uppercase tracking-wider text-emerald-800 dark:text-emerald-200 flex items-center gap-1.5">
              <QrCode className="w-4 h-4 text-emerald-600" />
              Scan New QR Code for Connection
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => control('reset')}
              disabled={busy}
              className="h-7 text-[10px] font-bold border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/15 gap-1"
              title="Agar QR scan nahi ho raha to fresh QR generate karein"
            >
              <RefreshCw className={cn('w-3 h-3', busy && 'animate-spin')} />
              Refresh QR Code
            </Button>
          </div>

          {status?.qrDataUrl ? (
            <div className="flex flex-col items-center gap-3">
              <div className="relative p-2.5 bg-white rounded-2xl border-2 border-emerald-500/40 shadow-lg">
                <img
                  src={status.qrDataUrl}
                  alt="WhatsApp QR Code"
                  className="w-52 h-52 rounded-xl object-contain block"
                />
              </div>
              <div className="flex items-start gap-2.5 max-w-md text-center bg-card/80 border border-emerald-500/25 rounded-xl p-3">
                <Smartphone className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <p className="text-[11.5px] font-bold text-foreground leading-relaxed">
                  Apne phone me WhatsApp open karein → <span className="text-emerald-700 dark:text-emerald-300 font-black">Settings → Linked Devices → Link a Device</span> → ye naya QR code scan karein.
                  <span className="block text-[10px] text-muted-foreground font-semibold mt-1">
                    Scan karte hi naya WhatsApp account automatically connect ho jayega aur auto-scan active ho jayega.
                  </span>
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-xs font-bold text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
              <span>Purana session disconnect ho gaya hai — Naya QR code generate ho raha hai...</span>
            </div>
          )}
        </div>
      )}

      {/* ── Group Selection & Permanent Persistence ── */}
      <div className="bg-green-500/10 border-2 border-green-500/40 rounded-xl p-3.5 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 text-xs font-black text-green-800 dark:text-green-200 flex-wrap">
            <Users className="w-4 h-4 shrink-0 text-green-600" />
            <span>Active WhatsApp Group:</span>
            {selectedGroup?.jid === 'all' || selectedGroup?.name?.toLowerCase().includes('all group') || selectedGroup?.name?.toLowerCase().includes('sabhi group') ? (
              <span className="bg-emerald-600 text-white px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-wide flex items-center gap-1 shadow-sm">
                <Check className="w-3 h-3" /> Sabhi Groups (All Groups Auto-Scan)
              </span>
            ) : selectedGroup?.name ? (
              <span className="bg-green-600 text-white px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-wide flex items-center gap-1 shadow-sm">
                <Check className="w-3 h-3" /> {selectedGroup.name}
              </span>
            ) : (
              <span className="text-amber-700 dark:text-amber-300 text-[10px] font-bold uppercase tracking-wide bg-amber-500/20 px-2 py-0.5 rounded-full">
                Sabhi Groups Auto-Scan
              </span>
            )}
            {status?.lastMessageAt && (
              <span className="text-[9.5px] font-semibold text-muted-foreground bg-background/80 px-2 py-0.5 rounded-md border border-border/60">
                Last message: {new Date(status.lastMessageAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRefreshGroups}
              disabled={refreshingGroups || !connected}
              className="h-7 text-[10.5px] font-bold border-green-500/30 text-green-700 dark:text-green-300 hover:bg-green-500/10 px-2.5 rounded-lg flex items-center gap-1"
              title="WhatsApp se sabhi groups list refresh karein"
            >
              <RefreshCw className={cn('w-3 h-3', refreshingGroups && 'animate-spin')} />
              {refreshingGroups ? 'Syncing...' : 'Sync Groups'}
            </Button>
            <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-0.5 rounded-full flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-emerald-600" /> Permanent Saved
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setIsEditingGroupName(!isEditingGroupName);
                setCustomGroupName(selectedGroup?.name || '');
              }}
              className="h-7 text-[10.5px] font-bold text-muted-foreground hover:text-foreground px-2"
            >
              <Edit3 className="w-3.5 h-3.5 mr-1" /> {isEditingGroupName ? 'Cancel' : 'Change / Add'}
            </Button>
          </div>
        </div>

        {/* Dropdown to pick from connected groups */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground flex items-center justify-between">
              <span>WhatsApp Groups List:</span>
              <span className="text-[9px] text-emerald-600 font-bold lowercase">({groups.length} groups found)</span>
            </label>
            <select
              value={
                !selectedGroup?.name ||
                selectedGroup?.jid === 'all' ||
                selectedGroup?.name.toLowerCase().includes('all group') ||
                selectedGroup?.name.toLowerCase().includes('sabhi group')
                  ? 'all'
                  : selectedGroup?.jid || ''
              }
              onChange={(e) => {
                if (e.target.value === 'all') {
                  pickGroup('all', 'All Groups (Sabhi Groups)');
                } else {
                  pickGroup(e.target.value);
                }
              }}
              className="w-full text-xs px-3 py-2 rounded-xl border border-input bg-background font-bold focus:outline-none focus:ring-2 focus:ring-green-500/40"
            >
              <option value="all">★ Sabhi Groups Scan Karein (All Groups / Any Group)</option>
              {groups.map((g) => (
                <option key={g.jid} value={g.jid}>
                  {g.name} {selectedGroup?.name === g.name && selectedGroup?.jid !== 'all' ? '★ (Selected)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Manual group name input */}
          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">
              Ya Group Ka Naam Type / Add Karein:
            </label>
            <div className="flex gap-1.5">
              <input
                type="text"
                placeholder="e.g. KGN TRANSPORT ya DISPATCH GROUP"
                value={customGroupName}
                onChange={(e) => setCustomGroupName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveManualGroup(); }}
                className="flex-1 text-xs px-3 py-2 rounded-xl border border-input bg-background font-bold focus:outline-none focus:ring-2 focus:ring-green-500/40"
              />
              <Button
                type="button"
                size="sm"
                onClick={saveManualGroup}
                className="bg-green-600 hover:bg-green-700 text-white font-bold text-xs px-3 rounded-xl shrink-0"
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
