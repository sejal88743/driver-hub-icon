import express from 'express';
import { supabaseServer } from './supabaseServer.js';

export interface UrgentMessage {
  id: string;
  senderName: string;
  senderRole?: string;
  targetUser: string; // 'ALL' or user name or driver name
  text: string;
  createdAt: string; // ISO string
  active: boolean;
  dismissedBy: string[]; // array of user names who dismissed it
}

const URGENT_SETTINGS_KEY = 'urgent_messages';
const messagesMap = new Map<string, UrgentMessage>();
const sseClients = new Set<express.Response>();

async function persistMessagesToSupabase() {
  try {
    const now = Date.now();
    const list = Array.from(messagesMap.values())
      .filter(m => m && m.createdAt && (now - new Date(m.createdAt).getTime() < 24 * 60 * 60 * 1000))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 100);
    await supabaseServer
      .from('settings')
      .upsert({ key: URGENT_SETTINGS_KEY, value: JSON.stringify(list) }, { onConflict: 'key' });
  } catch (err) {
    console.warn('[UrgentMessages] Supabase persist warning:', err);
  }
}

/**
 * Loads active urgent messages from Supabase settings on startup.
 */
export async function initUrgentMessagesTable() {
  try {
    const { data, error } = await supabaseServer
      .from('settings')
      .select('value')
      .eq('key', URGENT_SETTINGS_KEY)
      .maybeSingle();

    if (!error && data?.value) {
      const parsed = JSON.parse(data.value);
      if (Array.isArray(parsed)) {
        const now = Date.now();
        for (const r of parsed) {
          if (!r || !r.id) continue;
          const age = r.createdAt ? now - new Date(r.createdAt).getTime() : 0;
          if (age < 24 * 60 * 60 * 1000) {
            messagesMap.set(String(r.id), {
              id: String(r.id),
              senderName: String(r.senderName || 'Admin'),
              senderRole: String(r.senderRole || 'owner'),
              targetUser: String(r.targetUser || 'ALL'),
              text: String(r.text || ''),
              active: Boolean(r.active),
              dismissedBy: Array.isArray(r.dismissedBy) ? r.dismissedBy : [],
              createdAt: String(r.createdAt || new Date().toISOString()),
            });
          }
        }
      }
    }
  } catch (err) {
    console.warn('[UrgentMessages] Supabase init warning:', err);
  }
}

function broadcast(event: { type: string; [key: string]: any }) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

export function handleUrgentMessageSse(req: express.Request, res: express.Response) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const activeList = Array.from(messagesMap.values()).filter(m => m.active);
  res.write(`data: ${JSON.stringify({ type: 'init', messages: activeList })}\n\n`);

  sseClients.add(res);

  const pingTimer = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
    } catch {
      clearInterval(pingTimer);
      sseClients.delete(res);
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(pingTimer);
    sseClients.delete(res);
  });
}

export async function createUrgentMessage(params: {
  senderName: string;
  senderRole?: string;
  targetUser: string;
  text: string;
}): Promise<UrgentMessage> {
  const id = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const message: UrgentMessage = {
    id,
    senderName: (params.senderName || 'Admin').trim(),
    senderRole: (params.senderRole || 'owner').trim(),
    targetUser: (params.targetUser || 'ALL').trim(),
    text: (params.text || '').trim(),
    createdAt: new Date().toISOString(),
    active: true,
    dismissedBy: [],
  };

  messagesMap.set(id, message);
  void persistMessagesToSupabase();
  broadcast({ type: 'urgent-message:new', message });

  return message;
}

export async function dismissUrgentMessage(id: string, userName: string): Promise<boolean> {
  const msg = messagesMap.get(id);
  if (!msg) return false;

  const normalizedUser = (userName || '').trim().toLowerCase();
  if (!msg.dismissedBy.some(u => u.toLowerCase() === normalizedUser)) {
    msg.dismissedBy.push(userName.trim());
  }

  if (msg.targetUser !== 'ALL' && msg.targetUser.toLowerCase() === normalizedUser) {
    msg.active = false;
  }

  messagesMap.set(id, msg);
  void persistMessagesToSupabase();
  broadcast({ type: 'urgent-message:dismissed', id, userName, active: msg.active });
  return true;
}

export async function cancelUrgentMessage(id: string): Promise<boolean> {
  const msg = messagesMap.get(id);
  if (!msg) return false;

  msg.active = false;
  messagesMap.set(id, msg);
  void persistMessagesToSupabase();
  broadcast({ type: 'urgent-message:cancelled', id });
  return true;
}

export function getActiveUrgentMessages(userName?: string): UrgentMessage[] {
  const allActive = Array.from(messagesMap.values()).filter(m => m.active);
  if (!userName) return allActive;

  const uLower = userName.trim().toLowerCase();
  return allActive.filter(m => {
    if (m.dismissedBy.some(d => d.toLowerCase() === uLower)) return false;
    if (m.targetUser === 'ALL') return true;
    if (m.targetUser.trim().toLowerCase() === uLower) return true;
    return false;
  });
}

export function getAllUrgentMessages(): UrgentMessage[] {
  return Array.from(messagesMap.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}
