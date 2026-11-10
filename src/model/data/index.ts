import type { ModelSlice } from '../types';
import { slice as core } from './core';
import { slice as database } from './database';
import { slice as platform } from './platform';
import { slice as money } from './money';
import { slice as operations } from './operations';
import { slice as cardsRisk } from './cards-risk';
import { slice as timeLending } from './time-lending';
import { slice as customerApp } from './customer-app';
import { slice as operationsApp } from './operations-app';
import { slice as addenda } from './addenda';
import { slice as scenarios } from './scenarios/index';

/** Every slice of the baseline (repository-derived) model, in load order. */
export const SLICES: Record<string, ModelSlice> = {
  core,
  database,
  platform,
  money,
  operations,
  'cards-risk': cardsRisk,
  'time-lending': timeLending,
  'customer-app': customerApp,
  'operations-app': operationsApp,
  addenda,
  scenarios,
};
