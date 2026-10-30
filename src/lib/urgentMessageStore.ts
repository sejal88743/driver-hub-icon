import { supabase } from './supabase';
import { getLoggedInName, getRole } from './auth';

export interface UrgentMessage {
  id: string;
  senderName: string;
  senderRole?: string;
  targetUser: string;
  text: string;
  createdAt: string;
  active: boolean;
  dismissedBy: string[];
}

type Listener = () => void;
const listeners = new Set<Listener>();

const URGENT_SETTINGS_KEY = 'urgent_messages';

let _activeMessages: UrgentMessage[] = [];
let _allMessages: UrgentMessage[] = [];
let _eventSource: EventSource | null = null;
let _pollInterval: any = null;
let _hasInitialized = false;
const playedSoundIds = new Set<string>();

// Audio beep notification using Web Audio API
function playUrgentAlertSound() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    
    // First high tone
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(880, ctx.currentTime);
    gain1.gain.setValueAtTime(0.25, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.25);

    // Second alert tone
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(1174, ctx.currentTime + 0.28);
    gain2.gain.setValueAtTime(0.28, ctx.currentTime + 0.28);
    gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.55);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(ctx.currentTime + 0.28);
    osc2.stop(ctx.currentTime + 0.55);
  } catch {}
}

function notifyListeners() {
  for (const listener of listeners) {
    try {
      listener();
    } catch (e) {
      console.warn('[UrgentMessageStore] Listener error:', e);
    }
  }
}

function dedupeMessages(list: UrgentMessage[]): UrgentMessage[] {
  if (!Array.isArray(list)) return [];
  const map = new Map<string, UrgentMessage>();
  for (const item of list) {
    if (item && item.id) {
      map.set(item.id, item);
    }
  }
  return Array.from(map.values());
}

/**
 * Read persistent urgent messages directly from Supabase (works cross-device).
 */
