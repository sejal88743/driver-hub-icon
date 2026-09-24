---
name: apiFixAssignedCreditStatus could reset genuinely-paid bills to Assigned
description: The owner-triggered "fix Assigned/Credit status" sweep in apiSync.ts used to treat any outstandingAmount > 0 as unpaid, overwriting bills that had a real partial payment collected today back to 'Assigned'.
---

## Rule
Any reconciliation/sweep that decides whether a bill is "genuinely paid" must use the
SAME definition as `applyPaymentRules` in `src/lib/billStore.ts`: **if `collectedAmount > 0`,
the bill counts as paid (partial or full), even if a small shortfall/discrepancy was never
recorded as an explicit line cut.** Never key off `outstandingAmount <= 0` alone.

**Why:** `apiFixAssignedCreditStatus` (src/lib/apiSync.ts) is a manual sweep triggered from
the Settings page that resets stale bills to `Assigned` (today+driver) or `Credit` (older).
It originally skipped only when `outstandingAmount <= 0`, so a bill saved as `Paid` today with
a real cash/UPI/cheque amount that didn't exactly cover `bill_net_amt` (e.g. a few rupees
short, no line cut entered) got its status silently reset from `Paid` back to `Assigned` —
even though real money was collected. This showed up as a driver's dashboard Pending count
being wrong despite "all bills entered". Root cause found & fixed 2026-07-13; see
`scripts/fix_wrongly_reset_assigned_bills.mjs` for the one-off data repair.

**How to apply:** Before writing any new bill-status reconciliation/sweep, check
`collectedAmount > 0` as an unconditional "leave it alone" guard alongside `outstandingAmount`,
matching `applyPaymentRules`'s own comment: "if collectedAmount > 0, the bill is genuinely
paid — keep Paid."
