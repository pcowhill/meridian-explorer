import { describe, expect, it } from 'vitest';
import { baseModel, getModel, getSearchIndex, tokenize } from './index';
import { simpayLayer } from '../state/layers/simpay';

const index = getSearchIndex(baseModel);
const top = (q: string, n = 5) => index.search(q, n).map((r) => r.id);

describe('search', () => {
  it('tokenises camelCase, paths and ids', () => {
    expect(tokenize('createTransfer')).toEqual(expect.arrayContaining(['createtransfer', 'create', 'transfer']));
    expect(tokenize('POST /api/transfers')).toEqual(expect.arrayContaining(['post', 'api', 'transfers']));
    expect(tokenize('be:money/movements#x')).toEqual(expect.arrayContaining(['money', 'movements']));
  });

  it('finds a symbol by exact name first', () => {
    expect(top('deriveBalances', 1)).toEqual(['sh:ledger#deriveBalances']);
    expect(top('LedgerEntry', 3)).toContain('db:LedgerEntry');
  });

  it('finds an endpoint by path and by method + path', () => {
    expect(top('/api/transfers')).toContain('ep:POST /api/transfers');
    expect(top('POST /api/ops/clock/advance', 3)).toContain('ep:POST /api/ops/clock/advance');
  });

  it('finds things by plain words, aliases and tags', () => {
    expect(top('back office', 5)).toContain('operations');
    expect(top('available balance', 8).some((id) => id.includes('ledger') || id === 'feat:balances')).toBe(true);
    expect(index.search('fraud', 20).length).toBeGreaterThan(5);
  });

  it('finds by source file name', () => {
    expect(top('movements.ts', 5)).toContain('be:money/movements');
  });

  it('tolerates a typo and a prefix', () => {
    expect(top('createTransfr', 5)).toContain('be:money/movements#createTransfer');
    expect(top('deriveBal', 3)).toContain('sh:ledger#deriveBalances');
  });

  it('returns scenarios, glossary terms and state machines too', () => {
    const types = new Set(index.search('ledger', 40).map((r) => r.type));
    expect(types.has('entity')).toBe(true);
    expect(index.search('transfers money', 30).some((r) => r.type === 'scenario' && r.id === 'transfer')).toBe(true);
    expect(index.search('minor units', 10).some((r) => r.type === 'term')).toBe(true);
    expect(index.search('status lifecycle', 20).some((r) => r.type === 'machine')).toBe(true);
  });

  it('supports a result filter and a limit', () => {
    const only = index.search('transfer', 5, (r) => r.type === 'scenario');
    expect(only.length).toBeGreaterThan(0);
    expect(only.every((r) => r.type === 'scenario')).toBe(true);
    expect(index.search('a', 3).length).toBeLessThanOrEqual(3);
    expect(index.search('   ')).toEqual([]);
  });

  it('is deterministic', () => {
    expect(top('session cookie', 10)).toEqual(top('session cookie', 10));
  });

  it('only finds hypothetical things when their layer is on', () => {
    expect(index.search('SimPay', 10).some((r) => r.id.startsWith('hypo:'))).toBe(false);
    const withLayer = getSearchIndex(getModel([simpayLayer]));
    const hits = withLayer.search('SimPay', 5);
    expect(hits[0].id).toBe('hypo:simpay');
    expect(hits[0].kind.toLowerCase()).toContain('hypothetical');
    expect(withLayer.search('paypal', 5).some((r) => r.id === 'hypo:simpay')).toBe(true);
  });
});
