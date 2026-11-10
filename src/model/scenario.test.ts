import { describe, expect, it } from 'vitest';
import {
  accountBalances,
  activeParticipants,
  applyEffects,
  assembleTrace,
  baseModel,
  baseState,
  contributionOf,
  deriveBalances,
  diffStates,
  FIXTURE_IDS,
  formatMinor,
  reusableSteps,
  stateAfter,
  stateBefore,
  variantSteps,
  visibleSteps,
  type LedgerRow,
  type WorldState,
} from './index';

const m = baseModel;
const entry = (status: LedgerRow['status'], direction: LedgerRow['direction'], amountMinor: number): LedgerRow => ({ status, direction, amountMinor });

describe('deriveBalances (port of Meridian’s ledger rules)', () => {
  it('counts posted entries in both balances', () => {
    expect(deriveBalances([entry('posted', 'credit', 10000), entry('posted', 'debit', 2500)])).toMatchObject({ currentMinor: 7500, availableMinor: 7500 });
  });
  it('reserves pending debits out of available only', () => {
    expect(deriveBalances([entry('posted', 'credit', 10000), entry('pending', 'debit', 3000)])).toMatchObject({ currentMinor: 10000, availableMinor: 7000, pendingDebitMinor: 3000 });
  });
  it('tracks pending credits without making them spendable', () => {
    expect(deriveBalances([entry('pending', 'credit', 5000)])).toMatchObject({ currentMinor: 0, availableMinor: 0, pendingCreditMinor: 5000 });
  });
  it('lets holds reduce available only', () => {
    expect(deriveBalances([entry('posted', 'credit', 10000), entry('held', 'debit', 1000)])).toMatchObject({ currentMinor: 10000, availableMinor: 9000, heldMinor: 1000 });
  });
  it('ignores failed and reversed entries', () => {
    expect(deriveBalances([entry('failed', 'debit', 999), entry('reversed', 'debit', 999)])).toMatchObject({ currentMinor: 0, availableMinor: 0 });
  });
  it('treats disputed entries as posted', () => {
    expect(deriveBalances([entry('posted', 'credit', 5000), entry('disputed', 'debit', 4210)])).toMatchObject({ currentMinor: 790, availableMinor: 790 });
  });
  it('explains each contribution', () => {
    expect(contributionOf(entry('pending', 'debit', 100))).toMatchObject({ current: 0, available: -100 });
    expect(contributionOf(entry('held', 'debit', 100)).rule).toMatch(/available only/i);
  });
  it('derives the fixture’s checking balances', () => {
    expect(accountBalances(baseState(), FIXTURE_IDS.checking)).toMatchObject({ currentMinor: 245110, availableMinor: 233110, pendingDebitMinor: 12000 });
  });
  it('formats minor units', () => {
    expect(formatMinor(123456)).toBe('$1,234.56');
    expect(formatMinor(-5)).toBe('-$0.05');
    expect(formatMinor(0)).toBe('$0.00');
  });
});

describe('state replay', () => {
  const state: WorldState = { T: [{ id: 'a', n: 1 }] };
  it('applies inserts, updates and deletes without mutating the input', () => {
    const next = applyEffects(state, [
      { op: 'insert', table: 'T', row: { id: 'b', n: 2 } },
      { op: 'update', table: 'T', id: 'a', set: { n: 9 } },
    ]);
    expect(next.T).toEqual([{ id: 'a', n: 9 }, { id: 'b', n: 2 }]);
    expect(state.T).toEqual([{ id: 'a', n: 1 }]);
    expect(applyEffects(next, [{ op: 'delete', table: 'T', id: 'a' }]).T).toEqual([{ id: 'b', n: 2 }]);
    expect(applyEffects(state, undefined)).toBe(state);
  });
  it('diffs two states row by row', () => {
    const after = applyEffects(state, [
      { op: 'insert', table: 'T', row: { id: 'b', n: 2 } },
      { op: 'update', table: 'T', id: 'a', set: { n: 9 } },
    ]);
    const [diff] = diffStates(state, after);
    expect(diff.changed).toBe(true);
    expect(diff.rows.find((r) => r.id === 'a')).toMatchObject({ change: 'changed', fields: ['n'] });
    expect(diff.rows.find((r) => r.id === 'b')?.change).toBe('added');
    expect(diffStates(state, state)[0].changed).toBe(false);
  });
});

