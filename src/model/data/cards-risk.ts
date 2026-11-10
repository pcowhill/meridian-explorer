import type { ModelSlice } from '../types';
import { sharedCardEntities, sharedRiskEntities } from './cards-risk/shared';
import { cardBackendEntities, cardBackendRelations } from './cards-risk/backend-cards';
import { riskBackendEntities, riskBackendRelations } from './cards-risk/backend-risk';
import { cardContracts, riskContracts } from './cards-risk/contracts';
import { glossary, stateMachines } from './cards-risk/machines';
import { testEntities, testRelations } from './cards-risk/tests';

/**
 * Slice `cards-risk`: the simulated card lifecycle, fraud alerts and
 * transaction disputes — backend services, routes, shared contracts, tests,
 * state machines and the three scenarios that walk through them.
 */
export const slice: ModelSlice = {
  entities: [...cardBackendEntities, ...riskBackendEntities, ...sharedCardEntities, ...sharedRiskEntities, ...testEntities],
  relations: [...cardBackendRelations, ...riskBackendRelations, ...testRelations],
  contracts: [...cardContracts, ...riskContracts],
  stateMachines,
  glossary,
};
