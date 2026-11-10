import type { ModelSlice } from '../types';
import { clockDomainEntities, clockDomainRelations } from './time-lending/clock-domain';
import { lendingDomainEntities, lendingDomainRelations } from './time-lending/lending-domain';
import { httpContracts, httpEntities, httpRelations } from './time-lending/http';
import { glossary, stateMachines, testEntities, testRelations } from './time-lending/tests-lifecycle';

/**
 * Slice `time-lending`: the simulation clock, the clock-driven scheduler,
 * scheduled payments, loans / CDs and interest accrual — backend services,
 * shared contracts, HTTP endpoints, tests, lifecycles and scenarios.
 */
export const slice: ModelSlice = {
  entities: [...clockDomainEntities, ...lendingDomainEntities, ...httpEntities, ...testEntities],
  relations: [...clockDomainRelations, ...lendingDomainRelations, ...httpRelations, ...testRelations],
  contracts: httpContracts,
  stateMachines,
  glossary,
};
