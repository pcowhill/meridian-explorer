/**
 * The Theater's derived state, computed once in Theater.tsx and shared with
 * every view through context: the resolved scenario (draft / custom / model /
 * assembled trace), the effective variant, the visible steps at the current
 * detail level, the clamped current index and the per-step marks.
 */
import { createContext, useContext } from 'react';
import {
  Braces,
  CircleDot,
  Database,
  DatabaseZap,
  Diamond,
  FunctionSquare,
  type LucideIcon,
  MonitorSmartphone,
  MousePointerClick,
  Radio,
  Send,
  ShieldCheck,
  StickyNote,
  Reply,
} from 'lucide-react';
import type { Scenario, ScenarioStep, StepKind } from '@/model';
import type { ScenarioSource, StepMark } from './logic';

export interface TheaterData {
  scenario: Scenario;
  source: ScenarioSource;
  variant: string;
  steps: ScenarioStep[];
  /** Steps of the variant at every detail level. */
  allCount: number;
  index: number;
  step: ScenarioStep | undefined;
  marks: StepMark[];
  participants: string[];
  /** Has unsaved edits. */
  dirty: boolean;
  /** Is saved in the workspace (custom). */
  saved: boolean;
  go: (index: number) => void;
  switchVariant: (variant: string) => void;
  reduced: boolean;
}

export const TheaterCtx = createContext<TheaterData | null>(null);

export function useTheater(): TheaterData {
  const ctx = useContext(TheaterCtx);
  if (!ctx) throw new Error('useTheater outside the Theater');
  return ctx;
}

export const STEP_ICON: Record<StepKind, LucideIcon> = {
  ui: MousePointerClick,
  client: MonitorSmartphone,
  request: Send,
  response: Reply,
  guard: ShieldCheck,
  validate: Braces,
  call: FunctionSquare,
  decision: Diamond,
  'db-read': Database,
  'db-write': DatabaseZap,
  event: Radio,
  state: CircleDot,
  note: StickyNote,
};

export const OUTCOME_COLOR: Record<string, string> = {
  success: 'var(--ok)',
  rejected: 'var(--warn)',
  failed: 'var(--bad)',
  pending: 'var(--info)',
  info: 'var(--fg-subtle)',
};

export const OUTCOME_LABEL: Record<string, string> = {
  success: 'succeeds',
  rejected: 'rejected',
  failed: 'fails',
  pending: 'pending',
  info: 'walkthrough',
};