async function fetchSupabaseMessages(): Promise<UrgentMessage[]> {
  try {
    const { data, error } = await supabase
      .from('settings')
      .select('value')
      .eq('key', URGENT_SETTINGS_KEY)
      .maybeSingle();

    if (error || !data?.value) return [];
    const parsed = JSON.parse(data.value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Persist urgent messages to Supabase settings table.
 */
async function persistSupabaseMessages(messages: UrgentMessage[]): Promise<boolean> {
  try {
    const jsonStr = JSON.stringify(messages);
    const { error } = await supabase
      .from('settings')
      .upsert({ key: URGENT_SETTINGS_KEY, value: jsonStr }, { onConflict: 'key' });
    return !error;
  } catch (e) {
    console.warn('[UrgentMessageStore] Supabase save error:', e);
    return false;
  }
}

/**
 * Checks whether this urgent message is meant for the current user and not yet dismissed by them.
 */
export function isMessageForCurrentUser(msg: UrgentMessage): boolean {
  if (!msg || !msg.active) return false;

  const myName = (getLoggedInName() || '').trim().toLowerCase();
  const myRole = (getRole() || '').trim().toLowerCase();

  // Urgent messages are strictly for internal office users and owner - never for drivers
  if (!myRole || myRole === 'driver') {
    return false;
  }

  // If already dismissed by this user
  if (myName && Array.isArray(msg.dismissedBy) && msg.dismissedBy.some(u => u.trim().toLowerCase() === myName)) {
    return false;
  }

  // ALL users target (delivers to all logged-in internal office users & owner)
  const target = (msg.targetUser || '').trim().toLowerCase();
  if (target === 'all' || target === 'all users' || target === 'sabhi' || target === '') {
    return true;
  }

  // Role matching
  if (target === 'user' && myRole === 'user') return true;
  if (target === 'owner' && myRole === 'owner') return true;

  // Exact name match (case-insensitive)
  if (myName && target === myName) return true;

  // Partial name match (e.g. "PRATIXA" vs "Pratixa")
  if (myName && target && (myName.includes(target) || target.includes(myName))) return true;

  return false;
}

/**
 * Get active message currently applicable to this user (the latest un-dismissed one).
 */
export function getCurrentUserActivePopup(): UrgentMessage | null {
  const applicable = _activeMessages.filter(isMessageForCurrentUser);
  if (applicable.length === 0) return null;
  // Return the most recent one
  return applicable[applicable.length - 1];
}

/**
 * Get all active messages for admin view.
 */
export function getActiveMessages(): UrgentMessage[] {
  return dedupeMessages(_activeMessages);
}

/**
 * Get all messages (active and recent) for admin view.
 */
export function getAllMessages(): UrgentMessage[] {
  return dedupeMessages(_allMessages);
}

/**
 * Fetch latest active messages from Supabase (and local server fallback).
 */
export async function syncActiveMessages() {
  const prevActiveIds = new Set(_activeMessages.map(m => m.id));

  // 1. Primary: Fetch from Supabase (guaranteed cross-device sync)
  const remoteMessages = await fetchSupabaseMessages();
  const now = Date.now();
  const freshMessages = remoteMessages.filter(m => {
    if (!m || !m.createdAt) return false;
    const msgAge = now - new Date(m.createdAt).getTime();
    return msgAge < 24 * 60 * 60 * 1000; // keep within 24 hours
  });

  if (freshMessages.length > 0 || remoteMessages.length > 0) {
    _allMessages = dedupeMessages(freshMessages);
    _activeMessages = freshMessages.filter(m => m.active);

    const currentPopup = getCurrentUserActivePopup();
    if (currentPopup && !prevActiveIds.has(currentPopup.id) && !playedSoundIds.has(currentPopup.id)) {
      playedSoundIds.add(currentPopup.id);
      playUrgentAlertSound();
    }
    notifyListeners();
  }

  // 2. Secondary: If local express server is running, fetch its cache too
  try {
    const res = await fetch('/api/urgent-messages/active', {
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(1500) : undefined,
    });
    const cType = res.headers.get('content-type') || '';
    if (res.ok && cType.includes('application/json')) {
      const data = await res.json();
      if (data.ok && Array.isArray(data.messages)) {
        const merged = dedupeMessages([..._activeMessages, ...data.messages.filter((m: any) => m.active)]);
        _activeMessages = merged;
        notifyListeners();
      }
    }
  } catch {}
}

/**
 * Fetch all messages for management view.
 */
export async function syncAllMessages() {
  const remote = await fetchSupabaseMessages();
  if (remote.length > 0) {
    _allMessages = dedupeMessages(remote);
    notifyListeners();
  }

  try {
    const res = await fetch('/api/urgent-messages/all', {
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(1500) : undefined,
    });
    const cType = res.headers.get('content-type') || '';
    if (res.ok && cType.includes('application/json')) {
      const data = await res.json();
      if (data.ok && Array.isArray(data.messages)) {
        _allMessages = dedupeMessages([..._allMessages, ...data.messages]);
        notifyListeners();
      }
    }
  } catch {}
}

/**
 * Initialize SSE connection, Supabase Realtime and periodic polling.
 */
export function initUrgentMessageClient() {
  if (_hasInitialized || typeof window === 'undefined') return;
  _hasInitialized = true;

  // Immediate sync
  syncActiveMessages();
  syncAllMessages();

  // Supabase Realtime listener on settings table
  try {
    supabase
      .channel('vt_urgent_messages_channel')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'settings', filter: `key=eq.${URGENT_SETTINGS_KEY}` },
        () => {
          syncActiveMessages();
        }
      )
      .subscribe();
  } catch (err) {
    console.warn('[UrgentMessageStore] Realtime subscription note:', err);
  }

  // Fast polling interval (every 2.5s) to guarantee arrival across all devices & background tabs
  _pollInterval = setInterval(() => {
    syncActiveMessages();
  }, 2500);

  // Optional local SSE connection (with automatic error suppression if running on static/proxy)
  let sseDisabled = false;
  function connectSse() {
    if (sseDisabled) return;
    try {
      if (_eventSource) {
        _eventSource.close();
      }
      _eventSource = new EventSource('/api/urgent-messages/stream');

      _eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'init' && Array.isArray(payload.messages)) {
            _activeMessages = dedupeMessages(payload.messages);
            notifyListeners();
          } else if (payload.type === 'urgent-message:new' && payload.message) {
            const newMsg = payload.message as UrgentMessage;
            _activeMessages = dedupeMessages([..._activeMessages.filter(m => m.id !== newMsg.id), newMsg]);
            _allMessages = dedupeMessages([newMsg, ..._allMessages.filter(m => m.id !== newMsg.id)]);
            
            if (isMessageForCurrentUser(newMsg) && !playedSoundIds.has(newMsg.id)) {
              playedSoundIds.add(newMsg.id);
              playUrgentAlertSound();
            }
            notifyListeners();
          } else if (payload.type === 'urgent-message:dismissed') {
            const { id, userName, active } = payload;
            _activeMessages = dedupeMessages(
              _activeMessages.map(m => {
                if (m.id === id) {
                  const dismissed = [...(m.dismissedBy || [])];
                  if (!dismissed.includes(userName)) dismissed.push(userName);
                  return { ...m, dismissedBy: dismissed, active: active !== undefined ? active : m.active };
                }
                return m;
              }).filter(m => m.active)
            );
            notifyListeners();
          } else if (payload.type === 'urgent-message:cancelled') {
            const { id } = payload;
            _activeMessages = _activeMessages.filter(m => m.id !== id);
            _allMessages = dedupeMessages(_allMessages.map(m => m.id === id ? { ...m, active: false } : m));
            notifyListeners();
          }
        } catch {}
      };

      _eventSource.onerror = () => {
        try { _eventSource?.close(); } catch {}
        _eventSource = null;
        // If SSE fails (e.g. on static/preview host), do not retry continuously
        sseDisabled = true;
      };
    } catch {
      sseDisabled = true;
    }
  }

  // Only try SSE on full-stack dev origin
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    connectSse();
  }
}

