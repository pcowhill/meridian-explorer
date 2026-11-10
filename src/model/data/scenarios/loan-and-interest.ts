import type { Scenario, ScenarioStep, SourceRef, StateEffect } from '../../types';
import { IDS, NOW, baseState } from '../fixtures';

/**
 * "How do loans, CDs and interest work?"
 *
 * Avery opens a $1,000.00 12-month loan (or a $2,000.00 6-month CD) on the
 * Loans & CDs page. Opening moves money only as a net-zero pair of `transfer`
 * legs; the loan account then carries a NEGATIVE derived balance. When Sam
 * advances the simulation clock, the accrual driver posts bank-originated
 * `interest` entries (a debit on the loan, a credit on a CD or savings). Loan
 * payments and the matured-CD withdrawal are again `transfer` pairs.
 *
 * The clock starts at the seed instant NOW (2026-10-01T15:00Z); savings interest
 * is bookmarked there, as the seed does.
 */

const src = (file: string, start: number, end: number, symbol: string, note?: string): SourceRef =>
  note ? { file, start, end, symbol, note } : { file, start, end, symbol };

const F = {
  page: 'apps/customer/src/pages/Lending.tsx',
  lib: 'apps/customer/src/lib/lending.ts',
  route: 'apps/backend/src/routes/lending.ts',
  svc: 'apps/backend/src/lending/lending.ts',
  accrual: 'apps/backend/src/lending/accrual.ts',
  sh: 'packages/shared/src/lending.ts',
  clockRoute: 'apps/backend/src/routes/clock.ts',
  clock: 'apps/backend/src/clock/clock.ts',
  csrf: 'apps/backend/src/auth/csrf.ts',
  guards: 'apps/backend/src/auth/guards.ts',
  caps: 'packages/shared/src/public-demo.ts',
  ledger: 'packages/shared/src/ledger.ts',
  test: 'apps/backend/src/routes/lending.test.ts',
} as const;

// ---- Lanes ------------------------------------------------------------------
const AVERY = 'role:customer';
const PAGE = 'cu:pages/Lending';
const SH = 'sh:lending';
const LIB = 'cu:lib/lending';
const ROUTE = 'be:routes/lending';
const SVC = 'be:lending/lending';
const ACCRUAL = 'be:lending/accrual#runInterestAccrual';
const DB = 'db';
const SAM = 'role:ops_agent';

// ---- Variants -----------------------------------------------------------------
const LOAN = 'loan';
const CD = 'cd';
const NOFUNDS = 'cd-insufficient-funds';
type Product = typeof LOAN | typeof CD;

// ---- Example values -------------------------------------------------------------
const T_LOAN = '2026-11-01T15:00:00.000Z'; // NOW + 31 days
const T_CD = '2027-04-01T15:00:00.000Z'; // NOW + 182 days = the CD's maturity
const WALL = {
  open: '2026-10-01T15:03:20.000Z',
  advance: '2026-10-01T15:07:00.000Z',
  pay1: '2026-10-01T15:09:40.000Z',
  pay2: '2026-10-01T15:10:15.000Z',
  withdraw: '2026-10-01T15:09:40.000Z',
};
const CUSTOMER_HEADERS = {
  Cookie: 'mer_session=<opaque session token>; mer_csrf=<csrf token>',
  'x-meridian-csrf': '<csrf token>',
  'Content-Type': 'application/json',
};

// Loan rows.
const LOAN_ACCOUNT = { id: 'acc_loan', userId: IDS.avery, type: 'loan', name: 'Personal loan', currency: 'USD', status: 'active', openedAt: NOW, interestAccruedThrough: null, createdAt: NOW, updatedAt: WALL.open };
const LOAN_ACCESS = { id: 'acs_loan', userId: IDS.avery, accountId: 'acc_loan', relationship: 'owner', createdAt: NOW };
const LOAN_LEGS = [
  { id: 'le_201', accountId: 'acc_loan', amountMinor: 100000, direction: 'debit', status: 'posted', origin: 'transfer', description: 'Loan principal (amount financed)', postedAt: NOW, createdAt: NOW },
  { id: 'le_202', accountId: IDS.checking, amountMinor: 100000, direction: 'credit', status: 'posted', origin: 'transfer', description: 'Loan disbursement to Everyday Checking', postedAt: NOW, createdAt: NOW },
];
const LOAN_PRODUCT = { id: 'lp_loan', accountId: 'acc_loan', kind: 'loan', status: 'active', principalMinor: 100000, apyBps: 1200, termMonths: 12, paymentMinor: 8885, openedAt: NOW, maturesAt: '2027-10-01T15:00:00.000Z', lastAccruedAt: NOW, createdAt: WALL.open, updatedAt: WALL.open };
const LOAN_OPEN_AUDIT = {
  id: 'aud_301',
  actorId: IDS.avery,
  actorRole: 'customer',
  action: 'lending_open_loan',
  entity: 'lending_product',
  entityId: 'lp_loan',
  reason: 'Opened a $1,000.00 loan over 12 months at 12% APY (simulated)',
  metadata: JSON.stringify({ accountId: 'acc_loan', disbursementAccountId: IDS.checking, apyBps: 1200, termMonths: 12, paymentMinor: 8885, actorName: 'Avery Customer' }),
  createdAt: WALL.open,
};
const loanDto = (over: Record<string, unknown>) => ({
  id: 'lp_loan',
  kind: 'loan',
  status: 'active',
  accountId: 'acc_loan',
  accountName: 'Personal loan',
  apyBps: 1200,
  termMonths: 12,
  principalMinor: 100000,
  paymentMinor: 8885,
  openedAt: NOW,
  maturesAt: '2027-10-01T15:00:00.000Z',
  lastAccruedAt: NOW,
  balanceMinor: -100000,
  outstandingMinor: 100000,
  ...over,
});

// CD rows.
const CD_ACCOUNT = { id: 'acc_cd', userId: IDS.avery, type: 'cd', name: '6-month CD', currency: 'USD', status: 'active', openedAt: NOW, interestAccruedThrough: null, createdAt: NOW, updatedAt: WALL.open };
const CD_ACCESS = { id: 'acs_cd', userId: IDS.avery, accountId: 'acc_cd', relationship: 'owner', createdAt: NOW };
const CD_LEGS = [
  { id: 'le_201', accountId: IDS.checking, amountMinor: 200000, direction: 'debit', status: 'posted', origin: 'transfer', description: 'Opening deposit — 6-month CD', postedAt: NOW, createdAt: NOW },
  { id: 'le_202', accountId: 'acc_cd', amountMinor: 200000, direction: 'credit', status: 'posted', origin: 'transfer', description: 'CD opening deposit from Everyday Checking', postedAt: NOW, createdAt: NOW },
];
const CD_PRODUCT = { id: 'lp_cd', accountId: 'acc_cd', kind: 'cd', status: 'active', principalMinor: 200000, apyBps: 350, termMonths: 6, paymentMinor: null, openedAt: NOW, maturesAt: T_CD, lastAccruedAt: NOW, createdAt: WALL.open, updatedAt: WALL.open };
const CD_OPEN_AUDIT = {
  id: 'aud_301',
  actorId: IDS.avery,
  actorRole: 'customer',
  action: 'lending_open_cd',
  entity: 'lending_product',
  entityId: 'lp_cd',
  reason: 'Opened a 6-month CD for $2,000.00 at 3.5% APY (simulated)',
  metadata: JSON.stringify({ accountId: 'acc_cd', fundingAccountId: IDS.checking, apyBps: 350, termMonths: 6, actorName: 'Avery Customer' }),
  createdAt: WALL.open,
};
const cdDto = (over: Record<string, unknown>) => ({
  id: 'lp_cd',
  kind: 'cd',
  status: 'active',
  accountId: 'acc_cd',
  accountName: '6-month CD',
  apyBps: 350,
  termMonths: 6,
  principalMinor: 200000,
  paymentMinor: null,
  openedAt: NOW,
  maturesAt: T_CD,
  lastAccruedAt: NOW,
  balanceMinor: 200000,
  outstandingMinor: 0,
  ...over,
});

