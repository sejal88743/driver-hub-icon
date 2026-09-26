import type { WASocket, WAMessage } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import fs from 'fs';
import { extractPaymentEntries, extractPaymentEntriesLocal, parseBillNosFromText, WaExtractEntry } from './whatsappExtract.js';
import { pool } from './db.js';
import {
  getWaBotConfig,
  setSavedGroup,
  setWaBotEnabled,
  getEffectiveGeminiApiKey,
} from './waBotConfig.js';
import {
  isMsgAlreadyProcessed,
  markMsgProcessed,
  isPaymentAlreadyProcessed,
  markPaymentAsProcessed,
} from './waDedupe.js';

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
  replacesEventId?: string;
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
let statusChangeHandler: ((status: WaBotStatus) => void) | null = null;

export function setStatusChangeHandler(fn: ((status: WaBotStatus) => void) | null) {
  statusChangeHandler = fn;
}

export function notifyStatusChange() {
  if (statusChangeHandler) {
    try {
      statusChangeHandler(getBotStatus());
    } catch {}
  }
}

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
    const now = Date.now();
    if (!force && groups.length > 0 && now - lastGroupsFetchedAt < 5 * 60 * 1000) {
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
      notifyStatusChange();
      console.log(`[WhatsApp Bot] Groups refreshed: ${groups.length} participating groups found.`);
    }
  } catch (err: any) {
    const msg = String(err?.message || err || '');
    if (!msg.includes('Connection Closed') && !msg.includes('connection closed') && !msg.includes('rate-overlimit')) {
      console.warn('[WhatsApp Bot] group fetch failed:', err);
    }
  }
}

