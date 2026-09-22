import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquare, QrCode, Loader2, Power, PowerOff, CheckCircle2, XCircle,
  Key, Smartphone, RefreshCw, Bell,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type BotStatus = {
  running: boolean;
  connected: boolean;
  qrDataUrl: string | null;
  error: string | null;
  lastMessageAt: string | null;
};

export function WhatsAppLiveBot() {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('gemini_api_key') || '';
    }
    return '';
  });
  const [keySaved, setKeySaved] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll bot status so QR + connection state stay live
  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch('/api/admin/whatsapp-bot/status');
        const data = await res.json();
        if (data?.ok) setStatus(data.status);
      } catch {}
    }
    poll();
    pollRef.current = setInterval(poll, 4000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  async function control(action: 'start' | 'stop') {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/whatsapp-bot/${action}`, { method: 'POST' });
      const data = await res.json();
      if (data?.ok) setStatus(data.status);
    } catch {}
    setBusy(false);
  }

  async function saveKey() {
    const value = key.trim();
    if (typeof window !== 'undefined') {
      if (value) localStorage.setItem('gemini_api_key', value);
      else localStorage.removeItem('gemini_api_key');
    }
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'gemini_api_key', value }),
      });
    } catch {}
    setKeySaved(true);
    setTimeout(() => setKeySaved(false), 2500);
  }

  const connected = status?.connected;
  const running = status?.running;

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
                WhatsApp Live Bot (Linked Device)
              </h2>
              <span className={cn(
                'text-white text-[9.5px] font-black px-2.5 py-0.5 rounded-full flex items-center gap-1 tracking-wide shadow-xs',
                connected ? 'bg-green-600' : running ? 'bg-amber-500' : 'bg-muted-foreground'
              )}>
                {connected ? <><CheckCircle2 className="w-3 h-3" /> CONNECTED</> : null}
                {!connected && running ? <><Loader2 className="w-3 h-3 animate-spin" /> WAITING FOR QR SCAN</> : null}
                {!running ? <><XCircle className="w-3 h-3" /> OFF</> : null}
              </span>
            </div>
            <p className="text-xs text-muted-foreground font-semibold mt-0.5">
              WhatsApp device ko app se link karo (WhatsApp ke inbuilt Linked Device se). Payment message aate hi app me confirmation popup aayega — confirm karne ke bad hi save hoga.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
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
            {running ? 'Stop Bot' : 'Start Bot'}
          </Button>
        </div>
      </div>

      {/* ── Status / QR ── */}
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

      {connected && (
        <div className="bg-green-500/10 border border-green-500/40 rounded-xl px-3.5 py-2.5 text-[11px] font-bold text-green-700 dark:text-green-300 flex items-center gap-2">
          <Bell className="w-4 h-4 shrink-0 animate-pulse" />
          Bot live hai! WhatsApp group me payment message aate hi app me confirmation popup dikhega (bill details + payment details ke sath). Confirm karne par hi entry save hogi.
        </div>
      )}

      {status?.error && (
        <div className="bg-red-500/10 border border-red-500/40 text-red-600 dark:text-red-400 px-3.5 py-2.5 rounded-xl text-[11px] font-bold flex items-start gap-2">
          <XCircle className="w-4 h-4 shrink-0 mt-0.5" /> {status.error}
        </div>
      )}

      {/* ── Gemini API Key (bot uses this — server-side saved) ── */}
      <div className="bg-muted/50 border border-green-500/20 rounded-xl p-3.5 space-y-2">
        <label className="text-[10.5px] font-black uppercase tracking-wider text-foreground flex items-center gap-1.5">
          <Key className="w-3.5 h-3.5 text-amber-500" /> Gemini API Key (Bot ke liye — admin page ki key):
        </label>
        <div className="flex gap-2">
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="AIzaSy..."
            className="flex-1 text-xs px-3.5 py-2 rounded-xl border border-input bg-background font-mono focus:outline-none focus:ring-2 focus:ring-green-500/40"
          />
          <Button
            type="button"
            size="sm"
            onClick={saveKey}
            className="bg-green-600 hover:bg-green-700 text-white font-black text-[10px] uppercase tracking-wider px-4 rounded-xl gap-1.5"
          >
            {keySaved ? <><CheckCircle2 className="w-3.5 h-3.5" /> Saved</> : <><RefreshCw className="w-3.5 h-3.5" /> Save Key</>}
          </Button>
        </div>
        <p className="text-[9.5px] text-muted-foreground font-medium">
          WhatsApp Live Bot ye hi saved key use karta hai (admin page wali). Key server pe settings me save hoti hai taki bot background me messages process kar sake.
        </p>
      </div>
    </div>
  );
}
