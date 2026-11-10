import type { Entity, Relation } from '../../types';
import { P, ent, rel, src } from './util';

/**
 * Lending & interest: the backend services under `be.lending` and the shared
 * contract `sh:lending`.
 */

// ---------------------------------------------------------------------------
// Backend: lending/lending.ts
// ---------------------------------------------------------------------------

const lendingServiceEntities: Entity[] = [
  ent('be:lending/lending', 'module', 'lending/lending.ts', 'be.lending', 'The lending service: open a CD, open a loan, pay a loan, withdraw a matured CD, and list products.', {
    description:
      'A CD or a loan is a dedicated `Account` (type `cd` / `loan`) with a 1:1 `LendingProduct` row that holds only the terms: rate, term, principal, maturity, the loan\'s level payment and the accrual bookmark. The money lives in that account\'s ledger.\n\nEvery action here relocates money with a pair of posted `transfer` entries — same amount, same simulated instant, one debit and one credit — so the system-wide settled total does not change. A CD account therefore carries a positive balance and a loan account a negative one (the amount owed). Interest, the only money that enters or leaves for these products, is posted by `accrual.ts`.\n\nAccess uses the same primitive as the rest of the backend: the caller must hold an `owner`, `joint` or `authorized` relationship on every account involved.',
    audience: {
      executive: 'Savings certificates and personal loans, built on the same ledger as everything else: opening, repaying and cashing out only move existing money between accounts.',
      'end-user': 'Open a CD from your checking balance, take out a loan that is paid into checking, make loan payments, and withdraw a CD once it has matured.',
      dba: 'Open = 1 `Account` + 1 `AccountAccess` + 2 `LedgerEntry` + 1 `LendingProduct` + 1 `AuditLog` in one transaction. Pay / withdraw = 2 `LedgerEntry` + `LendingProduct.status` (+ `Account.status = closed`) + 1 `AuditLog`.',
    },
    tech: ['Prisma'],
    tags: ['lending', 'money', 'ledger', 'audit'],
    aliases: ['lending service', 'loans', 'CDs', 'certificates of deposit'],
    sources: [
      src(P.lending, 22, 41, 'Lending & deposit services', 'Module header: money discipline'),
      src(P.adr3, 46, 58, 'ride the existing ledger', 'ADR-0003 decision 4'),
    ],
  }),
  ent('be:lending/lending#LendingError', 'class', 'LendingError', 'be:lending/lending', 'Typed error for lending operations; its `code` decides the HTTP status.', {
    values: [
      { value: 'not_found', meaning: 'Account or product does not exist → 404' },
      { value: 'forbidden', meaning: 'Caller has no movable relationship to the account or product → 403' },
      { value: 'insufficient_funds', meaning: 'CD deposit or loan payment exceeds the available balance → 400' },
      { value: 'inactive_account', meaning: 'Funding / paying / receiving account is not active → 400' },
      { value: 'invalid_state', meaning: 'Wrong product kind, loan already paid off or closed, nothing owed, CD already closed or empty, or the product\'s own account chosen as the other side → 400' },
      { value: 'not_matured', meaning: 'CD withdrawal before maturity → 400' },
      { value: 'limit_reached', meaning: 'Caller already has 10 open CDs/loans → 409' },
    ],
    tags: ['lending', 'validation'],
    sources: [src(P.lending, 43, 59, 'export class LendingError')],
  }),
  ent('be:lending/lending#requireMovable', 'function', 'requireMovable (private)', 'be:lending/lending', 'Confirms the caller may move money on an account: it exists, they are owner / joint / authorized, and it is active.', {
    signature: 'async function requireMovable(userId: string, accountId: string): Promise<Account>',
    detail: 5,
    tags: ['rbac', 'security', 'lending'],
    sources: [src(P.lending, 79, 91, 'async function requireMovable'), src(P.lending, 61, 61, 'MOVABLE')],
  }),
  ent('be:lending/lending#accountCurrentMinor', 'function', 'accountCurrentMinor', 'be:lending/lending', 'The derived settled balance of an account, read from its ledger entries.', {
    description:
      'Public alias of the private `currentMinor`; `availableMinor` is its sibling for the spendable balance. Both load the account\'s entries and run the shared `deriveBalances`. The accrual driver uses this to get the balance interest is computed on; for a loan the result is negative.',
    signature: 'export function accountCurrentMinor(db: DbClient, accountId: string): Promise<number>',
    tags: ['ledger', 'lending'],
    aliases: ['currentMinor', 'availableMinor', 'derived balance'],
    sources: [src(P.lending, 93, 114, 'export function accountCurrentMinor'), src(P.lending, 69, 77, 'deriveBalances')],
  }),
  ent('be:lending/lending#postTransferPair', 'function', 'postTransferPair (private)', 'be:lending/lending', 'Posts the two halves of a net-zero movement: a `transfer` debit on one account and a `transfer` credit on the other.', {
    description:
      'Both rows are `status: \'posted\'`, `origin: \'transfer\'`, with `postedAt` and `createdAt` set to the simulated `now`. There is deliberately no funds check: the caller decides, because a loan disbursement is meant to drive the loan account negative. Used by all four money-moving lending actions.',
    signature: 'async function postTransferPair(tx: DbClient, args: { fromAccountId; toAccountId; amountMinor; fromDescription; toDescription; now }): Promise<void>',
    detail: 4,
    tags: ['ledger', 'money', 'lending'],
    aliases: ['net-zero pair', 'transfer legs'],
    sources: [src(P.lending, 116, 157, 'async function postTransferPair')],
  }),
  ent('be:lending/lending#toLendingProductDTO', 'function', 'toLendingProductDTO', 'be:lending/lending', 'Maps a product row to its DTO, deriving the balance from the ledger at read time.', {
    description: '`balanceMinor` is the product account\'s settled balance; `outstandingMinor` is `-balanceMinor` when the balance is negative, else 0.',
    signature: "export async function toLendingProductDTO(db: DbClient, product: LendingProduct, account: Pick<Account, 'id' | 'name'>): Promise<LendingProductDTO>",
    tags: ['lending', 'data'],
    sources: [src(P.lending, 161, 183, 'export async function toLendingProductDTO')],
  }),
  ent('be:lending/lending#assertLendingCapacity', 'function', 'assertLendingCapacity (private)', 'be:lending/lending', 'Refuses a new CD or loan when the user already has 10 active products.', {
    description:
      'Counts `LendingProduct` rows with `status: \'active\'` whose account belongs to the user. Matured, paid-off and closed products do not count. The cap exists because opening a loan needs no funds, so without it one user could create rows without limit.',
    signature: 'async function assertLendingCapacity(userId: string): Promise<void>',
    detail: 5,
    tags: ['lending', 'public-demo'],
    sources: [src(P.lending, 185, 201, 'async function assertLendingCapacity')],
  }),
  ent('be:lending/lending#openCd', 'function', 'openCd', 'be:lending/lending', 'Opens a certificate of deposit: creates the CD account and moves the principal into it from the funding account.', {
    description:
      'Before the transaction: the caller must be able to move money on the funding account, its available balance must cover the principal (`insufficient_funds`), and the caller must be under the open-product cap. `maturesAt = addMonthsClamped(now, termMonths)`; the account is named "<term>-month CD".\n\nOne transaction then creates the `cd` account and its `owner` access row, posts the transfer pair (funding account debited, CD account credited), inserts the `LendingProduct` (`lastAccruedAt = now`, `paymentMinor = null`) and writes the audit row `lending_open_cd`.',
    signature: 'export async function openCd(user: SessionUser, input: NormalizedOpenCd, now: Date): Promise<LendingProductDTO>',
    detail: 3,
    tags: ['lending', 'money', 'ledger', 'audit'],
    aliases: ['open a CD'],
    sources: [
      src(P.lending, 205, 261, 'export async function openCd'),
      src(P.lending, 210, 214, 'insufficient_funds', 'Funds + capacity checks'),
      src(P.lending, 219, 258, 'lending_open_cd', 'The transaction'),
    ],
  }),
  ent('be:lending/lending#openLoan', 'function', 'openLoan', 'be:lending/lending', 'Opens a loan: creates the loan account, debits it by the principal and credits the customer\'s account with the cash.', {
    description:
      'Before the transaction: the caller must be able to move money on the disbursement account and be under the open-product cap. There is no credit decision and no funds check.\n\nOne transaction creates the `loan` account ("Personal loan") and its `owner` access row, posts the transfer pair with the loan account as the debited side — which is what makes its derived balance negative — inserts the `LendingProduct` with the level `paymentMinor` computed by the validator, and writes the audit row `lending_open_loan`.',
    signature: 'export async function openLoan(user: SessionUser, input: NormalizedOpenLoan, now: Date): Promise<LendingProductDTO>',
    detail: 3,
    tags: ['lending', 'money', 'ledger', 'audit'],
    aliases: ['open a loan', 'disbursement'],
    sources: [
      src(P.lending, 265, 321, 'export async function openLoan'),
      src(P.lending, 283, 293, 'DEBIT the loan account', 'Disbursement legs'),
    ],
  }),
  ent('be:lending/lending#requireOwnedProduct', 'function', 'requireOwnedProduct (private)', 'be:lending/lending', 'Loads a lending product and confirms the caller holds a movable relationship on the product\'s account.', {
    signature: 'async function requireOwnedProduct(userId: string, productId: string): Promise<{ product: LendingProduct; account: Account }>',
    detail: 5,
    tags: ['rbac', 'security', 'lending'],
    sources: [src(P.lending, 325, 335, 'async function requireOwnedProduct')],
  }),
  ent('be:lending/lending#makeLoanPayment', 'function', 'makeLoanPayment', 'be:lending/lending', 'Pays down a loan from another account, never more than what is owed, and marks it paid off when it reaches zero.', {
    description:
      'Checks: the product is a loan and `active`; the paying account is movable by the caller and is not the loan account; something is owed (`owed = -currentMinor`).\n\nThe amount is `min(requested, owed)` where `requested` is the body\'s `amountMinor`, or the product\'s level `paymentMinor` if omitted. An overpayment is therefore capped, not rejected. The paying account\'s available balance must cover the amount (`insufficient_funds`).\n\nOne transaction posts the transfer pair (paying account debited, loan account credited) and updates the product. When nothing remains owed the product becomes `paid_off`, the loan account is set to `closed`, and the audit action is `lending_loan_paid_off` instead of `lending_loan_payment`.',
    signature: 'export async function makeLoanPayment(user: SessionUser, productId: string, input: NormalizedLoanPayment, now: Date): Promise<LendingProductDTO>',
    detail: 3,
    tags: ['lending', 'money', 'ledger', 'audit'],
    aliases: ['loan payment', 'pay off'],
    sources: [
      src(P.lending, 337, 394, 'export async function makeLoanPayment'),
      src(P.lending, 350, 360, 'Math.min(requested, owed)', 'Amount resolution, cap and funds check'),
      src(P.lending, 372, 380, "paidOff ? 'paid_off' : 'active'", 'Status transition'),
    ],
  }),
  ent('be:lending/lending#withdrawMaturedCd', 'function', 'withdrawMaturedCd', 'be:lending/lending', 'Moves a matured CD\'s whole balance to one of the caller\'s accounts and closes the CD.', {
    description:
      'Checks: the product is a CD and not already `closed`; it is matured — by status, or because the simulated now has reached `maturesAt` (`not_matured` otherwise); the receiving account is movable and is not the CD account; the CD balance is positive.\n\nOne transaction posts the transfer pair for the full balance (CD account debited, receiving account credited), sets the product and its account to `closed`, and writes the audit row `lending_cd_withdrawn`. There is no partial or early withdrawal.',
    signature: 'export async function withdrawMaturedCd(user: SessionUser, productId: string, toAccountId: string, now: Date): Promise<LendingProductDTO>',
    detail: 3,
    tags: ['lending', 'money', 'ledger', 'audit'],
    aliases: ['withdraw CD', 'maturity'],
    sources: [
      src(P.lending, 398, 444, 'export async function withdrawMaturedCd'),
      src(P.lending, 405, 409, 'not_matured', 'Maturity check'),
    ],
  }),
  ent('be:lending/lending#listLendingForUser', 'function', 'listLendingForUser', 'be:lending/lending', 'Lists the lending products on every account the caller owns or has been granted access to, newest first.', {
    description: 'Unlike the schedule list, this is scoped by account access, so a joint owner of a CD or loan account would see the product.',
    signature: 'export async function listLendingForUser(user: SessionUser): Promise<LendingProductDTO[]>',
    tags: ['lending'],
    sources: [src(P.lending, 448, 460, 'export async function listLendingForUser')],
  }),
  ent('be:lending/lending#listAllLending', 'function', 'listAllLending', 'be:lending/lending', 'Lists every lending product for the operator view, newest first.', {
    signature: 'export async function listAllLending(): Promise<LendingProductDTO[]>',
    tags: ['lending', 'operations'],
    sources: [src(P.lending, 462, 469, 'export async function listAllLending')],
  }),
];

