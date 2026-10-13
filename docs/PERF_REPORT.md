# Performance report

Generated 2026-10-13 from a production-scale test dataset (separate database, never production; the generator script has since been removed).

## Dataset

| Collection | Documents |
|---|---:|
| advances | 600 |
| notifications | 0 |
| otps | 0 |
| accounts | 2 |
| purchases | 3,000 |
| safetyrecords | 1,000 |
| machineentries | 8,933 |
| machines | 12 |
| vehicletrips | 12,000 |
| ratelimits | 7 |
| perfremarks | 0 |
| leaves | 800 |
| stockitems | 60 |
| repairs | 1,500 |
| royalties | 60 |
| counters | 4 |
| attendances | 1,81,873 |
| dailysummaries | 1,826 |
| settings | 1 |
| blocks | 4,000 |
| perfsnapshots | 0 |
| idempotencykeys | 0 |
| complaints | 1,500 |
| tasks | 3,000 |
| dailyreports | 80,546 |
| employees | 100 |
| cashentries | 2,00,000 |
| sales | 20,000 |
| salarysheets | 0 |
| expenseheads | 0 |
| rolepermissions | 0 |
| jobruns | 0 |
| dispatches | 24,000 |
| expenses | 40,000 |
| paperdocs | 40 |
| auditlogs | 10,00,003 |
| sessions | 23 |
| payments | 20,000 |
| suppliers | 60 |
| users | 6 |
| stockmovements | 50,000 |
| vehicles | 0 |
| fileobjects | 0 |
| stockcounts | 0 |
| customers | 800 |
| cashclosings | 0 |

## Query plans — before vs after indexing

Same data, same queries. **Before** = only `_id` indexes. **After** = the indexes declared in `lib/models/*` (`npm run db:indexes`). “docs” = documents examined (`executionStats.totalDocsExamined`); wall = median of 5 runs.

