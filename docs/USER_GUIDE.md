# User guide

Meridian Explorer has three modes. Each is a complete tool; they differ in how
you think and move, not in what you can reach. Everything in this guide that is
not under a mode heading works the same in all three.

- [Getting around](#getting-around)
- [The inspector](#the-inspector)
- [Search](#search)
- [Audience and detail](#audience-and-detail)
- [Architecture Atlas](#architecture-atlas)
- [Scenario Theater](#scenario-theater)
- [Explanation Studio](#explanation-studio)
- [Modelling hypothetical changes](#modelling-hypothetical-changes)
- [Saving, sharing and exporting](#saving-sharing-and-exporting)
- [Presenting](#presenting)
- [Keyboard shortcuts](#keyboard-shortcuts)

## Getting around

The top bar, left to right:

| Control | What it does | Key |
| --- | --- | --- |
| **Architecture Atlas · Scenario Theater · Explanation Studio** | Switch mode. Your selection, audience and what-if layers carry over. | `1` `2` `3` |
| **← →** | Back / forward through where you have been, across modes. | `[` `]` |
| **Search Meridian…** | Search everything; see [Search](#search). | `/` or `Ctrl/⌘ K` |
| **Audience** and the **detail dial** | Who you are explaining to, and how deep; see [Audience and detail](#audience-and-detail). | `A`, `-` `=` |
| **What-if** | Hypothetical layers; see [Modelling hypothetical changes](#modelling-hypothetical-changes). | `H` |
| **Bookmark** | Saved views, bookmarks, recent items. | `B` |
| **Present** | Hide the chrome for screensharing. | `P` |
| **?** | Quick tour, guided questions, shortcuts, glossary, about & coverage, evaluation worksheet, export/import, copy link, theme. | `?` shortcuts, `G` glossary |
| **Panel icon** | Show or hide the inspector. | `I` |

**Guided questions** (? → Guided questions, or the empty search palette) give
the eight representative questions a prepared starting point in each mode —
the quickest way to see how the modes differ.

`Esc` closes whatever is open, leaves presenter mode, or clears the selection.

## The inspector

Select anything — a component, a connection, a scenario participant, a
glossary term — and the inspector on the right explains it. It collapses when
nothing is selected. Drag its left edge to resize.

For a component it has up to seven sections:

| Section | Shows |
| --- | --- |
| **Overview** | What it is (worded for the current audience, with the technical wording underneath), signature or route, technologies, the feature it belongs to, what it contains, and its evidence. |
| **Contract** | Endpoints only (or the list of endpoints inside a container): auth, inputs with every validation rule, example request, responses by status, every error and when it happens, the ordered server-side steps, side effects, and "For integrators". Public read-only endpoints offer **Try it against the live demo** — it runs only when you press Send and sends no credentials. |
| **Data** | Fields or columns (keys and foreign keys marked), allowed values, an example with expandable JSON, the lifecycle state machine, who reads and writes a table, and — for the ledger — an interactive balance calculator. |
| **Code** | The cited source excerpts, syntax-highlighted, each with a GitHub permalink at the pinned commit. |
| **Relations** | Everything it calls, reads, writes, validates, guards, emits…, grouped by channel. For a container, switch between "everything crossing its boundary" and "its own only". Click a row to inspect that relationship. |
| **Workflows** | Scenarios it takes part in (click to play), and for endpoints **Assemble a trace**. |
| **Impact** | What depends on it, breadth-first to depth 1–3. Direct dependents are *verified*; further ones *inferred*. **Diagram it** sends the result to the Studio. |

Header buttons: **Show in Atlas**, **Play workflow / Workflows**, **Add to
Studio**, **Open live** (pages with a route open the public demo in a new tab),
**GitHub**, **What if…**, and a ★ bookmark.

Every fact carries a provenance badge: **Verified** (read from the repository),
**Simplified**, **Inferred**, or **Hypothetical** (not in Meridian).

Selecting a connection shows its direction, kind, protocol, data exchanged,
contract where one applies, and evidence. Selecting an *aggregated* connection
between two collapsed components lists every underlying relationship and
endpoint.

## Search

Press `/`. Type a component name, an endpoint path (`/api/transfers`), a type or
table (`LedgerEntry`), a file name (`movements.ts`), or a plain word
(`balance`, `fraud`). Matching is by prefix and tolerates typos; names are
split on camelCase so `transfer` finds `createTransfer`. Filter chips narrow to
components, endpoints, data & types, scenarios or glossary.

`Enter` goes to the result **in the mode you are in**: the Atlas reveals it on
the map, the Theater plays its most relevant workflow (or assembles a trace for
an endpoint), the Studio adds it to the board. The three small icons on the
highlighted row send it to a specific mode instead.

With an empty query the palette offers the guided questions, your bookmarks and
recent items. Search is a local index — nothing leaves the browser.

## Audience and detail

**Audience** (Executive / Stakeholder, End user, Systems engineer, Software
developer, Database administrator) changes the wording of summaries and
scenario narratives, which relationship channels are shown by default, and sets
a starting **detail level**.

The **detail dial** (1 Outline → 5 Everything) is independent: turn it up or
down at any time without changing the audience. In the Atlas it controls which
children appear when you expand; in the Theater, which steps are shown.

Neither ever locks anything away — search, explicit expansion and the inspector
reach every level from any setting.

## Architecture Atlas

*Spatial: where things are, how they are organised, what talks to what.*

**Start.** A single node, **Meridian**. Click it.

**Expand in place.** Clicking a collapsed component selects it and opens it up:
it becomes a labelled region with its children inside, and everything around it
stays where it was. Keep clicking to go deeper — applications → subsystems →
modules and route groups → endpoints, functions and types; the database opens
into its tables. The chevron in a region's header collapses it (`E`). If the
detail level is hiding some children, a **+N more** chip shows them for that
component.

**Focus.** `F` (or the Focus button) isolates the selected container: only it
and its contents are shown, with faded stubs for the outside things it
connects to (click a stub to leave focus and go there). The breadcrumb at the
top left shows the path; click a crumb, press `U`, or use **Whole system** to
return. `[` and `]` step back and forward through where you have been.

**Connections.** Lines are coloured by channel — HTTP, real-time (dashed),
calls, data, types & validation, security, people & delivery, tests &
features — with arrowheads for direction and thickness for how many
underlying relationships they stand for. Collapsed components show aggregated
lines; expanding reveals finer ones. **Click a line** and the inspector shows
the protocol, the endpoints it carries, the data exchanged and the evidence.
Toggle channels with the **Relationships** chips in the sidebar (each shows how
many lines are drawn).

**Selection tools** (toolbar and keys): Expand/Collapse `E`, Focus `F`,
Highlight dependencies `D` (emphasise the selection, its lines and its
neighbours), Isolate neighbourhood `N` (show only the selection, its
neighbours and their containers), Spotlight `S` (dim everything else — for
presenting), Related workflow `W`, Add to Studio, Zoom to selection `Z`,
Zoom to fit `0`. Arrow keys move the selection: `↑` parent, `↓` first child,
`←` `→` siblings. `Home` collapses everything.

**Sidebar** (`T` to hide): the **system tree** (filterable; click to reveal on
the map), the **relationship filters**, the **Features lens** (pick a feature
such as *Scheduled payments* to highlight everything that implements it), and
a **legend**.

**Semantic zoom.** Zoomed out, nodes show names only; closer, a one-line
summary; closer still, technology badges and counts. A minimap sits bottom
right.

**What-if.** `Shift+H` adds a hypothetical component inside the selected
container (or connected to the selected component). Hypothetical components
and lines are dashed and purple; proposed removals are struck through;
components with a proposed change carry a marker.

## Scenario Theater

*Temporal: what happens, in what order, with what data, and what changes.*

**Pick a scenario.** The landing page and the library (left, `L`) list
scenarios as the questions they answer, grouped by topic, with step and
outcome counts. If you arrive with a component selected, **Workflows involving
…** appears at the top.

**Three views of the same steps** (`V` to cycle):

- **Sequence** — a sequence diagram: one lane per participant, one row per
  step, coloured by kind. Click a row to jump; click a lane header to inspect
  that component.
- **Stage** — the participants as nodes grouped by application; the current
  step's connection animates and the path taken so far stays visible.
- **Timeline** — every step as a card, with decisions and database changes
  marked.

**Transport** (bottom): Restart `Home`, Previous `←`, Play/Pause `Space`, Next
`→`, speed `,` `.`, a scrubber with a tick per step (diamonds are decisions,
squares are database changes — `Shift+←/→` jumps between them), the step
counter, and the **outcome** selector (`O`). Playback pauses at decisions
unless you switch that off.

**Step panel** (right): the narrative for the current audience (with the
technical version available), the **payload** — request, response, call
arguments or row — as expandable JSON with the important fields highlighted,
the **database** before and after (this step's changes, all tables, or
everything since the start), **derived balances** for the accounts involved,
recomputed from the ledger rows, and the **code** behind the step with a
GitHub link.

**Outcomes.** Scenarios include their real alternative paths: validation
failure, insufficient funds, rejection, wrong role… At a decision step, choose
an answer to follow that path; the selector at the bottom switches at any
time, keeping your place where the paths overlap. Hypothetical outcomes and
steps are purple and dashed.

**Detail and audience.** The detail dial decides how many steps are shown
(an executive outline is four to six steps; level 5 shows every check and row
write) — the header says how many are hidden and offers **Show all**. Hidden
steps still happen: the database view always reflects everything up to the
current step.

**Build one in a minute.**

- **From endpoint** (`N`): search the 51 endpoints, pick one, and a trace is
  assembled from its contract — who calls it, the request, each guard,
  validator, service call and database write in order, the response. It plays
  immediately.
- **Customize / Edit** (`E`): works on your own copy. Reorder steps (drag or
  buttons), delete, duplicate, insert, pick from **Reusable steps** (guards,
  validators, common writes and events harvested from every contract), and
  edit a step's title, arrow label, kind, from/to, narrative, detail level,
  payload and *hypothetical* flag. Anything you write is labelled
  hypothetical.
- **Save** (`Ctrl/⌘ S`) keeps it in the library under *mine*; export it to a
  file or import one.
- A blank scenario can be started from scratch.

**Elsewhere.** **Show in Atlas** reveals the current step's component on the
map; **Send to Studio** lays the participants out left to right with the steps
as numbered connections; the link icon copies a link to this exact step.

<!-- STUDIO -->


## Modelling hypothetical changes

Everything hypothetical lives in a **layer** on top of the baseline. The
Meridian model itself is never modified, and anything from a layer is always
drawn **dashed and purple** and labelled *Hypothetical*.

- **What-if ▾** in the top bar lists layers with on/off switches. *SimPay —
  external payment service* is a shipped example: a PayPal-like wallet with a
  proposed partner endpoint, guard, tables, webhook, four proposed changes to
  existing code and a proposed flow you can play in the Theater.
- **Add a hypothetical component…** (in that menu, and in each mode) creates a
  new component — name, kind, where it lives — and optionally connects it to
  something real with a labelled relationship.
- **What if…** in the inspector, on any real component:
  *Connect a new component*, *Add a field* (then see Impact for what uses the
  structure), *Note a change*, *Propose removing this*.
- Your first edit creates a layer called "My proposal"; shipped examples are
  read-only (use **Copy to edit**).
- **Manage layers** (`H`) compares a layer with the baseline — new components,
  new connections, changes, and the existing parts it touches — and offers
  **Show on the map**, **Diagram proposed vs. existing**, **Play proposed
  flow**, export, duplicate and delete. **Discard all my layers** resets.

## Saving, sharing and exporting

- **Everything you create is saved in this browser automatically**: Studio
  boards and templates, custom scenarios, hypothetical layers, saved views,
  bookmarks, evaluation notes, plus your audience, detail and theme.
- **Saved views** (`B`): name what you are looking at — mode, selection,
  audience, what is expanded or focused, the scenario and step, the active
  board — and reopen it later.
- **Links**: the address bar always describes the current view (mode,
  selection, audience, detail, Atlas expansion and focus, Theater scenario,
  outcome and step). ? → *Copy link to this view*. Links never contain boards
  or your own layers; the shipped example layers are addressable.
- **Export / import** (? → Export, import & reset): the whole workspace as one
  JSON file; import merges or replaces. Single boards, scenarios and layers
  can be exported from where they live and imported from the same dialog.
  Imports are validated, and imported layer content is always treated as
  hypothetical.
- **Reset** deletes everything stored in this browser (the model is unaffected).

## Presenting

`P` hides the top bar, side panels and inspector, leaving the canvas and a
small floating bar (mode, audience, search, exit) that fades until you point at
it. Each mode keeps the controls you need while presenting. `Esc` or
**Exit presenting** returns. Useful while presenting: the detail dial (`-`
`=`), audience (`A`), and each mode's spotlight.

Both light and dark themes are available (? → theme); animations respect the
operating system's reduced-motion setting and are never required to understand
what is shown.

## Keyboard shortcuts

Press `?` in the app for the list that applies to the mode you are in — it is
generated from the shortcuts actually registered. Shortcuts are inactive while
you type in a field, and every one has a visible control.

### Everywhere

| Key | Action |
| --- | --- |
| `/` or `Ctrl/⌘ K` | Search / command palette |
| `1` `2` `3` | Atlas · Theater · Studio |
| `[` `]` | Back · forward |
| `I` | Show / hide the inspector |
| `A` | Next audience preset |
| `-` `=` | Less · more detail |
| `H` | Hypothetical layers |
| `B` | Saved views and bookmarks |
| `G` | Glossary |
| `P` | Presenter mode |
| `?` | Shortcut reference |
| `Esc` | Close · leave presenter mode · clear selection |

### Architecture Atlas

| Key | Action |
| --- | --- |
| `E` | Expand / collapse the selected container |
| `F` | Focus on the selected container (again to leave) |
| `U` | Up one level / leave focus |
| `0` · `Z` | Zoom to fit · zoom to selection |
| `D` | Highlight dependencies of the selection |
| `N` | Isolate the neighbourhood of the selection |
| `S` | Spotlight the selection |
| `T` | Show / hide the sidebar |
| `↑` `↓` `←` `→` | Select parent · first child · previous / next sibling |
| `Home` | Collapse everything |
| `W` | Open the related workflow in the Theater |
| `Shift+H` | Add a hypothetical component |

### Scenario Theater

| Key | Action |
| --- | --- |
| `Space` | Play / pause |
| `→` `←` | Next · previous step |
| `Shift+→` `Shift+←` | Next · previous decision or database change |
| `Home` `End` | First · last step |
| `V` | Next view (sequence · stage · timeline) |
| `,` `.` | Slower · faster |
| `O` | Next outcome |
| `E` | Edit mode (works on your own copy) |
| `N` | New scenario from an endpoint |
| `L` | Show / hide the library |
| `Ctrl/⌘ S` | Save scenario |

<!-- STUDIO-SHORTCUTS -->
