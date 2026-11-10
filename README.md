# Meridian Explorer

Three interactive ways to explore, explain and experiment with a software
system — built around [Meridian](https://github.com/pcowhill/claude-banking-project),
a simulated banking platform (customer app, operations simulator, backend API).

**Live:** https://pcowhill.github.io/meridian-explorer/

It is a tool for *improvising* technical explanations during a call, not for
preparing slides: open it when a question comes up, find the relevant parts in
seconds, and have a clear picture on screen within a minute or two. People who
are sent the link can also explore on their own.

> Meridian is a **simulation** — no real money, accounts or financial
> integrations. The explorer is an independent project: it never modifies
> Meridian, contains no AI (search is a local index; all content is curated),
> and works without a running Meridian backend.

## The three modes

One application, one shared model of the real codebase, three interaction
philosophies. They differ in *how you think and navigate*, not in what they can
reach: search, the inspector, contracts, data, code, audiences, what-if
modelling and saving are available everywhere.

| | Architecture Atlas | Scenario Theater | Explanation Studio |
| --- | --- | --- | --- |
| **Philosophy** | Spatial — *where things are* | Temporal — *what happens* | Constructive — *build the picture* |
| **You start with** | One node, "Meridian"; click to open it up | A question, e.g. "What happens when a customer transfers money?" | An empty canvas and a palette that knows Meridian |
| **Core moves** | Expand in place, focus a subsystem, follow and inspect connections | Step, play, switch outcome, watch data and database change | Drop components (connections auto-fill), annotate, add widgets, generate diagrams |
| **Best for** | Orientation, "what talks to what", drilling from system to function | Explaining behaviour, failure paths, state changes | Answering the unexpected question; sketching a proposal |

### Shared by all modes

- **One model of the real system** — 975 components, 2,023 relationships, 51
  API contracts, 15 scenarios with 64 outcomes, 14 state machines — every fact
  linked to the source lines it came from at a pinned commit, with a
  verified / simplified / inferred / hypothetical label.
- **Inspector** — for anything selected: overview, API contract, data shape and
  example, code excerpts with GitHub permalinks, relationships, related
  workflows, and the impact of changing it.
- **Search** (`/` or `Ctrl/⌘ K`) — components, endpoints, types, tables,
  scenarios, glossary; choosing a result navigates to it in the active mode.
- **Audience presets and a detail dial** — Executive, End user, Systems
  engineer, Developer, DBA; five levels of detail; nothing is ever locked away.
- **What-if layers** — add hypothetical components, connections, fields and
  removals on top of the baseline without changing it; always drawn dashed and
  purple. A worked example (a PayPal-like "SimPay" integration) is included.
- **Context carries over** — select something in one mode, switch, and the
  other mode offers the relevant workflow or adds it to your board.
- **Saved views, bookmarks, deep links**, workspace export/import, presenter
  mode, light and dark themes, a full keyboard-shortcut set (press `?`).

## Documentation

- [User guide](docs/USER_GUIDE.md) — how to use each mode, search, what-if, saving, shortcuts
- [Evaluation guide](docs/EVALUATION_GUIDE.md) — hands-on scenarios and a rubric for comparing the modes
- [Architecture](docs/ARCHITECTURE.md) — the shared model, state, and how the modes are built
- [Source coverage](docs/SOURCE_COVERAGE.md) — what is modelled, how it is verified, known gaps
- [Model authoring](docs/MODEL_AUTHORING.md) — conventions for adding content

## Local setup

Requires Node.js ≥ 20.19 (22 recommended).

```bash
npm install
npm run dev          # http://localhost:5173
```

### Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server with hot reload |
| `npm run build` | Type-check and build the static site into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript project check |
| `npm test` | Unit and component tests (Vitest) |
| `npm run test:e2e` | End-to-end tests (Playwright) against the production build — run `npm run build` first |
| `npm run verify` | lint → typecheck → unit tests → build |
| `npm run model:verify` | Check the model's integrity and every source reference against a Meridian clone |
| `npm run model:snippets` | Re-extract the bundled source excerpts from a Meridian clone |

`model:verify` and `model:snippets` look for a clone of Meridian at the pinned
commit in `../pcowhill/claude-banking-project`, `../claude-banking-project`, or
`$MERIDIAN_DIR`. Without one, `model:verify -- --no-sources` still checks
integrity. For Playwright, install the browser once with
`npx playwright install chromium`.

## Build and deployment

The app is a static site (`dist/`). It uses hash routing and a relative base
path, so the same build works at any URL — GitHub Pages project sites included
— and deep links such as `#/theater?s=transfer&v=insufficient-funds&i=5` need
no server configuration.

GitHub Actions (`.github/workflows/ci.yml`) runs on every push and pull
request: install → lint → typecheck → model integrity → unit tests → build →
Playwright end-to-end tests. On `main`, when everything passes, the built site
is deployed to GitHub Pages.

## Technology

React 19 · TypeScript · Vite · Tailwind CSS 4 · React Flow (`@xyflow/react`)
for the graph and canvas views · zustand for state · MiniSearch for the local
search index · cmdk for the command palette · prism-react-renderer for code ·
zod for import validation · Vitest + Testing Library · Playwright.
