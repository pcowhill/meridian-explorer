# Evaluation guide

A hands-on way to compare the three modes on the same realistic tasks and
decide which interaction philosophy to build on.

The same material is built into the app: **? → Evaluation worksheet** shows
each scenario with a "Go to …" button per mode (it sets up a sensible starting
point), a timer, a notes box per mode, the rubric, and a download of the whole
worksheet as Markdown or JSON. Notes are saved in the browser as you type.

## How to run it

1. Open the app. If the welcome tour appears, skim it and close it.
2. For each scenario below, do it once per mode. Use the timer if speed
   matters to you. Write a line or two of observations per mode.
3. Fill in the rubric (1 = poor, 5 = excellent) and choose a preferred
   foundation.
4. Download the worksheet.

Tips that apply everywhere: `/` searches; `1` `2` `3` switch mode; `[` goes
back; `A` cycles the audience; `-` / `=` change the detail level; `P` toggles
presenter mode; `?` lists every shortcut for the mode you are in. Whatever you
select stays selected when you switch modes, and the inspector on the right
always explains the current selection.

---

## Scenario A — Understand Meridian's architecture

Starting from the initial Meridian view: identify the major applications,
expand the Backend API, find its important internal components, inspect the
communication relationships, focus on a subsystem, and return to the overall
architecture.

| Mode | A way to do it |
| --- | --- |
| **Atlas** | Click **Meridian**, then **Backend API**. Click the line between Customer Banking App and Backend API — the inspector lists the protocol and every endpoint used; compare it with the Operations ↔ Backend real-time line. Select a subsystem and press `F` to focus; use the breadcrumb or `U` to return. |
| **Theater** | Open *How do the customer application, operations simulator and backend communicate?* Step through it; switch between the Sequence and Stage views; compare the two outcomes (operations console vs. customer app). |
| **Studio** | Generate → *System overview* (or search the palette for the three applications and add them — known connections fill in). Click a connection to inspect it. Add the children of Backend API. |

Look for: how quickly a newcomer gets oriented; whether HTTP vs. real-time is
unmistakable; whether you ever feel lost.

## Scenario B — Explain a money transfer

Show the initiating user action, the request path, validation, backend
processing, ledger behaviour, the resulting state, code references, and the
data exchanged between steps.

| Mode | A way to do it |
| --- | --- |
| **Atlas** | Search `createTransfer` and reveal it. Read its Relations; open `POST /api/transfers` → Contract for the request, rules and errors; open `LedgerEntry` → Data. Use *Highlight dependencies*. |
| **Theater** | Open *What happens when a customer transfers money?* Step with `→`. Watch the request payload, the two ledger rows appear and both balances change. Switch the outcome to *insufficient funds*, then *csrf missing*. Raise detail to 5 for code-level steps. |
| **Studio** | Help → Guided questions → transfer → Studio. Add a JSON widget from the transfer contract's request example, a code widget for `createTransfer`, and the LedgerEntry table. Animate the path. |

## Scenario C — Explain a database concept: account balances

Show the relevant models, ledger entries, current vs. available, how balances
are derived, example data and the supporting code.

| Mode | A way to do it |
| --- | --- |
| **Atlas** | Expand **SQLite Database**; select `Account` (note: no balance column) and `LedgerEntry` → Data: columns, example row, lifecycle, and the interactive balance calculator. Search `deriveBalances` → Code. |
| **Theater** | Open *How are account balances calculated?* — one step per status rule with the balances recomputed beside the rows. Try the *pending-then-posted* outcome. Switch audience to DBA. |
| **Studio** | Add `Account` and `LedgerEntry` tables and the **Balance calculator** widget; change an entry from pending to posted and watch current catch up with available. Add the `deriveBalances` source excerpt. |

## Scenario D — Explain a multi-step process

Use the operations approval (or the scheduled payment / clock advance). Show
multiple components, a chronological trace, intermediate states, decision
points, alternative outcomes, and database and event effects.

