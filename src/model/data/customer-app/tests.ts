import type { Entity, Relation } from '../../types';
import { rel, repo } from './helpers';

/**
 * Tests that pin customer-app behaviour: four Vitest files inside the app and
 * the six Playwright specs that drive the customer UI. Relations from the e2e
 * specs owned by other slices (lending, scheduled payments, cards/fraud/disputes,
 * onboarding) to customer pages are added here too; those test entities are
 * defined by their own slices.
 */

const UNIT = 'apps/customer/src/';

export const testEntities: Entity[] = [
  {
    id: 'test:apps/customer/src/components/TransactionList.test.tsx',
    kind: 'test',
    name: 'TransactionList.test.tsx',
    parent: 'tests',
    summary: 'Component tests for the transaction list: grouping, running balance placement, signed amounts, the three filters, the empty state, and where "Dispute" is offered.',
    description: 'Renders `<TransactionList>` with in-memory `TransactionDTO` fixtures under jsdom (React Testing Library + user-event). No network is involved: filtering is pure and the dispute request is never submitted in these tests.',
    tags: ['tests', 'ui', 'ledger'],
    tech: ['Vitest', 'React Testing Library'],
    sources: [
      repo(`${UNIT}components/TransactionList.test.tsx`, 78, 107, 'groups transactions into Pending, Posted, and Other sections'),
      repo(`${UNIT}components/TransactionList.test.tsx`, 157, 173, 'offers a Dispute action on a posted row and not on a pending row'),
    ],
  },
  {
    id: 'test:apps/customer/src/components/PublicDemoNotice.test.tsx',
    kind: 'test',
    name: 'PublicDemoNotice.test.tsx',
    parent: 'tests',
    summary: 'Component tests showing the public-demo warning renders nothing locally and appears, in both variants, when the backend reports public-demo mode.',
    description: 'Mocks `lib/useApiStatus` to control the `StatusResponse`; the build flag is off in tests, so the backend flag alone drives the outcome.',
    tags: ['tests', 'ui', 'public-demo'],
    tech: ['Vitest', 'React Testing Library'],
    sources: [repo(`${UNIT}components/PublicDemoNotice.test.tsx`, 28, 54, 'shows the shared-demo banner when the backend reports public-demo mode')],
  },
  {
    id: 'test:apps/customer/src/lib/account-display.test.ts',
    kind: 'test',
    name: 'account-display.test.ts',
    parent: 'tests',
    summary: 'Unit tests for the display helpers: cash vs lending grouping, the savings APY note, type labels, signed amounts and date formatting.',
    tags: ['tests', 'ui', 'money'],
    tech: ['Vitest'],
    sources: [
      repo(`${UNIT}lib/account-display.test.ts`, 72, 105, 'splits cash (checking/savings) from lending (cd/loan), preserving order'),
      repo(`${UNIT}lib/account-display.test.ts`, 133, 142, 'prefixes a credit with + and a debit with -'),
    ],
  },
  {
    id: 'test:apps/customer/src/lib/cta.test.ts',
    kind: 'test',
    name: 'cta.test.ts',
    parent: 'tests',
    summary: 'Unit tests for the session-aware CTA rule: auth-entry buttons collapse to one dashboard button when logged in, everything else is untouched.',
    tags: ['tests', 'ui', 'auth'],
    tech: ['Vitest'],
    sources: [repo(`${UNIT}lib/cta.test.ts`, 28, 71, 'collapses both auth entry CTAs to a single dashboard action when logged in')],
  },
  {
    id: 'test:e2e/auth.spec.ts',
    kind: 'test',
    name: 'e2e/auth.spec.ts',
    parent: 'tests',
    summary: 'Browser tests for sign-in on both apps: a customer logs in and out, bad credentials show an alert, a joint customer sees only the shared account, and a customer is refused by the operations console.',
    description: 'Runs against the seeded database with the non-secret demo personas. The customer half drives `/login`, the dashboard and the header\'s Log out button.',
    tags: ['tests', 'auth', 'rbac', 'e2e'],
    tech: ['Playwright'],
    sources: [
      repo('e2e/auth.spec.ts', 28, 61, 'customer authentication'),
      repo('e2e/auth.spec.ts', 63, 78, 'a customer is rejected from the staff-only operations console'),
    ],
  },
  {
    id: 'test:e2e/dashboard.spec.ts',
    kind: 'test',
    name: 'e2e/dashboard.spec.ts',
    parent: 'tests',
    summary: 'Browser tests for the dashboard, account detail, transaction search and filter, the statements page, scroll behaviour and the signed-in versions of public entry points.',
    tags: ['tests', 'ui', 'money', 'e2e'],
    tech: ['Playwright'],
    sources: [
      repo('e2e/dashboard.spec.ts', 20, 48, 'overview shows the cash headline'),
      repo('e2e/dashboard.spec.ts', 64, 78, 'search and status filter narrow the transaction list'),
      repo('e2e/dashboard.spec.ts', 94, 141, 'navigation & session-aware entry points'),
    ],
  },
  {
    id: 'test:e2e/money-movement.spec.ts',
    kind: 'test',
    name: 'e2e/money-movement.spec.ts',
    parent: 'tests',
    summary: 'Browser tests for money movement end to end: an instant transfer, a check deposit queued for review, the dashboard quick link, and an operator approving then reversing a movement.',
    tags: ['tests', 'money', 'operations', 'e2e'],
    tech: ['Playwright'],
    sources: [
      repo('e2e/money-movement.spec.ts', 33, 65, 'a customer transfers money between their own accounts'),
      repo('e2e/money-movement.spec.ts', 74, 104, 'an operator sees the movement context'),
    ],
  },
  {
    id: 'test:e2e/public-site.spec.ts',
    kind: 'test',
    name: 'e2e/public-site.spec.ts',
    parent: 'tests',
    summary: 'Browser tests for the public site: the home page, every marketing page via the primary nav, the open-account form\'s presence, and the mobile menu.',
    tags: ['tests', 'ui', 'e2e'],
    tech: ['Playwright'],
    sources: [repo('e2e/public-site.spec.ts', 8, 89, 'public marketing site')],
  },
  {
    id: 'test:e2e/session-isolation.spec.ts',
    kind: 'test',
    name: 'e2e/session-isolation.spec.ts',
    parent: 'tests',
    summary: 'Regression test that an operator session in one tab never shows through in the customer portal in another tab of the same browser.',
    description: 'Both apps run on `localhost` (different ports) and cookies are not isolated by port, so the test opens both in ONE browser context. After the customer logs out, `/dashboard` must redirect to `/login` even though an operations session cookie is still present, and the operations console must keep working.',
    tags: ['tests', 'auth', 'security', 'e2e'],
    tech: ['Playwright'],
    sources: [repo('e2e/session-isolation.spec.ts', 11, 63, 'an operations login never bleeds into the customer portal')],
  },
  {
    id: 'test:e2e/smoke.spec.ts',
    kind: 'test',
    name: 'e2e/smoke.spec.ts',
    parent: 'tests',
    summary: 'Shallow checks that both apps load, show their simulation disclaimer, and that `/dashboard` redirects a logged-out visitor to `/login`.',
    tags: ['tests', 'e2e'],
    tech: ['Playwright'],
    sources: [repo('e2e/smoke.spec.ts', 9, 24, 'the dashboard is protected and redirects unauthenticated visitors to login')],
  },
];

