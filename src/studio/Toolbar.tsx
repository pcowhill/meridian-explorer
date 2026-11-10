/** Studio toolbars: the top strip (boards, editing, generate, export) and the floating view bar. */
import { useState } from 'react';
import {
  ChevronDown,
  Copy,
  Download,
  Eye,
  EyeOff,
  FlaskConical,
  FolderTree,
  Frame,
  GitBranch,
  GitCompareArrows,
  Globe,
  HelpCircle,
  Image,
  LayoutGrid,
  Map as MapIcon,
  Maximize,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Pencil,
  Play,
  Plus,
  Redo2,
  Route,
  Share2,
  SkipBack,
  SkipForward,
  Spline,
  Sparkles,
  Square,
  StickyNote,
  Trash2,
  Type,
  Undo2,
  Upload,
  Workflow,
  X,
  ZoomIn,
  ZoomOut,
  Grid3x3,
  Focus,
} from 'lucide-react';
import { useReactFlow } from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import { GUIDED_QUESTIONS } from '@/model/data/questions';
import { useApp } from '@/state/app';
import { useWorkspace } from '@/state/workspace';
import { Button, cn, IconButton, inputClass, MenuDivider, MenuItem, MenuLabel, Popover, Tip } from '@/ui/primitives';
import {
  addFree,
  createBoard,
  deleteBoard,
  duplicateBoard,
  exportBoard,
  exportPng,
  fitAll,
  generate,
  generateBlocker,
  highlightPath,
  importBoard,
  renameBoard,
  startAnimation,
  switchBoard,
  toggleSpotlight,
  type GenerateKind,
} from './commands';
import { usePrefs } from './prefs';
import { useStudio } from './store';
import { useStudioUi } from './ui';

const Sep = () => <span className="mx-1 h-5 w-px shrink-0 bg-line" aria-hidden />;

