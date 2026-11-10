/** The application's top bar: mode switch, search, audience & detail, hypothetical layers, views, presenter mode, help. */
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BookOpen,
  ChevronDown,
  CircleHelp,
  Clapperboard,
  ClipboardCheck,
  Compass,
  Download,
  FlaskConical,
  Info,
  Keyboard,
  Link2,
  Map as MapIcon,
  Minus,
  Moon,
  PanelRight,
  PenTool,
  Plus,
  Presentation,
  Search,
  Sun,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { AUDIENCES, type DetailLevel } from '@/model';
import { MODES, useApp, type ModeId } from '@/state/app';
import { useWorkspace } from '@/state/workspace';
import { Button, cn, IconButton, MenuDivider, MenuItem, MenuLabel, Popover, Switch, Tip } from '@/ui/primitives';
import { HypotheticalComponentDialog } from './ProposeChange';

const MODE_ICON: Record<ModeId, typeof MapIcon> = { atlas: MapIcon, theater: Clapperboard, studio: PenTool };

const DETAIL_LABEL: Record<DetailLevel, string> = {
  1: 'Outline',
  2: 'Product',
  3: 'System',
  4: 'Code structure',
  5: 'Everything',
};

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="7" fill="var(--fg)" />
      <circle cx="16" cy="16" r="9" fill="none" stroke="var(--bg)" strokeWidth="2" />
      <path d="M16 5v22M7 16h18" stroke="var(--bg)" strokeWidth="1.4" opacity=".65" />
      <circle cx="16" cy="16" r="2.6" fill="var(--accent)" />
    </svg>
  );
}

function ModeSwitch() {
  const mode = useApp((s) => s.mode);
  const setMode = useApp((s) => s.setMode);
  return (
    <div role="tablist" aria-label="Mode" className="flex items-center rounded-lg border border-line bg-surface-2 p-0.5">
      {MODES.map((m) => {
        const Icon = MODE_ICON[m.id];
        const active = mode === m.id;
        return (
          <Tip key={m.id} label={m.tagline} keys={m.keys}>
            <button
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`mode-${m.id}`}
              onClick={() => setMode(m.id)}
              className={cn(
                `mode-${m.id} inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-semibold transition-colors`,
                active ? 'bg-surface text-accent shadow-[0_1px_2px_rgb(0_0_0/0.14)]' : 'text-fg-muted hover:text-fg',
              )}
            >
              <Icon size={14} />
              <span className="hidden lg:inline">{m.label}</span>
              <span className="lg:hidden">{m.label.split(' ')[1]}</span>
            </button>
          </Tip>
        );
      })}
    </div>
  );
}

function AudienceControl() {
  const audience = useApp((s) => s.audience);
  const setAudience = useApp((s) => s.setAudience);
  const detail = useApp((s) => s.detail);
  const setDetail = useApp((s) => s.setDetail);
  const current = AUDIENCES.find((a) => a.id === audience)!;
  return (
    <div className="flex items-center gap-1.5">
      <Popover
        align="end"
        className="w-80"
        trigger={(p) => (
          <Tip label="Who are you explaining to? Sets terminology and a starting level of detail." keys="A">
            <button type="button" data-testid="audience-button" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2 text-[12.5px] font-medium hover:bg-surface-2" {...p}>
              <Users size={13} className="text-fg-muted" />
              <span className="hidden xl:inline text-fg-subtle">Audience</span>
              <span>{current.short}</span>
              <ChevronDown size={12} className="text-fg-subtle" />
            </button>
          </Tip>
        )}
      >
        {(close) => (
          <div role="menu" data-testid="audience-menu">
            <MenuLabel>Explain it for…</MenuLabel>
            {AUDIENCES.map((a) => (
              <MenuItem
                key={a.id}
                active={a.id === audience}
                onClick={() => {
                  setAudience(a.id);
                  close();
                }}
                hint={a.description}
              >
                {a.label}
              </MenuItem>
            ))}
            <MenuDivider />
            <div className="px-2 pb-1.5 pt-0.5 text-[11px] text-fg-subtle">Presets never hide anything for good — raise the detail level or search to reach any depth.</div>
          </div>
        )}
      </Popover>

      <div className="flex h-8 items-center rounded-md border border-line bg-surface" role="group" aria-label="Detail level" data-testid="detail-control">
        <Tip label="Less detail" keys="-">
          <button type="button" aria-label="Less detail" disabled={detail <= 1} onClick={() => setDetail((detail - 1) as DetailLevel)} className="flex h-full w-6 items-center justify-center rounded-l-md text-fg-muted hover:bg-surface-2 disabled:opacity-30">
            <Minus size={12} />
          </button>
        </Tip>
        <Tip label={`Detail level ${detail} of 5 — ${DETAIL_LABEL[detail]}`}>
          <div className="flex h-full items-center gap-1.5 px-1.5" aria-live="polite">
            <span className="flex gap-[3px]" aria-hidden>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" tabIndex={-1} onClick={() => setDetail(n as DetailLevel)} className={cn('h-3.5 w-[5px] rounded-sm transition-colors', n <= detail ? 'bg-accent' : 'bg-line-strong')} aria-label={`Set detail ${n}`} />
              ))}
            </span>
            <span className="hidden w-[84px] truncate text-[11.5px] font-medium text-fg-muted 2xl:inline" data-testid="detail-label">
              {DETAIL_LABEL[detail]}
            </span>
          </div>
        </Tip>
        <Tip label="More detail" keys="=">
          <button type="button" aria-label="More detail" disabled={detail >= 5} onClick={() => setDetail((detail + 1) as DetailLevel)} className="flex h-full w-6 items-center justify-center rounded-r-md text-fg-muted hover:bg-surface-2 disabled:opacity-30">
            <Plus size={12} />
          </button>
        </Tip>
      </div>
    </div>
  );
}

