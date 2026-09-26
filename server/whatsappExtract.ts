import { GoogleGenAI } from '@google/genai';
import { getEffectiveGeminiApiKey } from './waBotConfig.js';

export type WaExtractEntry = {
  billNo: string;
  amount: number;
  paymentMethod: string;
  date: string;
  accountName?: string;       // Account Name / Paid To / Beneficiary Name from screenshot
  senderAccountName?: string; // Paid By / Sender Account Name from screenshot
  partyName?: string;         // Shop / Party / Customer Name
  upiId?: string;             // UTR / UPI Ref / Transaction ID
  remarks?: string;
};

export type WaExtractResult =
  | { ok: true; entries: WaExtractEntry[]; summary: string }
  | { ok: false; error: string };

function getTodayDMY(): string {
  const now = new Date();
  return `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
}

/**
 * Detects bill numbers from any text, caption, or follow-up message.
 * Handles formats like:
 * - "42911"
 * - "Billno42911/42842"
 * - "Bill no. 42911"
 * - "Bill 42911 5000 rs"
 * - "42911 ka payment"
 * - "42911, 42842"
 * - "GST45027"
 */
export function parseBillNosFromText(rawText: string): string[] {
  const text = String(rawText || '').trim();
  if (!text || text.length > 500) return [];

  const billNos: string[] = [];

  // 1. Slash / comma / dash separated numbers: "42911/42842", "42911, 42842", "42911 & 42842"
  const comboMatch = text.match(/(?:bill\s*(?:no\.?|#)?|inv(?:oice)?\.?)?\s*([0-9]{4,7}(?:\s*[\/,&-]\s*[0-9]{4,7})+)/i);
  if (comboMatch) {
    const parts = comboMatch[1].split(/[\/,&-]/).map((s) => s.trim()).filter((s) => s.length >= 4 && s.length <= 7);
    for (const p of parts) {
      const n = Number(p);
      if (n >= 2024 && n <= 2030) continue; // skip years
      if (!billNos.includes(p)) billNos.push(p);
    }
  }

  // 2. Explicit bill prefix: "bill 42911", "bill no. 42911", "bill#42911", "gst45027", "inv42911"
  const explicitRegex = /(?:bill\s*(?:no\.?|#)?|gst|inv(?:oice)?\.?)\s*[:=-]?\s*([0-9]{4,7})/gi;
  let exMatch: RegExpExecArray | null;
  while ((exMatch = explicitRegex.exec(text)) !== null) {
    const num = exMatch[1];
    if (!billNos.includes(num)) {
      billNos.push(num);
    }
  }

  // 3. Any 4 to 7 digit standalone number (excluding pure monetary amounts with ₹ or rs or /- or 000000)
  const standRegex = /(?<![₹$a-zA-Z0-9])([0-9]{4,7})(?![0-9a-zA-Z])/g;
  let stMatch: RegExpExecArray | null;
  while ((stMatch = standRegex.exec(text)) !== null) {
    const num = stMatch[1];
    const n = Number(num);
    // Ignore current/upcoming years unless explicitly prefixed
    if (n >= 2024 && n <= 2030) continue;
    // Ignore obvious monetary amounts if preceded by amount keyword or followed by currency suffix
    const preceding = text.slice(Math.max(0, stMatch.index - 12), stMatch.index).toLowerCase();
    const following = text.slice(stMatch.index + num.length, stMatch.index + num.length + 12).toLowerCase();
    if (/(?:₹|rs\.?|inr|amt|amount|paid|payment|jama|bhej(?:a|i|e)?|de\s*diya)\s*[:=-]?\s*$/.test(preceding)) continue;
    if (/^\s*(?:\/-|\/=|rs\.?|rupaye|rupees)/i.test(following)) continue;

    if (!billNos.includes(num)) {
      billNos.push(num);
    }
  }

  return billNos.slice(0, 8);
}

/**
 * Robust local regex/heuristic parser for Indian transport & distribution payment messages.
 * Handles text formats like:
 * - "Billno42911/42842"
 * - "42911 kgn 5000"
 * - "Bill 42911 5000 rs gpay"
 * - "Paid 5000 in Laxmi Traders ac"
 * - "42911 - 10000 cash diya"
 * - "GST45027 12500 Google Pay"
 */
export function extractPaymentEntriesLocal(rawText: string): WaExtractResult {
  const text = String(rawText || '').trim();
  if (!text) return { ok: false, error: 'Empty text' };

  const today = getTodayDMY();

  // 1. Detect bill numbers (4 to 7 digits, strip GST/INV prefix)
  const billNos = parseBillNosFromText(text);

  // 2. Detect payment method
  let paymentMethod = 'GPay';
  if (/cash|nakad|hath|rokhad/i.test(text)) {
    paymentMethod = 'Cash';
  } else if (/cheque|chq|chck|check/i.test(text)) {
    paymentMethod = 'Cheque';
  } else if (/phonepe/i.test(text)) {
    paymentMethod = 'PhonePe';
  } else if (/paytm/i.test(text)) {
    paymentMethod = 'Paytm';
  } else if (/gpay|google\s*pay|upi|online|transfer|neft|rtgs|qr/i.test(text)) {
    paymentMethod = 'GPay';
  }

  // 3. Detect Account Name or Beneficiary Name
  let accountName = '';
  const acMatch = text.match(/(?:paid\s*to|to|a\/c\s*(?:name)?|account\s*(?:name)?|banking\s*name|party)\s*[:=-]?\s*([a-zA-Z0-9\s&.-]{3,35})(?:\s*[,|\n]|\s*(?:rs|₹|amt|amount|paid|dated|ref|gpay|upi|$))/i);
  if (acMatch && acMatch[1]) {
    accountName = acMatch[1].trim();
  }

  // 4. Detect amount
  let detectedAmount = 0;

  // Patterns with keywords: "rs 5000", "₹5000", "5000 rs", "5000/-", "amt 5000", "paid 5000", "payment 5000"
  const amountPatterns = [
    /(?:₹|rs\.?|inr|amt|amount|paid|payment|jama|bhej(?:a|i|e)?)\s*[:=-]?\s*([0-9]+(?:,[0-9]+)*(?:\.[0-9]{1,2})?)/i,
    /([0-9]+(?:,[0-9]+)*(?:\.[0-9]{1,2})?)\s*(?:₹|rs\.?|\/-|rupaye|rupees|cash|gpay|upi|online|cheque|chq)/i,
  ];

  for (const pat of amountPatterns) {
    const m = text.match(pat);
    if (m && m[1]) {
      const cleanNum = Number(m[1].replace(/,/g, ''));
      if (cleanNum > 0 && !billNos.includes(String(Math.round(cleanNum)))) {
        detectedAmount = cleanNum;
        break;
      }
    }
  }

  // If no amount keyword matched, but we have numbers other than the bill numbers
  if (detectedAmount === 0) {
    const allNums = text.match(/\b\d+(?:\.\d{1,2})?\b/g) || [];
    for (const numStr of allNums) {
      const num = Number(numStr);
      if (num >= 50 && num <= 500000 && !billNos.includes(numStr)) {
        detectedAmount = num;
        break;
      }
    }
  }

  // If we have bill numbers
  if (billNos.length > 0) {
    const entries: WaExtractEntry[] = billNos.map(bn => ({
      billNo: bn,
      amount: detectedAmount > 0 ? detectedAmount : 0,
      paymentMethod,
      date: today,
      accountName: accountName || undefined,
      remarks: `WhatsApp detected payment (${paymentMethod})${accountName ? ` A/C: ${accountName}` : ''}`,
    }));

    const summary = detectedAmount > 0
      ? `Bill ${billNos.join(', ')} ka ₹${detectedAmount} (${paymentMethod})${accountName ? ` [${accountName}]` : ''} payment detected.`
      : `Bill ${billNos.join(', ')} message detected.`;

    return { ok: true, entries, summary };
  }

  // If amount or account found but no bill number (e.g. screenshot or "5000 gpay done to KGN")
  if (detectedAmount > 0 || accountName) {
    return {
      ok: true,
      entries: [{
        billNo: '',
        amount: detectedAmount,
        paymentMethod,
        date: today,
        accountName: accountName || undefined,
        remarks: accountName ? `Account: ${accountName}` : 'Amount detected from WhatsApp',
      }],
      summary: `₹${detectedAmount} ka ${paymentMethod} payment${accountName ? ` [Account: ${accountName}]` : ''} detected.`,
    };
  }

  return { ok: false, error: 'Koi payment ya bill details nahi mili.' };
}

/** Shared Gemini extraction used by both the admin upload endpoint AND the live WhatsApp bot. */
export async function extractPaymentEntries(opts: {
  apiKey?: string;
  text?: string;
  imageBase64?: string;
  imageMime?: string;
}): Promise<WaExtractResult> {
  const text = String(opts.text || '').trim();
  const imageBase64 = opts.imageBase64;
  const imageMime = opts.imageMime;

  const hasImage = typeof imageBase64 === 'string' && imageBase64.trim().length > 0;
  const hasText = text.length > 0;

  if (!hasImage && !hasText) {
    return { ok: false, error: 'WhatsApp message content required hai.' };
  }

  // Effective API key (custom setting or process.env fallback)
  const apiKey = (opts.apiKey || getEffectiveGeminiApiKey()).trim();

  // If there is no image and we have text, try local parser first
  if (!hasImage && hasText) {
    const localRes = extractPaymentEntriesLocal(text);
    if (localRes.ok && localRes.entries.length > 0) {
      const hasBillAndAmount = localRes.entries.some(e => e.billNo && e.amount > 0);
      if (hasBillAndAmount) {
        return localRes;
      }
    }
  }

  if (!apiKey) {
    if (hasText) {
      return extractPaymentEntriesLocal(text);
    }
    return { ok: false, error: 'Gemini API key configured nahi hai aur image scan ke liye AI zaroori hai.' };
  }

  const todayDMY = getTodayDMY();

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
  });

  const instruction = `You are VitraTrack's Expert WhatsApp Payment & Screenshot Extraction Engine.
A driver or salesman sent a payment screenshot (Google Pay, PhonePe, Paytm, BHIM, Bank transfer, NEFT/RTGS, Cheque photo, or Cash memo) or message to a WhatsApp group.

CRITICAL INSTRUCTION - BILL NUMBER & AMOUNT:
In transport & distribution, EVERY screenshot has an Invoice / Bill Number either:
1. Written or printed on the image:
   - Handwritten with pen or marker on the bill slip, receipt or screenshot (e.g. "42911", "42842", "Bill 42911", "B-42911").
   - Printed Invoice Number (e.g. "GST45027", "INV-42911", "42911").
   - In UPI Notes / Description / Remark (e.g. "42911", "Bill 42911", "KGN 42911").
2. In the WhatsApp text caption / message text (e.g. "42911", "Bill no 42911", "42911/42842").

LOOK VERY CAREFULLY AT:
- Top, bottom, margins, handwritten annotations, and UPI remarks for any 4 to 7 digit Bill Number.
- If caption contains "Bill no 42911" or "42911", that is the bill number!

YOUR TOP MISSION: Extract the EXACT Payment Amount, the Bill Number, and the Account / Beneficiary Name!

Extract:
1. "amount": The paid amount in rupees (number only, e.g. 5000, 12500, 480). Look for large bold numbers like "₹5,000", "Paid ₹12,500", "Total Amount", "Rs. 2500", or the prominent transaction amount.
2. "accountName": The Account Name / Beneficiary Name / Receiver Name / "Paid to" entity in the screenshot. E.g.:
   - "Paid to: LAXMI TRADERS" -> accountName = "LAXMI TRADERS"
   - "Banking Name: KGN LOGISTICS" -> accountName = "KGN LOGISTICS"
   - "To: Ramesh Patel" -> accountName = "Ramesh Patel"
   - Or company/merchant/shop name shown at the top. This is VERY IMPORTANT.
3. "senderAccountName": The payer's name or "Debited from / Paid by / From:" name if visible.
4. "billNo": The invoice / bill number if visible in the image, handwritten on receipt, in UPI note, or in caption. Strip prefixes like "GST", "INV", "MOC" (e.g. "GST45027" -> "45027"). If NOT visible in the receipt/image/caption, return billNo: "" (DO NOT invent a bill number).
5. "paymentMethod": "GPay" | "PhonePe" | "Paytm" | "UPI" | "Bank Transfer" | "Cash" | "Cheque" (use "GPay" for Google Pay, "PhonePe" for PhonePe, "Paytm" for Paytm, "UPI" for other UPI apps).
6. "date": Transaction date in DD/MM/YYYY. If not specified or today, use "${todayDMY}".
7. "partyName": Party / Customer name if mentioned in caption or receipt.
8. "upiId": UPI ID or UTR / UPI Ref / Transaction ID number (e.g. 123456789012) if visible.
9. "remarks": Extra details (e.g. "UTR 412389123891", note written on receipt).

Rules:
- Deeply inspect all headers, recipient cards, transaction badges, notes, and handwritten markings.
- Even if NO bill number is written on the payment screenshot, ALWAYS return the entry with the extracted amount and accountName!
- If caption or image lists multiple bill numbers (e.g. "Billno 42911/42842"), output an entry for each bill number with the full amount and accountName.

Respond ONLY with valid JSON matching this schema:
{"entries":[{"billNo":"string","amount":number,"accountName":"string","senderAccountName":"string","partyName":"string","paymentMethod":"string","date":"DD/MM/YYYY","upiId":"string","remarks":"string"}],"summary":"one line Hinglish summary mentioning extracted amount, bill number, and account name"}`;

  const parts: Array<Record<string, any>> = [{ text: instruction }];
  if (hasText) {
    parts.push({ text: `WhatsApp message caption/text:\n"""\n${text.slice(0, 15000)}\n"""` });
  }
  if (hasImage) {
    parts.push({
      inlineData: {
        mimeType: imageMime || 'image/jpeg',
        data: imageBase64!.replace(/^data:[^;]+;base64,/, ''),
      },
    });
  }

  const candidateModels = ['gemini-2.5-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.6-flash'];
  let rawText: string | null = null;

  // Function to run through candidate models with a given ai instance
  async function runModels(genAiInstance: GoogleGenAI): Promise<string | null> {
    for (const model of candidateModels) {
      try {
        const generatePromise = genAiInstance.models.generateContent({
          model,
          contents: [{ role: 'user', parts }],
          config: { responseMimeType: 'application/json' },
        });
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout calling model ${model}`)), 20000)
        );
        const result = await Promise.race([generatePromise, timeoutPromise]);
        if (result && result.text) {
          return result.text.trim();
        }
      } catch (err: any) {
        console.warn(`[WhatsApp AI] Model ${model} failed (${err?.status || err?.message}), trying fallback...`);
      }
    }
    return null;
  }

  rawText = await runModels(ai);

  // If primary key failed and env key is different, try with env key
  const envKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!rawText && envKey && envKey !== apiKey) {
    console.log('[WhatsApp AI] Primary API key failed, trying system GEMINI_API_KEY fallback...');
    try {
      const fallbackAi = new GoogleGenAI({
        apiKey: envKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });
      rawText = await runModels(fallbackAi);
    } catch {}
  }

  if (!rawText) {
    if (hasText) {
      const fallback = extractPaymentEntriesLocal(text);
      if (fallback.ok) return fallback;
    }
    return { ok: false, error: 'AI image scan failed — kripya dobara try karein.' };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    try {
      parsed = JSON.parse(rawText.replace(/^```(json)?/i, '').replace(/```$/, '').trim());
    } catch {
      if (hasText) {
        return extractPaymentEntriesLocal(text);
      }
      return { ok: false, error: 'AI response could not be parsed.' };
    }
  }

  // Parse and normalize entries
  const entries: WaExtractEntry[] = Array.isArray(parsed?.entries)
    ? parsed.entries
        .filter((e: any) => e && (String(e.billNo || '').trim() || Number(e.amount) > 0 || String(e.accountName || '').trim()))
        .map((e: any) => ({
          billNo: String(e.billNo || '').trim().replace(/^GST/i, '').replace(/^INV/i, '').replace(/^MOC/i, ''),
          amount: Number(e.amount) || 0,
          paymentMethod: String(e.paymentMethod || 'GPay').trim(),
          date: String(e.date || todayDMY).trim(),
          accountName: String(e.accountName || e.receiverName || e.paidTo || '').trim() || undefined,
          senderAccountName: String(e.senderAccountName || e.paidBy || '').trim() || undefined,
          partyName: String(e.partyName || '').trim() || undefined,
          upiId: String(e.upiId || e.utr || '').trim() || undefined,
          remarks: String(e.remarks || '').trim() || undefined,
        }))
    : [];

  // ── Auto-enrich entries with bill numbers from caption or text ──
  // The user says: "HAR SCREEN SHOT KE NICHE BILL NO TEXT FORMAT ME YA IMG KE SATH HOTA HI HE"
  // If AI didn't find the bill number in the image pixels, but the caption / text has bill numbers:
  if (hasText) {
    const textBillNos = parseBillNosFromText(text);
    if (textBillNos.length > 0) {
      const needsBill = entries.filter((e) => !e.billNo);
      if (needsBill.length > 0) {
        if (textBillNos.length === 1) {
          needsBill.forEach((e) => {
            e.billNo = textBillNos[0];
            e.remarks = e.remarks ? `${e.remarks} [Bill from caption]` : 'Bill from caption/text';
          });
        } else {
          // Multiple bill numbers in caption (e.g. "42911/42842")
          const base = needsBill[0] || entries[0] || { amount: 0, paymentMethod: 'GPay', date: todayDMY };
          const expanded: WaExtractEntry[] = textBillNos.map((bn) => ({
            ...base,
            billNo: bn,
            remarks: `Bill ${bn} detected from caption/text [Total ₹${base.amount}]`,
          }));
          entries.length = 0;
          entries.push(...expanded);
        }
      }
    }
  }

  if (entries.length === 0 && hasText) {
    const local = extractPaymentEntriesLocal(text);
    if (local.ok) return local;
  }

  // Generate an accurate, informative summary
  let finalSummary = parsed?.summary || 'WhatsApp payment extracted';
  const validBills = entries.filter((e) => e.billNo).map((e) => e.billNo);
  const totalAmt = entries[0]?.amount || 0;
  const acName = entries[0]?.accountName;
  const meth = entries[0]?.paymentMethod || 'GPay';

  if (validBills.length > 0) {
    finalSummary = `Bill ${validBills.join(', ')} ka ₹${totalAmt} (${meth})${acName ? ` [${acName}]` : ''} payment detected.`;
  } else if (totalAmt > 0) {
    finalSummary = `₹${totalAmt} ka ${meth} payment${acName ? ` [A/C: ${acName}]` : ''} detected.`;
  }

  return { ok: true, entries, summary: finalSummary };
}
