---
name: Sales Register update rules
description: Bill Wise Sales Register uploads use existing bill numbers, canonical party-code names, cleaned salesperson names, and idempotent line cuts
---

## Rule
Treat a Bill Wise Sales Register as an update-only snapshot: positive rows may update beat, party code, party name, and salesperson name; negative BillValue rows set the summed line-cut amount only. Never insert unmatched bills or overwrite payment/delivery fields.

**Why:** The register contains repeated bill rows and return rows. Adding negative values to an existing line-cut total makes re-uploading the same register double-count returns, while metadata from return rows can corrupt bill identity.

**How to apply:** Match by `BillRefNo`/`bill_no`, resolve party names by party code, remove the salesperson code suffix, set (not increment) the per-bill negative total, and report unmatched bills without inserting them.