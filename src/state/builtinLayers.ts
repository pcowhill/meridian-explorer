import type { HypotheticalLayer } from '@/model';
import { simpayLayer } from './layers/simpay';

/**
 * Example hypothetical layers shipped with the explorer. They are NOT part of
 * Meridian — every entity and relation in them renders as hypothetical — and
 * they start switched off.
 */
export const BUILT_IN_LAYERS: HypotheticalLayer[] = [simpayLayer];
