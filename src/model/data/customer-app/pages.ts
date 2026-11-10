import type { Entity, Relation } from '../../types';
import { cu, cuFile, rel, repo } from './helpers';

/** Pages of the customer app (`apps/customer/src/pages/*`), public and signed-in. */

const PORTAL_PATTERN =
  'Like every portal page it fetches its own data in a mount effect guarded by an `active` flag, keeps `{ loading, data }` per section where `data: null` means "the request failed", and renders distinct loading, offline ("The backend may be offline — start it with npm run dev") and empty states.';

export const pageEntities: Entity[] = [
  // =========================================================================
  // Signed-in pages (cu.portal)
  // =========================================================================
  {
    id: 'cu:pages/Dashboard',
    kind: 'page',
    name: 'Dashboard',
    parent: 'cu.portal',
    route: '/dashboard',
    order: 1,
    summary: 'The signed-in home: every account with its derived balances, a cash total, fraud alerts, joint-owner invitations, quick links and recent sign-in activity.',
    description:
      `${PORTAL_PATTERN}\n\nOn mount the page itself issues two requests in parallel — \`fetchAccounts()\` and \`fetchLoginHistory()\` — and two child sections issue their own: \`FraudAlertsSection\` calls \`listFraudAlerts()\` and \`InvitationsInbox\` calls \`fetchInvitations()\`. Four GETs, no waterfall.\n\nAccounts. \`groupAccounts\` splits the list into cash (checking, savings) and lending (CDs, loans). "Total available cash" sums \`balances.availableMinor\` over the cash group only, so a loan's negative balance cannot distort it. A cash card shows Available and Current, plus "Includes $X pending/held" when \`pendingDebitMinor + heldMinor > 0\`; a loan card shows "Balance owed" as a positive figure; a CD card shows "Value"; a savings card adds "Earns 1.50% APY (simulated)". Each card links to \`/accounts/<id>\`. Balances are displayed exactly as received — nothing is computed from transactions in the browser.\n\nSecurity alerts. Each pending alert offers "Confirm — it was me" (\`confirm_legit\`) and "Report fraud" (\`report_fraud\`). The response is recorded with \`respondToFraudAlert\`; on success the row collapses to the recorded outcome from local state. The section renders nothing while loading, when offline, or when there are no alerts.\n\nInvitations. Accept / Decline per invitation, with a per-row busy state. A resolved invitation is removed from the local list; on accept the page also re-runs \`fetchAccounts()\` so the newly shared account appears without a reload.\n\nQuick links go to Move money (with router state \`{ tab: "transfer" }\` or \`{ tab: "bill" }\`), Scheduled payments, Statements, Cards (\`/wallet\`) and Loans & CDs (\`/loans\`).\n\nRecent sign-in activity lists each \`LoginEventDTO\` with a success/failure dot, a sentence for the reason, the IP when present and the time.`,
    audience: {
      executive: 'The customer\'s home screen: balances at a glance, anything needing attention, and one click to every banking task.',
      'end-user': 'See all your accounts and balances, your total available cash, any security alerts or invitations waiting for you, shortcuts to transfers, bills, cards, loans and statements, and your recent sign-ins.',
      systems: 'Four parallel GETs on mount (accounts, login history, fraud alerts, invitations); no polling and no push — data is as fresh as the last page load.',
      dba: 'Displays balances the server derived from LedgerEntry rows; reads only, except recording a fraud-alert response or an invitation decision.',
    },
    tags: ['ui', 'money', 'risk', 'auth'],
    aliases: ['accounts overview', 'home', 'portal home', 'Dashboard.tsx'],
    tech: ['React'],
    sources: [
      cu('pages/Dashboard.tsx', 27, 33, 'Authenticated dashboard'),
      cu('pages/Dashboard.tsx', 522, 547, 'export function Dashboard', 'Page state + mount effect'),
      cu('pages/Dashboard.tsx', 176, 202, 'groupAccounts(state.data)', 'Cash total excludes loans and CDs'),
      cu('pages/Dashboard.tsx', 406, 439, 'function FraudAlertsSection', 'Fraud alerts: load + respond'),
      cu('pages/Dashboard.tsx', 290, 330, 'function InvitationsInbox', 'Invitations: load + accept/decline'),
      cu('pages/Dashboard.tsx', 574, 622, 'Quick links', 'Quick links'),
    ],
  },
  {
    id: 'cu:pages/AccountDetail',
    kind: 'page',
    name: 'Account detail',
    parent: 'cu.portal',
    route: '/accounts/:id',
    order: 2,
    summary: 'One account: its derived balances, its full transaction history with search, filters and disputes, and — for the owner — a form to invite a joint owner.',
    description:
      'The `:id` route parameter drives a single request, `fetchAccountTransactions(id)`, whose response contains both the account header and the transactions. The result is mapped to a five-state machine: `loading`, `ok` (status 200 with data), `forbidden` (403 → "No access to this account"), `notFound` (404 → "Account not found") and `offline` (anything else, including status 0). The effect re-runs when `id` changes.\n\nHeader. Available and Current balances, and a line for "Pending out", "On hold" and "Pending in … (not yet available)" when those derived amounts are non-zero. A "Move money" button appears when the account is `active` and the viewer\'s relationship is not `viewer`; it links to `/move-money` with router state `{ accountId }` so that page lists this account first.\n\nTransactions are rendered by `TransactionList`, which filters in the browser and hosts the dispute form.\n\nInvite a joint owner. Rendered only when `account.relationship === "owner"`. The form trims the email and calls `createInvitation(accountId, email)`; success shows "Invitation sent to …", failure shows the server\'s message. There is no client-side email validation here beyond the input type.\n\nThe page never calls `GET /api/accounts/:id`; the transactions endpoint supplies the header.',
    audience: {
      executive: 'Where a customer inspects one account: what is available, what is pending, and every transaction behind the balance.',
      'end-user': 'See one account\'s available and current balance, search and filter its transactions, dispute a posted charge, jump to Move money or Statements, and — if you own the account — invite someone as a joint owner.',
      systems: 'One GET per visit. 403 and 404 from the API are shown as distinct friendly states; any other failure is treated as offline.',
      dba: 'Shows LedgerEntry-derived rows (signed amount, running balance) for one account the caller has access to.',
    },
    tags: ['ui', 'money', 'ledger', 'rbac'],
    aliases: ['account page', 'transactions page', 'AccountDetail.tsx'],
    tech: ['React'],
    sources: [
      cu('pages/AccountDetail.tsx', 13, 25, 'One account in detail', 'Doc comment + LoadState'),
      cu('pages/AccountDetail.tsx', 205, 222, 'export function AccountDetail', 'Load effect and status mapping'),
      cu('pages/AccountDetail.tsx', 38, 59, 'canMoveMoney', 'Header + Move money deep link'),
      cu('pages/AccountDetail.tsx', 117, 144, 'function InviteJointOwner', 'Owner-only invite form'),
      cu('pages/AccountDetail.tsx', 262, 287, "relationship === 'owner'", 'Composition of the ok state'),
    ],
  },
  {
    id: 'cu:pages/MoveMoney',
    kind: 'page',
    name: 'Move money',
    parent: 'cu.portal',
    route: '/move-money',
    order: 3,
    summary: 'One tabbed page for four flows: an instant transfer between your own accounts, a check deposit, an external ACH or wire, and a bill payment.',
    description:
      'The page loads the account list once (`fetchAccounts()`), keeps only accounts that can move money (`status === "active"` and relationship not `viewer`) and hands them to whichever tab is selected. The initial tab comes from router state (`{ tab }`, set by the dashboard quick links) or a `?tab=` query, defaulting to Transfer; an `accountId` in router state (from Account detail) moves that account to the top of the selectors.\n\nEvery flow\'s submit handler has the same five steps:\n\n1. Ignore the click if a submission is already in flight; clear the banner.\n2. Convert the typed dollars to integer minor units with the shared `toMinor` (an empty or non-numeric value becomes `NaN`).\n3. Run the SAME shared validator the server runs — `validateTransfer` for a transfer, `validateExternalMovement` for the other three. If it fails, show the per-field messages under the inputs and stop: no request is sent.\n4. Call the API client with the validator\'s normalised value (`check.value`), not the raw form state.\n5. On `ok`, replace the form with a confirmation panel. Otherwise overlay the server\'s `fields` onto the inputs and show `message` in a banner; the form stays filled in.\n\nTransfer → `createTransfer`. Needs at least two movable accounts; each selector excludes the account chosen in the other. The confirmation ("Transfer complete") lists the two affected accounts with their new available balances taken from the response, so no re-fetch is needed. The page\'s own account list is not refreshed, so the amounts in the selectors are stale until the page is revisited.\n\nDeposit a check → `createMovement` with `kind: "mobile_check_deposit"`. Send money → `createMovement` with `kind` `external_ach` (direction chosen by the customer: "Send out" / "Bring in") or `wire` (always outbound, so no direction is sent). Pay a bill → `createMovement` with `kind: "bill_pay"` and the biller as `counterparty`. All three end in "Submitted for review" with the `MOV-…` reference and the explanation that an operator must approve it before the balance changes.\n\nInputs carry HTML limits ($0.01–$50,000, memo 140, counterparty 80) but the forms are `noValidate`; the shared validators are the real check.',
    audience: {
      executive: 'The screen where customers move money. Transfers between their own accounts are instant; anything leaving or entering the bank waits for staff approval.',
      'end-user': 'Transfer between your accounts instantly, deposit a check, send or bring in money by ACH, send a wire, or pay a bill. Deposits, external transfers and bill payments show as Pending until the bank approves them.',
      systems: 'One GET on mount; each submission is a single POST (`/api/transfers` or `/api/movements`) carrying the session cookie and CSRF header. Validation runs twice with the same shared code: before the request and again on the server.',
      dba: 'A transfer results in two posted LedgerEntry rows written by the server; an external movement results in pending rows plus an OperationsRequest. The page itself only reads AccountSummary data.',
    },
    tags: ['ui', 'money', 'validation', 'operations'],
    aliases: ['transfer page', 'payments', 'deposit', 'send money', 'pay a bill', 'MoveMoney.tsx'],
    tech: ['React'],
    sources: [
      cu('pages/MoveMoney.tsx', 24, 41, 'the customer money-movement surface', 'Doc comment: four flows and their endpoints'),
      cu('pages/MoveMoney.tsx', 904, 927, 'export function MoveMoney', 'Initial tab, account load, pre-selected account'),
      cu('pages/MoveMoney.tsx', 383, 409, 'await createTransfer(check.value)', 'TransferFlow.handleSubmit — the transfer submit handler'),
      cu('pages/MoveMoney.tsx', 500, 526, "kind: 'mobile_check_deposit'", 'DepositFlow.handleSubmit'),
      cu('pages/MoveMoney.tsx', 606, 636, 'direction: directionChoosable ? direction : undefined', 'SendFlow.handleSubmit (ACH / wire)'),
      cu('pages/MoveMoney.tsx', 776, 803, "kind: 'bill_pay'", 'BillPayFlow.handleSubmit'),
      cu('pages/MoveMoney.tsx', 258, 280, 'function parseAmountMinor', 'Dollars → minor units; server fields overlay'),
      cu('pages/MoveMoney.tsx', 300, 359, 'Transfer complete', 'The two confirmation panels'),
      cu('pages/MoveMoney.tsx', 70, 73, 'function movableAccounts', 'Which accounts can move money'),
    ],
  },
  {
    id: 'cu:pages/Wallet',
    kind: 'page',
    name: 'Wallet (cards)',
    parent: 'cu.portal',
    route: '/wallet',
    order: 4,
    summary: 'The card manager: list your simulated cards, freeze or unfreeze one, report it lost or stolen for a replacement, manage travel notices, and issue a new card.',
    description:
      `${PORTAL_PATTERN}\n\nOn mount it calls \`listCards()\` and \`fetchAccounts()\` in parallel; accounts (active, not view-only) only feed the "Issue a card" selector. Cards are sorted with in-service cards first and terminal ones (lost, stolen, replaced, cancelled) after, dimmed.\n\nWhich buttons a card shows is decided by the shared helpers the server also uses: \`canFreezeCard\`, \`canUnfreezeCard\`, \`canAddTravelNotice\`, \`canReportCard\`, and nothing at all when \`isTerminalCardStatus\`.\n\nActions and how the list is updated — always from the card(s) in the response, never by re-fetching:\n- Freeze / Unfreeze → \`freezeCard\` / \`unfreezeCard\`; the returned card replaces the old one (\`upsertCard\`).\n- Add travel notice → shared \`validateTravelNotice\` first, then \`addTravelNotice\`; the returned card (with notices) replaces the old one. Cancel → \`cancelTravelNotice\`.\n- Report lost / stolen → shared \`validateReportCard\`, then \`reportCard\`; \`applyReplacement\` swaps in the now-terminal old card and prepends the replacement.\n- Issue a card → a local "choose an account" check plus shared \`validateIssueCard\`, then \`issueCard\`; the new card is prepended.\n\nErrors from an action appear in an alert on that card; field errors go under the form inputs. None of these actions moves money.`,
    audience: {
      executive: 'Self-service card controls: lock a card, replace a lost one, tell the bank about travel.',
      'end-user': 'See your cards, freeze or unfreeze one, report a card lost or stolen and get a replacement, add or cancel a travel notice, and issue a new debit or credit card on one of your accounts.',
      systems: 'Two GETs on mount; each action is one POST with cookie + CSRF header. No ledger effect.',
      dba: 'Leads the server to insert or update Card and CardTravelNotice rows; never touches LedgerEntry.',
    },
    tags: ['ui', 'cards', 'validation'],
    aliases: ['cards manager', 'my cards', 'freeze card', 'Wallet.tsx'],
    tech: ['React'],
    sources: [
      cu('pages/Wallet.tsx', 44, 57, 'Cards manager', 'Doc comment'),
      cu('pages/Wallet.tsx', 659, 711, 'export function Wallet', 'Load effect, list update helpers, sort'),
      cu('pages/Wallet.tsx', 390, 401, 'async function toggleFreeze', 'Freeze / unfreeze handler'),
      cu('pages/Wallet.tsx', 167, 189, 'await addTravelNotice(cardId, check.value)', 'Travel notice submit'),
      cu('pages/Wallet.tsx', 319, 337, 'await reportCard(cardId, check.value)', 'Report lost/stolen submit'),
      cu('pages/Wallet.tsx', 542, 566, 'await issueCard(accountId, check.value)', 'Issue card submit'),
      cu('pages/Wallet.tsx', 435, 480, 'canFreezeCard(card.status)', 'Buttons gated by the shared can* helpers'),
    ],
  },
  {
    id: 'cu:pages/Lending',
    kind: 'page',
    name: 'Loans & CDs',
    parent: 'cu.portal',
    route: '/loans',
    order: 5,
    summary: 'The lending portal: list your CDs and loans, open a new CD or loan with a live projection, make a loan payment, and withdraw a matured CD.',
    description:
      `${PORTAL_PATTERN}\n\nOn mount it issues three GETs in parallel: \`fetchAccounts()\`, \`fetchClock()\` and \`listLending()\`. Only active, non-view-only checking and savings accounts are offered as funding / disbursement / payment accounts (\`fundingAccounts\`).\n\nList. Each product shows its kind, APY, account name, status badge, principal, term, maturity date and — using the simulated "now" from the clock and the shared \`daysBetween\` — "matures in N days" / "matured N days ago". A loan shows "You owe" (or "Paid off"); a CD shows "CD value". "Make a payment" appears for an active loan with an outstanding balance; "Withdraw CD" appears when the shared \`isCdWithdrawable\` says so.\n\nForms, each validated with the shared validator before any request:\n- Open a CD → \`validateOpenCd\` → \`openCd\`. While typing, the page shows the projected value at maturity using the shared \`cdApyForTerm\` and \`projectCdMaturityMinor\`.\n- Open a loan → \`validateOpenLoan\` → \`openLoan\`, with a live monthly payment from \`loanApyForTerm\` and \`amortizedPaymentMinor\`.\n- Make a payment → \`validateLoanPayment\` → \`payLoan\`. "Monthly payment" mode sends \`amountMinor: null\` and lets the server resolve the scheduled amount; "Custom amount" sends the parsed figure.\n- Withdraw CD → \`validateWithdrawCd\` → \`withdrawCd\`.\n\nAfter a success the product list is updated from the response (\`handleOpened\` prepends, \`handleUpdated\` replaces by id), the server\'s message is shown in a status banner, and — because these actions move money — \`fetchAccounts()\` is called again so the "available" amounts in the selectors are current. This is the only page that re-fetches accounts after a mutation.\n\nThe previews use the same shared maths as the server but are estimates shown before submission; the figures that count are the ones in the response.`,
    audience: {
      executive: 'Where customers open savings certificates and loans, repay them, and cash out a matured CD.',
      'end-user': 'See your loans and CDs with what you owe or what they are worth, open a new CD or loan (with a preview of the payment or maturity value), make a loan payment, and withdraw a CD once it matures.',
      systems: 'Three GETs on mount; one POST per action followed by a GET /api/accounts refresh. Interest only changes when staff advance the simulation clock, and this page does not notice that until reloaded.',
      dba: 'Leads the server to write LendingProduct rows and paired LedgerEntry transfer legs; the page displays derived figures only.',
    },
    tags: ['ui', 'lending', 'money', 'validation', 'time'],
    aliases: ['lending portal', 'loans', 'CDs', 'certificates of deposit', 'Lending.tsx'],
    tech: ['React'],
    sources: [
      cu('pages/Lending.tsx', 35, 58, 'the authenticated lending portal', 'Doc comment'),
      cu('pages/Lending.tsx', 929, 976, 'export function Lending', 'Load effect; handleOpened / handleUpdated re-fetch accounts'),
      cu('pages/Lending.tsx', 287, 312, 'await openCd(check.value)', 'OpenCdForm.handleSubmit'),
      cu('pages/Lending.tsx', 410, 435, 'await openLoan(check.value)', 'OpenLoanForm.handleSubmit'),
      cu('pages/Lending.tsx', 554, 580, 'await payLoan(product.id, check.value)', 'LoanPaymentForm.handleSubmit'),
      cu('pages/Lending.tsx', 667, 687, 'await withdrawCd(product.id, check.value)', 'WithdrawCdForm.handleSubmit'),
      cu('pages/Lending.tsx', 738, 742, 'isCdWithdrawable(product)', 'When pay / withdraw are offered'),
      cu('pages/Lending.tsx', 68, 76, 'function fundingAccounts', 'Which accounts can fund or receive'),
    ],
  },
  {
    id: 'cu:pages/ScheduledPayments',
    kind: 'page',
    name: 'Scheduled payments',
    parent: 'cu.portal',
    route: '/scheduled-payments',
    order: 6,
    summary: 'Set up one-off, weekly or monthly transfers and bill payments, see them with their next run date, and cancel the active ones.',
    description:
      `${PORTAL_PATTERN}\n\nOn mount it issues three GETs in parallel: \`fetchAccounts()\`, \`fetchClock()\` and \`fetchSchedules()\`. A panel at the top shows the current simulated date and explains that schedules fire only when an operator advances the simulation clock past their due date — there is no real-world timer.\n\nCreate. A toggle picks "Transfer between your accounts" (\`internal_transfer\`, needs two movable accounts) or "Pay a bill" (\`bill_pay\`, needs one account and a biller). Shared fields: amount, frequency (from the shared \`SCHEDULE_FREQUENCIES\`: once, weekly, monthly), "First run in (days)" (0–365, default 0) and a memo. On submit the handler converts dollars with \`toMinor\`, runs the shared \`validateCreateSchedule\`, and only then calls \`createSchedule(check.value)\`. On success the form resets, the returned schedule is prepended to the list and the server\'s message is shown; on failure the server\'s \`fields\` and message are displayed. Creating a schedule moves no money.\n\nList. Each schedule shows kind, frequency, "from → to" or "from → biller", amount, status badge, next run (active only), last run and run count. "Cancel schedule" is shown while the shared \`isActiveSchedule\` is true; it calls \`cancelSchedule(id)\` and replaces the row with the returned schedule. A 409 from the server (already inactive) appears as an inline error on that row.\n\nThe list is a snapshot: run counts and next-run dates change when staff advance the clock, and the page shows that only after a reload.`,
    audience: {
      executive: 'Recurring and future-dated payments that the bank runs for the customer as simulated time passes.',
      'end-user': 'Schedule a one-time, weekly or monthly transfer or bill payment, see when each will run next and how often it has run, and cancel one you no longer want.',
      systems: 'Three GETs on mount; create and cancel are single POSTs. Execution is server-side and driven by the simulation clock, not by this page.',
      dba: 'Leads the server to insert or update PaymentSchedule rows; ledger rows appear only when a schedule fires.',
    },
    tags: ['ui', 'time', 'money', 'validation'],
    aliases: ['recurring payments', 'schedules', 'ScheduledPayments.tsx'],
    tech: ['React'],
    sources: [
      cu('pages/ScheduledPayments.tsx', 27, 46, 'the customer recurring/scheduled-payment surface', 'Doc comment'),
      cu('pages/ScheduledPayments.tsx', 730, 770, 'export function ScheduledPayments', 'Load effect; handleCreated / handleCancelled'),
      cu('pages/ScheduledPayments.tsx', 327, 362, 'await createSchedule(check.value)', 'CreateScheduleForm.handleSubmit'),
      cu('pages/ScheduledPayments.tsx', 577, 592, 'await cancelSchedule(schedule.id)', 'ScheduleItem.cancel'),
      cu('pages/ScheduledPayments.tsx', 709, 726, 'function SimulatedClockPanel', 'Simulated date panel'),
    ],
  },
  {
    id: 'cu:pages/Statements',
    kind: 'page',
    name: 'Statements',
    parent: 'cu.portal',
    route: '/statements',
    order: 7,
    summary: 'Pick an account and see its monthly statement periods: opening balance, credits, debits, closing balance and entry count.',
    description:
      `${PORTAL_PATTERN}\n\nTwo effects. The first loads the accounts and selects the first one. The second runs whenever the selected account changes and calls \`fetchAccountStatements(selectedId)\`, keeping the error \`code\` on failure so the view can distinguish \`forbidden\` / \`not_found\` ("Statements unavailable for this account") from an offline backend (red card).\n\nThe table shows one row per period from the response — label (e.g. "September 2026"), opening, credits, debits, closing and the count of settled entries — all formatted with the shared \`formatMinor\`, under an "As of <simulated time>" caption. Periods are derived by the server over the posted ledger as of the simulation clock; the page computes nothing, stores nothing, and there is no PDF or download.`,
    audience: {
      executive: 'Monthly account statements, generated on demand from the same records that produce the balances.',
      'end-user': 'Choose one of your accounts and see a month-by-month summary: what you started with, money in, money out and what you ended with. There is nothing to download.',
      systems: 'GET /api/accounts on mount, then GET /api/accounts/:id/statements each time the account selection changes.',
      dba: 'Read-only: periods are aggregates over posted LedgerEntry rows, computed per request as of the simulation clock.',
    },
    tags: ['ui', 'money', 'data', 'time'],
    aliases: ['monthly statements', 'documents', 'Statements.tsx'],
    tech: ['React'],
    sources: [
      cu('pages/Statements.tsx', 15, 26, 'per-account statement view', 'Doc comment'),
      cu('pages/Statements.tsx', 181, 222, 'export function Statements', 'The two load effects'),
      cu('pages/Statements.tsx', 142, 177, "state.code === 'forbidden'", 'Loading / no access / offline'),
      cu('pages/Statements.tsx', 60, 82, 'function StatementRow', 'One period row'),
    ],
  },

  // =========================================================================
  // Public pages (cu.public)
  // =========================================================================
  {
    id: 'cu:pages/Login',
    kind: 'page',
    name: 'Log in',
    parent: 'cu.public',
    route: '/login',
    order: 1,
    summary: 'The customer sign-in form, with click-to-fill demo logins and an "already signed in" panel for visitors who are.',
    description:
      'Three renderings, chosen from `useAuth()`: a spinner while the session hydrates; an "You\'re already signed in" panel (link to the dashboard, and a Log out button that stays on `/login`) when a user exists; otherwise the form.\n\nSubmit handler. It ignores a second click while submitting, clears the previous error, and calls `login(email.trim(), password)` from the auth context — the page never calls `fetch` itself. On `ok` it navigates with `replace` to `redirectTo`: the `from` path that `RequireAuth` stored in router state, accepted only if it starts with `/` (an open-redirect guard), otherwise `/dashboard`. On failure it maps the result `code` to a sentence — `invalid_credentials`, `account_locked`, `account_disabled`, `invalid_request`, `rate_limited`, `network_error` — and shows it in a `role="alert"` paragraph; the password field keeps its value.\n\nThere is no client-side validation: the form is `noValidate`, so an empty submission reaches the server and comes back as `invalid_request` ("Please enter both your email and password.").\n\nBelow the form, two seeded demo customers (Avery Customer and Jordan Joint) are listed with their non-secret demo passwords; clicking one fills the fields. In public-demo mode the `PublicDemoNotice` form variant sits above the inputs. A note states that bank staff sign in to the separate Operations console, not here.',
    audience: {
      executive: 'The front door for customers.',
      'end-user': 'Sign in with your email and password, or click a demo login to fill them in. If you were sent here from a banking page you are taken back to it after signing in.',
      systems: 'Delegates to the auth context; the session cookie is set by the API response. Error codes from the API are mapped to user-facing text here.',
    },
    tags: ['ui', 'auth', 'security'],
    aliases: ['sign in', 'login page', 'Login.tsx'],
    tech: ['React'],
    sources: [
      cu('pages/Login.tsx', 9, 18, 'Simulated sign-in', 'Doc comment'),
      cu('pages/Login.tsx', 52, 80, 'export function Login', 'State, redirect target, submit handler'),
      cu('pages/Login.tsx', 63, 66, "fromState.startsWith('/')", 'Open-redirect guard on the return path'),
      cu('pages/Login.tsx', 32, 50, 'function messageForCode', 'Error code → message'),
      cu('pages/Login.tsx', 110, 145, 'already signed in', 'Already-signed-in panel'),
    ],
  },
  {
    id: 'cu:pages/OpenAccount',
    kind: 'page',
    name: 'Open an account',
    parent: 'cu.public',
    route: '/open-account',
    order: 2,
    summary: 'The public application form for a checking or savings account; submitting queues a request for a bank operator rather than creating anything.',
    description:
      'The left column explains the four steps (apply → operator review → funded on approval → start banking); the right column is the form: full name, email, a chosen password, product (checking / savings), opening deposit in dollars, an optional joint-owner email and a consent checkbox.\n\nSubmit handler. The deposit is parsed to integer cents with the shared `toMinor` (unparseable → `NaN`), then the whole form goes through the shared `validateOpenAccount` — the same validator the server runs. Failures are shown under the fields and nothing is sent. On success the handler posts the NORMALISED value (trimmed name, lower-cased email, cents) with `consent: true` via `submitApplication`. A server 400 can still return `fields` for things only the server knows, such as an email that is already registered; those are mapped back onto the inputs alongside a summary alert.\n\nOn success the form is replaced by a confirmation: the `MER-…` reference, the product, and "what happens next" — an operator reviews it; on approval the account is provisioned and any opening deposit posts; then the applicant signs in with the email and password they chose. Until then no user, account or money exists.\n\nThis is the one write a logged-out visitor can perform, so in public-demo mode the `PublicDemoNotice` form variant is placed above the first input.',
    audience: {
      executive: 'How a new customer applies. Nothing is created until bank staff approve the application.',
      'end-user': 'Apply for a checking or savings account: enter your name, email, a password and an optional opening deposit, optionally invite a joint owner, and get a reference number. You can sign in once the bank approves it.',
      systems: 'A public, unauthenticated POST to /api/onboarding/applications; shared-validator checks run client-side first and again on the server.',
      dba: 'Leads the server to insert an OnboardingApplication and an OperationsRequest; User, Account and LedgerEntry rows appear only on operator approval.',
    },
    tags: ['ui', 'onboarding', 'validation', 'public-demo'],
    aliases: ['application form', 'sign up', 'onboarding', 'OpenAccount.tsx'],
    tech: ['React'],
    sources: [
      cu('pages/OpenAccount.tsx', 21, 32, 'Open-account application', 'Doc comment'),
      cu('pages/OpenAccount.tsx', 158, 196, 'validateOpenAccount({', 'ApplicationForm.handleSubmit'),
      cu('pages/OpenAccount.tsx', 76, 139, 'function Confirmation', 'Confirmation panel'),
      cu('pages/OpenAccount.tsx', 407, 420, 'export function OpenAccount'),
    ],
  },
  {
    id: 'cu:pages/MarketingHome',
    kind: 'page',
    name: 'Marketing home',
    parent: 'cu.public',
    route: '/',
    order: 3,
    summary: 'The public landing page: hero, value propositions, product highlights linking to each product page, and a security section.',
    description: 'Static content apart from two things: the hero CTAs ("Open a (simulated) account", "Log in") collapse to "Visit your Dashboard" for a signed-in visitor, and the hero includes the `BackendStatusPill`, which makes this the only public page that triggers a visible `GET /status` indicator.',
    audience: { 'end-user': 'The home page: what Meridian offers, with links to each product, to open an account and to sign in.' },
    tags: ['ui', 'public'],
    aliases: ['home page', 'landing page', 'MarketingHome.tsx'],
    sources: [
      cu('pages/MarketingHome.tsx', 78, 110, 'export function MarketingHome'),
      cu('pages/MarketingHome.tsx', 47, 76, "to: '/checking'", 'Product highlights'),
    ],
  },
  {
    id: 'cu:pages/Checking',
    kind: 'page',
    name: 'Checking (product page)',
    parent: 'cu.public',
    route: '/checking',
    order: 4,
    summary: 'Marketing page for Everyday Checking: features, a simulated fee table and an FAQ.',
    description: 'Static. One FAQ answer still tells visitors that opening an account shows an "onboarding placeholder", which predates the working application form.',
    detail: 4,
    tags: ['ui', 'public'],
    sources: [
      cu('pages/Checking.tsx', 73, 89, 'export function Checking'),
      cu('pages/Checking.tsx', 66, 71, 'onboarding placeholder', 'Stale FAQ copy'),
    ],
  },
  {
    id: 'cu:pages/Savings',
    kind: 'page',
    name: 'Savings (product page)',
    parent: 'cu.public',
    route: '/savings',
    order: 5,
    summary: 'Marketing page for Goal Savings: features, a simulated rate table and an FAQ.',
    description: 'Static, and its rate is hard-coded: the table and FAQ say "3.75%" APY. The rest of the product uses the shared `DEFAULT_SAVINGS_APY_BPS` of 150 — the dashboard savings card and the Loans & CDs marketing page both show 1.50% — so this page disagrees with the rate the simulation actually accrues.',
    detail: 4,
    tags: ['ui', 'public'],
    sources: [
      cu('pages/Savings.tsx', 69, 85, 'export function Savings'),
      cu('pages/Savings.tsx', 47, 58, "value: '3.75%'", 'Hard-coded APY in the rate table and FAQ'),
      repo('packages/shared/src/lending.ts', 70, 70, 'DEFAULT_SAVINGS_APY_BPS = 150', 'The rate the product actually uses'),
    ],
  },
  {
    id: 'cu:pages/Cards',
    kind: 'page',
    name: 'Cards (product page)',
    parent: 'cu.public',
    route: '/cards',
    order: 6,
    summary: 'Marketing page describing the card features; signed-in visitors get a "Manage your cards" button to the wallet.',
    description: 'Not the card manager — that is `/wallet`. The page reads `useAuth()` to choose its hero buttons: `/wallet` and `/dashboard` when signed in, otherwise open-account and log-in.',
    detail: 4,
    tags: ['ui', 'public', 'cards'],
    sources: [cu('pages/Cards.tsx', 13, 19, 'Cards marketing page'), cu('pages/Cards.tsx', 54, 66, 'export function Cards')],
  },
  {
    id: 'cu:pages/Borrow',
    kind: 'page',
    name: 'Loans & CDs (product page)',
    parent: 'cu.public',
    route: '/borrow',
    order: 7,
    summary: 'Marketing page for loans and CDs whose rate tables are generated from the shared lending constants, so they match what the portal offers.',
    description: 'CD rows come from `CD_TERMS_MONTHS` + `cdApyForTerm`, loan rows from `LOAN_TERMS_MONTHS` + `loanApyForTerm`, and the savings row from `DEFAULT_SAVINGS_APY_BPS`. Signed-in visitors get an "Open a loan or CD" button to `/loans`.',
    detail: 4,
    tags: ['ui', 'public', 'lending'],
    sources: [
      cu('pages/Borrow.tsx', 23, 31, 'Loans & CDs marketing page'),
      cu('pages/Borrow.tsx', 66, 87, 'CD_TERMS_MONTHS.map', 'Rate tables from shared constants'),
      cu('pages/Borrow.tsx', 89, 101, 'export function Borrow'),
    ],
  },
  {
    id: 'cu:pages/About',
    kind: 'page',
    name: 'About',
    parent: 'cu.public',
    route: '/about',
    order: 8,
    summary: 'Explains the two apps, the security features and the milestone roadmap; `/about#security` is the footer\'s "Security" link target.',
    detail: 4,
    tags: ['ui', 'public'],
    sources: [cu('pages/About.tsx', 70, 83, 'export function About'), cu('pages/About.tsx', 116, 122, 'id="security"', 'Deep-link target')],
  },
  {
    id: 'cu:pages/NotFound',
    kind: 'page',
    name: 'Not found (404)',
    parent: 'cu.public',
    order: 9,
    summary: 'Shown for any unmatched path (`path="*"`): "That page does not exist in this simulation." with a button back to the home page.',
    detail: 5,
    tags: ['ui', 'public'],
    sources: [cu('pages/NotFound.tsx', 4, 14, 'export function NotFound')],
  },
];

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

