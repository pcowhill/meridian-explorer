import type { Entity, Relation } from '../../types';
import { cu, cuFile, rel, repo } from './helpers';

/**
 * App shell + session plumbing of the customer app:
 * the route table, the auth context/provider, the route guard and the CSRF helper.
 */

export const sessionEntities: Entity[] = [
  {
    id: 'cu:App',
    kind: 'module',
    name: 'App (route table)',
    parent: 'customer',
    summary: 'The root component: one `<BrowserRouter>` with sixteen routes, all wrapped in the auth provider and the site layout.',
    description:
      '`main.tsx` mounts `<App />` into `#root` inside `React.StrictMode`. `App` declares every client route in one place. Order of wrappers, outermost first: `BrowserRouter` → `ScrollToTop` (resets scroll on navigation) → `AuthProvider` (one shared session for the whole tree) → `Routes` → a pathless layout route rendering `SiteLayout` (banner, header, footer, `<Outlet/>`).\n\nEight routes are public (`/`, `/checking`, `/savings`, `/cards`, `/borrow`, `/about`, `/open-account`, `/login`). Seven are wrapped individually in `<RequireAuth>` (`/dashboard`, `/accounts/:id`, `/move-money`, `/wallet`, `/loans`, `/scheduled-payments`, `/statements`). `*` renders `NotFound`.\n\nThere is no code splitting, no data router and no global store: each page fetches its own data in a `useEffect` when it mounts. The customer app opens no Socket.IO connection anywhere — `socket.io-client` is listed in `package.json` but never imported, so every piece of data on screen comes from a `fetch`.',
    audience: {
      executive: 'The table of contents of the customer website: which address shows which screen, and which screens need a sign-in.',
      'end-user': 'Decides which screen you see for each web address, and sends you to the sign-in page when a screen needs an account.',
      systems: 'Client-side routing only (react-router `BrowserRouter`), so the host must serve `index.html` for every path. No WebSocket is opened by this app.',
    },
    tags: ['ui', 'routing', 'spa'],
    aliases: ['router', 'routes', 'route table', 'main.tsx', 'entry point'],
    tech: ['React 18', 'react-router-dom 6'],
    sources: [
      cu('App.tsx', 23, 51, 'export function App()', 'Route list comment + provider nesting'),
      cu('App.tsx', 52, 59, 'path="/open-account"', 'Public routes'),
      cu('App.tsx', 60, 116, '<RequireAuth>', 'Protected routes, each wrapped in RequireAuth'),
      cu('main.tsx', 6, 15, 'ReactDOM.createRoot', 'Mount point'),
      repo('apps/customer/package.json', 14, 22, 'socket.io-client', 'Declared but never imported under src/'),
    ],
  },

  // ---- Auth context + provider ----------------------------------------------
  {
    id: 'cu:lib/AuthProvider',
    kind: 'component',
    name: 'AuthProvider',
    parent: 'cu.session',
    summary: 'React context provider that holds the signed-in user, hydrates it once from `GET /api/auth/me`, and exposes `login`, `logout` and `refresh`.',
    description:
      'State is two values: `user: SessionUser | null` and `loading` (starts `true`).\n\nOn mount an effect calls `authApi.fetchMe()`; when it resolves the provider stores the user and flips `loading` to `false`. Because `fetchMe` returns `null` for a 401 and for an unreachable backend alike, both simply mean "logged out" — the public site still renders with the API down. An `active` flag guards against setting state after unmount (StrictMode mounts effects twice in development, so the request is issued twice there).\n\n`login(email, password)` delegates to `authApi.login` and stores `result.user` only when `result.ok`; the full discriminated result is returned so the Login page can show the error. `logout()` awaits `authApi.logout()` (which never throws) and then clears `user` unconditionally. `refresh()` re-runs `fetchMe`; nothing in the app calls it at this commit.\n\nThe session itself lives in an httpOnly cookie the JavaScript cannot read; this provider only caches what the server said about it. That first `GET /api/auth/me` is also what makes the backend issue the readable CSRF cookie used by later mutations.',
    audience: {
      executive: 'Remembers who is signed in so every screen agrees.',
      'end-user': 'Keeps you signed in when you reload the page, and signs you out everywhere in the app when you log out.',
      systems: 'No token in JS memory or localStorage: identity is re-derived from the httpOnly session cookie on each page load via one GET.',
    },
    detail: 3,
    tags: ['auth', 'security', 'state'],
    aliases: ['auth context', 'session state', 'session hydration', 'AuthProvider.tsx'],
    tech: ['React context'],
    signature: 'AuthProvider({ children }: { children: ReactNode }): JSX.Element',
    sources: [
      cu('lib/AuthProvider.tsx', 7, 17, 'export function AuthProvider', 'Doc comment + state'),
      cu('lib/AuthProvider.tsx', 24, 34, 'authApi.fetchMe()', 'Hydration effect'),
      cu('lib/AuthProvider.tsx', 36, 45, 'authApi.login(email, password)', 'login / logout callbacks'),
      cu('lib/AuthProvider.tsx', 47, 52, 'AuthContext.Provider', 'Memoised context value'),
    ],
  },
  {
    id: 'cu:lib/auth-context',
    kind: 'module',
    name: 'auth-context',
    parent: 'cu.session',
    summary: 'Defines the React context object, its value type and the `useAuth()` hook that every session-aware screen calls.',
    description:
      'Split out from `AuthProvider.tsx` so that file exports only a component (react-refresh\'s `only-export-components` rule). `AuthContext` is created with a `null` default; `useAuth()` throws if it is read outside `<AuthProvider>`, which turns a wiring mistake into an immediate error instead of a silently logged-out UI.',
    tags: ['auth', 'state'],
    aliases: ['useAuth', 'AuthContext'],
    tech: ['React context'],
    sources: [cu('lib/auth-context.ts', 5, 25, 'export const AuthContext')],
  },
  {
    id: 'cu:lib/auth-context#AuthContextValue',
    kind: 'type',
    name: 'AuthContextValue',
    parent: 'cu:lib/auth-context',
    summary: 'The shape every consumer of `useAuth()` receives: the user, a loading flag and three actions.',
    fields: [
      { name: 'user', type: 'SessionUser | null', required: true, description: 'The signed-in user, or null when logged out.', typeRef: 'sh:auth#SessionUser' },
      { name: 'loading', type: 'boolean', required: true, description: 'True until the initial `GET /api/auth/me` hydration completes.' },
      { name: 'login', type: '(email: string, password: string) => Promise<LoginResult>', required: true, description: 'Attempt a sign-in; on success the context user is populated.', typeRef: 'cu:lib/auth#LoginResult' },
      { name: 'logout', type: '() => Promise<void>', required: true, description: 'Clear the session on the server, then locally.' },
      { name: 'refresh', type: '() => Promise<void>', required: true, description: 'Re-fetch the current user. Defined but not called anywhere at this commit.' },
    ],
    example: {
      user: { id: 'usr_avery', email: 'avery.customer@example.com', displayName: 'Avery Customer', role: 'customer' },
      loading: false,
    },
    sources: [cu('lib/auth-context.ts', 12, 23, 'export interface AuthContextValue')],
  },
  {
    id: 'cu:lib/auth-context#useAuth',
    kind: 'function',
    name: 'useAuth',
    parent: 'cu:lib/auth-context',
    summary: 'Hook that returns the auth context value, throwing if there is no `<AuthProvider>` above the caller.',
    description:
      'Used by `RequireAuth`, `SiteLayout`, `SiteFooter`, `Login`, `Dashboard`, the `Cards` and `Borrow` marketing pages, and the marketing `PageHero` / `CTASection` components (to swap "Log in" for "Visit your Dashboard").',
    signature: 'useAuth(): AuthContextValue',
    tags: ['auth'],
    sources: [cu('lib/auth-context.ts', 27, 34, 'export function useAuth')],
  },

  // ---- Route guard ----------------------------------------------------------
  {
    id: 'cu:components/RequireAuth',
    kind: 'component',
    name: 'RequireAuth',
    parent: 'cu.session',
    summary: 'Route guard: shows a spinner while the session hydrates, redirects to `/login` when there is no user, otherwise renders the page.',
    description:
      'Three outcomes, decided from `useAuth()`:\n\n1. `loading` — render "Checking your session…". This is what stops the login page flashing for someone who is already signed in.\n2. no `user` — `<Navigate to="/login" replace state={{ from: location.pathname }} />`. `replace` keeps the protected URL out of history; `from` lets Login send the visitor back after signing in.\n3. otherwise — render `children`.\n\nThis is a UX guard, not a security boundary. A visitor who bypassed it would still get 401 from every API call because the backend checks the session cookie on each request. Likewise, if a session expires while a protected page is open the guard does not notice (nothing re-checks `user`); the page\'s next fetch fails and the page shows its own "unavailable" state.',
    audience: {
      executive: 'The check at the door of the banking area: no sign-in, no entry.',
      'end-user': 'If you open a banking page without being signed in, you are taken to the sign-in page and returned afterwards.',
      systems: 'Client-side only; authorisation is enforced by the API on every request. The return path travels in router state (`location.state.from`), not in a query string.',
    },
    detail: 3,
    tags: ['auth', 'security', 'routing'],
    aliases: ['protected route', 'route guard', 'auth guard'],
    signature: 'RequireAuth({ children }: { children: ReactNode }): JSX.Element',
    sources: [
      cu('components/RequireAuth.tsx', 5, 13, 'export function RequireAuth'),
      cu('components/RequireAuth.tsx', 15, 31, '<Navigate to="/login" replace', 'Loading state, redirect, pass-through'),
    ],
  },

  // ---- CSRF -----------------------------------------------------------------
  {
    id: 'cu:lib/csrf',
    kind: 'module',
    name: 'csrf',
    parent: 'cu.session',
    summary: 'Reads the readable CSRF cookie and turns it into the request header the backend requires on state-changing calls.',
    description:
      'The backend uses a double-submit token. It sets a NON-httpOnly cookie (`mer_csrf`, `AUTH.csrfCookieName`) on safe GETs and on login — including the bootstrap `GET /api/auth/me`. Every POST from an authenticated session must carry the header `x-meridian-csrf` (`AUTH.csrfHeader`) with the same value, or the backend answers 403.\n\nThis module is the client half. `readCookie` (private) scans `document.cookie`; `csrfHeaders()` returns `{ "x-meridian-csrf": <token> }` or `{}`. It is never called directly by pages: each API client file has a private `jsonInit` helper that spreads `csrfHeaders()` into the headers of every request it builds, GETs included (the server ignores it there). That design means a new client function cannot forget the header.\n\nWhy it works as a defence: a page on another origin can neither read this site\'s cookie nor add a custom header without a CORS preflight, which the backend\'s origin allowlist refuses.',
    audience: {
      executive: 'A safeguard that stops other websites from making your browser perform banking actions behind your back.',
      systems: 'Double-submit cookie: `mer_csrf` (readable by page JS) echoed as the `x-meridian-csrf` request header on every fetch the API clients build.',
    },
    tags: ['security', 'auth', 'csrf'],
    aliases: ['x-meridian-csrf', 'mer_csrf', 'double submit', 'csrf token'],
    sources: [
      cu('lib/csrf.ts', 3, 18, 'CSRF double-submit token helper'),
      repo('packages/shared/src/auth.ts', 71, 81, "csrfHeader: 'x-meridian-csrf'", 'Cookie and header names'),
    ],
  },
  {
    id: 'cu:lib/csrf#csrfHeaders',
    kind: 'function',
    name: 'csrfHeaders',
    parent: 'cu:lib/csrf',
    summary: 'Returns the `x-meridian-csrf` header for the current token cookie, or an empty object when there is none.',
    description:
      'Reads `document.cookie` for `mer_csrf`, URL-decodes it and returns `{ [AUTH.csrfHeader]: token }`. Returns `{}` when the cookie is absent (the very first request, which is the one that makes the server issue it) or when there is no `document` (unit tests), so it is always safe to spread: `headers: { ...csrfHeaders(), ... }`.\n\nThe value is read fresh on every call, so a token rotated by the server (for example at login) is picked up by the next request without any client state.',
    signature: 'csrfHeaders(): Record<string, string>',
    detail: 3,
    tags: ['security', 'csrf'],
    example: { 'x-meridian-csrf': '9f2c…e1 (value of the mer_csrf cookie)' },
    sources: [
      cu('lib/csrf.ts', 34, 42, 'export function csrfHeaders'),
      cu('lib/csrf.ts', 20, 32, 'function readCookie', 'Private cookie reader'),
    ],
  },
];

