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
- billNo: The bill number / invoice number (e.g. GST123456, MOC789, 123456). Often prefixed like "GST"/"MOC" — keep the prefix as written.
- amount: The payment amount (number only). If multiple amounts (cash + UPI), give the TOTAL received.
- paymentMethod: "Cash" | "UPI" | "Cheque" | "Split" | "" (best guess from context like "cash", "online", "gpay", "cheque")
- date: Payment date in DD/MM/YYYY. If the message says "aaj"/"today" use "${todayDMY}". If no date, use "${todayDMY}".
- partyName: Party/shop name if visible (optional).
- remarks: Any extra note (optional).

Rules:
- Read Hindi, English, Hinglish, Gujarati text and handwriting-style prints in screenshots.
- If amounts are unclear, still extract the bill number and give your best amount estimate.
- Do NOT invent bill numbers that are not visible in the image/text.

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

  const entries: WaExtractEntry[] = Array.isArray(parsed?.entries)
    ? parsed.entries.filter((e: any) => e && String(e.billNo || '').trim())
    : [];

  return { ok: true, entries, summary: parsed?.summary || '' };
}