const PORTAL_BACK_LINKS: [page: string, start: number, end: number][] = [
  ['MoveMoney', 933, 938],
  ['Wallet', 717, 722],
  ['Lending', 982, 987],
  ['ScheduledPayments', 778, 783],
  ['Statements', 230, 235],
];

const USES_BUTTON = ['Login', 'Dashboard', 'AccountDetail', 'MoveMoney', 'Wallet', 'Lending', 'ScheduledPayments', 'OpenAccount', 'MarketingHome', 'NotFound'];
const USES_CARD = ['Login', 'Dashboard', 'AccountDetail', 'MoveMoney', 'Wallet', 'Lending', 'ScheduledPayments', 'Statements', 'OpenAccount'];
const USES_MARKETING = ['MarketingHome', 'Checking', 'Savings', 'Cards', 'Borrow', 'About', 'OpenAccount'];
const USES_STATUS_PILL: [page: string, line: number][] = [
  ['Dashboard', 560],
  ['AccountDetail', 228],
  ['MoveMoney', 944],
  ['Wallet', 728],
  ['Lending', 993],
  ['ScheduledPayments', 789],
  ['Statements', 241],
  ['MarketingHome', 106],
];

export const pageRelations: Relation[] = [
  // ===== Login ================================================================
  rel('cu:pages/Login', 'cu:lib/auth-context#useAuth', 'calls', {
    label: 'useAuth()',
    summary: 'Reads `user`, `loading`, `login` and `logout` from the auth context.',
    order: 1,
    sources: [cu('pages/Login.tsx', 52, 55, 'useAuth()')],
  }),
  rel('cu:pages/Login', 'cu:lib/AuthProvider', 'calls', {
    label: 'login(email.trim(), password)',
    summary: 'The submit handler signs in through the context; the provider calls the API client and caches the user.',
    description: 'On `result.ok` the page navigates to the remembered path or `/dashboard`. Otherwise it shows `messageForCode(result.code, result.message)` and re-enables the button. The already-signed-in panel\'s Log out button calls the context\'s `logout()` the same way.',
    order: 2,
    sources: [
      cu('pages/Login.tsx', 68, 80, 'await login(email.trim(), password)', 'handleSubmit'),
      cu('pages/Login.tsx', 88, 94, 'await logout()', 'handleSignOut'),
    ],
  }),
  rel('cu:pages/Login', 'cu:pages/Dashboard', 'navigates', {
    label: 'on success → /dashboard (or state.from)',
    summary: 'After a successful sign-in the page replaces itself with the originally requested portal page, defaulting to the dashboard.',
    order: 3,
    sources: [
      cu('pages/Login.tsx', 63, 76, 'navigate(redirectTo, { replace: true })'),
      cu('pages/Login.tsx', 125, 128, 'to="/dashboard"', 'Link on the already-signed-in panel'),
    ],
  }),
  rel('cu:pages/Login', 'cu:components/PublicDemoNotice', 'renders', {
    label: '<PublicDemoNotice variant="form" />',
    summary: 'Warns public-demo visitors before they type an email or password.',
    sources: [cu('pages/Login.tsx', 152, 154, '<PublicDemoNotice variant="form"')],
  }),
  rel('cu:pages/Login', 'cu:lib/auth#LoginResult', 'uses-type', {
    label: 'result.code → message',
    detail: 5,
    sources: [cu('pages/Login.tsx', 73, 79, 'messageForCode(result.code, result.message)')],
  }),
  rel('cu:pages/Login', 'feat:auth', 'implements', {
    label: 'customer sign-in',
    sources: [cu('pages/Login.tsx', 9, 18, 'Simulated sign-in')],
  }),

  // ===== Dashboard ============================================================
  rel('cu:pages/Dashboard', 'cu:lib/auth#fetchAccounts', 'calls', {
    label: 'fetchAccounts()',
    summary: 'On mount, and again after an invitation is accepted so the newly shared account appears.',
    order: 1,
    sources: [
      cu('pages/Dashboard.tsx', 536, 547, 'void fetchAccounts()', 'Mount effect'),
      cu('pages/Dashboard.tsx', 530, 534, 'await fetchAccounts()', 'loadAccounts, passed to the inbox as onAccepted'),
    ],
  }),
  rel('cu:pages/Dashboard', 'cu:lib/auth#fetchLoginHistory', 'calls', {
    label: 'fetchLoginHistory()',
    summary: 'On mount, for the "Recent sign-in activity" card.',
    order: 2,
    sources: [cu('pages/Dashboard.tsx', 536, 547, 'void fetchLoginHistory()')],
  }),
  rel('cu:pages/Dashboard', 'cu:lib/risk#listFraudAlerts', 'calls', {
    label: 'listFraudAlerts()',
    summary: 'The Security alerts section loads the customer\'s pending fraud alerts on mount.',
    order: 3,
    sources: [cu('pages/Dashboard.tsx', 413, 422, 'void listFraudAlerts()')],
  }),
  rel('cu:pages/Dashboard', 'cu:lib/risk#respondToFraudAlert', 'calls', {
    label: 'respondToFraudAlert(id, response)',
    summary: '"Confirm — it was me" sends `confirm_legit`; "Report fraud" sends `report_fraud`.',
    description: 'On success the recorded response is stored in local `resolved` state and the buttons are replaced by its label; on failure the message is shown above the list.',
    order: 4,
    sources: [cu('pages/Dashboard.tsx', 424, 439, 'await respondToFraudAlert(id, response)', 'FraudAlertsSection.respond')],
  }),
  rel('cu:pages/Dashboard', 'cu:lib/invitations#fetchInvitations', 'calls', {
    label: 'fetchInvitations()',
    summary: 'The invitations inbox loads pending invitations on mount and hides itself when there are none.',
    order: 5,
    sources: [cu('pages/Dashboard.tsx', 299, 307, 'void fetchInvitations()')],
  }),
  rel('cu:pages/Dashboard', 'cu:lib/invitations#acceptInvitation', 'calls', {
    label: 'acceptInvitation(id)',
    summary: 'Accepting removes the invitation locally and triggers an accounts re-fetch.',
    order: 6,
    sources: [cu('pages/Dashboard.tsx', 309, 330, 'await acceptInvitation(id)', 'InvitationsInbox.respond')],
  }),
  rel('cu:pages/Dashboard', 'cu:lib/invitations#declineInvitation', 'calls', {
    label: 'declineInvitation(id)',
    summary: 'Declining removes the invitation locally; accounts are not re-fetched.',
    order: 7,
    sources: [cu('pages/Dashboard.tsx', 309, 330, 'await declineInvitation(id)', 'InvitationsInbox.respond')],
  }),
  rel('cu:pages/Dashboard', 'cu:lib/account-display#groupAccounts', 'calls', {
    label: 'groupAccounts(state.data)',
    summary: 'Separates cash accounts from loans and CDs before computing "Total available cash".',
    sources: [cu('pages/Dashboard.tsx', 176, 181, 'groupAccounts(state.data)')],
  }),
  rel('cu:pages/Dashboard', 'cu:lib/account-display#savingsApyNote', 'calls', {
    label: 'savingsApyNote(account.type)',
    detail: 5,
    sources: [cu('pages/Dashboard.tsx', 70, 73, 'savingsApyNote(account.type)')],
  }),
  rel('cu:pages/Dashboard', 'cu:lib/account-display#RELATIONSHIP_META', 'uses-type', {
    label: 'RELATIONSHIP_META[account.relationship]',
    detail: 5,
    sources: [cu('pages/Dashboard.tsx', 64, 66, 'RELATIONSHIP_META[account.relationship]')],
  }),
  rel('cu:pages/Dashboard', 'cu:lib/auth-context#useAuth', 'calls', {
    label: 'useAuth()',
    summary: 'Only for the greeting ("Welcome back, <displayName>").',
    detail: 5,
    sources: [cu('pages/Dashboard.tsx', 522, 524, 'useAuth()')],
  }),
  rel('cu:pages/Dashboard', 'sh:auth#AccountSummary', 'uses-type', {
    label: 'AccountSummary (balances.availableMinor, currentMinor, …)',
    summary: 'Account cards render the server-derived balances as received.',
    sources: [cu('pages/Dashboard.tsx', 64, 72, 'account: AccountSummary')],
  }),
  rel('cu:pages/Dashboard', 'sh:risk#FraudAlertSummary', 'uses-type', {
    label: 'FraudAlertSummary',
    detail: 5,
    sources: [cu('pages/Dashboard.tsx', 406, 408, 'FraudAlertSummary[]')],
  }),
  rel('cu:pages/Dashboard', 'sh:money#formatMinor', 'calls', {
    label: 'formatMinor(minor, currency)',
    summary: 'Every amount on the page is integer minor units formatted by the shared function.',
    detail: 5,
    sources: [cu('pages/Dashboard.tsx', 186, 192, 'formatMinor(totalAvailable, currency)')],
  }),
  rel('cu:pages/Dashboard', 'cu:pages/AccountDetail', 'navigates', {
    label: 'account card → /accounts/:id',
    summary: 'Each account card is a link to that account\'s detail page.',
    sources: [cu('pages/Dashboard.tsx', 73, 77, 'to={`/accounts/${account.id}`}')],
  }),
  rel('cu:pages/Dashboard', 'cu:pages/MoveMoney', 'navigates', {
    label: 'quick links: Transfers / Bill pay',
    summary: 'Two quick links open Move money on a specific tab via router state (`{ tab: "transfer" }`, `{ tab: "bill" }`).',
    sources: [cu('pages/Dashboard.tsx', 577, 592, "state={{ tab: 'bill' }}")],
  }),
  rel('cu:pages/Dashboard', 'cu:pages/ScheduledPayments', 'navigates', {
    label: 'quick link: Scheduled payments',
    sources: [cu('pages/Dashboard.tsx', 593, 599, 'to="/scheduled-payments"')],
  }),
  rel('cu:pages/Dashboard', 'cu:pages/Statements', 'navigates', {
    label: 'quick link: Statements & documents',
    sources: [cu('pages/Dashboard.tsx', 600, 606, 'to="/statements"')],
  }),
  rel('cu:pages/Dashboard', 'cu:pages/Wallet', 'navigates', {
    label: 'quick link: Cards',
    sources: [cu('pages/Dashboard.tsx', 607, 613, 'to="/wallet"')],
  }),
  rel('cu:pages/Dashboard', 'cu:pages/Lending', 'navigates', {
    label: 'quick link: Loans & CDs',
    summary: 'Also the "Manage" link beside the Loans & CDs account group.',
    sources: [cu('pages/Dashboard.tsx', 614, 620, 'to="/loans"'), cu('pages/Dashboard.tsx', 214, 221, 'to="/loans"', '"Manage" link')],
  }),
  rel('cu:pages/Dashboard', 'feat:accounts', 'implements', { label: 'accounts overview', sources: [cu('pages/Dashboard.tsx', 27, 33, 'accounts OVERVIEW')] }),
  rel('cu:pages/Dashboard', 'feat:balances', 'implements', {
    label: 'displays derived balances',
    summary: 'The page states that balances are derived on the server from an append-only ledger and shows them unmodified.',
    sources: [cu('pages/Dashboard.tsx', 563, 566, 'Balances are DERIVED on the server')],
  }),
  rel('cu:pages/Dashboard', 'feat:fraud', 'implements', { label: 'customer responds to fraud alerts', sources: [cu('pages/Dashboard.tsx', 399, 406, 'Pending fraud alerts')] }),
  rel('cu:pages/Dashboard', 'feat:invitations', 'implements', { label: 'invitation inbox', sources: [cu('pages/Dashboard.tsx', 284, 290, 'Pending joint-owner invitations')] }),
  rel('cu:pages/Dashboard', 'feat:auth', 'implements', { label: 'sign-in history', detail: 4, sources: [cu('pages/Dashboard.tsx', 237, 241, 'Recent sign-in activity')] }),

  // ===== AccountDetail ========================================================
  rel('cu:pages/AccountDetail', 'cu:lib/auth#fetchAccountTransactions', 'calls', {
    label: 'fetchAccountTransactions(id)',
    summary: 'One request per visit (and per `:id` change) returns the account header and all its transactions; no query parameters are sent.',
    description: 'Status 200 with data → `ok`; 403 → `forbidden`; 404 → `notFound`; anything else (including the client\'s status 0 for a network failure) → `offline`.',
    order: 1,
    sources: [cu('pages/AccountDetail.tsx', 209, 222, 'void fetchAccountTransactions(id)', 'Load effect')],
  }),
  rel('cu:pages/AccountDetail', 'cu:components/TransactionList', 'renders', {
    label: '<TransactionList transactions currency />',
    summary: 'Hands the fetched transactions to the list, which filters them in the browser and hosts the dispute form.',
    order: 2,
    sources: [cu('pages/AccountDetail.tsx', 275, 280, '<TransactionList')],
  }),
  rel('cu:pages/AccountDetail', 'cu:lib/invitations#createInvitation', 'calls', {
    label: 'createInvitation(accountId, email.trim())',
    summary: 'The owner-only form invites a joint owner by email.',
    description: 'Shown only when `account.relationship === "owner"`. Success → "Invitation sent to <email>"; failure → the result\'s `message` in an alert.',
    order: 3,
    sources: [
      cu('pages/AccountDetail.tsx', 129, 144, 'await createInvitation(accountId, email.trim())', 'InviteJointOwner.handleSubmit'),
      cu('pages/AccountDetail.tsx', 282, 287, "relationship === 'owner'", 'Owner-only rendering'),
    ],
  }),
  rel('cu:pages/AccountDetail', 'sh:transactions#AccountTransactionsResponse', 'uses-type', {
    label: 'AccountTransactionsResponse { account, transactions }',
    sources: [cu('pages/AccountDetail.tsx', 20, 25, 'AccountTransactionsResponse')],
  }),
  rel('cu:pages/AccountDetail', 'cu:lib/account-display#RELATIONSHIP_META', 'uses-type', {
    label: 'RELATIONSHIP_META[account.relationship]',
    detail: 5,
    sources: [cu('pages/AccountDetail.tsx', 38, 42, 'RELATIONSHIP_META[account.relationship]')],
  }),
  rel('cu:pages/AccountDetail', 'sh:money#formatMinor', 'calls', {
    label: 'formatMinor(balances.availableMinor, account.currency)',
    detail: 5,
    sources: [cu('pages/AccountDetail.tsx', 71, 83, 'formatMinor(balances.availableMinor, account.currency)')],
  }),
  rel('cu:pages/AccountDetail', 'cu:pages/MoveMoney', 'navigates', {
    label: 'Move money (state.accountId)',
    summary: 'Shown for an active account the viewer may transact on; passes the account id so Move money lists it first.',
    sources: [cu('pages/AccountDetail.tsx', 42, 59, 'state={{ accountId: account.id }}')],
  }),
  rel('cu:pages/AccountDetail', 'cu:pages/Statements', 'navigates', {
    label: 'Statements & documents',
    detail: 4,
    sources: [cu('pages/AccountDetail.tsx', 266, 273, 'to="/statements"')],
  }),
  rel('cu:pages/AccountDetail', 'cu:pages/Dashboard', 'navigates', {
    label: '← Back to accounts',
    detail: 4,
    sources: [cu('pages/AccountDetail.tsx', 27, 36, 'to="/dashboard"')],
  }),
  rel('cu:pages/AccountDetail', 'feat:accounts', 'implements', { label: 'account detail + history', sources: [cu('pages/AccountDetail.tsx', 13, 18, 'One account in detail')] }),
  rel('cu:pages/AccountDetail', 'feat:balances', 'implements', { label: 'available / current / pending breakdown', sources: [cu('pages/AccountDetail.tsx', 71, 103, 'Pending out')] }),
  rel('cu:pages/AccountDetail', 'feat:invitations', 'implements', { label: 'owner invites a joint owner', sources: [cu('pages/AccountDetail.tsx', 117, 123, 'invite a joint owner')] }),
  rel('cu:pages/AccountDetail', 'feat:rbac', 'implements', {
    label: 'friendly 403 / 404 states',
    summary: 'Access is decided by the server; the page only renders the outcome.',
    detail: 4,
    sources: [cu('pages/AccountDetail.tsx', 255, 260, 'No access to this account')],
  }),

  // ===== MoveMoney ============================================================
  rel('cu:pages/MoveMoney', 'cu:lib/auth#fetchAccounts', 'calls', {
    label: 'fetchAccounts()',
    summary: 'Once on mount, to populate the account selectors of all four tabs.',
    order: 1,
    sources: [cu('pages/MoveMoney.tsx', 913, 921, 'void fetchAccounts()')],
  }),
  rel('cu:pages/MoveMoney', 'sh:money#toMinor', 'calls', {
    label: 'toMinor(major)',
    summary: 'Converts the typed dollar amount to integer minor units before validation.',
    order: 2,
    sources: [cu('pages/MoveMoney.tsx', 258, 268, 'return toMinor(major)', 'parseAmountMinor')],
  }),
  rel('cu:pages/MoveMoney', 'sh:money-movement#validateTransfer', 'calls', {
    label: 'validateTransfer({ fromAccountId, toAccountId, amountMinor, memo })',
    summary: 'The same validator the server runs; a failure shows per-field errors and sends nothing.',
    order: 3,
    sources: [cu('pages/MoveMoney.tsx', 388, 398, 'validateTransfer({')],
  }),
  rel('cu:pages/MoveMoney', 'cu:lib/money#createTransfer', 'calls', {
    label: 'createTransfer(check.value)',
    summary: 'The Transfer tab submits the validator\'s normalised value and, on success, shows the two accounts\' new balances from the response.',
    description: 'On `ok: false` the handler overlays `result.fields` on the inputs (`withServerFields`) and shows `result.message` in a banner — for example "Not enough available funds in that account for this amount." for `insufficient_funds`.',
    order: 4,
    sources: [
      cu('pages/MoveMoney.tsx', 383, 409, 'await createTransfer(check.value)', 'TransferFlow.handleSubmit'),
      cu('pages/MoveMoney.tsx', 300, 325, 'function TransferDone', 'Confirmation with derived balances'),
    ],
  }),
  rel('cu:pages/MoveMoney', 'sh:money-movement#validateExternalMovement', 'calls', {
    label: 'validateExternalMovement({ accountId, kind, amountMinor, direction?, counterparty?, memo })',
    summary: 'Shared validation for the deposit, send-money and bill-pay tabs.',
    order: 5,
    sources: [
      cu('pages/MoveMoney.tsx', 505, 515, 'validateExternalMovement({', 'Deposit'),
      cu('pages/MoveMoney.tsx', 611, 625, 'validateExternalMovement({', 'Send money'),
      cu('pages/MoveMoney.tsx', 781, 792, 'validateExternalMovement({', 'Pay a bill'),
    ],
  }),
  rel('cu:pages/MoveMoney', 'cu:lib/money#createMovement', 'calls', {
    label: 'createMovement(check.value)',
    summary: 'Deposit a check, Send money and Pay a bill all submit a reviewable movement that is only queued for an operator.',
    description: 'The three handlers differ only in the `kind` they validate with: `mobile_check_deposit`, `external_ach` / `wire`, `bill_pay`. Success shows "Submitted for review" with the reference; failure is handled exactly as for a transfer.',
    order: 6,
    sources: [
      cu('pages/MoveMoney.tsx', 500, 526, 'await createMovement(check.value)', 'DepositFlow.handleSubmit'),
      cu('pages/MoveMoney.tsx', 606, 636, 'await createMovement(check.value)', 'SendFlow.handleSubmit'),
      cu('pages/MoveMoney.tsx', 776, 803, 'await createMovement(check.value)', 'BillPayFlow.handleSubmit'),
      cu('pages/MoveMoney.tsx', 327, 359, 'function MovementDone', 'Pending-review confirmation'),
    ],
  }),
  rel('cu:pages/MoveMoney', 'sh:money-movement#TransferResponse', 'uses-type', {
    label: 'TransferResponse.accounts',
    detail: 5,
    sources: [cu('pages/MoveMoney.tsx', 300, 310, 'result: TransferResponse')],
  }),
  rel('cu:pages/MoveMoney', 'sh:money-movement#ExternalMovementResponse', 'uses-type', {
    label: 'ExternalMovementResponse.reference',
    detail: 5,
    sources: [cu('pages/MoveMoney.tsx', 327, 343, 'result.reference')],
  }),
  rel('cu:pages/MoveMoney', 'cu:pages/Dashboard', 'navigates', {
    label: '← Back to dashboard',
    summary: 'Header back link, and "Back to dashboard" on both confirmation panels.',
    detail: 4,
    sources: [cu('pages/MoveMoney.tsx', 933, 938, 'to="/dashboard"'), cu('pages/MoveMoney.tsx', 285, 297, 'Back to dashboard')],
  }),
  rel('cu:pages/MoveMoney', 'feat:transfers', 'implements', { label: 'Transfer tab', sources: [cu('pages/MoveMoney.tsx', 361, 372, 'function TransferFlow')] }),
  rel('cu:pages/MoveMoney', 'feat:external-movements', 'implements', {
    label: 'Deposit / Send money / Pay a bill tabs',
    sources: [cu('pages/MoveMoney.tsx', 24, 41, 'The three external flows are REVIEWABLE')],
  }),

  // ===== Wallet ===============================================================
  rel('cu:pages/Wallet', 'cu:lib/cards#listCards', 'calls', {
    label: 'listCards()',
    summary: 'On mount; a failed result becomes the "Cards unavailable" state.',
    order: 1,
    sources: [cu('pages/Wallet.tsx', 663, 668, 'void listCards()')],
  }),
  rel('cu:pages/Wallet', 'cu:lib/auth#fetchAccounts', 'calls', {
    label: 'fetchAccounts()',
    summary: 'On mount, only to offer active, non-view-only accounts in the "Issue a card" form.',
    order: 2,
    sources: [cu('pages/Wallet.tsx', 669, 676, 'void fetchAccounts()')],
  }),
  rel('cu:pages/Wallet', 'cu:lib/cards#freezeCard', 'calls', {
    label: 'freezeCard(card.id)',
    summary: 'The Freeze button; the returned card replaces the one in the list.',
    order: 3,
    sources: [cu('pages/Wallet.tsx', 390, 401, 'await freezeCard(card.id)', 'CardItem.toggleFreeze')],
  }),
  rel('cu:pages/Wallet', 'cu:lib/cards#unfreezeCard', 'calls', {
    label: 'unfreezeCard(card.id)',
    summary: 'The Unfreeze button, same handler as freeze.',
    order: 4,
    sources: [cu('pages/Wallet.tsx', 390, 401, 'await unfreezeCard(card.id)', 'CardItem.toggleFreeze')],
  }),
  rel('cu:pages/Wallet', 'cu:lib/cards#addTravelNotice', 'calls', {
    label: 'addTravelNotice(cardId, check.value)',
    summary: 'After the shared `validateTravelNotice` passes.',
    order: 5,
    sources: [cu('pages/Wallet.tsx', 167, 189, 'await addTravelNotice(cardId, check.value)', 'TravelNoticeForm.handleSubmit')],
  }),
  rel('cu:pages/Wallet', 'cu:lib/cards#cancelTravelNotice', 'calls', {
    label: 'cancelTravelNotice(cardId, noticeId)',
    order: 6,
    sources: [cu('pages/Wallet.tsx', 261, 271, 'await cancelTravelNotice(cardId, noticeId)', 'TravelNoticeList.cancel')],
  }),
  rel('cu:pages/Wallet', 'cu:lib/cards#reportCard', 'calls', {
    label: 'reportCard(cardId, check.value)',
    summary: 'Report lost / stolen; the response\'s replacement is prepended and the old card is swapped for its terminal version.',
    order: 7,
    sources: [
      cu('pages/Wallet.tsx', 319, 337, 'await reportCard(cardId, check.value)', 'ReportCardForm.handleSubmit'),
      cu('pages/Wallet.tsx', 695, 701, 'function applyReplacement', 'List update'),
    ],
  }),
  rel('cu:pages/Wallet', 'cu:lib/cards#issueCard', 'calls', {
    label: 'issueCard(accountId, check.value)',
    summary: 'Issue a new card after a local account check and the shared `validateIssueCard`.',
    order: 8,
    sources: [cu('pages/Wallet.tsx', 542, 566, 'await issueCard(accountId, check.value)', 'IssueCardForm.handleSubmit')],
  }),
  rel('cu:pages/Wallet', 'sh:cards#validateTravelNotice', 'calls', {
    label: 'validateTravelNotice({ destination, startsOn, endsOn, note })',
    detail: 4,
    sources: [cu('pages/Wallet.tsx', 167, 175, 'validateTravelNotice({ destination, startsOn, endsOn, note })')],
  }),
  rel('cu:pages/Wallet', 'sh:cards#validateReportCard', 'calls', {
    label: 'validateReportCard({ reason })',
    detail: 4,
    sources: [cu('pages/Wallet.tsx', 319, 326, 'validateReportCard({ reason })')],
  }),
  rel('cu:pages/Wallet', 'sh:cards#validateIssueCard', 'calls', {
    label: 'validateIssueCard({ cardType, network })',
    detail: 4,
    sources: [cu('pages/Wallet.tsx', 542, 553, 'validateIssueCard({ cardType, network })')],
  }),
  ...(
    [
      ['canFreezeCard', 437],
      ['canUnfreezeCard', 448],
      ['canAddTravelNotice', 459],
      ['canReportCard', 469],
    ] as [string, number][]
  ).map(([fn, line]) =>
    rel('cu:pages/Wallet', `sh:cards#${fn}`, 'calls', {
      label: `${fn}(card.status)`,
      summary: 'A button is rendered only when the shared rule allows the action for the card\'s status.',
      detail: 5,
      sources: [cu('pages/Wallet.tsx', line, line, `${fn}(card.status)`)],
    }),
  ),
  rel('cu:pages/Wallet', 'sh:cards#isTerminalCardStatus', 'calls', {
    label: 'isTerminalCardStatus(card.status)',
    summary: 'Terminal cards show no actions and sort after in-service cards.',
    detail: 5,
    sources: [cu('pages/Wallet.tsx', 385, 388, 'isTerminalCardStatus(card.status)')],
  }),
  rel('cu:pages/Wallet', 'sh:cards#CardDTO', 'uses-type', {
    label: 'CardDTO (with travelNotices)',
    sources: [cu('pages/Wallet.tsx', 659, 661, 'CardDTO[]')],
  }),
  rel('cu:pages/Wallet', 'feat:cards', 'implements', { label: 'card lifecycle UI', sources: [cu('pages/Wallet.tsx', 44, 57, 'card LIFECYCLE')] }),

  // ===== Lending ==============================================================
  rel('cu:pages/Lending', 'cu:lib/auth#fetchAccounts', 'calls', {
    label: 'fetchAccounts()',
    summary: 'On mount, and again after every successful open / pay / withdraw so selector balances are current.',
    order: 1,
    sources: [
      cu('pages/Lending.tsx', 941, 945, 'void fetchAccounts()', 'Mount effect'),
      cu('pages/Lending.tsx', 957, 973, 'void fetchAccounts().then', 'Re-fetch after a mutation'),
    ],
  }),
  rel('cu:pages/Lending', 'cu:lib/schedules#fetchClock', 'calls', {
    label: 'fetchClock()',
    summary: 'For the "Current simulated date" panel and the "matures in N days" hints.',
    order: 2,
    sources: [cu('pages/Lending.tsx', 946, 948, 'void fetchClock()')],
  }),
  rel('cu:pages/Lending', 'cu:lib/lending#listLending', 'calls', {
    label: 'listLending()',
    order: 3,
    sources: [cu('pages/Lending.tsx', 949, 951, 'void listLending()')],
  }),
  rel('cu:pages/Lending', 'cu:lib/lending#openCd', 'calls', {
    label: 'openCd(check.value)',
    summary: 'After the shared `validateOpenCd` passes; the new product is prepended to the list.',
    order: 4,
    sources: [cu('pages/Lending.tsx', 287, 312, 'await openCd(check.value)', 'OpenCdForm.handleSubmit')],
  }),
  rel('cu:pages/Lending', 'cu:lib/lending#openLoan', 'calls', {
    label: 'openLoan(check.value)',
    summary: 'After the shared `validateOpenLoan` passes; the new product is prepended to the list.',
    order: 5,
    sources: [cu('pages/Lending.tsx', 410, 435, 'await openLoan(check.value)', 'OpenLoanForm.handleSubmit')],
  }),
  rel('cu:pages/Lending', 'cu:lib/lending#payLoan', 'calls', {
    label: 'payLoan(product.id, check.value)',
    summary: 'Scheduled mode sends `amountMinor: null`; custom mode sends the parsed amount.',
    order: 6,
    sources: [cu('pages/Lending.tsx', 554, 580, 'await payLoan(product.id, check.value)', 'LoanPaymentForm.handleSubmit')],
  }),
  rel('cu:pages/Lending', 'cu:lib/lending#withdrawCd', 'calls', {
    label: 'withdrawCd(product.id, check.value)',
    summary: 'Offered only for a matured CD.',
    order: 7,
    sources: [cu('pages/Lending.tsx', 667, 687, 'await withdrawCd(product.id, check.value)', 'WithdrawCdForm.handleSubmit')],
  }),
  ...(
    [
      ['validateOpenCd', 292, 296, 'validateOpenCd({'],
      ['validateOpenLoan', 415, 419, 'validateOpenLoan({'],
      ['validateLoanPayment', 562, 565, 'validateLoanPayment({'],
      ['validateWithdrawCd', 672, 672, 'validateWithdrawCd({ toAccountId })'],
    ] as [string, number, number, string][]
  ).map(([fn, start, end, symbol]) =>
    rel('cu:pages/Lending', `sh:lending#${fn}`, 'calls', {
      label: `${fn}(…)`,
      summary: 'Shared validator run before the request; failures are shown per field and nothing is sent.',
      detail: 4,
      sources: [cu('pages/Lending.tsx', start, end, symbol)],
    }),
  ),
  rel('cu:pages/Lending', 'sh:lending#projectCdMaturityMinor', 'calls', {
    label: 'projectCdMaturityMinor(principalMinor, chosenApy, termMonths)',
    summary: 'Live "projected to be worth …" preview while filling in the CD form.',
    detail: 4,
    sources: [cu('pages/Lending.tsx', 362, 370, 'projectCdMaturityMinor(principalMinor, chosenApy, termMonths)')],
  }),
  rel('cu:pages/Lending', 'sh:lending#amortizedPaymentMinor', 'calls', {
    label: 'amortizedPaymentMinor(principalMinor, chosenApy, termMonths)',
    summary: 'Live estimated monthly payment while filling in the loan form.',
    detail: 4,
    sources: [cu('pages/Lending.tsx', 484, 492, 'amortizedPaymentMinor(principalMinor, chosenApy, termMonths)')],
  }),
  rel('cu:pages/Lending', 'sh:lending#cdApyForTerm', 'calls', {
    label: 'cdApyForTerm(termMonths)',
    detail: 5,
    sources: [cu('pages/Lending.tsx', 273, 277, 'cdApyForTerm(termMonths)')],
  }),
  rel('cu:pages/Lending', 'sh:lending#loanApyForTerm', 'calls', {
    label: 'loanApyForTerm(termMonths)',
    detail: 5,
    sources: [cu('pages/Lending.tsx', 396, 400, 'loanApyForTerm(termMonths)')],
  }),
  rel('cu:pages/Lending', 'sh:lending#isCdWithdrawable', 'calls', {
    label: 'isCdWithdrawable(product)',
    detail: 5,
    sources: [cu('pages/Lending.tsx', 738, 742, 'isCdWithdrawable(product)')],
  }),
  rel('cu:pages/Lending', 'sh:lending#daysBetween', 'calls', {
    label: 'daysBetween(nowIso, maturesAt)',
    detail: 5,
    sources: [cu('pages/Lending.tsx', 525, 533, 'daysBetween(nowIso, maturesAt)')],
  }),
  rel('cu:pages/Lending', 'sh:lending#LendingProductDTO', 'uses-type', {
    label: 'LendingProductDTO',
    sources: [cu('pages/Lending.tsx', 934, 938, 'LendingProductDTO[]')],
  }),
  rel('cu:pages/Lending', 'sh:clock#SimulationClockDTO', 'uses-type', {
    label: 'SimulationClockDTO.currentTime',
    detail: 5,
    sources: [cu('pages/Lending.tsx', 934, 934, 'SimulationClockDTO')],
  }),
  rel('cu:pages/Lending', 'feat:lending', 'implements', { label: 'lending portal', sources: [cu('pages/Lending.tsx', 35, 58, 'the authenticated lending portal')] }),

  // ===== ScheduledPayments ====================================================
  rel('cu:pages/ScheduledPayments', 'cu:lib/auth#fetchAccounts', 'calls', {
    label: 'fetchAccounts()',
    order: 1,
    sources: [cu('pages/ScheduledPayments.tsx', 742, 746, 'void fetchAccounts()')],
  }),
  rel('cu:pages/ScheduledPayments', 'cu:lib/schedules#fetchClock', 'calls', {
    label: 'fetchClock()',
    summary: 'Shows the simulated "now" that decides when schedules fire.',
    order: 2,
    sources: [cu('pages/ScheduledPayments.tsx', 747, 749, 'void fetchClock()')],
  }),
  rel('cu:pages/ScheduledPayments', 'cu:lib/schedules#fetchSchedules', 'calls', {
    label: 'fetchSchedules()',
    order: 3,
    sources: [cu('pages/ScheduledPayments.tsx', 750, 752, 'void fetchSchedules()')],
  }),
  rel('cu:pages/ScheduledPayments', 'sh:schedules#validateCreateSchedule', 'calls', {
    label: 'validateCreateSchedule({ kind, fromAccountId, …, frequency, firstRunInDays, memo })',
    summary: 'Shared validator run before the request.',
    order: 4,
    sources: [cu('pages/ScheduledPayments.tsx', 337, 346, 'validateCreateSchedule({')],
  }),
  rel('cu:pages/ScheduledPayments', 'cu:lib/schedules#createSchedule', 'calls', {
    label: 'createSchedule(check.value)',
    summary: 'On success the form resets and the returned schedule is prepended to the list with the server\'s confirmation message.',
    order: 5,
    sources: [
      cu('pages/ScheduledPayments.tsx', 327, 362, 'await createSchedule(check.value)', 'CreateScheduleForm.handleSubmit'),
      cu('pages/ScheduledPayments.tsx', 758, 762, 'function handleCreated', 'List update'),
    ],
  }),
  rel('cu:pages/ScheduledPayments', 'cu:lib/schedules#cancelSchedule', 'calls', {
    label: 'cancelSchedule(schedule.id)',
    summary: 'The returned schedule (now cancelled) replaces the row; an error such as 409 `conflict` is shown on the row.',
    order: 6,
    sources: [
      cu('pages/ScheduledPayments.tsx', 577, 592, 'await cancelSchedule(schedule.id)', 'ScheduleItem.cancel'),
      cu('pages/ScheduledPayments.tsx', 764, 770, 'function handleCancelled', 'List update'),
    ],
  }),
  rel('cu:pages/ScheduledPayments', 'sh:schedules#isActiveSchedule', 'calls', {
    label: 'isActiveSchedule(schedule.status)',
    detail: 5,
    sources: [cu('pages/ScheduledPayments.tsx', 577, 579, 'isActiveSchedule(schedule.status)')],
  }),
  rel('cu:pages/ScheduledPayments', 'sh:schedules#ScheduleDTO', 'uses-type', {
    label: 'ScheduleDTO',
    sources: [cu('pages/ScheduledPayments.tsx', 736, 739, 'ScheduleDTO[]')],
  }),
  rel('cu:pages/ScheduledPayments', 'sh:clock#SimulationClockDTO', 'uses-type', {
    label: 'SimulationClockDTO.currentTime',
    detail: 5,
    sources: [cu('pages/ScheduledPayments.tsx', 735, 735, 'SimulationClockDTO')],
  }),
  rel('cu:pages/ScheduledPayments', 'feat:schedules', 'implements', {
    label: 'create / list / cancel schedules',
    sources: [cu('pages/ScheduledPayments.tsx', 27, 46, 'recurring/scheduled-payment surface')],
  }),

  // ===== Statements ===========================================================
  rel('cu:pages/Statements', 'cu:lib/auth#fetchAccounts', 'calls', {
    label: 'fetchAccounts()',
    summary: 'On mount; the first account is selected automatically.',
    order: 1,
    sources: [cu('pages/Statements.tsx', 193, 204, 'void fetchAccounts()')],
  }),
  rel('cu:pages/Statements', 'cu:lib/schedules#fetchAccountStatements', 'calls', {
    label: 'fetchAccountStatements(selectedId)',
    summary: 'Runs every time the selected account changes; the error code is kept to distinguish no-access from offline.',
    order: 2,
    sources: [cu('pages/Statements.tsx', 206, 222, 'void fetchAccountStatements(selectedId)')],
  }),
  rel('cu:pages/Statements', 'sh:statements#StatementPeriodDTO', 'uses-type', {
    label: 'StatementPeriodDTO (opening, credits, debits, closing, count)',
    sources: [cu('pages/Statements.tsx', 60, 62, 'period: StatementPeriodDTO')],
  }),
  rel('cu:pages/Statements', 'sh:money#formatMinor', 'calls', {
    label: 'formatMinor(period.closingMinor)',
    detail: 5,
    sources: [cu('pages/Statements.tsx', 76, 78, 'formatMinor(period.closingMinor)')],
  }),
  rel('cu:pages/Statements', 'feat:statements', 'implements', { label: 'statement periods view', sources: [cu('pages/Statements.tsx', 15, 26, 'per-account statement view')] }),

  // ===== OpenAccount ==========================================================
  rel('cu:pages/OpenAccount', 'sh:onboarding#validateOpenAccount', 'calls', {
    label: 'validateOpenAccount({ fullName, email, password, product, initialFundingMinor, consent, jointInviteEmail })',
    summary: 'The same validator the server uses, run before anything is sent; it also returns the normalised value that is submitted.',
    order: 1,
    sources: [cu('pages/OpenAccount.tsx', 163, 181, 'validateOpenAccount({')],
  }),
  rel('cu:pages/OpenAccount', 'cu:lib/onboarding#submitApplication', 'calls', {
    label: 'submitApplication({ ...result.value, consent: true })',
    summary: 'Posts the normalised application; server-side field errors are mapped back onto the inputs.',
    order: 2,
    sources: [cu('pages/OpenAccount.tsx', 183, 196, 'await submitApplication({ ...result.value, consent: true })', 'ApplicationForm.handleSubmit')],
  }),
  rel('cu:pages/OpenAccount', 'sh:money#toMinor', 'calls', {
    label: 'toMinor(parsedDollars)',
    detail: 5,
    sources: [cu('pages/OpenAccount.tsx', 163, 166, 'toMinor(parsedDollars)')],
  }),
  rel('cu:pages/OpenAccount', 'sh:onboarding#ONBOARDING_FUNDING', 'uses-type', {
    label: 'ONBOARDING_FUNDING.minMinor / maxMinor',
    summary: 'The opening-deposit limits shown in the hint come from the shared constant.',
    detail: 5,
    sources: [cu('pages/OpenAccount.tsx', 332, 335, 'ONBOARDING_FUNDING.maxMinor')],
  }),
  rel('cu:pages/OpenAccount', 'sh:onboarding#OpenAccountResponse', 'uses-type', {
    label: 'OpenAccountResponse.reference',
    detail: 5,
    sources: [cu('pages/OpenAccount.tsx', 76, 99, 'result.reference')],
  }),
  rel('cu:pages/OpenAccount', 'cu:components/PublicDemoNotice', 'renders', {
    label: '<PublicDemoNotice variant="form" />',
    summary: 'Placed above the first field so a public-demo visitor reads it before typing personal details.',
    sources: [cu('pages/OpenAccount.tsx', 201, 203, '<PublicDemoNotice variant="form" />')],
  }),
  rel('cu:pages/OpenAccount', 'cu:pages/Login', 'navigates', {
    label: 'Go to sign in',
    summary: 'From the confirmation panel, and the "Already have a simulated account? Sign in" link under the form.',
    sources: [cu('pages/OpenAccount.tsx', 124, 127, 'to="/login"'), cu('pages/OpenAccount.tsx', 396, 401, 'to="/login"')],
  }),
  rel('cu:pages/OpenAccount', 'feat:onboarding', 'implements', { label: 'public application form', sources: [cu('pages/OpenAccount.tsx', 21, 32, 'self-service onboarding form')] }),
  rel('cu:pages/OpenAccount', 'feat:invitations', 'implements', {
    label: 'optional joint-owner email on the application',
    detail: 4,
    sources: [cu('pages/OpenAccount.tsx', 339, 362, 'Invite a joint owner')],
  }),

  // ===== Marketing pages ======================================================
  rel('cu:pages/MarketingHome', 'cu:pages/OpenAccount', 'navigates', {
    label: 'Open a (simulated) account',
    sources: [cu('pages/MarketingHome.tsx', 95, 98, "to: '/open-account'")],
  }),
  rel('cu:pages/MarketingHome', 'cu:pages/Login', 'navigates', {
    label: 'Log in',
    sources: [cu('pages/MarketingHome.tsx', 95, 98, "to: '/login'")],
  }),
  ...(
    [
      ['Checking', '/checking', 49],
      ['Savings', '/savings', 56],
      ['Cards', '/cards', 63],
      ['Borrow', '/borrow', 70],
    ] as [string, string, number][]
  ).map(([page, path, line]) =>
    rel('cu:pages/MarketingHome', `cu:pages/${page}`, 'navigates', {
      label: `product highlight → ${path}`,
      detail: 4,
      sources: [cu('pages/MarketingHome.tsx', line, line, `to: '${path}'`)],
    }),
  ),
  rel('cu:pages/MarketingHome', 'cu:pages/About', 'navigates', {
    label: 'How security works → /about#security',
    detail: 4,
    sources: [cu('pages/MarketingHome.tsx', 219, 222, 'to="/about#security"')],
  }),
  rel('cu:pages/MarketingHome', 'feat:public-site', 'implements', { label: 'landing page', sources: [cu('pages/MarketingHome.tsx', 78, 80, 'export function MarketingHome')] }),
  ...(['Checking', 'Savings', 'Cards', 'Borrow', 'About'] as const).map((page) =>
    rel(`cu:pages/${page}`, 'feat:public-site', 'implements', {
      label: 'product / info page',
      detail: 4,
      sources: [cuFile(`pages/${page}.tsx`, `export function ${page}`)],
    }),
  ),
  ...(['Checking', 'Savings', 'About'] as const).map((page) =>
    rel(`cu:pages/${page}`, 'cu:pages/OpenAccount', 'navigates', {
      label: 'hero CTA → /open-account',
      detail: 5,
      sources: [cuFile(`pages/${page}.tsx`, "to: '/open-account'")],
    }),
  ),
  rel('cu:pages/Cards', 'cu:lib/auth-context#useAuth', 'calls', {
    label: 'useAuth()',
    detail: 5,
    sources: [cu('pages/Cards.tsx', 54, 56, 'useAuth()')],
  }),
  rel('cu:pages/Cards', 'cu:pages/Wallet', 'navigates', {
    label: 'Manage your cards (signed in)',
    summary: 'Signed-in visitors are sent to the wallet; logged-out visitors get open-account / log-in buttons.',
    sources: [cu('pages/Cards.tsx', 58, 66, "to: '/wallet'")],
  }),
  rel('cu:pages/Borrow', 'cu:lib/auth-context#useAuth', 'calls', {
    label: 'useAuth()',
    detail: 5,
    sources: [cu('pages/Borrow.tsx', 89, 91, 'useAuth()')],
  }),
  rel('cu:pages/Borrow', 'cu:pages/Lending', 'navigates', {
    label: 'Open a loan or CD (signed in)',
    summary: 'Signed-in visitors are sent to the lending portal.',
    sources: [cu('pages/Borrow.tsx', 93, 101, "to: '/loans'")],
  }),
  rel('cu:pages/Borrow', 'sh:lending#cdApyForTerm', 'calls', {
    label: 'CD_TERMS_MONTHS.map(months → cdApyForTerm(months))',
    summary: 'The published CD rate table is generated from the shared lending constants.',
    detail: 4,
    sources: [cu('pages/Borrow.tsx', 66, 71, 'cdApyForTerm(months)')],
  }),
  rel('cu:pages/Borrow', 'sh:lending#loanApyForTerm', 'calls', {
    label: 'LOAN_TERMS_MONTHS.map(months → loanApyForTerm(months))',
    detail: 5,
    sources: [cu('pages/Borrow.tsx', 73, 78, 'loanApyForTerm(months)')],
  }),
  rel('cu:pages/Borrow', 'sh:lending#DEFAULT_SAVINGS_APY_BPS', 'uses-type', {
    label: 'formatApy(DEFAULT_SAVINGS_APY_BPS)',
    detail: 5,
    sources: [cu('pages/Borrow.tsx', 80, 87, 'formatApy(DEFAULT_SAVINGS_APY_BPS)')],
  }),
  rel('cu:pages/NotFound', 'cu:pages/MarketingHome', 'navigates', {
    label: 'Back to home',
    detail: 5,
    sources: [cu('pages/NotFound.tsx', 9, 11, 'to="/"')],
  }),

  // ===== Shared patterns ======================================================
  ...PORTAL_BACK_LINKS.filter(([page]) => page !== 'MoveMoney').map(([page, start, end]) =>
    rel(`cu:pages/${page}`, 'cu:pages/Dashboard', 'navigates', {
      label: '← Back to dashboard',
      detail: 5,
      sources: [cu(`pages/${page}.tsx`, start, end, 'to="/dashboard"')],
    }),
  ),
  ...USES_STATUS_PILL.map(([page, line]) =>
    rel(`cu:pages/${page}`, 'cu:components/BackendStatusPill', 'renders', {
      label: '<BackendStatusPill />',
      detail: 5,
      sources: [cu(`pages/${page}.tsx`, line, line, '<BackendStatusPill />')],
    }),
  ),
  ...USES_MARKETING.map((page) =>
    rel(`cu:pages/${page}`, 'cu:components/marketing', 'renders', {
      label: '<PageHero> / <Section> …',
      detail: 5,
      sources: [cuFile(`pages/${page}.tsx`, "from '../components/marketing'")],
    }),
  ),
  ...USES_BUTTON.map((page) =>
    rel(`cu:pages/${page}`, 'cu:components/ui/Button', 'renders', {
      label: '<Button>',
      detail: 5,
      sources: [cuFile(`pages/${page}.tsx`, "from '../components/ui/Button'")],
    }),
  ),
  ...USES_CARD.map((page) =>
    rel(`cu:pages/${page}`, 'cu:components/ui/Card', 'renders', {
      label: '<Card>',
      detail: 5,
      sources: [cuFile(`pages/${page}.tsx`, "from '../components/ui/Card'")],
    }),
  ),
  rel('cu:pages/MarketingHome', 'cu:components/ImagePlaceholder', 'renders', {
    label: '<ImagePlaceholder />',
    detail: 5,
    sources: [cuFile('pages/MarketingHome.tsx', "from '../components/ImagePlaceholder'")],
  }),

  // ===== Actors ===============================================================
  rel('role:customer', 'cu:pages/Login', 'actor-uses', {
    label: 'signs in',
    summary: 'Customers sign in here; bank staff use the separate operations console.',
    detail: 3,
    sources: [repo('e2e/auth.spec.ts', 28, 42, 'a customer can log in')],
  }),
  rel('role:customer', 'cu:pages/Dashboard', 'actor-uses', {
    label: 'checks balances and alerts',
    detail: 2,
    sources: [repo('e2e/auth.spec.ts', 28, 42, 'welcome back, avery')],
  }),
  rel('role:customer', 'cu:pages/AccountDetail', 'actor-uses', {
    label: 'reviews transactions, disputes a charge',
    detail: 3,
    sources: [repo('e2e/dashboard.spec.ts', 50, 62, 'account detail shows pending vs posted')],
  }),
  rel('role:customer', 'cu:pages/MoveMoney', 'actor-uses', {
    label: 'moves money',
    detail: 2,
    sources: [repo('e2e/money-movement.spec.ts', 34, 50, 'a customer transfers money between their own accounts')],
  }),
  rel('role:customer', 'cu:pages/Wallet', 'actor-uses', {
    label: 'manages cards',
    detail: 3,
    sources: [repo('e2e/cards-fraud-disputes.spec.ts', 38, 50, 'a customer freezes a card in the wallet')],
  }),
  rel('role:customer', 'cu:pages/Lending', 'actor-uses', {
    label: 'opens and manages loans & CDs',
    detail: 3,
    sources: [repo('e2e/lending.spec.ts', 69, 91, 'a customer opens a new CD')],
  }),
  rel('role:customer', 'cu:pages/ScheduledPayments', 'actor-uses', {
    label: 'schedules payments',
    detail: 3,
    sources: [repo('e2e/scheduled-payments.spec.ts', 38, 69, 'a customer schedules a bill payment')],
  }),
  rel('role:customer', 'cu:pages/Statements', 'actor-uses', {
    label: 'reads statements',
    detail: 3,
    sources: [repo('e2e/dashboard.spec.ts', 80, 90, 'the statements page is reachable')],
  }),
  rel('role:customer', 'cu:pages/OpenAccount', 'actor-uses', {
    label: 'applies (before having an account)',
    summary: 'A prospective customer applies here without a session; the `customer` user is created only when an operator approves the application.',
    detail: 3,
    confidence: 'simplified',
    sources: [repo('e2e/onboarding.spec.ts', 35, 51, 'a visitor can submit a simulated open-account application')],
  }),
  rel('role:joint_customer', 'cu:pages/Login', 'actor-uses', {
    label: 'signs in',
    detail: 4,
    sources: [repo('e2e/auth.spec.ts', 51, 60, 'a joint customer sees only the shared account')],
  }),
  rel('role:joint_customer', 'cu:pages/Dashboard', 'actor-uses', {
    label: 'sees only shared accounts and pending invitations',
    summary: 'The same dashboard; the server returns only accounts the joint customer has been granted, and the inbox shows invitations addressed to them.',
    detail: 3,
    sources: [
      repo('e2e/auth.spec.ts', 51, 60, 'toHaveCount(0)', 'No savings account link for Jordan'),
      repo('e2e/onboarding.spec.ts', 113, 121, 'a customer sees a pending joint-owner invitation in their inbox'),
    ],
  }),
  rel('role:joint_customer', 'cu:pages/AccountDetail', 'actor-uses', {
    label: 'views the shared account',
    summary: 'A joint relationship is not `viewer`, so the Move money button is offered; the invite form is not, because it is owner-only.',
    detail: 4,
    confidence: 'inferred',
    sources: [cu('pages/AccountDetail.tsx', 38, 43, "account.relationship !== 'viewer'")],
  }),
];
