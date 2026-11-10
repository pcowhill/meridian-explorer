# Source coverage

What Meridian Explorer models, how it was derived, how far to trust it, and
what is missing.

## Reference revision

| | |
| --- | --- |
| Repository | [`pcowhill/claude-banking-project`](https://github.com/pcowhill/claude-banking-project) (Meridian, v1.0.0) |
| Commit | [`53bb9ab38559c7f1e4ed7b9532145d28bf62959c`](https://github.com/pcowhill/claude-banking-project/tree/53bb9ab38559c7f1e4ed7b9532145d28bf62959c) (2026-10-01) |
| Recorded in | `src/model/data/core.ts` (`REPO`) |

Every source link and code excerpt in the explorer points at that commit. The
model is static: it does not follow later changes to Meridian. To move it to a
newer revision, update `REPO.sha`, fix whatever `npm run model:verify` reports
and re-run `npm run model:snippets`.

## How the content was produced and checked

1. The Meridian source was read file by file — documentation, Prisma schema,
   backend routes and services, the shared library, both frontends, tests and
   deployment scripts — and described in the typed model under
   `src/model/data/`.
2. The database slice is **generated** from `schema.prisma`
   (`scripts/gen-database.ts`): table and column names, types, defaults,
   indexes, foreign keys and line numbers are taken mechanically; descriptions
   are the schema's own comments.
3. Every other statement cites `file` + line range + a short `symbol` string
   that must appear inside that range. `npm run model:verify` checks all of them
   against a clone of the repository at the pinned commit (currently
   **0 errors, 0 warnings**), together with referential integrity of every id.
4. The cited ranges are copied into `src/model/generated/snippets.json`
   (3,704 excerpts) so the deployed app shows real code without network access.
5. Scenario database effects are replayed by unit tests: each update must hit a
   row that exists at that point, and balances shown next to example rows are
   recomputed with a port of Meridian's `deriveBalances`, never typed in.

## What is modelled

| | Count |
| --- | ---: |
| Entities | 975 |
| Relationships | 2,023 |
| API contracts (every registered HTTP endpoint) | 51 |
| Scenarios (64 outcomes, 733 steps) | 15 |
| State machines | 14 |
| Glossary terms | 83 |
| Source references | 3,460 |
| Meridian files cited | 245 |

**Files cited, by area** (cited / files of that type in the repository):
backend 75 / 81 · customer app 53 / 58 · operations app 36 / 38 · shared
library 32 / 33 · deployment scripts 24 / 25 · CI workflows 2 / 2 · Playwright
specs 11 / 11. The few uncited files are tool configuration, type shims and
app entry points.

**Entities by location:** backend 318 · shared library 324 · customer app 112 ·
operations app 91 · test suites 56 · delivery & hosting 26 · database 17 ·
features 25 · people and boundaries 6.

**Entities by kind:** 316 functions · 173 types · 109 constants · 86 modules ·
55 tests · 51 endpoints · 26 components · 25 features · 24 pages · 24
subsystems · 20 infrastructure items · 16 tables · 16 classes · 13 route
groups · 7 external · 4 Socket.IO events · 4 roles · 3 applications.

**Relationships by kind:** 568 calls · 393 uses-type · 263 tests · 176
implements · 109 writes · 100 renders · 85 reads · 82 guards · 56 HTTP · 43
navigates · 41 validates · 29 actor-uses · 20 emits · 19 foreign keys, and a
handful each of websocket, subscribes, handles, triggers, deploys, proxies,
imports.

### Depth by area

| Area | Depth |
| --- | --- |
| Money movement & ledger (`money/movements.ts`, shared `ledger.ts`, `money.ts`, `money-movement.ts`, `transactions.ts`, `statements.ts`) | Every exported function, type and constant; important private helpers; validation rules field by field |
| HTTP API (13 route plugins) | Every endpoint with a full contract: auth, inputs + rules, examples, every error, ordered server flow, side effects, integration notes |
| Authentication & access (`auth/*`), abuse protection, real-time | Every exported symbol; session and lockout lifecycles; cookie audiences; CSRF; the Socket.IO room rules |
| Operations workflow, onboarding, invitations | Every exported symbol; request, application and invitation lifecycles |
| Cards, fraud, disputes | Every exported symbol; card, travel-notice, fraud-alert and dispute lifecycles |
| Simulation clock, scheduler, lending, accrual | Every exported symbol; schedule and lending-product lifecycles; the interest formulas |
| Database | All 16 Prisma models, every column, every foreign key; which code reads and writes each table |
| Customer app | Every page with its route and key handlers; every API client function and the exact endpoint it calls; shared components |
| Operations app | Every page; every API client function; the socket hook and live data context; console components |
| Delivery & hosting | CI jobs, the release build/deploy scripts, and — only as far as Meridian's own docs state — the reverse proxy and host that live in another repository |
| Seed & baseline | The seed plan's structure and invariants, the seed writer, the baseline builder |
| Tests | 55 test files as entities, linked to what they pin down |

## Deeply implemented workflows

| Scenario | Question | Outcomes |
| --- | --- | --- |
| `transfer` | What happens when a customer transfers money? | success · invalid-input · insufficient-funds · forbidden-account · not-signed-in · csrf-missing |
| `ops-approval` | How does an operations employee approve a pending transaction? | approve · reject · hold · request-info · not-allowed · forbidden-role |
| `account-balances` | How are account balances calculated? | walkthrough · pending-then-posted |
| `clock-advance` | What happens when the simulation clock advances? | fires-schedules-and-interest · nothing-due · insufficient-funds-skip · backwards-rejected · forbidden-role |
| `fraud-alert` | How does a fraud alert affect a customer's card? | confirmed-fraud · customer-confirms-legit · operator-dismisses · card-already-frozen · responds-too-late |
| `app-communication` | How do the customer app, operations simulator and backend communicate? | operations-console · customer-app |
| `transaction-validation` | How does transaction validation work? | passes-all + one variant per rejecting layer (8) |
| `external-movement` | What happens when a customer submits a deposit, ACH, wire or bill payment? | outbound-bill-pay · inbound-deposit · insufficient-funds · limit-reached |
| `login` | What happens when someone signs in? | success · wrong-password · locked-out · unknown-email · disabled-account · rate-limited |
| `account-opening` | How does a new customer get an account? | approved · with-joint-invite · rejected · invalid-application |
| `dispute` | What happens when a customer disputes a charge? | upheld · denied · not-disputable |
| `card-lost` | What happens when a customer reports a card lost or stolen? | lost · not-allowed · freeze-unfreeze |
| `scheduled-payment` | How does a customer set up a recurring payment? | monthly-bill-pay · one-time-transfer · cancelled · invalid |
| `loan-and-interest` | How do loans, CDs and interest work? | loan · cd · cd-insufficient-funds |
| `movement-reversal` | How does an operator undo a payment that has already gone through? | reversed · nothing-to-reverse |

The eighth representative question — *How could a new external payment service
integrate with Meridian?* — is answered by `external-movement` (the real seam)
plus the shipped hypothetical layer **SimPay** (`src/state/layers/simpay.ts`),
which adds a proposed partner endpoint, guard, tables, webhook, four proposed
changes to existing code and a proposed flow, all marked hypothetical.

In addition, a trace can be assembled automatically for **any** of the 51
endpoints from its contract (`assembleTrace`); those are marked *simplified*.

## Confidence

| Label | Entities | Relationships | Scenario steps |
| --- | ---: | ---: | ---: |
| Verified — read directly from the code | 949 | 2,010 | 706 |
| Simplified — deliberate simplification | 26 | 9 | 16 |
| Inferred — connects dots no single line states | 0 | 4 | 11 |
| Hypothetical — not in Meridian | 0 in the baseline | 0 | 0 |

Simplified items are mostly the curated groupings (subsystems, features, the
"external world" boundary) and scenario setup steps. Inferred items are marked
individually; for example, no endpoint ever sets `User.status = 'disabled'`
(only tests do), so the setup step of that login variant is *inferred*.
The Impact tab labels direct dependents *verified* and anything transitive
*inferred*.

## Where the code differs from its own documentation

Reading the implementation turned up places where comments or docs lag the
code. The model follows the code. Notable ones:

- **The customer app opens no Socket.IO connection.** `socket.io-client` is a
  dependency and a WebSocket URL is exported, but nothing imports them; only
  the operations console connects. (`TECHNICAL_ARCHITECTURE.md` draws both.)
- **The customer app sends no `x-meridian-surface` header**; the backend falls
  back to the request Origin. `PUBLIC_DEMO_DEPLOYMENT.md` says both apps send it.
- **Operator actions do touch the ledger.** File headers in `ops/requests.ts`,
  shared `operations.ts` and the schema comment on `OperationsRequest` still
  say acting on a request never posts to the ledger; since v0.7.0 approve and
  reject post or fail the linked entries.
- **Backwards clock advances return `invalid_request`**, never
  `invalid_advance` — the route's own check rejects first.
- **"+1 month" (30 days) accrues no interest from the seed date**; the first
  monthly anniversary is a day later.
- **`AuditLog.createdAt` and several `updatedAt` columns use the wall clock**
  while money events use the simulated clock.
- **Disputes check status and origin but not direction**, so a posted credit
  can be disputed; a denied dispute can be raised again.
- **Dispute and reversal audit rows are recorded against the ledger entry**, so
  they do not appear in the request's History panel.
- **No backend code writes the `replaced` card status.**
- **`settledTotalMinor` is used only by tests**; the seed's conservation check
  is a separate function.
- **The session cookie is set once at login with an 8-hour max-age**; the
  server-side expiry slides but the cookie is not re-issued.
- **Login does not check role against surface**; a customer who signs in on the
  operations console gets a valid session and is signed out client-side.

These appear in the relevant entity descriptions and scenario steps.

## Known gaps

- **Private helpers and UI internals** are modelled selectively. Every module
  links to GitHub for the rest.
- **Marketing pages, styling, Tailwind configuration and image assets** are
  summarised, not detailed.
- **The infrastructure repository** (`pcowhill/cowhill-infrastructure`: Caddy,
  systemd units, the reset helper, DNS) is not modelled; the reverse proxy and
  host appear as external entities described only as far as Meridian's docs go.
- **Example data** in scenarios is illustrative, modelled on the seeded demo
  personas (`fixtures.ts`), not a dump of the seed. Rows added to exercise a
  rule (a reversed charge, a failed ACH) are labelled as examples.
- **Process documentation** (`docs/process/*`: milestone reports, feedback,
  task board) is not modelled.
- **Relations are curated, not exhaustive static analysis.** Every relation in
  the model was read in the code, but not every call in the code is a relation
  in the model — impact analysis therefore shows *known* dependents, and may
  miss some.
- **No live coupling.** The explorer links to the public demo and can send a
  user-initiated, credential-free GET to `/health`, `/status` or `/api/meta`;
  it never signs in or changes state there.
