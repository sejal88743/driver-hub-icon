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

let _activeMessages: UrgentMessage[] = [];
let _allMessages: UrgentMessage[] = [];
let _eventSource: EventSource | null = null;
let _pollInterval: any = null;
let _hasInitialized = false;

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
 * Checks whether this urgent message is meant for the current user and not yet dismissed by them.
 */
export function isMessageForCurrentUser(msg: UrgentMessage): boolean {
  if (!msg.active) return false;

  const myName = (getLoggedInName() || '').trim().toLowerCase();
  const myRole = (getRole() || '').trim().toLowerCase();

  // If already dismissed by this user
  if (myName && msg.dismissedBy.some(u => u.trim().toLowerCase() === myName)) {
    return false;
  }

  // ALL users target
  const target = (msg.targetUser || '').trim().toLowerCase();
  if (target === 'all' || target === 'all users' || target === 'sabhi' || target === '') {
    return true;
  }

  // Exact name or role match
  if (myName && target === myName) return true;
  if (myRole && target === myRole) return true;

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
 * Fetch latest active messages from server.
 */
export async function syncActiveMessages() {
  try {
    const res = await fetch('/api/urgent-messages/active');
    if (!res.ok) return;
    const data = await res.json();
    if (data.ok && Array.isArray(data.messages)) {
      const prevActiveIds = new Set(_activeMessages.map(m => m.id));
      _activeMessages = dedupeMessages(data.messages);

      // Check if a new message arrived that targets this user
      const currentPopup = getCurrentUserActivePopup();
      if (currentPopup && !prevActiveIds.has(currentPopup.id)) {
        playUrgentAlertSound();
      }

      notifyListeners();
    }
  } catch {}
}

/**
 * Fetch all messages for management view.
 */
export async function syncAllMessages() {
  try {
    const res = await fetch('/api/urgent-messages/all');
    if (!res.ok) return;
    const data = await res.json();
    if (data.ok && Array.isArray(data.messages)) {
      _allMessages = dedupeMessages(data.messages);
      notifyListeners();
    }
  } catch {}
}

/**
 * Initialize SSE connection and fallback polling.
 */
export function initUrgentMessageClient() {
  if (_hasInitialized || typeof window === 'undefined') return;
  _hasInitialized = true;

  // Immediate sync
  syncActiveMessages();
  syncAllMessages();

  // Set up SSE stream
  function connectSse() {
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
            
            if (isMessageForCurrentUser(newMsg)) {
              playUrgentAlertSound();
            }
            notifyListeners();
          } else if (payload.type === 'urgent-message:dismissed') {
            const { id, userName, active } = payload;
            _activeMessages = dedupeMessages(
              _activeMessages.map(m => {
                if (m.id === id) {
                  const dismissed = [...m.dismissedBy];
                  if (!dismissed.includes(userName)) dismissed.push(userName);
                  return { ...m, dismissedBy: dismissed, active: active !== undefined ? active : m.active };
                }
                return m;
              }).filter(m => m.active)
            );
            notifyListeners();
          } else if (payload.type === 'urgent-message:cancelled') {
            // SENDER CANCELLED/CLOSED MESSAGE: IMMEDIATELY CLOSE IT FOR ALL CLIENTS
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
        // Reconnect after 4s
        setTimeout(connectSse, 4000);
      };
    } catch {}
  }

  connectSse();

  // Fallback poll every 4 seconds to guarantee sync even across background tab throttles
  _pollInterval = setInterval(() => {
    syncActiveMessages();
  }, 4000);
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
 */
export async function sendUrgentMessage(params: {
  targetUser: string;
  text: string;
}): Promise<{ ok: boolean; message?: UrgentMessage; error?: string }> {
  try {
    const senderName = getLoggedInName() || 'Owner';
    const senderRole = getRole() || 'owner';

    const res = await fetch('/api/urgent-messages/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        senderName,
        senderRole,
        targetUser: params.targetUser,
        text: params.text,
      }),
    });

    const data = await res.json();
    if (data.ok && data.message) {
      _activeMessages = dedupeMessages([..._activeMessages.filter(m => m.id !== data.message.id), data.message]);
      _allMessages = dedupeMessages([data.message, ..._allMessages.filter(m => m.id !== data.message.id)]);
      notifyListeners();
      return { ok: true, message: data.message };
    }
    return { ok: false, error: data.error || 'Failed to send' };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Network error' };
  }
}

/**
 * Recipient dismisses the message on their device.
 */
export async function dismissUrgentMessage(id: string): Promise<boolean> {
  const userName = getLoggedInName() || 'User';
  
  // Optimistically remove locally
  _activeMessages = dedupeMessages(
    _activeMessages.map(m => {
      if (m.id === id) {
        const dismissed = [...m.dismissedBy];
        if (!dismissed.includes(userName)) dismissed.push(userName);
        return { ...m, dismissedBy: dismissed };
      }
      return m;
    })
  );
  notifyListeners();

  try {
    const res = await fetch('/api/urgent-messages/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, userName }),
    });
    const data = await res.json();
    return Boolean(data.ok);
  } catch {
    return false;
  }
}

/**
 * Sender cancels / stops the message ("ME BAND KARU TOBHI BAND HO JAYE GA").
 * Immediately makes active = false on server and removes it everywhere!
 */
export async function cancelUrgentMessage(id: string): Promise<boolean> {
  // Optimistically remove from active list locally
  _activeMessages = _activeMessages.filter(m => m.id !== id);
  _allMessages = dedupeMessages(_allMessages.map(m => m.id === id ? { ...m, active: false } : m));
  notifyListeners();

  try {
    const res = await fetch('/api/urgent-messages/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const data = await res.json();
    return Boolean(data.ok);
  } catch {
    return false;
  }
}
