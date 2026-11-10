/** Syntax-highlighted code and source-reference viewers. */
import { useEffect, useState } from 'react';
import { Highlight, themes } from 'prism-react-renderer';
import { ExternalLink, FileCode2 } from 'lucide-react';
import { githubUrl, snippetKey, sourceLabel, type SourceRef } from '@/model';
import { useApp } from '@/state/app';
import { cn } from '@/ui/primitives';

type Snippets = Record<string, { text: string; truncated?: boolean }>;
let snippetCache: Snippets | null = null;
let snippetPromise: Promise<Snippets> | null = null;

/** Source excerpts are a separate chunk, fetched the first time code is shown. */
export function loadSnippets(): Promise<Snippets> {
  if (snippetCache) return Promise.resolve(snippetCache);
  snippetPromise ??= import('@/model/generated/snippets.json').then((m) => {
    snippetCache = (m.default ?? m) as Snippets;
    return snippetCache;
  });
  return snippetPromise;
}

export function useSnippet(ref: SourceRef | undefined): { text: string | null; truncated: boolean; loading: boolean } {
  const key = ref && ref.start ? snippetKey(ref) : null;
  const [state, setState] = useState<{ key: string | null; text: string | null; truncated: boolean }>({ key: null, text: key ? (snippetCache?.[key]?.text ?? null) : null, truncated: false });
  useEffect(() => {
    if (!key) return;
    let live = true;
    void loadSnippets().then((s) => {
      if (live) setState({ key, text: s[key]?.text ?? null, truncated: !!s[key]?.truncated });
    });
    return () => {
      live = false;
    };
  }, [key]);
  if (!key) return { text: null, truncated: false, loading: false };
  const ready = state.key === key || (snippetCache !== null && snippetCache[key] !== undefined);
  const hit = snippetCache?.[key];
  return { text: hit?.text ?? (state.key === key ? state.text : null), truncated: hit?.truncated ?? state.truncated, loading: !ready && snippetCache === null };
}

export function languageOf(file: string): string {
  if (file.endsWith('.tsx')) return 'tsx';
  if (file.endsWith('.ts') || file.endsWith('.mts')) return 'typescript';
  if (file.endsWith('.js') || file.endsWith('.mjs')) return 'javascript';
  if (file.endsWith('.json')) return 'json';
  if (file.endsWith('.prisma')) return 'graphql';
  if (file.endsWith('.sql')) return 'sql';
  if (file.endsWith('.yml') || file.endsWith('.yaml')) return 'yaml';
  if (file.endsWith('.sh')) return 'bash';
  if (file.endsWith('.md')) return 'markdown';
  return 'typescript';
}

interface CodeBlockProps {
  code: string;
  language?: string;
  /** Number of the first line (for the gutter). */
  startLine?: number;
  /** Absolute line numbers to emphasise. */
  highlightLines?: number[];
  maxHeight?: number | string;
  className?: string;
  wrap?: boolean;
}

export function CodeBlock({ code, language = 'typescript', startLine = 1, highlightLines, maxHeight = 320, className, wrap }: CodeBlockProps) {
  const dark = useApp((s) => s.theme === 'dark');
  const hl = new Set(highlightLines ?? []);
  return (
    <Highlight theme={dark ? themes.vsDark : themes.github} code={code.replace(/\n$/, '')} language={language}>
      {({ tokens, getLineProps, getTokenProps }) => (
        <pre
          className={cn('m-0 overflow-auto rounded-md border border-line bg-surface-2/60 py-2 font-mono text-[11.5px] leading-[1.6]', className)}
          style={{ maxHeight, background: 'var(--surface-2)' }}
          data-testid="code-block"
        >
          {tokens.map((line, i) => {
            const n = startLine + i;
            const props = getLineProps({ line });
            return (
              <div key={i} {...props} className={cn('flex pr-3', hl.has(n) && 'bg-[color-mix(in_srgb,var(--accent)_16%,transparent)]')} style={undefined}>
                <span className="w-10 shrink-0 select-none pr-3 text-right text-fg-subtle/70">{n}</span>
                <span className={wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'}>
                  {line.map((token, k) => {
                    const t = getTokenProps({ token });
                    return <span key={k} {...t} />;
                  })}
                </span>
              </div>
            );
          })}
        </pre>
      )}
    </Highlight>
  );
}

/** One source reference: label, GitHub permalink and (if a line range was cited) the excerpt. */
export function SourceView({ source, defaultOpen = false, maxHeight }: { source: SourceRef; defaultOpen?: boolean; maxHeight?: number }) {
  const [open, setOpen] = useState(defaultOpen);
  const hasRange = !!source.start;
  const { text, truncated, loading } = useSnippet(open && hasRange ? source : undefined);
  return (
    <div className="rounded-md border border-line bg-surface" data-testid="source-ref">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <FileCode2 size={13} className="shrink-0 text-fg-subtle" />
        <button
          type="button"
          disabled={!hasRange}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="min-w-0 flex-1 text-left"
          title={source.file}
        >
          <span className="block truncate font-mono text-[11.5px] font-medium text-fg">{sourceLabel(source)}</span>
          {source.note && <span className="block truncate text-[11px] text-fg-muted">{source.note}</span>}
        </button>
        {hasRange && (
          <button type="button" onClick={() => setOpen((o) => !o)} className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-accent hover:bg-surface-2">
            {open ? 'Hide code' : 'Show code'}
          </button>
        )}
        <a
          href={githubUrl(source)}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-fg-muted hover:bg-surface-2 hover:text-fg"
          aria-label={`Open ${sourceLabel(source)} on GitHub`}
        >
          GitHub <ExternalLink size={11} />
        </a>
      </div>
      {open && hasRange && (
        <div className="border-t border-line p-1.5">
          {loading && <div className="px-2 py-3 text-[11.5px] text-fg-subtle">Loading excerpt…</div>}
          {!loading && text === null && <div className="px-2 py-3 text-[11.5px] text-fg-subtle">Excerpt not bundled — open it on GitHub.</div>}
          {text !== null && <CodeBlock code={text} language={languageOf(source.file)} startLine={source.start} maxHeight={maxHeight ?? 300} />}
          {truncated && <div className="px-2 pt-1 text-[11px] text-fg-subtle">Excerpt shortened — the full range is on GitHub.</div>}
        </div>
      )}
    </div>
  );
}

export function SourceList({ sources, openFirst = false, limit }: { sources: SourceRef[] | undefined; openFirst?: boolean; limit?: number }) {
  const [all, setAll] = useState(false);
  if (!sources?.length) return <div className="text-[12px] italic text-fg-subtle">No source reference recorded.</div>;
  const shown = all || !limit ? sources : sources.slice(0, limit);
  return (
    <div className="flex flex-col gap-1.5">
      {shown.map((s, i) => (
        <SourceView key={`${s.file}:${s.start ?? 0}:${i}`} source={s} defaultOpen={openFirst && i === 0} />
      ))}
      {limit && sources.length > limit && !all && (
        <button type="button" onClick={() => setAll(true)} className="self-start rounded px-1.5 py-0.5 text-[11.5px] font-medium text-accent hover:bg-surface-2">
          Show {sources.length - limit} more
        </button>
      )}
    </div>
  );
}
