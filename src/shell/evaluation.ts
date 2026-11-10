import type { ModeId } from '@/state/app';

export interface EvalScenario {
  id: string;
  title: string;
  goal: string;
  /** What to demonstrate, regardless of mode. */
  tasks: string[];
  /** A concrete way to begin in each mode. */
  start: Record<ModeId, string>;
  /** Guided-question id that sets up a starting point, if any. */
  question?: string;
}

/** The hands-on scenarios for comparing the three modes on the same tasks. */
export const EVAL_SCENARIOS: EvalScenario[] = [
  {
    id: 'A',
    title: 'Understand Meridian’s architecture',
    goal: 'Starting cold, build a mental map of the system.',
    tasks: ['Identify the major applications', 'Open up the Backend API', 'Find its important internal components', 'Inspect how the apps communicate (HTTP vs. real-time)', 'Focus on one subsystem', 'Return to the overall architecture'],
    start: {
      atlas: 'Collapse everything (Home), click Meridian, then Backend API. Click the lines between apps. Press F on a subsystem, U to come back.',
      theater: 'Play “How do the apps communicate?” and watch which components appear as lanes; switch the view to Stage.',
      studio: 'Use Generate → System overview, or drop “Customer Banking App”, “Operations Simulator” and “Backend API” from the palette and let connections auto-fill.',
    },
    question: 'q-communication',
  },
  {
    id: 'B',
    title: 'Explain a money transfer',
    goal: 'Show what happens from the click to the ledger.',
    tasks: ['The initiating user action', 'The request path', 'Relevant validation', 'Backend processing', 'Ledger behaviour', 'Resulting state', 'Code references', 'The data exchanged between steps'],
    start: {
      atlas: 'Search “createTransfer”, reveal it, and follow its relations outward; open the Contract tab on POST /api/transfers.',
      theater: 'Open “What happens when a customer transfers money?”, step through, then switch the outcome to insufficient funds.',
      studio: 'Start from the question “transfer” to get the path on the board, then add the API contract and a JSON widget for the request.',
    },
    question: 'q-transfer',
  },
  {
    id: 'C',
    title: 'Explain a database concept: account balances',
    goal: 'Show that balances are derived, never stored.',
    tasks: ['The relevant database models', 'Ledger entries', 'Current vs. available balance', 'How balances are derived', 'Example data', 'Supporting code'],
    start: {
      atlas: 'Expand SQLite Database, select LedgerEntry and Account; open Data. Then search “deriveBalances”.',
      theater: 'Open “How are account balances calculated?” and watch the balances beside the ledger rows; try the pending-then-posted outcome.',
      studio: 'Add the LedgerEntry and Account tables, then the Balance calculator widget; change an entry’s status live.',
    },
    question: 'q-balances',
  },
  {
    id: 'D',
    title: 'Explain a multi-step process',
    goal: 'Operations approval or a scheduled payment, end to end.',
    tasks: ['Multiple participating components', 'A chronological trace', 'Intermediate states', 'Decision points', 'Alternative outcomes', 'Database and event effects'],
    start: {
      atlas: 'Search “applyOperatorAction”; use Workflows in the inspector; highlight dependencies (D).',
      theater: 'Open “How does an operations employee approve a pending transaction?”; compare approve, reject and hold.',
      studio: 'Start from the approval question, then convert the chain to a sequence and animate the path.',
    },
    question: 'q-approval',
  },
  {
    id: 'E',
    title: 'Explore source-code implementation',
    goal: 'From a feature down to the lines of code, without losing the thread.',
    tasks: ['Start from a high-level feature', 'Its API endpoint', 'The relevant module', 'The relevant function', 'Types and validation', 'The source reference'],
    start: {
      atlas: 'Pick a feature in the Features lens (e.g. Scheduled payments), then drill: endpoint → route group → function → Code tab.',
      theater: 'Raise detail to 5 in any scenario and open the Code section of a step; jump to GitHub.',
      studio: 'Add a function, use “Dependency diagram”, then add a code-excerpt widget for it.',
    },
  },
  {
    id: 'F',
    title: 'Plan a hypothetical integration',
    goal: 'Sketch a PayPal-like external payment service against Meridian.',
    tasks: ['Find the existing interfaces', 'Inspect the data contracts', 'Identify validation behaviour', 'Add a hypothetical external service', 'Connect it to Meridian', 'Show the proposed data exchange', 'Identify potential impacts', 'Keep proposed and existing clearly apart'],
    start: {
      atlas: 'Open POST /api/movements → Contract. Then What-if → switch on the SimPay example, or add your own component and connect it.',
      theater: 'Play the external-movement scenario, then switch on the SimPay layer and play its proposed flow; or add hypothetical steps to a copy.',
      studio: 'Start from the integration question; add a hypothetical component (H), connect it, and build a before/after comparison.',
    },
    question: 'q-integration',
  },
  {
    id: 'G',
    title: 'Improvise during a conversation',
    goal: 'With no preparation, answer a question you choose on the spot. Time yourself.',
    tasks: ['Open any mode', 'Find several relevant components', 'Build a visualisation', 'Add a relationship', 'Highlight an important concept', 'Show data or code', 'Explain a hypothetical change', 'Save or export the result'],
    start: {
      atlas: 'Search, reveal, expand, spotlight; add a what-if component; save the view (B).',
      theater: 'Pick an endpoint → Assemble trace; edit steps; present; save as a custom scenario.',
      studio: 'New board; palette search; connect; annotate; export the board.',
    },
  },
];

export interface Criterion {
  id: string;
  label: string;
  question: string;
}

export const EVAL_CRITERIA: Criterion[] = [
  { id: 'speed', label: 'Speed of explanation construction', question: 'How quickly could you get a useful explanation on screen?' },
  { id: 'clarity', label: 'Clarity', question: 'Would the audience have understood it?' },
  { id: 'navigation', label: 'Ease of navigation', question: 'Could you get where you wanted without getting lost?' },
  { id: 'improvise', label: 'Ability to improvise', question: 'Could you follow an unexpected question?' },
  { id: 'depth', label: 'Technical depth', question: 'Could you reach contracts, data and code when needed?' },
  { id: 'nontechnical', label: 'Suitability for non-technical audiences', question: 'Does it work for a stakeholder or end user?' },
  { id: 'integration', label: 'Support for integration planning', question: 'Could you explore and present a proposed change?' },
  { id: 'presenter', label: 'Overall presenter experience', question: 'Did it feel good to drive during a live call?' },
];
