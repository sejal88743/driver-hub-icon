import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
} from '@whiskeysockets/baileys';
import type { WASocket, WAMessage } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import { extractPaymentEntries, WaExtractEntry } from './whatsappExtract.js';
import { pool } from './db.js';

export type WaBotGroup = { jid: string; name: string };

export type WaBotStatus = {
  running: boolean;
  connected: boolean;
  qrDataUrl: string | null;
  error: string | null;
  lastMessageAt: string | null;
  groups: WaBotGroup[];
  selectedGroup: { jid: string; name: string } | null;
};

export type WaPaymentEvent = {
  type: 'wa-payment';
  id: string;
  fromJid: string;
  senderName: string;
  text: string;
  summary: string;
  entries: WaExtractEntry[];
};

let sock: WASocket | null = null;
let running = false;
let status: WaBotStatus = {
  running: false,
  connected: false,
  qrDataUrl: null,
  error: null,
  lastMessageAt: null,
  groups: [],
  selectedGroup: null,
};
let groups: WaBotGroup[] = [];
let selectedGroup: { jid: string; name: string } | null = null;
let paymentEventHandler: ((event: WaPaymentEvent) => void) | null = null;

export function getBotStatus(): WaBotStatus {
  return { ...status, groups, selectedGroup };
}

/** Admin-selected group (persisted in settings) — bot scans only this group. */
export async function selectBotGroup(jid: string, name: string) {
  selectedGroup = jid && name ? { jid, name } : null;
  status.selectedGroup = selectedGroup;
  try {
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('wa_group_jid', $1), ('wa_group_name', $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [jid || '', name || '']
    );
  } catch {}
}

async function loadSavedGroup() {
  try {
    const r = await pool.query(
      `SELECT key, value FROM settings WHERE key IN ('wa_group_jid', 'wa_group_name')`
    );
    const map = Object.fromEntries((r.rows as any[]).map((row) => [row.key, String(row.value || '')]));
    if (map.wa_group_jid && map.wa_group_name) {
      selectedGroup = { jid: map.wa_group_jid, name: map.wa_group_name };
      status.selectedGroup = selectedGroup;
    }
  } catch {}
}

/** Fetch all WhatsApp groups the linked account is a member of. */
async function refreshGroups() {
  try {
    const all: any = await (sock as any)?.groupFetchAllParticipating?.();
    if (all) {
      groups = Object.values(all).map((g: any) => ({ jid: String(g.id), name: String(g.subject || g.id) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      status.groups = groups;
    }
  } catch (err) {
    console.warn('[WhatsApp Bot] group fetch failed:', err);
  }
}

export function setPaymentEventHandler(fn: ((event: WaPaymentEvent) => void) | null) {
  paymentEventHandler = fn;
}

// Baileys expects a pino-style logger — silent no-op keeps it dependency-free.
const silentLogger: any = {
  level: 'silent',
  child() { return silentLogger; },
  trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {},
};

/** Gemini key saved from the admin page (settings table) — NEVER the env/Base44 key. */
async function getGeminiKey(): Promise<string> {
  try {
    const r = await pool.query(`SELECT value FROM settings WHERE key = 'gemini_api_key'`);
    return String((r.rows?.[0] as any)?.value || '').trim();
  } catch {
    return '';
  }
}

function getMessageText(msg: WAMessage): string {
  const m: any = msg.message;
  if (!m) return '';
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    ''
  );
}

async function processMessage(msg: WAMessage) {
  try {
    if (!msg.key || msg.key.fromMe) return;
    const jid = String(msg.key.remoteJid || '');
    if (!jid || jid === 'status@broadcast') return;
    // Only group messages, and only the admin-selected group (if chosen)
    if (!jid.endsWith('@g.us')) return;
    if (selectedGroup && jid !== selectedGroup.jid) return;

    const m: any = msg.message;
    if (!m) return;
    // Skip reactions / protocol / sticker messages
    if (m.reactionMessage || m.protocolMessage || m.stickerMessage) return;

    const text = getMessageText(msg);
    const hasImg = Boolean(m.imageMessage);

    // Only process messages that plausibly contain a bill no / amount (digits) or a screenshot
    if (!hasImg && (!text || !/\d/.test(text))) return;

    status.lastMessageAt = new Date().toISOString();

    let imageBase64: string | undefined;
    let imageMime: string | undefined;
    if (hasImg) {
      try {
        const buf: any = await downloadMediaMessage(msg, 'buffer', {});
        if (buf) {
          imageBase64 = Buffer.from(buf).toString('base64');
          imageMime = m.imageMessage?.mimetype || 'image/jpeg';
        }
      } catch (err) {
        console.warn('[WhatsApp Bot] media download failed:', err);
      }
    }

    const apiKey = await getGeminiKey();
    if (!apiKey) {
      console.warn('[WhatsApp Bot] gemini_api_key settings me saved nahi hai — message skip hua.');
      return;
    }

    const result = await extractPaymentEntries({ apiKey, text: text || undefined, imageBase64, imageMime });
    if (!result.ok || result.entries.length === 0) return;

    const event: WaPaymentEvent = {
      type: 'wa-payment',
      id: `${jid}-${msg.key.id || Date.now()}`,
      fromJid: jid,
      senderName: String(msg.pushName || ''),
      text: text.slice(0, 300),
      summary: result.summary,
      entries: result.entries,
    };
    paymentEventHandler?.(event);
  } catch (err) {
    console.warn('[WhatsApp Bot] processMessage error:', err);
  }
}

async function connect() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState('.wa-session');
    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: silentLogger,
      browser: ['VitraTrack Bot', 'Chrome', '1.0.0'],
      syncFullHistory: false,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u: any) => {
      const { connection, lastDisconnect, qr } = u;
      if (qr) {
        QRCode.toDataURL(qr)
          .then((url: string) => { status.qrDataUrl = url; })
          .catch(() => {});
      }
      if (connection === 'open') {
        status.connected = true;
        status.qrDataUrl = null;
        status.error = null;
        console.log('[WhatsApp Bot] Connected — linked device ready.');
        refreshGroups();
      }
      if (connection === 'close') {
        status.connected = false;
        const code = (lastDisconnect?.error as any)?.output?.statusCode;
        if (running && code !== DisconnectReason.loggedOut) {
          setTimeout(() => { if (running) connect(); }, 3000);
        } else {
          if (code === DisconnectReason.loggedOut) {
            running = false;
            status.running = false;
            status.error = 'WhatsApp device logout ho gaya — dobara QR scan karke link karein.';
          }
        }
      }
    });

    sock.ev.on('messages.upsert', async (up: any) => {
      if (up.type !== 'notify') return;
      for (const msg of up.messages || []) {
        processMessage(msg);
      }
    });
  } catch (err: any) {
    console.error('[WhatsApp Bot] connect failed:', err?.message || err);
    status.error = 'WhatsApp connect failed: ' + (err?.message || err);
    if (running) setTimeout(() => { if (running) connect(); }, 5000);
  }
}

export function startBot() {
  if (running) return;
  loadSavedGroup();
  running = true;
  status.running = true;
  status.error = null;
  status.qrDataUrl = null;
  connect();
}

export function stopBot() {
  running = false;
  status.running = false;
  status.connected = false;
  status.qrDataUrl = null;
  try { sock?.end?.(undefined as any); } catch {}
  sock = null;
}
