import type { WASocket, WAMessage } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import fs from 'fs';
import { extractPaymentEntries, extractPaymentEntriesLocal, WaExtractEntry } from './whatsappExtract.js';
import { pool } from './db.js';
import {
  getWaBotConfig,
  setSavedGroup,
  setWaBotEnabled,
  getEffectiveGeminiApiKey,
} from './waBotConfig.js';

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
  const conf = getWaBotConfig();
  const currentSel = conf.selectedGroup || selectedGroup;

  // Ensure the selected group is included in groups list so the UI dropdown can always show it
  const allGroups = [...groups];
  if (currentSel && currentSel.name) {
    const exists = allGroups.some(
      (g) => (currentSel.jid && g.jid === currentSel.jid) || g.name.toLowerCase() === currentSel.name.toLowerCase()
    );
    if (!exists) {
      allGroups.unshift({ jid: currentSel.jid || `saved-${Date.now()}`, name: currentSel.name });
    }
  }

  return { ...status, groups: allGroups, selectedGroup: currentSel, hasSession: isSessionSaved() };
}

/** Admin-selected group (persisted in config & settings) — bot scans only this group. */
export async function selectBotGroup(jid: string, name: string) {
  const saved = await setSavedGroup(jid, name);
  selectedGroup = saved;
  status.selectedGroup = selectedGroup;
  return selectedGroup;
}

async function loadSavedGroup() {
  const conf = getWaBotConfig();
  if (conf.selectedGroup && conf.selectedGroup.name) {
    selectedGroup = conf.selectedGroup;
    status.selectedGroup = selectedGroup;
  }
}

let lastGroupsFetchedAt = 0;

