# Authoring the Meridian knowledge model

This is the contract for anyone adding content to `src/model/data/`. The three
modes of the explorer render the same model, so accuracy and consistency here
matter more than anywhere else in the project.

- Types: [`src/model/types.ts`](../src/model/types.ts) — read it first, top to bottom.
- Skeleton (system, apps, subsystems, features, audiences): [`src/model/data/core.ts`](../src/model/data/core.ts).
- Example data shared by all scenarios: [`src/model/data/fixtures.ts`](../src/model/data/fixtures.ts).
- Checker: `npx tsx scripts/verify-model.ts --slice <name>`.

## Ground rules

1. **Nothing is invented.** Every entity, relation, contract field, error code,
   flow step and scenario step must come from reading the Meridian source at the
   pinned commit (`53bb9ab`). If you did not read it in the code, do not write it.
2. **Cite it.** Give `sources` with `file`, a tight `start`/`end` line range and a
   `symbol` — a short literal string that appears inside that range (usually the
   function/type name, e.g. `'export async function createTransfer'` or just
   `'createTransfer'`). The checker fails if the symbol is not inside the range.
   Prefer the range of the definition itself (signature + doc comment), ≤ 60 lines.
3. **Label confidence honestly.** Omit `confidence` for facts read directly from
   code (`verified`). Use `simplified` when you deliberately gloss over detail,
   `inferred` when you are connecting dots no single line states. Never use
   `hypothetical` in baseline slices.
4. **Plain, precise prose.** Summaries are one sentence a non-expert could follow.
   Descriptions and narratives say what the code does and why, in present tense,
   without marketing words. Reuse the repository's own vocabulary (ledger entry,
   pending, posted, operator, simulated).
5. **Safe sample data.** Examples use the seeded demo personas from `fixtures.ts`
   (Avery Customer, Sam Operator…), `example.com` emails, and money in integer
   minor units. Never real-looking card numbers, never credentials.
6. **Only edit files you own** (your slice file and your scenario files).

## Entity ids

Ids are deterministic so slices can reference each other without coordination.

| Thing | Id | Example |
| --- | --- | --- |
| Backend source file | `be:<path under apps/backend/src, no extension>` | `be:money/movements` |
| Backend route plugin | `be:routes/<name>` (kind `route-group`, parent `be.http`) | `be:routes/money` |
| Shared library file | `sh:<file name, no extension>` (parent `shared`) | `sh:ledger` |
| Customer app file | `cu:<path under apps/customer/src, no extension>` | `cu:pages/MoveMoney`, `cu:lib/money` |
| Operations app file | `op:<path under apps/operations/src, no extension>` | `op:pages/RequestQueues` |
| Symbol inside a file | `<file id>#<exported name>` | `be:money/movements#createTransfer`, `sh:ledger#deriveBalances` |
| HTTP endpoint | `ep:<METHOD> <path exactly as registered>` (parent = its route group) | `ep:POST /api/transfers`, `ep:GET /api/accounts/:id` |
| Prisma model | `db:<ModelName>` (parent `db`) — **already defined in the `database` slice; reference, do not redefine** | `db:LedgerEntry` |
| Socket.IO event | `ev:<event name>` (parent `be.realtime`) | `ev:ops:request_changed` |
| Test file | `test:<repo-relative path>` (parent `tests`) | `test:apps/backend/src/routes/money.test.ts` |
| Infra item | `infra:<slug>` (parent `infra`) | `infra:ci` |
| Feature | `feat:<slug>` — **defined in `core.ts`; reference only** | `feat:transfers` |
| Role | `role:<role>` — defined in `core.ts` | `role:ops_agent` |

Parents: a file-level module's `parent` is one of the subsystem ids in `core.ts`
(`be.money`, `be.auth`, `cu.portal`, `op.console`, …). Symbols' `parent` is their
file's id. Shared-library modules sit directly under `shared`.

Relation ids: `rel:<from>-><to>:<kind>` (append `:<n>` if needed for uniqueness).
State machine ids: `sm:<slug>`. Scenario ids: short kebab-case (`transfer`).

You may reference an id that another slice owns (using the convention above)
without it existing yet; the checker will list it as unresolved until that slice
lands. Before you finish, every reference **into your own namespace** must resolve.

## What to model, and how deep

For each source file in your slice:

- One **module** entity (kind `module`, `route-group`, `page`, `component` as fits)
  with a summary, a description of its role, `tech`/`tags`, and a whole-file or
  header-comment source.
- An entity for each **symbol a presenter would point at**: exported functions,
  classes, important types/DTOs, enum-like constants, error classes. Skip trivial
  private helpers. For functions give `signature` (as written). For types and
  constants give `fields` / `values` (with meanings) and a small `example`.
- `detail`: leave unset to use the default for the kind (subsystem 2, module /
  route-group / page / db-model 3, endpoint / event 3, function / class / type /
  constant 4, test 5). Raise or lower only with reason (e.g. `sh:ledger#deriveBalances`
  is important enough for `detail: 3`).
- `tags`: lower-case topical tags used for search and audience emphasis. Use
  these where they apply: `money`, `ledger`, `data`, `security`, `auth`, `rbac`,
  `validation`, `realtime`, `ui`, `operations`, `risk`, `cards`, `time`,
  `lending`, `onboarding`, `integration`, `public-demo`, `audit`.
