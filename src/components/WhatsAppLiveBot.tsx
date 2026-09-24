import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquare, QrCode, Loader2, Power, PowerOff, CheckCircle2, XCircle,
  Users, Smartphone,
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
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll bot status so QR + connection state stay live
  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch('/api/admin/whatsapp-bot/status');
        if (res.status === 404 || !(res.headers.get('content-type') || '').includes('application/json')) {
          setStatus({
            running: false,
            connected: false,
            qrDataUrl: null,
            error: 'WhatsApp Bot ke liye Node.js server chahiye. Lovable static hosting me bot run nahi ho sakta.',
            groups: [],
            selectedGroup: null,
          });
          return;
        }
        const data = await res.json();
        if (data?.ok) {
          setStatus(data.status);
          // Auto-start if session exists but bot was idle
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
        'Kya aap sach me WhatsApp bot stop karna chahte hain? Stop karne par group messages auto-scan nahi honge.'
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/whatsapp-bot/${action}`, { method: 'POST' });
      if (res.status === 404 || !(res.headers.get('content-type') || '').includes('application/json')) {
        setStatus({
          running: false,
          connected: false,
          qrDataUrl: null,
          error: 'WhatsApp Bot ke liye Node.js server chahiye. Static hosting me ye feature supported nahi hai.',
          groups: [],
          selectedGroup: null,
        });
        setBusy(false);
        return;
      }
      const data = await res.json();
      if (data?.ok) setStatus(data.status);

      // Fast polls immediately after trigger to grab the QR code without waiting
      if (action === 'start' || action === 'reset') {
        setTimeout(async () => {
          try {
            const r = await fetch('/api/admin/whatsapp-bot/status');
            const d = await r.json();
            if (d?.ok) setStatus(d.status);
          } catch {}
        }, 800);
        setTimeout(async () => {
          try {
            const r = await fetch('/api/admin/whatsapp-bot/status');
            const d = await r.json();
            if (d?.ok) setStatus(d.status);
          } catch {}
        }, 2000);
      }
    } catch {}
    setBusy(false);
  }

  async function pickGroup(jid: string) {
    const group = status?.groups?.find((g) => g.jid === jid);
    try {
      const res = await fetch('/api/admin/whatsapp-bot/select-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jid: group?.jid || '', name: group?.name || '' }),
      });
      const data = await res.json();
      if (data?.ok) setStatus(data.status);
    } catch {}
  }

  const connected = status?.connected;
  const running = status?.running;
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
                  ⚡ ALWAYS ACTIVE (Auto-Reconnect Enabled)
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground font-semibold mt-0.5">
              Bot aapke WhatsApp se live linked rehta hai — group me payment message aate hi khud scan karke app me confirmation popup dikhata hai. Koi manual upload nahi chahiye.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {running && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => control('reset')}
              disabled={busy}
              className="font-bold text-[10px] uppercase tracking-wider px-2.5 py-1.5 rounded-xl border-amber-500/40 text-amber-600 hover:bg-amber-500/10"
              title="Session clear karke fresh QR generate karein"
            >
              Reset Session
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            onClick={() => control(running ? 'stop' : 'start')}
            disabled={busy}
            className={cn(
              'font-black text-[11px] uppercase tracking-wider px-4 py-2 rounded-xl shadow-md gap-1.5 text-white',
              running ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'
            )}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : running ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
            {running ? 'Stop Bot' : 'Connect WhatsApp'}
          </Button>
        </div>
      </div>

      {/* ── QR link (only while linking) ── */}
      {running && !connected && (
        <div className="border-2 border-dashed border-green-400/40 rounded-2xl p-4 bg-green-500/5 space-y-3">
          {status?.qrDataUrl ? (
            <div className="flex flex-col items-center gap-3">
              <img
                src={status.qrDataUrl}
                alt="WhatsApp QR Code"
                className="w-48 h-48 rounded-xl border border-green-400/40 bg-white p-2 shadow-md"
              />
              <div className="flex items-start gap-2.5 text-center">
                <Smartphone className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                <p className="text-[11px] font-bold text-foreground leading-relaxed">
                  Phone me WhatsApp kholo → <span className="text-green-700">Settings → Linked Devices → Link a Device</span> → ye QR scan karo.
                  <span className="block text-[10px] text-muted-foreground font-semibold mt-1">QR code har 20 second refresh hota hai — purana scan na ho paye to naya aane do.</span>
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 py-6 text-xs font-bold text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> QR code generate ho raha hai...
            </div>
          )}
        </div>
      )}

      {/* ── Connected: group name ── */}
      {connected && (
        <div className="bg-green-500/10 border border-green-500/40 rounded-xl px-3.5 py-3 space-y-2.5">
          <div className="flex items-center gap-2 text-[11px] font-bold text-green-700 dark:text-green-300">
            <Users className="w-4 h-4 shrink-0" />
            Scan Group:
            {selectedGroup ? (
              <span className="bg-green-600 text-white px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide">{selectedGroup.name}</span>
            ) : (
              <span className="text-muted-foreground text-[10px] uppercase tracking-wide">Koi group select nahi hua</span>
            )}
          </div>
          <select
            value={selectedGroup?.jid || ''}
            onChange={(e) => pickGroup(e.target.value)}
            className="w-full text-xs px-3.5 py-2 rounded-xl border border-input bg-background font-bold focus:outline-none focus:ring-2 focus:ring-green-500/40"
          >
            <option value="">-- Scan karne ke liye group select karo --</option>
            {groups.map((g) => (
              <option key={g.jid} value={g.jid}>{g.name}</option>
            ))}
          </select>
          <p className="text-[9.5px] text-muted-foreground font-medium leading-relaxed">
            {selectedGroup
              ? `Bot sirf "${selectedGroup.name}" group ke messages scan karega — payment message aate hi confirmation popup aayega, confirm karne ke bad hi entry save hogi.`
              : 'Upar apna WhatsApp group select karo — tabhi bot us group ke payment messages scan karega. (Admin page ki saved Gemini key bot khud use karta hai.)'}
          </p>
        </div>
      )}

      {status?.error && (
        <div className="bg-red-500/10 border border-red-500/40 text-red-600 dark:text-red-400 px-3.5 py-2.5 rounded-xl text-[11px] font-bold flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-start gap-2">
            <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{status.error}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => control('reset')}
              disabled={busy}
              className="h-7 text-[10px] font-bold uppercase border-red-500/40 text-red-600 hover:bg-red-500/10 rounded-lg px-2.5"
            >
              Reset & Retry
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