| Mode | A way to do it |
| --- | --- |
| **Atlas** | Search `applyOperatorAction`; inspector → Workflows lists the scenarios it takes part in; Relations shows what it calls and writes; inspect the `ops:request_changed` event. |
| **Theater** | Open *How does an operations employee approve a pending transaction?* Compare approve, reject, hold and request-info at the decision; watch the pending entry flip to posted or failed and the live event to other consoles. Then try *What happens when the simulation clock advances?* |
| **Studio** | Start from the approval question; convert the chain to a sequence widget; add the request-status state machine; spotlight the ledger write. |

## Scenario E — Explore source-code implementation

Start from a high-level feature and go down to the endpoint, module, function,
types and validation, and the source reference — without losing the thread.

| Mode | A way to do it |
| --- | --- |
| **Atlas** | Sidebar → Features → *Scheduled payments* highlights everything that implements it. Drill: route group → endpoint → Contract → the service function → Code (excerpt + GitHub link). The breadcrumb in the inspector shows where you are. |
| **Theater** | In any scenario raise detail to 5; each step cites its lines — open the excerpt in place or jump to GitHub. Click a lane header to inspect that function. |
| **Studio** | Add a function; Generate → *Dependency diagram*; add a code widget and the types it uses. |

## Scenario F — Plan a hypothetical integration

Use the PayPal-like example. Find the existing interfaces, inspect the data
contracts and validation, add a hypothetical external service, connect it,
show the proposed data exchange, identify impacts, and keep proposed and
existing clearly apart.

| Mode | A way to do it |
| --- | --- |
| **Atlas** | Open `POST /api/movements` → Contract and read "For integrators" (it needs a customer session — there is no machine interface). Then **What-if** → switch on *SimPay*, or add your own component with *Add hypothetical component* and connect it. Open `ExternalMovementRequest` → *What if… → Add a field* → Impact. Layers panel → compare with baseline. |
| **Theater** | Play *What happens when a customer submits a deposit, ACH, wire or bill payment?* Then switch on *SimPay* and play *Proposed: a SimPay payment* — existing steps cite real code, proposed ones are purple. Or customise a copy of a real scenario and add hypothetical steps. |
| **Studio** | Guided question *integration* → Studio. Add a hypothetical component (`Shift+H`), connect it to `POST /api/movements`; draw a line to something unrelated and see it marked *proposed*; Generate → *Before/after*. |

Check in every mode: is it always obvious what exists today and what is only
proposed? Can the proposal be switched off or discarded, leaving the baseline
untouched?

## Scenario G — Improvise during a conversation

Without preparing: pick a question someone might really ask you (for example
"where would I add an SMS notification when a wire is approved?"). Open any
mode, find several relevant components, build a visualisation, add a
relationship, highlight an important concept, show data or code, explain a
hypothetical change, and save or export the result. **Time it** — the target
is one to three minutes.

| Mode | Shape of the workflow |
| --- | --- |
| **Atlas** | Search → reveal → expand around it → spotlight → What-if component → save the view (`B`) or copy the link. |
| **Theater** | *New scenario from endpoint* → pick the endpoint → edit: add a reusable step and a hypothetical step → present → save and export the scenario. |
| **Studio** | New board → palette search, add four or five things → connections auto-fill → note + code widget → hypothetical component → export the board or a PNG. |

---

## Rubric

Rate each mode from 1 (poor) to 5 (excellent).

| Criterion | What to ask yourself | Atlas | Theater | Studio |
| --- | --- | :-: | :-: | :-: |
| Speed of explanation construction | How quickly could I get a useful explanation on screen? | | | |
| Clarity | Would the audience have understood it? | | | |
| Ease of navigation | Could I get where I wanted without getting lost? | | | |
| Ability to improvise | Could I follow an unexpected question? | | | |
| Technical depth | Could I reach contracts, data and code when needed? | | | |
| Suitability for non-technical audiences | Does it work for a stakeholder or end user? | | | |
| Support for integration planning | Could I explore and present a proposed change? | | | |
| Overall presenter experience | Did it feel good to drive during a live call? | | | |
| **Average** | | | | |

**Preferred foundation:** ______________________

**Overall observations** (what worked, what did not, what to combine):