const t = (from: string, to: string, label: string, file: string, start: number, end: number, symbol: string, n?: number): Relation =>
  rel(from, to, 'tests', { label, sources: [repo(file, start, end, symbol)] }, n);

const TL = 'test:apps/customer/src/components/TransactionList.test.tsx';
const TLF = `${UNIT}components/TransactionList.test.tsx`;
const PD = 'test:apps/customer/src/components/PublicDemoNotice.test.tsx';
const PDF = `${UNIT}components/PublicDemoNotice.test.tsx`;
const AD = 'test:apps/customer/src/lib/account-display.test.ts';
const ADF = `${UNIT}lib/account-display.test.ts`;
const CT = 'test:apps/customer/src/lib/cta.test.ts';
const CTF = `${UNIT}lib/cta.test.ts`;

export const testRelations: Relation[] = [
  // ---- Unit / component tests -------------------------------------------------
  t(TL, 'cu:components/TransactionList', 'grouping, running balance, filters, dispute affordance', TLF, 78, 173, 'filters to pending only via the status select'),
  t(PD, 'cu:components/PublicDemoNotice', 'hidden locally, shown in public-demo mode', PDF, 28, 54, 'renders nothing in ordinary local development'),
  t(PD, 'cu:lib/public-demo#usePublicDemo', 'backend flag drives the hook', PDF, 6, 9, "vi.mock('../lib/useApiStatus'"),
  t(AD, 'cu:lib/account-display#groupAccounts', 'cash vs lending split, order preserved, no mutation', ADF, 72, 105, 'does not mutate the input array'),
  t(AD, 'cu:lib/account-display#savingsApyNote', 'note only for savings', ADF, 107, 122, 'returns a simulated APY note only for savings'),
  t(AD, 'cu:lib/account-display#formatSignedMinor', 'explicit +/- sign, zero is +', ADF, 133, 142, 'treats zero as a positive sign'),
  t(CT, 'cu:lib/cta#resolveCtas', 'collapse auth CTAs when logged in', CTF, 28, 71, 'returns the list unchanged when logged out'),

  // ---- e2e/auth.spec.ts -------------------------------------------------------
  t('test:e2e/auth.spec.ts', 'cu:pages/Login', 'valid login redirects; invalid credentials show an alert and stay on /login', 'e2e/auth.spec.ts', 28, 49, 'invalid credentials show an error and do not sign in'),
  t('test:e2e/auth.spec.ts', 'cu:pages/Dashboard', 'customer sees own accounts; joint customer sees only the shared one', 'e2e/auth.spec.ts', 29, 60, 'a joint customer sees only the shared account (RBAC)'),
  t('test:e2e/auth.spec.ts', 'cu:components/SiteLayout', 'Log out returns to the logged-out header', 'e2e/auth.spec.ts', 39, 42, 'log out'),

  // ---- e2e/dashboard.spec.ts --------------------------------------------------
  t('test:e2e/dashboard.spec.ts', 'cu:pages/Dashboard', 'cash headline, Loans & CDs section, savings APY note, links into detail', 'e2e/dashboard.spec.ts', 21, 48, 'total available cash'),
  t('test:e2e/dashboard.spec.ts', 'cu:pages/AccountDetail', 'pending vs posted transactions on the detail page', 'e2e/dashboard.spec.ts', 50, 62, 'account detail shows pending vs posted transactions and a running balance'),
  t('test:e2e/dashboard.spec.ts', 'cu:components/TransactionList', 'search and status filter narrow the list', 'e2e/dashboard.spec.ts', 64, 78, 'search and status filter narrow the transaction list'),
  t('test:e2e/dashboard.spec.ts', 'cu:pages/Statements', 'reachable from the quick link; shows monthly statements', 'e2e/dashboard.spec.ts', 80, 90, 'monthly statements'),
  t('test:e2e/dashboard.spec.ts', 'cu:components/ScrollToTop', 'scroll resets on navigation; #security deep link scrolls to the section', 'e2e/dashboard.spec.ts', 95, 118, 'navigating to another page scrolls back to the top (R-01)'),
  t('test:e2e/dashboard.spec.ts', 'cu:lib/cta#resolveCtas', 'signed-in visitors get "Visit your Dashboard" instead of Log in CTAs', 'e2e/dashboard.spec.ts', 120, 128, 'visit your dashboard'),
  t('test:e2e/dashboard.spec.ts', 'cu:pages/Login', 'already-signed-in panel; logging out from it returns the form', 'e2e/dashboard.spec.ts', 130, 140, 'already signed in'),

  // ---- e2e/money-movement.spec.ts ---------------------------------------------
  t('test:e2e/money-movement.spec.ts', 'cu:pages/MoveMoney', 'transfer completes with new balances; check deposit is queued with a MOV- reference', 'e2e/money-movement.spec.ts', 34, 65, 'transfer complete'),
  t('test:e2e/money-movement.spec.ts', 'cu:pages/Dashboard', 'quick link routes to Move money', 'e2e/money-movement.spec.ts', 67, 72, 'the dashboard quick links route to Move money'),

  // ---- e2e/public-site.spec.ts ------------------------------------------------
  t('test:e2e/public-site.spec.ts', 'cu:pages/MarketingHome', 'hero, product highlights and the simulation disclaimer', 'e2e/public-site.spec.ts', 9, 16, 'home page renders the hero, products, and simulation disclaimer'),
  t('test:e2e/public-site.spec.ts', 'cu:pages/Checking', 'reachable from the primary nav', 'e2e/public-site.spec.ts', 18, 24, 'checking that stays out of your way'),
  t('test:e2e/public-site.spec.ts', 'cu:pages/Savings', 'reachable from the primary nav', 'e2e/public-site.spec.ts', 26, 28, 'save with intention'),
  t('test:e2e/public-site.spec.ts', 'cu:pages/Cards', 'presented as a shipped, clearly simulated feature', 'e2e/public-site.spec.ts', 46, 55, 'live in the portal today'),
  t('test:e2e/public-site.spec.ts', 'cu:pages/Borrow', 'shows the CD rate table', 'e2e/public-site.spec.ts', 57, 63, 'certificate of deposit rates'),
  t('test:e2e/public-site.spec.ts', 'cu:pages/About', 'reachable from the primary nav', 'e2e/public-site.spec.ts', 41, 43, 'a bank you can read like a book'),
  t('test:e2e/public-site.spec.ts', 'cu:pages/OpenAccount', 'form is present and links to sign-in', 'e2e/public-site.spec.ts', 66, 77, 'submit simulated application'),
  t('test:e2e/public-site.spec.ts', 'cu:components/SiteLayout', 'primary nav and the mobile menu', 'e2e/public-site.spec.ts', 79, 88, 'the mobile menu opens and navigates'),

  // ---- e2e/session-isolation.spec.ts ------------------------------------------
  t('test:e2e/session-isolation.spec.ts', 'cu:components/RequireAuth', 'after customer log-out, /dashboard redirects to /login even with an operator signed in', 'e2e/session-isolation.spec.ts', 45, 56, 'toHaveURL(/\\/login$/)'),
  t('test:e2e/session-isolation.spec.ts', 'cu:lib/AuthProvider', 'hydration picks the customer session, never the operations one', 'e2e/session-isolation.spec.ts', 41, 43, 'welcome back, avery'),

  // ---- e2e/smoke.spec.ts ------------------------------------------------------
  t('test:e2e/smoke.spec.ts', 'cu:components/RequireAuth', 'unauthenticated /dashboard → /login', 'e2e/smoke.spec.ts', 17, 23, 'the dashboard is protected and redirects unauthenticated visitors to login'),
  t('test:e2e/smoke.spec.ts', 'cu:pages/MarketingHome', 'loads with the simulation disclaimer', 'e2e/smoke.spec.ts', 10, 15, 'marketing home loads with a simulation disclaimer'),

  // ---- Specs defined by other slices, exercising customer pages ---------------
  t('test:e2e/lending.spec.ts', 'cu:pages/Lending', 'lists seeded CD and loan with the simulated date; opens a 12-month CD', 'e2e/lending.spec.ts', 46, 91, 'a customer opens a new CD and sees it listed'),
  t('test:e2e/lending.spec.ts', 'cu:pages/AccountDetail', 'savings history shows a posted interest credit after the clock advances', 'e2e/lending.spec.ts', 119, 142, 'interest earned \\(simulated\\)'),
  t('test:e2e/scheduled-payments.spec.ts', 'cu:pages/ScheduledPayments', 'create a bill-pay schedule, see it listed, cancel it', 'e2e/scheduled-payments.spec.ts', 38, 69, 'a customer schedules a bill payment, sees it listed, then cancels it'),
  t('test:e2e/scheduled-payments.spec.ts', 'cu:pages/Dashboard', 'quick link routes to Scheduled payments', 'e2e/scheduled-payments.spec.ts', 71, 76, 'the dashboard quick link routes to Scheduled payments'),
  t('test:e2e/cards-fraud-disputes.spec.ts', 'cu:pages/Wallet', 'freeze a card and see it become Frozen', 'e2e/cards-fraud-disputes.spec.ts', 38, 50, 'a customer freezes a card in the wallet'),
  t('test:e2e/cards-fraud-disputes.spec.ts', 'cu:components/TransactionList', 'dispute a posted transaction; the row flips to Disputed', 'e2e/cards-fraud-disputes.spec.ts', 52, 64, 'a customer disputes a posted transaction'),
  t('test:e2e/onboarding.spec.ts', 'cu:pages/OpenAccount', 'a visitor submits an application and gets a MER- reference', 'e2e/onboarding.spec.ts', 35, 51, 'a visitor can submit a simulated open-account application'),
  t('test:e2e/onboarding.spec.ts', 'cu:pages/Dashboard', 'a pending joint-owner invitation appears in the inbox with Accept / Decline', 'e2e/onboarding.spec.ts', 113, 121, 'a customer sees a pending joint-owner invitation in their inbox'),
];