function LayersControl() {
  const layers = useWorkspace((s) => s.layers);
  const active = useWorkspace((s) => s.activeLayerIds);
  const setLayerActive = useWorkspace((s) => s.setLayerActive);
  const setHelp = useApp((s) => s.setHelp);
  const [adding, setAdding] = useState(false);
  const on = active.length > 0;
  return (
    <>
      <Popover
        align="end"
        className="w-80"
        trigger={(p) => (
          <Tip label="Hypothetical layers: proposed components and changes drawn on top of the real system" keys="H">
            <button
              type="button"
              data-testid="layers-button"
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-[12.5px] font-medium',
                on ? 'border-dashed border-hypo bg-[color-mix(in_srgb,var(--k-hypo)_12%,var(--surface))] text-hypo' : 'border-line bg-surface hover:bg-surface-2',
              )}
              {...p}
            >
              <FlaskConical size={13} />
              <span className="hidden xl:inline">{on ? `What-if: ${active.length} on` : 'What-if'}</span>
              <ChevronDown size={12} className="opacity-60" />
            </button>
          </Tip>
        )}
      >
        {(close) => (
          <div data-testid="layers-menu">
            <MenuLabel>Hypothetical layers</MenuLabel>
            <div className="px-2 pb-1 text-[11.5px] text-fg-muted">Proposed additions and changes, drawn dashed and purple. They never alter the Meridian baseline.</div>
            <div className="flex flex-col gap-0.5 px-2 py-1">
              {layers.map((l) => (
                <div key={l.id} className="flex items-start gap-2 rounded-md px-1 py-1 hover:bg-surface-2">
                  <Switch checked={active.includes(l.id)} onChange={(v) => setLayerActive(l.id, v)} label="" className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-medium">{l.name}</div>
                    <div className="text-[11px] text-fg-subtle">
                      {l.builtIn ? 'Example · ' : ''}
                      {l.entities.length} components · {l.relations.length} connections{l.modifications.length ? ` · ${l.modifications.length} changes` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <MenuDivider />
            <MenuItem
              icon={<Plus size={13} />}
              onClick={() => {
                close();
                setAdding(true);
              }}
            >
              Add a hypothetical component…
            </MenuItem>
            <MenuItem
              icon={<FlaskConical size={13} />}
              onClick={() => {
                close();
                setHelp('layers');
              }}
            >
              Manage layers & compare with baseline…
            </MenuItem>
          </div>
        )}
      </Popover>
      {adding && <HypotheticalComponentDialog open onClose={() => setAdding(false)} />}
    </>
  );
}

function HelpMenu() {
  const setHelp = useApp((s) => s.setHelp);
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const toast = useApp((s) => s.toast);
  return (
    <Popover
      align="end"
      className="w-64"
      trigger={(p) => (
        <IconButton label="Help, guides and workspace" data-testid="help-button" {...p}>
          <CircleHelp size={16} />
        </IconButton>
      )}
    >
      {(close) => {
        const open = (panel: Parameters<typeof setHelp>[0]) => () => {
          close();
          setHelp(panel);
        };
        return (
          <div role="menu">
            <MenuLabel>Learn</MenuLabel>
            <MenuItem icon={<Compass size={13} />} onClick={open('tour')}>
              Quick tour
            </MenuItem>
            <MenuItem icon={<CircleHelp size={13} />} onClick={open('questions')} hint="Eight questions, answered in each mode">
              Guided questions
            </MenuItem>
            <MenuItem icon={<Keyboard size={13} />} keys="?" onClick={open('shortcuts')}>
              Keyboard shortcuts
            </MenuItem>
            <MenuItem icon={<BookOpen size={13} />} keys="G" onClick={open('glossary')}>
              Glossary
            </MenuItem>
            <MenuItem icon={<Info size={13} />} onClick={open('about')} hint="What is modelled and how it is verified">
              About & source coverage
            </MenuItem>
            <MenuDivider />
            <MenuLabel>Workspace</MenuLabel>
            <MenuItem icon={<ClipboardCheck size={13} />} onClick={open('evaluation')} hint="Compare the three modes">
              Evaluation worksheet
            </MenuItem>
            <MenuItem icon={<Download size={13} />} onClick={open('workspace')}>
              Export, import & reset…
            </MenuItem>
            <MenuItem
              icon={<Link2 size={13} />}
              onClick={() => {
                void navigator.clipboard?.writeText(window.location.href);
                toast('Link to this view copied', 'ok');
                close();
              }}
            >
              Copy link to this view
            </MenuItem>
            <MenuItem icon={theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
              {theme === 'dark' ? 'Light theme' : 'Dark theme'}
            </MenuItem>
          </div>
        );
      }}
    </Popover>
  );
}

export function TopBar() {
  const setCommandOpen = useApp((s) => s.setCommandOpen);
  const back = useApp((s) => s.back);
  const forward = useApp((s) => s.forward);
  const canBack = useApp((s) => s.past.length > 0);
  const canForward = useApp((s) => s.future.length > 0);
  const presenting = useApp((s) => s.presenting);
  const setPresenting = useApp((s) => s.setPresenting);
  const inspectorOpen = useApp((s) => s.inspectorOpen);
  const setInspectorOpen = useApp((s) => s.setInspectorOpen);
  const setHelp = useApp((s) => s.setHelp);
  const viewCount = useWorkspace((s) => s.views.length + s.starred.length);

  if (presenting) {
    return (
      <div className="pointer-events-none absolute left-0 right-0 top-2 z-40 flex justify-center">
        <div className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-line bg-surface/95 px-2 py-1 opacity-40 shadow-panel backdrop-blur transition-opacity focus-within:opacity-100 hover:opacity-100" data-testid="presenter-bar">
          <ModeSwitch />
          <AudienceControl />
          <IconButton label="Search" keys="/" onClick={() => setCommandOpen(true)}>
            <Search size={15} />
          </IconButton>
          <Button size="sm" variant="primary" onClick={() => setPresenting(false)} data-testid="exit-presenting">
            Exit presenting
          </Button>
        </div>
      </div>
    );
  }

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-3" data-testid="top-bar">
      <a href="#/atlas" className="mr-1 flex items-center gap-2 rounded-md pr-1 text-fg no-underline" aria-label="Meridian Explorer home">
        <Logo />
        <span className="hidden text-[13.5px] font-semibold tracking-tight md:inline">
          Meridian <span className="font-normal text-fg-muted">Explorer</span>
        </span>
      </a>
      <ModeSwitch />
      <div className="flex items-center">
        <IconButton label="Back to the previous view" keys="[" disabled={!canBack} onClick={back} data-testid="nav-back">
          <ArrowLeft size={15} />
        </IconButton>
        <IconButton label="Forward" keys="]" disabled={!canForward} onClick={forward} data-testid="nav-forward">
          <ArrowRight size={15} />
        </IconButton>
      </div>
      <button
        type="button"
        onClick={() => setCommandOpen(true)}
        data-testid="search-button"
        className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 text-left text-[12.5px] text-fg-subtle transition-colors hover:border-line-strong hover:text-fg-muted md:max-w-[340px]"
      >
        <Search size={14} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">Search components, endpoints, types, scenarios…</span>
        <kbd>/</kbd>
      </button>
      <div className="flex-1" />
      <AudienceControl />
      <LayersControl />
      <Tip label="Saved views, bookmarks and recent items" keys="B">
        <button type="button" onClick={() => setHelp('views')} data-testid="views-button" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2 text-[12.5px] font-medium hover:bg-surface-2">
          <Bookmark size={13} />
          <span className="hidden 2xl:inline">Views</span>
          {viewCount > 0 && <span className="rounded-full bg-surface-3 px-1.5 text-[10px]">{viewCount}</span>}
        </button>
      </Tip>
      <Tip label="Presenter mode: hide the chrome for screensharing" keys="P">
        <button type="button" onClick={() => setPresenting(true)} data-testid="present-button" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2 text-[12.5px] font-medium hover:bg-surface-2">
          <Presentation size={13} />
          <span className="hidden xl:inline">Present</span>
        </button>
      </Tip>
      <HelpMenu />
      <IconButton label={inspectorOpen ? 'Hide inspector' : 'Show inspector'} keys="I" active={inspectorOpen} onClick={() => setInspectorOpen(!inspectorOpen)} data-testid="inspector-toggle">
        <PanelRight size={16} />
      </IconButton>
    </header>
  );
}