export async function forceRefreshGroups(): Promise<WaBotGroup[]> {
  await refreshGroups(true);
  return groups;
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
  id: string;
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
  msg: WAMessage;
  bufferTimer?: any;
  emittedEventId?: string;
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

function emitPaymentEvent(
  msg: WAMessage,
  jid: string,
  text: string,
  summary: string,
  entries: WaExtractEntry[],
  customId?: string,
  replacesEventId?: string
) {
  const id = customId || `${jid}-${msg.key?.id || Date.now()}`;
  const event: WaPaymentEvent = {
    type: 'wa-payment',
    id,
    fromJid: jid,
    senderName: String(msg.pushName || ''),
    text: String(text || '').slice(0, 300),
    summary,
    entries,
    replacesEventId,
  };

  // Mark all entries as processed in deduplication registry
  for (const e of entries) {
    markPaymentAsProcessed({ ...e, eventId: id });
  }

  console.log(`[WhatsApp Bot] 🚀 PAYMENT EVENT EMITTED: ${event.id} | Entries: ${entries.length} | Summary: "${summary}"${replacesEventId ? ` [Replaces: ${replacesEventId}]` : ''}`);
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

/**
 * Unwraps Baileys message object to reach inner message through
 * ephemeralMessage, viewOnceMessage, viewOnceMessageV2, documentWithCaptionMessage, etc.
 */
function unwrapMessage(msg: WAMessage): { actualMessage: any; unwrappedMsg: WAMessage } {
  let m: any = msg?.message;
  if (!m) return { actualMessage: null, unwrappedMsg: msg };

  let depth = 0;
  while (depth < 6 && m) {
    if (m.ephemeralMessage?.message) {
      m = m.ephemeralMessage.message;
    } else if (m.viewOnceMessage?.message) {
      m = m.viewOnceMessage.message;
    } else if (m.viewOnceMessageV2?.message) {
      m = m.viewOnceMessageV2.message;
    } else if (m.viewOnceMessageV2Extension?.message) {
      m = m.viewOnceMessageV2Extension.message;
    } else if (m.documentWithCaptionMessage?.message) {
      m = m.documentWithCaptionMessage.message;
    } else {
      break;
    }
    depth++;
  }

  return {
    actualMessage: m,
    unwrappedMsg: {
      ...msg,
      message: m,
    },
  };
}

/**
 * Extracts all text, media info, and quoted text from a WAMessage.
 */
function extractMessageDetails(msg: WAMessage): {
  text: string;
  hasImg: boolean;
  imageMime: string;
  mediaMessage: any;
  actualMessage: any;
  unwrappedMsg: WAMessage;
} {
  const { actualMessage: m, unwrappedMsg } = unwrapMessage(msg);
  if (!m) {
    return { text: '', hasImg: false, imageMime: '', mediaMessage: null, actualMessage: null, unwrappedMsg };
  }

  // 1. Text from direct fields
  let text = String(
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    ''
  ).trim();

  // Also include quoted text if available (e.g. driver replied to a bill message with receipt)
  const quoted = m.extendedTextMessage?.contextInfo?.quotedMessage || m.imageMessage?.contextInfo?.quotedMessage;
  if (quoted) {
    const qText = String(
      quoted.conversation ||
      quoted.extendedTextMessage?.text ||
      quoted.imageMessage?.caption ||
      quoted.documentMessage?.caption ||
      ''
    ).trim();
    if (qText) {
      text = text ? `${text} | [Quoted: ${qText}]` : qText;
    }
  }

  // 2. Image detection (Standard imageMessage OR documentMessage containing image/pdf)
  let hasImg = false;
  let imageMime = 'image/jpeg';
  let mediaMessage: any = null;

  if (m.imageMessage) {
    hasImg = true;
    imageMime = m.imageMessage.mimetype || 'image/jpeg';
    mediaMessage = m.imageMessage;
  } else if (m.documentMessage) {
    const mime = String(m.documentMessage.mimetype || '').toLowerCase();
    const fileName = String(m.documentMessage.fileName || '').toLowerCase();
    if (mime.startsWith('image/') || /\.(jpg|jpeg|png|webp|heic)$/i.test(fileName)) {
      hasImg = true;
      imageMime = mime.startsWith('image/') ? mime : 'image/jpeg';
      mediaMessage = m.documentMessage;
    }
  }

  return {
    text,
    hasImg,
    imageMime,
    mediaMessage,
    actualMessage: m,
    unwrappedMsg,
  };
}

async function processMessage(msg: WAMessage) {
  try {
    if (!msg.key) return;
    const msgId = String(msg.key.id || '');
    if (!msgId) return;

    // ── Message-level Deduplication: Skip already processed WhatsApp messages ──
    if (isMsgAlreadyProcessed(msgId)) {
      return;
    }
    markMsgProcessed(msgId);

    const jid = String(msg.key.remoteJid || '');
    if (!jid || jid === 'status@broadcast') return;

    // Both group messages (@g.us) and direct messages (@s.whatsapp.net)
    const isGroup = jid.endsWith('@g.us');

    const { text, hasImg, imageMime, mediaMessage, actualMessage, unwrappedMsg } = extractMessageDetails(msg);
    if (!actualMessage) return;

    // Skip reactions / protocol / sticker messages
    if (actualMessage.reactionMessage || actualMessage.protocolMessage || actualMessage.stickerMessage) return;

    // Skip empty non-media messages
    if (!text && !hasImg) return;

    // ── Group matching: check against persistent config ──
    if (isGroup) {
      const conf = getWaBotConfig();
      const currentSelected = conf.selectedGroup || selectedGroup;
      const targetJid = String(currentSelected?.jid || '').trim();
      const targetName = String(currentSelected?.name || '').trim().toLowerCase();

      // If target is "all" or "All Groups" or empty, scan all groups
      const isAllGroups =
        !targetName ||
        targetJid === 'all' ||
        targetJid === '*' ||
        targetName === 'all' ||
        targetName.includes('all group') ||
        targetName.includes('sabhi group') ||
        targetName.includes('any group');

      if (!isAllGroups) {
        let grp = groups.find((g) => g.jid === jid);
        let grpName = String(grp?.name || '').toLowerCase();

        // If group name is not cached yet, dynamically fetch metadata
        if (!grpName) {
          try {
            const meta: any = await (sock as any)?.groupMetadata?.(jid).catch(() => null);
            if (meta?.subject) {
              grpName = String(meta.subject).toLowerCase();
              if (!groups.some((g) => g.jid === jid)) {
                groups.push({ jid, name: String(meta.subject) });
                status.groups = groups;
                notifyStatusChange();
              }
            }
          } catch {}
        }

        const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
        const jidMatches = Boolean(targetJid && (jid === targetJid || jid.startsWith(targetJid) || targetJid.startsWith(jid)));
        const nameMatches = Boolean(
          targetName &&
          grpName &&
          (clean(grpName).includes(clean(targetName)) || clean(targetName).includes(clean(grpName)))
        );

        if (!jidMatches && !nameMatches) {
          // Different group - skip
          console.log(`[WhatsApp Bot] Skipping message from other group: "${grpName || jid}" (Selected: "${currentSelected?.name}")`);
          return;
        }

        // If matched by name but JID was not saved or changed, auto-bind JID
        if ((!targetJid || targetJid !== jid) && jid && nameMatches) {
          console.log(`[WhatsApp Bot] Auto-binding active group JID: ${jid} for "${currentSelected?.name}"`);
          selectBotGroup(jid, currentSelected!.name).catch(() => {});
        }
      }
    }

    console.log(`[WhatsApp Bot] 📩 Incoming message: ${jid} | Sender: ${msg.pushName || 'User'} | Text: "${text.slice(0, 100)}" | HasImg: ${hasImg}`);
    status.lastMessageAt = new Date().toISOString();
    notifyStatusChange();

    // ── Fast path: bill-number-only text + stashed receipt → combine & emit ──
    if (!hasImg) {
      const billNos = parseBillNosFromText(text);
      if (billNos.length > 0) {
        if (isFresh(pendingPayment, jid)) {
          const p = pendingPayment!;
          if (p.bufferTimer) {
            clearTimeout(p.bufferTimer);
            p.bufferTimer = null;
          }
          pendingPayment = null;
          pendingBillNos = null;

          const entries = combinedEntries(billNos, p.amount, p.method, p.date, {
            accountName: p.accountName,
            senderAccountName: p.senderAccountName,
            partyName: p.partyName,
            upiId: p.upiId,
          });

          const freshEntries = entries.filter((e) => !isPaymentAlreadyProcessed(e));
          if (freshEntries.length === 0) {
            console.log(`[WhatsApp Bot] 🚫 Duplicate combined payment skipped: already processed.`);
            return;
          }

          console.log(`[WhatsApp Bot] 🔗 Combining stashed payment ₹${p.amount} with incoming bill numbers: ${billNos.join(', ')}`);
          emitPaymentEvent(
            msg, jid, text,
            `₹${p.amount} ka ${p.method} payment bills ${billNos.join(', ')} ke against — confirm karein.`,
            freshEntries,
            undefined,
            p.emittedEventId
          );
          return;
        }

        // Check if the text also contains an amount or payment keyword
        const localExt = extractPaymentEntriesLocal(text);
        if (localExt.ok && localExt.entries.length > 0 && localExt.entries.some((e) => e.amount > 0)) {
          const freshEntries = localExt.entries.filter((e) => !isPaymentAlreadyProcessed(e));
          if (freshEntries.length === 0) {
            console.log(`[WhatsApp Bot] 🚫 Duplicate text payment skipped: already processed.`);
            return;
          }
          emitPaymentEvent(msg, jid, text, localExt.summary, freshEntries);
          return;
        }

        // Receipt abhi tak nahi aaya — bill numbers stash karo, screenshot aane par jodenge
        console.log(`[WhatsApp Bot] ⏳ Stashing bill numbers: ${billNos.join(', ')} for incoming receipt`);
        pendingBillNos = { jid, ts: Date.now(), billNos, senderName: String(msg.pushName || ''), text };
        return;
      }
    }

    let imageBase64: string | undefined;
    let finalImageMime: string = imageMime || 'image/jpeg';

    if (hasImg && downloadMediaMessage) {
      try {
        console.log(`[WhatsApp Bot] 📥 Downloading image media from message ${msg.key.id}...`);
        // Pass unwrappedMsg so Baileys can find media keys directly in unwrappedMsg.message
        const buf: any = await downloadMediaMessage(
          unwrappedMsg,
          'buffer',
          {},
          {
            logger: silentLogger,
            reuploadRequest: (sock as any)?.updateMediaMessage,
          }
        );
        if (buf && Buffer.isBuffer(buf) && buf.length > 0) {
          imageBase64 = buf.toString('base64');
          finalImageMime = imageMime || 'image/jpeg';
          console.log(`[WhatsApp Bot] 📷 Media downloaded successfully: ${buf.length} bytes (${finalImageMime})`);
        }
      } catch (err: any) {
        console.warn('[WhatsApp Bot] primary media download failed:', err?.message || err);
        // Fallback: try downloadMediaMessage on original msg
        try {
          const buf2: any = await downloadMediaMessage(msg, 'buffer', {});
          if (buf2 && Buffer.isBuffer(buf2) && buf2.length > 0) {
            imageBase64 = buf2.toString('base64');
            finalImageMime = imageMime || 'image/jpeg';
            console.log(`[WhatsApp Bot] 📷 Media downloaded via fallback: ${buf2.length} bytes`);
          }
        } catch (fErr: any) {
          console.warn('[WhatsApp Bot] fallback media download also failed:', fErr?.message || fErr);
        }
      }
    }

    const apiKey = getEffectiveGeminiApiKey();
    const result = await extractPaymentEntries({
      apiKey,
      text: text || undefined,
      imageBase64,
      imageMime: finalImageMime,
    });

    if (!result.ok || result.entries.length === 0) {
      console.log('[WhatsApp Bot] Extraction returned 0 entries:', (result as any).error || 'No entries');
      return;
    }

    const withBill = result.entries.filter((e) => String(e.billNo || '').trim());
    const amountOnly = result.entries.filter((e) => !String(e.billNo || '').trim() && (Number(e.amount) > 0 || Boolean(e.accountName)));

    // Case 1: Bill number + amount dono ek hi message me (ya image/caption se extracted)
    if (withBill.length > 0) {
      if (pendingPayment?.bufferTimer) {
        clearTimeout(pendingPayment.bufferTimer);
        pendingPayment.bufferTimer = null;
      }
      pendingBillNos = null;
      pendingPayment = null;

      const freshEntries = withBill.filter((e) => !isPaymentAlreadyProcessed(e));
      if (freshEntries.length === 0) {
        console.log(`[WhatsApp Bot] 🚫 Duplicate bill payment skipped: all entries already processed.`);
        return;
      }

      console.log(`[WhatsApp Bot] ✅ Emitting payment event for bill(s): ${freshEntries.map((e) => e.billNo).join(', ')}`);
      emitPaymentEvent(msg, jid, text, result.summary, freshEntries);
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
        if (pendingPayment?.bufferTimer) {
          clearTimeout(pendingPayment.bufferTimer);
          pendingPayment.bufferTimer = null;
        }
        pendingPayment = null;

        const combined = combinedEntries(pb.billNos, amount, method, r.date, {
          accountName: r.accountName,
          senderAccountName: r.senderAccountName,
          partyName: r.partyName,
          upiId: r.upiId,
        });

        const freshEntries = combined.filter((e) => !isPaymentAlreadyProcessed(e));
        if (freshEntries.length === 0) {
          console.log(`[WhatsApp Bot] 🚫 Duplicate combined payment skipped: already processed.`);
          return;
        }

        console.log(`[WhatsApp Bot] 🔗 Combining receipt ₹${amount} (A/C: "${accountName}") with previously stashed bills: ${pb.billNos.join(', ')}`);
        emitPaymentEvent(
          msg, jid, pb.text,
          `₹${amount} ka ${method} payment bills ${pb.billNos.join(', ')} ke against — confirm karein.`,
          freshEntries
        );
        return;
      }

      // Check if receipt itself was already processed
      if (isPaymentAlreadyProcessed(r)) {
        console.log(`[WhatsApp Bot] 🚫 Duplicate receipt skipped: already processed.`);
        return;
      }

      // Stash receipt and set a 3.5s buffer window to wait for the driver's follow-up bill number text!
      // In WhatsApp groups, users almost always send screenshot and immediately send bill number text right below.
      console.log(`[WhatsApp Bot] ⏳ Holding receipt ₹${amount} (${method}, A/C: "${accountName}") for 3.5s to check for follow-up bill number text...`);

      if (pendingPayment?.bufferTimer) {
        clearTimeout(pendingPayment.bufferTimer);
      }

      const p: PendingPayment = {
        id: `pend-${jid}-${msg.key?.id || Date.now()}`,
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
        msg,
      };

      p.bufferTimer = setTimeout(() => {
        if (pendingPayment !== p) return;
        p.bufferTimer = null;

        if (isPaymentAlreadyProcessed(r)) {
          console.log(`[WhatsApp Bot] 🚫 Delayed receipt duplicate check skipped.`);
          return;
        }

        p.emittedEventId = `${jid}-${msg.key?.id || Date.now()}`;
        const summaryText = accountName
          ? `₹${amount} ka ${method} payment detected [A/C: ${accountName}]`
          : `₹${amount} ka ${method} payment detected`;
        console.log(`[WhatsApp Bot] 🚀 Buffer window elapsed, emitting payment popup: ₹${amount} | A/C: "${accountName}"`);
        emitPaymentEvent(msg, jid, text, summaryText, amountOnly, p.emittedEventId);
      }, 3500);

      pendingPayment = p;
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
            notifyStatusChange();
          })
          .catch((qrErr: any) => {
            console.error('[WhatsApp Bot] QR generation failed:', qrErr);
            status.error = 'QR generation failed: ' + (qrErr?.message || qrErr);
            notifyStatusChange();
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
        notifyStatusChange();
        refreshGroups();
      }
      if (connection === 'close') {
        status.connected = false;
        isConnecting = false;
        const code = (lastDisconnect?.error as any)?.output?.statusCode;
        console.log('[WhatsApp Bot] Connection closed. StatusCode:', code);
        notifyStatusChange();

        const isLoggedOut = code === DisconnectReason?.loggedOut || code === 401 || code === 403;
        if (isLoggedOut) {
          console.warn('[WhatsApp Bot] Device logged out. Wiping session and generating fresh QR code...');
          stopBot(true);
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
      // Process both 'notify' (live) and 'append' (offline sync / forward queue)
      const msgs = Array.isArray(up?.messages) ? up.messages : [];
      for (const msg of msgs) {
        processMessage(msg);
      }
    });
  } catch (err: any) {
    isConnecting = false;
    console.error('[WhatsApp Bot] connect failed:', err?.message || err);
    status.error = 'WhatsApp connect failed: ' + (err?.message || err);
    notifyStatusChange();
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
  notifyStatusChange();
  connect();
}

/**
 * Stop Bot: Wipes previous WhatsApp session, disconnects active socket,
 * and immediately generates a fresh NEW QR code so a new connection can be made.
 */
export function stopBot(generateNewQr: boolean = true) {
  clearTimeout(reconnectTimer);
  reconnectTimer = null;

  // 1. Terminate current socket
  cleanupSocket();

  // 2. Wipe old session directory completely
  try {
    fs.rmSync('.wa-session', { recursive: true, force: true });
    console.log('[WhatsApp Bot] Removed .wa-session folder for fresh new connection.');
  } catch (rmErr) {
    console.warn('[WhatsApp Bot] Could not remove .wa-session:', rmErr);
  }

  // 3. Reset internal status
  status.connected = false;
  status.qrDataUrl = null;
  status.error = null;

  if (generateNewQr) {
    running = true;
    status.running = true;
    setWaBotEnabled(true).catch(() => {});
    notifyStatusChange();
    console.log('[WhatsApp Bot] Generating FRESH NEW QR code for new connection...');
    setTimeout(() => {
      connect();
    }, 400);
  } else {
    running = false;
    status.running = false;
    setWaBotEnabled(false).catch(() => {});
    notifyStatusChange();
  }
}

export function resetBotSession() {
  stopBot(true);
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
