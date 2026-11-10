import type { Entity, Relation } from '../../types';
import { ops, rel, src } from './helpers';

/**
 * Operations console — `App.tsx`, `pages/*` and `components/*`: the staff gate,
 * the route table, what each page lets an operator do, and the components.
 */

const E2E_OPS = 'e2e/operations.spec.ts';

// ---------------------------------------------------------------------------
// App shell + pages (op.console)
// ---------------------------------------------------------------------------

const pageEntities: Entity[] = [
  {
    id: 'op:App',
    kind: 'module',
    name: 'App.tsx',
    parent: 'op.console',
    summary: 'The console’s entry component: it lets only bank staff past the sign-in screen and maps URLs to pages.',
    description:
      '`main.tsx` mounts `<App />` in React strict mode. `App` nests `AuthProvider → BrowserRouter → OpsConsole`.\n\n`OpsConsole` is the staff gate. While the first session check is in flight it shows a “Checking operator session…” placeholder (so the sign-in form does not flash). If there is no user, or the user’s role fails `isOperatorRole` (`ops_agent` / `admin`), it renders `<Login />` for EVERY URL — there is no `/login` route. Otherwise it renders `OpsDataProvider → OpsLayout → Routes`.\n\nRoute table: `/` dashboard, `/queues` request queues, `/messaging` simulated messaging, `/clock` simulation clock, `/lending` lending products, `/admin` create demo user, `*` not found. The gate is a UI convenience; the backend independently enforces staff roles on every `/api/ops/*` and `/api/admin/*` call.',
    tech: ['React 18', 'react-router-dom 6'],
    tags: ['ui', 'rbac', 'auth', 'routing'],
    aliases: ['OpsConsole', 'staff gate', 'route table', 'main.tsx'],
    sources: [
      ops('App.tsx', 34, 60, 'function OpsConsole()', 'Staff gate + route table'),
      ops('App.tsx', 62, 75, 'export function App()'),
      ops('main.tsx', 11, 15, 'ReactDOM.createRoot'),
    ],
  },
  {
    id: 'op:pages/OpsDashboard',
    kind: 'page',
    name: 'Operations overview',
    parent: 'op.console',
    route: '/',
    summary: 'The landing page: platform counts, how many requests sit in each status, the first five open requests and the latest simulated events.',
    description:
      'Read-only. Three data sources: `useOpsSummary()` (one `GET /api/ops/summary` on mount) for the “Customers & staff”, “Accounts” and “Locked accounts” tiles; `useOpsData()` for everything else; `useAuth()` for the greeting.\n\nFrom the live queue it derives `open = requests.filter(r => !isTerminalOpsStatus(r.status))`; the “Open requests” tile is `open.length`, the status tiles are `counts[status]` for each of the five statuses, and “Needs attention” is the first five open requests with priority, status and (when the payload says so) a Reversed badge. “Recent simulated events” shows the first six feed items.\n\nLive behaviour: because the queue, counts and events come from the shared provider, an `ops:request_changed` or `ops:external_event` push re-renders this page with no request. The three summary tiles do not update live. A “Live / Reconnecting…” pill mirrors the socket state.',
    audience: {
      'end-user': 'The operator’s home screen: how busy the bank is right now and what needs attention first.',
      executive: 'A live overview of the back office workload.',
    },
    tags: ['ui', 'operations', 'realtime'],
    aliases: ['dashboard', 'ops overview'],
    sources: [
      ops('pages/OpsDashboard.tsx', 45, 52, 'export function OpsDashboard()'),
      ops('pages/OpsDashboard.tsx', 76, 92, 'Open requests', 'Platform tiles'),
      ops('pages/OpsDashboard.tsx', 104, 141, 'Needs attention', 'Queue snapshot'),
    ],
  },
  {
    id: 'op:pages/RequestQueues',
    kind: 'page',
    name: 'Request queues',
    parent: 'op.console',
    route: '/queues',
    summary: 'The operator’s work list: filter the live queue by status or lane, act on a request with one click, or open it for detail, notes and reversal.',
    description:
      'Reads `requests`, `counts`, `loading`, `error`, `connected` and `act` from `useOpsData()`. Filtering is entirely client-side over the full queue: a status chip row (`All` + the five statuses, each with its live count) and a lane chip row from the shared `OPS_QUEUES` (“Onboarding & identity”, “Deposits & transfers”, “Fraud & disputes”, “Support”), matched with `queueForType(r.type)`.\n\nEach request renders as a `QueueRequestCard` with the four decision buttons. Clicking a button calls `runAction(id, action)` — no note, no confirmation dialog. Clicking the card body selects it and opens `RequestDetailPanel` in the right-hand column.\n\nLive behaviour: when another operator (or this one, from the detail panel) changes a request, the socket push replaces that item in the shared queue, the card re-renders with its new status, the buttons disable if it became terminal, and the chip counts change. A new request appears at the top of the list.',
    audience: {
      'end-user': 'Where bank staff approve, reject, hold or query customer requests — deposits, payments, applications, fraud alerts, disputes.',
      executive: 'The back-office work queue; every decision made here is audited.',
      dba: 'Displays `OperationsRequest` rows; a decision updates the row’s status, appends an `AuditLog` row and — for money movements — re-statuses the linked `LedgerEntry` rows on the server.',
    },
    tags: ['ui', 'operations', 'realtime'],
    aliases: ['queues', 'work queue', 'live queue'],
    sources: [
      ops('pages/RequestQueues.tsx', 43, 57, 'export function RequestQueues()'),
      ops('pages/RequestQueues.tsx', 99, 125, 'OPS_QUEUES.map', 'Status + lane filters'),
      ops('pages/RequestQueues.tsx', 129, 159, 'RequestDetailPanel', 'List + detail layout'),
    ],
  },
  {
    id: 'op:pages/RequestQueues#runAction',
    kind: 'function',
    name: 'runAction',
    parent: 'op:pages/RequestQueues',
    summary: 'Handles a quick decision button on a queue card: mark the card busy, send the action, show an error if it fails.',
    description:
      'Clears `actionError`, adds the id to `busyIds` (disabling that card’s buttons), awaits `act(id, action)` from the data context, and on failure sets `actionError` to the `ApiError` message or “That action could not be completed.” The id is removed from `busyIds` in `finally`. Success needs no handling here — `act` already wrote the updated request into the shared queue.',
    signature: 'async function runAction(id: string, action: OpsAction)',
    tags: ['operations', 'ui'],
    sources: [ops('pages/RequestQueues.tsx', 59, 73, 'async function runAction')],
  },
  {
    id: 'op:pages/SimulatedMessaging',
    kind: 'page',
    name: 'Simulated messaging',
    parent: 'op.console',
    route: '/messaging',
    summary: 'Buttons that generate fake SMS, email, MFA and identity-check events, with the live feed of those events underneath.',
    description:
      'One card per channel in the shared `SIM_EVENT_CHANNELS`, each with a “Simulate <success>” and a “Simulate <failure>” button. `send(channel, ok)` builds the request from `CHANNEL_SETUP` and calls `simulate()` from the data context; the button for that channel/outcome is disabled while in flight and an `ApiError` message is shown under the cards.\n\nThe feed below is the provider’s `events` list rendered by `OpsActivityFeed`. Events created here are standalone — the page never sets `requestId`, so they are not linked to a queue item.\n\nLive behaviour: the new event appears as soon as the POST returns; events generated by other operators, and events the backend generates automatically when a request is actioned, arrive as `ops:external_event` pushes and are prepended.',
    audience: {
      'end-user': 'A panel for pretending to be the phone company, the email system or the identity checker — nothing is really sent.',
      executive: 'Shows where real messaging and identity providers would plug in; today the operator plays those systems.',
    },
    tags: ['ui', 'operations', 'integration', 'realtime'],
    aliases: ['messaging', 'simulate event'],
    sources: [
      ops('pages/SimulatedMessaging.tsx', 25, 28, 'export function SimulatedMessaging()'),
      ops('pages/SimulatedMessaging.tsx', 60, 101, 'Simulated event feed'),
    ],
  },
  {
    id: 'op:pages/SimulatedMessaging#CHANNEL_SETUP',
    kind: 'constant',
    name: 'CHANNEL_SETUP',
    parent: 'op:pages/SimulatedMessaging',
    summary: 'For each channel: the event kind to send and which status counts as success or failure.',
    values: [
      { value: 'sms', meaning: 'kind `otp`; success `delivered`, failure `failed` (“One-time passcodes & alerts”).' },
      { value: 'email', meaning: 'kind `notification`; success `delivered`, failure `failed`.' },
      { value: 'mfa', meaning: 'kind `challenge`; success `approved`, failure `rejected`.' },
      { value: 'identity', meaning: 'kind `verification`; success `approved`, failure `rejected`.' },
    ],
    tags: ['integration'],
    sources: [ops('pages/SimulatedMessaging.tsx', 14, 23, 'const CHANNEL_SETUP')],
  },
  {
    id: 'op:pages/SimulatedMessaging#send',
    kind: 'function',
    name: 'send',
    parent: 'op:pages/SimulatedMessaging',
    summary: 'Builds one simulated-event request for a channel and outcome and submits it.',
    description:
      'Looks up `CHANNEL_SETUP[channel]`, picks `setup.ok` or `setup.fail` as `outcome`, and calls `simulate({ channel, kind, outcome, summary })` where the summary reads `Simulated <Channel label> <kind> — <outcome>`.',
    signature: 'async function send(channel: SimEventChannel, ok: boolean)',
    example: { channel: 'sms', kind: 'otp', outcome: 'delivered', summary: 'Simulated SMS otp — delivered' },
    tags: ['integration', 'operations'],
    sources: [ops('pages/SimulatedMessaging.tsx', 30, 47, 'async function send')],
  },
  {
    id: 'op:pages/SimulationClock',
    kind: 'page',
    name: 'Simulation clock',
    parent: 'op.console',
    route: '/clock',
    summary: 'Shows the simulated date, lets an operator fast-forward it, reports what that advance fired and accrued, and lists every customer’s payment schedules.',
    description:
      'Three sections.\n\n“Current simulated date” shows `displayTime`, a local mirror of the provider’s `simulationTime` (heartbeat-driven). If the provider has no time yet the page makes its own one-shot `fetchClock()`.\n\n“Fast-forward” offers four presets (`+1 hour`, `+1 day`, `+1 week`, `+1 month` = 30 days) and a custom days + hours form. Both go through `runAdvance`. The custom submit button is disabled while `validateAdvance` rejects the inputs; the hint text is the shared validator’s message (at least one minute forward, at most one year per step). After a successful advance a “Last advance” panel lists each fired schedule (kind, runs, posted amount, queued amount, skipped count, resulting status) and an “Interest accrued” row (savings accounts / CDs / loans accrued, credited and charged totals, CDs matured).\n\n“Customer payment schedules” is a table from `GET /api/ops/schedules` (type, amount, from → to, frequency, status, next run, run count) with a manual Refresh link.\n\nLive behaviour: the displayed date follows the socket heartbeat, so an advance made by another operator shows up within ten seconds. The schedules table and the “Last advance” panel are local to this page and do not update from the socket. Note: `submitCustom` clears the two inputs after `runAdvance` settles whether or not the advance succeeded, because `runAdvance` catches its own errors.',
    audience: {
      'end-user': 'The time machine: move the bank’s calendar forward to make scheduled payments run and interest post.',
      executive: 'Lets a demonstrator show a month of banking activity in one click.',
      dba: 'An advance updates the `SimulationClock` singleton and, on the server, writes ledger entries for fired schedules and accrued interest.',
    },
    tags: ['ui', 'time', 'operations', 'lending'],
    aliases: ['clock', 'fast-forward', 'time travel'],
    sources: [
      ops('pages/SimulationClock.tsx', 19, 28, 'Simulation clock console (v0.9.0)'),
      ops('pages/SimulationClock.tsx', 110, 137, 'export function SimulationClock()'),
      ops('pages/SimulationClock.tsx', 206, 225, 'function submitCustom', 'Custom form submit + live validity'),
      ops('pages/SimulationClock.tsx', 340, 384, 'Last advance', 'Fired schedules + accrual summary'),
    ],
  },
  {
    id: 'op:pages/SimulationClock#PRESETS',
    kind: 'constant',
    name: 'PRESETS',
    parent: 'op:pages/SimulationClock',
    summary: 'The four one-click fast-forward amounts.',
    values: [
      { value: '+1 hour', meaning: '`{ hours: 1 }`' },
      { value: '+1 day', meaning: '`{ days: 1 }`' },
      { value: '+1 week', meaning: '`{ days: 7 }`' },
      { value: '+1 month', meaning: '`{ days: 30 }` — thirty days stands in for a month.' },
    ],
    tags: ['time'],
    sources: [ops('pages/SimulationClock.tsx', 102, 108, 'const PRESETS')],
  },
  {
    id: 'op:pages/SimulationClock#runAdvance',
    kind: 'function',
    name: 'runAdvance',
    parent: 'op:pages/SimulationClock',
    summary: 'The advance handler: validate locally, call the backend, show the new time and what fired, then reload the queue and the schedules.',
    description:
      '1. `validateAdvance(body)` — on failure set `advanceError` and stop (no request).\n2. `advanceClock(body)` → `{ clock, fired, accrued }`.\n3. `setDisplayTime(clock.currentTime)` immediately (before the next heartbeat), store `fired` and `accrued` for the “Last advance” panel.\n4. `Promise.all([refresh(), loadSchedules()])` — the queue is re-read because a fired bill-pay schedule queues a review request, and schedules because run counts and next-run dates moved.\nAn `ApiError` message (or “Could not advance the simulation clock.”) is shown on failure.',
    signature: 'const runAdvance = useCallback(async (body: AdvanceClockRequest) => { … }, [loadSchedules, refresh])',
    detail: 3,
    tags: ['time', 'operations'],
    sources: [ops('pages/SimulationClock.tsx', 174, 204, 'const runAdvance')],
  },
  {
    id: 'op:pages/LendingProducts',
    kind: 'page',
    name: 'Lending',
    parent: 'op.console',
    route: '/lending',
    summary: 'A read-only table of every customer’s CDs and loans with their status, balance, rate, term and maturity date.',
    description:
      'Loads once on mount with `fetchLending()` and again when the operator clicks Refresh; there is no live update and no action — operators cannot open, pay or close a product here.\n\nColumns: product (`lendingKindLabel`), account name, status badge, balance, APY (`formatApy(apyBps)`), term in months, maturity date. The balance cell shows a loan’s `outstandingMinor` as a positive “owed” figure (or $0.00 once paid off) and a CD’s `balanceMinor` in green. For an active product it also shows “in N days”, computed as `daysBetween(lastAccruedAt, maturesAt)` — measured from the last accrual date, not from the browser’s clock.',
    audience: {
      'end-user': 'Where staff can look up a customer’s loans and certificates of deposit. View only.',
    },
    tags: ['ui', 'lending', 'operations'],
    aliases: ['lending products', 'loans and CDs'],
    sources: [
      ops('pages/LendingProducts.tsx', 14, 23, 'Operator lending visibility (v1.0.0)'),
      ops('pages/LendingProducts.tsx', 56, 78, 'export function LendingProducts()'),
      ops('pages/LendingProducts.tsx', 38, 54, 'function BalanceCell', 'Loan “owed” vs CD balance'),
    ],
  },
  {
    id: 'op:pages/AdminUsers',
    kind: 'page',
    name: 'Create demo user',
    parent: 'op.console',
    route: '/admin',
    summary: 'An admin-only form that creates a simulated user and can open and fund an account for them.',
    description:
      'Despite the file name this page does not list users — it is a create form (the backend’s `GET /api/admin/users` roster endpoint has no caller in this app).\n\nAdmin-only is enforced three times: the sidebar link is filtered out unless `user.role === "admin"` (`OpsLayout`); the route itself is reachable by URL for any staff user, so the page checks the role and renders “Not authorized. Provisioning demo users requires an administrator account.” instead of the form; and the backend requires the `admin` role on `POST /api/admin/users`.\n\nFields: email, display name, role (the shared `ADMIN_CREATABLE_ROLES`), optional product (`ONBOARDING_PRODUCTS`), optional opening deposit in dollars (converted with `toMinor`), and a reason that becomes required as soon as the deposit is above zero. The right-hand card shows the result: name, email, status, any opened account and the non-secret demo password to share.',
    audience: {
      'end-user': 'For administrators only: add a new demo customer or staff member, optionally with a funded account.',
      dba: 'A successful submit inserts a `User` (bcrypt hash), optionally an `Account` + `AccountAccess` and a bank-originated `LedgerEntry`, and an `AuditLog` row — all on the server.',
    },
    tags: ['ui', 'rbac', 'operations', 'onboarding', 'validation'],
    aliases: ['admin users', 'create user', 'provision user'],
    sources: [
      ops('pages/AdminUsers.tsx', 46, 56, 'export function AdminUsers()'),
      ops('pages/AdminUsers.tsx', 73, 86, "user?.role !== 'admin'", 'In-page admin check'),
      ops('pages/AdminUsers.tsx', 335, 381, 'Demo user created', 'Result card'),
    ],
  },
  {
    id: 'op:pages/AdminUsers#handleSubmit',
    kind: 'function',
    name: 'handleSubmit',
    parent: 'op:pages/AdminUsers',
    summary: 'Validates the form with the shared validator, submits it, and shows either the created user or a specific error.',
    description:
      'Builds a draft `{ email, displayName, role, product || null, initialFundingMinor, reason || null }` and runs the shared `validateAdminCreateUser` — the same function the server runs. Field errors are shown inline and nothing is sent. Otherwise it calls `createAdminUser(validation.value)`, stores the response for the result card and resets the form. `ApiError` with code `email_taken` or status 409 becomes “A user with that email already exists.”; any other `ApiError` shows its message.',
    signature: 'async function handleSubmit(event: FormEvent<HTMLFormElement>)',
    tags: ['validation', 'rbac', 'onboarding'],
    sources: [ops('pages/AdminUsers.tsx', 88, 139, 'async function handleSubmit')],
  },
  {
    id: 'op:pages/Login',
    kind: 'page',
    name: 'Operator sign-in',
    parent: 'op.console',
    summary: 'The sign-in screen shown to anyone who is not signed in as bank staff, whatever URL they asked for.',
    description:
      'Rendered by the app gate rather than by a route. It draws its own chrome (simulation banner, logo) because it appears before the authenticated layout exists.\n\nA work-email + password form submits through `useAuth().login`. Two demo-login cards (operations agent, administrator) fill the form when clicked; the demo passwords are intentionally public for the simulation. An amber notice explains “Your operator session has ended…” when `sessionEnded` is set, and in public-demo mode a shared-demo callout sits above the form.\n\nErrors are shown from a code → message table (`messageForCode`).',
    audience: {
      'end-user': 'The staff sign-in page. Customers who try to sign in here are turned away.',
    },
    tags: ['ui', 'auth', 'rbac', 'security'],
    aliases: ['login', 'operator login'],
    sources: [
      ops('pages/Login.tsx', 51, 62, 'export function Login()'),
      ops('pages/Login.tsx', 113, 124, 'sessionEnded', 'Session-ended notice + public-demo callout'),
      ops('pages/Login.tsx', 11, 16, 'DEMO_LOGINS', 'Demo logins (non-secret by design)'),
    ],
  },
  {
    id: 'op:pages/Login#handleSubmit',
    kind: 'function',
    name: 'handleSubmit',
    parent: 'op:pages/Login',
    summary: 'Signs in, then refuses anyone who is not staff by logging them straight back out.',
    description:
      '`const user = await login(email, password)`. If `!isOperatorRole(user.role)` the credentials were valid but belong to a customer: it calls `logout()` (so no operations session is left behind) and shows the `not_operator` message. On success there is nothing to navigate — `AuthProvider` now holds a staff user and the app gate swaps to the console. A thrown `ApiError` supplies the error code; anything else becomes `unknown_error`.',
    signature: 'async function handleSubmit(event: FormEvent<HTMLFormElement>)',
    detail: 3,
    tags: ['auth', 'rbac'],
    sources: [ops('pages/Login.tsx', 64, 83, 'async function handleSubmit')],
  },
  {
    id: 'op:pages/Login#messageForCode',
    kind: 'function',
    name: 'messageForCode',
    parent: 'op:pages/Login',
    summary: 'Maps a backend error code to the sentence the operator sees.',
    signature: 'function messageForCode(code: string): string',
    values: [
      { value: 'invalid_credentials', meaning: '“Email or password is incorrect.”' },
      { value: 'account_locked', meaning: '“This account is temporarily locked after too many failed attempts. Try again later.”' },
      { value: 'account_disabled', meaning: '“This account is disabled. Contact an administrator.”' },
      { value: 'invalid_request', meaning: '“Enter a valid email and password.”' },
      { value: 'not_operator', meaning: 'Local code (not from the backend): “This console is for bank staff only. Customers use the customer app.”' },
      { value: 'rate_limited', meaning: '“Too many sign-in attempts from your connection on this shared demo. Wait a minute and try again.”' },
      { value: '(anything else)', meaning: '“Could not sign in. Check that the simulated backend is running and try again.”' },
    ],
    tags: ['auth', 'ui'],
    sources: [ops('pages/Login.tsx', 31, 49, 'function messageForCode')],
  },
  {
    id: 'op:pages/NotFound',
    kind: 'page',
    name: 'Not found',
    parent: 'op.console',
    route: '*',
    summary: 'The “404 — No such operations view (yet).” page for any unknown console URL.',
    detail: 5,
    tags: ['ui'],
    sources: [ops('pages/NotFound.tsx', 1, 8, 'export function NotFound()')],
  },
];