// ---------------------------------------------------------------------------
// Backend: lending/accrual.ts
// ---------------------------------------------------------------------------

const accrualEntities: Entity[] = [
  ent('be:lending/accrual', 'module', 'lending/accrual.ts', 'be.lending', 'Clock-driven interest accrual: one `interest` ledger entry per whole simulated month that has elapsed for each savings account, CD and loan.', {
    description:
      'Runs on every clock advance, after the scheduler. Each interest-bearing target has a bookmark — `Account.interestAccruedThrough` for savings (falling back to `openedAt`), `LendingProduct.lastAccruedAt` for CDs and loans. For each monthly anniversary of the bookmark that is at or before the new clock time, one entry is posted, dated at that anniversary:\n\n• savings: a credit at 1.50% APY;\n• CD: a credit at the product\'s APY, stopping at maturity, at which point the product becomes `matured`;\n• loan: a debit at the product\'s APY on the amount owed, which increases what is owed.\n\nInterest entries have `origin: \'interest\'`, one of the bank-originated origins allowed to change the system-wide total. The bookmark only advances by whole months, so a partial month never accrues and re-running accrual for the same time adds nothing.',
    audience: {
      executive: 'When the calendar moves forward a month, savers earn interest and borrowers are charged it — recorded as ordinary, traceable ledger entries.',
      'end-user': 'Each simulated month, savings and CDs receive an "Interest earned" entry and loans receive a "Loan interest charged" entry.',
      dba: 'Per target, one transaction: N `LedgerEntry` inserts (origin `interest`), one bookmark update (`Account.interestAccruedThrough` or `LendingProduct.lastAccruedAt` / `status`), and one `AuditLog` row when anything accrued.',
    },
    tech: ['Prisma'],
    tags: ['lending', 'time', 'ledger', 'money', 'audit'],
    aliases: ['interest accrual', 'accrual driver'],
    sources: [
      src(P.accrual, 12, 31, 'Clock-driven INTEREST ACCRUAL', 'Module header'),
      src(P.adr3, 60, 70, 'clock-driven, monthly, bounded, and idempotent', 'ADR-0003 decision 5'),
    ],
  }),
  ent('be:lending/accrual#planMonthlyAccrual', 'function', 'planMonthlyAccrual (private)', 'be:lending/accrual', 'Works out, without touching the database, which monthly interest amounts are due between a bookmark and the new clock time.', {
    description:
      'Steps month by month from `from`: each period ends at `addMonthsClamped(from, n)`. While the period end is at or before `upTo` (and fewer than 24 months have been stepped), it computes `monthlyAccrualMinor(magnitude, apyBps)`, records a period if the interest is above zero, and adds the interest to the running magnitude — so several months in one advance compound. A month whose interest rounds to zero still advances the bookmark. Returns the periods, the new bookmark and the number of months stepped.',
    signature: 'function planMonthlyAccrual(magnitudeStart: number, from: Date, upTo: Date, apyBps: number): AccrualPlan',
    detail: 4,
    tags: ['lending', 'time'],
    aliases: ['MAX_ACCRUAL_MONTHS', 'accrual plan'],
    sources: [src(P.accrual, 48, 73, 'function planMonthlyAccrual'), src(P.accrual, 33, 34, 'MAX_ACCRUAL_MONTHS = 24', 'Per-advance cap')],
  }),
  ent('be:lending/accrual#postInterest', 'function', 'postInterest (private)', 'be:lending/accrual', 'Inserts one posted `interest` ledger entry dated at the simulated accrual instant.', {
    signature: "async function postInterest(tx: DbClient, accountId: string, direction: 'credit' | 'debit', amountMinor: number, description: string, at: Date): Promise<void>",
    detail: 5,
    tags: ['ledger', 'lending'],
    aliases: ['bank-originated interest'],
    sources: [src(P.accrual, 75, 96, 'async function postInterest')],
  }),
  ent('be:lending/accrual#runInterestAccrual', 'function', 'runInterestAccrual', 'be:lending/accrual', 'Accrues interest for every active savings account, CD and loan up to the new clock time and returns a summary for the operator.', {
    description:
      'Savings first: every active `savings` account whose bookmark is before `upTo`. The balance interest is computed on is the account\'s current settled balance at the time accrual runs — after this advance\'s scheduled transfers have posted — not the balance on the anniversary date.\n\nThen every `active` lending product. A CD accrues up to `min(upTo, maturesAt)`; if `upTo` has reached `maturesAt` the product is set to `matured` and its bookmark to `maturesAt`. A loan with nothing owed is skipped.\n\nEach target runs in its own transaction inside its own try/catch: a failure is logged with `console.error` and the rest continue; because each target keeps its own bookmark the next advance retries it. Audit rows (`interest_accrued_savings`, `interest_accrued_cd`, `interest_accrued_cd_matured`, `interest_accrued_loan`) are written with `actorId: null`, `actorRole: \'system\'`.',
    signature: 'export async function runInterestAccrual(upTo: Date): Promise<InterestAccrualSummary>',
    detail: 3,
    tags: ['lending', 'time', 'ledger', 'money', 'audit'],
    aliases: ['accrue interest', 'accrual', 'CD maturity'],
    sources: [
      src(P.accrual, 107, 114, 'export async function runInterestAccrual'),
      src(P.accrual, 116, 154, 'interest_accrued_savings', 'Savings'),
      src(P.accrual, 157, 200, 'interest_accrued_cd_matured', 'CDs and maturity'),
      src(P.accrual, 201, 231, 'interest_accrued_loan', 'Loans'),
    ],
  }),
];

