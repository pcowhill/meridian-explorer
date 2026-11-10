/**
 * API contract explorer: everything an integrator needs to know about one
 * endpoint — auth, inputs with validation rules, example request/response,
 * every error, and what the server does in order.
 */
import { useState } from 'react';
import { ExternalLink, Lock, LockOpen, Play, ShieldCheck, Timer, TriangleAlert, Zap } from 'lucide-react';
import { REPO, type Contract, type FlowStep } from '@/model';
import { useModel } from '@/state/hooks';
import { Badge, Button, cn, SectionTitle, Tip } from '@/ui/primitives';
import { ConfidenceBadge, MethodBadge, statusColor } from '@/ui/kinds';
import { EntityChip, FieldTable } from './Fields';
import { JsonView } from './JsonView';
import { SourceList, SourceView } from './CodeBlock';

const FLOW_COLOR: Record<FlowStep['kind'], string> = {
  hook: 'var(--c-security)',
  guard: 'var(--c-security)',
  validate: 'var(--warn)',
  call: 'var(--c-call)',
  'db-read': 'var(--c-data)',
  'db-write': 'var(--c-data)',
  transaction: 'var(--c-data)',
  emit: 'var(--c-realtime)',
  decision: 'var(--warn)',
  respond: 'var(--c-http)',
};
const FLOW_LABEL: Record<FlowStep['kind'], string> = {
  hook: 'hook',
  guard: 'guard',
  validate: 'validate',
  call: 'call',
  'db-read': 'read',
  'db-write': 'write',
  transaction: 'txn',
  emit: 'emit',
  decision: 'branch',
  respond: 'respond',
};

