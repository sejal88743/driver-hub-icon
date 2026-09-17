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
