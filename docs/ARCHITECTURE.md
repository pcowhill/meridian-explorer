# Architecture

Meridian Explorer is a static React + TypeScript + Vite single-page app. It has
no backend and no AI: everything it shows comes from a curated, typed model of
the Meridian repository that is bundled with the app.

```
src/
  model/        the shared Meridian knowledge model (pure TypeScript, no React)
    types.ts      schema: Entity, Relation, Contract, Scenario, StateMachine, HypotheticalLayer…
    data/         the content, one slice per domain + generated scenario index
    model.ts      Model class: hierarchy, relations, aggregation, impact, paths
    scenario.ts   step visibility, database-state replay, balance derivation, trace assembly
    search.ts     MiniSearch index over entities, scenarios, glossary, state machines
    generated/    source excerpts extracted from the pinned Meridian commit
  state/        zustand stores: session (app.ts), workspace (workspace.ts), URL sync, import/export
  ui/           design-system primitives and the kind/channel visual vocabulary
  viewers/      technical viewers shared by all modes (JSON, code, contract, tables, state machine…)
  shell/        top bar, shared inspector, command palette, help panels, hotkey registry
  atlas/        Mode 1 — Architecture Atlas
  theater/      Mode 2 — Scenario Theater
  studio/       Mode 3 — Explanation Studio
scripts/        model verification, snippet extraction, database-slice generation
e2e/            Playwright end-to-end tests
```

The three modes are separate, lazily-loaded modules. They share everything
below the mode layer and nothing with each other.

## 1. The shared knowledge model

All three modes render the same model (`import { … } from '@/model'`).

- **Entity** — anything nameable: system, app, subsystem, module, route group,
  endpoint, function, type, table, event, page, feature, role… Entities form a
  containment tree through `parent` (root: `meridian`); features are parentless
  and attach through `implements` relations.
- **Relation** — a typed, directed link (`http`, `websocket`, `calls`, `reads`,
  `writes`, `uses-type`, `validates`, `guards`, `emits`, `subscribes`,
  `references`, `tests`, `implements`, …). Each kind maps to one of eight
  **channels** (`channelOf(kind)`), which is what the UI filters and colours by.
  Relations are recorded at the most specific level verified in the code
  (function → function, function → table).
- **Contract** — the full API contract of an endpoint entity (same id): auth,
  inputs with validation rules, examples, responses, errors, and `flow`, the
  ordered server-side steps.
- **Scenario** — an ordered list of steps over participants, with variants
  (alternative outcomes), payloads and database effects.
- **StateMachine**, **GlossaryTerm**, **GuidedQuestion**, **AudiencePreset**.

### Entity ids

Ids are deterministic (`be:money/movements#createTransfer`,
`ep:POST /api/transfers`, `db:LedgerEntry`, `cu:pages/MoveMoney`,
`ev:ops:request_changed`, `feat:transfers`). The convention is in
[MODEL_AUTHORING.md](MODEL_AUTHORING.md).

### Provenance

Every entity, relation, contract, flow step and scenario step can carry
`sources: SourceRef[]` (`file`, `start`, `end`, `symbol`) and a `confidence`:

| Confidence | Meaning |
| --- | --- |
| `verified` (default) | Read directly from the repository at the pinned commit |
| `simplified` | A deliberate simplification of verified behaviour |
| `inferred` | A reasonable reading no single line states outright |
| `hypothetical` | Not in Meridian — proposed or user-created |

`REPO` (in `data/core.ts`) records the pinned commit. `githubUrl(ref)` builds a
permalink at that commit. `scripts/verify-model.ts` checks referential
integrity and — against a clone of Meridian — that every cited line range
exists and contains its `symbol` string. `scripts/extract-snippets.ts` copies
the cited ranges into `src/model/generated/snippets.json`, loaded lazily the
first time code is shown.

### The `Model` API (model.ts)

`useModel()` (from `@/state/hooks`) returns the model with the active
hypothetical layers applied. Key methods:

