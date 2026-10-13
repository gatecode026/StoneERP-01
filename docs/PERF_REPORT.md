# Performance report

Generated 2026-10-13 from `scripts/perf-seed.ts` data (separate database, never production).

## Dataset

| Collection | Documents |
|---|---:|
| attendances | 1,81,873 |
| stockitems | 60 |
| employees | 100 |
| suppliers | 60 |
| sessions | 0 |
| blocks | 4,000 |
| paperdocs | 40 |
| purchases | 3,000 |
| dailysummaries | 1,826 |
| repairs | 1,500 |
| dispatches | 24,000 |
| dailyreports | 80,546 |
| counters | 4 |
| safetyrecords | 1,000 |
| ratelimits | 0 |
| stockmovements | 50,000 |
| cashentries | 2,00,000 |
| complaints | 1,500 |
| royalties | 60 |
| customers | 800 |
| perfremarks | 0 |
| tasks | 3,000 |
| machines | 12 |
| vehicletrips | 12,000 |
| leaves | 800 |
| otps | 0 |
| users | 6 |
| settings | 1 |
| sales | 20,000 |
| expenses | 40,000 |
| advances | 600 |
| payments | 20,000 |
| auditlogs | 10,00,000 |
| vehicles | 0 |
| accounts | 2 |
| salarysheets | 0 |
| machineentries | 8,933 |

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

| Role | Endpoint | Status | Size | Cold ms | p50 ms | p95 ms |
|---|---|---:|---:|---:|---:|---:|
| owner | home (owner report) | 200 | 10.6 KB | 167.7 | 84.4 | 147.3 |
| manager | home (manager) | 200 | 9.8 KB | 50.8 | 63.1 | 74.8 |
| accountant | home (accountant) | 200 | 4.9 KB | 111.1 | 208.7 | 368.9 |
| supervisor | home (supervisor) | 200 | 3.1 KB | 17.7 | 30.5 | 34.9 |
| salesperson | home (salesperson) | 200 | 1.0 KB | 24.1 | 27.9 | 34.7 |
| worker | home (worker) | 200 | 0.4 KB | 26.3 | 15.8 | 26.3 |
| owner | list employees | 200 | 7.7 KB | 17.5 | 15.3 | 29.2 |
| owner | list sales | 200 | 13.2 KB | 22.2 | 15.9 | 25.6 |
| owner | list sales (filtered) | 200 | 13.2 KB | 13.4 | 16 | 31.4 |
| owner | list stock movements | 200 | 4.8 KB | 15.1 | 15.7 | 21.3 |
| owner | list cash entries | 200 | 3.5 KB | 15.5 | 15.9 | 27.2 |
| owner | list expenses | 200 | 5.3 KB | 16 | 18.4 | 30.8 |
| owner | list audit log | 200 | 5.4 KB | 21.2 | 16.2 | 31.2 |
| owner | list daily reports (a day) | 200 | 0.0 KB | 28.8 | 15.8 | 20.4 |
| owner | list machine entries (a day) | 200 | 0.0 KB | 17.1 | 15.6 | 23.3 |
| owner | yield report | 200 | 129.3 KB | 12.4 | 15.7 | 26 |
| owner | performance scorecards | 200 | 24.6 KB | 16.7 | 15.6 | 23.2 |
| owner | reminders | 200 | 49.3 KB | 27.7 | 31.2 | 41.6 |
| owner | accounts balance | 200 | 0.0 KB | 16.3 | 15.8 | 20.1 |
| accountant | list payments | 200 | 5.6 KB | 61.9 | 52.5 | 86.6 |
| supervisor | team daily reports | 200 | 6.3 KB | 18.5 | 17.2 | 25 |
| supervisor | team attendance | 200 | 0.0 KB | 12.6 | 15.5 | 27.2 |
| salesperson | my sales | 200 | 13.2 KB | 15.8 | 17.1 | 32.6 |
| worker | my reports | 200 | 2.6 KB | 15.6 | 16.6 | 26.9 |
