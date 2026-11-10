import type { Entity, Relation } from '../../types';
import { cu, cuFile, rel, repo } from './helpers';

/** Shared components of the customer app (`apps/customer/src/components/*`). */

export const componentEntities: Entity[] = [
  {
    id: 'cu:components/TransactionList',
    kind: 'component',
    name: 'TransactionList',
    parent: 'cu.ui',
    summary: 'The transaction history for one account: Pending / Posted / Other groups, instant search and filters, a running balance on posted rows, and an inline "Dispute" action.',
    description:
      'Props are `transactions: TransactionDTO[]` and `currency`. Everything it shows was computed by the server (signed amounts, ordering, the running balance); the component only presents, filters and collects a dispute.\n\nFiltering. Three controls — a search box, a status select (All / Pending / Posted) and a category select built from the origins actually present, sorted by label — feed one call to the shared `filterTransactions(transactions, { q, group, origin })`. That is the same function the API uses to honour `?q=&group=&origin=`, so client and server filtering cannot diverge; here it runs on every keystroke over the already-loaded list, with no request.\n\nGrouping. The filtered rows are split with the shared `groupForStatus`: `pending` + `held` → "Pending" (hint: "Not yet posted — may affect your available balance"); `posted` + `disputed` → "Posted"; `failed` + `reversed` → "Other" ("no balance effect"). Empty groups are not rendered; if nothing matches, a single "No transactions match your search." box is shown.\n\nRows. Description, date (`postedAt ?? createdAt`), a category chip (`originLabel`), a status badge for anything not in the posted group, and the signed amount (`+` credits in green). Only the Posted group passes `showRunningBalance`, and the balance line is drawn only when `runningBalanceMinor !== null` — the server sets it for settled entries only.\n\nDispute. A row offers "Dispute" when `txn.status === "posted"` and it has not been disputed. The inline form takes a reason from the shared `DISPUTE_REASONS` and optional details (max 280 characters), runs the shared `validateDispute` first, then calls `fileDispute`. On success the entry id is added to a local `disputedIds` set: the row immediately shows a "Disputed" badge and stops offering the action. The transaction list is not re-fetched — the parent\'s data still says `posted` until the page is reloaded — so this is a local, response-confirmed update, not a refresh. On failure, server `fields` go under the inputs and the message into an alert inside the form.',
    audience: {
      executive: 'The account activity list customers read, search and — when something looks wrong — dispute from.',
      'end-user': 'Your account activity. Search it, filter it by status or category, see your balance after each posted transaction, and dispute a posted charge you do not recognise.',
      systems: 'Pure client-side filtering over one fetched list; the only request it issues is `POST /api/disputes`.',
      dba: 'Read-only view over derived LedgerEntry data; the dispute action leads the server to flag one ledger entry `disputed`.',
    },
    tags: ['ui', 'ledger', 'money', 'risk', 'validation'],
    aliases: ['transaction history', 'transactions', 'activity', 'dispute form', 'running balance'],
    tech: ['React'],
    signature: "TransactionList({ transactions, currency = 'USD' }: { transactions: TransactionDTO[]; currency?: string }): JSX.Element",
    sources: [
      cu('components/TransactionList.tsx', 21, 28, 'Transaction history for one account'),
      cu('components/TransactionList.tsx', 270, 309, 'export function TransactionList', 'State, filter call, grouping'),
      cu('components/TransactionList.tsx', 46, 86, 'function DisputeForm', 'Inline dispute form and its submit handler'),
      cu('components/TransactionList.tsx', 166, 171, "txn.status === 'posted' && !disputed", 'When the Dispute action is offered'),
      cu('components/TransactionList.tsx', 200, 204, 'runningBalanceMinor !== null', 'Running balance only on settled rows'),
      cu('components/TransactionList.tsx', 368, 395, 'title="Pending"', 'The three group sections'),
      repo('packages/shared/src/transactions.ts', 59, 64, 'export function groupForStatus', 'Status → display group'),
    ],
  },
  {
    id: 'cu:components/SiteLayout',
    kind: 'component',
    name: 'SiteLayout',
    parent: 'cu.ui',
    summary: 'The page shell around every route: simulation banner, header with navigation and sign-in / log-out controls, the routed page, and the footer.',
    description:
      'Rendered by the pathless layout route in `App`. The header is session-aware through `useAuth()`: while the session is hydrating it shows neither set of controls; logged out it shows "Log in" and "Open account"; signed in it greets the user by `displayName`, adds a "Dashboard" link to the primary nav and offers "Log out".\n\n`handleLogout` closes the mobile menu, awaits `logout()` from the auth context (server revoke, then local clear) and navigates to `/`. Below the `lg` breakpoint the nav collapses into a toggle-controlled panel with the same links. A skip link and `<main id="main">` keep keyboard navigation sound.',
    audience: { 'end-user': 'The top bar and footer on every page, including the Log in / Log out button.' },
    tags: ['ui', 'auth', 'navigation'],
    aliases: ['header', 'nav bar', 'layout', 'shell', 'log out button'],
    sources: [
      cu('components/SiteLayout.tsx', 11, 33, 'export function SiteLayout', 'Doc comment, session-aware nav, handleLogout'),
      cu('components/SiteLayout.tsx', 67, 91, 'Log out', 'Desktop auth actions'),
      cu('components/SiteLayout.tsx', 153, 157, '<Outlet />', 'Where the routed page renders'),
    ],
  },
  {
    id: 'cu:components/SiteFooter',
    kind: 'component',
    name: 'SiteFooter',
    parent: 'cu.ui',
    summary: 'Footer with product and company links, the simulation notice, and the app version and milestone.',
    description: 'When signed in, "Open an account" and "Log in" collapse to a single "Visit your Dashboard" link, matching the marketing CTAs. Version text comes from the shared `APP_VERSION` / `MILESTONE` constants.',
    detail: 5,
    tags: ['ui', 'navigation'],
    sources: [cu('components/SiteFooter.tsx', 7, 20, 'export function SiteFooter')],
  },
  {
    id: 'cu:components/SimulationBanner',
    kind: 'component',
    name: 'SimulationBanner',
    parent: 'cu.ui',
    summary: 'The always-on bar at the top of every page stating that this is a simulation and not a real bank.',
    description: 'Shows the shared `BRAND.simulationNotice` and the milestone, then renders `PublicDemoNotice` in its banner variant directly underneath (visible only in public-demo mode).',
    tags: ['ui', 'public-demo'],
    aliases: ['disclaimer', 'not a real bank'],
    sources: [cu('components/SimulationBanner.tsx', 4, 26, 'export function SimulationBanner')],
  },
  {
    id: 'cu:components/PublicDemoNotice',
    kind: 'component',
    name: 'PublicDemoNotice',
    parent: 'cu.ui',
    summary: 'The "shared public demo" warning, rendered only when the build flag or the backend says this deployment is the public demo.',
    description:
      'Two variants. `banner` is the slim line under the simulation bar on every page. `form` is the prominent callout placed above the first input of the sign-in and open-account forms, warning visitors to use made-up details and a throwaway password before they type anything. The wording comes from the shared `PUBLIC_DEMO_NOTICE`. In ordinary local development `usePublicDemo()` is false and the component renders nothing.',
    audience: { 'end-user': 'A warning, shown on the public demo site, that other visitors share the same data and that it is reset regularly.' },
    tags: ['ui', 'public-demo', 'security'],
    aliases: ['shared demo warning'],
    sources: [
      cu('components/PublicDemoNotice.tsx', 15, 23, 'export function PublicDemoNotice'),
      cu('components/PublicDemoNotice.tsx', 5, 13, "variant?: 'banner' | 'form'", 'The two variants'),
    ],
  },
  {
    id: 'cu:components/BackendStatusPill',
    kind: 'component',
    name: 'BackendStatusPill',
    parent: 'cu.ui',
    summary: 'A small pill showing whether the backend answered `GET /status`: "Backend online · v1.0.0 · db ready" or "Backend offline".',
    description:
      'Reads `useApiStatus()`. While loading it says "Checking backend…"; with a status it shows the backend version and whether the database reported `connected`; with `null` it says "Backend offline (run npm run dev)". It appears on the marketing home page and on every portal page.\n\nIt is not live: the status is requested once when the page mounts (through a 15-second shared cache) and never again, and there is no socket behind it. A backend that goes down while a page is open leaves the pill green until the next navigation or reload.',
    tags: ['ui', 'integration'],
    aliases: ['status pill', 'backend online'],
    sources: [cu('components/BackendStatusPill.tsx', 4, 17, 'export function BackendStatusPill')],
  },
  {
    id: 'cu:components/ScrollToTop',
    kind: 'component',
    name: 'ScrollToTop',
    parent: 'cu.ui',
    summary: 'Renders nothing; on every route change it scrolls to the top, or to the `#hash` target when the URL has one.',
    detail: 5,
    tags: ['ui', 'navigation'],
    sources: [cu('components/ScrollToTop.tsx', 4, 22, 'export function ScrollToTop')],
  },
  {
    id: 'cu:components/marketing',
    kind: 'component',
    name: 'marketing (building blocks)',
    parent: 'cu.ui',
    summary: 'Presentational pieces shared by the public pages: `PageHero`, `Section`, `SectionHeading`, `FeatureGrid`, `FAQ`, `RateTable`, `CTASection`, `Icon`.',
    description: 'No data fetching. The one piece of behaviour: `PageHero` and `CTASection` read `useAuth()` and pass their buttons through `resolveCtas`, so a signed-in visitor sees "Visit your Dashboard" instead of "Log in" / "Open an account".',
    tags: ['ui', 'public'],
    aliases: ['PageHero', 'CTASection', 'FeatureGrid', 'RateTable'],
    sources: [
      cu('components/marketing.tsx', 9, 14, 'Shared building blocks for the public marketing site'),
      cu('components/marketing.tsx', 171, 195, 'export function PageHero', 'Session-aware hero CTAs'),
      cu('components/marketing.tsx', 310, 340, 'export function CTASection', 'Session-aware closing CTA band'),
    ],
  },
  {
    id: 'cu:components/Logo',
    kind: 'component',
    name: 'Logo',
    parent: 'cu.ui',
    summary: 'Inline SVG of the Meridian compass logo, with full / mark variants and a light tone for dark backgrounds.',
    detail: 5,
    tags: ['ui'],
    sources: [cu('components/Logo.tsx', 9, 14, 'export function Logo')],
  },
  {
    id: 'cu:components/ImagePlaceholder',
    kind: 'component',
    name: 'ImagePlaceholder',
    parent: 'cu.ui',
    summary: 'Shows the image at `src` if it loads, otherwise a branded gradient with a label.',
    detail: 5,
    tags: ['ui'],
    sources: [cu('components/ImagePlaceholder.tsx', 13, 18, 'export function ImagePlaceholder')],
  },
  {
    id: 'cu:components/ui/Button',
    kind: 'component',
    name: 'Button',
    parent: 'cu.ui',
    summary: 'The button primitive used by every page: `primary`, `secondary` or `ghost`, in three sizes.',
    detail: 5,
    tags: ['ui'],
    sources: [cu('components/ui/Button.tsx', 26, 27, 'export function Button')],
  },
  {
    id: 'cu:components/ui/Card',
    kind: 'component',
    name: 'Card',
    parent: 'cu.ui',
    summary: 'The bordered surface primitive (`Card`, `CardTitle`, `CardDescription`) that portal pages build their panels from.',
    detail: 5,
    tags: ['ui'],
    sources: [cu('components/ui/Card.tsx', 8, 9, 'export function Card')],
  },
];