| Query | Plan before | docs before | ms before | Plan after | docs after | ms after |
|---|---|---:|---:|---|---:|---:|
| employees: active list (sort empCode) | **COLLSCAN** | 100 | 5.5 | IXSCAN status_1_job_1, status_1_name_1 | 95 | 5.8 |
| employees: name prefix search | **COLLSCAN** | 100 | 3.9 | IXSCAN empCode_1, name_1 | 12 | 4.3 |
| dailyreports: one day (owner screen) | **COLLSCAN** | 80,546 | 171.5 | IXSCAN isVoid_1_date_1_empName_1__id_1, date_1_supCheck_1 | 26 | 4.5 |
| dailyreports: worker "my recent" | **COLLSCAN** | 80,546 | 178.4 | IXSCAN isVoid_1_empCode_1_date_1__id_1, isVoid_1_date_1_empName_1__id_1 | 10 | 3.8 |
| attendance: one day | **COLLSCAN** | 1,81,873 | 391.9 | IXSCAN date_1_empCode_1, date_1_state_1 | 95 | 6.4 |
| attendance: one employee, one month | **COLLSCAN** | 1,81,873 | 378.6 | IXSCAN isVoid_1_empCode_1_date_1__id_1, date_1_state_1 | 12 | 2.9 |
| sales: latest list | **COLLSCAN** | 20,000 | 99.9 | IXSCAN isVoid_1_date_1__id_1, isVoid_1_stage_1_date_1__id_1 | 26 | 4.4 |
| sales: stage filter + latest | **COLLSCAN** | 20,000 | 115.1 | IXSCAN isVoid_1_stage_1_date_1__id_1, stage_1_outstanding_1 | 26 | 5.3 |
| sales: salesperson "my sales" | **COLLSCAN** | 20,000 | 77.7 | IXSCAN isVoid_1_salespersonUserId_1_date_1__id_1, salespersonUserId_1_date_-1 | 26 | 4.4 |
| sales: one customer | **COLLSCAN** | 20,000 | 47.4 | IXSCAN isVoid_1_customerId_1_date_1__id_1, isVoid_1_date_1__id_1 | 22 | 4.3 |
| sales: overdue receivables (reminders) | **COLLSCAN** | 20,000 | 75.4 | IXSCAN stage_1_outstanding_1, stage_1_date_-1 | 576 | 12 |
| sales: receivables ageing (aggregate) | **COLLSCAN** | 20,000 | 34.6 | IXSCAN stage_1_outstanding_1, stage_1_date_-1 | 576 | 6.6 |
| payments: for one sale | **COLLSCAN** | 20,000 | 49.2 | IXSCAN saleId_1_date_1 | 1 | 2.8 |
| payments: one day (report) | IXSCAN _id_ | 20,000 | 109.4 | IXSCAN date_-1, _id_ | 11 | 3.1 |
| dispatches: for one sale | **COLLSCAN** | 24,000 | 58.6 | IXSCAN saleId_1_status_1, isVoid_1_date_1__id_1 | 1 | 3.7 |
| dispatches: trucks waiting at gate | **COLLSCAN** | 24,000 | 65.7 | IXSCAN isVoid_1_direction_1_status_1_date_1__id_1, status_1_date_-1 | 0 | 3.3 |
| dispatches: latest list | **COLLSCAN** | 24,000 | 113.6 | IXSCAN isVoid_1_date_1__id_1, isVoid_1_direction_1_status_1_date_1__id_1 | 26 | 4.4 |
| stockmovements: latest list | **COLLSCAN** | 50,000 | 167.1 | IXSCAN isVoid_1_date_1__id_1, isVoid_1_itemId_1_date_1__id_1 | 26 | 3.1 |
| stockmovements: one item | **COLLSCAN** | 50,000 | 135.7 | IXSCAN isVoid_1_itemId_1_date_1__id_1, isVoid_1_date_1__id_1 | 26 | 2.9 |
| stockitems: below minimum (alert) | **COLLSCAN** | 60 | 4 | IXSCAN belowMin_1, name_1 | 6 | 3 |
| cashentries: latest list | **COLLSCAN** | 2,00,000 | 785.4 | IXSCAN isVoid_1_date_1__id_1, isVoid_1_account_1_date_1__id_1 | 26 | 4 |
| cashentries: one account | **COLLSCAN** | 2,00,000 | 546.8 | IXSCAN isVoid_1_account_1_date_1__id_1, isVoid_1_date_1__id_1 | 26 | 3.7 |
| auditlogs: history of one record | **COLLSCAN** | 10,00,000 | 2010 | IXSCAN refId_1_at_-1__id_-1 | 1 | 2 |
| auditlogs: latest list | **COLLSCAN** | 10,00,000 | 2442.2 | IXSCAN at_-1__id_-1 | 26 | 2.6 |
| auditlogs: one resource, latest | **COLLSCAN** | 10,00,000 | 2012.3 | IXSCAN model_1_at_-1__id_-1 | 26 | 2.6 |
| machineentries: one day | **COLLSCAN** | 8,933 | 21.9 | IXSCAN date_-1, date_1_shift_1_machineId_1 | 5 | 2.7 |
| machineentries: one machine, one month | **COLLSCAN** | 8,933 | 24.5 | IXSCAN machineId_1_date_-1, date_1_shift_1_machineId_1 | 9 | 2.9 |
| yield: output per block (aggregate, 400 blocks) | **COLLSCAN** | 8,933 | 17.9 | IXSCAN blockNo_1 | 48 | 7.3 |
| expenses: latest list | **COLLSCAN** | 40,000 | 130.9 | IXSCAN isVoid_1_date_1__id_1, isVoid_1_status_1_date_1__id_1 | 26 | 3.2 |
| expenses: pending approval | **COLLSCAN** | 40,000 | 100.9 | IXSCAN isVoid_1_status_1_date_1__id_1, isVoid_1_date_1__id_1 | 39 | 3.8 |
| expenses: supervisor “my expenses” | **COLLSCAN** | 40,000 | 88.8 | IXSCAN isVoid_1_createdById_1_date_1__id_1, isVoid_1_date_1__id_1 | 0 | 2.6 |
| purchases: payable this week | **COLLSCAN** | 3,000 | 30.6 | IXSCAN status_1_dueDate_1, isVoid_1_date_1__id_1 | 622 | 5.8 |
| tasks: overdue | **COLLSCAN** | 3,000 | 13.2 | IXSCAN state_1_dueDate_1 | 50 | 4.3 |
| tasks: my open tasks | **COLLSCAN** | 3,000 | 12.9 | IXSCAN assignedCode_1_state_1_dueDate_1, state_1_dueDate_1 | 2 | 2.5 |
| advances: employee’s open advances | **COLLSCAN** | 600 | 4.5 | IXSCAN empCode_1_status_1, status_1_createdAt_-1 | 7 | 3.5 |
| leaves: pending | **COLLSCAN** | 800 | 5 | IXSCAN status_1_createdAt_-1 | 19 | 2.3 |
| complaints: open | **COLLSCAN** | 1,500 | 3.7 | IXSCAN state_1_date_-1 | 49 | 2.9 |
| repairs: open | **COLLSCAN** | 1,500 | 4.7 | IXSCAN status_1_date_-1 | 15 | 2.5 |
| safety: check-ups due | **COLLSCAN** | 1,000 | 4.7 | IXSCAN kind_1_dueDate_1, kind_1_date_-1 | 50 | 3 |
| documents: expiring papers | **COLLSCAN** | 40 | 2.4 | IXSCAN expiryDate_1 | 4 | 2.3 |
| customers: who owes most | **COLLSCAN** | 800 | 4.8 | IXSCAN outstanding_-1 | 6 | 2.4 |
| daily summary: today (owner report) | IXSCAN _id_ | 1 | 1.4 | IXSCAN _id_ | 1 | 1.6 |
| daily summary: 7-day trend | IXSCAN _id_ | 7 | 2 | IXSCAN _id_ | 7 | 1.9 |
| performance: month of reports | IXSCAN _id_ | 80,546 | 524.2 | IXSCAN isVoid_1_date_1_empName_1__id_1, date_1_supCheck_1 | 517 | 16.5 |

