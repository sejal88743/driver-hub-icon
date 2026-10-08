# Tasks
- [x] Limit Dashboard Owner receipt rows to the selected receipt date and Owner entries.
- [x] Place History statement buttons below navigation and make them 50% smaller.
- [x] Verify date filtering with isolated sample rows and toolbar positioning in the browser without changing saved data; build OK.
- [ ] Verify real signed-in Owner receipts across devices — blocked by no active Owner login session; isolated UI tests passed.- [x] History statement: unmatched entries Excel download + permanent save (Supabase settings + IndexedDB) — already present, verified.
- [x] Statement "cheq no" column parse; cheque no se CHEQUE bills match, blank ho to GPay se match.
- [x] Same party + same rec date ke 2+ bills ka rec total se statement entry match (subset-sum, ex: GST45384+GST45385=194707).