const PUBLIC_ROUTES: [page: string, path: string, line: number][] = [
  ['MarketingHome', '/', 52],
  ['Checking', '/checking', 53],
  ['Savings', '/savings', 54],
  ['Cards', '/cards', 55],
  ['Borrow', '/borrow', 56],
  ['About', '/about', 57],
  ['OpenAccount', '/open-account', 58],
  ['Login', '/login', 59],
];
const PROTECTED_ROUTES: [page: string, path: string, start: number, end: number][] = [
  ['Dashboard', '/dashboard', 60, 67],
  ['AccountDetail', '/accounts/:id', 68, 75],
  ['MoveMoney', '/move-money', 76, 83],
  ['Wallet', '/wallet', 84, 91],
  ['Lending', '/loans', 92, 99],
  ['ScheduledPayments', '/scheduled-payments', 100, 107],
  ['Statements', '/statements', 108, 115],
];

export const sessionRelations: Relation[] = [
  // ---- Route table ----------------------------------------------------------
  rel('cu:App', 'cu:lib/AuthProvider', 'renders', {
    label: '<AuthProvider>',
    summary: 'The whole route tree sits inside one AuthProvider, so the header and every page share a single session.',
    order: 1,
    sources: [cu('App.tsx', 47, 51, '<AuthProvider>')],
  }),
  rel('cu:App', 'cu:components/SiteLayout', 'renders', {
    label: '<Route element={<SiteLayout />}>',
    summary: 'A pathless layout route gives every page the same banner, header and footer.',
    order: 2,
    sources: [cu('App.tsx', 50, 52, '<Route element={<SiteLayout />}>')],
  }),
  rel('cu:App', 'cu:components/ScrollToTop', 'renders', {
    label: '<ScrollToTop />',
    summary: 'Rendered once just inside the router.',
    detail: 5,
    sources: [cu('App.tsx', 47, 49, '<ScrollToTop />')],
  }),
  rel('cu:App', 'cu:components/RequireAuth', 'renders', {
    label: '<RequireAuth> ×7',
    summary: 'Each of the seven portal routes is individually wrapped in the guard.',
    order: 3,
    sources: [cu('App.tsx', 60, 67, '<RequireAuth>')],
  }),
  ...PUBLIC_ROUTES.map(([page, path, line]) =>
    rel('cu:App', `cu:pages/${page}`, 'renders', {
      label: `path="${path}"`,
      summary: `Public route ${path} renders ${page}.`,
      detail: 4,
      sources: [cu('App.tsx', line, line, `path="${path}"`)],
    }),
  ),
  ...PROTECTED_ROUTES.map(([page, path, start, end]) =>
    rel('cu:App', `cu:pages/${page}`, 'renders', {
      label: `path="${path}" (RequireAuth)`,
      summary: `Protected route ${path} renders ${page} inside RequireAuth.`,
      detail: 4,
      sources: [cu('App.tsx', start, end, `path="${path}"`)],
    }),
  ),
  rel('cu:App', 'cu:pages/NotFound', 'renders', {
    label: 'path="*"',
    summary: 'Any unmatched path renders the 404 page.',
    detail: 5,
    sources: [cu('App.tsx', 116, 116, 'path="*"')],
  }),

  // ---- Provider → API client -------------------------------------------------
  rel('cu:lib/AuthProvider', 'cu:lib/auth#fetchMe', 'calls', {
    label: 'authApi.fetchMe()',
    summary: 'Session hydration: once on mount (and again from `refresh()`), ask the server who the cookie belongs to.',
    description: 'A `null` result — 401 or network failure — is stored as "logged out"; `loading` flips to false either way.',
    order: 1,
    sources: [cu('lib/AuthProvider.tsx', 19, 34, 'authApi.fetchMe()')],
  }),
  rel('cu:lib/AuthProvider', 'cu:lib/auth#login', 'calls', {
    label: 'authApi.login(email, password)',
    summary: 'Delegates the sign-in and caches `result.user` only when `result.ok`.',
    order: 2,
    sources: [cu('lib/AuthProvider.tsx', 36, 40, 'authApi.login(email, password)')],
  }),
  rel('cu:lib/AuthProvider', 'cu:lib/auth#logout', 'calls', {
    label: 'authApi.logout()',
    summary: 'Revokes the session on the server (best effort), then clears the cached user regardless of the outcome.',
    order: 3,
    sources: [cu('lib/AuthProvider.tsx', 42, 45, 'authApi.logout()')],
  }),
  rel('cu:lib/AuthProvider', 'cu:lib/auth-context#AuthContextValue', 'uses-type', {
    label: 'provides AuthContextValue',
    detail: 5,
    sources: [cu('lib/AuthProvider.tsx', 47, 52, 'useMemo<AuthContextValue>')],
  }),
  rel('cu:lib/AuthProvider', 'sh:auth#SessionUser', 'uses-type', {
    label: 'user: SessionUser | null',
    detail: 5,
    sources: [cu('lib/AuthProvider.tsx', 15, 17, 'useState<SessionUser | null>')],
  }),
  rel('cu:lib/auth-context#useAuth', 'cu:lib/AuthProvider', 'calls', {
    label: 'useContext(AuthContext)',
    summary: 'The hook reads the value the nearest AuthProvider put on the context.',
    confidence: 'simplified',
    detail: 4,
    sources: [cu('lib/auth-context.ts', 27, 34, 'useContext(AuthContext)')],
  }),

  // ---- Guard ----------------------------------------------------------------
  rel('cu:components/RequireAuth', 'cu:lib/auth-context#useAuth', 'calls', {
    label: 'useAuth()',
    summary: 'Reads `user` and `loading` to decide between spinner, redirect and page.',
    sources: [cu('components/RequireAuth.tsx', 11, 13, 'useAuth()')],
  }),
  rel('cu:components/RequireAuth', 'cu:pages/Login', 'navigates', {
    label: 'redirect → /login (state.from)',
    summary: 'No user after hydration: replace the URL with `/login`, remembering the path that was asked for.',
    sources: [cu('components/RequireAuth.tsx', 27, 29, 'state={{ from: location.pathname }}')],
  }),
  rel('cu:components/RequireAuth', 'feat:auth', 'implements', {
    label: 'protected routes',
    sources: [cu('components/RequireAuth.tsx', 5, 10, 'Gate for authenticated routes')],
  }),
  rel('cu:lib/AuthProvider', 'feat:auth', 'implements', {
    label: 'client session state',
    sources: [cu('lib/AuthProvider.tsx', 7, 14, 'hydrates the')],
  }),

  // ---- CSRF -----------------------------------------------------------------
  rel('cu:lib/csrf#csrfHeaders', 'sh:auth#AUTH', 'uses-type', {
    label: 'AUTH.csrfCookieName / AUTH.csrfHeader',
    summary: 'Cookie and header names come from the shared constants, so client and server cannot drift.',
    sources: [cu('lib/csrf.ts', 39, 42, 'AUTH.csrfCookieName')],
  }),
  rel('cu:lib/csrf#csrfHeaders', 'feat:csrf', 'implements', {
    label: 'client half of double-submit',
    sources: [cuFile('lib/csrf.ts', 'double-submit')],
  }),
];
