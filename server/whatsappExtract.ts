import { GoogleGenAI } from '@google/genai';

export type WaExtractEntry = {
  billNo: string;
  amount: number;
  paymentMethod: string;
  date: string;
  partyName?: string;
  remarks?: string;
};

export type WaExtractResult =
  | { ok: true; entries: WaExtractEntry[]; summary: string }
  | { ok: false; error: string };

/** Shared Gemini extraction used by both the admin upload endpoint AND the live WhatsApp bot. */
export async function extractPaymentEntries(opts: {
  apiKey: string;
  text?: string;
  imageBase64?: string;
  imageMime?: string;
}): Promise<WaExtractResult> {
  const { apiKey, text, imageBase64, imageMime } = opts;

  const hasImage = typeof imageBase64 === 'string' && imageBase64.trim().length > 0;
  const hasText = typeof text === 'string' && text.trim().length > 0;
  if (!apiKey) return { ok: false, error: 'Gemini API key required.' };
  if (!hasImage && !hasText) return { ok: false, error: 'WhatsApp message content required hai.' };

  const now = new Date();
  const todayDMY = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
  });

  const instruction = `You are VitraTrack's WhatsApp Payment Extraction Bot. A WhatsApp group message (text and/or screenshot/image) contains payment confirmations from salesmen/drivers. Extract EVERY payment entry you can find.

Today's Date: "${todayDMY}"

From the message or screenshot, identify for each payment:
- billNo: The bill number / invoice number. Har screenshot/message me bill no "GST45027" ya "45027" format me likha hota hai — "GST" prefix strip karke SIRF number part do (GST45027 → "45027", GST123 → "123"). Agar koi aur prefix ho (MOC789, IV123) to bhi prefix hata kar sirf number do.
- amount: The payment amount (number only). If multiple amounts (cash + UPI), give the TOTAL received.
- paymentMethod: "Cash" | "GPay" | "UPI" | "Cheque" | "Split" | "" — gpay / google pay / online payments ke liye "GPay" use karo, cash ke liye "Cash", cheque ke liye "Cheque" (best guess from context)
- date: Payment date in DD/MM/YYYY. If the message says "aaj"/"today" use "${todayDMY}". If no date, use "${todayDMY}".
- partyName: Party/shop name if visible (optional).
- remarks: Any extra note (optional).

Rules:
- Read Hindi, English, Hinglish, Gujarati text and handwriting-style prints in screenshots.
- If amounts are unclear, still extract the bill number and give your best amount estimate.
- Do NOT invent bill numbers that are not visible in the image/text.
- Often the bill number comes as a SEPARATE text message right before/after the payment screenshot (e.g. "Billno42911/42842", "42155", "42514"). If the screenshot shows a payment but NO bill number is visible anywhere in this message, return ONE entry with billNo: "" and the correct amount/method/date — do NOT guess a bill number.
- If one message/caption lists multiple bill numbers for one payment (e.g. "Billno42911/42842"), return a separate entry for EACH bill number, each with the full payment amount.

Respond ONLY with valid JSON matching exactly this schema:
{"entries":[{"billNo":"string","amount":number,"paymentMethod":"Cash","date":"DD/MM/YYYY","partyName":"string","remarks":"string"}],"summary":"one line Hinglish summary of what was extracted"}`;

  const parts: Array<Record<string, any>> = [{ text: instruction }];
  if (hasText) {
    parts.push({ text: `WhatsApp message text content:\n"""\n${String(text).slice(0, 15000)}\n"""` });
  }
  if (hasImage) {
    parts.push({
      inlineData: {
        mimeType: imageMime || 'image/jpeg',
        data: imageBase64!.replace(/^data:[^;]+;base64,/, ''),
      },
    });
  }

  // Vision extraction needs longer timeout than the text-only intent parser.
  const candidateModels = ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite'];
  let rawText: string | null = null;
  for (const model of candidateModels) {
    try {
      const generatePromise = ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts }],
        config: { responseMimeType: 'application/json' },
      });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout calling model ${model}`)), 30000)
      );
      const result = await Promise.race([generatePromise, timeoutPromise]);
      if (result && result.text) {
        rawText = result.text.trim();
        break;
      }
    } catch (err: any) {
      console.warn(`[WhatsApp AI] Model ${model} unavailable (${err?.status || err?.message}), trying next fallback...`);
    }
  }

  if (!rawText) return { ok: false, error: 'AI extraction failed — thodi der baad dobara try karein.' };

  let parsed: any;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    try {
      parsed = JSON.parse(rawText.replace(/^```(json)?/i, '').replace(/```$/, '').trim());
    } catch {
      return { ok: false, error: 'AI response could not be parsed.' };
    }
  }

  // Keep entries with a billNo OR a payment amount — amount-only entries let the
  // live bot stash a receipt whose bill number arrives in the next text message.
  const entries: WaExtractEntry[] = Array.isArray(parsed?.entries)
    ? parsed.entries.filter((e: any) => e && (String(e.billNo || '').trim() || Number(e.amount) > 0))
    : [];

  return { ok: true, entries, summary: parsed?.summary || '' };
}
