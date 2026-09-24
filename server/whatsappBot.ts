import type { WASocket, WAMessage } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import fs from 'fs';
import { extractPaymentEntries, WaExtractEntry } from './whatsappExtract.js';
import { pool } from './db.js';

let BaileysModule: any = null;
let makeWASocket: any = null;
let useMultiFileAuthState: any = null;
let DisconnectReason: any = null;
let downloadMediaMessage: any = null;
let fetchLatestWaWebVersion: any = null;
let Browsers: any = null;

async function loadBaileys(): Promise<boolean> {
  if (BaileysModule) return true;
  try {
    BaileysModule = await import('@whiskeysockets/baileys');
    makeWASocket =
      BaileysModule.default?.default ||
      BaileysModule.makeWASocket ||
      BaileysModule.default;
    useMultiFileAuthState =
      BaileysModule.useMultiFileAuthState ||
      BaileysModule.default?.useMultiFileAuthState;
    DisconnectReason =
      BaileysModule.DisconnectReason ||
      BaileysModule.default?.DisconnectReason;
    downloadMediaMessage =
      BaileysModule.downloadMediaMessage ||
      BaileysModule.default?.downloadMediaMessage;
    fetchLatestWaWebVersion =
      BaileysModule.fetchLatestWaWebVersion ||
      BaileysModule.default?.fetchLatestWaWebVersion ||
      BaileysModule.fetchLatestBaileysVersion ||
      BaileysModule.default?.fetchLatestBaileysVersion;
    Browsers =
      BaileysModule.Browsers ||
      BaileysModule.default?.Browsers;
    return true;
  } catch (err: any) {
    console.error('[WhatsApp Bot] Failed to load @whiskeysockets/baileys:', err?.message || err);
    status.error = 'WhatsApp Bot dependency error: ' + (err?.message || err);
    return false;
  }
}

const toDataURL =
  (QRCode as any).toDataURL ||
  (QRCode as any).default?.toDataURL;

export type WaBotGroup = { jid: string; name: string };

export type WaBotStatus = {
  running: boolean;
  connected: boolean;
  qrDataUrl: string | null;
  error: string | null;
  lastMessageAt: string | null;
  groups: WaBotGroup[];
  selectedGroup: { jid: string; name: string } | null;
  hasSession?: boolean;
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
let isConnecting = false;
let reconnectTimer: any = null;
let watchdogInterval: any = null;

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

export function isSessionSaved(): boolean {
  try {
    return fs.existsSync('.wa-session/creds.json');
  } catch {
    return false;
  }
}

export function getBotStatus(): WaBotStatus {
  return { ...status, groups, selectedGroup, hasSession: isSessionSaved() };
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

// ── Pending-payment stitch ──────────────────────────────────────────────────
// Real group flow me payment ka screenshot aur bill number ki text ALAG messages
// me aate hain: pehle receipt (sirf amount), phir "Billno42911/42842" / "42155"
// / "42514" jaisi text. Dono sides ko stash karke ek combined event banta hai.
type PendingPayment = {
  jid: string;
  ts: number;
  amount: number;
  method: string;
  date: string;
  senderName: string;
  text: string;
};
type PendingBillNos = {
  jid: string;
  ts: number;
  billNos: string[];
  senderName: string;
  text: string;
};
let pendingPayment: PendingPayment | null = null;
let pendingBillNos: PendingBillNos | null = null;
const PENDING_TTL_MS = 30 * 60 * 1000;

function isFresh(p: { jid: string; ts: number } | null, jid: string): boolean {
  return !!p && p.jid === jid && Date.now() - p.ts < PENDING_TTL_MS;
}

/** Detect bill numbers in a standalone text like "Billno42911/42842", "42155 kgn", "42514". */
function parseBillNos(text: string): string[] {
  const t = String(text || '').trim();
  if (!t || t.length > 200) return [];
  // Payment amount wali texts Gemini ke through jaati hain — fast path me nahi
  if (/₹|\brs\.?\b|\bamount\b|\bpaid\b|\bpayment\b|\bbhej\b|upi|gpay|cash|cheque/i.test(t)) return [];
  const nos: string[] = [];
  const re = /(?<!\d)(\d{4,7})(?!\d)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(t))) {
    const n = match[1];
    const asNum = Number(n);
    if (asNum >= 1900 && asNum <= 2099) continue; // years (2026 etc.)
    if (!nos.includes(n)) nos.push(n);
  }
  return nos.slice(0, 6);
}