**Collection scans after indexing: 0** of 44 hot queries.

## API latency (production build, local machine, perf dataset)

Cold = very first request after login for that endpoint; p50 / p95 over 25 warm requests. Single user, local MongoDB — real devices add network time.

| Role | Endpoint | Status | JSON size | On the wire | Cold ms | p50 ms | p95 ms |
|---|---|---:|---:|---:|---:|---:|---:|
| owner | home (owner report) | 200 | 11.3 KB | 2.2 KB | 144.9 | 7.9 | 16.1 |
| manager | home (manager) | 200 | 10.2 KB | 1.8 KB | 48.3 | 7.4 | 9.4 |
| accountant | home (accountant) | 200 | 5.1 KB | 1.4 KB | 224.4 | 6.7 | 12.8 |
| supervisor | home (supervisor) | 200 | 2.8 KB | 0.6 KB | 48.8 | 7.7 | 16.3 |
| salesperson | home (salesperson) | 200 | 1.0 KB | 0.3 KB | 45.6 | 7.9 | 12.5 |
| worker | home (worker) | 200 | 0.5 KB | 0.5 KB | 19.5 | 6.9 | 11 |
| owner | list employees | 200 | 6.9 KB | 0.8 KB | 8.1 | 9.5 | 11.9 |
| owner | list sales | 200 | 13.2 KB | 1.7 KB | 11.5 | 9.2 | 13.3 |
| owner | list sales (filtered) | 200 | 13.2 KB | 1.7 KB | 11.1 | 9 | 11.2 |
| owner | list stock movements | 200 | 4.8 KB | 0.6 KB | 7.2 | 7.5 | 9.3 |
| owner | list cash entries | 200 | 3.5 KB | 0.5 KB | 23.5 | 8.9 | 12.4 |
| owner | list expenses | 200 | 5.3 KB | 0.6 KB | 14.9 | 9.3 | 11 |
| owner | list audit log | 200 | 5.1 KB | 1.1 KB | 15.2 | 9.5 | 18.2 |
| owner | list daily reports (a day) | 200 | 6.4 KB | 0.6 KB | 17.8 | 8.9 | 14.7 |
| owner | list machine entries (a day) | 200 | 1.4 KB | 0.3 KB | 7.2 | 7.5 | 13.2 |
| owner | yield report | 200 | 116.8 KB | 8.2 KB | 11.4 | 10.4 | 14.1 |
| owner | performance scorecards | 200 | 24.7 KB | 1.8 KB | 29 | 7.2 | 8.9 |
| owner | reminders | 200 | 49.3 KB | 4.1 KB | 17.9 | 10.4 | 14.8 |
| owner | accounts balance | 200 | 0.0 KB | 0.0 KB | 10.4 | 11.4 | 14 |
| accountant | list payments | 200 | 5.6 KB | 0.7 KB | 37.7 | 35.2 | 44 |
| supervisor | team daily reports | 200 | 6.3 KB | 0.6 KB | 11.2 | 7.5 | 8.8 |
| supervisor | team attendance | 200 | 1.9 KB | 0.3 KB | 19.6 | 9.4 | 14.1 |
| salesperson | my sales | 200 | 13.2 KB | 1.7 KB | 13.3 | 8.8 | 12.9 |
| worker | my reports | 200 | 2.6 KB | 0.4 KB | 8.9 | 7.5 | 9.4 |
| owner | attendance sheet (50 people + exact counts) | 200 | 5.4 KB | 0.5 KB | 22.9 | 13.4 | 21.4 |
| supervisor | attendance sheet (team) | 200 | 1.4 KB | 0.3 KB | 12.9 | 10.3 | 14 |
| owner | lookup employees (typeahead) | 200 | 1.7 KB | 0.3 KB | 12.8 | 7.4 | 17.8 |
| owner | lookup customers (typeahead) | 200 | 1.4 KB | 0.2 KB | 15.6 | 8.2 | 11.4 |
| owner | lookup items (typeahead) | 200 | 0.0 KB | 0.0 KB | 11.2 | 6.1 | 9.6 |
| owner | sales overview | 200 | 0.2 KB | 0.2 KB | 27.7 | 16.1 | 22.8 |
| owner | sales: pending payments page | 200 | 13.3 KB | 1.7 KB | 20 | 14.3 | 18.8 |
| owner | sales facets | 200 | 0.1 KB | 0.1 KB | 41.7 | 30.9 | 38.3 |
| owner | cash overview | 200 | 0.1 KB | 0.1 KB | 8.4 | 9.6 | 14.4 |
| owner | expenses overview | 200 | 0.1 KB | 0.1 KB | 25.8 | 8.6 | 13.1 |
| owner | expenses monthly report | 200 | 1.0 KB | 1.0 KB | 10.1 | 10.7 | 13.9 |
| owner | machine month report | 200 | 0.6 KB | 0.6 KB | 12.9 | 9.2 | 11.5 |
| owner | stock facets (value + low count) | 200 | 0.1 KB | 0.1 KB | 8.3 | 10.5 | 15.6 |
| owner | dispatch freight totals | 200 | 1.9 KB | 0.3 KB | 66.4 | 36.5 | 40.4 |
| owner | daily reports: who is missing | 200 | 3.3 KB | 0.4 KB | 8.2 | 9.5 | 13.6 |
| owner | list employees (100 rows) | 200 | 27.5 KB | 1.9 KB | 10.3 | 9.2 | 13 |
| owner | list sales (100 rows) | 200 | 52.7 KB | 5.7 KB | 9.4 | 10.3 | 16.5 |
| owner | list audit log (100 rows) | 200 | 20.2 KB | 3.2 KB | 7.8 | 8.8 | 10.8 |


