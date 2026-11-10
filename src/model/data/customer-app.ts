import type { ModelSlice } from '../types';
import { clientEntities, clientRelations } from './customer-app/clients';
import { componentEntities, componentRelations } from './customer-app/components';
import { customerGlossary } from './customer-app/glossary';
import { pageEntities, pageRelations } from './customer-app/pages';
import { sessionEntities, sessionRelations } from './customer-app/session';
import { testEntities, testRelations } from './customer-app/tests';

/**
 * The customer frontend (`apps/customer/src`): route table, session plumbing,
 * API clients, pages, shared components and the tests that pin them.
 *
 * The `http` relations in `customer-app/clients.ts` — one per exported fetch
 * function, to the exact `ep:<METHOD> <path>` it calls — are what connect this
 * app to the backend in every view. The customer app opens no Socket.IO
 * connection, so the slice contains no `subscribes` relations.
 *
 * No scenarios, contracts or state machines are authored here: endpoints and
 * their contracts belong to the backend slices.
 */
export const slice: ModelSlice = {
  entities: [...sessionEntities, ...pageEntities, ...clientEntities, ...componentEntities, ...testEntities],
  relations: [...sessionRelations, ...pageRelations, ...clientRelations, ...componentRelations, ...testRelations],
  contracts: [],
  scenarios: [],
  stateMachines: [],
  glossary: customerGlossary,
};