function emitPaymentEvent(
  msg: WAMessage,
  jid: string,
  text: string,
  summary: string,
  entries: WaExtractEntry[]
) {
  const event: WaPaymentEvent = {
    type: 'wa-payment',
    id: `${jid}-${msg.key.id || Date.now()}`,
    fromJid: jid,
    senderName: String(msg.pushName || ''),
    text: String(text || '').slice(0, 300),
    summary,
    entries,
  };
  paymentEventHandler?.(event);
}

function combinedEntries(billNos: string[], amount: number, method: string, date: string): WaExtractEntry[] {
  return billNos.map((bn) => ({
    billNo: bn,
    amount,
    paymentMethod: method,
    date,
    remarks: `Combined payment ₹${amount} — bills: ${billNos.join(', ')}`,
  }));
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

    // ── Fast path: bill-number-only text + stashed receipt → combine & emit ──
    if (!hasImg) {
      const billNos = parseBillNos(text);
      if (billNos.length > 0) {
        if (isFresh(pendingPayment, jid)) {
          const p = pendingPayment!;
          pendingPayment = null;
          pendingBillNos = null;
          emitPaymentEvent(
            msg, jid, text,
            `₹${p.amount} ka ${p.method} payment bills ${billNos.join(', ')} ke against — confirm karein.`,
            combinedEntries(billNos, p.amount, p.method, p.date)
          );
          return;
        }
        // Receipt abhi tak nahi aaya — bill numbers stash karo, screenshot aane par jodenge
        pendingBillNos = { jid, ts: Date.now(), billNos, senderName: String(msg.pushName || ''), text };
        return;
      }
    }

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

    const withBill = result.entries.filter((e) => String(e.billNo || '').trim());
    const amountOnly = result.entries.filter((e) => !String(e.billNo || '').trim() && Number(e.amount) > 0);

    // Normal case: bill number + amount dono ek hi message me
    if (withBill.length > 0) {
      pendingBillNos = null;
      emitPaymentEvent(msg, jid, text, result.summary, withBill);
      return;
    }

    // Screenshot me sirf payment hai, bill no nahi — pehle se stashed billnos se combine karo
    if (amountOnly.length > 0) {
      const r = amountOnly[0];
      const method = String(r.paymentMethod || 'GPay');
      const amount = Number(r.amount) || 0;
      if (isFresh(pendingBillNos, jid)) {
        const pb = pendingBillNos!;
        pendingBillNos = null;
        pendingPayment = null;
        emitPaymentEvent(
          msg, jid, pb.text,
          `₹${amount} ka ${method} payment bills ${pb.billNos.join(', ')} ke against — confirm karein.`,
          combinedEntries(pb.billNos, amount, method, r.date)
        );
        return;
      }
      // Bill number abhi tak nahi aaya — receipt stash karo, "Billno..." text aane par jodenge
      pendingPayment = {
        jid, ts: Date.now(), amount, method, date: r.date,
        senderName: String(msg.pushName || ''), text,
      };
    }
  } catch (err) {
    console.warn('[WhatsApp Bot] processMessage error:', err);
  }
}

function cleanupSocket() {
  if (!sock) return;
  try {
    sock.ev?.removeAllListeners('creds.update');
    sock.ev?.removeAllListeners('connection.update');
    sock.ev?.removeAllListeners('messages.upsert');
    sock.ws?.close?.();
    sock.end?.(undefined as any);
  } catch {}
  sock = null;
}

