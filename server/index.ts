import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { GoogleGenAI } from '@google/genai';
import { supabaseServer } from './supabaseServer.js';
import { extractPaymentEntries } from './whatsappExtract.js';
import {
  startBot, stopBot, resetBotSession, getBotStatus, setPaymentEventHandler,
  setStatusChangeHandler,
  selectBotGroup, initBotOnBoot, startWatchdog, isSessionSaved, WaPaymentEvent,
  forceRefreshGroups
} from './whatsappBot.js';
import { setGeminiApiKey, setWaBotEnabled } from './waBotConfig.js';
import { isEventDismissed, markEventDismissed } from './waDedupe.js';
import {
  handleUrgentMessageSse,
  createUrgentMessage,
  dismissUrgentMessage,
  cancelUrgentMessage,
  getActiveUrgentMessages,
  getAllUrgentMessages,
  initUrgentMessagesTable,
} from './urgentMessages.js';

const __dirname = process.cwd();

// Process-level suppression of benign connection drops and socket resets (e.g. Baileys / DB / SSE disconnects)
process.on('unhandledRejection', (reason: any, promise) => {
  const msg = String(reason?.message || reason || '');
  if (
    msg.includes('Connection Closed') ||
    msg.includes('connection closed') ||
    msg.includes('ECONNRESET') ||
    msg.includes('EPIPE') ||
    msg.includes('ETIMEDOUT')
  ) {
    console.warn('[Server] Handled unhandled rejection (benign transport close):', msg);
    return;
  }
  console.error('[Server] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err: any) => {
  const msg = String(err?.message || err || '');
  if (
    msg.includes('Connection Closed') ||
    msg.includes('connection closed') ||
    msg.includes('ECONNRESET') ||
    msg.includes('EPIPE') ||
    msg.includes('ETIMEDOUT')
  ) {
    console.warn('[Server] Handled uncaught exception (benign transport close):', msg);
    return;
  }
  console.error('[Server] Uncaught Exception:', err);
});

const app = express();
const allowedOrigins = (process.env.ALLOWED_ORIGIN ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    // Allow same-origin / curl (no Origin header)
    if (!origin) return cb(null, true);
    if (allowedOrigins.length === 0) return cb(null, true); // dev fallback
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
}));
app.use(express.json({ limit: '50mb' }));

// ─── Transparent Supabase Proxy ──────────────────────────────────────────────
const LOCKED_SUPABASE_URL = 'https://qmnofkoxoijihgwgrefv.supabase.co';
const LOCKED_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_nxq5s4XWrgD6QdNOr4sPSQ_0rPdFlvK';

app.use('/api/supabase-proxy', async (req, res) => {
  const targetPath = req.originalUrl.replace(/^\/api\/supabase-proxy/, '');
  const targetUrl = LOCKED_SUPABASE_URL + targetPath;

  const fwdHeaders = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    const lk = k.toLowerCase();
    if (lk !== 'host' && lk !== 'connection' && lk !== 'content-length' && lk !== 'accept-encoding' && typeof v === 'string') {
      fwdHeaders.set(k, v);
    }
  }
  // Guarantee the locked Supabase key is present
  if (!fwdHeaders.has('apikey')) {
    fwdHeaders.set('apikey', LOCKED_SUPABASE_PUBLISHABLE_KEY);
  }
  if (!fwdHeaders.has('authorization')) {
    fwdHeaders.set('authorization', 'Bearer ' + LOCKED_SUPABASE_PUBLISHABLE_KEY);
  }

  let body: any = undefined;
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
    if (Buffer.isBuffer(req.body)) {
      body = req.body;
    } else if (typeof req.body === 'object' && req.body !== null) {
      body = JSON.stringify(req.body);
      fwdHeaders.set('content-type', 'application/json');
    } else if (typeof req.body === 'string') {
      body = req.body;
    }
  }

  try {
    const resp = await fetch(targetUrl, {
      method: req.method,
      headers: fwdHeaders,
      body,
    });

    resp.headers.forEach((v, k) => {
      const lower = k.toLowerCase();
      if (lower !== 'content-encoding' && lower !== 'content-length' && lower !== 'transfer-encoding') {
        res.setHeader(k, v);
      }
    });
    res.status(resp.status);
    const buf = Buffer.from(await resp.arrayBuffer());
    res.send(buf);
  } catch (err: any) {
    console.error('[SupabaseProxy] Proxy error:', err?.message || err);
    res.status(502).json({ error: String(err?.message || err) });
  }
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});



