import type { ModelSlice } from '../types';
import { backendEntities, backendRelations } from './money/backend';
import { sharedEntities, sharedRelations } from './money/shared';
import { contracts } from './money/contracts';
import { testEntities, testRelations } from './money/tests';
import { glossary, stateMachines } from './money/concepts';

/**
 * The `money` slice: money movement and the ledger — the heart of Meridian.
 *
 *  - `money/backend.ts`   the money-movement service and the customer money / account routes
 *  - `money/shared.ts`    integer money, ledger rules, movement contract, transactions, statements
 *  - `money/contracts.ts` the six endpoint contracts
 *  - `money/tests.ts`     the test files that pin this behaviour
 *  - `money/concepts.ts`  the ledger-entry state machine and the glossary
 *  - `scenarios/*.ts`     transfer, account-balances, transaction-validation, external-movement
 */
export const slice: ModelSlice = {
  entities: [...backendEntities, ...sharedEntities, ...testEntities],
  relations: [...backendRelations, ...sharedRelations, ...testRelations],
  contracts,
  stateMachines,
  glossary,
};
