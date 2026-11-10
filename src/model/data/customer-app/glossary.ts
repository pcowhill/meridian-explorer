import type { GlossaryTerm } from '../../types';

/** Terms a newcomer needs to follow how the customer frontend works. */
export const customerGlossary: GlossaryTerm[] = [
  {
    term: 'Single-page app (SPA)',
    definition:
      'A website delivered as one HTML page plus a JavaScript bundle; moving between screens swaps components in the browser instead of loading new pages from the server. The customer app is an SPA built with React and react-router: the address bar changes (`/dashboard`, `/move-money`) but the only requests to the backend are `fetch` calls for data.',
    related: ['cu:App', 'customer'],
    aliases: ['SPA', 'client-side routing', 'BrowserRouter'],
  },
  {
    term: 'Protected route',
    definition:
      'A client route that is only rendered for a signed-in user. In the customer app each portal route is wrapped in `<RequireAuth>`, which waits for session hydration and then either renders the page or redirects to `/login`, remembering the path that was requested. It is a convenience for the user, not the security boundary — the API checks the session on every request.',
    related: ['cu:components/RequireAuth', 'cu:App', 'cu:pages/Login'],
    aliases: ['route guard', 'RequireAuth', 'auth guard'],
  },
  {
    term: 'Session hydration',
    definition:
      'Working out, when the app loads, whether the browser already holds a valid session. The session lives in an httpOnly cookie that JavaScript cannot read, so `AuthProvider` asks the server with `GET /api/auth/me` and stores the answer. Until it returns, `loading` is true and guarded pages show "Checking your session…". A 401 and an unreachable backend both hydrate to "logged out".',
    related: ['cu:lib/AuthProvider', 'cu:lib/auth#fetchMe', 'cu:lib/auth-context#AuthContextValue'],
    aliases: ['auth bootstrap', 'who am I', 'restore session'],
  },
  {
    term: 'API base URL resolution',
    definition:
      'How the frontend decides which origin its requests go to. One shared pure function, `resolveApiBaseUrl`, applies three rules in order: an explicit `VITE_API_URL` wins; otherwise a production build uses the page\'s own origin (the reverse proxy forwards `/api/*`, `/health` and `/status` to the backend); otherwise `http://localhost:3000`. The result is fixed when the bundle loads and prefixes every request path.',
    related: ['cu:lib/api', 'cu:lib/api#API_URL'],
    aliases: ['API_URL', 'VITE_API_URL', 'same-origin API', 'backend URL'],
  },
  {
    term: 'CSRF header echo',
    definition:
      'The client half of the double-submit CSRF defence. The backend sets a cookie that page JavaScript can read (`mer_csrf`); the app copies its value into the `x-meridian-csrf` header of every request it builds. The backend rejects an authenticated state-changing request whose header does not match the cookie. Another website can make the browser send the cookie but cannot read it or add the header.',
    related: ['cu:lib/csrf', 'cu:lib/csrf#csrfHeaders', 'cu:lib/auth#jsonInit'],
    aliases: ['double-submit token', 'x-meridian-csrf', 'mer_csrf', 'CSRF token'],
  },
  {
    term: 'Discriminated result',
    definition:
      'The return shape of the API client functions: `{ ok: true, data }` or `{ ok: false, code, message, fields? }`. The functions never throw — a network failure becomes `code: "network_error"` — so pages branch on `ok` instead of using try/catch, put `fields` under the matching form inputs and show `message` in a banner.',
    related: ['cu:lib/money#MoneyResult', 'cu:lib/auth#LoginResult'],
    aliases: ['result type', 'never throws', 'MoneyResult', 'error envelope'],
  },
  {
    term: 'Client-side pre-validation',
    definition:
      'Running the shared validator (`validateTransfer`, `validateCreateSchedule`, `validateOpenAccount`, …) in the browser before sending a request. It is the same function the server runs, so field messages are identical and a request that would fail validation is normally never sent. The server still validates again and can add errors only it can know, such as an email that is already registered.',
    related: ['cu:pages/MoveMoney', 'cu:pages/OpenAccount', 'cu:pages/Lending', 'cu:pages/ScheduledPayments', 'cu:components/TransactionList'],
    aliases: ['shared validators', 'form validation', 'pre-submit validation'],
  },
  {
    term: 'Response-driven update',
    definition:
      'How the portal pages keep their lists current after an action. The app does not use optimistic updates: nothing changes on screen until the server has answered. On success the page patches its local state from the response body (a frozen card replaces the old one, a new schedule is prepended, a disputed row gets its badge) rather than re-fetching the list. Only two places re-fetch: Loans & CDs reloads accounts after any lending action, and the dashboard reloads accounts after an invitation is accepted.',
    related: ['cu:pages/Wallet', 'cu:pages/Lending', 'cu:pages/ScheduledPayments', 'cu:components/TransactionList', 'cu:pages/Dashboard'],
    aliases: ['optimistic refresh', 'optimistic update', 'local state patch', 'refresh after mutation'],
  },
  {
    term: 'Router state hand-off',
    definition:
      'Passing a small piece of context to the next screen through react-router\'s `location.state` instead of the URL. Three uses: `RequireAuth` passes `{ from }` so Login can return the visitor to the page they asked for; dashboard quick links pass `{ tab }` so Move money opens on the right tab; Account detail passes `{ accountId }` so Move money lists that account first. The state is lost on a full page reload.',
    related: ['cu:components/RequireAuth', 'cu:pages/Login', 'cu:pages/MoveMoney', 'cu:pages/AccountDetail'],
    aliases: ['location.state', 'navigation state', 'return path'],
  },
  {
    term: 'Graceful degradation (offline states)',
    definition:
      'Every data section of the customer app has explicit loading, failed and empty renderings. API clients return `null` or an error result instead of throwing, so a stopped backend produces "… unavailable. The backend may be offline" cards, a red status pill and a logged-out header — never a blank page. Public pages render fully without the API.',
    related: ['cu:components/BackendStatusPill', 'cu:lib/api#fetchStatus', 'cu:pages/Dashboard'],
    aliases: ['offline state', 'backend offline', 'error states'],
  },
];