// Monthly accrual plans, computed with the code's formula round(balance × apyBps / 120000), compounding on the running magnitude.
const CD_PERIODS: [string, number][] = [
  ['2026-11-01T15:00:00.000Z', 583],
  ['2026-12-01T15:00:00.000Z', 585],
  ['2027-01-01T15:00:00.000Z', 587],
  ['2027-02-01T15:00:00.000Z', 588],
  ['2027-03-01T15:00:00.000Z', 590],
  ['2027-04-01T15:00:00.000Z', 592],
]; // 200000 → 203525
const SAVINGS_CD_PERIODS: [string, number][] = [
  ['2026-11-01T15:00:00.000Z', 625],
  ['2026-12-01T15:00:00.000Z', 626],
  ['2027-01-01T15:00:00.000Z', 627],
  ['2027-02-01T15:00:00.000Z', 627],
  ['2027-03-01T15:00:00.000Z', 628],
  ['2027-04-01T15:00:00.000Z', 629],
]; // 500000 → 503762
const SAVINGS_LOAN_PERIODS: [string, number][] = [['2026-11-01T15:00:00.000Z', 625]];

const interestRows = (prefix: string, accountId: string, direction: 'credit' | 'debit', description: string, periods: [string, number][]) =>
  periods.map(([at, amountMinor], i) => ({ id: `${prefix}${i + 1}`, accountId, amountMinor, direction, status: 'posted', origin: 'interest', description, postedAt: at, createdAt: at }));

function savingsEffects(p: Product): StateEffect[] {
  const periods = p === LOAN ? SAVINGS_LOAN_PERIODS : SAVINGS_CD_PERIODS;
  const through = p === LOAN ? T_LOAN : T_CD;
  const total = periods.reduce((s, [, a]) => s + a, 0);
  return [
    ...interestRows('le_sav_', IDS.savings, 'credit', 'Interest earned (simulated)', periods).map((row): StateEffect => ({ op: 'insert', table: 'LedgerEntry', row })),
    { op: 'update', table: 'Account', id: IDS.savings, set: { interestAccruedThrough: through, updatedAt: WALL.advance } },
    {
      op: 'insert',
      table: 'AuditLog',
      row: {
        id: 'aud_303',
        actorId: null,
        actorRole: 'system',
        action: 'interest_accrued_savings',
        entity: 'account',
        entityId: IDS.savings,
        reason: `Accrued $${(total / 100).toFixed(2)} savings interest over ${periods.length} month(s) (simulated)`,
        metadata: JSON.stringify({ months: periods.length, creditedMinor: total, throughISO: through }),
        createdAt: WALL.advance,
      },
    },
  ];
}

const clockEffects = (p: Product): StateEffect[] => {
  const to = p === LOAN ? T_LOAN : T_CD;
  const minutes = p === LOAN ? 44640 : 262080;
  return [
    { op: 'update', table: 'SimulationClock', id: 'singleton', set: { currentTime: to, updatedAt: WALL.advance } },
    {
      op: 'insert',
      table: 'AuditLog',
      row: { id: 'aud_302', actorId: IDS.sam, actorRole: 'ops_agent', action: 'clock_advanced', entity: 'simulation_clock', entityId: 'singleton', reason: `Advanced the simulation clock by ${minutes} minute(s) to ${to} (simulated)`, metadata: JSON.stringify({ fromISO: NOW, toISO: to, minutes, actorName: 'Sam Operator' }), createdAt: WALL.advance },
    },
  ];
};

const LOAN_INTEREST = { id: 'le_203', accountId: 'acc_loan', amountMinor: 1000, direction: 'debit', status: 'posted', origin: 'interest', description: 'Loan interest charged (simulated)', postedAt: T_LOAN, createdAt: T_LOAN };
const LOAN_INTEREST_AUDIT = { id: 'aud_304', actorId: null, actorRole: 'system', action: 'interest_accrued_loan', entity: 'lending_product', entityId: 'lp_loan', reason: 'Charged $10.00 loan interest over 1 month(s) (simulated)', metadata: JSON.stringify({ months: 1, chargedMinor: 1000 }), createdAt: WALL.advance };
const CD_INTEREST = interestRows('le_cd_', 'acc_cd', 'credit', 'CD interest earned (simulated)', CD_PERIODS);
const CD_MATURED_AUDIT = { id: 'aud_304', actorId: null, actorRole: 'system', action: 'interest_accrued_cd_matured', entity: 'lending_product', entityId: 'lp_cd', reason: 'Accrued $35.25 CD interest — CD matured (simulated)', metadata: JSON.stringify({ months: 6, creditedMinor: 3525, matured: true }), createdAt: WALL.advance };

// Loan payments (sim now = T_LOAN).
const PAY1_LEGS = [
  { id: 'le_204', accountId: IDS.checking, amountMinor: 8885, direction: 'debit', status: 'posted', origin: 'transfer', description: 'Loan payment — Personal loan', postedAt: T_LOAN, createdAt: T_LOAN },
  { id: 'le_205', accountId: 'acc_loan', amountMinor: 8885, direction: 'credit', status: 'posted', origin: 'transfer', description: 'Loan payment from Everyday Checking', postedAt: T_LOAN, createdAt: T_LOAN },
];
const PAY1_AUDIT = { id: 'aud_305', actorId: IDS.avery, actorRole: 'customer', action: 'lending_loan_payment', entity: 'lending_product', entityId: 'lp_loan', reason: 'Paid $88.85 toward Personal loan (simulated)', metadata: JSON.stringify({ fromAccountId: IDS.checking, amountMinor: 8885, remainingOwed: 92115, actorName: 'Avery Customer' }), createdAt: WALL.pay1 };
const PAY2_LEGS = [
  { id: 'le_206', accountId: IDS.checking, amountMinor: 92115, direction: 'debit', status: 'posted', origin: 'transfer', description: 'Loan payment — Personal loan', postedAt: T_LOAN, createdAt: T_LOAN },
  { id: 'le_207', accountId: 'acc_loan', amountMinor: 92115, direction: 'credit', status: 'posted', origin: 'transfer', description: 'Loan payment from Everyday Checking', postedAt: T_LOAN, createdAt: T_LOAN },
];
const PAY2_AUDIT = { id: 'aud_306', actorId: IDS.avery, actorRole: 'customer', action: 'lending_loan_paid_off', entity: 'lending_product', entityId: 'lp_loan', reason: 'Paid $921.15 toward Personal loan — loan paid off (simulated)', metadata: JSON.stringify({ fromAccountId: IDS.checking, amountMinor: 92115, remainingOwed: 0, actorName: 'Avery Customer' }), createdAt: WALL.pay2 };