| Need | Call |
| --- | --- |
| Look up | `entity(id)`, `relation(id)`, `contract(id)`, `scenario(id)`, `stateMachine(id)`, `has(id)` |
| Hierarchy | `children(id)`, `childIds(id)`, `hasChildren(id)`, `parentOf(id)`, `ancestors(id)`, `ancestorIds(id)`, `path(id)`, `descendants(id)`, `isWithin(id, ancestor)`, `appOf(id)` |
| Detail | `detailOf(entity)` → 1…5 (the lowest detail level at which it shows by default) |
| Relations | `outgoing(id)`, `incoming(id)`, `relationsOf(id)`, `relationsAcross(id)`, `relationsWithin(id)`, `relationsBetween(a, b)`, `neighbors(id)` |
| Aggregation | `liftRelations(visibleIds, channels?)` → `LiftedEdge[]`: every relation lifted to the nearest visible ancestor of each end and grouped per pair + channel, with the curated `headline` relation if one exists exactly between the pair |
| Behaviour | `scenariosFor(id)`, `contractsWithin(id)`, `contractsUsing(id)`, `stateMachinesFor(id)` |
| Features | `features()`, `featuresOf(id)`, `implementersOf(featureId)` |
| Analysis | `impactOf(id, depth)` (reverse dependencies, direct = verified, transitive = inferred), `pathBetween(a, b)` (shortest relation chain) |
| Audience | `summaryFor(entity, audience)` |
| Hypothetical | `isHypothetical(id)`, `isProposedRemoval(id)`, `modificationsFor(id)` |

### Scenario engine (scenario.ts)

