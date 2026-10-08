import fs from 'fs';
import path from 'path';

const DEDUPE_FILE = path.join(process.cwd(), '.wa-processed-payments.json');

interface DedupeStorage {
  processedMsgIds: string[];
  processedUtrs: string[];
  processedSignatures: string[];
  dismissedEventIds: string[];
}

let storage: DedupeStorage = {
  processedMsgIds: [],
  processedUtrs: [],
  processedSignatures: [],
  dismissedEventIds: [],
};

const msgIdSet = new Set<string>();
const utrSet = new Set<string>();
const signatureSet = new Set<string>();
const dismissedEventSet = new Set<string>();

// Load from disk on module import
function load() {
  try {
    if (fs.existsSync(DEDUPE_FILE)) {
      const raw = fs.readFileSync(DEDUPE_FILE, 'utf-8');
      const data: DedupeStorage = JSON.parse(raw);
      if (Array.isArray(data.processedMsgIds)) {
        storage.processedMsgIds = data.processedMsgIds.slice(-5000);
        storage.processedMsgIds.forEach((id) => msgIdSet.add(id));
      }
      if (Array.isArray(data.processedUtrs)) {
        storage.processedUtrs = data.processedUtrs.slice(-5000);
        storage.processedUtrs.forEach((u) => utrSet.add(u.toLowerCase()));
      }
      if (Array.isArray(data.processedSignatures)) {
        storage.processedSignatures = data.processedSignatures.slice(-5000);
        storage.processedSignatures.forEach((s) => signatureSet.add(s));
      }
      if (Array.isArray(data.dismissedEventIds)) {
        storage.dismissedEventIds = data.dismissedEventIds.slice(-2000);
        storage.dismissedEventIds.forEach((id) => dismissedEventSet.add(id));
      }
      console.log(`[WaDedupe] Loaded deduplication registry from disk: ${msgIdSet.size} msgIds, ${utrSet.size} UTRs, ${signatureSet.size} signatures, ${dismissedEventSet.size} dismissed events.`);
    }
  } catch (err) {
    console.warn('[WaDedupe] Failed to load dedupe file:', err);
  }
}

load();

let saveTimer: any = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      storage.processedMsgIds = Array.from(msgIdSet).slice(-5000);
      storage.processedUtrs = Array.from(utrSet).slice(-5000);
      storage.processedSignatures = Array.from(signatureSet).slice(-5000);
      storage.dismissedEventIds = Array.from(dismissedEventSet).slice(-2000);
      fs.writeFileSync(DEDUPE_FILE, JSON.stringify(storage, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[WaDedupe] Failed to save dedupe file:', err);
    }
  }, 2000);
}

/** Normalized clean string helper */
function clean(s?: string): string {
  return String(s || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Generates a unique signature for a payment */
export function generatePaymentSignature(opts: {
  billNo?: string;
  amount: number;
  paymentMethod?: string;
  accountName?: string;
  upiId?: string;
  date?: string;
}): string {
  // If UTR is present and has at least 6 alphanumeric characters
  const cleanUtr = clean(opts.upiId);
  if (cleanUtr.length >= 6) {
    return `utr:${cleanUtr}`;
  }

  const cleanBn = clean(opts.billNo);
  const amt = Math.round(Number(opts.amount) || 0);
  const method = clean(opts.paymentMethod || 'gpay').slice(0, 10);
  const ac = clean(opts.accountName).slice(0, 15);
  const dt = clean(opts.date || '').slice(0, 10);

  if (cleanBn) {
    return `bill:${cleanBn}:${amt}:${ac}:${dt}`;
  }

  return `pay:${amt}:${method}:${ac}:${dt}`;
}

/** Check if message ID was already processed */
export function isMsgAlreadyProcessed(msgId: string): boolean {
  if (!msgId) return false;
  return msgIdSet.has(msgId);
}

/** Mark message ID as processed */
export function markMsgProcessed(msgId: string) {
  if (!msgId) return;
  msgIdSet.add(msgId);
  scheduleSave();
}

/**
 * Check if a payment has already been scanned, emitted, or confirmed.
 * Prevents any duplicate popup or duplicate scanning.
 */
export function isPaymentAlreadyProcessed(opts: {
  billNo?: string;
  amount: number;
  paymentMethod?: string;
  accountName?: string;
  upiId?: string;
  date?: string;
}): boolean {
  const amt = Math.round(Number(opts.amount) || 0);
  if (amt <= 0 && !opts.billNo) return false;

  // 1. Check UTR
  const cleanUtr = clean(opts.upiId);
  if (cleanUtr.length >= 6 && utrSet.has(cleanUtr)) {
    console.log(`[WaDedupe] Duplicate detected by UTR: "${cleanUtr}"`);
    return true;
  }

  // 2. Check full signature
  const sig = generatePaymentSignature(opts);
  if (signatureSet.has(sig)) {
    console.log(`[WaDedupe] Duplicate detected by signature: "${sig}"`);
    return true;
  }

  // 3. If bill number + amount are present, check bill+amount signature
  const cleanBn = clean(opts.billNo);
  if (cleanBn && amt > 0) {
    const billAmtSig = `bill_amt:${cleanBn}:${amt}`;
    if (signatureSet.has(billAmtSig)) {
      console.log(`[WaDedupe] Duplicate detected by Bill+Amount: "${billAmtSig}"`);
      return true;
    }
  }

  return false;
}

/** Mark payment as processed so it can never be duplicated */
export function markPaymentAsProcessed(opts: {
  billNo?: string;
  amount: number;
  paymentMethod?: string;
  accountName?: string;
  upiId?: string;
  date?: string;
  eventId?: string;
}) {
  const cleanUtr = clean(opts.upiId);
  if (cleanUtr.length >= 6) {
    utrSet.add(cleanUtr);
  }

  const sig = generatePaymentSignature(opts);
  signatureSet.add(sig);

  const cleanBn = clean(opts.billNo);
  const amt = Math.round(Number(opts.amount) || 0);
  if (cleanBn && amt > 0) {
    signatureSet.add(`bill_amt:${cleanBn}:${amt}`);
  }

  if (opts.eventId) {
    dismissedEventSet.add(opts.eventId);
  }

  scheduleSave();
}

/** Check if event ID was dismissed / confirmed */
export function isEventDismissed(eventId: string): boolean {
  if (!eventId) return false;
  return dismissedEventSet.has(eventId);
}

/** Mark event ID as dismissed / confirmed */
export function markEventDismissed(eventId: string, extraPaymentOpts?: {
  billNo?: string;
  amount?: number;
  paymentMethod?: string;
  accountName?: string;
  upiId?: string;
  date?: string;
}) {
  if (eventId) {
    dismissedEventSet.add(eventId);
  }
  if (extraPaymentOpts && (Number(extraPaymentOpts.amount) > 0 || extraPaymentOpts.billNo)) {
    markPaymentAsProcessed({
      amount: Number(extraPaymentOpts.amount) || 0,
      billNo: extraPaymentOpts.billNo,
      paymentMethod: extraPaymentOpts.paymentMethod,
      accountName: extraPaymentOpts.accountName,
      upiId: extraPaymentOpts.upiId,
      date: extraPaymentOpts.date,
      eventId,
    });
  } else {
    scheduleSave();
  }
}
