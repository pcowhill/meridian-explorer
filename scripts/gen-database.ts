/**
 * Generates src/model/data/database.ts from Meridian's Prisma schema, so table
 * names, columns, types, defaults, indexes, relations and line numbers are taken
 * mechanically from the source rather than retyped.
 *
 *   MERIDIAN_DIR=../pcowhill/claude-banking-project npx tsx scripts/gen-database.ts
 *
 * Doc comments (`///`) in the schema become descriptions; inline `//` comments
 * become field descriptions. The small EXTRA table below adds tags, plain-language
 * summaries per audience and example rows — the only hand-written parts.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const candidates = [process.env.MERIDIAN_DIR, resolve(process.cwd(), '../pcowhill/claude-banking-project'), resolve(process.cwd(), '../claude-banking-project')].filter(Boolean) as string[];
const cloneDir = candidates.find((d) => existsSync(resolve(d, 'package.json')));
if (!cloneDir) throw new Error('Meridian clone not found; set MERIDIAN_DIR');

const SCHEMA = 'apps/backend/prisma/schema.prisma';
const lines = readFileSync(resolve(cloneDir, SCHEMA), 'utf8').split('\n');

interface Extra {
  tags: string[];
  aliases?: string[];
  plain: string; // executive / end-user wording
  dba?: string;
  example?: Record<string, unknown>;
  detail?: number;
  row: number;
  order: number;
}

const EXTRA: Record<string, Extra> = {
  User: { tags: ['auth', 'security'], plain: 'A person: a customer or a member of bank staff.', row: 0, order: 0, example: { id: 'usr_avery', email: 'avery.customer@example.com', displayName: 'Avery Customer', role: 'customer', status: 'active', failedLoginAttempts: 0, lockedUntil: null } },
  Session: { tags: ['auth', 'security'], plain: 'A signed-in browser session.', row: 0, order: 1, example: { id: 'ses_1', userId: 'usr_avery', tokenHash: '9f2c…(sha-256)', expiresAt: '2026-10-08T15:00:00.000Z', revokedAt: null } },
  LoginEvent: { tags: ['auth', 'security', 'audit'], plain: 'One row per sign-in attempt, successful or not.', row: 0, order: 2, example: { id: 'lev_1', userId: 'usr_avery', email: 'avery.customer@example.com', success: true, reason: 'ok' } },
  AccountAccess: { tags: ['rbac', 'security'], aliases: ['joint access', 'account grant'], plain: 'Who may see or use which account (owner, joint, authorized, viewer).', row: 1, order: 0, example: { id: 'acs_3', userId: 'usr_jordan', accountId: 'acc_checking', relationship: 'joint' } },
  Account: { tags: ['money'], aliases: ['bank account'], plain: 'A banking product such as a checking or savings account. It has no balance column.', dba: 'No balance column: balances are derived from LedgerEntry rows on every read.', detail: 2, row: 1, order: 1, example: { id: 'acc_checking', userId: 'usr_avery', type: 'checking', name: 'Everyday Checking', currency: 'USD', status: 'active' } },
  LedgerEntry: { tags: ['money', 'ledger'], aliases: ['transaction', 'ledger', 'entries'], plain: 'One line in the bank’s books. Every balance is the sum of these lines.', dba: 'Append-only. amountMinor is a positive integer; sign comes from direction. Only `status` (and postedAt) is ever updated.', detail: 2, row: 1, order: 2, example: { id: 'le_002', accountId: 'acc_checking', amountMinor: 4890, direction: 'debit', status: 'posted', origin: 'card', description: 'QuickFuel', postedAt: '2026-09-09T12:00:00.000Z' } },
  SimulationClock: { tags: ['time'], aliases: ['clock'], plain: 'The single row holding the simulated date and time.', row: 4, order: 0, example: { id: 'singleton', currentTime: '2026-10-01T15:00:00.000Z', speed: 1 } },
  AuditLog: { tags: ['audit', 'security'], aliases: ['audit trail'], plain: 'A permanent record of who did what and why for sensitive actions.', row: 4, order: 1, example: { id: 'aud_1', actorId: 'usr_avery', actorRole: 'customer', action: 'money_transfer', entity: 'account', entityId: 'acc_checking', reason: 'Transfer $250.00 to Goal Savings (simulated)' } },
  OperationsRequest: { tags: ['operations', 'workflow'], aliases: ['ops request', 'queue item', 'work item'], plain: 'A work item waiting for a bank employee: a deposit to review, a fraud alert, an application…', dba: 'payload is a JSON string; for money movements it carries ledgerEntryIds — a soft link, not a foreign key.', detail: 2, row: 2, order: 0, example: { id: 'req_1', type: 'bill_pay', status: 'pending', priority: 'normal', summary: 'Bill payment — City Power & Light ($120.00)', subjectName: 'Avery Customer', payload: '{"kind":"bill_pay","amountMinor":12000,"direction":"outbound","accountId":"acc_checking","ledgerEntryIds":["le_003"],"reference":"MV-3F9A1C"}' } },
  SimulatedEvent: { tags: ['operations', 'integration'], aliases: ['sim event', 'simulated message'], plain: 'A pretend SMS, email or identity check — recorded and shown to staff, never really sent.', row: 2, order: 1, example: { id: 'evt_1', channel: 'email', direction: 'outbound', kind: 'movement_received', status: 'sent', summary: 'Bill payment received — under review (simulated)', requestId: 'req_1' } },
  OnboardingApplication: { tags: ['onboarding'], plain: 'A submitted application to open an account, waiting for staff approval.', row: 2, order: 2, example: { id: 'app_1', reference: 'APP-7K2M9Q', status: 'submitted', fullName: 'Taylor Prospect', email: 'taylor.prospect@example.com', product: 'checking', initialFundingMinor: 50000 } },
  AccountInvitation: { tags: ['onboarding', 'rbac'], plain: 'An invitation for another person to share an account.', row: 2, order: 3, example: { id: 'inv_1', accountId: 'acc_checking', invitedById: 'usr_avery', inviteeEmail: 'jordan.joint@example.com', relationship: 'joint', status: 'pending' } },
  Card: { tags: ['cards'], plain: 'A simulated debit or credit card attached to an account.', row: 3, order: 0, example: { id: 'card_debit', accountId: 'acc_checking', userId: 'usr_avery', cardType: 'debit', network: 'visa', last4: '4821', expMonth: 10, expYear: 2030, status: 'active' } },
  CardTravelNotice: { tags: ['cards'], plain: 'A note that the cardholder will be travelling.', row: 3, order: 1, example: { id: 'tn_1', cardId: 'card_debit', destination: 'Lisbon, Portugal', startsOn: '2026-11-02T00:00:00.000Z', endsOn: '2026-11-12T00:00:00.000Z', status: 'active' } },
  PaymentSchedule: { tags: ['time', 'money'], aliases: ['scheduled payment', 'recurring payment'], plain: 'Instructions for a future or recurring transfer or bill payment.', row: 3, order: 2, example: { id: 'sch_1', userId: 'usr_avery', kind: 'internal_transfer', fromAccountId: 'acc_checking', toAccountId: 'acc_savings', amountMinor: 20000, frequency: 'monthly', nextRunAt: '2026-10-15T12:00:00.000Z', status: 'active', runCount: 0 } },
  LendingProduct: { tags: ['lending'], aliases: ['loan', 'CD', 'certificate of deposit'], plain: 'The terms of a loan or certificate of deposit. The money itself lives in the ledger.', row: 3, order: 3, example: { id: 'lp_1', accountId: 'acc_cd', kind: 'cd', status: 'active', principalMinor: 200000, apyBps: 450, termMonths: 6, paymentMinor: null } },
};

interface Field {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  primaryKey?: boolean;
  unique?: boolean;
  indexed?: boolean;
  references?: string;
  line: number;
}
interface Model {
  name: string;
  start: number;
  end: number;
  doc: string[];
  docStart: number;
  fields: Field[];
  relations: { field: string; to: string; fk: string; line: number; onDelete?: string }[];
  indexes: string[];
}

const models: Model[] = [];
let pendingDoc: string[] = [];
let pendingDocStart = 0;
let current: Model | null = null;
let pendingFieldComment: string[] = [];

lines.forEach((raw, i) => {
  const n = i + 1;
  const line = raw.trim();
  if (!current) {
    if (line.startsWith('///')) {
      if (pendingDoc.length === 0) pendingDocStart = n;
      pendingDoc.push(line.replace(/^\/\/\/\s?/, ''));
      return;
    }
    const m = /^model\s+(\w+)\s*\{/.exec(line);
    if (m) {
      current = { name: m[1], start: n, end: n, doc: pendingDoc, docStart: pendingDoc.length ? pendingDocStart : n, fields: [], relations: [], indexes: [] };
      pendingDoc = [];
      return;
    }
    if (line !== '') pendingDoc = [];
    return;
  }
  if (line === '}') {
    current.end = n;
    models.push(current);
    current = null;
    pendingFieldComment = [];
    return;
  }
  if (line.startsWith('//')) {
    pendingFieldComment.push(line.replace(/^\/\/\s?/, ''));
    return;
  }
  if (line.startsWith('@@')) {
    current.indexes.push(line);
    pendingFieldComment = [];
    return;
  }
  if (line === '') {
    pendingFieldComment = [];
    return;
  }
  const fm = /^(\w+)\s+([\w[\]?]+)\s*(.*)$/.exec(line);
  if (!fm) return;
  const [, name, type, rest] = fm;
  const commentIdx = rest.indexOf('//');
  const attrs = (commentIdx >= 0 ? rest.slice(0, commentIdx) : rest).trim();
  const inline = commentIdx >= 0 ? rest.slice(commentIdx + 2).trim() : '';
  const base = type.replace(/[[\]?]/g, '');
  const isList = type.endsWith('[]');
  const rel = /@relation\(([^)]*)\)/.exec(attrs);
  const isModelType = /^[A-Z]/.test(base) && !['String', 'Int', 'DateTime', 'Boolean', 'Float', 'Json', 'BigInt', 'Decimal', 'Bytes'].includes(base);
  if (isModelType) {
    // A relation field (object side). Record the FK if this side owns it.
    if (rel && /fields:\s*\[(\w+)\]/.test(rel[1])) {
      const fk = /fields:\s*\[(\w+)\]/.exec(rel[1])![1];
      const onDelete = /onDelete:\s*(\w+)/.exec(rel[1])?.[1];
      current.relations.push({ field: name, to: base, fk, line: n, onDelete });
    }
    void isList;
    pendingFieldComment = [];
    return;
  }
  const description = [...pendingFieldComment, inline].filter(Boolean).join(' ').trim() || undefined;
  current.fields.push({
    name,
    type: `${type}${attrs ? ' ' + attrs : ''}`,
    required: !type.endsWith('?'),
    description,
    primaryKey: attrs.includes('@id') || undefined,
    unique: attrs.includes('@unique') || undefined,
    line: n,
  });
  pendingFieldComment = [];
});

// Apply FK + index info onto scalar fields.
for (const m of models) {
  for (const r of m.relations) {
    const f = m.fields.find((x) => x.name === r.fk);
    if (f) {
      f.references = `db:${r.to}`;
      if (r.onDelete) f.description = [f.description, `On delete: ${r.onDelete}.`].filter(Boolean).join(' ');
    }
  }
  for (const idx of m.indexes) {
    const cols = /\[([^\]]+)\]/.exec(idx)?.[1].split(',').map((s) => s.trim()) ?? [];
    for (const c of cols) {
      const f = m.fields.find((x) => x.name === c);
      if (f) {
        if (idx.startsWith('@@unique')) f.description = [f.description, `Part of unique(${cols.join(', ')}).`].filter(Boolean).join(' ');
        else f.indexed = true;
      }
    }
  }
}

const q = (s: string) => JSON.stringify(s);
const firstSentence = (doc: string[]) => {
  const text = doc.join(' ').replace(/\s+/g, ' ').trim();
  const m = /^(.*?[.!?])(\s|$)/.exec(text);
  return (m ? m[1] : text) || '';
};

let out = `// GENERATED by scripts/gen-database.ts from ${SCHEMA} at the pinned Meridian commit.
// Table names, columns, types, defaults, indexes, relations and line numbers are
// taken mechanically from the schema; descriptions are the schema's own comments.
// Re-run the script instead of editing by hand.
import type { Entity, ModelSlice, Relation } from '../types';

const SCHEMA = ${q(SCHEMA)};

const entities: Entity[] = [\n`;

for (const m of models) {
  const x = EXTRA[m.name];
  if (!x) throw new Error(`No EXTRA entry for model ${m.name}`);
  const summary = firstSentence(m.doc) || x.plain;
  const description = m.doc.join(' ').replace(/\s+/g, ' ').trim();
  out += `  {
    id: ${q('db:' + m.name)},
    kind: 'db-model',
    name: ${q(m.name)},
    parent: 'db',
    summary: ${q(summary)},
    description: ${q(description)},
    audience: { executive: ${q(x.plain)}, 'end-user': ${q(x.plain)}${x.dba ? `, dba: ${q(x.dba)}` : ''} },
${x.detail ? `    detail: ${x.detail},\n` : ''}    tags: ${JSON.stringify(['data', 'database', ...x.tags])},
${x.aliases ? `    aliases: ${JSON.stringify(x.aliases)},\n` : ''}    tech: ['Prisma', 'SQLite'],
    layout: { row: ${x.row}, order: ${x.order} },
    sources: [{ file: SCHEMA, start: ${m.docStart}, end: ${m.end}, symbol: ${q('model ' + m.name + ' {')} }],
    fields: [\n`;
  for (const f of m.fields) {
    const parts = [`name: ${q(f.name)}`, `type: ${q(f.type)}`, `required: ${f.required}`];
    if (f.description) parts.push(`description: ${q(f.description)}`);
    if (f.primaryKey) parts.push('primaryKey: true');
    if (f.unique) parts.push('unique: true');
    if (f.indexed) parts.push('indexed: true');
    if (f.references) parts.push(`references: ${q(f.references)}`);
    parts.push(`source: { file: SCHEMA, start: ${f.line}, end: ${f.line}, symbol: ${q(f.name)} }`);
    out += `      { ${parts.join(', ')} },\n`;
  }
  out += `    ],\n${x.example ? `    example: ${JSON.stringify(x.example)},\n` : ''}  },\n`;
}
out += `];\n\nconst relations: Relation[] = [\n`;
for (const m of models) {
  for (const r of m.relations) {
    out += `  {
    id: ${q(`rel:db:${m.name}->db:${r.to}:references:${r.fk}`)},
    from: ${q('db:' + m.name)},
    to: ${q('db:' + r.to)},
    kind: 'references',
    label: ${q(`${r.fk} → ${r.to}.id`)},
    summary: ${q(`Each ${m.name} row points at one ${r.to} through ${r.fk}${r.onDelete ? ` (on delete: ${r.onDelete})` : ''}.`)},
    sources: [{ file: SCHEMA, start: ${r.line}, end: ${r.line}, symbol: ${q(r.field)} }],
  },\n`;
  }
}
out += `];\n\nexport const slice: ModelSlice = { entities, relations };\n`;

writeFileSync(resolve(process.cwd(), 'src/model/data/database.ts'), out);
console.log(`Wrote ${models.length} models, ${models.reduce((a, m) => a + m.fields.length, 0)} fields, ${models.reduce((a, m) => a + m.relations.length, 0)} foreign keys.`);
