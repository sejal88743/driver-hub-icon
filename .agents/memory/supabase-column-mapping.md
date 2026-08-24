---
name: Supabase column mapping
description: Supabase bills table may use snake_case columns; mapBillFromSupabase() in apiSync.ts handles both formats
---

## Rule
Always use `fetchAllBills()` (not `fetchAllRows<Bill>`) when reading bills from Supabase. `fetchAllBills()` applies `mapBillFromSupabase()` which handles both snake_case and camelCase column names via `??` fallback.

## Why
The Supabase bills table was created by Lovable and may use snake_case columns (`bill_no`, `payment_mode`, `collected_amount`, etc.) while the app's `Bill` TypeScript type uses camelCase. Without mapping, all payment fields return `undefined` → all bills appear UNPAID → DONE count = 0. Also causes `b.billNo.replace()` crashes in reports.

## How to apply
- READ: `fetchAllBills()` in `apiSync.ts` → calls `mapBillFromSupabase()` on every row
- WRITE: keep sending camelCase patches via `apiPatchBill` / `apiPushBills` (Supabase accepts whichever format its columns use)
- `stripGST` and any function receiving `b.billNo` must guard: `(bn || '').replace(...)`

**Fix location:** `src/lib/apiSync.ts` — `mapBillFromSupabase()` + `fetchAllBills()`
