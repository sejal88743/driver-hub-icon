# Tasks
- [x] Repair full/delta pagination, incomplete-cache recovery and preserve the approved connection without changing saved data.
- [x] Verify 52,000/100,000 loading, bulk deltas, capped pages and retry regressions with six passing tests.
- [x] Verify approved backend live connection and exact count: 51,920 bills; initial HTTP 500 was transient and repeat reads succeeded.
- [ ] Verify signed-in full bill display and saved-data sync on two devices — blocked by no real Owner login session or second-device session; no production entries were changed.
- [x] Limit Dashboard Owner receipt rows to the selected receipt date and Owner entries.
- [x] Place History statement buttons below navigation and make them 50% smaller.
- [x] Verify date filtering with isolated sample rows and toolbar positioning in the browser without changing saved data; build OK.
- [ ] Verify real signed-in Owner receipts across devices — blocked by no active Owner login session; isolated UI tests passed.