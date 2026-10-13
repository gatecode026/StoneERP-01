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
