/**
 * The shared Meridian knowledge model — type definitions.
 *
 * Every mode (Architecture Atlas, Scenario Theater, Explanation Studio) reads
 * the SAME entities, relations, contracts, scenarios and state machines defined
 * with these types. Nothing mode-specific lives here.
 *
 * Provenance is first-class: every entity/relation/step carries `sources`
 * (file + line range at the pinned Meridian commit) and a `confidence` that
 * distinguishes repository-verified facts from simplifications, inferences and
 * user-created hypotheticals.
 */

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/**
 * How much the explorer vouches for a statement.
 *  - verified:     read directly from the repository at the pinned commit.
 *  - simplified:   a deliberate simplification of verified behaviour.
 *  - inferred:     a reasonable reading that no single source line states outright.
 *  - hypothetical: NOT in Meridian — a proposed/user-created addition or change.
 */
export type Confidence = 'verified' | 'simplified' | 'inferred' | 'hypothetical';

/** A pointer into the Meridian repository at the pinned commit. */
export interface SourceRef {
  /** Repo-relative path, e.g. `apps/backend/src/money/movements.ts`. */
  file: string;
  /** 1-based inclusive line range. Omit both for a whole-file reference. */
  start?: number;
  end?: number;
  /**
   * A short literal string that MUST appear inside the referenced range (e.g. a
   * function name). `scripts/verify-sources.mjs` checks this against the clone,
   * which is how line references are kept honest.
   */
  symbol?: string;
  /** Why this reference matters ("the insufficient-funds check"). */
  note?: string;
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export type EntityKind =
  | 'system' // the whole product
  | 'app' // a runnable application / deployable (customer app, ops simulator, backend API)
  | 'package' // a shared library workspace
  | 'datastore' // a database
  | 'subsystem' // a curated functional grouping inside an app
  | 'module' // one source file (or a tight group of files)
  | 'route-group' // a Fastify route plugin file
  | 'endpoint' // one HTTP endpoint (has a Contract)
  | 'function' // function / method / hook
  | 'class' // class
  | 'type' // interface / type alias / DTO
  | 'constant' // exported constant / enum-like tuple / config
  | 'db-model' // a Prisma model (table)
  | 'event' // a Socket.IO event / channel
  | 'page' // a UI route/page
  | 'component' // a UI component
  | 'feature' // a product capability (cross-cutting, user-facing)
  | 'role' // a user role / actor
  | 'external' // something outside the Meridian repo (or simulated external party)
  | 'infra' // deployment / CI / runtime infrastructure
  | 'test' // a test file
  | 'doc'; // a documentation file

/** A named, typed field of a data structure (TS type, DB model, request body…). */
export interface FieldDef {
  name: string;
  /** Type as written, e.g. `string`, `Minor`, `LedgerStatus`, `String @id @default(cuid())`. */
  type: string;
  required?: boolean;
  description?: string;
  /** Validation rules / constraints that apply to the field, human-readable. */
  rules?: string[];
  /** Entity id of the type this field refers to, if modelled. */
  typeRef?: string;
  /** DB only: relation target model entity id (foreign key). */
  references?: string;
  /** DB only: flags. */
  primaryKey?: boolean;
  unique?: boolean;
  indexed?: boolean;
  /** Allowed literal values for enum-like string fields. */
  values?: string[];
  /** Nested fields for inline object types. */
  children?: FieldDef[];
  source?: SourceRef;
}

export type AudienceId = 'executive' | 'end-user' | 'systems' | 'developer' | 'dba';

/** Detail level 1 (broadest, least technical) … 5 (source-level). */
export type DetailLevel = 1 | 2 | 3 | 4 | 5;

export interface Entity {
  /** Stable id. See `docs/ARCHITECTURE.md#entity-ids` for the convention. */
  id: string;
  kind: EntityKind;
  name: string;
  /** Containment parent (exactly one, except the root system). */
  parent?: string;
  /** One sentence, plain language. Shown everywhere. */
  summary: string;
  /** Longer technical explanation (plain text; blank lines separate paragraphs). */
  description?: string;
  /** Audience-specific rewordings of the summary. Falls back to `summary`. */
  audience?: Partial<Record<AudienceId, string>>;
  /**
   * The lowest detail level at which this entity is shown by default.
   * If omitted it is derived from `kind` (see `defaultDetailForKind`).
   */
  detail?: DetailLevel;
  /** Free-form tags used for search, filtering and audience emphasis. */
  tags?: string[];
  /** Alternate names people might search for. */
  aliases?: string[];
  /** Technologies involved (React, Fastify, Prisma…). */
  tech?: string[];
  /** Evidence. The FIRST entry is treated as the primary definition. */
  sources?: SourceRef[];
  /** Defaults to `verified`. */
  confidence?: Confidence;
  /** Functions: the signature as written. */
  signature?: string;
  /** Types / DB models / constants: the fields. */
  fields?: FieldDef[];
  /** Constants / enum-like types: the allowed values with meaning. */
  values?: { value: string; meaning?: string }[];
  /** A small realistic example value (JSON-serialisable) for types / DB rows. */
  example?: unknown;
  /** Pages: the client route, e.g. `/move-money`. Endpoints: use Contract instead. */
  route?: string;
  /** Layout hints for spatial views (optional; a sensible default is derived). */
  layout?: {
    /** Row index inside the parent container (children sharing a row sit side by side). */
    row?: number;
    /** Order within the row. */
    order?: number;
  };
  /** Ordering key among siblings when no layout row is given. */
  order?: number;
}

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export type RelationKind =
  | 'http' // client → endpoint/app over HTTP (fetch)
  | 'websocket' // Socket.IO connection (client ↔ server)
  | 'emits' // code → event (publishes)
  | 'subscribes' // code → event (listens)
  | 'calls' // function/module → function/module
  | 'reads' // code → db-model / datastore
  | 'writes' // code → db-model / datastore
  | 'imports' // module → module/package (static dependency)
  | 'uses-type' // code → type/constant
  | 'validates' // validator → type / endpoint → validator
  | 'guards' // auth/abuse guard → endpoint (or endpoint → guard it runs)
  | 'handles' // route-group/handler → endpoint
  | 'renders' // page → component
  | 'navigates' // page → page
  | 'triggers' // event/action → behaviour (causal, possibly async)
  | 'references' // db FK: model → model
  | 'implements' // code → feature, class → interface
  | 'extends' // inheritance
  | 'tests' // test → code
  | 'documents' // doc → entity
  | 'deploys' // infra → app
  | 'proxies' // infra → app (reverse proxy)
  | 'actor-uses'; // role → app/page

/**
 * Coarse groupings of relation kinds — what the UI filters and colours by.
 * Derived from `kind` via `channelOf()`.
 */
export type RelationChannel = 'http' | 'realtime' | 'call' | 'data' | 'type' | 'security' | 'structure' | 'ops';

export interface Relation {
  id: string;
  from: string;
  to: string;
  kind: RelationKind;
  /** Short edge label, e.g. `POST /api/transfers` or `deriveBalances()`. */
  label?: string;
  /** One sentence. */
  summary?: string;
  /** Longer explanation incl. error handling where relevant. */
  description?: string;
  /** Wire protocol when it is a network hop, e.g. `HTTP/JSON (fetch, cookies)` or `Socket.IO`. */
  protocol?: string;
  /** Entity ids of data types carried by this relation. */
  data?: string[];
  /** Is the connection bidirectional (e.g. a socket)? */
  bidirectional?: boolean;
  /** Order hint when a caller performs several relations in sequence. */
  order?: number;
  sources?: SourceRef[];
  confidence?: Confidence;
  tags?: string[];
  detail?: DetailLevel;
}

// ---------------------------------------------------------------------------
// API contracts
// ---------------------------------------------------------------------------

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ContractResponse {
  status: number;
  description: string;
  /** Entity id of the response type, if modelled. */
  typeRef?: string;
  fields?: FieldDef[];
  example?: unknown;
}

export interface ContractError {
  status: number;
  /** Machine code in the body (`code` field) if any, e.g. `insufficient_funds`. */
  code?: string;
  when: string;
  example?: unknown;
  source?: SourceRef;
}

/** One ordered thing the server does while handling the request. */
export interface FlowStep {
  kind:
    | 'hook' // global Fastify hook (CSRF, mutation valve)
    | 'guard' // preHandler (requireAuth, requireRole, rateLimit)
    | 'validate'
    | 'call' // domain/service call
    | 'db-read'
    | 'db-write'
    | 'transaction' // opens a DB transaction (children follow)
    | 'emit' // real-time publish
    | 'decision'
    | 'respond';
  /** Entity id of what is invoked / touched (function, db-model, event, type). */
  target?: string;
  /** Short label, e.g. `validateTransfer(body)`. */
  label: string;
  /** What happens and why, 1–2 sentences. */
  detail?: string;
  /** What ends the request early here (status + code), if this step can reject. */
  rejects?: { status: number; code?: string; when: string }[];
  source?: SourceRef;
  confidence?: Confidence;
}

export interface Contract {
  /** The endpoint entity id, `ep:<METHOD> <path>`. */
  id: string;
  method: HttpMethod;
  path: string;
  summary: string;
  description?: string;
  auth: {
    /** Is a signed-in session required? */
    required: boolean;
    /** Roles allowed (omit = any signed-in user). */
    roles?: string[];
    /** Which session cookie audience serves it. */
    surface?: 'customer' | 'operations' | 'either';
    /** Is the double-submit CSRF header required (authenticated mutations)? */
    csrf?: boolean;
    /** Named rate-limit bucket applied in public-demo mode. */
    rateLimit?: string;
    notes?: string;
  };
  pathParams?: FieldDef[];
  query?: FieldDef[];
  /** Request body fields. */
  body?: FieldDef[];
  /** Entity id of the request body type, if modelled. */
  bodyTypeRef?: string;
  requestExample?: unknown;
  responses: ContractResponse[];
  errors?: ContractError[];
  /** What the server does, in order — also the seed for auto-assembled traces. */
  flow: FlowStep[];
  /** Plain-language side effects ("writes two LedgerEntry rows", "emits ops:request:changed"). */
  sideEffects?: string[];
  /** Does a call change server state? Drives the live-API safety gate. */
  mutates: boolean;
  /** Entity ids of client code that calls this endpoint. */
  calledBy?: string[];
  /** What an integrator needs to know, plain language. */
  integrationNotes?: string;
  sources: SourceRef[];
  confidence?: Confidence;
}

// ---------------------------------------------------------------------------
// State machines
// ---------------------------------------------------------------------------

export interface StateMachine {
  id: string;
  name: string;
  summary: string;
  /** Entity id of the thing whose lifecycle this is (db-model or type). */
  subject: string;
  /** Field holding the state, e.g. `LedgerEntry.status`. */
  field?: string;
  initial: string;
  states: { id: string; label?: string; description?: string; terminal?: boolean }[];
  transitions: {
    from: string;
    to: string;
    label: string;
    /** Entity id of the function that performs the transition. */
    by?: string;
    description?: string;
    source?: SourceRef;
    confidence?: Confidence;
  }[];
  sources?: SourceRef[];
  confidence?: Confidence;
}

// ---------------------------------------------------------------------------
// Scenarios (behaviour over time)
// ---------------------------------------------------------------------------

export type StepKind =
  | 'ui' // a person does something in a UI
  | 'client' // frontend code runs (validation, building a request)
  | 'request' // HTTP request on the wire
  | 'response' // HTTP response on the wire
  | 'guard' // auth / CSRF / rate limit
  | 'validate'
  | 'call' // function call inside a process
  | 'decision' // a branch point
  | 'db-read'
  | 'db-write'
  | 'event' // real-time message
  | 'state' // derived state / outcome worth pausing on
  | 'note'; // presenter narration only

/** A change to the example database, applied when the step completes. */
export interface StateEffect {
  op: 'insert' | 'update' | 'delete';
  /** Table name = Prisma model name, e.g. `LedgerEntry`. */
  table: string;
  /** Row id (required for update/delete; for insert it is `row.id`). */
  id?: string;
  /** insert: the full row. */
  row?: Record<string, unknown>;
  /** update: fields to change. */
  set?: Record<string, unknown>;
}

/** An example database: table name → rows (each row has a string `id`). */
export type WorldState = Record<string, Record<string, unknown>[]>;

export interface ScenarioPayload {
  title: string;
  /** JSON-serialisable example data. */
  data: unknown;
  /** Entity id of the type that describes it. */
  typeRef?: string;
  /** Dot-paths worth highlighting, e.g. `amountMinor`. */
  highlight?: string[];
  /** `http-request` | `http-response` | `socket` | `args` | `row` — affects rendering. */
  format?: 'http-request' | 'http-response' | 'socket' | 'args' | 'return' | 'row' | 'json';
  /** For http formats: `POST /api/transfers` or `201 Created`. */
  line?: string;
  headers?: Record<string, string>;
}

export interface ScenarioStep {
  id: string;
  kind: StepKind;
  /** Short title, e.g. `Check available balance`. */
  title: string;
  /** Entity id of the sender / caller / actor. */
  from: string;
  /** Entity id of the receiver / callee. Same as `from` for self-steps. */
  to: string;
  /** The arrow label in sequence diagrams (keep short). */
  label: string;
  /** What happens, for a technical audience (1–3 sentences). */
  narrative: string;
  /** Audience-specific rewordings. Falls back to `narrative`. */
  audience?: Partial<Record<AudienceId, string>>;
  /** Lowest detail level at which the step is shown (default 2). Level 1 = business outline. */
  detail?: DetailLevel;
  /** Variant ids this step belongs to. Omit = all variants. */
  variants?: string[];
  payload?: ScenarioPayload;
  /** Database effects applied by this step. */
  effects?: StateEffect[];
  /** For `decision` steps: the question and where each answer leads. */
  decision?: {
    question: string;
    options: { label: string; variant: string; description?: string }[];
  };
  sources?: SourceRef[];
  confidence?: Confidence;
  /** Marks a user-added or proposed step. */
  hypothetical?: boolean;
}

export interface ScenarioVariant {
  id: string;
  label: string;
  description?: string;
  /** How the scenario ends in this variant. */
  outcome?: 'success' | 'rejected' | 'failed' | 'pending' | 'info';
  /** True when the variant shows behaviour that does NOT exist in Meridian. */
  hypothetical?: boolean;
}

export interface Scenario {
  id: string;
  title: string;
  /** The question this answers, e.g. `What happens when a customer transfers money?`. */
  question: string;
  summary: string;
  category: 'money' | 'operations' | 'data' | 'security' | 'risk' | 'time' | 'realtime' | 'integration' | 'onboarding' | 'custom';
  tags?: string[];
  /** Ordered participant entity ids (the lanes of the sequence diagram). */
  participants: string[];
  /** Entities for which this scenario is a "related workflow". */
  related: string[];
  variants: ScenarioVariant[];
  /** Default variant id. */
  defaultVariant: string;
  /** Example database before step 1. */
  initialState?: WorldState;
  /** Account ids (in `initialState.Account`) whose derived balances are worth watching. */
  watchAccounts?: string[];
  steps: ScenarioStep[];
  sources?: SourceRef[];
  confidence?: Confidence;
  /** True for user-created scenarios. */
  custom?: boolean;
}

// ---------------------------------------------------------------------------
// Glossary, audiences, walkthroughs
// ---------------------------------------------------------------------------

export interface GlossaryTerm {
  term: string;
  definition: string;
  /** Entity ids that illustrate the term. */
  related?: string[];
  aliases?: string[];
}

export interface AudiencePreset {
  id: AudienceId;
  label: string;
  short: string;
  description: string;
  /** Default detail level when the audience is selected. */
  detail: DetailLevel;
  /** Relation channels shown by default. */
  channels: RelationChannel[];
  /** Entity tags/kinds this audience cares most about (visually emphasised). */
  emphasis: { kinds?: EntityKind[]; tags?: string[] };
}

/** A curated answer to one of the representative questions, across all modes. */
export interface GuidedQuestion {
  id: string;
  question: string;
  blurb: string;
  /** Atlas: entity to focus/select + ids to expand. */
  atlas: { select: string; expand: string[]; focus?: string };
  /** Theater: scenario (+ variant). */
  theater: { scenario: string; variant?: string };
  /** Studio: a generated starting board — entity ids to place. */
  studio: { entities: string[]; title: string };
}

// ---------------------------------------------------------------------------
// Hypothetical layers (non-destructive proposed changes)
// ---------------------------------------------------------------------------

export interface HypotheticalModification {
  id: string;
  /** Entity / relation / contract being changed. */
  target: string;
  /** `add-field` | `change` | `remove` */
  op: 'add-field' | 'change' | 'remove';
  summary: string;
  field?: FieldDef;
  note?: string;
}

export interface HypotheticalLayer {
  id: string;
  name: string;
  description: string;
  /** New entities (all rendered as hypothetical). */
  entities: Entity[];
  /** New relations (all rendered as hypothetical). */
  relations: Relation[];
  /** Proposed contracts for hypothetical endpoints. */
  contracts: Contract[];
  /** Proposed changes/removals to baseline things. */
  modifications: HypotheticalModification[];
  /** Proposed scenarios (e.g. the new integration's flow). */
  scenarios: Scenario[];
  /** True for layers shipped with the explorer as examples (still hypothetical). */
  builtIn?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// ---------------------------------------------------------------------------
// The whole model
// ---------------------------------------------------------------------------

export interface ModelSlice {
  entities?: Entity[];
  relations?: Relation[];
  contracts?: Contract[];
  scenarios?: Scenario[];
  stateMachines?: StateMachine[];
  glossary?: GlossaryTerm[];
}

export interface RepoInfo {
  name: string;
  owner: string;
  repo: string;
  /** Pinned commit SHA all SourceRefs refer to. */
  sha: string;
  commitDate: string;
  url: string;
  version: string;
  live: { customer: string; operations: string };
}