export const componentRelations: Relation[] = [
  // ---- TransactionList --------------------------------------------------------
  rel('cu:components/TransactionList', 'sh:transactions#filterTransactions', 'calls', {
    label: 'filterTransactions(transactions, { q, group, origin })',
    summary: 'Instant client-side search and filtering with the same shared function the API uses for query parameters.',
    order: 1,
    sources: [cu('components/TransactionList.tsx', 297, 305, 'filterTransactions(transactions, {')],
  }),
  rel('cu:components/TransactionList', 'sh:transactions#groupForStatus', 'calls', {
    label: 'groupForStatus(t.status)',
    summary: 'Splits the filtered rows into the Pending, Posted and Other sections.',
    order: 2,
    sources: [cu('components/TransactionList.tsx', 307, 309, 'groupForStatus(t.status)')],
  }),
  rel('cu:components/TransactionList', 'sh:risk#validateDispute', 'calls', {
    label: 'validateDispute({ ledgerEntryId, reason, details })',
    summary: 'Client-side validation before the request; errors are shown under the reason and details inputs.',
    order: 3,
    sources: [cu('components/TransactionList.tsx', 67, 76, 'validateDispute({ ledgerEntryId, reason, details })')],
  }),
  rel('cu:components/TransactionList', 'cu:lib/risk#fileDispute', 'calls', {
    label: 'fileDispute(check.value)',
    summary: 'Submits the validated dispute; on success the row is marked disputed locally without re-fetching the list.',
    description: 'On `ok: false` the handler sets `errors` from `result.fields` and shows `result.message` in an alert inside the form; on success it calls `onDisputed()`, which adds the entry id to the list\'s `disputedIds` set.',
    order: 4,
    sources: [
      cu('components/TransactionList.tsx', 67, 86, 'await fileDispute(check.value)', 'DisputeForm.handleSubmit'),
      cu('components/TransactionList.tsx', 280, 288, 'const markDisputed', 'Local "disputed in this session" set'),
    ],
  }),
  rel('cu:components/TransactionList', 'sh:transactions#TransactionDTO', 'uses-type', {
    label: 'transactions: TransactionDTO[]',
    sources: [cu('components/TransactionList.tsx', 270, 276, 'transactions: TransactionDTO[]')],
  }),
  rel('cu:components/TransactionList', 'sh:risk#DISPUTE_REASONS', 'uses-type', {
    label: 'DISPUTE_REASONS.map(...)',
    summary: 'The reason dropdown is generated from the shared list, so the options always match what the server accepts.',
    detail: 5,
    sources: [cu('components/TransactionList.tsx', 113, 118, 'DISPUTE_REASONS.map')],
  }),
  rel('cu:components/TransactionList', 'cu:lib/account-display#formatSignedMinor', 'calls', {
    label: 'formatSignedMinor(txn.signedAmountMinor, currency)',
    detail: 5,
    sources: [cu('components/TransactionList.tsx', 192, 199, 'formatSignedMinor(txn.signedAmountMinor, currency)')],
  }),
  rel('cu:components/TransactionList', 'cu:lib/account-display#TXN_STATUS_META', 'uses-type', {
    label: 'TXN_STATUS_META[status]',
    detail: 5,
    sources: [cu('components/TransactionList.tsx', 32, 34, 'TXN_STATUS_META[status]')],
  }),
  rel('cu:components/TransactionList', 'feat:accounts', 'implements', {
    label: 'searchable transaction history',
    sources: [cu('components/TransactionList.tsx', 21, 28, 'instant client-side search')],
  }),
  rel('cu:components/TransactionList', 'feat:disputes', 'implements', {
    label: 'customer files a dispute',
    sources: [cu('components/TransactionList.tsx', 46, 51, 'dispute this transaction')],
  }),

  // ---- Layout -----------------------------------------------------------------
  rel('cu:components/SiteLayout', 'cu:lib/auth-context#useAuth', 'calls', {
    label: 'useAuth()',
    summary: 'Reads `user`, `loading` and `logout` to render the session-aware header.',
    sources: [cu('components/SiteLayout.tsx', 21, 23, 'useAuth()')],
  }),
  rel('cu:components/SiteLayout', 'cu:lib/AuthProvider', 'calls', {
    label: 'logout()',
    summary: 'The "Log out" button awaits the context\'s `logout()` and then navigates home.',
    sources: [cu('components/SiteLayout.tsx', 29, 33, 'await logout()', 'handleLogout')],
  }),
  rel('cu:components/SiteLayout', 'cu:pages/MarketingHome', 'navigates', {
    label: 'after log out → /',
    summary: 'Logging out always lands on the public home page.',
    sources: [cu('components/SiteLayout.tsx', 29, 33, "navigate('/')")],
  }),
  rel('cu:components/SiteLayout', 'cu:pages/Login', 'navigates', {
    label: 'Log in → /login',
    detail: 4,
    sources: [cu('components/SiteLayout.tsx', 79, 89, 'to="/login"')],
  }),
  rel('cu:components/SiteLayout', 'cu:pages/OpenAccount', 'navigates', {
    label: 'Open account → /open-account',
    detail: 4,
    sources: [cu('components/SiteLayout.tsx', 79, 89, 'to="/open-account"')],
  }),
  rel('cu:components/SiteLayout', 'cu:pages/Dashboard', 'navigates', {
    label: 'Dashboard (signed in only)',
    summary: 'The Dashboard link is added to the nav only when a user is present.',
    detail: 4,
    sources: [cu('components/SiteLayout.tsx', 26, 27, "to: '/dashboard'")],
  }),
  rel('cu:components/SiteLayout', 'cu:lib/nav', 'uses-type', {
    label: 'PRIMARY_NAV',
    detail: 5,
    sources: [cu('components/SiteLayout.tsx', 26, 27, 'PRIMARY_NAV')],
  }),
  rel('cu:components/SiteLayout', 'cu:components/SimulationBanner', 'renders', {
    label: '<SimulationBanner />',
    sources: [cu('components/SiteLayout.tsx', 50, 50, '<SimulationBanner />')],
  }),
  rel('cu:components/SiteLayout', 'cu:components/SiteFooter', 'renders', {
    label: '<SiteFooter />',
    detail: 5,
    sources: [cu('components/SiteLayout.tsx', 157, 157, '<SiteFooter />')],
  }),
  rel('cu:components/SiteLayout', 'cu:components/Logo', 'renders', {
    label: '<Logo />',
    detail: 5,
    sources: [cu('components/SiteLayout.tsx', 54, 56, '<Logo')],
  }),
  rel('cu:components/SiteLayout', 'cu:components/ui/Button', 'renders', {
    label: '<Button>',
    detail: 5,
    sources: [cuFile('components/SiteLayout.tsx', "from './ui/Button'")],
  }),
  rel('cu:components/SiteFooter', 'cu:lib/auth-context#useAuth', 'calls', {
    label: 'useAuth()',
    detail: 5,
    sources: [cu('components/SiteFooter.tsx', 8, 20, 'useAuth()')],
  }),
  rel('cu:components/SiteFooter', 'cu:lib/nav', 'uses-type', {
    label: 'PRODUCT_NAV',
    detail: 5,
    sources: [cu('components/SiteFooter.tsx', 33, 39, 'PRODUCT_NAV.map')],
  }),
  rel('cu:components/SiteFooter', 'cu:components/Logo', 'renders', {
    label: '<Logo tone="light" />',
    detail: 5,
    sources: [cu('components/SiteFooter.tsx', 25, 27, '<Logo tone="light"')],
  }),

  // ---- Banners / status -------------------------------------------------------
  rel('cu:components/SimulationBanner', 'cu:components/PublicDemoNotice', 'renders', {
    label: '<PublicDemoNotice variant="banner" />',
    sources: [cu('components/SimulationBanner.tsx', 23, 23, '<PublicDemoNotice variant="banner" />')],
  }),
  rel('cu:components/SimulationBanner', 'sh:brand#BRAND', 'uses-type', {
    label: 'BRAND.simulationNotice',
    detail: 5,
    sources: [cu('components/SimulationBanner.tsx', 17, 20, 'BRAND.simulationNotice')],
  }),
  rel('cu:components/PublicDemoNotice', 'cu:lib/public-demo#usePublicDemo', 'calls', {
    label: 'usePublicDemo()',
    summary: 'Renders nothing unless the build flag or `GET /status` says this is the shared public demo.',
    sources: [cu('components/PublicDemoNotice.tsx', 21, 23, 'usePublicDemo()')],
  }),
  rel('cu:components/PublicDemoNotice', 'sh:public-demo#PUBLIC_DEMO_NOTICE', 'uses-type', {
    label: 'PUBLIC_DEMO_NOTICE.short / .beforeYouType',
    detail: 5,
    sources: [cu('components/PublicDemoNotice.tsx', 35, 36, 'PUBLIC_DEMO_NOTICE.beforeYouType')],
  }),
  rel('cu:components/BackendStatusPill', 'cu:lib/useApiStatus#useApiStatus', 'calls', {
    label: 'useApiStatus()',
    summary: 'One status request per mount; no polling and no socket.',
    sources: [cu('components/BackendStatusPill.tsx', 9, 17, 'useApiStatus()')],
  }),

  // ---- Marketing blocks -------------------------------------------------------
  rel('cu:components/marketing', 'cu:lib/cta#resolveCtas', 'calls', {
    label: 'resolveCtas(ctas, !!user)',
    summary: 'Hero and closing CTAs are rewritten for signed-in visitors.',
    sources: [
      cu('components/marketing.tsx', 190, 195, 'resolveCtas(ctas ?? [], !!user)', 'PageHero'),
      cu('components/marketing.tsx', 329, 340, 'resolveCtas(', 'CTASection'),
    ],
  }),
  rel('cu:components/marketing', 'cu:lib/auth-context#useAuth', 'calls', {
    label: 'useAuth()',
    detail: 5,
    sources: [cu('components/marketing.tsx', 190, 195, 'useAuth()')],
  }),
  rel('cu:components/marketing', 'cu:components/ImagePlaceholder', 'renders', {
    label: '<ImagePlaceholder />',
    detail: 5,
    sources: [cu('components/marketing.tsx', 222, 232, '<ImagePlaceholder')],
  }),
  rel('cu:components/marketing', 'cu:components/ui/Button', 'renders', {
    label: '<Button>',
    detail: 5,
    sources: [cuFile('components/marketing.tsx', "from './ui/Button'")],
  }),
  rel('cu:components/TransactionList', 'cu:components/ui/Button', 'renders', {
    label: '<Button>',
    detail: 5,
    sources: [cuFile('components/TransactionList.tsx', "from './ui/Button'")],
  }),
];