// ─── Upsert setting ───────────────────────────────────────────────────────────
app.post('/api/settings', async (req, res) => {
  const { key, value } = req.body as { key: string; value: string };
  try {
    if (key === 'gemini_api_key') {
      await setGeminiApiKey(value);
    } else if (key === 'wa_bot_enabled') {
      await setWaBotEnabled(value === 'true');
    } else {
      const { error } = await supabaseServer
        .from('settings')
        .upsert({ key, value: String(value ?? '') }, { onConflict: 'key' });
      if (error) throw error;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /api/settings]', err);
    res.status(500).json({ error: 'Failed to save setting' });
  }
});



// Helper function to call Gemini with multi-model fallback (handles 503/high-demand spikes gracefully)
async function generateGeminiContentWithFallback(ai: GoogleGenAI, prompt: string): Promise<string | null> {
  const candidateModels = ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite'];
  for (const model of candidateModels) {
    try {
      const generatePromise = ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        },
      });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout calling model ${model}`)), 5000)
      );
      const res = await Promise.race([generatePromise, timeoutPromise]);
      if (res && res.text) {
        return res.text.trim();
      }
    } catch (err: any) {
      console.warn(`[Gemini Fallback] Model ${model} unavailable or busy (${err?.status || err?.code || err?.message}), trying next fallback...`);
    }
  }
  return null;
}

// ─── Admin AI Agent endpoint (Gemini Powered DB Assistant & XLS Bulk Engine) ─
app.post('/api/admin/ai-agent', async (req, res) => {
  try {
    const { action, prompt, apiKey: clientApiKey, detectedHeaders } = req.body ?? {};
    const apiKey = (typeof clientApiKey === 'string' && clientApiKey.trim())
      ? clientApiKey.trim()
      : (req.headers['x-gemini-api-key'] as string) || process.env.GEMINI_API_KEY;

    // Helper date formatting (DD/MM/YYYY)
    const now = new Date();
    const todayDMY = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

    // 0. PARSE INTENT ONLY (LIGHTWEIGHT GEMINI CALL WITH DEEP REASONING)
    if (action === 'parse-intent') {
      const userPrompt = typeof prompt === 'string' ? prompt.trim() : '';
      if (!userPrompt) {
        return res.json({ ok: false, error: 'Prompt is required.' });
      }

      let parsedResult: any = null;
      if (apiKey) {
        try {
          const ai = new GoogleGenAI({
            apiKey,
            httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
          });

          const promptContext = `You are the VitraTrack Billing AI Administrator & Database Operations Agent.
Analyze this admin request for a billing database (which can handle 40,000+ bills and XLS data).
User Command/Prompt: "${userPrompt}"
Today's Date: "${todayDMY}"
Available XLS Headers (if any uploaded): ${Array.isArray(detectedHeaders) ? JSON.stringify(detectedHeaders) : '[]'}

Understand the user's intent in Hindi, Hinglish, Gujarati, or English:
1. Operation Type:
   - "BULK_XLS_UPDATE": User wants to update a field in Supabase/Database from uploaded XLS data (e.g. "ye 42000 bills ke xls data se sabhi sales porson name ko supabase me update karo", "driver names xls se update karo", "beat names xls se update karo")
   - "STATUS_UPDATE": User wants to mark bills as Paid (Cash/UPI/Cheque), FBR, Credit, Del Pending, or Unpaid.
   - "FIELD_UPDATE": User wants to update a specific field across bills (e.g. "salesperson Ramesh ko Suresh karo", "driver Mukesh ke sabhi bills me driver Ramesh karo", "line cut amount 0 karo")
   - "READ_QUERY": User is asking a question, count, summary, or report (e.g. "kitne bills unpaid hai", "driver wise summary batao", "salesperson list dikhao", "total outstanding kitna hai")
   - "CONDITIONAL_UPDATE": Update field Y where field X matches a condition.