/** Ordered server-side steps of a contract. */
export function FlowList({ flow, onPick }: { flow: FlowStep[]; onPick?: (step: FlowStep, index: number) => void }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <ol className="m-0 flex list-none flex-col p-0" data-testid="contract-flow">
      {flow.map((f, i) => {
        const color = FLOW_COLOR[f.kind];
        const expanded = open === i;
        return (
          <li key={i} className="relative flex gap-2 pb-1.5 last:pb-0">
            {i < flow.length - 1 && <span className="absolute left-[9px] top-5 h-full w-px bg-line" aria-hidden />}
            <span className="relative z-10 mt-0.5 flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full border bg-surface text-[9.5px] font-bold" style={{ borderColor: color, color }}>
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => {
                  setOpen(expanded ? null : i);
                  onPick?.(f, i);
                }}
                aria-expanded={expanded}
                className="flex w-full items-start gap-1.5 rounded px-1 py-0.5 text-left hover:bg-surface-2"
              >
                <span className="mt-px shrink-0 rounded px-1 text-[9.5px] font-bold uppercase" style={{ color, background: `color-mix(in srgb, ${color} 13%, transparent)` }}>
                  {FLOW_LABEL[f.kind]}
                </span>
                <span className="min-w-0 flex-1 break-words font-mono text-[11.5px] text-fg">{f.label}</span>
                {f.rejects && f.rejects.length > 0 && (
                  <Tip label={`Can reject: ${f.rejects.map((r) => `${r.status}${r.code ? ` ${r.code}` : ''}`).join(', ')}`} side="top">
                    <TriangleAlert size={12} className="mt-0.5 shrink-0 text-warn" />
                  </Tip>
                )}
              </button>
              {expanded && (
                <div className="mb-1 ml-1 mt-1 flex flex-col gap-1.5 border-l-2 border-line pl-2">
                  {f.detail && <p className="m-0 text-[12px] text-fg-muted">{f.detail}</p>}
                  {f.rejects?.map((r, k) => (
                    <div key={k} className="flex items-start gap-1.5 text-[11.5px]">
                      <span className="mt-px shrink-0 rounded px-1 font-mono text-[10.5px] font-bold" style={{ color: statusColor(r.status), background: `color-mix(in srgb, ${statusColor(r.status)} 14%, transparent)` }}>
                        {r.status}
                      </span>
                      <span className="text-fg-muted">
                        {r.code && <code className="mr-1 text-fg">{r.code}</code>}
                        when {r.when}
                      </span>
                    </div>
                  ))}
                  {f.target && (
                    <div>
                      <EntityChip id={f.target} />
                    </div>
                  )}
                  {f.source && <SourceView source={f.source} />}
                  {f.confidence && f.confidence !== 'verified' && <ConfidenceBadge confidence={f.confidence} />}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

type LiveState = { status: 'idle' } | { status: 'loading' } | { status: 'done'; code: number; body: unknown; ms: number } | { status: 'error'; message: string };

/**
 * Explicit, user-initiated request against the live public demo. Offered only
 * for endpoints that need no session and change nothing (GET /health, /status,
 * /api/meta); credentials are never sent. If the browser blocks the call
 * (CORS), the user is pointed at opening the URL directly instead.
 */
function LiveProbe({ contract }: { contract: Contract }) {
  const [state, setState] = useState<LiveState>({ status: 'idle' });
  const eligible = contract.method === 'GET' && !contract.mutates && !contract.auth.required && !contract.path.includes(':');
  if (!eligible || contract.confidence === 'hypothetical') return null;
  const url = `${REPO.live.customer}${contract.path}`;
  const run = async () => {
    setState({ status: 'loading' });
    const started = performance.now();
    try {
      const res = await fetch(url, { method: 'GET', credentials: 'omit', headers: { accept: 'application/json' } });
      const text = await res.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        body = text.slice(0, 2000);
      }
      setState({ status: 'done', code: res.status, body, ms: Math.round(performance.now() - started) });
    } catch (e) {
      setState({ status: 'error', message: e instanceof Error ? e.message : 'Request failed' });
    }
  };
  return (
    <div className="rounded-md border border-line bg-surface p-2" data-testid="live-probe">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold">Try it against the live demo</div>
          <div className="truncate font-mono text-[11px] text-fg-muted">GET {url}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" icon={<Play size={12} />} onClick={run} disabled={state.status === 'loading'}>
            {state.status === 'loading' ? 'Sending…' : 'Send'}
          </Button>
          <a href={url} target="_blank" rel="noreferrer noopener" className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-fg-muted hover:bg-surface-2">
            Open <ExternalLink size={11} />
          </a>
        </div>
      </div>
      <p className="mb-0 mt-1 text-[11px] text-fg-subtle">Read-only, no credentials sent. Runs only when you press Send.</p>
      {state.status === 'done' && (
        <div className="mt-2">
          <div className="mb-1 flex items-center gap-2 text-[11.5px]">
            <span className="rounded px-1 font-mono font-bold" style={{ color: statusColor(state.code), background: `color-mix(in srgb, ${statusColor(state.code)} 14%, transparent)` }}>
              {state.code}
            </span>
            <span className="text-fg-subtle">{state.ms} ms · live response</span>
          </div>
          <JsonView data={state.body} defaultDepth={3} />
        </div>
      )}
      {state.status === 'error' && (
        <div className="mt-2 rounded bg-[color-mix(in_srgb,var(--warn)_12%,transparent)] px-2 py-1.5 text-[11.5px] text-fg">
          The browser could not complete the request ({state.message}). This usually means the demo does not allow cross-origin calls from this page. Use <b>Open</b> to view the response in a new tab; the documented example below shows the same shape.
        </div>
      )}
    </div>
  );
}

export function AuthSummary({ contract }: { contract: Contract }) {
  const a = contract.auth;
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="contract-auth">
      {a.required ? (
        <Badge color="var(--c-security)">
          <Lock size={10} /> Session required
        </Badge>
      ) : (
        <Badge color="var(--ok)">
          <LockOpen size={10} /> Public
        </Badge>
      )}
      {a.roles?.map((r) => (
        <Badge key={r} color="var(--k-role)">
          role: {r}
        </Badge>
      ))}
      {a.surface && a.surface !== 'either' && <Badge color="var(--fg-muted)">{a.surface} cookie</Badge>}
      {a.csrf && (
        <Badge color="var(--c-security)">
          <ShieldCheck size={10} /> CSRF header
        </Badge>
      )}
      {a.rateLimit && (
        <Badge color="var(--warn)">
          <Timer size={10} /> rate limit: {a.rateLimit}
        </Badge>
      )}
      {contract.mutates ? (
        <Badge color="var(--warn)">
          <Zap size={10} /> changes state
        </Badge>
      ) : (
        <Badge color="var(--ok)">read-only</Badge>
      )}
    </div>
  );
}

export function ContractView({ contract, compact }: { contract: Contract; compact?: boolean }) {
  const model = useModel();
  const [status, setStatus] = useState<number>(contract.responses[0]?.status ?? 200);
  const response = contract.responses.find((r) => r.status === status) ?? contract.responses[0];
  const bodyType = model.entity(contract.bodyTypeRef);
  const proposedFields = model
    .modificationsFor(contract.id)
    .filter((m) => m.op === 'add-field' && m.field)
    .map((m) => m.field!);

  return (
    <div className={cn('flex flex-col gap-4', contract.confidence === 'hypothetical' && 'rounded-lg border border-dashed border-hypo p-2')} data-testid="contract-view">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <MethodBadge method={contract.method} />
          <code className="break-all text-[13px] font-semibold text-fg">{contract.path}</code>
          <ConfidenceBadge confidence={contract.confidence} />
        </div>
        <p className="mb-2 mt-1.5 text-[12.5px] text-fg-muted">{contract.summary}</p>
        <AuthSummary contract={contract} />
        {contract.auth.notes && <p className="mb-0 mt-1.5 text-[11.5px] text-fg-subtle">{contract.auth.notes}</p>}
      </div>

      {contract.integrationNotes && (
        <div className="rounded-md border-l-[3px] border-accent bg-surface-2 px-2.5 py-2 text-[12px] text-fg">
          <div className="mb-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-fg-subtle">For integrators</div>
          {contract.integrationNotes}
        </div>
      )}

      {contract.pathParams && contract.pathParams.length > 0 && (
        <section>
          <SectionTitle>Path parameters</SectionTitle>
          <FieldTable fields={contract.pathParams} />
        </section>
      )}
      {contract.query && contract.query.length > 0 && (
        <section>
          <SectionTitle>Query parameters</SectionTitle>
          <FieldTable fields={contract.query} />
        </section>
      )}
      {((contract.body && contract.body.length > 0) || proposedFields.length > 0) && (
        <section>
          <SectionTitle right={bodyType && <EntityChip id={bodyType.id} />}>Request body</SectionTitle>
          <FieldTable fields={contract.body ?? []} proposed={proposedFields} />
        </section>
      )}
      {contract.requestExample !== undefined && contract.requestExample !== null && (
        <section>
          <SectionTitle>Example request</SectionTitle>
          <JsonView data={contract.requestExample} fields={contract.body} label={`${contract.method} ${contract.path}`} showToolbar />
        </section>
      )}

      <section>
        <SectionTitle>Responses</SectionTitle>
        <div className="mb-1.5 flex flex-wrap gap-1">
          {contract.responses.map((r) => (
            <button
              key={r.status}
              type="button"
              onClick={() => setStatus(r.status)}
              aria-pressed={status === r.status}
              className={cn('rounded-md border px-2 py-0.5 font-mono text-[11.5px] font-bold', status === r.status ? 'border-transparent' : 'border-line bg-surface opacity-70 hover:opacity-100')}
              style={{ color: statusColor(r.status), background: status === r.status ? `color-mix(in srgb, ${statusColor(r.status)} 15%, transparent)` : undefined }}
            >
              {r.status}
            </button>
          ))}
        </div>
        {response && (
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-fg-muted">
              {response.description}
              {response.typeRef && <EntityChip id={response.typeRef} />}
            </div>
            {response.fields && response.fields.length > 0 && !compact && <FieldTable fields={response.fields} />}
            {response.example !== undefined && <JsonView data={response.example} fields={response.fields} label={`${response.status} response`} showToolbar />}
          </div>
        )}
      </section>

      {contract.errors && contract.errors.length > 0 && (
        <section>
          <SectionTitle>Errors</SectionTitle>
          <div className="overflow-hidden rounded-md border border-line">
            <table className="w-full border-collapse text-left text-[11.5px]" data-testid="contract-errors">
              <tbody>
                {contract.errors.map((e, i) => (
                  <tr key={i} className="border-t border-line align-top first:border-t-0">
                    <td className="w-12 px-2 py-1.5">
                      <span className="rounded px-1 font-mono text-[11px] font-bold" style={{ color: statusColor(e.status), background: `color-mix(in srgb, ${statusColor(e.status)} 14%, transparent)` }}>
                        {e.status}
                      </span>
                    </td>
                    <td className="w-[30%] px-1 py-1.5 font-mono text-[11px] text-fg">{e.code ?? '—'}</td>
                    <td className="px-2 py-1.5 text-fg-muted">{e.when}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <SectionTitle>What the server does, in order</SectionTitle>
        <FlowList flow={contract.flow} />
      </section>

      {contract.sideEffects && contract.sideEffects.length > 0 && (
        <section>
          <SectionTitle>Side effects</SectionTitle>
          <ul className="m-0 list-none space-y-1 p-0">
            {contract.sideEffects.map((s) => (
              <li key={s} className="flex gap-2 text-[12px] text-fg-muted">
                <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
                {s}
              </li>
            ))}
          </ul>
        </section>
      )}

      {contract.calledBy && contract.calledBy.length > 0 && (
        <section>
          <SectionTitle>Called by</SectionTitle>
          <div className="flex flex-wrap gap-1">
            {contract.calledBy.map((id) => (
              <EntityChip key={id} id={id} />
            ))}
          </div>
        </section>
      )}

      <LiveProbe contract={contract} />

      {!compact && (
        <section>
          <SectionTitle>Source</SectionTitle>
          <SourceList sources={contract.sources} limit={3} />
        </section>
      )}
    </div>
  );
}
