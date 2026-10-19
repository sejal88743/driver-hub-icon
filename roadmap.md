# Tasks
- [x] Repair full/delta pagination, incomplete-cache recovery and preserve the approved connection without changing saved data.
- [x] Verify 52,000/100,000 loading, bulk deltas, capped pages and retry regressions with six passing tests.
- [ ] Verify live full bill count and cross-device saved-data sync — approved backend bill reads return HTTP 500; no real Owner login session available.
- [x] Limit Dashboard Owner receipt rows to the selected receipt date and Owner entries.
- [x] Place History statement buttons below navigation and make them 50% smaller.
- [x] Verify date filtering with isolated sample rows and toolbar positioning in the browser without changing saved data; build OK.
- [ ] Verify real signed-in Owner receipts across devices — blocked by no active Owner login session; isolated UI tests passed.