Pure functions: `variantSteps`, `visibleSteps(scenario, variant, detail)`,
`activeParticipants`, `stateBefore` / `stateAfter` (replay `effects` over
`initialState`), `diffStates`, `deriveBalances` / `contributionOf` /
`accountBalances` (a line-for-line port of Meridian's balance rules, so
balances shown next to example rows are recomputed, not typed),
`assembleTrace(model, endpointId)` (builds an editable starting scenario from a
contract's flow) and `reusableSteps(model)`.

Hidden steps still apply their database effects: lowering the detail level
changes what the audience sees, never what happened.

## 2. Hypothetical layers

A `HypotheticalLayer` holds proposed entities, relations, contracts, scenarios
and `modifications` to baseline things (`add-field`, `change`, `remove`).
Layers live in the workspace store, never in `src/model/data`. `getModel(layers)`
builds a model with the active layers overlaid; everything from a layer is
forced to `confidence: 'hypothetical'` and is drawn dashed and purple in every
mode (`.hypothetical` CSS class, `--k-hypo` colour, `ConfidenceBadge`).
Layers can be switched off, exported, duplicated or discarded; the baseline is
immutable. A shipped example layer (`state/layers/simpay.ts`) models a
PayPal-like external payment service.

Creation paths shared by all modes: `HypotheticalComponentDialog` (new
component + optional connection) and the inspector's **What if…** menu
(`ProposeChange`: connect a new component, add a field, note a change, propose
removal).

## 3. State

Two zustand stores.

**`useApp` (state/app.ts)** — session state: `mode`, `audience`, `detail`
(1–5), `theme`, `presenting`, `selection`, inspector state, plus the view
state of the Atlas (`expanded`, `focus`, `channels`, `isolate`, `lens`) and
Theater (`scenarioId`, `variant`, `stepIndex`, `view`, `speed`) so that any
mode can drive another. Cross-mode actions: `openInAtlas(entityId)`,
`openInTheater(scenarioId, variant?, step?)` (a scenario id of the form
`trace:<endpoint id>` asks the Theater to assemble a trace),
`sendToStudio(request)` (queued in `studioInbox`; the Studio consumes it with
`consumeStudioInbox()`). `back()` / `forward()` walk a navigation history that
spans modes. `captureView()` / `applyView()` save and restore a view.

`selection` is a tagged union — entity, relation, aggregated edge, scenario
step, state machine, glossary term — and is shared: selecting something in one
mode and switching mode keeps it selected, and the shared inspector follows.

**`useWorkspace` (state/workspace.ts)** — everything the user creates:
hypothetical layers, saved views, bookmarks, recents, custom scenarios, Studio
boards and templates, the evaluation worksheet. Persisted to `localStorage`
(`meridian-explorer:workspace:v1`).

**Import/export (state/io.ts)** — a versioned JSON envelope
(`{ app, kind, version, meridianSha, payload }`) for a whole workspace or a
single board, scenario or layer. Imports are validated with zod and sanitised:
layer content is forced to hypothetical, ids colliding with real entities are
skipped, dangling relations dropped.

**Deep links (state/url.ts)** — the location hash mirrors navigational state
(`#/atlas?sel=e:<id>&x=<expanded>&f=<focus>&aud=developer&d=4`,
`#/theater?s=transfer&v=insufficient-funds&i=5`). Hash routing plus
`base: './'` makes the same build work on GitHub Pages at any path. Workspace
content is never put in the URL.

## 4. Shared UI

- **Design tokens** (`styles/index.css`): surfaces, text, lines, one colour per
  entity kind (`--k-*`) and relation channel (`--c-*`), confidence colours,
  light and dark themes, and a per-mode `--accent` set by `.mode-atlas`,
  `.mode-theater`, `.mode-studio`. Tailwind v4 maps them to utilities
  (`bg-surface`, `text-fg-muted`, `border-line`, `text-accent`…).
- **Primitives** (`ui/primitives.tsx`): `Button`, `IconButton`, `Tip`,
  `Popover`, `MenuItem`, `Dialog`, `Tabs`, `Segmented`, `Chip`, `Switch`,
  `Field`, `Badge`, `SectionTitle`, `Empty`, `renderInline`, `cn`.
- **Vocabulary** (`ui/kinds.tsx`): `KIND_COLOR`, `KIND_ICON`, `entityColor`,
  `KindIcon`, `KindBadge`, `CHANNEL_COLOR`, `ConfidenceBadge`, `MethodBadge`.
- **Viewers** (`viewers/`): `JsonView` (expand/collapse, highlight, hide
  fields, type hints, diff), `CodeBlock` / `SourceView` / `SourceList`
  (highlighted excerpts + GitHub permalinks), `FieldTable`, `EntityChip`,
  `ContractView` / `FlowList` (with a user-initiated, read-only live probe for
  public GET endpoints), `DbTable` (rows with before/after diff),
  `StateMachineView`, `BalanceCalculator` / `BalancePill`, `SequenceDiagram`.
- **Shell** (`shell/`): `TopBar`, `Inspector` (Overview · Contract · Data ·
  Code · Relations · Workflows · Impact for any selection), `CommandPalette`
  (search + guided questions), `Panels` (tour, questions, shortcuts, glossary,
  saved views, workspace, layers, evaluation, about) and `hotkeys.ts`.
- **Hotkeys**: components declare shortcuts with `useHotkeys([...])`; one
  listener dispatches them and the shortcut reference lists whatever is
  registered, so documentation cannot drift from behaviour. Shortcuts are
  inactive while typing in a field.

## 5. Audience and detail

`audience` (executive, end-user, systems, developer, dba) selects wording
(`entity.audience[...]`, `step.audience[...]`), a starting `detail` level and
default relation channels. `detail` is an independent 1–5 dial: an entity or
step is shown by default when its own detail level is ≤ the dial. Presets never
remove access — explicit expansion, search and the inspector reach everything.

## 6. The three modes

See the per-mode sections of [USER_GUIDE.md](USER_GUIDE.md) for behaviour.
Implementation notes for each mode live at the top of its entry file
(`atlas/Atlas.tsx`, `theater/Theater.tsx`, `studio/Studio.tsx`).

## 7. Testing

- **Unit / component** (Vitest + Testing Library, `src/**/*.test.ts(x)`):
  model integrity, hierarchy, aggregation, impact, search, scenario replay,
  trace assembly, hypothetical layers, import validation, URL encoding,
  viewers and mode interactions.
- **End-to-end** (Playwright, `e2e/`): the evaluation scenarios in all three
  modes against a production build.
- **Model verification** (`npm run model:verify`): integrity + source
  references against a clone of Meridian at the pinned commit.
