import type { ModelSlice } from '../types';
import { libEntities, libRelations } from './operations-app/frontend-lib';
import { uiEntities, uiRelations } from './operations-app/frontend-ui';
import { infraEntities, infraRelations, infraStateMachines } from './operations-app/infra';
import { seedEntities, seedRelations } from './operations-app/seed';

/**
 * The `operations-app` slice: (A) the operations simulator frontend
 * (`apps/operations/src`), (B) delivery & hosting (CI, the release pipeline and
 * the externally-owned hosting contract) and (C) the seed / baseline machinery.
 */
export const slice: ModelSlice = {
  entities: [...uiEntities, ...libEntities, ...infraEntities, ...seedEntities],
  relations: [...uiRelations, ...libRelations, ...infraRelations, ...seedRelations],
  contracts: [],
  scenarios: [],
  stateMachines: [...infraStateMachines],
  glossary: [],
};
