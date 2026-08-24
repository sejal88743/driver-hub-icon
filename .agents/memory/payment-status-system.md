---
name: 3-status payment system (STALE — superseded)
description: Describes an old Paid/FBR/Unpaid-only design. Superseded by credit-fbr-status-integrity.md — Credit and Del Pending are now first-class saved statuses. Kept for history only.
---

## STALE — see credit-fbr-status-integrity.md
The live app (as of 2026-07-13) treats `Credit` and `Del Pending` as real, distinct saved
`paymentMode` values (see `METHOD_MAP` in `src/lib/billStore.ts`), not folded into `Unpaid` as
described below. Do not apply the mapping table below to new code — read
`credit-fbr-status-integrity.md` instead.

## Rule (historical, no longer accurate)
`paymentMode` stores ONLY: `Paid`, `FBR`, `Unpaid`  
`paymentMethod` stores: `Cash`, `UPI`, `Cheque`, `Split`

## Mapping (collection method → final status)
- Cash/UPI/Cheque/Split → paymentMode = Paid, paymentMethod = method
- FBR/Cancel → paymentMode = FBR
- Credit/Del Pending/Pending → paymentMode = Unpaid

## Backward compatibility
Legacy values (Cash, UPI, Cheque, Split, Cancel) may exist in old DB rows.
`isBillPaid()` in billStore.ts handles both old and new values.
`driverStats` and `isSelectedBillPaid` also handle legacy values.

## Counting rule
- Paid count = paymentMode Paid OR FBR (+ legacy Cash/UPI/Cheque/Split/Cancel)
- Unpaid count = all others (Unpaid/empty/null)

## Auto-conversion
`/api/admin/fix-bills` endpoint migrates old values to new system in Supabase.

**Why:** Spec required separating the payment method (how it was paid) from the final status (whether it's settled). Merged before caused counting bugs.

**How to apply:** Any new code that checks paymentMode must check 'Paid'/'FBR'/'Unpaid' plus the legacy set for backward compat.
