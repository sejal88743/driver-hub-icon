# Persistent Agent Instructions & Project Rules

## 1. Locked Supabase Connection (CRITICAL - DO NOT CHANGE WITHOUT ADMIN PERMISSION)
App me Supabase connection yahi use hoga or jabhi change hoga admin ke permission ke alava change nahi hoga:
- **SUPABASE_URL**: `https://zybrzzouzleacqjvfiiu.supabase.co`
- **SUPABASE_PUBLISHABLE_KEY**: `sb_publishable_gkwGkK0YvU8q_GjkkcRNOg_XsE3AcGV`
- **SUPABASE_JWKS_URL**: `https://zybrzzouzleacqjvfiiu.supabase.co/auth/v1/.well-known/jwks.json`

Strict Rules:
1. Never change the Supabase URL or credentials unless the user/admin explicitly gives permission.
2. The frontend directly communicates with Supabase (`src/lib/apiSync.ts`, `src/lib/supabase.ts`).
3. Never use delete-before-insert on Supabase tables; use safe upsert with onConflict.

## 2. Base44 Dev Environment

### Architecture (single process)
- `npm run dev` = `tsx server/index.ts`: one Express server that mounts Vite dev
  middleware (frontend HMR) AND serves the React SPA, all on port 3000. Single
  origin — no separate API port, no CORS config needed for the app's own calls.
- The frontend talks to Supabase directly (`src/lib/supabase.ts`, credentials
  hardcoded/locked). The backend's own Postgres (`bills` etc.) is a secondary cache.

### Database
- `server/db.ts` falls back to an in-memory mock pool when `DATABASE_URL` is unset
  or a query fails — the app boots without a DB, but API endpoints return empty.
  SSL is auto-disabled for local/internal hosts (localhost, 127.0.0.1, `db`);
  remote managed DBs use SSL. The pool wrapper exposes `query/connect/on/end`.
- Schema is created by `server/migrate.ts` (run as a one-shot compose service on
  boot). Tables: bills, drivers, banks, driver_summaries, settings, contacts.

### Secrets
- `GEMINI_API_KEY` (Google Gemini) is read lazily per-request by the AI agent
  endpoint; the app boots without it. A dev placeholder is generated so the var
  exists — replace it with a real key (https://aistudio.google.com/apikey) for the
  AI agent feature to work.
- Supabase credentials are hardcoded in `src/lib/supabase.ts` — no secret needed.

### WhatsApp Bot (linked-device)
- `server/whatsappBot.ts` runs Baileys (`@whiskeysockets/baileys`, ESM-only pkg,
  needs `git` at `npm install` time — installed via apt in the compose commands).
- **Baileys 6.7.x config key is `auth`**, NOT `authState` (silent API change).
- Session lives in `.wa-session/` (gitignored). Bot start/stop/status via
  `/api/admin/whatsapp-bot/*`; live events stream over SSE at
  `/api/admin/whatsapp-bot/events`.
- The bot's Gemini key comes ONLY from the `settings` table row `gemini_api_key`
  (saved from the admin UI, never the env/Base44 key). `/api/all` strips that key.
- Payment extraction is shared: `server/whatsappExtract.ts` (used by both the
  upload endpoint and the live bot). Saves happen ONLY after the user confirms
  in the popup (`src/components/WhatsAppPaymentPopup.tsx`).

### Verify it works
- `curl localhost:3000/api/health` → `{"ok":true}`
- `curl localhost:3000/api/all` → JSON with bills/drivers/banks/... arrays
- Preview loads at `/login` (auth-gated) and renders the distribution management UI.