/** Fetch all WhatsApp groups the linked account is a member of. */
async function refreshGroups(force = false) {
  try {
    if (!sock) return;
    // Throttle group fetching to at most once per 15 minutes unless forced or empty
    const now = Date.now();
    if (!force && groups.length > 0 && now - lastGroupsFetchedAt < 15 * 60 * 1000) {
      return;
    }
    const all: any = await (sock as any)?.groupFetchAllParticipating?.().catch((err: any) => {
      const msg = String(err?.message || err || '');
      if (msg.includes('Connection Closed') || msg.includes('connection closed') || msg.includes('rate-overlimit')) {
        return null;
      }
      return null;
    });
    if (all && typeof all === 'object') {
      groups = Object.values(all).map((g: any) => ({ jid: String(g.id), name: String(g.subject || g.id) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      status.groups = groups;
      lastGroupsFetchedAt = Date.now();
    }
  } catch (err: any) {
    const msg = String(err?.message || err || '');
    if (!msg.includes('Connection Closed') && !msg.includes('connection closed') && !msg.includes('rate-overlimit')) {
      console.warn('[WhatsApp Bot] group fetch failed:', err);
    }
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
// me aate hain: pehle receipt (sirf amount & A/C), phir "Billno42911/42842" / "42155"
// / "42514" jaisi text. Dono sides ko stash karke ek combined event banta hai.
type PendingPayment = {
  jid: string;
  ts: number;
  amount: number;
  method: string;
  date: string;
  accountName?: string;
  senderAccountName?: string;
  partyName?: string;
  upiId?: string;
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
  console.log(`[WhatsApp Bot] 🚀 PAYMENT EVENT EMITTED: ${event.id} | Entries: ${entries.length} | Summary: "${summary}"`);
  paymentEventHandler?.(event);
}

function combinedEntries(
  billNos: string[],
  amount: number,
  method: string,
  date: string,
  extra?: { accountName?: string; senderAccountName?: string; partyName?: string; upiId?: string }
): WaExtractEntry[] {
  return billNos.map((bn) => ({
    billNo: bn,
    amount,
    paymentMethod: method,
    date,
    accountName: extra?.accountName,
    senderAccountName: extra?.senderAccountName,
    partyName: extra?.partyName,
    upiId: extra?.upiId,
    remarks: `Combined payment ₹${amount} — bills: ${billNos.join(', ')}${extra?.accountName ? ` [A/C: ${extra.accountName}]` : ''}`,
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
    // Only group messages
    if (!jid.endsWith('@g.us')) return;

    const m: any = msg.message;
    if (!m) return;
    // Skip reactions / protocol / sticker messages
    if (m.reactionMessage || m.protocolMessage || m.stickerMessage) return;

    const text = getMessageText(msg);
    const hasImg = Boolean(m.imageMessage);

    // Group matching: check against persistent config
    const conf = getWaBotConfig();
    const currentSelected = conf.selectedGroup || selectedGroup;
    if (currentSelected && currentSelected.name) {
      const targetJid = String(currentSelected.jid || '').trim();
      const targetName = String(currentSelected.name || '').trim().toLowerCase();

      // Find group subject/name if available in fetched groups
      const grp = groups.find((g) => g.jid === jid);
      const grpName = String(grp?.name || '').toLowerCase();

      const jidMatches = Boolean(targetJid && (jid === targetJid || jid.startsWith(targetJid) || targetJid.startsWith(jid)));
      const nameMatches = Boolean(targetName && grpName && (grpName.includes(targetName) || targetName.includes(grpName)));

      if (!jidMatches && !nameMatches) {
        // Skip messages from other groups
        return;
      }

      // If matched by name but JID was not saved or changed, auto-bind JID
      if (!targetJid && jid) {
        selectBotGroup(jid, currentSelected.name).catch(() => {});
      }
    }

    console.log(`[WhatsApp Bot] 📩 Incoming group message: ${jid} | Sender: ${msg.pushName || 'User'} | Text: "${text.slice(0, 100)}" | HasImg: ${hasImg}`);

    status.lastMessageAt = new Date().toISOString();

    // ── Fast path: bill-number-only text + stashed receipt → combine & emit ──
    if (!hasImg) {
      const billNos = parseBillNos(text);
      if (billNos.length > 0) {
        if (isFresh(pendingPayment, jid)) {
          const p = pendingPayment!;
          pendingPayment = null;
          pendingBillNos = null;
          console.log(`[WhatsApp Bot] 🔗 Combining stashed payment ₹${p.amount} with incoming bill numbers: ${billNos.join(', ')}`);
          emitPaymentEvent(
            msg, jid, text,
            `₹${p.amount} ka ${p.method} payment bills ${billNos.join(', ')} ke against — confirm karein.`,
            combinedEntries(billNos, p.amount, p.method, p.date)
          );
          return;
        }

        // Check if the text also contains an amount or payment keyword
        const localExt = extractPaymentEntriesLocal(text);
        if (localExt.ok && localExt.entries.length > 0 && localExt.entries.some((e) => e.amount > 0)) {
          emitPaymentEvent(msg, jid, text, localExt.summary, localExt.entries);
          return;
        }

        // Receipt abhi tak nahi aaya — bill numbers stash karo, screenshot aane par jodenge
        console.log(`[WhatsApp Bot] ⏳ Stashing bill numbers: ${billNos.join(', ')} for incoming receipt`);
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

    const apiKey = getEffectiveGeminiApiKey();
    const result = await extractPaymentEntries({ apiKey, text: text || undefined, imageBase64, imageMime });
    if (!result.ok || result.entries.length === 0) {
      console.log('[WhatsApp Bot] Extraction returned 0 entries:', (result as any).error || 'No entries');
      return;
    }

    const withBill = result.entries.filter((e) => String(e.billNo || '').trim());
    const amountOnly = result.entries.filter((e) => !String(e.billNo || '').trim() && (Number(e.amount) > 0 || Boolean(e.accountName)));

    // Case 1: Bill number + amount dono ek hi message me
    if (withBill.length > 0) {
      pendingBillNos = null;
      console.log(`[WhatsApp Bot] ✅ Emitting payment event for bill(s): ${withBill.map((e) => e.billNo).join(', ')}`);
      emitPaymentEvent(msg, jid, text, result.summary, withBill);
      return;
    }

    // Case 2: Screenshot/message me amount ya account name mila, lekin bill no nahi mila
    if (amountOnly.length > 0) {
      const r = amountOnly[0];
      const method = String(r.paymentMethod || 'GPay');
      const amount = Number(r.amount) || 0;
      const accountName = r.accountName || '';

      if (isFresh(pendingBillNos, jid)) {
        const pb = pendingBillNos!;
        pendingBillNos = null;
        pendingPayment = null;
        console.log(`[WhatsApp Bot] 🔗 Combining receipt ₹${amount} (A/C: "${accountName}") with previously stashed bills: ${pb.billNos.join(', ')}`);
        emitPaymentEvent(
          msg, jid, pb.text,
          `₹${amount} ka ${method} payment bills ${pb.billNos.join(', ')} ke against — confirm karein.`,
          combinedEntries(pb.billNos, amount, method, r.date, {
            accountName: r.accountName,
            senderAccountName: r.senderAccountName,
            partyName: r.partyName,
            upiId: r.upiId,
          })
        );
        return;
      }

      // Receipt ko stash karo taki agar 30 min me driver/salesman bill number text bheje to auto-stitch ho sake
      console.log(`[WhatsApp Bot] ⏳ Stashing receipt ₹${amount} (${method}, A/C: "${accountName}") for incoming bill number text`);
      pendingPayment = {
        jid,
        ts: Date.now(),
        amount,
        method,
        date: r.date,
        accountName: r.accountName,
        senderAccountName: r.senderAccountName,
        partyName: r.partyName,
        upiId: r.upiId,
        senderName: String(msg.pushName || ''),
        text,
      };

      // CRITICAL: App me payment popup turant show karo taki user ko screenshot aate hi dikhe
      const summaryText = accountName
        ? `₹${amount} ka ${method} payment detected [A/C: ${accountName}]`
        : `₹${amount} ka ${method} payment detected`;
      console.log(`[WhatsApp Bot] 🚀 Emitting immediate payment popup for scanned image: ₹${amount} | A/C: "${accountName}"`);
      emitPaymentEvent(msg, jid, text, summaryText, amountOnly);
      return;
    }
  } catch (err) {
    console.warn('[WhatsApp Bot] processMessage error:', err);
  }
}

function cleanupSocket() {
  if (!sock) return;
  try {
    const ws = (sock as any)?.ws;
    if (ws) {
      try {
        ws.on('error', () => {}); // swallow close/destroy errors
        ws.close?.();
      } catch {}
    }
    sock.ev?.removeAllListeners('creds.update');
    sock.ev?.removeAllListeners('connection.update');
    sock.ev?.removeAllListeners('messages.upsert');
    try {
      sock.end?.(undefined as any);
    } catch {}
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

    // Prevent unhandled WebSocket error events from crashing Node process or bubbling as unhandled
    const wsInstance = (sock as any)?.ws;
    if (wsInstance && typeof wsInstance.on === 'function') {
      wsInstance.on('error', (wsErr: any) => {
        const msg = String(wsErr?.message || wsErr || '');
        if (msg.includes('Connection Closed') || msg.includes('connection closed') || msg.includes('ECONNRESET')) {
          return;
        }
        console.warn('[WhatsApp Bot] WebSocket error:', msg);
      });
    }

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

        const isLoggedOut = code === DisconnectReason?.loggedOut || code === 401 || code === 403;
        if (isLoggedOut) {
          console.warn('[WhatsApp Bot] Device logged out. Halting auto-reconnect. Please re-link in Admin.');
          running = false;
          status.running = false;
          status.error = 'WhatsApp session logged out from device. Please re-link device.';
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
          return;
        }

        // Keep running flag true so it stays active
        if (running || isSessionSaved()) {
          running = true;
          status.running = true;
          clearTimeout(reconnectTimer);
          // If code 440 (connectionReplaced) or 429 (rate-overlimit), wait 45s to avoid tight reconnect storms
          const delay = (code === 440 || code === 429) ? 45000 : 5000;
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
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
        reconnectTimer = null;
        if (running || isSessionSaved()) connect();
      }, 10000);
    }
  }
}

export function startBot() {
  loadSavedGroup();
  running = true;
  status.running = true;
  status.error = null;
  status.qrDataUrl = null;
  setWaBotEnabled(true).catch(() => {});
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
  reconnectTimer = null;
  setWaBotEnabled(false).catch(() => {});
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
    let isEnabled = getWaBotConfig().enabled;
    try {
      const { rows } = await pool.query(`SELECT value FROM settings WHERE key = 'wa_bot_enabled'`);
      if (rows?.[0]?.value === 'true') isEnabled = true;
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
    if ((running || hasCreds) && !status.connected && !isConnecting && !reconnectTimer) {
      console.log('[WhatsApp Bot Watchdog] Session is active but socket disconnected. Reviving connection...');
      running = true;
      status.running = true;
      connect();
    }
  }, 25000);
}