- `aliases`: words someone might type to find it.

**Relations** — add them at the most specific level you verified (function →
function, function → `db:Model`, handler → validator). The explorer aggregates
them upwards automatically, so do not also add module → module copies.

- `calls`: caller → callee, `label` = the call as written (`createTransfer(user, input, now)`).
- `reads` / `writes`: code → `db:Model`, `label` says what (`insert 2 posted rows`, `findUnique by id`).
- `uses-type`, `validates`, `guards`, `emits`, `subscribes`, `imports`, `renders`, `navigates`, `tests`, `implements` (→ `feat:*`).
- `http`: **client function or page → `ep:*`** (frontend slices own these).
- Give `order` when one caller does several things in sequence.
- Include `tests` relations from the most relevant test file(s) to what they pin down.
- Add `implements` relations from the key entities of your slice to the matching `feat:*`.

**Contracts** — every endpoint in your route files gets an `endpoint` entity and
a `Contract` with the same id. Fill in, from the handler and the shared validator:

- `auth` (required? roles? CSRF? rate-limit bucket? which cookie surface),
- `pathParams` / `query` / `body` with `type`, `required`, and the real validation `rules`,
- `requestExample` and a `responses[].example` with realistic values,
- `errors` — every status/code the handler or the services it calls can produce, with `when`,
- `flow` — the ordered server-side steps (global hooks → guards → validation →
  service calls → DB reads/writes → emits → respond), each with `target` (entity
  id), `label`, `detail`, `rejects` and a `source`. Global hooks for every request
  are `be:auth/csrf#csrfHook` then `be:abuse/rate-limit#mutationValveHook`; include
  them (briefly) on mutating endpoints.
- `sideEffects`, `mutates`, `integrationNotes` (what an integrator must send and what follows).

**State machines** — where a status field has a real lifecycle (ledger entry
status, operations request status, card status, schedule status, onboarding
application status, lending product status, fraud alert / dispute state, session),
add a `StateMachine` with each transition's `by` (function entity id) and `source`.

**Glossary** — add terms from your domain a newcomer would trip over.

## Scenarios

A scenario is an ordered list of steps over a set of participants (the lanes of
a sequence diagram). Put each one in `src/model/data/scenarios/<id>.ts` and export
`scenario`. `scripts/gen-scenario-index.ts` (run by `npm run model:verify`)
regenerates `scenarios/index.ts` from the files in that directory — do not
register scenarios by hand.

- `participants`: 4–9 entity ids ordered left→right in causal order (actor role →
  page → client lib → endpoint/route group → guards → service → shared function →
  `db:Model`s → events → the other app). Use the most specific useful entity — a
  function, not its subsystem — but keep the lane count readable. Every step's
  `from`/`to` must be a participant.
- Steps: 12–30 for a deep scenario. One thing happens per step. Use `kind`
  accurately. `label` is the short arrow text; `title` names the step; `narrative`
  explains it technically; add `audience.executive` / `audience['end-user']` /
  `audience.dba` rewordings on the steps that matter to those audiences.
- `detail` per step: `1` for the 4–6 steps that tell the business story
  (an executive sees only these), `2` for the user-visible flow, `3` for the
  system flow (requests, guards, services), `4`–`5` for code-level steps
  (individual checks, individual row writes). A developer sees everything.
- `payload`: the actual data on the wire / passed to the call / written to the
  row, with `format`, `line` (e.g. `POST /api/transfers`, `201 Created`),
  `typeRef` and `highlight`. Make values consistent from step to step.
- `effects`: the database rows inserted/updated by the step, against
  `initialState` (start from `baseState()` in `fixtures.ts`; every table you
  touch must exist in `initialState`). The explorer replays these to show
  before/after tables and re-derives balances from `LedgerEntry` rows, so make
  them exactly what the code writes (same field names as the Prisma model).
- `variants`: the real alternative outcomes (validation failure, insufficient
  funds, forbidden, reject vs approve…). Steps shared by all variants omit
  `variants`; divergent steps list the variant ids they belong to. Put a
  `decision` step at each fork whose `options` map answers to variants. Each
  variant must read as a complete, sensible story on its own.
- `sources` on every step that corresponds to code.
- `related`: entity ids for which this scenario is "the relevant workflow"
  (the endpoint, the service function, the page, the feature, the db models).
- `watchAccounts`: account ids whose derived balances should be displayed.

## Checking your work

```bash
npm run model:verify                                         # integrity + every source reference; must report 0 errors
npx tsx scripts/verify-model.ts --slice <slice name>         # only one slice's issues
npm run model:snippets                                       # re-extract the bundled excerpts after changing sources
npm run typecheck && npm test                                # the unit tests replay every scenario's database effects
```

The verifier and the snippet extractor need a clone of Meridian at the pinned
commit (`../pcowhill/claude-banking-project`, `../claude-banking-project` or
`$MERIDIAN_DIR`).

Unresolved references to ids owned by *other* slices are expected while those
slices are in progress; list them in your hand-off so they can be reconciled.