2. Target Field:
   - "salespersonName" (for sales person, salesman, salesperson, SR)
   - "driverName" (for driver, route driver)
   - "beatName" (for beat, route, market)
   - "partyName" (for party name)
   - "paymentMode" (for status, Paid, FBR, Credit, Unpaid)
   - "lineCutAmt" (for line cut, damage deduction)
   - "deliveryDate" (for delivery date)
   - "paymentDate" (for collection / rec date)
   - "discrepancyReason" (for FBR reason)
   - "" (if generic read query)

3. Target Value:
   - "FROM_XLS" if pulling from uploaded XLS column
   - Specific string/number value if specified (e.g. "Suresh", 0, "Goods Return")
   - "" if not applicable

4. XLS Column Mapping Hint (if BULK_XLS_UPDATE):
   - For salesperson: look for header like "Salesman", "Sales Person", "Sales Person Name", "SR Name", "Employee"
   - For driver: "Driver", "Driver Name"
   - For beat: "Beat", "Beat Name", "Market"
   - For amount: "Amount", "Net Amount", "Total"

5. Thinking Steps:
   - Provide 3-4 detailed Hindi/Hinglish reasoning steps explaining your logic and plan.
   - Example Step 1: "Command samjha: User ne XLS data se sabhi bills ke Salesperson Name ko Supabase me update karne ko kaha hai."
   - Example Step 2: "Column mapping identify ki: Bill No column aur Salesperson Name column ko match kiya jayega."
   - Example Step 3: "Database comparison plan: 42,000 records ke sath database matching aur verification tayar ki gayi."
   - Example Step 4: "Batch execution strategy: Chunks (800 bills per batch) me Supabase upsert aur app state sync hoga bina browser freeze hue."

6. Payment specifics (if STATUS_UPDATE):
   - targetPaymentMode: "Paid" | "FBR" | "Credit" | "Del Pending" | "Unpaid" | ""
   - targetPaymentMethod: "Cash" | "UPI" | "Cheque" | "Split" | ""
   - targetDate: DD/MM/YYYY (default "${todayDMY}")
   - targetAmountMode: "NET_AMOUNT" | "ZERO" | "CUSTOM"
   - discrepancyReason: string