// ---------------------------------------------------------------------------
// Shared: packages/shared/src/lending.ts
// ---------------------------------------------------------------------------

const shLendingEntities: Entity[] = [
  ent('sh:lending', 'module', 'lending.ts', 'shared', 'Shared lending contracts: product kinds and statuses, limits, rate tables, the interest and amortisation maths, validators and DTOs.', {
    description:
      'The customer form and the server run the same validators and the same maths, so the monthly-payment preview and the CD maturity projection shown before submitting match what the server stores and what accrual later posts. The rate a product gets is looked up from the term in a table here; a client cannot choose its own rate.',
    tags: ['lending', 'money', 'validation'],
    aliases: ['lending contracts'],
    sources: [src(P.shLending, 1, 31, 'Lending & savings-interest contracts')],
  }),
  ent('sh:lending#LENDING_KINDS', 'constant', 'LENDING_KINDS / LendingKind', 'sh:lending', 'The two lending products.', {
    values: [
      { value: 'cd', meaning: 'Certificate of Deposit — a positive-balance account that earns interest until maturity' },
      { value: 'loan', meaning: 'Loan — a negative-balance account that is charged interest and paid down' },
    ],
    tags: ['lending'],
    aliases: ['LendingKind', 'isLendingKind'],
    sources: [src(P.shLending, 36, 38, 'export const LENDING_KINDS'), src(P.shLending, 44, 46, 'export function isLendingKind')],
  }),
  ent('sh:lending#LENDING_STATUSES', 'constant', 'LENDING_STATUSES / LendingStatus', 'sh:lending', 'Lifecycle of a lending product.', {
    values: [
      { value: 'active', meaning: 'Open: a CD earning interest, or a loan with a balance owed' },
      { value: 'matured', meaning: 'A CD whose term has elapsed; it can be withdrawn' },
      { value: 'paid_off', meaning: 'A loan repaid to zero; its account is closed' },
      { value: 'closed', meaning: 'A CD whose proceeds were withdrawn; its account is closed' },
    ],
    tags: ['lending'],
    aliases: ['LendingStatus', 'isLendingStatus'],
    sources: [src(P.shLending, 40, 42, 'export const LENDING_STATUSES'), src(P.shLending, 47, 49, 'export function isLendingStatus')],
  }),
  ent('sh:lending#LENDING_LIMITS', 'constant', 'LENDING_LIMITS', 'sh:lending', 'Policy bounds for lending: principal, APY, term and single-payment ranges.', {
    values: [
      { value: 'minPrincipalMinor: 10000', meaning: '$100 minimum CD deposit / loan amount' },
      { value: 'maxPrincipalMinor: 100000000', meaning: '$1,000,000 maximum' },
      { value: 'minApyBps: 0 / maxApyBps: 3000', meaning: 'Stored APY must be 0 – 30.00% (guards seeded values)' },
      { value: 'minTermMonths: 1 / maxTermMonths: 360', meaning: 'Term bounds, 1 month – 30 years' },
      { value: 'minPaymentMinor: 100', meaning: '$1 minimum custom loan payment' },
      { value: 'maxPaymentMinor: 100000000', meaning: '$1,000,000 maximum custom loan payment' },
    ],
    tags: ['lending', 'validation'],
    sources: [src(P.shLending, 53, 67, 'export const LENDING_LIMITS')],
  }),
  ent('sh:lending#DEFAULT_SAVINGS_APY_BPS', 'constant', 'DEFAULT_SAVINGS_APY_BPS', 'sh:lending', 'The rate every plain savings account earns: 150 basis points, i.e. 1.50% APY.', {
    values: [{ value: '150', meaning: '1.50% APY' }],
    tags: ['lending'],
    aliases: ['savings rate'],
    sources: [src(P.shLending, 69, 70, 'export const DEFAULT_SAVINGS_APY_BPS')],
  }),
  ent('sh:lending#CD_RATE_TABLE_BPS', 'constant', 'CD_RATE_TABLE_BPS / CD_TERMS_MONTHS', 'sh:lending', 'The CD terms the bank offers and the APY for each, in basis points.', {
    values: [
      { value: '6 → 350', meaning: '6 months at 3.50%' },
      { value: '12 → 450', meaning: '12 months at 4.50%' },
      { value: '24 → 500', meaning: '24 months at 5.00%' },
      { value: '60 → 525', meaning: '60 months at 5.25%' },
    ],
    tags: ['lending'],
    aliases: ['CD rates', 'CD_TERMS_MONTHS', 'rate table'],
    sources: [src(P.shLending, 72, 79, 'export const CD_RATE_TABLE_BPS')],
  }),
  ent('sh:lending#LOAN_RATE_TABLE_BPS', 'constant', 'LOAN_RATE_TABLE_BPS / LOAN_TERMS_MONTHS', 'sh:lending', 'The loan terms the bank offers and the APY for each, in basis points.', {
    values: [
      { value: '12 → 1200', meaning: '12 months at 12.00%' },
      { value: '24 → 1050', meaning: '24 months at 10.50%' },
      { value: '36 → 950', meaning: '36 months at 9.50%' },
      { value: '60 → 850', meaning: '60 months at 8.50%' },
    ],
    tags: ['lending'],
    aliases: ['loan rates', 'LOAN_TERMS_MONTHS', 'rate table'],
    sources: [src(P.shLending, 81, 88, 'export const LOAN_RATE_TABLE_BPS')],
  }),
  ent('sh:lending#cdApyForTerm', 'function', 'cdApyForTerm', 'sh:lending', 'Looks up the offered CD rate for a term, or null if that term is not offered.', {
    signature: 'export function cdApyForTerm(months: number): number | null',
    detail: 5,
    tags: ['lending'],
    sources: [src(P.shLending, 90, 93, 'export function cdApyForTerm')],
  }),
  ent('sh:lending#loanApyForTerm', 'function', 'loanApyForTerm', 'sh:lending', 'Looks up the offered loan rate for a term, or null if that term is not offered.', {
    signature: 'export function loanApyForTerm(months: number): number | null',
    detail: 5,
    tags: ['lending'],
    sources: [src(P.shLending, 94, 97, 'export function loanApyForTerm')],
  }),
  ent('sh:lending#monthlyAccrualMinor', 'function', 'monthlyAccrualMinor', 'sh:lending', 'One month of interest on a balance: balance × APY ÷ 12, rounded to the nearest cent.', {
    description:
      '`Math.round(|balance| × apyBps / (10000 × 12))`. It uses the magnitude, so a loan\'s negative balance accrues on what is owed. Returns 0 for a zero balance or a non-positive rate. Compounding is not in the formula: it comes from each month\'s interest being posted to the ledger before the next month is computed.',
    signature: 'export function monthlyAccrualMinor(balanceMinor: number, apyBps: number): number',
    detail: 3,
    tags: ['lending', 'money'],
    aliases: ['monthly interest', 'accrual maths'],
    example: { balanceMinor: 520000, apyBps: 150, result: 650 },
    sources: [src(P.shLending, 101, 112, 'export function monthlyAccrualMinor')],
  }),
  ent('sh:lending#amortizedPaymentMinor', 'function', 'amortizedPaymentMinor', 'sh:lending', 'The level monthly payment that repays a loan over its term, rounded up to the cent.', {
    description:
      'Standard amortisation: with monthly rate `r = apyBps / 10000 / 12`, payment = `P × r × (1+r)^n / ((1+r)^n − 1)`, then `Math.ceil` so the balance is never left fractionally outstanding. At a zero rate it is `ceil(P / n)`. The result is stored on the product as `paymentMinor` and is the default amount for a loan payment; nothing enforces that the customer pays it each month.',
    signature: 'export function amortizedPaymentMinor(principalMinor: number, apyBps: number, termMonths: number): number',
    detail: 3,
    tags: ['lending', 'money'],
    aliases: ['level payment', 'amortization', 'monthly payment'],
    example: { principalMinor: 100000, apyBps: 1200, termMonths: 12, result: 8885 },
    sources: [src(P.shLending, 114, 130, 'export function amortizedPaymentMinor')],
  }),
  ent('sh:lending#projectCdMaturityMinor', 'function', 'projectCdMaturityMinor / projectCdInterestMinor', 'sh:lending', 'Projects what a CD will be worth at maturity by applying the same monthly accrual the server posts.', {
    description: 'Used by the customer form for the "projected to be worth" line. `projectCdInterestMinor` is the projection minus the principal.',
    signature: 'export function projectCdMaturityMinor(principalMinor: number, apyBps: number, termMonths: number): number',
    tags: ['lending'],
    aliases: ['projectCdInterestMinor', 'maturity projection'],
    example: { principalMinor: 200000, apyBps: 350, termMonths: 6, result: 203525 },
    sources: [src(P.shLending, 132, 155, 'export function projectCdMaturityMinor')],
  }),
  ent('sh:lending#addMonthsClamped', 'function', 'addMonthsClamped', 'sh:lending', 'Adds calendar months to a date in UTC, clamping the day to the last day of the target month.', {
    description: 'Defines both a product\'s maturity date and the monthly accrual anniversaries. Within one advance the anniversaries are all computed from the same starting bookmark (`from + n months`). The stored bookmark is then the last anniversary reached, so a clamped date (the 31st becoming the 28th) carries forward into later advances.',
    signature: 'export function addMonthsClamped(date: Date, n: number): Date',
    tags: ['lending', 'time'],
    example: { date: '2026-10-01T15:00:00.000Z', n: 6, result: '2027-04-01T15:00:00.000Z' },
    sources: [src(P.shLending, 161, 176, 'export function addMonthsClamped')],
  }),
  ent('sh:lending#monthsElapsed', 'function', 'monthsElapsed', 'sh:lending', 'Counts how many monthly anniversaries of a date fall at or before another date, up to a cap.', {
    description: 'Exported and unit-tested, but not called by the backend at the pinned commit: the accrual driver does its own stepping in `planMonthlyAccrual`.',
    signature: 'export function monthsElapsed(from: Date, upTo: Date, cap = 600): number',
    detail: 5,
    tags: ['lending', 'time'],
    sources: [src(P.shLending, 178, 191, 'export function monthsElapsed')],
  }),
  ent('sh:lending#LendingProductDTO', 'type', 'LendingProductDTO', 'sh:lending', 'A CD or loan as returned to clients: its terms plus the product account\'s derived balance.', {
    fields: [
      { name: 'id', type: 'string', required: true },
      { name: 'kind', type: 'LendingKind', required: true, typeRef: 'sh:lending#LENDING_KINDS', values: ['cd', 'loan'] },
      { name: 'status', type: 'LendingStatus', required: true, typeRef: 'sh:lending#LENDING_STATUSES', values: ['active', 'matured', 'paid_off', 'closed'] },
      { name: 'accountId', type: 'string', required: true, description: 'The product\'s own `cd` / `loan` account.' },
      { name: 'accountName', type: 'string', required: true },
      { name: 'apyBps', type: 'number', required: true, description: 'APY in basis points (450 = 4.50%).' },
      { name: 'termMonths', type: 'number', required: true },
      { name: 'principalMinor', type: 'number', required: true, description: 'Opening principal.' },
      { name: 'paymentMinor', type: 'number | null', required: true, description: 'Level monthly payment for a loan; null for a CD.' },
      { name: 'openedAt', type: 'string', required: true, description: 'ISO, simulated.' },
      { name: 'maturesAt', type: 'string', required: true, description: 'ISO, simulated.' },
      { name: 'lastAccruedAt', type: 'string', required: true, description: 'ISO, simulated — the accrual bookmark.' },
      { name: 'balanceMinor', type: 'number', required: true, description: 'Derived settled balance of the product account; negative for a loan while owed.' },
      { name: 'outstandingMinor', type: 'number', required: true, description: 'Amount owed on a loan (`-balanceMinor`), 0 otherwise.' },
    ],
    example: {
      id: 'lp_loan',
      kind: 'loan',
      status: 'active',
      accountId: 'acc_loan',
      accountName: 'Personal loan',
      apyBps: 1200,
      termMonths: 12,
      principalMinor: 100000,
      paymentMinor: 8885,
      openedAt: '2026-10-01T15:00:00.000Z',
      maturesAt: '2027-10-01T15:00:00.000Z',
      lastAccruedAt: '2026-10-01T15:00:00.000Z',
      balanceMinor: -100000,
      outstandingMinor: 100000,
    },
    detail: 3,
    tags: ['lending', 'data'],
    sources: [src(P.shLending, 195, 228, 'export interface LendingProductDTO')],
  }),
  ent('sh:lending#InterestAccrualSummary', 'type', 'InterestAccrualSummary', 'sh:lending', 'What interest accrual did during one clock advance: how many targets accrued, totals credited and charged, and CDs matured.', {
    fields: [
      { name: 'savingsAccountsAccrued', type: 'number', required: true },
      { name: 'cdsAccrued', type: 'number', required: true },
      { name: 'loansAccrued', type: 'number', required: true },
      { name: 'totalInterestCreditedMinor', type: 'number', required: true, description: 'Interest credited to savings and CDs.' },
      { name: 'totalInterestChargedMinor', type: 'number', required: true, description: 'Interest charged to loans.' },
      { name: 'cdsMatured', type: 'number', required: true },
    ],
    example: { savingsAccountsAccrued: 1, cdsAccrued: 1, loansAccrued: 1, totalInterestCreditedMinor: 1400, totalInterestChargedMinor: 2000, cdsMatured: 0 },
    tags: ['lending', 'operations'],
    sources: [src(P.shLending, 230, 248, 'export interface InterestAccrualSummary')],
  }),
  ent('sh:lending#LendingListResponse', 'type', 'LendingListResponse', 'sh:lending', 'Body of the lending list endpoints: `{ products: LendingProductDTO[] }`.', {
    fields: [{ name: 'products', type: 'LendingProductDTO[]', required: true, typeRef: 'sh:lending#LendingProductDTO' }],
    detail: 5,
    sources: [src(P.shLending, 250, 252, 'export interface LendingListResponse')],
  }),
  ent('sh:lending#LendingProductResponse', 'type', 'LendingProductResponse', 'sh:lending', 'Body of a successful lending action: the product and a confirmation message.', {
    fields: [
      { name: 'product', type: 'LendingProductDTO', required: true, typeRef: 'sh:lending#LendingProductDTO' },
      { name: 'message', type: 'string', required: true },
    ],
    detail: 5,
    sources: [src(P.shLending, 253, 256, 'export interface LendingProductResponse')],
  }),
  ent('sh:lending#OpenCdRequest', 'type', 'OpenCdRequest / NormalizedOpenCd', 'sh:lending', 'Body for opening a CD; the normalised form adds the APY looked up from the term.', {
    fields: [
      { name: 'fundingAccountId', type: 'string', required: true, description: 'Account the principal is moved from.' },
      { name: 'principalMinor', type: 'number', required: true },
      { name: 'termMonths', type: 'number', required: true, values: ['6', '12', '24', '60'] },
      { name: 'apyBps', type: 'number', required: false, description: 'Only on `NormalizedOpenCd`: set by the validator from the rate table.' },
    ],
    example: { fundingAccountId: 'acc_checking', principalMinor: 200000, termMonths: 6 },
    tags: ['lending'],
    aliases: ['NormalizedOpenCd'],
    sources: [src(P.shLending, 260, 273, 'export interface OpenCdRequest')],
  }),
  ent('sh:lending#OpenLoanRequest', 'type', 'OpenLoanRequest / NormalizedOpenLoan', 'sh:lending', 'Body for opening a loan; the normalised form adds the APY and the level monthly payment.', {
    fields: [
      { name: 'disbursementAccountId', type: 'string', required: true, description: 'Account the loan cash is paid into.' },
      { name: 'principalMinor', type: 'number', required: true },
      { name: 'termMonths', type: 'number', required: true, values: ['12', '24', '36', '60'] },
      { name: 'apyBps', type: 'number', required: false, description: 'Only on `NormalizedOpenLoan`: from the rate table.' },
      { name: 'paymentMinor', type: 'number', required: false, description: 'Only on `NormalizedOpenLoan`: `amortizedPaymentMinor(principal, apy, term)`.' },
    ],
    example: { disbursementAccountId: 'acc_checking', principalMinor: 100000, termMonths: 12 },
    tags: ['lending'],
    aliases: ['NormalizedOpenLoan'],
    sources: [src(P.shLending, 275, 289, 'export interface OpenLoanRequest')],
  }),
  ent('sh:lending#LoanPaymentRequest', 'type', 'LoanPaymentRequest / NormalizedLoanPayment', 'sh:lending', 'Body for a loan payment: the paying account and an optional amount.', {
    fields: [
      { name: 'fromAccountId', type: 'string', required: true },
      { name: 'amountMinor', type: 'number | null', required: false, description: 'Omit or null to pay the scheduled monthly payment.' },
    ],
    example: { fromAccountId: 'acc_checking', amountMinor: null },
    tags: ['lending'],
    aliases: ['NormalizedLoanPayment'],
    sources: [src(P.shLending, 291, 302, 'export interface LoanPaymentRequest')],
  }),
  ent('sh:lending#WithdrawCdRequest', 'type', 'WithdrawCdRequest', 'sh:lending', 'Body for withdrawing a matured CD: the receiving account.', {
    fields: [{ name: 'toAccountId', type: 'string', required: true }],
    example: { toAccountId: 'acc_checking' },
    detail: 5,
    tags: ['lending'],
    sources: [src(P.shLending, 304, 308, 'export interface WithdrawCdRequest')],
  }),
  ent('sh:lending#validateOpenCd', 'function', 'validateOpenCd', 'sh:lending', 'Validates an open-CD request and attaches the offered rate for the chosen term.', {
    description:
      'Rules: `fundingAccountId` non-empty; `principalMinor` an integer from 10,000 to 100,000,000 minor units ($100 – $1,000,000); `termMonths` one of the offered terms (6, 12, 24, 60), otherwise "Choose an offered CD term." The normalised value carries `apyBps` from `CD_RATE_TABLE_BPS`.',
    signature: 'export function validateOpenCd(input: Partial<OpenCdRequest>): ValidationResult<NormalizedOpenCd, OpenCdField>',
    tags: ['lending', 'validation'],
    sources: [src(P.shLending, 319, 345, 'export function validateOpenCd'), src(P.shLending, 310, 317, 'function validPrincipal')],
  }),
  ent('sh:lending#validateOpenLoan', 'function', 'validateOpenLoan', 'sh:lending', 'Validates an open-loan request and computes the rate and level monthly payment for the chosen term.', {
    description:
      'Rules: `disbursementAccountId` non-empty; `principalMinor` $100 – $1,000,000 as an integer; `termMonths` one of 12, 24, 36, 60. The normalised value carries `apyBps` from `LOAN_RATE_TABLE_BPS` and `paymentMinor` from `amortizedPaymentMinor`.',
    signature: 'export function validateOpenLoan(input: Partial<OpenLoanRequest>): ValidationResult<NormalizedOpenLoan, OpenLoanField>',
    tags: ['lending', 'validation'],
    sources: [src(P.shLending, 347, 380, 'export function validateOpenLoan')],
  }),
  ent('sh:lending#validateLoanPayment', 'function', 'validateLoanPayment', 'sh:lending', 'Validates a loan payment; a missing amount means "the scheduled monthly payment".', {
    description: 'Rules: `fromAccountId` non-empty; `amountMinor`, when given, an integer from 100 to 100,000,000 minor units ($1 – $1,000,000). Omitted or null becomes `null`, which the server resolves to the product\'s `paymentMinor`.',
    signature: 'export function validateLoanPayment(input: Partial<LoanPaymentRequest>): ValidationResult<NormalizedLoanPayment, LoanPaymentField>',
    tags: ['lending', 'validation'],
    sources: [src(P.shLending, 382, 407, 'export function validateLoanPayment')],
  }),
  ent('sh:lending#validateWithdrawCd', 'function', 'validateWithdrawCd', 'sh:lending', 'Validates a CD withdrawal: a receiving account must be chosen.', {
    signature: "export function validateWithdrawCd(input: Partial<WithdrawCdRequest>): ValidationResult<{ toAccountId: string }, WithdrawCdField>",
    detail: 5,
    tags: ['lending', 'validation'],
    sources: [src(P.shLending, 409, 418, 'export function validateWithdrawCd')],
  }),
  ent('sh:lending#LENDING_KIND_LABELS', 'constant', 'Lending labels and display helpers', 'sh:lending', 'Display labels for product kinds and statuses, plus `formatApy`, `isCdWithdrawable` and `daysBetween`.', {
    description:
      '`LENDING_KIND_LABELS` / `LENDING_STATUS_LABELS` with `lendingKindLabel` / `lendingStatusLabel`; `formatApy(450)` → "4.50%"; `isCdWithdrawable` is true only for a CD whose status is `matured` (the customer page uses it to show the Withdraw button); `daysBetween` powers the "matures in N days" copy.',
    values: [
      { value: 'cd', meaning: 'Certificate of Deposit' },
      { value: 'loan', meaning: 'Loan' },
      { value: 'active / matured / paid_off / closed', meaning: 'Active / Matured / Paid off / Closed' },
    ],
    detail: 5,
    tags: ['lending', 'ui'],
    aliases: ['LENDING_STATUS_LABELS', 'lendingKindLabel', 'lendingStatusLabel', 'formatApy', 'isCdWithdrawable', 'daysBetween', 'APY'],
    sources: [src(P.shLending, 420, 456, 'export const LENDING_KIND_LABELS')],
  }),
];