export function TopToolbar() {
  const { canUndo, canRedo, hasSelection, connectMode } = useStudio(
    useShallow((s) => ({ canUndo: s.past.length > 0, canRedo: s.future.length > 0, hasSelection: s.nodes.some((n) => n.selected) || s.edges.some((e) => e.selected), connectMode: s.connectMode })),
  );
  const paletteOpen = usePrefs((s) => s.paletteOpen);
  const setPrefs = usePrefs((s) => s.set);
  const setUi = useStudioUi((s) => s.set);
  return (
    <div className="presenter-hide flex h-11 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line bg-surface px-2" role="toolbar" aria-label="Studio toolbar" data-testid="studio-toolbar">
      <IconButton label={paletteOpen ? 'Hide palette' : 'Show palette'} onClick={() => setPrefs({ paletteOpen: !paletteOpen })}>
        {paletteOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
      </IconButton>
      <BoardSwitcher />
      <Sep />
      <IconButton label="Undo" keys="mod+Z" disabled={!canUndo} onClick={() => useStudio.getState().undo()}>
        <Undo2 size={16} />
      </IconButton>
      <IconButton label="Redo" keys="mod+shift+Z" disabled={!canRedo} onClick={() => useStudio.getState().redo()}>
        <Redo2 size={16} />
      </IconButton>
      <Sep />
      <IconButton label="Add text" keys="T" onClick={() => addFree('text')}>
        <Type size={16} />
      </IconButton>
      <IconButton label="Add note" keys="M" onClick={() => addFree('note')}>
        <StickyNote size={16} />
      </IconButton>
      <IconButton label="Add rectangle" keys="R" onClick={() => addFree('shape', { shape: 'rounded' })}>
        <Square size={16} />
      </IconButton>
      <IconButton label="Add frame" keys="F" onClick={() => addFree('frame')}>
        <Frame size={16} />
      </IconButton>
      <IconButton label="Connect mode" keys="C" active={connectMode} onClick={() => useStudio.getState().setConnectMode(!connectMode)}>
        <Spline size={16} />
      </IconButton>
      <Sep />
      <IconButton label="Duplicate" keys="mod+D" disabled={!hasSelection} onClick={() => useStudio.getState().duplicateSelection()}>
        <Copy size={16} />
      </IconButton>
      <IconButton label="Delete" keys="Del" disabled={!hasSelection} onClick={() => useStudio.getState().deleteSelection()}>
        <Trash2 size={16} />
      </IconButton>
      <Sep />
      <GenerateMenu />
      <IconButton label="Add hypothetical component" keys="shift+H" onClick={() => setUi({ hypoOpen: true })} className="text-hypo!">
        <FlaskConical size={16} />
      </IconButton>
      <HiddenMenu />
      <span className="flex-1" />
      <NodeCount />
      <Sep />
      <IconButton label="Export board" onClick={exportBoard}>
        <Download size={16} />
      </IconButton>
      <IconButton label="Import board" onClick={() => void importBoard()}>
        <Upload size={16} />
      </IconButton>
      <IconButton label="Export PNG" onClick={() => void exportPng()}>
        <Image size={16} />
      </IconButton>
    </div>
  );
}

function NodeCount() {
  const count = useStudio((s) => s.nodes.length);
  const sel = useStudio((s) => s.nodes.filter((n) => n.selected).length);
  return (
    <span className="shrink-0 whitespace-nowrap px-1.5 text-[11.5px] tabular-nums text-fg-subtle" data-testid="node-count" aria-live="polite">
      {count} item{count === 1 ? '' : 's'}
      {sel > 0 && <span className="text-fg-muted"> · {sel} selected</span>}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

function BoardSwitcher() {
  const boards = useWorkspace((s) => s.boards);
  const boardId = useStudio((s) => s.boardId);
  const active = boards.find((b) => b.id === boardId);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  return (
    <Popover
      trigger={(p) => (
        <button
          type="button"
          {...p}
          data-testid="board-switcher"
          aria-label={`Board: ${active?.name ?? 'none'} — switch, rename, duplicate or delete boards`}
          className="ml-1 inline-flex h-8 max-w-[200px] shrink-0 items-center gap-1.5 rounded-md border border-line bg-surface px-2 text-[12.5px] font-semibold hover:bg-surface-2"
        >
          <LayoutGrid size={13} className="shrink-0 text-accent" />
          <span className="truncate">{active?.name ?? 'Board'}</span>
          <ChevronDown size={12} className="shrink-0 text-fg-subtle" />
        </button>
      )}
      className="w-72"
      onOpenChange={(o) => {
        if (!o) {
          setRenaming(null);
          setConfirmDelete(null);
        }
      }}
    >
      {(close) => (
        <div role="menu" aria-label="Boards">
          <MenuLabel>Boards ({boards.length})</MenuLabel>
          <div className="max-h-72 overflow-y-auto">
            {boards.map((b) => (
              <div key={b.id} className={cn('group flex items-center gap-0.5 rounded-md pr-1', b.id === boardId && 'bg-surface-2')}>
                {renaming === b.id ? (
                  <input
                    autoFocus
                    aria-label="Board name"
                    className={cn(inputClass, 'm-1 h-7')}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') {
                        renameBoard(b.id, draft);
                        setRenaming(null);
                      }
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                    onBlur={() => {
                      renameBoard(b.id, draft);
                      setRenaming(null);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    className="min-w-0 flex-1 px-2 py-1.5 text-left"
                    onClick={() => {
                      if (b.id !== boardId) switchBoard(b.id);
                      close();
                    }}
                  >
                    <span className={cn('block truncate text-[12.5px]', b.id === boardId && 'font-semibold')}>{b.name}</span>
                    <span className="block text-[10.5px] text-fg-subtle">
                      {b.nodes.length} items · {new Date(b.updatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </button>
                )}
                {renaming !== b.id &&
                  (confirmDelete === b.id ? (
                    <span className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => {
                          deleteBoard(b.id);
                          setConfirmDelete(null);
                        }}
                      >
                        Delete
                      </Button>
                      <IconButton label="Keep the board" size="sm" onClick={() => setConfirmDelete(null)}>
                        <X size={12} />
                      </IconButton>
                    </span>
                  ) : (
                    <span className="flex opacity-60 group-hover:opacity-100">
                      <IconButton
                        label={`Rename ${b.name}`}
                        size="sm"
                        onClick={() => {
                          setDraft(b.name);
                          setRenaming(b.id);
                        }}
                      >
                        <Pencil size={12} />
                      </IconButton>
                      <IconButton label={`Duplicate ${b.name}`} size="sm" onClick={() => duplicateBoard(b.id)}>
                        <Copy size={12} />
                      </IconButton>
                      <IconButton label={`Delete ${b.name}`} size="sm" onClick={() => setConfirmDelete(b.id)}>
                        <Trash2 size={12} />
                      </IconButton>
                    </span>
                  ))}
              </div>
            ))}
          </div>
          <MenuDivider />
          <MenuItem
            icon={<Plus size={13} />}
            onClick={() => {
              createBoard();
              close();
            }}
          >
            New board
          </MenuItem>
          <MenuItem
            icon={<Download size={13} />}
            onClick={() => {
              exportBoard();
              close();
            }}
          >
            Export this board (JSON)
          </MenuItem>
          <MenuItem
            icon={<Upload size={13} />}
            onClick={() => {
              close();
              void importBoard();
            }}
          >
            Import a board…
          </MenuItem>
        </div>
      )}
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

const GEN: { kind: GenerateKind; label: string; hint: string; icon: React.ReactNode; keys?: string }[] = [
  { kind: 'dependency', label: 'Dependency diagram', hint: 'Dependents ← it → dependencies', icon: <GitBranch size={13} /> },
  { kind: 'connections', label: 'All connections between two', hint: 'Direct relations, or the shortest chain', icon: <Route size={13} /> },
  { kind: 'children', label: 'Add children', hint: 'What it contains', icon: <FolderTree size={13} /> },
  { kind: 'neighbours', label: 'Add neighbours', hint: 'What it talks to and what talks to it', icon: <Share2 size={13} /> },
  { kind: 'sequence', label: 'Sequence diagram from selection', hint: 'A chain, an endpoint or a relationship to one', icon: <Workflow size={13} /> },
  { kind: 'animate', label: 'Animate path', hint: 'A token travels the selected chain', icon: <Play size={13} />, keys: 'shift+P' },
  { kind: 'before-after', label: 'Before / after comparison', hint: 'Existing frame + editable proposed copy', icon: <GitCompareArrows size={13} /> },
];

function GenerateMenu() {
  const open = useStudioUi((s) => s.generateOpen);
  const setUi = useStudioUi((s) => s.set);
  const [questions, setQuestions] = useState(false);
  // Re-render on selection change so blockers are current.
  useStudio((s) => s.nodes.filter((n) => n.selected).length + s.edges.filter((e) => e.selected).length * 1000);
  const [depth2, setDepth2] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setUi({ generateOpen: o });
        if (!o) setQuestions(false);
      }}
      trigger={(p) => (
        <Tip label="Generate a diagram from the model">
          <button type="button" {...p} aria-label="Generate" className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-[12.5px] font-semibold text-accent hover:bg-surface-2">
            <Sparkles size={15} />
            Generate
            <ChevronDown size={12} />
          </button>
        </Tip>
      )}
      className="w-80"
    >
      {(close) => (
        <div role="menu" aria-label="Generate">
          <MenuLabel>From the selection</MenuLabel>
          {GEN.map((g) => {
            const blocker = generateBlocker(g.kind);
            return (
              <div key={g.kind} className="flex items-center" data-generate={g.kind}>
                <div className="min-w-0 flex-1">
                  <MenuItem
                    icon={g.icon}
                    keys={g.keys}
                    disabled={!!blocker}
                    hint={blocker ?? g.hint}
                    onClick={() => {
                      close();
                      generate(g.kind, g.kind === 'dependency' && depth2 ? 2 : undefined);
                    }}
                  >
                    {g.label}
                  </MenuItem>
                </div>
                {g.kind === 'dependency' && (
                  <button
                    type="button"
                    aria-pressed={depth2}
                    onClick={() => setDepth2(!depth2)}
                    className={cn('mr-1 h-6 shrink-0 rounded border px-1.5 text-[10.5px] font-semibold', depth2 ? 'border-accent text-accent' : 'border-line text-fg-subtle hover:text-fg')}
                    title="Include a second level of dependents and dependencies"
                  >
                    depth {depth2 ? 2 : 1}
                  </button>
                )}
              </div>
            );
          })}
          <MenuDivider />
          <MenuLabel>Whole explanations</MenuLabel>
          <div data-generate="overview">
            <MenuItem
              icon={<Globe size={13} />}
              hint="Apps, database, external parties and people"
              onClick={() => {
                close();
                generate('overview');
              }}
            >
              System overview
            </MenuItem>
          </div>
          <div data-generate="question">
            <MenuItem icon={<HelpCircle size={13} />} hint="One of the representative questions" onClick={() => setQuestions(!questions)} active={questions}>
              From a question…
            </MenuItem>
          </div>
          {questions && (
            <div className="ml-6 border-l border-line pl-1">
              {GUIDED_QUESTIONS.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  data-question={q.id}
                  onClick={() => {
                    close();
                    generate('question', q.id);
                  }}
                  className="block w-full rounded-md px-2 py-1 text-left text-[12px] hover:bg-surface-2"
                >
                  {q.question}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Hidden items
// ---------------------------------------------------------------------------

function HiddenMenu() {
  const hidden = useStudio(useShallow((s) => s.nodes.filter((n) => n.hidden).map((n) => n.id)));
  const hiddenEdges = useStudio(useShallow((s) => s.edges.filter((e) => e.hidden).map((e) => e.id)));
  const nodes = useStudio((s) => s.nodes);
  if (!hidden.length && !hiddenEdges.length) return null;
  const labelOf = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    const d = n?.data as Record<string, unknown> | undefined;
    return (d?.label as string) || (d?.entityId as string) || (d?.contractId as string) || (d?.machineId as string) || n?.type || id;
  };
  return (
    <Popover
      trigger={(p) => (
        <Tip label="Hidden items — show them again" keys="X hides">
          <button type="button" {...p} aria-label={`${hidden.length + hiddenEdges.length} hidden items`} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-line px-2 text-[11.5px] text-fg-muted hover:bg-surface-2">
            <EyeOff size={12} /> {hidden.length + hiddenEdges.length} hidden
          </button>
        </Tip>
      )}
      className="w-72"
    >
      {(close) => (
        <div role="menu" aria-label="Hidden items">
          <MenuLabel>Hidden from the board</MenuLabel>
          <div className="max-h-64 overflow-y-auto">
            {hidden.map((id) => (
              <MenuItem key={id} icon={<Eye size={13} />} onClick={() => useStudio.getState().showElements([id])}>
                {labelOf(id)}
              </MenuItem>
            ))}
            {hiddenEdges.map((id) => (
              <MenuItem key={id} icon={<Eye size={13} />} onClick={() => useStudio.getState().showElements([], [id])}>
                Connection {useStudio.getState().edges.find((e) => e.id === id)?.data?.label ?? ''}
              </MenuItem>
            ))}
          </div>
          <MenuDivider />
          <MenuItem
            icon={<Eye size={13} />}
            onClick={() => {
              useStudio.getState().showElements(hidden, hiddenEdges);
              close();
            }}
          >
            Show all
          </MenuItem>
        </div>
      )}
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// View bar (stays visible while presenting)
// ---------------------------------------------------------------------------

export function ViewBar() {
  const flow = useReactFlow();
  const focus = useStudio((s) => s.focus);
  const { canUndo, canRedo } = useStudio(useShallow((s) => ({ canUndo: s.past.length > 0, canRedo: s.future.length > 0 })));
  const snap = usePrefs((s) => s.snap);
  const minimap = usePrefs((s) => s.minimap);
  const setPrefs = usePrefs((s) => s.set);
  const presenting = useApp((s) => s.presenting);
  return (
    <div className="studio-overlay pointer-events-auto flex items-center gap-0.5 rounded-lg border border-line bg-surface p-1 shadow-pop" role="toolbar" aria-label="View">
      {presenting && (
        <>
          <IconButton label="Undo" keys="mod+Z" size="sm" disabled={!canUndo} onClick={() => useStudio.getState().undo()} tipSide="top">
            <Undo2 size={14} />
          </IconButton>
          <IconButton label="Redo" keys="mod+shift+Z" size="sm" disabled={!canRedo} onClick={() => useStudio.getState().redo()} tipSide="top">
            <Redo2 size={14} />
          </IconButton>
          <Sep />
        </>
      )}
      <IconButton label="Zoom out" size="sm" onClick={() => void flow.zoomOut({ duration: 160 })} tipSide="top">
        <ZoomOut size={14} />
      </IconButton>
      <IconButton label="Zoom in" size="sm" onClick={() => void flow.zoomIn({ duration: 160 })} tipSide="top">
        <ZoomIn size={14} />
      </IconButton>
      <IconButton label="Zoom to fit" keys="0" size="sm" onClick={fitAll} tipSide="top">
        <Maximize size={14} />
      </IconButton>
      <Sep />
      <IconButton label="Auto-layout" keys="L" size="sm" onClick={() => useStudio.getState().layout(useStudio.getState().nodes.filter((n) => n.selected).map((n) => n.id))} tipSide="top">
        <LayoutGrid size={14} />
      </IconButton>
      <IconButton label="Spotlight" keys="S" size="sm" active={focus?.mode === 'spotlight'} onClick={toggleSpotlight} tipSide="top">
        <Focus size={14} />
      </IconButton>
      <IconButton label="Highlight path" size="sm" active={focus?.mode === 'path'} onClick={highlightPath} tipSide="top">
        <Route size={14} />
      </IconButton>
      <IconButton label="Animate path" keys="shift+P" size="sm" onClick={startAnimation} tipSide="top">
        <Play size={14} />
      </IconButton>
      <FrameReveal />
      {!presenting && (
        <>
          <Sep />
          <IconButton label={snap ? 'Snap to grid: on' : 'Snap to grid: off'} size="sm" active={snap} onClick={() => setPrefs({ snap: !snap })} tipSide="top">
            <Grid3x3 size={14} />
          </IconButton>
          <IconButton label={minimap ? 'Hide minimap' : 'Show minimap'} size="sm" active={minimap} onClick={() => setPrefs({ minimap: !minimap })} tipSide="top">
            <MapIcon size={14} />
          </IconButton>
        </>
      )}
    </div>
  );
}

/** Step the view through the board's frames (left→right, top→bottom). */
function FrameReveal() {
  const frames = useStudio(useShallow((s) => s.nodes.filter((n) => n.type === 'frame' && !n.hidden).sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x).map((n) => n.id)));
  const [i, setI] = useState(-1);
  const flow = useReactFlow();
  if (frames.length < 2) return null;
  const go = (next: number) => {
    const k = (next + frames.length) % frames.length;
    setI(k);
    void flow.fitView({ nodes: [{ id: frames[k] }], padding: 0.12, duration: 360 });
  };
  return (
    <>
      <Sep />
      <IconButton label="Previous frame" size="sm" onClick={() => go(i - 1)} tipSide="top">
        <SkipBack size={14} />
      </IconButton>
      <span className="px-0.5 font-mono text-[10.5px] text-fg-subtle">{i < 0 ? '–' : i + 1}/{frames.length}</span>
      <IconButton label="Next frame" size="sm" onClick={() => go(i + 1)} tipSide="top">
        <SkipForward size={14} />
      </IconButton>
    </>
  );
}

/** Controls for the running path animation. */
export function AnimationBar() {
  const anim = useStudio((s) => s.anim);
  const nodes = useStudio((s) => s.nodes);
  if (!anim) return null;
  const name = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    const d = n?.data as Record<string, unknown> | undefined;
    return (d?.label as string) || (d?.entityId as string)?.split(/[#/:]/).pop() || n?.type || id;
  };
  const total = anim.nodes.length - 1;
  const set = useStudio.getState().setAnim;
  return (
    <div className="studio-overlay pointer-events-auto flex items-center gap-1 rounded-lg border border-line bg-surface px-1.5 py-1 shadow-pop" role="toolbar" aria-label="Path animation" data-testid="anim-bar">
      <IconButton label="Step back" size="sm" disabled={anim.index === 0} onClick={() => useStudio.getState().stepAnim(-1)} tipSide="top">
        <SkipBack size={14} />
      </IconButton>
      <IconButton
        label={anim.playing ? 'Pause' : 'Play'}
        size="sm"
        onClick={() => set({ ...anim, playing: !anim.playing, index: !anim.playing && anim.index >= total ? 0 : anim.index })}
        tipSide="top"
      >
        {anim.playing ? <Pause size={14} /> : <Play size={14} />}
      </IconButton>
      <IconButton label="Step forward" size="sm" disabled={anim.index >= total} onClick={() => useStudio.getState().stepAnim(1)} tipSide="top">
        <SkipForward size={14} />
      </IconButton>
      <span className="min-w-0 max-w-[340px] truncate px-1 text-[12px]" data-testid="anim-step">
        <b className="tabular-nums">
          Step {anim.index}/{total}
        </b>
        {anim.index > 0 && (
          <span className="text-fg-muted">
            {' '}
            · {name(anim.nodes[anim.index - 1])} → {name(anim.nodes[anim.index])}
          </span>
        )}
      </span>
      <IconButton label="Stop animation" size="sm" onClick={() => set(null)} tipSide="top">
        <X size={14} />
      </IconButton>
    </div>
  );
}