Respond ONLY in valid JSON matching schema:
{
  "explanation": "Clear friendly Hinglish summary of the operation",
  "operationType": "BULK_XLS_UPDATE" | "STATUS_UPDATE" | "FIELD_UPDATE" | "READ_QUERY" | "CONDITIONAL_UPDATE",
  "isWriteIntent": boolean,
  "targetField": string,
  "targetValue": string,
  "sourceColumnHint": string,
  "filterCondition": {
    "field": string,
    "operator": "equals" | "contains" | "greater_than" | "is_not",
    "value": string
  },
  "thinkingSteps": [string, string, string, string],
  "targetPaymentMode": "Paid" | "FBR" | "Credit" | "Del Pending" | "Unpaid" | "",
  "targetPaymentMethod": "Cash" | "UPI" | "Cheque" | "Split" | "",
  "targetDate": string,
  "targetAmountMode": "NET_AMOUNT" | "ZERO" | "CUSTOM",
  "discrepancyReason": string,
  "searchKeyword": string
}`;

          const rawText = await generateGeminiContentWithFallback(ai, promptContext);
          if (rawText) {
            try {
              parsedResult = JSON.parse(rawText);
            } catch {}
          }
        } catch (gemErr) {
          console.warn('[Gemini Parse-Intent Warning]', gemErr);
        }
      }

      return res.json({
        ok: true,
        parsed: parsedResult,
      });
    }

    return res.status(400).json({ ok: false, error: 'Unsupported action. Use action: "parse-intent".' });
  } catch (err) {
    console.error('[POST /api/admin/ai-agent]', err);
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

// ─── WhatsApp AI Bot endpoint (Screenshot/Image/Text → Bill No + Payment extraction) ──
// NOTE: Uses ONLY the Gemini API key saved in the Admin page (sent per-request
// from the frontend). Never falls back to the env key.
app.post('/api/admin/whatsapp-ai', async (req, res) => {
  try {
    const { action, text, imageBase64, imageMime, apiKey: clientApiKey } = req.body ?? {};

    // CRITICAL: Admin page saved key ONLY — no env fallback.
    const apiKey = (typeof clientApiKey === 'string' && clientApiKey.trim())
      ? clientApiKey.trim()
      : ((req.headers['x-gemini-api-key'] as string) || '').trim();

    if (!apiKey) {
      return res.status(400).json({
        ok: false,
        error: 'Gemini API key required. Admin page (AI Agent section) me apni Gemini API key save karein — WhatsApp AI sirf wahi key use karta hai.',
      });
    }

    if (action !== 'extract') {
      return res.json({ ok: false, error: 'Unknown action. Use action: "extract".' });
    }

    const result = await extractPaymentEntries({ apiKey, text, imageBase64, imageMime });
    return res.json(result);
  } catch (err) {
    console.error('[POST /api/admin/whatsapp-ai]', err);
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

// ─── WhatsApp Live Bot control + SSE event stream (linked-device bot) ────────
const waSseClients = new Set<any>();
const recentPaymentEvents: WaPaymentEvent[] = [];
const dismissedEventIds = new Set<string>();

setInterval(() => {
  for (const c of waSseClients) {
    try { c.write(': ping\n\n'); } catch {}
  }
}, 25000);

// Live bot payment extraction → broadcast to all connected app clients (popup)
setPaymentEventHandler((event) => {
  // If this event replaces an older pending event (e.g. unlinked receipt combined with bill numbers)
  if (event.replacesEventId) {
    const idx = recentPaymentEvents.findIndex((e) => e.id === event.replacesEventId);
    if (idx !== -1) {
      recentPaymentEvents.splice(idx, 1);
    }
    dismissedEventIds.add(event.replacesEventId);
    markEventDismissed(event.replacesEventId);
  }

  // Deduplicate in recentPaymentEvents
  const existingIdx = recentPaymentEvents.findIndex((e) => e.id === event.id);
  if (existingIdx !== -1) {
    recentPaymentEvents[existingIdx] = event;
  } else {
    recentPaymentEvents.push(event);
    if (recentPaymentEvents.length > 50) recentPaymentEvents.shift();
  }

  const payload = `data: ${JSON.stringify(event)}\n\n`;
  console.log(`[SSE] Broadcasting WhatsApp payment event (${event.id}) to ${waSseClients.size} client(s)...`);
  for (const c of waSseClients) {
    try { c.write(payload); } catch {}
  }
});

// Live bot status change (QR code generated, connected, disconnected) → broadcast to all SSE clients in real-time
setStatusChangeHandler((newStatus) => {
  const payload = `data: ${JSON.stringify({ type: 'status', status: newStatus })}\n\n`;
  for (const c of waSseClients) {
    try { c.write(payload); } catch {}
  }
});

// SSE stream: the app stays connected; payment events arrive in real time
app.get('/api/admin/whatsapp-bot/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.write(`data: ${JSON.stringify({ type: 'status', status: getBotStatus() })}\n\n`);

  // Replay recent un-dismissed payment events (e.g. from last 2 hours)
  for (const ev of recentPaymentEvents) {
    if (!dismissedEventIds.has(ev.id) && !isEventDismissed(ev.id)) {
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
    }
  }

  waSseClients.add(res);
  req.on('close', () => waSseClients.delete(res));
});

app.post('/api/admin/whatsapp-bot/dismiss', (req, res) => {
  const { eventId, paymentDetails } = req.body || {};
  if (eventId) {
    dismissedEventIds.add(String(eventId));
    markEventDismissed(String(eventId), paymentDetails);
  }
  res.json({ ok: true });
});

app.post('/api/admin/whatsapp-bot/start', (_req, res) => {
  startBot();
  res.json({ ok: true, status: getBotStatus() });
});

app.post('/api/admin/whatsapp-bot/stop', (req, res) => {
  const shutdown = (req.query as any)?.shutdown === 'true' || (req.body as any)?.shutdown === true;
  // Default: Wipes old session credentials and generates fresh NEW QR code for new connection
  stopBot(!shutdown);
  res.json({ ok: true, status: getBotStatus() });
});

app.post('/api/admin/whatsapp-bot/reset', (_req, res) => {
  resetBotSession();
  res.json({ ok: true, status: getBotStatus() });
});

app.get('/api/admin/whatsapp-bot/status', (_req, res) => {
  const current = getBotStatus();
  if (!current.running && isSessionSaved()) {
    startBot();
  }
  res.json({ ok: true, status: getBotStatus() });
});

app.post('/api/admin/whatsapp-bot/select-group', async (req, res) => {
  const jid = String((req.body as any)?.jid || '');
  const name = String((req.body as any)?.name || '');
  await selectBotGroup(jid, name);
  res.json({ ok: true, status: getBotStatus() });
});

app.post('/api/admin/whatsapp-bot/refresh-groups', async (_req, res) => {
  try {
    await forceRefreshGroups();
    res.json({ ok: true, status: getBotStatus() });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || err, status: getBotStatus() });
  }
});



// ─── Urgent Broadcast Messages ─────────────────────────────────────────────
app.get('/api/urgent-messages/stream', (req, res) => {
  handleUrgentMessageSse(req, res);
});

app.get('/api/urgent-messages/active', (req, res) => {
  const userName = typeof req.query.userName === 'string' ? req.query.userName : undefined;
  const messages = getActiveUrgentMessages(userName);
  res.json({ ok: true, messages });
});

app.get('/api/urgent-messages/all', (_req, res) => {
  const messages = getAllUrgentMessages();
  res.json({ ok: true, messages });
});

app.post('/api/urgent-messages/send', async (req, res) => {
  try {
    const { senderName, senderRole, targetUser, text } = req.body || {};
    if (!text || !String(text).trim()) {
      return res.status(400).json({ ok: false, error: 'Message text is required' });
    }
    const message = await createUrgentMessage({
      senderName: String(senderName || 'Admin'),
      senderRole: String(senderRole || 'owner'),
      targetUser: String(targetUser || 'ALL'),
      text: String(text).trim(),
    });
    res.json({ ok: true, message });
  } catch (err: any) {
    console.error('[POST /api/urgent-messages/send]', err);
    res.status(500).json({ ok: false, error: err?.message || 'Failed to send message' });
  }
});

app.post('/api/urgent-messages/dismiss', async (req, res) => {
  try {
    const { id, userName } = req.body || {};
    if (!id) return res.status(400).json({ ok: false, error: 'Message ID is required' });
    const success = await dismissUrgentMessage(String(id), String(userName || 'User'));
    res.json({ ok: success });
  } catch (err: any) {
    console.error('[POST /api/urgent-messages/dismiss]', err);
    res.status(500).json({ ok: false, error: err?.message || 'Failed to dismiss message' });
  }
});

app.post('/api/urgent-messages/cancel', async (req, res) => {
  try {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ ok: false, error: 'Message ID is required' });
    const success = await cancelUrgentMessage(String(id));
    res.json({ ok: success });
  } catch (err: any) {
    console.error('[POST /api/urgent-messages/cancel]', err);
    res.status(500).json({ ok: false, error: err?.message || 'Failed to cancel message' });
  }
});

// ─── Vite Middleware & Static File Serving ─────────────────────────────────
async function setupViteOrStatic() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
      },
      appType: 'spa',
    });
    // HMR is disabled in this environment; keep Vite's CSS/hot exports intact without opening a failing WebSocket.
    app.get('/@vite/client', async (_req, res, next) => {
      try {
        const result = await vite.transformRequest('/@vite/client');
        if (!result) return next();
        const code = result.code
          .replace('console.debug("[vite] connecting...");', '/* HMR disabled */')
          .replace('transport.connect(createHMRHandler(handleMessage));', '/* HMR WebSocket disabled */')
          .replace('wsTransport.send(data);', 'return;');
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.send(code);
      } catch (err) {
        next(err);
      }
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*all', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  let parsedPort = 3000;
  const portArgIdx = process.argv.indexOf('--port');
  if (portArgIdx !== -1 && process.argv[portArgIdx + 1]) {
    const p = Number(process.argv[portArgIdx + 1]);
    if (!isNaN(p) && p > 0) parsedPort = p;
  }
  const PORT = parsedPort;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[API] Server running on http://0.0.0.0:${PORT}`);
    initUrgentMessagesTable();
    initBotOnBoot();
    startWatchdog();
  });
}

setupViteOrStatic();

export default app;
