import express from 'express';
import { pool } from './db.js';

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

// In-memory store of messages (always fast & resilient)
const messagesMap = new Map<string, UrgentMessage>();
const sseClients = new Set<express.Response>();

/**
 * Initializes the Postgres table for persistent message storage if available.
 */
export async function initUrgentMessagesTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS urgent_messages (
        id text PRIMARY KEY,
        sender_name text NOT NULL DEFAULT '',
        sender_role text NOT NULL DEFAULT '',
        target_user text NOT NULL DEFAULT 'ALL',
        text text NOT NULL DEFAULT '',
        active boolean NOT NULL DEFAULT true,
        dismissed_by jsonb DEFAULT '[]'::jsonb,
        created_at timestamptz DEFAULT now()
      );
    `);

    // Load active messages from the last 24 hours into memory
    const { rows } = await pool.query(
      `SELECT * FROM urgent_messages WHERE active = true AND created_at > now() - interval '24 hours' ORDER BY created_at DESC LIMIT 50`
    );
    for (const r of rows) {
      if (!messagesMap.has(r.id)) {
        messagesMap.set(r.id, {
          id: String(r.id),
          senderName: String(r.sender_name || 'Admin'),
          senderRole: String(r.sender_role || 'owner'),
          targetUser: String(r.target_user || 'ALL'),
          text: String(r.text || ''),
          active: Boolean(r.active),
          dismissedBy: Array.isArray(r.dismissed_by) ? r.dismissed_by : [],
          createdAt: new Date(r.created_at).toISOString(),
        });
      }
    }
    console.log(`[UrgentMessages] Loaded ${messagesMap.size} active messages into memory.`);
  } catch (err) {
    console.warn('[UrgentMessages] Table init warning (continuing with in-memory):', err);
  }
}

/**
 * Broadcast an event to all connected SSE clients.
 */
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

/**
 * Handles incoming SSE connections for real-time urgent message popups.
 */
export function handleUrgentMessageSse(req: express.Request, res: express.Response) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  // Send initial list of all active messages
  const activeList = Array.from(messagesMap.values()).filter(m => m.active);
  res.write(`data: ${JSON.stringify({ type: 'init', messages: activeList })}\n\n`);

  sseClients.add(res);

  // Keep-alive heartbeat ping every 25 seconds
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

/**
 * Creates and broadcasts a new urgent message.
 */
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

  // Persist to Postgres asynchronously
  try {
    await pool.query(
      `INSERT INTO urgent_messages (id, sender_name, sender_role, target_user, text, active, dismissed_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET active = EXCLUDED.active, text = EXCLUDED.text`,
      [message.id, message.senderName, message.senderRole, message.targetUser, message.text, true, JSON.stringify([]), message.createdAt]
    );
  } catch (err) {
    console.warn('[UrgentMessages] DB insert note:', err);
  }

  // Broadcast to all connected clients
  broadcast({ type: 'urgent-message:new', message });

  return message;
}

/**
 * Recipient closes/dismisses the popup on their device.
 */
export async function dismissUrgentMessage(id: string, userName: string): Promise<boolean> {
  const msg = messagesMap.get(id);
  if (!msg) return false;

  const normalizedUser = (userName || '').trim().toLowerCase();
  if (!msg.dismissedBy.some(u => u.toLowerCase() === normalizedUser)) {
    msg.dismissedBy.push(userName.trim());
  }

  // If this message was specifically targeted to this user (not 'ALL'), mark it inactive too
  if (msg.targetUser !== 'ALL' && msg.targetUser.toLowerCase() === normalizedUser) {
    msg.active = false;
  }

  messagesMap.set(id, msg);

  try {
    await pool.query(
      `UPDATE urgent_messages SET active = $1, dismissed_by = $2 WHERE id = $3`,
      [msg.active, JSON.stringify(msg.dismissedBy), id]
    );
  } catch (err) {
    console.warn('[UrgentMessages] DB dismiss update note:', err);
  }

  broadcast({ type: 'urgent-message:dismissed', id, userName, active: msg.active });
  return true;
}

/**
 * Sender cancels / closes the message ("ME BAND KARU TOBHI BAND HO JAYE GA").
 * Immediately makes active = false and broadcasts to all clients so the popup vanishes everywhere!
 */
export async function cancelUrgentMessage(id: string): Promise<boolean> {
  const msg = messagesMap.get(id);
  if (!msg) return false;

  msg.active = false;
  messagesMap.set(id, msg);

  try {
    await pool.query(`UPDATE urgent_messages SET active = false WHERE id = $1`, [id]);
  } catch (err) {
    console.warn('[UrgentMessages] DB cancel update note:', err);
  }

  broadcast({ type: 'urgent-message:cancelled', id });
  return true;
}

/**
 * Get all active messages suitable for a specific user, or all active messages if no user is specified.
 */
export function getActiveUrgentMessages(userName?: string): UrgentMessage[] {
  const allActive = Array.from(messagesMap.values()).filter(m => m.active);
  if (!userName) return allActive;

  const uLower = userName.trim().toLowerCase();
  return allActive.filter(m => {
    // Check if dismissed by this user
    if (m.dismissedBy.some(d => d.toLowerCase() === uLower)) return false;

    // Check if targeted to ALL or to this user
    if (m.targetUser === 'ALL') return true;
    if (m.targetUser.trim().toLowerCase() === uLower) return true;

    return false;
  });
}

/**
 * Get all messages (active or recent) for admin management view.
 */
export function getAllUrgentMessages(): UrgentMessage[] {
  return Array.from(messagesMap.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}