async function connect() {
  if (isConnecting) return;
  isConnecting = true;
  clearTimeout(reconnectTimer);

  try {
    const loaded = await loadBaileys();
    if (!loaded) {
      isConnecting = false;
      return;
    }

    cleanupSocket();

    const { state, saveCreds } = await useMultiFileAuthState('.wa-session');

    let waVersion: [number, number, number] | undefined;
    try {
      if (typeof fetchLatestWaWebVersion === 'function') {
        const vInfo = await fetchLatestWaWebVersion();
        if (vInfo?.version && Array.isArray(vInfo.version)) {
          waVersion = vInfo.version;
          console.log('[WhatsApp Bot] Using dynamic WhatsApp Web version:', waVersion);
        }
      }
    } catch (vErr) {
      console.warn('[WhatsApp Bot] Could not fetch latest WA version, using default:', vErr);
    }

    sock = makeWASocket({
      ...(waVersion ? { version: waVersion } : {}),
      auth: state,
      printQRInTerminal: false,
      logger: silentLogger,
      browser: Browsers?.ubuntu ? Browsers.ubuntu('Chrome') : ['Ubuntu', 'Chrome', '22.04.4'],
      syncFullHistory: false,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u: any) => {
      const { connection, lastDisconnect, qr } = u;
      if (qr) {
        toDataURL(qr)
          .then((url: string) => {
            status.qrDataUrl = url;
            status.error = null;
          })
          .catch((qrErr: any) => {
            console.error('[WhatsApp Bot] QR generation failed:', qrErr);
            status.error = 'QR generation failed: ' + (qrErr?.message || qrErr);
          });
      }
      if (connection === 'open') {
        status.connected = true;
        status.running = true;
        running = true;
        isConnecting = false;
        status.qrDataUrl = null;
        status.error = null;
        console.log('[WhatsApp Bot] Connected — linked device ready & active.');
        refreshGroups();
      }
      if (connection === 'close') {
        status.connected = false;
        isConnecting = false;
        const code = (lastDisconnect?.error as any)?.output?.statusCode;
        console.log('[WhatsApp Bot] Connection closed. StatusCode:', code);

        // Keep running flag true so it stays active
        if (running || isSessionSaved()) {
          running = true;
          status.running = true;
          clearTimeout(reconnectTimer);
          const delay = (code === DisconnectReason?.loggedOut) ? 10000 : 3000;
          reconnectTimer = setTimeout(() => {
            if (running || isSessionSaved()) connect();
          }, delay);
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
    isConnecting = false;
    console.error('[WhatsApp Bot] connect failed:', err?.message || err);
    status.error = 'WhatsApp connect failed: ' + (err?.message || err);
    if (running || isSessionSaved()) {
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        if (running || isSessionSaved()) connect();
      }, 5000);
    }
  }
}

export function startBot() {
  loadSavedGroup();
  running = true;
  status.running = true;
  status.error = null;
  status.qrDataUrl = null;
  try {
    pool.query(
      `INSERT INTO settings (key, value) VALUES ('wa_bot_enabled', 'true')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`
    ).catch(() => {});
  } catch {}
  connect();
}

export function stopBot() {
  running = false;
  status.running = false;
  status.connected = false;
  status.qrDataUrl = null;
  status.error = null;
  clearTimeout(reconnectTimer);
  try {
    pool.query(
      `INSERT INTO settings (key, value) VALUES ('wa_bot_enabled', 'false')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`
    ).catch(() => {});
  } catch {}
  cleanupSocket();
}

export function resetBotSession() {
  stopBot();
  try {
    fs.rmSync('.wa-session', { recursive: true, force: true });
  } catch {}
  startBot();
}

export async function initBotOnBoot() {
  try {
    const hasCreds = isSessionSaved();
    let isEnabled = false;
    try {
      const { rows } = await pool.query(`SELECT value FROM settings WHERE key = 'wa_bot_enabled'`);
      isEnabled = rows?.[0]?.value === 'true';
    } catch {}

    if (hasCreds || isEnabled) {
      console.log('[WhatsApp Bot] Persistent session detected or bot enabled on server boot. Auto-starting...');
      startBot();
    }
  } catch (err) {
    console.warn('[WhatsApp Bot] initBotOnBoot error:', err);
  }
}

export function startWatchdog() {
  if (watchdogInterval) return;
  watchdogInterval = setInterval(() => {
    const hasCreds = isSessionSaved();
    if ((running || hasCreds) && !status.connected && !isConnecting) {
      console.log('[WhatsApp Bot Watchdog] Session is active but socket disconnected. Reviving connection...');
      running = true;
      status.running = true;
      connect();
    }
  }, 10000);
}