// CD withdrawal (sim now = T_CD).
const WITHDRAW_LEGS = [
  { id: 'le_203', accountId: 'acc_cd', amountMinor: 203525, direction: 'debit', status: 'posted', origin: 'transfer', description: 'CD withdrawal at maturity', postedAt: T_CD, createdAt: T_CD },
  { id: 'le_204', accountId: IDS.checking, amountMinor: 203525, direction: 'credit', status: 'posted', origin: 'transfer', description: 'Matured CD proceeds from 6-month CD', postedAt: T_CD, createdAt: T_CD },
];
const WITHDRAW_AUDIT = { id: 'aud_305', actorId: IDS.avery, actorRole: 'customer', action: 'lending_cd_withdrawn', entity: 'lending_product', entityId: 'lp_cd', reason: 'Withdrew matured CD proceeds $2,035.25 to Everyday Checking (simulated)', metadata: JSON.stringify({ toAccountId: IDS.checking, amountMinor: 203525, actorName: 'Avery Customer' }), createdAt: WALL.withdraw };

// ---- Open steps (per product) ---------------------------------------------------------

function openSteps(p: Product | typeof NOFUNDS): ScenarioStep[] {
  const isLoan = p === LOAN;
  const isNoFunds = p === NOFUNDS;
  const body = isLoan
    ? { disbursementAccountId: IDS.checking, principalMinor: 100000, termMonths: 12 }
    : { fundingAccountId: IDS.checking, principalMinor: isNoFunds ? 500000 : 200000, termMonths: 6 };
  const normalized = isLoan ? { ...body, apyBps: 1200, paymentMinor: 8885 } : { ...body, apyBps: 350 };
  const path = isLoan ? '/api/lending/loans' : '/api/lending/cds';
  const steps: ScenarioStep[] = [
    {
      id: `fill-${p}`,
      kind: 'ui',
      title: isLoan ? 'Avery opens a $1,000 loan' : isNoFunds ? 'Avery tries a $5,000 CD' : 'Avery opens a $2,000 CD',
      from: AVERY,
      to: PAGE,
      label: isLoan ? 'Open loan · $1,000.00 · 12 months' : `Open CD · ${isNoFunds ? '$5,000.00' : '$2,000.00'} · 6 months`,
      narrative: isLoan
        ? 'In "Open a loan" Avery picks Disburse to = Everyday Checking, Loan amount = 1000.00 and Term = "12 months — 12.00% APY". The form previews "estimated monthly payment $88.85 for 12 months", from the shared `amortizedPaymentMinor`. She presses "Open loan". Only active, non-viewer checking/savings accounts are offered.'
        : isNoFunds
          ? 'In "Open a certificate of deposit" Avery picks Fund from = Everyday Checking, Deposit amount = 5000.00 and Term = "6 months — 3.50% APY", then presses "Open CD". Checking has only $2,331.10 available.'
          : 'In "Open a certificate of deposit" Avery picks Fund from = Everyday Checking, Deposit amount = 2000.00 and Term = "6 months — 3.50% APY". The form projects "worth $2,035.25 at maturity" with `projectCdMaturityMinor`, which applies the same monthly accrual the clock will post. She presses "Open CD".',
      audience: {
        executive: isLoan ? 'The customer borrows $1,000 over a year.' : isNoFunds ? 'The customer tries to put more into a CD than she has.' : 'The customer locks $2,000 into a 6-month deposit.',
        'end-user': isLoan ? 'Avery takes a $1,000.00 loan for 12 months at 12.00% APY.' : isNoFunds ? 'Avery tries to open a $5,000.00 CD.' : 'Avery opens a $2,000.00 6-month CD at 3.50% APY.',
      },
      detail: 1,
      variants: [p],
      payload: isLoan
        ? { title: 'Payment preview', format: 'json', data: { principalMinor: 100000, apyBps: 1200, termMonths: 12, paymentMinor: 8885, formula: 'ceil(P·r·(1+r)^n / ((1+r)^n − 1)), r = apyBps/10000/12' }, highlight: ['paymentMinor'] }
        : undefined,
      sources: isLoan
        ? [src(F.page, 484, 496, 'amortizedPaymentMinor(principalMinor, chosenApy, termMonths)'), src(F.sh, 81, 88, 'LOAN_RATE_TABLE_BPS'), src(F.sh, 114, 130, 'export function amortizedPaymentMinor'), src(F.page, 68, 76, 'function fundingAccounts')]
        : [src(F.page, 343, 374, 'projectCdMaturityMinor(principalMinor, chosenApy, termMonths)'), src(F.sh, 72, 79, 'CD_RATE_TABLE_BPS'), src(F.sh, 132, 146, 'export function projectCdMaturityMinor')],
    },
    {
      id: `request-${p}`,
      kind: 'request',
      title: isLoan ? 'POST the loan' : 'POST the CD',
      from: LIB,
      to: ROUTE,
      label: `POST ${path}`,
      narrative: `\`handleSubmit\` first runs the shared \`${isLoan ? 'validateOpenLoan' : 'validateOpenCd'}\` (it passes: an account is chosen, the principal is an integer between $100 and $1,000,000, and the term is in the offered rate table, which also supplies the APY${isLoan ? ' and the amortized payment' : ''}). It then calls \`${isLoan ? 'openLoan' : 'openCd'}\` in the customer lending client, which POSTs with the session cookie and CSRF header. The body carries only the account, principal and term; the server recomputes the rate.`,
      audience: { systems: 'HTTPS POST, JSON, customer session cookie + CSRF double-submit header; no surface header from the customer app.' },
      detail: 2,
      variants: [p],
      payload: { title: isLoan ? 'OpenLoanRequest' : 'OpenCdRequest', format: 'http-request', line: `POST ${path}`, headers: CUSTOMER_HEADERS, data: body, typeRef: isLoan ? 'sh:lending#OpenLoanRequest' : 'sh:lending#OpenCdRequest', highlight: ['principalMinor', 'termMonths'] },
      sources: isLoan
        ? [src(F.page, 410, 431, 'const check = validateOpenLoan'), src(F.lib, 163, 169, 'export function openLoan'), src(F.lib, 44, 51, 'const jsonInit')]
        : [src(F.page, 287, 308, 'const check = validateOpenCd'), src(F.lib, 149, 155, 'export function openCd'), src(F.lib, 44, 51, 'const jsonInit')],
    },
    {
      id: `server-validate-${p}`,
      kind: 'validate',
      title: 'Guards and validation',
      from: ROUTE,
      to: SH,
      label: isLoan ? 'validateOpenLoan(body)' : 'validateOpenCd(body)',
      narrative: `The CSRF hook checks the header, \`requireAuth\` resolves Avery, and \`rateLimit("lending")\` counts the mutation (public-demo mode only). The handler re-runs the shared validator on the typed fields; the normalized value adds \`apyBps\`${isLoan ? ' (1200) and `paymentMinor` (8885)' : ' (350)'} from the bank's table. It then reads the simulated now (${NOW}) and calls the service.`,
      detail: 3,
      variants: [p],
      payload: { title: isLoan ? 'NormalizedOpenLoan' : 'NormalizedOpenCd', format: 'return', data: normalized, highlight: isLoan ? ['apyBps', 'paymentMinor'] : ['apyBps'] },
      sources: isLoan
        ? [src(F.route, 62, 64, "rateLimit('lending')"), src(F.route, 90, 99, 'validateOpenLoan({'), src(F.sh, 347, 380, 'export function validateOpenLoan'), src(F.csrf, 86, 116, 'export async function csrfHook')]
        : [src(F.route, 62, 64, "rateLimit('lending')"), src(F.route, 73, 82, 'validateOpenCd({'), src(F.sh, 319, 345, 'export function validateOpenCd'), src(F.csrf, 86, 116, 'export async function csrfHook')],
    },
    {
      id: `checks-${p}`,
      kind: 'db-read',
      title: isLoan ? 'Access and capacity checks' : 'Access, funds and capacity checks',
      from: SVC,
      to: DB,
      label: isLoan ? 'requireMovable + assertLendingCapacity' : 'requireMovable + available ≥ principal',
      narrative: isLoan
        ? '`openLoan` checks Avery may move money on Everyday Checking (owner/joint/authorized, active) and that she has fewer than 10 active CDs/loans. There is no funds check: a loan is meant to start owed.'
        : isNoFunds
          ? '`openCd` checks Avery may move money on Everyday Checking, then derives its available balance from the ledger: 233110 ($2,331.10) < 500000. It throws `LendingError("insufficient_funds", "That deposit exceeds the available balance.")` before the capacity check and before any write.'
          : '`openCd` checks Avery may move money on Everyday Checking, that its derived available balance (233110) covers 200000, and that she has fewer than 10 active CDs/loans.',
      detail: 4,
      variants: [p],
      sources: isLoan
        ? [src(F.svc, 265, 271, 'export async function openLoan'), src(F.svc, 79, 91, 'async function requireMovable'), src(F.svc, 185, 201, 'async function assertLendingCapacity')]
        : [src(F.svc, 205, 214, 'export async function openCd'), src(F.svc, 93, 100, 'async function availableMinor'), src(F.svc, 185, 201, 'async function assertLendingCapacity')],
    },
  ];
  if (isNoFunds) {
    steps.push(
      {
        id: 'response-nofunds',
        kind: 'response',
        title: '400 insufficient_funds',
        from: ROUTE,
        to: LIB,
        label: '400 { code: insufficient_funds }',
        narrative: '`handleLendingError` maps `insufficient_funds` to 400 and sends the service\'s message. Nothing was written: no CD account, no ledger rows, no audit.',
        audience: { executive: 'The bank refuses: she does not have enough money available.' },
        detail: 2,
        variants: [NOFUNDS],
        payload: { title: 'ApiErrorResponse', format: 'http-response', line: '400 Bad Request', data: { error: 'That deposit exceeds the available balance.', code: 'insufficient_funds' }, highlight: ['code'] },
        sources: [src(F.route, 36, 54, 'function lendingHttpStatus'), src(F.test, 95, 97, 'rejects a CD that exceeds available funds')],
      },
      {
        id: 'ui-nofunds',
        kind: 'ui',
        title: 'The form shows the error',
        from: PAGE,
        to: AVERY,
        label: 'banner: "That deposit exceeds the available balance."',
        narrative: '`requestLending` returns `{ ok: false, code: "insufficient_funds", message }` (the server\'s `error` text wins over the client\'s default). The form keeps her inputs and shows the message in a red banner above them.',
        audience: { 'end-user': 'Avery sees "That deposit exceeds the available balance." and can lower the amount.' },
        detail: 1,
        variants: [NOFUNDS],
        sources: [src(F.lib, 105, 132, 'async function requestLending'), src(F.page, 309, 311, 'setBanner(result.message)')],
      },
    );
    return steps;
  }
  const account = isLoan ? LOAN_ACCOUNT : CD_ACCOUNT;
  const access = isLoan ? LOAN_ACCESS : CD_ACCESS;
  const legs = isLoan ? LOAN_LEGS : CD_LEGS;
  const product = isLoan ? LOAN_PRODUCT : CD_PRODUCT;
  const audit = isLoan ? LOAN_OPEN_AUDIT : CD_OPEN_AUDIT;
  steps.push(
    {
      id: `account-${p}`,
      kind: 'db-write',
      title: isLoan ? 'Create the loan account' : 'Create the CD account',
      from: SVC,
      to: DB,
      label: `INSERT Account type='${isLoan ? 'loan' : 'cd'}' + AccountAccess`,
      narrative: `Inside one \`prisma.$transaction\`: a new Account of type \`${isLoan ? 'loan' : 'cd'}\` named "${account.name}", opened at the simulated now, and an \`owner\` AccountAccess grant for Avery.`,
      audience: { dba: 'INSERT Account (openedAt/createdAt = simulated now; updatedAt via @updatedAt = wall clock) and INSERT AccountAccess, first statements of the transaction.' },
      detail: 4,
      variants: [p],
      payload: { title: 'Account + AccountAccess rows', format: 'row', data: { account, accountAccess: access }, typeRef: 'db:Account', highlight: ['account.type'] },
      effects: [
        { op: 'insert', table: 'Account', row: account },
        { op: 'insert', table: 'AccountAccess', row: access },
      ],
      sources: isLoan ? [src(F.svc, 273, 282, "type: 'loan'")] : [src(F.svc, 216, 225, "type: 'cd'")],
    },
    {
      id: `legs-${p}`,
      kind: 'db-write',
      title: isLoan ? 'Disburse: debit the loan, credit checking' : 'Fund: debit checking, credit the CD',
      from: SVC,
      to: DB,
      label: "INSERT 2 × LedgerEntry 'transfer'",
      narrative: isLoan
        ? '`postTransferPair` DEBITS the new loan account $1,000.00 and CREDITS Everyday Checking $1,000.00, both posted at the simulated now. The pair nets to zero, so no money is created; the loan account\'s derived balance becomes −$1,000.00 — the amount owed.'
        : '`postTransferPair` DEBITS Everyday Checking $2,000.00 and CREDITS the new CD account $2,000.00, both posted at the simulated now. The pair nets to zero; the CD carries a positive balance.',
      audience: {
        executive: isLoan ? '$1,000 lands in checking; the loan account shows what she owes.' : '$2,000 moves from checking into the CD.',
        'end-user': isLoan ? 'Avery\'s checking rises by $1,000.00; her loan shows $1,000.00 owed.' : 'Avery\'s checking drops by $2,000.00; her CD shows $2,000.00.',
        dba: 'Two INSERT LedgerEntry rows, origin transfer, status posted. A loan balance is never stored: it is the signed sum of the loan account\'s entries.',
      },
      detail: 1,
      variants: [p],
      payload: { title: 'LedgerEntry rows', format: 'row', data: legs, typeRef: 'db:LedgerEntry', highlight: ['0.direction', '1.direction'] },
      effects: legs.map((row): StateEffect => ({ op: 'insert', table: 'LedgerEntry', row })),
      sources: isLoan ? [src(F.svc, 283, 293, 'Disburse: DEBIT the loan account'), src(F.svc, 116, 157, 'async function postTransferPair')] : [src(F.svc, 226, 233, 'await postTransferPair(tx'), src(F.svc, 116, 157, 'async function postTransferPair')],
    },
    {
      id: `product-${p}`,
      kind: 'db-write',
      title: isLoan ? 'Record the loan terms' : 'Record the CD terms',
      from: SVC,
      to: DB,
      label: `INSERT LendingProduct kind='${isLoan ? 'loan' : 'cd'}'`,
      narrative: `The LendingProduct row holds only the TERMS and the accrual bookmark: principal, APY ${isLoan ? '1200 bps, 12 months, monthly payment 8885' : '350 bps, 6 months, no payment'}, \`maturesAt\` = now + ${isLoan ? 12 : 6} months (${product.maturesAt}), \`lastAccruedAt\` = now. Then the \`${audit.action}\` audit row; the transaction commits.`,
      audience: { dba: `INSERT LendingProduct (1:1 with the ${isLoan ? 'loan' : 'CD'} account by unique accountId) and INSERT AuditLog in the same transaction.` },
      detail: 3,
      variants: [p],
      payload: { title: 'LendingProduct + AuditLog rows', format: 'row', data: { lendingProduct: product, auditLog: audit }, typeRef: 'db:LendingProduct', highlight: ['lendingProduct.maturesAt', 'lendingProduct.lastAccruedAt'] },
      effects: [
        { op: 'insert', table: 'LendingProduct', row: product },
        { op: 'insert', table: 'AuditLog', row: audit },
      ],
      sources: isLoan ? [src(F.svc, 294, 318, 'tx.lendingProduct.create')] : [src(F.svc, 234, 258, 'tx.lendingProduct.create')],
    },
    {
      id: `response-${p}`,
      kind: 'response',
      title: '201 with the product',
      from: ROUTE,
      to: LIB,
      label: '201 { product, message }',
      narrative: `The DTO adds the account's DERIVED figures: \`balanceMinor\` ${isLoan ? '−100000 and `outstandingMinor` 100000' : '200000 and `outstandingMinor` 0'}. \`handleOpened\` prepends the card, shows "${isLoan ? 'Your loan is funded (simulated).' : 'Your CD is open (simulated).'}" and re-fetches the account balances.`,
      audience: { 'end-user': isLoan ? 'A Loan card shows "You owe $1,000.00", monthly payment $88.85, matures Oct 1, 2027.' : 'A CD card shows "CD value $2,000.00", matures Apr 1, 2027.' },
      detail: 2,
      variants: [p],
      payload: { title: 'LendingProductResponse', format: 'http-response', line: '201 Created', data: { product: isLoan ? loanDto({}) : cdDto({}), message: isLoan ? 'Your loan is funded (simulated).' : 'Your CD is open (simulated).' }, typeRef: 'sh:lending#LendingProductResponse', highlight: ['product.balanceMinor', 'product.outstandingMinor'] },
      sources: isLoan
        ? [src(F.route, 98, 100, 'Your loan is funded (simulated).'), src(F.svc, 161, 183, 'export async function toLendingProductDTO'), src(F.page, 957, 963, 'function handleOpened')]
        : [src(F.route, 81, 83, 'Your CD is open (simulated).'), src(F.svc, 161, 183, 'export async function toLendingProductDTO'), src(F.page, 957, 963, 'function handleOpened')],
    },
  );
  return steps;
}