// ---------------------------------------------------------------------------
// Components (op.ui)
// ---------------------------------------------------------------------------

const componentEntities: Entity[] = [
  {
    id: 'op:components/OpsLayout',
    kind: 'component',
    name: 'OpsLayout',
    parent: 'op.ui',
    summary: 'The console frame: simulation banner, header with API status and the signed-in operator, sidebar navigation and footer.',
    description:
      'Navigation comes from a static `navLinks` list; entries flagged `adminOnly` (only “Create demo user” → `/admin`) are filtered out unless `user.role === "admin"`. A dimmed “Audit log” placeholder is listed but not linked. Below the `lg` breakpoint the sidebar is hidden and a menu button toggles the same links; the menu closes on every route change.\n\nThe header contains `OpsStatus` (“Connecting…”, “API online · v<version>”, “API offline”, from `useApiStatus`) and `OperatorMenu` (name, email, role badge and a Log out button that calls `useAuth().logout()`).',
    tags: ['ui', 'rbac'],
    aliases: ['layout', 'sidebar', 'navigation'],
    sources: [
      ops('components/OpsLayout.tsx', 145, 157, 'export function OpsLayout'),
      ops('components/OpsLayout.tsx', 19, 32, 'adminOnly: true', 'Navigation links'),
      ops('components/OpsLayout.tsx', 87, 119, 'function OperatorMenu', 'API status pill + operator menu'),
    ],
  },
  {
    id: 'op:components/RequestDetailPanel',
    kind: 'component',
    name: 'RequestDetailPanel',
    parent: 'op.ui',
    summary: 'The right-hand panel for one request: full context, decision buttons with an optional note, “Add note”, “Reverse movement”, audit history and linked simulated events.',
    description:
      'Two copies of the request are in play. `detail` is fetched by this panel (`fetchOpsRequestDetail`) and carries the audit `history` and linked `events`. `live` is the same request found in the shared queue (`requests.find(r => r.id === requestId)`), which the socket keeps current. Everything status-dependent — the status badge, whether buttons are enabled, the Reversed badge, the reverse section — reads the live copy (falling back to `detail`), so a decision made on the queue card, by another operator, or echoed by the socket is reflected at once. When `live.updatedAt` differs from `detail.updatedAt` and nothing is loading or in flight, the panel reloads `detail` to pick up the new history.\n\nContext shown: type label, summary, detail text, subject name and email, then one type-specific section. Onboarding: product, opening deposit, joint-invite email (read defensively from the untyped payload). Money movement (`asMovementPayload`): kind, amount, direction, counterparty, memo, Reversed tag. Fraud alert (`asFraudPayload`): merchant, amount, the customer’s response, resolution — “Approve = confirm fraud (reverses the charge + freezes the card); Reject = dismiss”. Dispute (`asDisputePayload`): transaction, amount, reason, details, resolution — “Approve = uphold (reverses the charge); Reject = deny”.\n\nActions by status:\n• `pending`, `on_hold`, `info_requested` (non-terminal) — all four decision buttons are enabled: Approve, Reject, Hold, Request info. The note textarea (max 500 characters) is optional and sent with the decision.\n• `approved`, `rejected` (terminal) — the four buttons are disabled; “Add note” stays available (“Resolved — you can still add an audit note.”).\n• “Add note” at any status — enabled once the textarea is non-empty; sends action `note`, which records an audit entry without changing status.\n• “Reverse movement” — a separate section shown only when the request is a money movement, its live status is `approved`, and `payload.reversed` is not already true. The reason textarea is required (max `MOVEMENT_TEXT.reasonMaxLength`) and the button stays disabled until it is non-empty.\n\nHistory lists each audit entry as “<Verb> by <actor> · <relative time>” with the note quoted underneath; `created` is shown as “Created” and operator actions use `opsActionLabel`.',
    audience: {
      'end-user': 'Open a request to see who it is about and why, decide it, leave a note, or undo a posted payment — and read the full history of who did what.',
      executive: 'Every operator decision is taken here with an optional justification, and the complete audit trail is visible on the same screen.',
      dba: 'History is the request’s `AuditLog` trail; linked events are `SimulatedEvent` rows with this `requestId`. A reversal re-statuses the linked `LedgerEntry` to `reversed` — rows are never deleted.',
    },
    detail: 3,
    tags: ['ui', 'operations', 'audit', 'money', 'risk', 'realtime'],
    aliases: ['detail panel', 'request detail', 'reverse movement', 'add note'],
    sources: [
      ops('components/RequestDetailPanel.tsx', 73, 97, 'export function RequestDetailPanel'),
      ops('components/RequestDetailPanel.tsx', 99, 117, 'const live = requests.find', 'Live copy drives status-dependent UI'),
      ops('components/RequestDetailPanel.tsx', 119, 145, 'live.updatedAt !== detail.updatedAt', 'Load + reload when the live copy moves on'),
      ops('components/RequestDetailPanel.tsx', 201, 207, 'canShowReverse', 'When reversal is offered'),
      ops('components/RequestDetailPanel.tsx', 430, 466, 'Resolved — you can still add an audit note', 'Note + action bar'),
      ops('components/RequestDetailPanel.tsx', 468, 502, 'Reverse movement', 'Reversal section'),
      ops('components/RequestDetailPanel.tsx', 506, 533, 'detail.history.map', 'History + linked events'),
    ],
  },
  {
    id: 'op:components/RequestDetailPanel#handleAction',
    kind: 'function',
    name: 'handleAction',
    parent: 'op:components/RequestDetailPanel',
    summary: 'Submits a decision from the detail panel together with the typed note, then reloads the history.',
    description:
      'Sets `busy`, clears the error, awaits `act(requestId, action, note.trim() || undefined)`, clears the note and awaits `load()` so the new audit entry appears. On failure the `ApiError` message (or “That action could not be completed.”) is shown in the panel. The same `act` updates the queue card on the left.',
    signature: 'const handleAction = useCallback(async (action: OpsAction) => { … }, [act, requestId, note, load])',
    detail: 3,
    tags: ['operations', 'audit'],
    sources: [ops('components/RequestDetailPanel.tsx', 147, 162, 'const handleAction')],
  },
  {
    id: 'op:components/RequestDetailPanel#handleAddNote',
    kind: 'function',
    name: 'handleAddNote',
    parent: 'op:components/RequestDetailPanel',
    summary: 'Records a note in the request’s audit history without changing its status.',
    description: 'Returns early on empty text; otherwise `act(requestId, "note", text)`, clears the textarea and reloads the detail. Allowed after a terminal decision.',
    signature: 'const handleAddNote = useCallback(async () => { … }, [act, requestId, note, load])',
    tags: ['operations', 'audit'],
    sources: [ops('components/RequestDetailPanel.tsx', 164, 180, 'const handleAddNote')],
  },
  {
    id: 'op:components/RequestDetailPanel#handleReverse',
    kind: 'function',
    name: 'handleReverse',
    parent: 'op:components/RequestDetailPanel',
    summary: 'Submits the reversal of an approved money movement with its required reason.',
    description:
      'Returns early on an empty reason; otherwise `reverse(requestId, reason)` from the data context, clears the reason and reloads the detail (the reversal shows in History and the payload now carries `reversed: true`, which hides this section). Failure shows the `ApiError` message or “That movement could not be reversed.”',
    signature: 'const handleReverse = useCallback(async () => { … }, [reverse, requestId, reverseReason, load])',
    detail: 3,
    tags: ['operations', 'money', 'ledger', 'audit'],
    sources: [ops('components/RequestDetailPanel.tsx', 182, 199, 'const handleReverse')],
  },
  {
    id: 'op:components/QueueRequestCard',
    kind: 'component',
    name: 'QueueRequestCard',
    parent: 'op.ui',
    summary: 'One request in the queue list: type, summary, subject, age, status and priority badges, and the four quick-action buttons.',
    description: 'The body is a button that selects the request (opening the detail panel); the `ActionBar` underneath fires `onAction(action)` with no note. Carries the `queue-card` / `queue-summary` test ids the end-to-end tests use.',
    tags: ['ui', 'operations'],
    sources: [ops('components/QueueRequestCard.tsx', 13, 30, 'export function QueueRequestCard')],
  },
  {
    id: 'op:components/ActionBar',
    kind: 'component',
    name: 'ActionBar',
    parent: 'op.ui',
    summary: 'The four decision buttons — Approve, Reject, Hold, Request info — disabled once a request is resolved.',
    description:
      'Renders one button per entry of the shared `OPS_ACTIONS` (`approve`, `reject`, `hold`, `request_info`), labelled with `opsActionLabel`. All four are disabled when `isTerminalOpsStatus(status)` is true (`approved` / `rejected`) or while `busy`. It does not hide buttons per status: a request already `on_hold` still offers Hold. The non-decision `note` action is deliberately not on this bar.',
    values: [
      { value: 'approve', meaning: 'Green button.' },
      { value: 'reject', meaning: 'Red button.' },
      { value: 'hold', meaning: 'Amber button.' },
      { value: 'request_info', meaning: 'Ghost button.' },
    ],
    tags: ['ui', 'operations'],
    sources: [ops('components/ActionBar.tsx', 11, 36, 'export function ActionBar')],
  },
  {
    id: 'op:components/OpsActivityFeed',
    kind: 'component',
    name: 'OpsActivityFeed',
    parent: 'op.ui',
    summary: 'A list of simulated external events: channel, status, direction, summary and age.',
    description: 'Takes `events`, an optional `limit` and an `emptyHint`. Used on the dashboard (limit 6), the messaging page (full feed) and inside the detail panel (events linked to one request).',
    tags: ['ui', 'integration'],
    sources: [ops('components/OpsActivityFeed.tsx', 5, 22, 'export function OpsActivityFeed')],
  },
  {
    id: 'op:components/badges',
    kind: 'component',
    name: 'badges.tsx',
    parent: 'op.ui',
    summary: 'The small coloured pills: request status, Reversed, priority, schedule status, lending status, event channel and event status.',
    description:
      'Seven exports. `StatusBadge` colours the five request statuses. `ReversedBadge` is a secondary tag shown beside a terminal “Approved” when the shared `isRequestReversed(payload)` is true. `PriorityBadge` renders nothing for `normal`. `ScheduleStatusBadge`, `LendingStatusBadge`, `ChannelBadge` and `EventStatusBadge` do the same for their value lists. Each colour map is typed as a `Record` over the shared union, so adding a status without a colour fails the type check.',
    values: [
      { value: 'StatusBadge', meaning: 'pending amber · approved green · rejected red · on_hold blue · info_requested violet' },
      { value: 'ReversedBadge', meaning: 'Shown alongside the status when the movement was reversed.' },
      { value: 'PriorityBadge', meaning: 'high / low only.' },
      { value: 'ScheduleStatusBadge', meaning: 'active · completed · cancelled' },
      { value: 'LendingStatusBadge', meaning: 'active · matured · paid_off · closed' },
      { value: 'ChannelBadge', meaning: 'sms · email · mfa · identity' },
      { value: 'EventStatusBadge', meaning: 'sent · delivered · failed · pending · approved · rejected' },
    ],
    detail: 5,
    tags: ['ui'],
    sources: [
      ops('components/badges.tsx', 30, 50, 'export function StatusBadge'),
      ops('components/badges.tsx', 52, 108, 'export function EventStatusBadge'),
    ],
  },
  {
    id: 'op:components/RoleBadge',
    kind: 'component',
    name: 'RoleBadge',
    parent: 'op.ui',
    summary: 'A pill showing a user’s role (Admin, Ops agent, Customer, Joint customer).',
    detail: 5,
    tags: ['ui', 'rbac'],
    sources: [ops('components/RoleBadge.tsx', 4, 13, 'export function RoleBadge')],
  },
  {
    id: 'op:components/SimulationBanner',
    kind: 'component',
    name: 'SimulationBanner',
    parent: 'op.ui',
    summary: 'The always-visible strip stating that this console simulates bank operations and is not a real bank system.',
    description: 'Rendered at the top of the layout, the sign-in page and the loading placeholder. Directly beneath it sits the public-demo line, which only appears in public-demo mode.',
    tags: ['ui', 'public-demo'],
    sources: [ops('components/SimulationBanner.tsx', 4, 26, 'export function SimulationBanner')],
  },
  {
    id: 'op:components/PublicDemoNotice',
    kind: 'component',
    name: 'PublicDemoNotice',
    parent: 'op.ui',
    summary: 'The amber “Shared public demo” warning, rendered only when the console runs as the shared public demo.',
    description:
      'Returns `null` unless `usePublicDemo()` is true. `variant="banner"` is the slim line under the simulation banner; `variant="form"` is the callout above the sign-in form (“Other visitors may be acting on the same queues at the same time…”). The wording comes from the shared `PUBLIC_DEMO_NOTICE`; the release build and the public verification both check that the phrase “This is a shared public simulation” is present in the shipped bundle.',
    tags: ['ui', 'public-demo'],
    sources: [
      ops('components/PublicDemoNotice.tsx', 11, 19, 'export function PublicDemoNotice'),
      src('packages/shared/src/public-demo.ts', 39, 51, 'This is a shared public simulation', 'The wording'),
    ],
  },
  {
    id: 'op:components/Logo',
    kind: 'component',
    name: 'Logo',
    parent: 'op.ui',
    summary: 'Inline SVG of the Meridian compass logo (light tone for the dark console).',
    detail: 5,
    tags: ['ui'],
    sources: [ops('components/Logo.tsx', 9, 10, 'export function Logo')],
  },
  {
    id: 'op:components/ui/Button',
    kind: 'component',
    name: 'ui/Button',
    parent: 'op.ui',
    summary: 'The console’s button with five variants: primary, approve, reject, hold and ghost.',
    detail: 5,
    tags: ['ui'],
    sources: [ops('components/ui/Button.tsx', 13, 27, 'export function Button')],
  },
  {
    id: 'op:components/ui/Card',
    kind: 'component',
    name: 'ui/Card',
    parent: 'op.ui',
    summary: 'The dark rounded surface every panel and tile is drawn on.',
    detail: 5,
    tags: ['ui'],
    sources: [ops('components/ui/Card.tsx', 8, 9, 'export function Card')],
  },
];

