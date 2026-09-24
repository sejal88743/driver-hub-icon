
# Scale plan — fast reports at 100k+ bills (no table split)

Current state (confirmed by reads):
- `bills` = **26,696 rows** today, denormalized (single wide table). Growing toward 100k.
- Existing indexes: `id`, `bill_no` (×2), `driver_name`, `delivery_date`. **Missing on hot filter columns.**
- All reports fetch **entire bills table** in 1000-row chunks and aggregate in browser JS.
- Realtime subscribes to every bill change → full re-sync each edit.

Direction chosen: **keep bills flat, add indexes, move aggregation into Postgres, paginate on server**. No breaking table splits. Zero UI/business-logic changes for the user.

---

## Phase 1 — Database indexes (migration, ~5 sec on 26k rows)

Add btree indexes on hot filter columns. Postgres will use them for every WHERE, ORDER BY, and GROUP BY on reports.

```text
bills(date)                        -- date-range filters
bills(salesperson_name)            -- reports by salesperson
bills(payment_mode)                -- Paid/FBR/Credit/Del Pending splits
bills(party_code)                  -- party lookups
bills(payment_date)                -- "done today" counts
bills(date, driver_name)           -- driver daily reports (composite)
bills(delivery_date, driver_name)  -- driver page (composite)
bills(salesperson_name, date)      -- salesperson-date reports (composite)
```

Expected effect at 100k: filtered queries drop from **~800ms full scan → ~5–15ms**.

## Phase 2 — Postgres aggregation RPCs (migration)

Create `SECURITY DEFINER` functions that return **pre-aggregated report rows** — client gets 10–200 rows instead of 100k.

Functions to add:
- `report_driver_summary(from_date, to_date)` — per-driver totals: bill_count, collected, outstanding, paid/pending splits.
- `report_salesperson_summary(from_date, to_date)` — per-salesperson totals + status split.
- `report_payment_mode_summary(from_date, to_date)` — Paid/FBR/Credit/Del-Pending totals.
- `report_daily_collection(from_date, to_date)` — day-wise cash/upi/cheque split.
- `report_party_outstanding()` — outstanding by party (top-N with LIMIT).
- `dashboard_counts(target_date, driver_name)` — LOAD / DONE / PEND counts for dashboard header.

All return SQL result-sets (not JSON blobs), so PostgREST paginates them naturally.

## Phase 3 — Server-side pagination for bills list & reports pages

Replace "fetch all → filter in JS" with `supabase.from('bills').select(...).range(from, to).order(...)` + push filters (date range, driver, salesperson, status, search text) into the query.

Change points:
- `src/lib/apiSync.ts` → add `fetchBillsPage({ filters, page, pageSize })` returning `{ rows, total }`.
- Reports page → call new RPCs for totals; call `fetchBillsPage` for the detail table with virtualized rendering (already using react-window in some tables; extend where missing).
- Bills page → same paged fetch + server-side search on `bill_no` / `party_name` / `party_code`.

Keep the existing `apiFetchAllData()` full-sync **only** for the offline-first dashboard cache warm-up, but reduce its scope: fetch only bills where `date >= now() - 90 days` for the in-memory store. Older bills load on demand via paged fetch. This alone cuts memory from ~400 MB → ~40 MB at 100k rows.

## Phase 4 — Realtime tightening

Currently the realtime channel triggers a full re-sync on every `bills` change. Change to:
- Subscribe only to `INSERT`/`UPDATE` where `date >= today - 7`.
- On event, patch just the changed row into the in-memory store (already have `patchBillsInMemory`), not a full re-sync.

## Phase 5 — Optional master-data helper tables (dropdowns only)

Add two thin lookup tables **for dropdown consistency only** — bills still stores the copied name/code (denormalized, fast).

- `parties(code PK, name, mobile, updated_at)` — populated from existing distinct party_code/party_name in bills.
- `salespersons(name PK, mobile, updated_at)` — same.

Used by autocomplete dropdowns in dashboard entry & settings. **No FK on bills**, so reports keep zero-join speed. Data-integrity win without report-speed cost.

---

## Expected results at each scale

| Bills | Now (full-fetch + JS) | After plan |
|---|---|---|
| 26k (today) | Dashboard 4–6s, Reports 3–5s | Dashboard <1s, Reports <500ms |
| 100k | Dashboard 40–90s, Reports 15–30s freeze, mobile crash | Dashboard 1–2s, Reports <1s, memory <80 MB |
| 500k | Unusable | Dashboard 1–2s, Reports 1–2s |
| 1M+ | — | Still usable; add materialized views if needed |

## Effect / risk

- **Effect:** Reports load turant, mobile browsers won't crash, sync stays reliable, no code rewrite for business logic, no UI change for users, no data migration risk (indexes and RPCs are additive).
- **Risk:** Very low — all changes are additive. Existing writes/reads keep working during rollout. Each phase can be shipped independently and reverted by dropping the index/function.

## Rollout order

1. Phase 1 (indexes) — instant win, zero code change.
2. Phase 2 (RPCs) — added, not yet wired.
3. Phase 3 (paged fetch + wire RPCs into reports) — biggest UX gain.
4. Phase 4 (realtime tightening).
5. Phase 5 (master-data helper tables) — only if you want cleaner dropdowns.

## Technical notes

- All RPCs use `SECURITY DEFINER` + `SET search_path = public` and take typed parameters — no dynamic SQL.
- Composite indexes are ordered by selectivity (equality column first, range column second) so Postgres uses them for both filter and sort.
- The 90-day in-memory window is configurable via a `settings` row (`store_window_days`) so you can widen it later without a code push.
- We keep the persistent write-queue and retry logic already in `apiSync.ts` — this plan is read-side only.
