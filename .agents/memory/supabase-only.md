---
name: Supabase-only frontend DB
description: Frontend must always use Lovable Supabase directly; never migrate frontend to Replit PostgreSQL. Also documents the dangerous delete bug that wiped bills.
---

## Rule
The frontend data layer (src/lib/apiSync.ts, src/lib/supabase.ts, src/integrations/supabase/) connects directly to Supabase. Do NOT replace with Replit PostgreSQL or Express /api/* calls.

**Why:** App runs in both Lovable and Replit. Lovable has no Express backend — only frontend + Supabase. Switching apiSync.ts to call /api/* breaks Lovable completely.

**How to apply:**
- src/lib/apiSync.ts → imports from './supabase', calls supabase.from(...) directly
- src/lib/supabase.ts → createClient with VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY
- src/integrations/supabase/client.ts → must exist, never delete
- The Express server (server/index.ts + server/db.ts) uses Replit PostgreSQL (DATABASE_URL) for its own /api/* routes — that's separate and fine
- Supabase project ID: sgtjihrzpngktwnpihmx

## CRITICAL: Replit env vars override hardcoded fallbacks
Replit had VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY set as env vars pointing to the WRONG Supabase project. Because `??` only falls back when undefined, these env vars silently overrode the correct hardcoded Lovable URL.

**Fix applied:** Deleted VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY from Replit shared env. Now the hardcoded fallback sgtjihrzpngktwnpihmx.supabase.co is used.

**If data stops showing again:** Check `viewEnvVars({type:"env"})` — if VITE_SUPABASE_URL is re-set, delete it again.

## CRITICAL: DELETE bug that wiped all bills
The original apiPushBills() called `supabase.from('bills').delete().not('id','is',null)` BEFORE inserting. During HMR hot-reload in Replit, the in-memory store was empty — so delete ran, wiped all 7580 bills, then inserted 0 rows.

**Fix applied (permanent):**
- apiPushBills() now does safe upsert ONLY — no delete ever
- saveBills() in billStore.ts has guard: `if (deduped.length === 0) return` — never calls apiPushBills with empty array
- apiPushDrivers, apiPushBanks, apiPushSummaries, apiPushPartyContacts, apiPushSalespersonContacts — all converted to safe upsert, no delete
- All push functions have `if (input.length === 0) return { count: 0 }` guard at top

**Rule going forward:** NEVER use delete+insert pattern for Supabase tables. Always use upsert with onConflict. Empty arrays must never reach Supabase write functions.