// ---- Steps ---------------------------------------------------------------------------

const steps: ScenarioStep[] = [
  {
    id: 'open-page',
    kind: 'ui',
    title: 'Avery opens Loans & CDs',
    from: AVERY,
    to: PAGE,
    label: 'open /loans',
    narrative: 'On mount the page loads her accounts, the simulated clock and `GET /api/lending` (her products — none yet). It offers two forms: "Open a certificate of deposit" and "Open a loan".',
    audience: { 'end-user': 'Avery opens Loans & CDs.' },
    detail: 2,
    sources: [src(F.page, 941, 955, 'void listLending()'), src(F.lib, 134, 141, 'export function listLending')],
  },
  {
    id: 'decide-product',
    kind: 'decision',
    title: 'Loan or CD?',
    from: PAGE,
    to: PAGE,
    label: 'which form?',
    narrative: 'Both products sit on their own `loan` / `cd` account and are layered 1:1 with a LendingProduct row.',
    detail: 2,
    decision: {
      question: 'What does Avery open?',
      options: [
        { label: 'A $1,000.00 loan over 12 months', variant: LOAN },
        { label: 'A $2,000.00 6-month CD', variant: CD },
        { label: 'A $5,000.00 CD from a checking account that cannot cover it', variant: NOFUNDS },
      ],
    },
    sources: [src(F.sh, 36, 42, 'LENDING_STATUSES')],
  },
  ...openSteps(LOAN),
  ...openSteps(CD),
  ...openSteps(NOFUNDS),

  // ---- The clock advances ---------------------------------------------------------------------
  {
    id: 'advance-loan',
    kind: 'call',
    title: 'Sam advances the clock 31 days',
    from: SAM,
    to: ACCRUAL,
    label: 'POST /api/ops/clock/advance { days: 31 }',
    narrative: `Interest only accrues when an operator advances the simulation clock (see "clock-advance"). Sam advances 31 days to ${T_LOAN}; the route moves the clock, audits it, runs due schedules (none here), then calls \`runInterestAccrual(to)\`. (The "+1 month" preset is 30 days, which from 1 October stops one day short of the first monthly anniversary.)`,
    audience: { executive: 'A simulated month passes.' },
    detail: 2,
    variants: [LOAN],
    confidence: 'simplified',
    effects: clockEffects(LOAN),
    sources: [src(F.clockRoute, 55, 62, 'runInterestAccrual(advanced.to)'), src(F.clock, 75, 96, "action: 'clock_advanced'")],
  },
  {
    id: 'advance-cd',
    kind: 'call',
    title: 'Sam advances the clock 182 days',
    from: SAM,
    to: ACCRUAL,
    label: 'POST /api/ops/clock/advance { days: 182 }',
    narrative: `Sam advances 182 days in one step (the limit is 366 days), landing exactly on the CD's maturity, ${T_CD}. After moving and auditing the clock, the route calls \`runInterestAccrual(to)\`.`,
    audience: { executive: 'Six simulated months pass.' },
    detail: 2,
    variants: [CD],
    confidence: 'simplified',
    effects: clockEffects(CD),
    sources: [src(F.clockRoute, 55, 62, 'runInterestAccrual(advanced.to)'), src(F.clock, 75, 96, "action: 'clock_advanced'")],
  },
  {
    id: 'savings-loan',
    kind: 'db-write',
    title: 'Savings earns its month too',
    from: ACCRUAL,
    to: DB,
    label: "INSERT LedgerEntry 'interest' credit $6.25 (savings)",
    narrative: 'Savings accounts are processed first. Goal Savings (bookmark = the seed instant, balance 500000) earns round(500000 × 150 / 120000) = 625 at the default 1.50% APY, its bookmark moves to 1 November, and a system audit row is written.',
    audience: { dba: 'INSERT LedgerEntry (interest, posted), UPDATE Account.interestAccruedThrough, INSERT AuditLog — one transaction for this account.' },
    detail: 4,
    variants: [LOAN],
    effects: savingsEffects(LOAN),
    sources: [src(F.accrual, 116, 143, 'interest_accrued_savings'), src(F.sh, 69, 70, 'DEFAULT_SAVINGS_APY_BPS = 150')],
  },
  {
    id: 'savings-cd',
    kind: 'db-write',
    title: 'Savings earns six months',
    from: ACCRUAL,
    to: DB,
    label: "INSERT 6 × LedgerEntry 'interest' (savings)",
    narrative: 'Savings is processed first: six monthly anniversaries elapsed, each compounding on the running balance — 625, 626, 627, 627, 628, 629 (total $37.62) — each dated at its anniversary. The bookmark moves to 1 April 2027 and one audit row covers the six months.',
    audience: { dba: 'Six INSERT LedgerEntry rows with postedAt in the simulated past (Nov–Apr), UPDATE Account.interestAccruedThrough, INSERT AuditLog — one transaction.' },
    detail: 4,
    variants: [CD],
    effects: savingsEffects(CD),
    sources: [src(F.accrual, 116, 143, 'interest_accrued_savings'), src(F.accrual, 54, 73, 'function planMonthlyAccrual')],
  },
  {
    id: 'plan-loan',
    kind: 'call',
    title: 'Compute one month of loan interest',
    from: ACCRUAL,
    to: SH,
    label: 'monthlyAccrualMinor(100000, 1200) = 1000',
    narrative: 'For an active loan, `owed` = −(derived balance of the loan account) = 100000. From `lastAccruedAt` (1 October) one anniversary (1 November) has passed. Interest = round(owed × apyBps / (10000 × 12)) = round(100000 × 1200 / 120000) = 1000 → $10.00. It is simple monthly interest at APY/12; compounding happens because next month reads the larger owed balance.',
    audience: { executive: 'At 12% a year, one month on $1,000 owed costs $10.00.' },
    detail: 3,
    variants: [LOAN],
    payload: { title: 'AccrualPlan', format: 'return', data: { periods: [{ at: T_LOAN, interestMinor: 1000 }], newBookmark: T_LOAN, monthsStepped: 1 }, highlight: ['periods.0.interestMinor'] },
    sources: [src(F.accrual, 201, 206, "product.kind === 'loan'"), src(F.sh, 101, 112, 'export function monthlyAccrualMinor')],
  },
  {
    id: 'interest-loan',
    kind: 'db-write',
    title: 'Charge interest to the loan',
    from: ACCRUAL,
    to: DB,
    label: "INSERT LedgerEntry 'interest' DEBIT $10.00 (loan)",
    narrative: 'In the loan\'s own transaction, `postInterest` writes a bank-originated, POSTED `interest` DEBIT of $10.00 on the loan account, dated 1 November. The loan balance goes from −$1,000.00 to −$1,010.00: she owes more. `lastAccruedAt` moves to 1 November and an `interest_accrued_loan` audit row is written.',
    audience: {
      executive: 'The loan grows by $10.00 of interest.',
      'end-user': 'Avery\'s loan now shows "You owe $1,010.00".',
      dba: 'INSERT LedgerEntry (origin interest, direction debit), UPDATE LendingProduct.lastAccruedAt, INSERT AuditLog — one transaction.',
    },
    detail: 1,
    variants: [LOAN],
    payload: { title: 'LedgerEntry row', format: 'row', data: LOAN_INTEREST, typeRef: 'db:LedgerEntry', highlight: ['direction', 'origin', 'amountMinor'] },
    effects: [
      { op: 'insert', table: 'LedgerEntry', row: LOAN_INTEREST },
      { op: 'update', table: 'LendingProduct', id: 'lp_loan', set: { lastAccruedAt: T_LOAN, updatedAt: WALL.advance } },
      { op: 'insert', table: 'AuditLog', row: LOAN_INTEREST_AUDIT },
    ],
    sources: [src(F.accrual, 207, 226, 'Loan interest charged (simulated)')],
  },
  {
    id: 'plan-cd',
    kind: 'call',
    title: 'Compute six months of CD interest',
    from: ACCRUAL,
    to: SH,
    label: '6 × monthlyAccrualMinor(balance, 350)',
    narrative: 'For an active CD, the clock has reached `maturesAt`, so accrual runs up to maturity. Starting from the derived CD balance 200000 at 3.50% APY: 583, 585, 587, 588, 590, 592 — each round(balance × 350 / 120000) on the running balance — total 3525 ($35.25), matching the form\'s projection of $2,035.25.',
    audience: { executive: 'At 3.50% a year the CD earns $35.25 over its six months.' },
    detail: 3,
    variants: [CD],
    payload: { title: 'AccrualPlan', format: 'return', data: { periods: CD_PERIODS.map(([at, interestMinor]) => ({ at, interestMinor })), newBookmark: T_CD, monthsStepped: 6 }, highlight: ['periods'] },
    sources: [src(F.accrual, 160, 168, 'const willMature'), src(F.sh, 101, 112, 'export function monthlyAccrualMinor')],
  },
  {
    id: 'interest-cd',
    kind: 'db-write',
    title: 'Credit CD interest and mature it',
    from: ACCRUAL,
    to: DB,
    label: "INSERT 6 × 'interest' credit; LendingProduct → matured",
    narrative: 'In one transaction: six POSTED `interest` CREDITS on the CD account, each dated at its monthly anniversary; the product\'s `status` becomes `matured` and `lastAccruedAt` = `maturesAt`; and an `interest_accrued_cd_matured` audit row. A matured CD earns nothing more.',
    audience: {
      executive: 'The CD earns $35.25 and reaches maturity.',
      'end-user': 'Avery\'s CD shows "CD value $2,035.25" and MATURED.',
      dba: 'Six INSERT LedgerEntry, UPDATE LendingProduct SET status = \'matured\', lastAccruedAt; INSERT AuditLog.',
    },
    detail: 1,
    variants: [CD],
    payload: { title: 'LendingProduct update', format: 'row', data: { status: 'matured', lastAccruedAt: T_CD }, typeRef: 'db:LendingProduct', highlight: ['status'] },
    effects: [
      ...CD_INTEREST.map((row): StateEffect => ({ op: 'insert', table: 'LedgerEntry', row })),
      { op: 'update', table: 'LendingProduct', id: 'lp_cd', set: { lastAccruedAt: T_CD, status: 'matured', updatedAt: WALL.advance } },
      { op: 'insert', table: 'AuditLog', row: CD_MATURED_AUDIT },
    ],
    sources: [src(F.accrual, 169, 200, "data.status = 'matured'")],
  },

  // ---- Loan: pay, then pay off --------------------------------------------------------------
  {
    id: 'pay-request',
    kind: 'request',
    title: 'Avery pays the monthly payment',
    from: LIB,
    to: ROUTE,
    label: 'POST /api/lending/loans/lp_loan/pay',
    narrative: 'On the loan card Avery presses "Make a payment", picks Pay from = Everyday Checking and keeps "Monthly payment ($88.85)". Scheduled mode sends `amountMinor: null`; `validateLoanPayment` passes and `payLoan` POSTs it.',
    audience: { 'end-user': 'Avery pays this month\'s $88.85.' },
    detail: 2,
    variants: [LOAN],
    payload: { title: 'LoanPaymentRequest', format: 'http-request', line: 'POST /api/lending/loans/lp_loan/pay', headers: CUSTOMER_HEADERS, data: { fromAccountId: IDS.checking, amountMinor: null }, typeRef: 'sh:lending#LoanPaymentRequest', highlight: ['amountMinor'] },
    sources: [src(F.page, 554, 576, 'const check = validateLoanPayment'), src(F.lib, 178, 187, 'export function payLoan'), src(F.page, 806, 812, 'Make a payment')],
  },
  {
    id: 'pay-checks',
    kind: 'validate',
    title: 'Resolve the amount',
    from: SVC,
    to: DB,
    label: 'amount = min(paymentMinor, owed) = 8885',
    narrative:
      '`makeLoanPayment` loads the product (404 if unknown, 403 unless Avery holds the loan account), requires kind `loan` and status `active`, checks the paying account is movable and not the loan itself, and derives `owed` = 101000. With no amount sent it uses `paymentMinor` (8885), never more than owed, then checks checking\'s available balance covers it.',
    detail: 4,
    variants: [LOAN],
    sources: [src(F.svc, 337, 360, 'export async function makeLoanPayment'), src(F.svc, 325, 335, 'async function requireOwnedProduct'), src(F.route, 107, 116, 'validateLoanPayment({')],
  },
  {
    id: 'pay-legs',
    kind: 'db-write',
    title: 'Payment: checking → loan',
    from: SVC,
    to: DB,
    label: "INSERT 2 × LedgerEntry 'transfer' $88.85",
    narrative: 'In one transaction, a `transfer` DEBIT on checking and a `transfer` CREDIT on the loan account, dated at the simulated now (1 November). Remaining owed = 101000 − 8885 = 92115, so the product stays `active` (its `updatedAt` is set to the simulated now) and a `lending_loan_payment` audit row records the remaining balance.',
    audience: {
      executive: 'The payment reduces what she owes to $921.15.',
      'end-user': 'Avery\'s loan shows "You owe $921.15".',
      dba: 'Two INSERT LedgerEntry, UPDATE LendingProduct (status, updatedAt), INSERT AuditLog — one transaction.',
    },
    detail: 1,
    variants: [LOAN],
    payload: { title: 'LedgerEntry rows', format: 'row', data: PAY1_LEGS, typeRef: 'db:LedgerEntry', highlight: ['0.amountMinor'] },
    effects: [
      ...PAY1_LEGS.map((row): StateEffect => ({ op: 'insert', table: 'LedgerEntry', row })),
      { op: 'update', table: 'LendingProduct', id: 'lp_loan', set: { status: 'active', updatedAt: T_LOAN } },
      { op: 'insert', table: 'AuditLog', row: PAY1_AUDIT },
    ],
    sources: [src(F.svc, 362, 391, 'Loan payment — ${account.name}')],
  },
  {
    id: 'pay-response',
    kind: 'response',
    title: '200 with the updated loan',
    from: ROUTE,
    to: PAGE,
    label: '200 { product, message: "Payment posted (simulated)." }',
    narrative: '`handleUpdated` replaces the card by id, shows the message and re-fetches balances.',
    detail: 2,
    variants: [LOAN],
    payload: { title: 'LendingProductResponse', format: 'http-response', line: '200 OK', data: { product: loanDto({ lastAccruedAt: T_LOAN, balanceMinor: -92115, outstandingMinor: 92115 }), message: 'Payment posted (simulated).' }, typeRef: 'sh:lending#LendingProductResponse', highlight: ['product.outstandingMinor'] },
    sources: [src(F.route, 116, 117, 'Payment posted (simulated).'), src(F.page, 965, 973, 'function handleUpdated')],
  },
  {
    id: 'payoff-request',
    kind: 'request',
    title: 'Avery pays off the rest',
    from: LIB,
    to: ROUTE,
    label: 'POST …/pay { amountMinor: 100000 }',
    narrative: 'Avery chooses "Custom amount" and enters 1000.00 — more than the $921.15 owed. The server caps the amount at what is owed: min(100000, 92115) = 92115.',
    audience: { 'end-user': 'Avery pays off her loan.' },
    detail: 2,
    variants: [LOAN],
    payload: { title: 'LoanPaymentRequest', format: 'http-request', line: 'POST /api/lending/loans/lp_loan/pay', headers: CUSTOMER_HEADERS, data: { fromAccountId: IDS.checking, amountMinor: 100000 }, typeRef: 'sh:lending#LoanPaymentRequest', highlight: ['amountMinor'] },
    sources: [src(F.page, 626, 636, "mode === 'custom'"), src(F.svc, 353, 356, 'Math.min(requested, owed)'), src(F.test, 143, 150, 'overpay is capped')],
  },
  {
    id: 'payoff-legs',
    kind: 'db-write',
    title: 'Final payment legs',
    from: SVC,
    to: DB,
    label: "INSERT 2 × LedgerEntry 'transfer' $921.15",
    narrative: 'The same `transfer` pair for $921.15, checking → loan, dated 1 November. The loan account\'s derived balance is now exactly 0.',
    audience: { dba: 'Two INSERT LedgerEntry rows; first statements of the payoff transaction.' },
    detail: 4,
    variants: [LOAN],
    payload: { title: 'LedgerEntry rows', format: 'row', data: PAY2_LEGS, typeRef: 'db:LedgerEntry' },
    effects: PAY2_LEGS.map((row): StateEffect => ({ op: 'insert', table: 'LedgerEntry', row })),
    sources: [src(F.svc, 362, 370, 'await postTransferPair(tx')],
  },
  {
    id: 'paid-off',
    kind: 'db-write',
    title: 'Loan paid off, account closed',
    from: SVC,
    to: DB,
    label: "LendingProduct → paid_off; Account → closed",
    narrative: 'Remaining owed is 0, so the same transaction sets the product to `paid_off`, closes the loan account (`status: closed`), and writes a `lending_loan_paid_off` audit row. The card shows "Paid off" with no payment button. In total Avery repaid $1,010.00 for $1,000.00 borrowed.',
    audience: {
      executive: 'The loan is fully repaid and closed; it cost $10.00 in interest.',
      'end-user': 'Avery\'s loan shows PAID OFF.',
      dba: "UPDATE LendingProduct SET status = 'paid_off'; UPDATE Account SET status = 'closed'; INSERT AuditLog. The ledger rows stay — the loan account's entries sum to 0.",
    },
    detail: 1,
    variants: [LOAN],
    payload: { title: 'Payoff writes', format: 'row', data: { lendingProduct: { status: 'paid_off', updatedAt: T_LOAN }, account: { status: 'closed', updatedAt: T_LOAN }, auditLog: PAY2_AUDIT }, typeRef: 'db:LendingProduct', highlight: ['lendingProduct.status', 'account.status'] },
    effects: [
      { op: 'update', table: 'LendingProduct', id: 'lp_loan', set: { status: 'paid_off', updatedAt: T_LOAN } },
      { op: 'update', table: 'Account', id: 'acc_loan', set: { status: 'closed', updatedAt: T_LOAN } },
      { op: 'insert', table: 'AuditLog', row: PAY2_AUDIT },
    ],
    sources: [src(F.svc, 372, 390, "paidOff ? 'paid_off' : 'active'"), src(F.page, 738, 741, 'const canPay'), src(F.test, 131, 151, 'pays off + closes the loan when cleared')],
  },

  // ---- CD: withdraw at maturity -------------------------------------------------------------
  {
    id: 'withdraw-request',
    kind: 'request',
    title: 'Avery withdraws the matured CD',
    from: LIB,
    to: ROUTE,
    label: 'POST /api/lending/cds/lp_cd/withdraw',
    narrative: 'The card now shows MATURED and a "Withdraw CD" button (`isCdWithdrawable` = kind cd and status matured). Avery picks Deposit into = Everyday Checking; `validateWithdrawCd` passes and `withdrawCd` POSTs.',
    audience: { 'end-user': 'Avery moves her matured CD back to checking.' },
    detail: 2,
    variants: [CD],
    payload: { title: 'WithdrawCdRequest', format: 'http-request', line: 'POST /api/lending/cds/lp_cd/withdraw', headers: CUSTOMER_HEADERS, data: { toAccountId: IDS.checking }, typeRef: 'sh:lending#WithdrawCdRequest', highlight: ['toAccountId'] },
    sources: [src(F.page, 667, 683, 'const check = validateWithdrawCd'), src(F.lib, 195, 204, 'export function withdrawCd'), src(F.sh, 445, 448, 'export function isCdWithdrawable')],
  },
  {
    id: 'withdraw-checks',
    kind: 'validate',
    title: 'Matured? How much?',
    from: SVC,
    to: DB,
    label: 'status matured; balance = 203525',
    narrative: '`withdrawMaturedCd` requires a CD the caller holds, not already closed, and matured — by status or because the simulated now has passed `maturesAt` (otherwise 400 `not_matured`, which the integration test exercises before maturity). The amount is the CD\'s whole derived balance: 203525.',
    detail: 4,
    variants: [CD],
    sources: [src(F.svc, 398, 415, 'export async function withdrawMaturedCd'), src(F.test, 201, 202, 'Cannot withdraw before maturity')],
  },
  {
    id: 'withdraw-legs',
    kind: 'db-write',
    title: 'Proceeds to checking; CD closed',
    from: SVC,
    to: DB,
    label: "2 × 'transfer' $2,035.25; LendingProduct + Account → closed",
    narrative: 'In one transaction: a `transfer` DEBIT of $2,035.25 on the CD and a CREDIT on checking, dated at the simulated now (1 April 2027); the product and the CD account are set to `closed`; a `lending_cd_withdrawn` audit row is written. The CD account\'s entries now sum to 0.',
    audience: {
      executive: 'The $2,000 plus $35.25 interest returns to checking; the CD is closed.',
      'end-user': 'Avery\'s checking rises by $2,035.25; the CD shows CLOSED.',
      dba: "Two INSERT LedgerEntry, UPDATE LendingProduct SET status = 'closed', UPDATE Account SET status = 'closed', INSERT AuditLog.",
    },
    detail: 1,
    variants: [CD],
    payload: { title: 'LedgerEntry rows', format: 'row', data: WITHDRAW_LEGS, typeRef: 'db:LedgerEntry', highlight: ['0.amountMinor'] },
    effects: [
      ...WITHDRAW_LEGS.map((row): StateEffect => ({ op: 'insert', table: 'LedgerEntry', row })),
      { op: 'update', table: 'LendingProduct', id: 'lp_cd', set: { status: 'closed', updatedAt: T_CD } },
      { op: 'update', table: 'Account', id: 'acc_cd', set: { status: 'closed', updatedAt: T_CD } },
      { op: 'insert', table: 'AuditLog', row: WITHDRAW_AUDIT },
    ],
    sources: [src(F.svc, 417, 441, 'CD withdrawal at maturity')],
  },
  {
    id: 'withdraw-response',
    kind: 'response',
    title: '200 with the closed CD',
    from: ROUTE,
    to: PAGE,
    label: '200 { product, message }',
    narrative: '`handleUpdated` replaces the card (CLOSED, CD value $0.00), shows the message and re-fetches balances.',
    detail: 2,
    variants: [CD],
    payload: { title: 'LendingProductResponse', format: 'http-response', line: '200 OK', data: { product: cdDto({ status: 'closed', lastAccruedAt: T_CD, balanceMinor: 0 }), message: 'Your matured CD proceeds were transferred (simulated).' }, typeRef: 'sh:lending#LendingProductResponse', highlight: ['product.status'] },
    sources: [src(F.route, 129, 131, 'Your matured CD proceeds were transferred (simulated).'), src(F.page, 965, 973, 'function handleUpdated')],
  },

  // ---- Outcome ---------------------------------------------------------------------------------
  {
    id: 'balances-loan',
    kind: 'state',
    title: 'Where the money went',
    from: DB,
    to: AVERY,
    label: 'checking −$10.00 net · loan $0.00',
    narrative: 'Derived from the ledger: checking current 245110 + 100000 − 8885 − 92115 = 244110 ($2,441.10) — $10.00 less than before, the interest. Loan account: −100000 − 1000 + 8885 + 92115 = 0. Every move except the $10.00 interest debit and the savings interest credit was a net-zero transfer pair.',
    audience: { executive: 'Borrowing $1,000 for a month cost $10.00.', dba: 'Bank-wide settled total changed only by the interest rows (−1000 on the loan, +625 on savings).' },
    detail: 2,
    variants: [LOAN],
    payload: { title: 'Derived balances (current)', format: 'json', data: { checking: { before: 245110, after: 244110 }, loan: { afterOpen: -100000, afterInterest: -101000, afterPayment: -92115, afterPayoff: 0 }, savings: { before: 500000, after: 500625 } }, highlight: ['loan'] },
    sources: [src(F.ledger, 90, 132, 'export function deriveBalances')],
  },
  {
    id: 'balances-cd',
    kind: 'state',
    title: 'Where the money went',
    from: DB,
    to: AVERY,
    label: 'checking +$35.25 net · CD $0.00',
    narrative: 'Checking current: 245110 − 200000 + 203525 = 248635 ($2,486.35) — $35.25 more than before. CD account: 200000 + 3525 − 203525 = 0. Savings also earned $37.62 over the same six months.',
    audience: { executive: 'Six months in the CD earned $35.25.' },
    detail: 2,
    variants: [CD],
    payload: { title: 'Derived balances (current)', format: 'json', data: { checking: { before: 245110, afterOpen: 45110, after: 248635 }, cd: { afterOpen: 200000, atMaturity: 203525, afterWithdraw: 0 }, savings: { before: 500000, after: 503762 } }, highlight: ['cd'] },
    sources: [src(F.ledger, 90, 132, 'export function deriveBalances')],
  },
];

