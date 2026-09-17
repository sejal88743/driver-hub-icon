# VitraTrack Scripts Policy

CRITICAL DATABASE SAFETY NOTICE:
1. Hardcoded Supabase URLs and API keys are strictly forbidden in this repository.
2. All operational database interactions MUST go through the frontend verified client (`src/lib/supabase.ts` / `src/lib/apiSync.ts`).
3. Historical one-off bulk mutation scripts have been decommissioned to prevent accidental bulk operations on production data.