## Phase 5 — API optimisation: what changed on the wire

Measured against the same production-scale database (1 000 000 audit rows, 200 000 cash entries, 180 000 attendance rows, 20 000 sales…) with the production build, in headless Chrome at 390 px width (`scripts` in the session; numbers re-checkable with `npm run perf:bench -- http`). Local machine, single user: real phones add network time, which is exactly why the byte counts below matter.

### Requests per screen (cold load of the screen, owner)

| Screen | Requests now | What they are | Before (by code, not measured) |
|---|---:|---|---|
| Home (every role) | 1 | `/api/home` | 1 |
| Attendance | 1 | `/api/attendance/sheet` (page of people + marks + exact counts) | employees `limit=500` + attendance `limit=1000`, each following up to 15 cursor pages |
| Daily report | 2 | reports page + who is missing | reports + employees `limit=500` |
| Sales | 2 | `/api/sales/overview` + first page of orders | sales `limit=3000` (up to 15 pages, ~1.5 MB) + customers `limit=500` + stock |
| New quotation | 0 on load | typeahead lookups only when you type | customers `limit=500` + all finished stock |
| Stock | 2 | facets (value + low count) + page | all items, cursor-followed |
| Cash | 2 | `/api/cash/overview` + page | accounts + today's entries + closings + page |
| Expenses | 2 | `/api/expenses/overview` + page | heads + page (+ 5 000 rows for the monthly report) |
| Machines / Dispatch / Blocks / Complaints / Employees / Papers | 2 | facets (stat cards) + page | whole list downloaded and counted in the browser |
| Purchases · Tasks · Audit · Yield | 1 | page (or report) | 1–15 |

