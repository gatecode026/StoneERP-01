# Architecture and how to grow it

## Layers

```
proxy.ts                     redirects visitors without a session cookie (real checks are server-side)
app/(app)/**                 screens (client components over one or two API calls each)
app/api/**                   thin routes: parse → permission → service → respond
lib/api/                     route() / withAuth() wrappers, generic resource engine, query parsing, errors, rate limits, ETag, idempotency
lib/perm/                    permission engine: resource × action × scope × field group
lib/services/                business rules that touch several records (run inside Mongo transactions)
lib/rollup/                  DailySummary, running account balances, outstanding amounts
lib/models/                  strict Mongoose schemas + indexes
lib/jobs/ lib/notify/        scheduled jobs and message delivery
lib/storage/ lib/export/     object storage, CSV / XLSX / Tally
```

Rules that hold everywhere: nothing is deleted (cancel = void with a reversing entry); every change writes an audit row in the same transaction; money and stock change only through services; the server decides what a person may see (the screens only hide buttons).

## Adding a new record type (the usual way to grow)

1. **Model** – define it in `lib/models/<area>.ts` with `defineModel(name, fields, { indexes })`, register it in `MODELS` (`lib/models/index.ts`). Give every list sort/filter a `{isVoid, filter…, sortField, _id}` index and run `npm run db:indexes`.
2. **Resource** – describe it as a `ResourceDef` in `lib/resources/<area>.ts` (key, model, Zod schemas for create / update, list fields, sort, search and filters, server-only fields, lifecycle hooks) and list it in `lib/resources/index.ts`. The generic `/api/<resource>` and `/api/<resource>/<id>` endpoints then give list, create, edit, void, export and audit for free.
3. **Permissions** – add the resource to `lib/perm/resources.ts` and its defaults for each job in `lib/perm/defaults.ts`. The Owner can change them later under Roles.
4. **Screen** – add a page under `app/(app)/<name>/` (copy a similar one: `CrudPage` for plain lists), add it to `lib/nav.js`, and add Hindi phrases to `lib/hi/`.
5. **Rules across records** (stock, cash, balances) – write a service in `lib/services/`, run it in `withTxn` (`lib/db.ts`), write the audit row inside it, and make its void undo it.
6. **Tests** – a case in `tests/permissions/matrix.test.ts` (who may do what) and an integration test for the rule. `npm run docs:routes` refreshes `docs/ROUTES_AND_MODELS.json`.

## Adding a scheduled job or a message

Add an entry to `JOBS` in `lib/jobs/index.ts` (its `period` decides "once per day / hour / month"), add a cron line to `vercel.json`, and queue text through `lib/notify` so delivery, retry and the manual wa.me fallback come for free.

## Adding an integration

Keep it behind an adapter with a safe fallback when its environment variables are not set (see WhatsApp in `lib/notify/whatsapp.ts`, storage in `lib/storage/index.ts`). Document the variables in `.env.example` and `docs/ENVIRONMENT.md`. Never make an outside account required to run the app or the tests.

## Tests

| Folder | What | How it runs |
|---|---|---|
| `tests/unit` | pure functions, safety, Hindi coverage | Vitest |
| `tests/integration` | routes and services against an in-memory MongoDB replica set | Vitest |
| `tests/permissions` | the role × resource × action matrix | Vitest |
| `tests/e2e` | the real app in a browser at 360 px: sign-in, roles, every screen fits a phone, language toggle, a working path | Playwright (`npm run test:e2e`) |

CI (`.github/workflows/ci.yml`): lint, typecheck, tests, `npm audit`, build, bundle budget, then the browser tests.
