---
name: Credit line-cut balance
description: Dashboard Credit entries preserve cumulative line cuts and show only the remaining bill balance as Credit.
---

## Rule
When a Dashboard bill is saved as Credit, the saved line-cut total is preserved and
the Credit/outstanding balance is `billNetAmt - totalLineCut - collectedAmount`.
Line-cut input may be a plus-separated sum such as `100+128+335`; parse it as a
numeric total without evaluating arbitrary code.

**Why:** Resetting lineCutAmt to zero made old line-cut adjustments disappear from
Credit entries, so the Credit amount no longer matched the earlier dashboard workflow.

**How to apply:** Any future Credit-entry or partial-payment changes must keep the
line-cut total and outstanding calculation aligned in the UI preview, in-memory
state, and Supabase patch.