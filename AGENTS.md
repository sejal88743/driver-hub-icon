# Persistent Agent Instructions & Project Rules

## Dashboard receipt filtering
- Use receipt date plus explicit entry-maker tags or the date-scoped saved-entry list for Owner table/counts; generic timestamps never prove Owner identity, preventing driver receipts from leaking into that view.

## 1. Locked Supabase Connection (CRITICAL - DO NOT CHANGE WITHOUT ADMIN PERMISSION)
App me Supabase connection yahi use hoga or jabhi change hoga admin ke permission ke alava change nahi hoga:
- **SUPABASE_URL**: `https://qmnofkoxoijihgwgrefv.supabase.co`
- **SUPABASE_PUBLISHABLE_KEY**: `sb_publishable_nxq5s4XWrgD6QdNOr4sPSQ_0rPdFlvK`
- **SUPABASE_JWKS_URL**: `https://qmnofkoxoijihgwgrefv.supabase.co/auth/v1/.well-known/jwks.json`

Strict Rules:
1. Never change the Supabase URL or credentials unless the user/admin explicitly gives permission.
2. The frontend directly communicates with Supabase (`src/lib/apiSync.ts`, `src/lib/supabase.ts`).
3. Never use delete-before-insert on Supabase tables; use safe upsert with onConflict.

## 2. Dev Environment & Runtime

### Architecture (single process)
- `npm run dev` = `tsx server.ts`: Express server that mounts Vite dev middleware AND serves the React SPA on port 3000.
- The frontend talks to Supabase directly (`src/lib/supabase.ts`, credentials locked).

### Secrets
- `GEMINI_API_KEY` (Google Gemini) is read lazily per-request by the AI agent endpoint; the app boots without it.
- Supabase credentials are hardcoded in `src/lib/supabase.ts` — no secret needed.

### WhatsApp Bot (linked-device)
- `server/whatsappBot.ts` runs Baileys (`@whiskeysockets/baileys`, **6.7.x config key is `auth`**).
- Session lives in `.wa-session/` (gitignored). Bot start/stop/status via `/api/admin/whatsapp-bot/*`; live events stream over SSE at `/api/admin/whatsapp-bot/events`.
- The bot's Gemini key comes ONLY from the `settings` table row `gemini_api_key` (saved from the admin UI, never the env key).
- Payment extraction is shared: `server/whatsappExtract.ts` (used by both the upload endpoint and the live bot). Saves happen ONLY after the user confirms in the popup (`src/components/WhatsAppPaymentPopup.tsx`).
- **Bill-no stitch**: real groups me receipt-screenshot aur "Billno42911/42842" jaisi bill-number text ALAG messages me aate hain. `server/whatsappBot.ts` dono sides 30 min tak stash karta hai (`pendingPayment` / `pendingBillNos`) aur dono milne par ek combined event emit karta hai.
- Drain bounded, stably ordered pages for full and incremental sync; never terminate using estimates or accept failed pages as empty, because doing so silently loses bills.
- Repair legacy incomplete caches once, and mark completion only after every remote page is applied; subsequent boots use cached data and incremental sync to avoid repeated full downloads.
- Never advance the incremental cursor on failure; bulk broadcasts and database changes complement polling so missed live notifications remain recoverable.

### Verify it works
- `curl localhost:3000/api/health` → `{"ok":true}`
- Preview loads at `/login` (auth-gated) and renders the distribution management UI.