export const lendingDomainEntities: Entity[] = [...lendingServiceEntities, ...accrualEntities, ...shLendingEntities];

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const lendingDomainRelations: Relation[] = [
  // lending service helpers
  rel('be:lending/lending#requireMovable', 'db:Account', 'reads', 'findUnique by id', { sources: [src(P.lending, 80, 82, 'account.findUnique')] }),
  rel('be:lending/lending#requireMovable', 'be:auth/access#getAccountRelationship', 'calls', 'getAccountRelationship(prisma, userId, accountId)', {
    summary: 'Owner, joint and authorized users may act; viewers and strangers get `forbidden`.',
    sources: [src(P.lending, 83, 86, 'getAccountRelationship')],
  }),
  rel('be:lending/lending#accountCurrentMinor', 'db:LedgerEntry', 'reads', 'findMany by accountId (amount, direction, status)', { sources: [src(P.lending, 103, 109, 'ledgerEntry.findMany')] }),
  rel('be:lending/lending#accountCurrentMinor', 'sh:ledger#deriveBalances', 'calls', 'deriveBalances(entries).currentMinor', {
    summary: 'Balances are derived from ledger rows on every read; nothing is stored.',
    sources: [src(P.lending, 69, 77, 'deriveBalances')],
  }),
  rel('be:lending/lending#postTransferPair', 'db:LedgerEntry', 'writes', "insert 2 posted rows (origin 'transfer': 1 debit + 1 credit)", {
    summary: 'The net-zero pair behind every lending money movement.',
    sources: [src(P.lending, 133, 156, "origin: 'transfer'")],
  }),
  rel('be:lending/lending#toLendingProductDTO', 'be:lending/lending#accountCurrentMinor', 'calls', 'currentMinor(db, product.accountId)', {
    confidence: 'simplified',
    summary: 'Calls the private `currentMinor`, of which `accountCurrentMinor` is the exported alias.',
    sources: [src(P.lending, 161, 167, 'currentMinor(db, product.accountId)')],
  }),
  rel('be:lending/lending#toLendingProductDTO', 'sh:lending#LendingProductDTO', 'uses-type', 'returns LendingProductDTO', { sources: [src(P.lending, 161, 166, 'LendingProductDTO')] }),
  rel('be:lending/lending#assertLendingCapacity', 'db:LendingProduct', 'reads', "count where status 'active' and account.userId", { sources: [src(P.lending, 191, 195, 'lendingProduct.count')] }),
  rel('be:lending/lending#assertLendingCapacity', 'sh:public-demo#RESOURCE_CAPS', 'uses-type', 'RESOURCE_CAPS.openLendingProductsPerUser', { sources: [src(P.lending, 195, 199, 'RESOURCE_CAPS.openLendingProductsPerUser')], detail: 5 }),
  rel('be:lending/lending#requireOwnedProduct', 'db:LendingProduct', 'reads', 'findUnique by id', { sources: [src(P.lending, 326, 328, 'lendingProduct.findUnique')] }),
  rel('be:lending/lending#requireOwnedProduct', 'db:Account', 'reads', 'findUniqueOrThrow by product.accountId', { sources: [src(P.lending, 329, 329, 'account.findUniqueOrThrow')] }),
  rel('be:lending/lending#requireOwnedProduct', 'be:auth/access#getAccountRelationship', 'calls', 'getAccountRelationship(prisma, userId, product.accountId)', { sources: [src(P.lending, 330, 333, 'getAccountRelationship')] }),

  // openCd
  rel('be:lending/lending#openCd', 'be:lending/lending#requireMovable', 'calls', 'requireMovable(user.id, input.fundingAccountId)', { order: 1, sources: [src(P.lending, 210, 210, 'requireMovable')] }),
  rel('be:lending/lending#openCd', 'be:lending/lending#assertLendingCapacity', 'calls', 'assertLendingCapacity(user.id)', { order: 3, sources: [src(P.lending, 214, 214, 'assertLendingCapacity')] }),
  rel('be:lending/lending#openCd', 'sh:lending#addMonthsClamped', 'calls', 'addMonthsClamped(now, input.termMonths)', { order: 4, sources: [src(P.lending, 216, 216, 'addMonthsClamped')], detail: 5 }),
  rel('be:lending/lending#openCd', 'db:Account', 'writes', "insert 1 row (type 'cd')", { order: 5, sources: [src(P.lending, 220, 222, "type: 'cd'")] }),
  rel('be:lending/lending#openCd', 'db:AccountAccess', 'writes', "insert 1 row (relationship 'owner')", { order: 6, sources: [src(P.lending, 223, 225, 'accountAccess.create')] }),
  rel('be:lending/lending#openCd', 'be:lending/lending#postTransferPair', 'calls', 'postTransferPair(tx, { from: funding, to: cdAccount, … })', {
    order: 7,
    summary: 'Principal leaves the funding account and arrives in the CD account.',
    sources: [src(P.lending, 226, 233, 'postTransferPair')],
  }),
  rel('be:lending/lending#openCd', 'db:LendingProduct', 'writes', "insert 1 row (kind 'cd', status 'active')", { order: 8, sources: [src(P.lending, 234, 247, 'lendingProduct.create')] }),
  rel('be:lending/lending#openCd', 'be:auth/audit#writeAudit', 'calls', "writeAudit(tx, { action: 'lending_open_cd', … })", { order: 9, sources: [src(P.lending, 248, 256, 'lending_open_cd')] }),
  rel('be:lending/lending#openCd', 'be:lending/lending#toLendingProductDTO', 'calls', 'toLendingProductDTO(prisma, product, account)', { order: 10, sources: [src(P.lending, 260, 260, 'toLendingProductDTO')], detail: 5 }),
  rel('be:lending/lending#openCd', 'be:lending/lending#LendingError', 'uses-type', "throws LendingError('insufficient_funds')", { sources: [src(P.lending, 211, 213, 'new LendingError')] }),
  rel('be:lending/lending#openCd', 'db:LedgerEntry', 'reads', 'available balance of the funding account', { order: 2, sources: [src(P.lending, 211, 213, 'availableMinor(prisma, funding.id)')] }),

  // openLoan
  rel('be:lending/lending#openLoan', 'be:lending/lending#requireMovable', 'calls', 'requireMovable(user.id, input.disbursementAccountId)', { order: 1, sources: [src(P.lending, 270, 270, 'requireMovable')] }),
  rel('be:lending/lending#openLoan', 'be:lending/lending#assertLendingCapacity', 'calls', 'assertLendingCapacity(user.id)', { order: 2, sources: [src(P.lending, 271, 271, 'assertLendingCapacity')] }),
  rel('be:lending/lending#openLoan', 'sh:lending#addMonthsClamped', 'calls', 'addMonthsClamped(now, input.termMonths)', { order: 3, sources: [src(P.lending, 273, 273, 'addMonthsClamped')], detail: 5 }),
  rel('be:lending/lending#openLoan', 'db:Account', 'writes', "insert 1 row (type 'loan')", { order: 4, sources: [src(P.lending, 277, 279, "type: 'loan'")] }),
  rel('be:lending/lending#openLoan', 'db:AccountAccess', 'writes', "insert 1 row (relationship 'owner')", { order: 5, sources: [src(P.lending, 280, 282, 'accountAccess.create')] }),
  rel('be:lending/lending#openLoan', 'be:lending/lending#postTransferPair', 'calls', 'postTransferPair(tx, { from: loanAccount, to: disbursement, … })', {
    order: 6,
    summary: 'The loan account is debited (goes negative) and the customer\'s account is credited with the cash.',
    sources: [src(P.lending, 283, 293, 'postTransferPair')],
  }),
  rel('be:lending/lending#openLoan', 'db:LendingProduct', 'writes', "insert 1 row (kind 'loan', paymentMinor set)", { order: 7, sources: [src(P.lending, 294, 307, 'lendingProduct.create')] }),
  rel('be:lending/lending#openLoan', 'be:auth/audit#writeAudit', 'calls', "writeAudit(tx, { action: 'lending_open_loan', … })", { order: 8, sources: [src(P.lending, 308, 316, 'lending_open_loan')] }),
  rel('be:lending/lending#openLoan', 'be:lending/lending#toLendingProductDTO', 'calls', 'toLendingProductDTO(prisma, product, account)', { order: 9, sources: [src(P.lending, 320, 320, 'toLendingProductDTO')], detail: 5 }),

  // makeLoanPayment
  rel('be:lending/lending#makeLoanPayment', 'be:lending/lending#requireOwnedProduct', 'calls', 'requireOwnedProduct(user.id, productId)', { order: 1, sources: [src(P.lending, 343, 345, 'requireOwnedProduct')] }),
  rel('be:lending/lending#makeLoanPayment', 'be:lending/lending#requireMovable', 'calls', 'requireMovable(user.id, input.fromAccountId)', { order: 2, sources: [src(P.lending, 347, 348, 'requireMovable')] }),
  rel('be:lending/lending#makeLoanPayment', 'db:LedgerEntry', 'reads', 'amount owed on the loan; available balance of the paying account', { order: 3, sources: [src(P.lending, 350, 360, 'currentMinor(prisma, account.id)')] }),
  rel('be:lending/lending#makeLoanPayment', 'be:lending/lending#postTransferPair', 'calls', 'postTransferPair(tx, { from: paying account, to: loan account, amount })', {
    order: 4,
    summary: 'The payment credits the loan account, moving its negative balance toward zero.',
    sources: [src(P.lending, 362, 370, 'postTransferPair')],
  }),
  rel('be:lending/lending#makeLoanPayment', 'db:LendingProduct', 'writes', "update status ('paid_off' when nothing remains owed)", { order: 5, sources: [src(P.lending, 372, 377, 'lendingProduct.update')] }),
  rel('be:lending/lending#makeLoanPayment', 'db:Account', 'writes', "update loan account status 'closed' when paid off", { order: 6, sources: [src(P.lending, 378, 380, "status: 'closed'")] }),
  rel('be:lending/lending#makeLoanPayment', 'be:auth/audit#writeAudit', 'calls', "writeAudit(tx, { action: 'lending_loan_payment' | 'lending_loan_paid_off', … })", { order: 7, sources: [src(P.lending, 381, 389, 'lending_loan_paid_off')] }),
  rel('be:lending/lending#makeLoanPayment', 'be:lending/lending#toLendingProductDTO', 'calls', 'toLendingProductDTO(prisma, updated, account)', { order: 8, sources: [src(P.lending, 393, 393, 'toLendingProductDTO')], detail: 5 }),
  rel('be:lending/lending#makeLoanPayment', 'be:lending/lending#LendingError', 'uses-type', 'throws LendingError', { sources: [src(P.lending, 344, 360, 'new LendingError')] }),

  // withdrawMaturedCd
  rel('be:lending/lending#withdrawMaturedCd', 'be:lending/lending#requireOwnedProduct', 'calls', 'requireOwnedProduct(user.id, productId)', { order: 1, sources: [src(P.lending, 404, 406, 'requireOwnedProduct')] }),
  rel('be:lending/lending#withdrawMaturedCd', 'be:lending/lending#requireMovable', 'calls', 'requireMovable(user.id, toAccountId)', { order: 2, sources: [src(P.lending, 411, 412, 'requireMovable')] }),
  rel('be:lending/lending#withdrawMaturedCd', 'db:LedgerEntry', 'reads', 'current balance of the CD account', { order: 3, sources: [src(P.lending, 414, 415, 'currentMinor(prisma, account.id)')] }),
  rel('be:lending/lending#withdrawMaturedCd', 'be:lending/lending#postTransferPair', 'calls', 'postTransferPair(tx, { from: CD account, to: receiving account, amount: balance })', {
    order: 4,
    summary: 'The whole CD balance — principal plus earned interest — moves to the chosen account.',
    sources: [src(P.lending, 417, 425, 'postTransferPair')],
  }),
  rel('be:lending/lending#withdrawMaturedCd', 'db:LendingProduct', 'writes', "update status 'closed'", { order: 5, sources: [src(P.lending, 426, 429, 'lendingProduct.update')] }),
  rel('be:lending/lending#withdrawMaturedCd', 'db:Account', 'writes', "update CD account status 'closed'", { order: 6, sources: [src(P.lending, 430, 430, 'account.update')] }),
  rel('be:lending/lending#withdrawMaturedCd', 'be:auth/audit#writeAudit', 'calls', "writeAudit(tx, { action: 'lending_cd_withdrawn', … })", { order: 7, sources: [src(P.lending, 431, 439, 'lending_cd_withdrawn')] }),
  rel('be:lending/lending#withdrawMaturedCd', 'be:lending/lending#toLendingProductDTO', 'calls', 'toLendingProductDTO(prisma, updated, account)', { order: 8, sources: [src(P.lending, 443, 443, 'toLendingProductDTO')], detail: 5 }),
  rel('be:lending/lending#withdrawMaturedCd', 'be:lending/lending#LendingError', 'uses-type', "throws LendingError('not_matured' | 'invalid_state')", { sources: [src(P.lending, 405, 415, 'new LendingError')] }),

  // lists
  rel('be:lending/lending#listLendingForUser', 'db:AccountAccess', 'reads', 'findMany where userId (accountId)', { order: 1, sources: [src(P.lending, 450, 450, 'accountAccess.findMany')] }),
  rel('be:lending/lending#listLendingForUser', 'db:Account', 'reads', 'findMany where userId (id)', { order: 2, sources: [src(P.lending, 451, 451, 'account.findMany')] }),
  rel('be:lending/lending#listLendingForUser', 'db:LendingProduct', 'reads', 'findMany where accountId in (…), newest first', { order: 3, sources: [src(P.lending, 454, 458, 'lendingProduct.findMany')] }),
  rel('be:lending/lending#listLendingForUser', 'be:lending/lending#toLendingProductDTO', 'calls', 'toLendingProductDTO(prisma, p, p.account)', { order: 4, sources: [src(P.lending, 459, 459, 'toLendingProductDTO')], detail: 5 }),
  rel('be:lending/lending#listAllLending', 'db:LendingProduct', 'reads', 'findMany all, newest first', { order: 1, sources: [src(P.lending, 464, 467, 'lendingProduct.findMany')] }),
  rel('be:lending/lending#listAllLending', 'be:lending/lending#toLendingProductDTO', 'calls', 'toLendingProductDTO(prisma, p, p.account)', { order: 2, sources: [src(P.lending, 468, 468, 'toLendingProductDTO')], detail: 5 }),

  // features
  rel('be:lending/lending#openCd', 'feat:lending', 'implements', 'open a CD'),
  rel('be:lending/lending#openLoan', 'feat:lending', 'implements', 'open a loan'),
  rel('be:lending/lending#makeLoanPayment', 'feat:lending', 'implements', 'pay a loan'),
  rel('be:lending/lending#withdrawMaturedCd', 'feat:lending', 'implements', 'withdraw a matured CD'),
  rel('be:lending/lending#accountCurrentMinor', 'feat:balances', 'implements', 'balances derived from the ledger'),

  // accrual
  rel('be:lending/accrual#planMonthlyAccrual', 'sh:lending#monthlyAccrualMinor', 'calls', 'monthlyAccrualMinor(magnitude, apyBps)', { sources: [src(P.accrual, 64, 70, 'monthlyAccrualMinor(magnitude, apyBps)')] }),
  rel('be:lending/accrual#planMonthlyAccrual', 'sh:lending#addMonthsClamped', 'calls', 'addMonthsClamped(from, monthsStepped + 1)', { sources: [src(P.accrual, 63, 71, 'addMonthsClamped(from, monthsStepped + 1)')] }),
  rel('be:lending/accrual#postInterest', 'db:LedgerEntry', 'writes', "insert 1 posted row (origin 'interest')", {
    summary: 'A bank-originated entry: a credit for savings and CDs, a debit for loans, dated at the accrual anniversary.',
    sources: [src(P.accrual, 84, 95, "origin: 'interest'")],
  }),
  rel('be:lending/accrual#runInterestAccrual', 'db:Account', 'reads', "findMany type 'savings', status 'active'", { order: 1, sources: [src(P.accrual, 117, 117, 'account.findMany')] }),
  rel('be:lending/accrual#runInterestAccrual', 'be:lending/lending#accountCurrentMinor', 'calls', 'accountCurrentMinor(prisma, accountId)', {
    order: 2,
    summary: 'The balance (or, negated, the amount owed) interest is computed on.',
    sources: [src(P.accrual, 122, 122, 'accountCurrentMinor'), src(P.accrual, 204, 204, 'accountCurrentMinor')],
  }),
  rel('be:lending/accrual#runInterestAccrual', 'be:lending/accrual#planMonthlyAccrual', 'calls', 'planMonthlyAccrual(balance, from, upTo, apyBps)', { order: 3, sources: [src(P.accrual, 123, 123, 'planMonthlyAccrual')] }),
  rel('be:lending/accrual#runInterestAccrual', 'be:lending/accrual#postInterest', 'calls', "postInterest(tx, accountId, 'credit' | 'debit', interestMinor, description, p.at)", { order: 4, sources: [src(P.accrual, 127, 130, 'postInterest'), src(P.accrual, 210, 213, 'postInterest')] }),
  rel('be:lending/accrual#runInterestAccrual', 'db:Account', 'writes', 'update interestAccruedThrough (savings bookmark)', { n: 2, order: 5, sources: [src(P.accrual, 131, 131, 'interestAccruedThrough: plan.newBookmark')] }),
  rel('be:lending/accrual#runInterestAccrual', 'db:LendingProduct', 'reads', "findMany status 'active'", { order: 6, sources: [src(P.accrual, 157, 157, 'lendingProduct.findMany')] }),
  rel('be:lending/accrual#runInterestAccrual', 'db:LendingProduct', 'writes', "update lastAccruedAt; status 'matured' when a CD reaches maturesAt", {
    n: 2,
    order: 7,
    sources: [src(P.accrual, 175, 183, "data.status = 'matured'"), src(P.accrual, 214, 214, 'lastAccruedAt: plan.newBookmark')],
  }),
  rel('be:lending/accrual#runInterestAccrual', 'be:auth/audit#writeAudit', 'calls', "writeAudit(tx, { actorRole: 'system', action: 'interest_accrued_*', … })", { order: 8, sources: [src(P.accrual, 132, 142, 'interest_accrued_savings')] }),
  rel('be:lending/accrual#runInterestAccrual', 'sh:lending#DEFAULT_SAVINGS_APY_BPS', 'uses-type', 'savings rate', { sources: [src(P.accrual, 123, 123, 'DEFAULT_SAVINGS_APY_BPS')] }),
  rel('be:lending/accrual#runInterestAccrual', 'sh:lending#InterestAccrualSummary', 'uses-type', 'returns InterestAccrualSummary', { sources: [src(P.accrual, 113, 114, 'InterestAccrualSummary')] }),
  rel('be:lending/accrual#runInterestAccrual', 'feat:interest', 'implements', 'monthly interest on clock advance'),
  rel('be:lending/accrual#postInterest', 'feat:interest', 'implements', 'bank-originated interest entries'),

  // shared
  rel('sh:lending#validateOpenCd', 'sh:lending#OpenCdRequest', 'validates', 'validates OpenCdRequest', { sources: [src(P.shLending, 320, 322, 'OpenCdRequest')] }),
  rel('sh:lending#validateOpenCd', 'sh:lending#cdApyForTerm', 'calls', 'cdApyForTerm(termMonths)', { sources: [src(P.shLending, 332, 334, 'cdApyForTerm(termMonths)')] }),
  rel('sh:lending#validateOpenCd', 'sh:lending#LENDING_LIMITS', 'uses-type', 'principal bounds', { sources: [src(P.shLending, 310, 317, 'LENDING_LIMITS.minPrincipalMinor')] }),
  rel('sh:lending#validateOpenLoan', 'sh:lending#OpenLoanRequest', 'validates', 'validates OpenLoanRequest', { sources: [src(P.shLending, 348, 350, 'OpenLoanRequest')] }),
  rel('sh:lending#validateOpenLoan', 'sh:lending#loanApyForTerm', 'calls', 'loanApyForTerm(termMonths)', { sources: [src(P.shLending, 361, 363, 'loanApyForTerm(termMonths)')] }),
  rel('sh:lending#validateOpenLoan', 'sh:lending#amortizedPaymentMinor', 'calls', 'amortizedPaymentMinor(principalMinor, apyBps, termMonths)', {
    summary: 'The level payment is fixed at validation time and stored on the product.',
    sources: [src(P.shLending, 371, 377, 'amortizedPaymentMinor')],
  }),
  rel('sh:lending#validateOpenLoan', 'sh:lending#LENDING_LIMITS', 'uses-type', 'principal bounds', { sources: [src(P.shLending, 357, 359, 'validPrincipal')], confidence: 'simplified' }),
  rel('sh:lending#validateLoanPayment', 'sh:lending#LoanPaymentRequest', 'validates', 'validates LoanPaymentRequest', { sources: [src(P.shLending, 383, 385, 'LoanPaymentRequest')] }),
  rel('sh:lending#validateLoanPayment', 'sh:lending#LENDING_LIMITS', 'uses-type', 'payment bounds', { sources: [src(P.shLending, 392, 399, 'LENDING_LIMITS.minPaymentMinor')] }),
  rel('sh:lending#validateWithdrawCd', 'sh:lending#WithdrawCdRequest', 'validates', 'validates WithdrawCdRequest', { sources: [src(P.shLending, 410, 412, 'WithdrawCdRequest')] }),
  rel('sh:lending#cdApyForTerm', 'sh:lending#CD_RATE_TABLE_BPS', 'uses-type', 'CD_RATE_TABLE_BPS[months]', { sources: [src(P.shLending, 91, 93, 'CD_RATE_TABLE_BPS')], detail: 5 }),
  rel('sh:lending#loanApyForTerm', 'sh:lending#LOAN_RATE_TABLE_BPS', 'uses-type', 'LOAN_RATE_TABLE_BPS[months]', { sources: [src(P.shLending, 95, 97, 'LOAN_RATE_TABLE_BPS')], detail: 5 }),
  rel('sh:lending#projectCdMaturityMinor', 'sh:lending#monthlyAccrualMinor', 'calls', 'monthlyAccrualMinor(balance, apyBps) per month', { sources: [src(P.shLending, 141, 145, 'monthlyAccrualMinor(balance, apyBps)')] }),
  rel('sh:lending#monthsElapsed', 'sh:lending#addMonthsClamped', 'calls', 'addMonthsClamped(from, count + 1)', { sources: [src(P.shLending, 183, 191, 'addMonthsClamped')], detail: 5 }),
  rel('sh:lending#LendingProductDTO', 'sh:lending#LENDING_STATUSES', 'uses-type', 'status: LendingStatus', { sources: [src(P.shLending, 199, 202, 'LendingStatus')], detail: 5 }),
  rel('sh:lending#LendingProductDTO', 'sh:lending#LENDING_KINDS', 'uses-type', 'kind: LendingKind', { sources: [src(P.shLending, 199, 202, 'LendingKind')], detail: 5 }),
  rel('sh:lending#monthlyAccrualMinor', 'feat:interest', 'implements', 'the monthly interest formula'),
  rel('sh:lending#amortizedPaymentMinor', 'feat:lending', 'implements', 'level loan payment'),
];