export const uiEntities: Entity[] = [...pageEntities, ...componentEntities];

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

const route = (page: string, path: string, line: number, symbol: string): Relation =>
  rel('op:App', page, 'renders', {
    label: `<Route path="${path}">`,
    sources: [ops('App.tsx', line, line, symbol)],
  });

const nav = (page: string, label: string, line: number, symbol: string, extra: Partial<Relation> = {}): Relation =>
  rel('op:components/OpsLayout', page, 'navigates', {
    label,
    sources: [ops('components/OpsLayout.tsx', line, line, symbol)],
    ...extra,
  });

export const uiRelations: Relation[] = [
  // ---- App shell ------------------------------------------------------------
  rel('op:App', 'op:lib/AuthContext#AuthProvider', 'renders', {
    label: '<AuthProvider>',
    summary: 'The whole app sits inside the auth provider.',
    sources: [ops('App.tsx', 67, 75, '<AuthProvider>')],
    order: 1,
  }),
  rel('op:App', 'op:lib/auth-context#isOperatorRole', 'calls', {
    label: '!user || !isOperatorRole(user.role) → <Login />',
    summary: 'The staff gate: only `ops_agent` and `admin` get past the sign-in screen.',
    sources: [ops('App.tsx', 39, 43, 'isOperatorRole(user.role)')],
    tags: ['rbac', 'security'],
    order: 2,
  }),
  rel('op:App', 'op:pages/Login', 'renders', {
    label: '<Login /> (no staff session)',
    summary: 'Shown for every URL when nobody is signed in or the session belongs to a customer role.',
    sources: [ops('App.tsx', 42, 43, '<Login />')],
    order: 3,
  }),
  rel('op:App', 'op:lib/OpsDataContext#OpsDataProvider', 'renders', {
    label: '<OpsDataProvider>',
    summary: 'Mounted only after the gate, so the socket and queue load start once a staff user is signed in.',
    sources: [ops('App.tsx', 45, 58, '<OpsDataProvider>')],
    order: 4,
  }),
  rel('op:App', 'op:components/OpsLayout', 'renders', {
    label: '<OpsLayout>',
    sources: [ops('App.tsx', 47, 57, '<OpsLayout>')],
    order: 5,
  }),
  route('op:pages/OpsDashboard', '/', 49, '<OpsDashboard />'),
  route('op:pages/RequestQueues', '/queues', 50, '<RequestQueues />'),
  route('op:pages/SimulatedMessaging', '/messaging', 51, '<SimulatedMessaging />'),
  route('op:pages/SimulationClock', '/clock', 52, '<SimulationClock />'),
  route('op:pages/LendingProducts', '/lending', 53, '<LendingProducts />'),
  route('op:pages/AdminUsers', '/admin', 54, '<AdminUsers />'),
  route('op:pages/NotFound', '*', 55, '<NotFound />'),

  // ---- Navigation -----------------------------------------------------------
  nav('op:pages/OpsDashboard', 'Dashboard', 21, "to: '/'"),
  nav('op:pages/RequestQueues', 'Request queues', 22, "to: '/queues'"),
  nav('op:pages/SimulatedMessaging', 'Simulated messaging', 23, "to: '/messaging'"),
  nav('op:pages/SimulationClock', 'Simulation clock', 25, "to: '/clock'"),
  nav('op:pages/LendingProducts', 'Lending', 27, "to: '/lending'"),
  nav('op:pages/AdminUsers', 'Create demo user (admins only)', 28, 'adminOnly: true', {
    summary: 'The link is filtered out of the navigation unless the signed-in user’s role is `admin`.',
    tags: ['rbac'],
  }),
  rel('op:pages/OpsDashboard', 'op:pages/RequestQueues', 'navigates', {
    label: 'Open queues →',
    summary: 'The “Open queues” link and each “Needs attention” row link to the queues page (without pre-selecting the request).',
    sources: [ops('pages/OpsDashboard.tsx', 100, 102, 'to="/queues"'), ops('pages/OpsDashboard.tsx', 123, 130, 'to="/queues"')],
  }),
  rel('op:pages/OpsDashboard', 'op:pages/SimulatedMessaging', 'navigates', {
    label: 'Simulated messaging →',
    sources: [ops('pages/OpsDashboard.tsx', 150, 152, 'to="/messaging"')],
  }),
  rel('op:pages/Login', 'op:pages/OpsDashboard', 'navigates', {
    label: 'staff sign-in succeeds',
    summary: 'No router navigation happens: the auth state changes and the app gate renders the console at the current URL (normally `/`).',
    confidence: 'simplified',
    sources: [ops('pages/Login.tsx', 76, 77, 'App swaps to the')],
  }),

  // ---- Dashboard ------------------------------------------------------------
  rel('op:pages/OpsDashboard', 'op:lib/useOpsSummary', 'calls', {
    label: 'useOpsSummary()',
    summary: 'One-off platform counts.',
    sources: [ops('pages/OpsDashboard.tsx', 46, 48, 'useOpsSummary()')],
    order: 1,
  }),
  rel('op:pages/OpsDashboard', 'op:lib/ops-data-context#useOpsData', 'calls', {
    label: 'useOpsData() → requests, counts, events, connected',
    summary: 'Live queue snapshot and event feed.',
    sources: [ops('pages/OpsDashboard.tsx', 46, 51, 'useOpsData()')],
    order: 2,
  }),
  rel('op:pages/OpsDashboard', 'op:components/OpsActivityFeed', 'renders', {
    label: '<OpsActivityFeed events limit={6} />',
    sources: [ops('pages/OpsDashboard.tsx', 154, 156, 'OpsActivityFeed')],
  }),
  rel('op:pages/OpsDashboard', 'op:components/badges', 'renders', {
    label: 'PriorityBadge, StatusBadge, ReversedBadge',
    sources: [ops('pages/OpsDashboard.tsx', 131, 135, 'ReversedBadge')],
    detail: 5,
  }),
  rel('op:pages/OpsDashboard', 'sh:operations#isTerminalOpsStatus', 'calls', {
    label: '!isTerminalOpsStatus(r.status)',
    summary: '“Open” means not yet approved or rejected.',
    sources: [ops('pages/OpsDashboard.tsx', 50, 51, 'isTerminalOpsStatus')],
  }),

  // ---- Request queues -------------------------------------------------------
  rel('op:pages/RequestQueues', 'op:lib/ops-data-context#useOpsData', 'calls', {
    label: 'useOpsData() → requests, counts, loading, error, connected, act',
    sources: [ops('pages/RequestQueues.tsx', 43, 44, 'useOpsData()')],
  }),
  rel('op:pages/RequestQueues', 'op:components/QueueRequestCard', 'renders', {
    label: 'filtered.map(request => <QueueRequestCard …/>)',
    sources: [ops('pages/RequestQueues.tsx', 137, 146, 'QueueRequestCard')],
    order: 1,
  }),
  rel('op:pages/RequestQueues', 'op:components/RequestDetailPanel', 'renders', {
    label: '<RequestDetailPanel requestId={selectedId} />',
    summary: 'Shown for the selected card.',
    sources: [ops('pages/RequestQueues.tsx', 150, 153, 'RequestDetailPanel')],
    order: 2,
  }),
  rel('op:pages/RequestQueues#runAction', 'op:lib/OpsDataContext#act', 'calls', {
    label: 'await act(id, action)',
    summary: 'Quick decision from a queue card (no note).',
    sources: [ops('pages/RequestQueues.tsx', 59, 73, 'await act(id, action)')],
  }),
  rel('op:pages/RequestQueues', 'sh:operations#OPS_QUEUES', 'uses-type', {
    label: 'OPS_QUEUES / queueForType',
    summary: 'Lane filter definitions come from the shared library.',
    sources: [ops('pages/RequestQueues.tsx', 51, 57, 'queueForType(r.type)')],
  }),
  rel('op:pages/RequestQueues', 'sh:types#OPS_REQUEST_STATUSES', 'uses-type', {
    label: 'OPS_REQUEST_STATUSES',
    sources: [ops('pages/RequestQueues.tsx', 104, 112, 'OPS_REQUEST_STATUSES.map')],
    detail: 5,
  }),
  rel('op:components/QueueRequestCard', 'op:components/ActionBar', 'renders', {
    label: '<ActionBar status busy onAction />',
    sources: [ops('components/QueueRequestCard.tsx', 61, 61, 'ActionBar')],
  }),
  rel('op:components/QueueRequestCard', 'op:components/badges', 'renders', {
    label: 'StatusBadge, ReversedBadge, PriorityBadge',
    sources: [ops('components/QueueRequestCard.tsx', 54, 58, 'StatusBadge')],
    detail: 5,
  }),
  rel('op:components/QueueRequestCard', 'sh:operations#OperationsRequestDTO', 'uses-type', {
    label: 'request: OperationsRequestDTO',
    sources: [ops('components/QueueRequestCard.tsx', 18, 30, 'OperationsRequestDTO')],
  }),
  rel('op:components/ActionBar', 'sh:operations#OPS_ACTIONS', 'uses-type', {
    label: 'OPS_ACTIONS.map',
    summary: 'The button set is the shared list of decision actions.',
    sources: [ops('components/ActionBar.tsx', 35, 48, 'OPS_ACTIONS.map')],
  }),
  rel('op:components/ActionBar', 'sh:operations#isTerminalOpsStatus', 'calls', {
    label: 'isTerminalOpsStatus(status)',
    summary: 'Resolved requests cannot be decided again.',
    sources: [ops('components/ActionBar.tsx', 35, 35, 'isTerminalOpsStatus(status)')],
  }),
  rel('op:components/ActionBar', 'op:components/ui/Button', 'renders', {
    label: '<Button variant={ACTION_VARIANT[action]} />',
    sources: [ops('components/ActionBar.tsx', 38, 47, '<Button')],
    detail: 5,
  }),

  // ---- Request detail panel -------------------------------------------------
  rel('op:components/RequestDetailPanel', 'op:lib/opsApi#fetchOpsRequestDetail', 'calls', {
    label: 'fetchOpsRequestDetail(requestId)',
    summary: 'Loads history + linked events on open and whenever the live copy’s `updatedAt` moves on.',
    sources: [ops('components/RequestDetailPanel.tsx', 119, 133, 'fetchOpsRequestDetail(requestId)')],
    order: 1,
  }),
  rel('op:components/RequestDetailPanel', 'op:lib/ops-data-context#useOpsData', 'calls', {
    label: 'useOpsData() → act, reverse, requests',
    sources: [ops('components/RequestDetailPanel.tsx', 91, 91, 'useOpsData()')],
    order: 2,
  }),
  rel('op:components/RequestDetailPanel#handleAction', 'op:lib/OpsDataContext#act', 'calls', {
    label: 'await act(requestId, action, note.trim() || undefined)',
    summary: 'Decision with an optional note.',
    sources: [ops('components/RequestDetailPanel.tsx', 147, 162, 'await act(requestId, action, note.trim() || undefined)')],
  }),
  rel('op:components/RequestDetailPanel#handleAddNote', 'op:lib/OpsDataContext#act', 'calls', {
    label: "await act(requestId, 'note', text)",
    summary: 'Audit note without a status change.',
    sources: [ops('components/RequestDetailPanel.tsx', 166, 180, "await act(requestId, 'note', text)")],
  }),
  rel('op:components/RequestDetailPanel#handleReverse', 'op:lib/OpsDataContext#reverse', 'calls', {
    label: 'await reverse(requestId, reason)',
    summary: 'Post-decision reversal of a posted movement.',
    sources: [ops('components/RequestDetailPanel.tsx', 185, 199, 'await reverse(requestId, reason)')],
  }),
  rel('op:components/RequestDetailPanel', 'op:components/ActionBar', 'renders', {
    label: '<ActionBar status={liveStatus} size="md" onAction={handleAction} />',
    sources: [ops('components/RequestDetailPanel.tsx', 449, 449, 'ActionBar')],
  }),
  rel('op:components/RequestDetailPanel', 'op:components/OpsActivityFeed', 'renders', {
    label: '<OpsActivityFeed events={detail.events} />',
    summary: 'Simulated events linked to this request.',
    sources: [ops('components/RequestDetailPanel.tsx', 523, 533, 'OpsActivityFeed')],
  }),
  rel('op:components/RequestDetailPanel', 'op:components/badges', 'renders', {
    label: 'StatusBadge, ReversedBadge, PriorityBadge',
    sources: [ops('components/RequestDetailPanel.tsx', 231, 235, 'StatusBadge')],
    detail: 5,
  }),
  rel('op:components/RequestDetailPanel', 'sh:operations#OperationsRequestDetailDTO', 'uses-type', {
    label: 'OperationsRequestDetailDTO',
    sources: [ops('components/RequestDetailPanel.tsx', 91, 93, 'OperationsRequestDetailDTO')],
  }),
  rel('op:components/RequestDetailPanel', 'sh:money-movement#MovementPayload', 'uses-type', {
    label: 'asMovementPayload(livePayload)',
    summary: 'Money-movement context and the reverse affordance read the typed payload.',
    sources: [ops('components/RequestDetailPanel.tsx', 103, 107, 'asMovementPayload(livePayload)')],
  }),
  rel('op:components/RequestDetailPanel', 'sh:risk#FraudPayload', 'uses-type', {
    label: 'asFraudPayload(livePayload)',
    sources: [ops('components/RequestDetailPanel.tsx', 109, 113, 'asFraudPayload(livePayload)')],
  }),
  rel('op:components/RequestDetailPanel', 'sh:risk#DisputePayload', 'uses-type', {
    label: 'asDisputePayload(livePayload)',
    sources: [ops('components/RequestDetailPanel.tsx', 109, 113, 'asDisputePayload(livePayload)')],
  }),
  rel('op:components/RequestDetailPanel', 'sh:operations#isRequestReversed', 'calls', {
    label: 'isRequestReversed(livePayload)',
    sources: [ops('components/RequestDetailPanel.tsx', 115, 117, 'isRequestReversed(livePayload)')],
    detail: 5,
  }),

  // ---- Simulated messaging --------------------------------------------------
  rel('op:pages/SimulatedMessaging', 'op:lib/ops-data-context#useOpsData', 'calls', {
    label: 'useOpsData() → events, simulate',
    sources: [ops('pages/SimulatedMessaging.tsx', 25, 26, 'useOpsData()')],
  }),
  rel('op:pages/SimulatedMessaging#send', 'op:lib/OpsDataContext#simulate', 'calls', {
    label: 'await simulate({ channel, kind, outcome, summary })',
    sources: [ops('pages/SimulatedMessaging.tsx', 30, 47, 'await simulate({')],
  }),
  rel('op:pages/SimulatedMessaging#send', 'sh:operations#SimulateEventRequest', 'uses-type', {
    label: 'SimulateEventRequest',
    confidence: 'inferred',
    summary: 'The object passed to `simulate` is typed by the context as `SimulateEventRequest`.',
    sources: [ops('pages/SimulatedMessaging.tsx', 36, 41, 'summary:')],
  }),
  rel('op:pages/SimulatedMessaging', 'op:components/OpsActivityFeed', 'renders', {
    label: '<OpsActivityFeed events={events} />',
    sources: [ops('pages/SimulatedMessaging.tsx', 94, 101, 'OpsActivityFeed')],
  }),
  rel('op:components/OpsActivityFeed', 'op:components/badges', 'renders', {
    label: 'ChannelBadge, EventStatusBadge',
    sources: [ops('components/OpsActivityFeed.tsx', 29, 32, 'ChannelBadge')],
    detail: 5,
  }),
  rel('op:components/OpsActivityFeed', 'sh:operations#SimulatedEventDTO', 'uses-type', {
    label: 'events: SimulatedEventDTO[]',
    sources: [ops('components/OpsActivityFeed.tsx', 9, 17, 'SimulatedEventDTO')],
  }),

  // ---- Simulation clock -----------------------------------------------------
  rel('op:pages/SimulationClock', 'op:lib/ops-data-context#useOpsData', 'calls', {
    label: 'useOpsData() → simulationTime, refresh',
    summary: 'The heartbeat-driven simulated time, mirrored locally.',
    sources: [ops('pages/SimulationClock.tsx', 110, 120, 'useOpsData()')],
    order: 1,
  }),
  rel('op:pages/SimulationClock', 'op:lib/opsApi#fetchClock', 'calls', {
    label: 'fetchClock()',
    summary: 'Fallback when the context has no time yet.',
    sources: [ops('pages/SimulationClock.tsx', 124, 137, 'fetchClock()')],
    order: 2,
  }),
  rel('op:pages/SimulationClock', 'op:lib/opsApi#fetchSchedules', 'calls', {
    label: 'fetchSchedules()',
    summary: 'On mount, on Refresh, and after every advance.',
    sources: [ops('pages/SimulationClock.tsx', 155, 172, 'fetchSchedules()')],
    order: 3,
  }),
  rel('op:pages/SimulationClock#runAdvance', 'sh:clock#validateAdvance', 'validates', {
    label: 'validateAdvance(body)',
    summary: 'Client-side check with the same validator the server uses; an invalid amount never leaves the browser.',
    sources: [ops('pages/SimulationClock.tsx', 179, 185, 'validateAdvance(body)')],
    order: 1,
  }),
  rel('op:pages/SimulationClock#runAdvance', 'op:lib/opsApi#advanceClock', 'calls', {
    label: 'await advanceClock(body)',
    sources: [ops('pages/SimulationClock.tsx', 186, 192, 'await advanceClock(body)')],
    order: 2,
  }),
  rel('op:pages/SimulationClock#runAdvance', 'op:lib/OpsDataContext#refresh', 'calls', {
    label: 'await Promise.all([refresh(), loadSchedules()])',
    summary: 'Pulls reviews queued by fired bill-pay schedules into the live queue.',
    sources: [ops('pages/SimulationClock.tsx', 193, 194, 'refresh()')],
    order: 3,
  }),
  rel('op:pages/SimulationClock#PRESETS', 'sh:clock#AdvanceClockRequest', 'uses-type', {
    label: 'body: AdvanceClockRequest',
    sources: [ops('pages/SimulationClock.tsx', 102, 108, 'AdvanceClockRequest')],
  }),
  rel('op:pages/SimulationClock', 'sh:schedules#ScheduleDTO', 'uses-type', {
    label: 'ScheduleDTO[] / ScheduleFireSummary[]',
    sources: [ops('pages/SimulationClock.tsx', 140, 153, 'ScheduleDTO[]')],
  }),
  rel('op:pages/SimulationClock', 'op:components/badges', 'renders', {
    label: 'ScheduleStatusBadge',
    sources: [ops('pages/SimulationClock.tsx', 447, 449, 'ScheduleStatusBadge')],
    detail: 5,
  }),

  // ---- Lending --------------------------------------------------------------
  rel('op:pages/LendingProducts', 'op:lib/opsApi#fetchLending', 'calls', {
    label: 'fetchLending()',
    summary: 'On mount and on Refresh.',
    sources: [ops('pages/LendingProducts.tsx', 61, 78, 'fetchLending()')],
  }),
  rel('op:pages/LendingProducts', 'sh:lending#LendingProductDTO', 'uses-type', {
    label: 'LendingProductDTO[]',
    sources: [ops('pages/LendingProducts.tsx', 56, 59, 'LendingProductDTO[]')],
  }),
  rel('op:pages/LendingProducts', 'op:components/badges', 'renders', {
    label: 'LendingStatusBadge',
    sources: [ops('pages/LendingProducts.tsx', 140, 142, 'LendingStatusBadge')],
    detail: 5,
  }),

  // ---- Admin users ----------------------------------------------------------
  rel('op:pages/AdminUsers', 'op:lib/auth-context#useAuth', 'calls', {
    label: "useAuth() → user?.role !== 'admin' → “Not authorized”",
    summary: 'In-page role check: a non-admin operator who types `/admin` sees a refusal, not the form.',
    sources: [ops('pages/AdminUsers.tsx', 73, 86, "user?.role !== 'admin'")],
    tags: ['rbac', 'security'],
  }),
  rel('op:pages/AdminUsers#handleSubmit', 'sh:onboarding#validateAdminCreateUser', 'validates', {
    label: 'validateAdminCreateUser(draft)',
    summary: 'Shared validator: funding above zero requires a product and a reason.',
    sources: [ops('pages/AdminUsers.tsx', 93, 106, 'validateAdminCreateUser(draft)')],
    order: 1,
  }),
  rel('op:pages/AdminUsers#handleSubmit', 'op:lib/adminApi#createAdminUser', 'calls', {
    label: 'await createAdminUser({ … })',
    sources: [ops('pages/AdminUsers.tsx', 108, 118, 'await createAdminUser({')],
    order: 2,
  }),
  rel('op:pages/AdminUsers', 'sh:onboarding#AdminCreateUserResponse', 'uses-type', {
    label: 'AdminCreateUserResponse',
    sources: [ops('pages/AdminUsers.tsx', 65, 68, 'AdminCreateUserResponse')],
  }),
  rel('op:pages/AdminUsers', 'op:components/RoleBadge', 'renders', {
    label: '<RoleBadge role={result.user.role} />',
    sources: [ops('pages/AdminUsers.tsx', 338, 341, 'RoleBadge')],
    detail: 5,
  }),

  // ---- Login ----------------------------------------------------------------
  rel('op:pages/Login#handleSubmit', 'op:lib/AuthContext#AuthProvider', 'calls', {
    label: 'await login(email, password) · await logout()',
    summary: 'Sign in through the auth context; sign a non-staff user back out.',
    sources: [ops('pages/Login.tsx', 64, 75, 'await login(email, password)')],
    order: 1,
  }),
  rel('op:pages/Login#handleSubmit', 'op:lib/auth-context#isOperatorRole', 'calls', {
    label: '!isOperatorRole(user.role) → logout + not_operator',
    summary: 'Valid credentials, wrong audience: the session is dropped and the sign-in is refused.',
    sources: [ops('pages/Login.tsx', 69, 75, 'isOperatorRole(user.role)')],
    tags: ['rbac', 'security'],
    order: 2,
  }),
  rel('op:pages/Login#handleSubmit', 'op:pages/Login#messageForCode', 'calls', {
    label: 'messageForCode(errorCode)',
    sources: [ops('pages/Login.tsx', 160, 167, 'messageForCode(errorCode)')],
    detail: 5,
  }),
  rel('op:pages/Login', 'op:components/SimulationBanner', 'renders', {
    label: '<SimulationBanner />',
    sources: [ops('pages/Login.tsx', 96, 98, 'SimulationBanner')],
    detail: 5,
  }),
  rel('op:pages/Login', 'op:components/PublicDemoNotice', 'renders', {
    label: '<PublicDemoNotice variant="form" />',
    summary: 'Shared-demo callout above the sign-in form (public-demo mode only).',
    sources: [ops('pages/Login.tsx', 123, 124, 'PublicDemoNotice')],
  }),
  rel('op:pages/Login', 'op:components/Logo', 'renders', {
    label: '<Logo />',
    sources: [ops('pages/Login.tsx', 101, 102, 'Logo')],
    detail: 5,
  }),

  // ---- Layout + banners -----------------------------------------------------
  rel('op:components/OpsLayout', 'op:lib/auth-context#useAuth', 'calls', {
    label: "useAuth() → isAdmin = user?.role === 'admin'",
    summary: 'Decides whether the admin-only navigation link is shown.',
    sources: [ops('components/OpsLayout.tsx', 145, 148, "user?.role === 'admin'")],
    tags: ['rbac'],
  }),
  rel('op:components/OpsLayout', 'op:lib/AuthContext#AuthProvider', 'calls', {
    label: 'await logout()',
    summary: 'The header’s Log out button.',
    sources: [ops('components/OpsLayout.tsx', 104, 119, 'await logout()')],
  }),
  rel('op:components/OpsLayout', 'op:lib/useApiStatus', 'calls', {
    label: 'useApiStatus()',
    summary: 'The “API online · v…” pill.',
    sources: [ops('components/OpsLayout.tsx', 87, 101, 'useApiStatus()')],
  }),
  rel('op:components/OpsLayout', 'op:components/SimulationBanner', 'renders', {
    label: '<SimulationBanner />',
    sources: [ops('components/OpsLayout.tsx', 160, 161, 'SimulationBanner')],
    detail: 5,
  }),
  rel('op:components/OpsLayout', 'op:components/RoleBadge', 'renders', {
    label: '<RoleBadge role={user.role} />',
    sources: [ops('components/OpsLayout.tsx', 127, 127, 'RoleBadge')],
    detail: 5,
  }),
  rel('op:components/OpsLayout', 'op:components/Logo', 'renders', {
    label: '<Logo />',
    sources: [ops('components/OpsLayout.tsx', 179, 179, 'Logo')],
    detail: 5,
  }),
  rel('op:components/SimulationBanner', 'op:components/PublicDemoNotice', 'renders', {
    label: '<PublicDemoNotice variant="banner" />',
    sources: [ops('components/SimulationBanner.tsx', 23, 24, 'PublicDemoNotice')],
  }),
  rel('op:components/PublicDemoNotice', 'op:lib/public-demo', 'calls', {
    label: 'usePublicDemo()',
    sources: [ops('components/PublicDemoNotice.tsx', 16, 18, 'usePublicDemo()')],
  }),
  rel('op:components/PublicDemoNotice', 'sh:public-demo#PUBLIC_DEMO_NOTICE', 'uses-type', {
    label: 'PUBLIC_DEMO_NOTICE',
    sources: [ops('components/PublicDemoNotice.tsx', 30, 34, 'PUBLIC_DEMO_NOTICE.operations')],
  }),

  // ---- Features -------------------------------------------------------------
  rel('op:pages/RequestQueues', 'feat:ops-review', 'implements', { label: 'work the queue', sources: [ops('pages/RequestQueues.tsx', 79, 84, 'Request queues')] }),
  rel('op:components/RequestDetailPanel', 'feat:ops-review', 'implements', { label: 'decide with a note; history', sources: [ops('components/RequestDetailPanel.tsx', 73, 83, 'Detail view for the selected queue item')] }),
  rel('op:components/RequestDetailPanel', 'feat:audit', 'implements', { label: 'shows the audit trail', sources: [ops('components/RequestDetailPanel.tsx', 506, 521, 'History')] }),
  rel('op:components/RequestDetailPanel#handleReverse', 'feat:external-movements', 'implements', { label: 'reverse a posted movement', sources: [ops('components/RequestDetailPanel.tsx', 182, 199, 'handleReverse')] }),
  rel('op:components/RequestDetailPanel', 'feat:fraud', 'implements', { label: 'operator fraud decision', sources: [ops('components/RequestDetailPanel.tsx', 330, 378, 'Fraud alert')] }),
  rel('op:components/RequestDetailPanel', 'feat:disputes', 'implements', { label: 'operator dispute decision', sources: [ops('components/RequestDetailPanel.tsx', 380, 428, 'Disputed transaction')] }),
  rel('op:components/RequestDetailPanel', 'feat:onboarding', 'implements', { label: 'application review context', sources: [ops('components/RequestDetailPanel.tsx', 254, 284, 'Application')] }),
  rel('op:pages/OpsDashboard', 'feat:realtime', 'implements', { label: 'live overview', sources: [ops('pages/OpsDashboard.tsx', 55, 74, 'Reconnecting')] }),
  rel('op:pages/SimulatedMessaging', 'feat:sim-messaging', 'implements', { label: 'generate simulated events', sources: [ops('pages/SimulatedMessaging.tsx', 50, 58, 'Simulated messaging')] }),
  rel('op:pages/SimulationClock', 'feat:clock', 'implements', { label: 'advance simulated time', sources: [ops('pages/SimulationClock.tsx', 259, 264, 'Fast-forward')] }),
  rel('op:pages/SimulationClock', 'feat:schedules', 'implements', { label: 'see what fired; list schedules', sources: [ops('pages/SimulationClock.tsx', 388, 393, 'Customer payment schedules')] }),
  rel('op:pages/SimulationClock', 'feat:interest', 'implements', { label: 'accrual summary', sources: [ops('pages/SimulationClock.tsx', 56, 63, 'function AccrualSummaryRow')] }),
  rel('op:pages/LendingProducts', 'feat:lending', 'implements', { label: 'operator view of CDs and loans', sources: [ops('pages/LendingProducts.tsx', 83, 90, 'Lending')] }),
  rel('op:pages/AdminUsers', 'feat:admin-users', 'implements', { label: 'create demo user', sources: [ops('pages/AdminUsers.tsx', 141, 151, 'Create demo user')] }),
  rel('op:pages/Login', 'feat:auth', 'implements', { label: 'operator sign-in', sources: [ops('pages/Login.tsx', 104, 110, 'Operator sign-in')] }),
  rel('op:App', 'feat:rbac', 'implements', { label: 'staff gate', sources: [ops('App.tsx', 34, 43, 'only ADMITS bank staff')] }),
  rel('op:pages/Login#messageForCode', 'feat:rate-limits', 'implements', { label: 'rate_limited message', sources: [ops('pages/Login.tsx', 44, 45, 'rate_limited')] }),

  // ---- Who uses what --------------------------------------------------------
  rel('role:ops_agent', 'op:pages/Login', 'actor-uses', { label: 'signs in', summary: 'Staff sign in here; customer credentials are refused.' }),
  rel('role:ops_agent', 'op:pages/OpsDashboard', 'actor-uses', { label: 'monitors', summary: 'Checks workload and recent activity.' }),
  rel('role:ops_agent', 'op:pages/RequestQueues', 'actor-uses', { label: 'reviews requests', summary: 'Approves, rejects, holds, asks for information, adds notes, reverses movements.' }),
  rel('role:ops_agent', 'op:pages/SimulatedMessaging', 'actor-uses', { label: 'simulates providers', summary: 'Plays the SMS, email, MFA and identity providers.' }),
  rel('role:ops_agent', 'op:pages/SimulationClock', 'actor-uses', { label: 'advances time', summary: 'Both staff roles may advance the clock.' }),
  rel('role:ops_agent', 'op:pages/LendingProducts', 'actor-uses', { label: 'views lending', summary: 'Read-only.' }),
  rel('role:admin', 'op:pages/AdminUsers', 'actor-uses', {
    label: 'creates demo users',
    summary: 'Admin only: hidden from the navigation, refused in the page and rejected by the backend for any other role.',
    sources: [ops('components/OpsLayout.tsx', 145, 148, 'adminOnly'), ops('pages/AdminUsers.tsx', 73, 76, "user?.role !== 'admin'")],
    tags: ['rbac'],
  }),
  rel('role:admin', 'op:pages/RequestQueues', 'actor-uses', { label: 'reviews requests', summary: 'An admin can do everything an operations agent can.', detail: 3 }),
  rel('role:admin', 'op:pages/OpsDashboard', 'actor-uses', { label: 'monitors', detail: 3 }),
  rel('role:admin', 'op:pages/SimulatedMessaging', 'actor-uses', { label: 'simulates providers', detail: 3 }),
  rel('role:admin', 'op:pages/SimulationClock', 'actor-uses', { label: 'advances time', detail: 3 }),
  rel('role:admin', 'op:pages/LendingProducts', 'actor-uses', { label: 'views lending', detail: 3 }),
  rel('role:admin', 'op:pages/Login', 'actor-uses', { label: 'signs in', detail: 3 }),

  // ---- End-to-end tests (the spec itself is owned by another slice) ---------
  rel('test:e2e/operations.spec.ts', 'op:pages/OpsDashboard', 'tests', {
    label: 'dashboard shows a live queue snapshot',
    summary: 'After operator sign-in the overview, “Needs attention”, recent events and the “Live” indicator are visible.',
    sources: [src(E2E_OPS, 18, 26, 'the dashboard shows a live queue snapshot')],
  }),
  rel('test:e2e/operations.spec.ts', 'op:pages/SimulatedMessaging', 'tests', {
    label: 'simulated event appears in the feed',
    sources: [src(E2E_OPS, 50, 64, 'a simulated external event appears live in the messaging feed')],
  }),
  rel('test:e2e/operations.spec.ts', 'op:lib/AuthContext#AuthProvider', 'tests', {
    label: 'rejected session → back to sign-in',
    summary: 'With every `/api/ops/**` call answering 401 `unauthenticated`, the console returns to the sign-in screen with the “session has ended” notice and recovers on the next sign-in.',
    sources: [src(E2E_OPS, 67, 103, 'an expired/rejected ops session returns the operator to sign-in')],
  }),
  rel('test:e2e/operations.spec.ts', 'op:lib/api#SURFACE_HEADERS', 'tests', {
    label: 'stays signed in when Origin is omitted',
    summary: 'Strips `Origin` from every API GET, as a same-origin browser does, and asserts an ops GET carried `x-meridian-surface: operations` and the session survived a reload.',
    sources: [src(E2E_OPS, 105, 153, 'stays signed in when the browser omits Origin on API GETs')],
  }),
  rel('test:e2e/operations.spec.ts', 'op:components/OpsLayout', 'tests', {
    label: 'mobile menu toggle',
    summary: 'At 600 px wide the sidebar is hidden; the menu button reveals the links and closes after navigating.',
    sources: [src(E2E_OPS, 155, 175, 'the menu toggle reveals navigation and can switch sections')],
  }),
];