describe('every scenario', () => {
  for (const s of m.scenarios) {
    describe(s.id, () => {
      it('tells a complete story in each variant at every detail level', () => {
        for (const v of s.variants) {
          expect(variantSteps(s, v.id).length, `${s.id}/${v.id}`).toBeGreaterThanOrEqual(3);
          for (const d of [1, 2, 3, 4, 5] as const) {
            const steps = visibleSteps(s, v.id, d);
            expect(steps.length, `${s.id}/${v.id}@${d}`).toBeGreaterThan(0);
            expect(activeParticipants(s, steps).length).toBeGreaterThan(0);
          }
          expect(visibleSteps(s, v.id, 5)).toEqual(variantSteps(s, v.id));
          expect(visibleSteps(s, v.id, 1).length).toBeLessThanOrEqual(visibleSteps(s, v.id, 5).length);
        }
      });

      it('replays its database effects cleanly', () => {
        if (!s.initialState) return;
        for (const v of s.variants) {
          let state = structuredClone(s.initialState);
          for (const step of variantSteps(s, v.id)) {
            for (const ef of step.effects ?? []) {
              expect(state[ef.table], `${s.id}/${step.id}: table ${ef.table} missing`).toBeDefined();
              const rows = state[ef.table];
              if (ef.op === 'insert') expect(rows.some((r) => r.id === ef.row?.id), `${s.id}/${v.id}/${step.id}: duplicate insert ${String(ef.row?.id)}`).toBe(false);
              else expect(rows.some((r) => r.id === ef.id), `${s.id}/${v.id}/${step.id}: ${ef.op} of missing row ${ef.id}`).toBe(true);
            }
            state = applyEffects(state, step.effects);
          }
          const last = variantSteps(s, v.id).at(-1)!;
          expect(stateAfter(s, v.id, last.id)).toEqual(state);
        }
      });

      it('keeps hidden steps’ effects when the detail level is lowered', () => {
        if (!s.initialState) return;
        const v = s.defaultVariant;
        const all = variantSteps(s, v);
        const outline = visibleSteps(s, v, 1);
        const lastOutline = outline.at(-1)!;
        // State after the last outline step equals replaying every step up to it, hidden ones included.
        let state = structuredClone(s.initialState);
        for (const step of all) {
          state = applyEffects(state, step.effects);
          if (step.id === lastOutline.id) break;
        }
        expect(stateAfter(s, v, lastOutline.id)).toEqual(state);
        expect(stateBefore(s, v, all[0].id)).toEqual(s.initialState);
      });
    });
  }

  it('moves money exactly as the transfer narrative says', () => {
    const s = m.scenario('transfer')!;
    const last = variantSteps(s, 'success').at(-1)!;
    const before = s.initialState!;
    const after = stateAfter(s, 'success', last.id);
    const [chk, sav] = s.watchAccounts!;
    const delta = (acc: string) => accountBalances(after, acc).currentMinor - accountBalances(before, acc).currentMinor;
    expect(delta(chk)).toBe(-25000);
    expect(delta(sav)).toBe(25000);
    // A failed transfer leaves the ledger untouched.
    const failed = stateAfter(s, 'insufficient-funds', variantSteps(s, 'insufficient-funds').at(-1)!.id);
    expect(failed.LedgerEntry).toEqual(before.LedgerEntry);
  });

  it('posts the pending entry when an operator approves', () => {
    const s = m.scenario('ops-approval')!;
    const acc = s.watchAccounts![0];
    const start = accountBalances(s.initialState!, acc);
    const end = accountBalances(stateAfter(s, 'approve', variantSteps(s, 'approve').at(-1)!.id), acc);
    expect(end.pendingDebitMinor).toBeLessThan(start.pendingDebitMinor);
    expect(end.currentMinor).toBeLessThan(start.currentMinor);
    expect(end.availableMinor).toBe(start.availableMinor);
    const rejected = accountBalances(stateAfter(s, 'reject', variantSteps(s, 'reject').at(-1)!.id), acc);
    expect(rejected.currentMinor).toBe(start.currentMinor);
    expect(rejected.availableMinor).toBeGreaterThan(start.availableMinor);
  });
});

describe('automatic trace assembly', () => {
  it('builds a playable scenario for every endpoint', () => {
    for (const c of m.contracts.values()) {
      const s = assembleTrace(m, c.id);
      expect(s, c.id).not.toBeNull();
      expect(s!.steps.length).toBeGreaterThanOrEqual(3);
      expect(s!.id).toBe(`trace:${c.id}`);
      for (const st of s!.steps) {
        expect(s!.participants, `${c.id} ${st.id} from`).toContain(st.from);
        expect(s!.participants, `${c.id} ${st.id} to`).toContain(st.to);
      }
      expect(s!.steps.some((st) => st.kind === 'request')).toBe(true);
      expect(s!.steps.some((st) => st.kind === 'response')).toBe(true);
      expect(s!.confidence).toBe('simplified');
    }
  });

  it('starts the transfer trace from the page and the client function', () => {
    const s = assembleTrace(m, 'ep:POST /api/transfers')!;
    expect(s.participants[0]).toBe('role:customer');
    expect(s.participants).toContain('ep:POST /api/transfers');
    expect(s.participants.some((p) => p.startsWith('cu:'))).toBe(true);
    expect(s.steps.find((st) => st.kind === 'request')?.label).toBe('POST /api/transfers');
    expect(s.steps.some((st) => st.to === 'be:money/movements#createTransfer')).toBe(true);
  });

  it('returns null for something that is not an endpoint', () => {
    expect(assembleTrace(m, 'backend')).toBeNull();
  });

  it('harvests reusable steps, most used first', () => {
    const steps = reusableSteps(m);
    expect(steps.length).toBeGreaterThan(20);
    expect(steps[0].usedBy).toBeGreaterThanOrEqual(steps[steps.length - 1].usedBy);
    expect(steps.some((s) => s.target === 'be:auth/guards#requireAuth')).toBe(true);
  });
});
