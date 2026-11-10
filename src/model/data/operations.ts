import type { ModelSlice } from '../types';
import { backendEntities, backendRelations } from './operations/backend';
import { onboardingContracts } from './operations/contracts-onboarding';
import { opsContracts } from './operations/contracts-ops';
import { routeEntities, routeRelations } from './operations/routes';
import { sharedEntities, sharedRelations } from './operations/shared';
import { glossary, stateMachines, testEntities, testRelations } from './operations/tests-and-machines';

/**
 * The `operations` slice: the operations request workflow (`be.ops`), onboarding
 * and joint invitations (`be.onboarding`), their route groups and endpoints, and
 * the shared `operations.ts` / `onboarding.ts` contracts.
 */
export const slice: ModelSlice = {
  entities: [...sharedEntities, ...backendEntities, ...routeEntities, ...testEntities],
  relations: [...sharedRelations, ...backendRelations, ...routeRelations, ...testRelations],
  contracts: [...opsContracts, ...onboardingContracts],
  stateMachines,
  glossary,
};
