import type { Entity, ModelSlice } from '../types';

/**
 * Small shared-library exports that frontend slices reference but that fell
 * between the domain slices. Kept separate so each domain slice stays owned by
 * one author.
 */
const entities: Entity[] = [
  {
    id: 'sh:cards#TravelNoticeResponse',
    kind: 'type',
    name: 'TravelNoticeResponse',
    parent: 'sh:cards',
    summary: 'Response of the travel-notice endpoints: the card with its updated list of travel notices.',
    fields: [{ name: 'card', type: 'CardDTO', required: true, typeRef: 'sh:cards#CardDTO', description: 'The card after the notice was added or cancelled.' }],
    tags: ['cards'],
    sources: [{ file: 'packages/shared/src/cards.ts', start: 282, end: 284, symbol: 'export interface TravelNoticeResponse' }],
  },
  {
    id: 'sh:lending#isCdWithdrawable',
    kind: 'function',
    name: 'isCdWithdrawable',
    parent: 'sh:lending',
    summary: 'True when a lending product is a CD whose status is `matured`, i.e. it can be withdrawn.',
    signature: "isCdWithdrawable(product: Pick<LendingProductDTO, 'kind' | 'status'>): boolean",
    tags: ['lending'],
    sources: [{ file: 'packages/shared/src/lending.ts', start: 445, end: 448, symbol: 'export function isCdWithdrawable' }],
  },
  {
    id: 'sh:lending#daysBetween',
    kind: 'function',
    name: 'daysBetween',
    parent: 'sh:lending',
    summary: 'Approximate whole days between two ISO instants, used for “matures in N days” copy.',
    signature: 'daysBetween(fromIso: string, toIso: string): number',
    tags: ['lending', 'time'],
    sources: [{ file: 'packages/shared/src/lending.ts', start: 450, end: 456, symbol: 'export function daysBetween' }],
  },
];

export const slice: ModelSlice = { entities };