export const scenario: Scenario = {
  id: 'loan-and-interest',
  title: 'Loans, CDs and interest',
  question: 'How do loans, CDs and interest work?',
  summary:
    'Avery opens a $1,000.00 loan on the Loans & CDs page: a new loan account is debited and her checking credited as a net-zero transfer pair, so the loan carries a negative derived balance. When the simulation clock passes a monthly anniversary the accrual driver posts a $10.00 interest debit (12.00% APY ÷ 12). Payments move money from checking back to the loan; at zero the loan is paid_off and its account closed. A CD works the other way: funded by a transfer pair, credited monthly interest, matured by the clock, then withdrawn.',
  category: 'money',
  tags: ['money', 'lending', 'ledger', 'time', 'audit'],
  participants: [AVERY, PAGE, SH, LIB, ROUTE, SVC, ACCRUAL, DB, SAM],
  related: [
    'ep:POST /api/lending/loans',
    'ep:POST /api/lending/loans/:id/pay',
    'ep:POST /api/lending/cds',
    'ep:POST /api/lending/cds/:id/withdraw',
    'ep:GET /api/lending',
    'be:routes/lending',
    'be:lending/lending#openLoan',
    'be:lending/lending#openCd',
    'be:lending/lending#makeLoanPayment',
    'be:lending/lending#withdrawMaturedCd',
    'be:lending/lending#postTransferPair',
    ACCRUAL,
    'be:lending/accrual#planMonthlyAccrual',
    'sh:lending#monthlyAccrualMinor',
    'sh:lending#amortizedPaymentMinor',
    'sh:lending#validateOpenLoan',
    'sh:lending#validateOpenCd',
    'sh:lending#LOAN_RATE_TABLE_BPS',
    'sh:lending#CD_RATE_TABLE_BPS',
    'cu:pages/Lending',
    'cu:lib/lending#openLoan',
    'cu:lib/lending#payLoan',
    'db:LendingProduct',
    'db:Account',
    'db:LedgerEntry',
    'feat:lending',
    'feat:interest',
  ],
  variants: [
    { id: LOAN, label: 'Loan', description: 'Open a $1,000.00 12-month loan, accrue one month of interest ($10.00), pay $88.85, then pay off the remaining $921.15.', outcome: 'success' },
    { id: CD, label: 'CD', description: 'Open a $2,000.00 6-month CD, let six months of interest ($35.25) accrue to maturity, then withdraw $2,035.25.', outcome: 'success' },
    { id: NOFUNDS, label: 'Insufficient funds', description: 'A $5,000.00 CD from checking with $2,331.10 available is refused with 400 insufficient_funds.', outcome: 'rejected' },
  ],
  defaultVariant: LOAN,
  initialState: (() => {
    const base = baseState();
    return { ...base, Account: base.Account.map((a) => (a.id === IDS.savings ? { ...a, interestAccruedThrough: NOW } : a)) };
  })(),
  watchAccounts: [IDS.checking, IDS.savings],
  steps,
  sources: [
    src(F.svc, 263, 321, 'export async function openLoan'),
    src(F.svc, 337, 394, 'export async function makeLoanPayment'),
    src(F.accrual, 156, 231, "product.kind === 'loan'"),
    src(F.sh, 1, 31, 'MONEY DISCIPLINE'),
    src(F.test, 106, 174, 'disburses cash (net zero)'),
  ],
};