/**
 * Subscribe to urgent message store updates in React components.
 */
export function subscribeUrgentMessages(listener: Listener): () => void {
  initUrgentMessageClient();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Send a new urgent message to all or specific users.
 * Saved immediately to Supabase so it reaches ALL devices instantly!
 */
export async function sendUrgentMessage(params: {
  targetUser: string;
  text: string;
}): Promise<{ ok: boolean; message?: UrgentMessage; error?: string }> {
  try {
    const senderName = getLoggedInName() || 'Owner';
    const senderRole = getRole() || 'owner';

    const newMsg: UrgentMessage = {
      id: `urg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      senderName,
      senderRole,
      targetUser: params.targetUser,
      text: params.text,
      createdAt: new Date().toISOString(),
      active: true,
      dismissedBy: [],
    };

    // 1. Fetch current messages from Supabase
    const existing = await fetchSupabaseMessages();
    const updated = [newMsg, ...existing.filter(m => m.id !== newMsg.id)].slice(0, 100);

    // 2. Persist to Supabase (cross-device authoritative sync)
    await persistSupabaseMessages(updated);

    // 3. Update local state
    _activeMessages = dedupeMessages([newMsg, ..._activeMessages]);
    _allMessages = dedupeMessages([newMsg, ..._allMessages]);
    notifyListeners();

    // 4. Secondary: Post to local server if available
    try {
      fetch('/api/urgent-messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderName,
          senderRole,
          targetUser: params.targetUser,
          text: params.text,
        }),
      }).catch(() => {});
    } catch {}

    return { ok: true, message: newMsg };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to send message' };
  }
}

/**
 * Recipient dismisses the message on their device.
 * Updates Supabase so dismissal is synced.
 */
export async function dismissUrgentMessage(id: string): Promise<boolean> {
  const userName = getLoggedInName() || 'User';
  
  // Optimistically remove locally
  _activeMessages = dedupeMessages(
    _activeMessages.map(m => {
      if (m.id === id) {
        const dismissed = [...(m.dismissedBy || [])];
        if (!dismissed.includes(userName)) dismissed.push(userName);
        return { ...m, dismissedBy: dismissed };
      }
      return m;
    })
  );
  notifyListeners();

  // Update Supabase
  try {
    const existing = await fetchSupabaseMessages();
    const updated = existing.map(m => {
      if (m.id === id) {
        const dismissed = [...(m.dismissedBy || [])];
        if (!dismissed.includes(userName)) dismissed.push(userName);
        return { ...m, dismissedBy: dismissed };
      }
      return m;
    });
    await persistSupabaseMessages(updated);
  } catch {}

  // Local server mirror
  try {
    fetch('/api/urgent-messages/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, userName }),
    }).catch(() => {});
  } catch {}

  return true;
}

/**
 * Sender cancels / stops the message ("ME BAND KARU TOBHI BAND HO JAYE GA").
 * Immediately makes active = false in Supabase and removes it everywhere!
 */
export async function cancelUrgentMessage(id: string): Promise<boolean> {
  // Optimistically remove from active list locally
  _activeMessages = _activeMessages.filter(m => m.id !== id);
  _allMessages = dedupeMessages(_allMessages.map(m => m.id === id ? { ...m, active: false } : m));
  notifyListeners();

  // Update Supabase
  try {
    const existing = await fetchSupabaseMessages();
    const updated = existing.map(m => (m.id === id ? { ...m, active: false } : m));
    await persistSupabaseMessages(updated);
  } catch {}

  // Local server mirror
  try {
    fetch('/api/urgent-messages/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).catch(() => {});
  } catch {}

  return true;
}
