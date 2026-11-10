/**
 * Entry point of the shared Meridian knowledge model.
 *
 *   import { getModel, REPO } from '@/model';
 *   const model = getModel(activeLayers);
 */
import { SLICES } from './data/index';
import { Model } from './model';
import { SearchIndex } from './search';
import type { HypotheticalLayer, ModelSlice } from './types';

export * from './types';
export * from './model';
export * from './scenario';
export * from './search';
export { REPO, AUDIENCES } from './data/core';
export { baseState, IDS as FIXTURE_IDS } from './data/fixtures';

const BASE_SLICES: ModelSlice[] = Object.values(SLICES);

/** The repository-derived model with no hypothetical layers. */
export const baseModel = new Model(BASE_SLICES);

let cacheKey = '';
let cached: Model = baseModel;
let cachedIndex: SearchIndex | null = null;
let cachedIndexFor: Model | null = null;

/**
 * The model with the given hypothetical layers applied on top of the baseline.
 * Cached by layer identity + updatedAt, so calling it on every render is cheap.
 */
export function getModel(layers: HypotheticalLayer[] = []): Model {
  if (layers.length === 0) return baseModel;
  const key = layers.map((l) => `${l.id}@${l.updatedAt ?? ''}#${l.entities.length}.${l.relations.length}.${l.modifications.length}.${l.contracts.length}.${l.scenarios.length}`).join('|');
  if (key !== cacheKey) {
    cached = new Model(BASE_SLICES, layers);
    cacheKey = key;
  }
  return cached;
}

/** Search index for a model (rebuilt only when the model object changes). */
export function getSearchIndex(model: Model): SearchIndex {
  if (cachedIndexFor !== model || !cachedIndex) {
    cachedIndex = new SearchIndex(model);
    cachedIndexFor = model;
  }
  return cachedIndex;
}
