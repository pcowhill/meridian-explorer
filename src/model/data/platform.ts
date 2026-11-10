import type { ModelSlice } from '../types';
import * as server from './platform/server';
import * as auth from './platform/auth';
import * as abuseRealtime from './platform/abuse-realtime';
import * as routes from './platform/routes';
import * as shared from './platform/shared';
import * as tests from './platform/tests';
import { glossary, stateMachines } from './platform/extras';

/**
 * The `platform` slice: server assembly and configuration (`be.platform`),
 * authentication and access (`be.auth`), abuse protection (`be.abuse`), the
 * Socket.IO server and its events (`be.realtime`), the health / status / meta /
 * auth route groups with their contracts (`be.http`), and the cross-cutting
 * shared-library modules (`sh:auth`, `sh:constants`, `sh:version`, `sh:types`,
 * `sh:public-demo`, `sh:brand`).
 */
export const slice: ModelSlice = {
  entities: [...server.entities, ...auth.entities, ...abuseRealtime.entities, ...routes.entities, ...shared.entities, ...tests.entities],
  relations: [...server.relations, ...auth.relations, ...abuseRealtime.relations, ...routes.relations, ...shared.relations, ...tests.relations],
  contracts: routes.contracts,
  stateMachines,
  glossary,
};
