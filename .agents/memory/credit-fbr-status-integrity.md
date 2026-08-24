---
name: Credit/FBR status must reflect an actual saved entry, never be inferred
description: Bills must show CREDIT/FBR only when payment_mode is literally that value from a real save; several UI files used to merge the legacy 'Pending' status into Credit, and Supabase had bills with real cash/upi/cheque amounts still tagged FBR/Credit.
---

## Rule
`paymentMode === 'Credit'` (or `'FBR'`) must be the ONLY condition used to show a bill as
Credit/FBR anywhere in the UI (dashboard, driver PDF, reports). Never OR it with `'Pending'`
or any other legacy/derived signal — a bill with no explicit Credit/FBR save must fall through
to Assigned/Unpaid, not Credit.

**Why:** `'Pending'` is a distinct legacy status (maps to Del Pending via METHOD_MAP in
billStore.ts), not Credit. Several pages (`driver/page.tsx`, `reports/page.tsx`) had
`b.paymentMode === 'Credit' || b.paymentMode === 'Pending'` merged together, incorrectly
labeling assigned/pending bills as Credit. `DriverDayTable.tsx` already had it right
(strict `_bm === 'credit'` check) — use that file as the reference pattern.

**How to apply:** When adding any new Credit/FBR display logic, grep for `paymentMode === 'Credit'`
across the app first and match the strict pattern already used in `DriverDayTable.tsx`.

## Data quality: FBR/Credit bills with real payment amounts
Supabase had ~300 bills where `payment_mode` was `FBR`/`Credit` but `collected_amount` (or
`cash_amount`/`upi_amount`/`cheque_amount`) was actually > 0 — real money was received but the
status was never corrected. Root cause: legacy/imported data, not a live app bug (current
`savePayment` always zeroes cash/upi/cheque when saving FBR/Credit).

Fixed via `scripts/fix_mislabeled_fbr_credit_bills.mjs`: for bills with `collected_amount > 0`,
promote to `Paid` with method inferred from which of cash/upi/cheque is set, and set
`line_cut_amt = max(0, net - collected)`. For the rare case where `collected_amount === 0` but
a breakdown field is stale/nonzero (leftover from a prior edit), clear the stale field instead of
touching the status — `collected_amount` is the source of truth for "was this actually paid".

**Note on `.agents/memory/payment-status-system.md`:** that file's claim that `paymentMode` is
restricted to `Paid`/`FBR`/`Unpaid` (with Credit/Del Pending folded into Unpaid) is STALE — the
live app now treats Credit and Del Pending as first-class, distinct saved statuses. Trust the
current code (`METHOD_MAP` in `src/lib/billStore.ts`) over that memory file's mapping table.