No screen makes more than two requests, and no screen loads more than one page (25 rows; 50 for the sheet) until the person presses **Load more**.

### Bytes

| Endpoint | JSON | On the wire (brotli) |
|---|---:|---:|
| Owner home | 11.3 KB | 2.2 KB |
| List, 100 sales | 52.7 KB | 5.7 KB |
| List, 100 audit rows | 20.2 KB | 3.2 KB |
| List, 100 employees | 27.5 KB | 1.9 KB |
| Attendance sheet, 50 people | 5.4 KB | 0.5 KB |
| Yield report (400 blocks) | 116.8 KB | 8.2 KB |
| Reminders | 49.3 KB | 4.1 KB |

Every list page is under the 100 KB budget and every home under 50 KB, before compression. The yield report is the one response over 100 KB (117 KB): it is a one-off report of every block, not a list, and is 8 KB on the wire — paging it is a Phase 6 item. Before this phase API responses were **not compressed at all** (the framework compresses pages only).

### CSV export of a large range

`GET /api/export/cashentries` — all **200 000 rows, 10.3 MB, 4.5 s**; the server's memory rose from 123 MB to a peak of 161 MB (rows are read in batches of 500 and streamed; memory does not grow with the range).

### Other behaviours checked

* Lookups answer in **6–10 ms** (median) with at most 20 `{id,label}` rows; the dropdown fetches only when opened or typed into (250 ms debounce).
* An unchanged list or master answers `304` with no body (ETag); responses are `private` and per user.
* The home aggregate is cached 30 s per person (key = person + effective rights + permission-set version) and dropped the moment anything is committed; a different person never reuses it (test).
* Rate limit: the benchmark fires ~1 000 requests per user per run, so the benchmark server is started with `API_RATE_USER=1000000`; the normal limits (300/min per user, 1 500/min per IP) are covered by a test.
* One thing the benchmark showed that is **not** a code change: on a database seeded without running `npm run db:indexes`, the same endpoints were 20–90× slower (audit log list 692 ms instead of 9 ms). Production runs with automatic index building off, so `npm run db:indexes` is part of every deploy (`docs/DEPLOY.md`, Phase 8).
