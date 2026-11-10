/**
 * Extracts the source excerpts the explorer displays, from a clone of Meridian
 * at the pinned commit, into src/model/generated/snippets.json (committed, so
 * the deployed app needs no access to the repository at runtime).
 *
 *   MERIDIAN_DIR=../pcowhill/claude-banking-project npx tsx scripts/extract-snippets.ts
 *
 * Only line ranges that the model actually cites are extracted (each capped at
 * MAX_LINES); whole-file references are linked to GitHub instead.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SLICES } from '../src/model/data/index';
import type { ModelSlice, SourceRef } from '../src/model/types';

const MAX_LINES = 70;
const candidates = [process.env.MERIDIAN_DIR, resolve(process.cwd(), '../pcowhill/claude-banking-project'), resolve(process.cwd(), '../claude-banking-project')].filter(Boolean) as string[];
const cloneDir = candidates.find((d) => existsSync(resolve(d, 'package.json')));
if (!cloneDir) throw new Error('Meridian clone not found; set MERIDIAN_DIR');

const refs: SourceRef[] = [];
const visit = (value: unknown): void => {
  if (Array.isArray(value)) return value.forEach(visit);
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (typeof o.file === 'string' && (o.start === undefined || typeof o.start === 'number') && !('id' in o) && !('kind' in o)) refs.push(o as unknown as SourceRef);
    Object.values(o).forEach(visit);
  }
};
for (const slice of Object.values(SLICES) as ModelSlice[]) visit(slice);

const files = new Map<string, string[]>();
const out: Record<string, { text: string; truncated?: boolean }> = {};
let skipped = 0;
for (const ref of refs) {
  if (!ref.start || !ref.end) continue;
  const key = `${ref.file}:${ref.start}-${ref.end}`;
  if (out[key]) continue;
  if (!files.has(ref.file)) {
    const p = resolve(cloneDir, ref.file);
    files.set(ref.file, existsSync(p) ? readFileSync(p, 'utf8').split('\n') : []);
  }
  const lines = files.get(ref.file)!;
  if (!lines.length || ref.start < 1 || ref.end > lines.length) {
    skipped++;
    continue;
  }
  const end = Math.min(ref.end, ref.start + MAX_LINES - 1);
  out[key] = { text: lines.slice(ref.start - 1, end).join('\n'), ...(end < ref.end ? { truncated: true } : {}) };
}

mkdirSync(resolve(process.cwd(), 'src/model/generated'), { recursive: true });
const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(resolve(process.cwd(), 'src/model/generated/snippets.json'), JSON.stringify(sorted));
const bytes = JSON.stringify(sorted).length;
console.log(`Extracted ${Object.keys(out).length} excerpts from ${files.size} files (${(bytes / 1024).toFixed(0)} KiB). ${skipped} skipped.`);
