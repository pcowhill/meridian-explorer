/** Explanation Studio keyboard shortcuts (registered with the shared hotkey registry). */
import { useEffect } from 'react';
import { useHotkeys, type Hotkey } from '@/shell/hotkeys';
import { addFree, addWidget, fitAll, startAnimation, toggleSpotlight } from './commands';
import { entityOf } from './logic/modelEdges';
import { quickWidgets } from './logic/widgets';
import { currentModel } from './model';
import { focusPaletteSearch, openWidget } from './Palette';
import { usePrefs } from './prefs';
import { selectedNodeIds, useStudio } from './store';
import { useStudioUi } from './ui';

const G = 'Explanation Studio' as const;
const st = () => useStudio.getState();

/** Bound widget for the single selected entity, if it has one of the wanted kind. */
function attachOrPick(kind: 'code' | 'json'): void {
  const s = st();
  const ids = selectedNodeIds(s);
  const node = ids.length === 1 ? s.nodes.find((n) => n.id === ids[0]) : undefined;
  const ent = entityOf(node);
  if (node && ent) {
    const options = quickWidgets(currentModel(), ent);
    const match = options.find((o) => (kind === 'code' ? o.label === 'Code' : /JSON/.test(o.label)));
    if (match) {
      addWidget(match.make(), node.id);
      return;
    }
  }
  openWidget(kind, node && ent ? node.id : undefined);
}

function nudge(dx: number, dy: number) {
  const step = usePrefs.getState().snap ? 16 : 4;
  st().nudge(dx * step, dy * step);
}

export function useStudioHotkeys(): void {
  const keys: Hotkey[] = [
    { id: 'st.search', keys: 'n', label: 'Add a Meridian component (search)', group: G, run: focusPaletteSearch },
    { id: 'st.connect', keys: 'c', label: 'Connect mode (click source, then target)', group: G, run: () => st().setConnectMode(!st().connectMode) },
    { id: 'st.text', keys: 't', label: 'Add text', group: G, run: () => addFree('text') },
    { id: 'st.note', keys: 'm', label: 'Add a sticky note', group: G, run: () => addFree('note') },
    { id: 'st.rect', keys: 'r', label: 'Add a rectangle', group: G, run: () => addFree('shape', { shape: 'rounded' }) },
    { id: 'st.frame', keys: 'f', label: 'Frame around the selection (or a new frame)', group: G, run: () => addFree('frame') },
    { id: 'st.code', keys: 'k', label: 'Code widget (source of the selected component)', group: G, run: () => attachOrPick('code') },
    { id: 'st.json', keys: 'j', label: 'JSON widget (example of the selected component)', group: G, run: () => attachOrPick('json') },
    { id: 'st.hide', keys: 'x', label: 'Hide the selection', group: G, run: () => st().hideSelection() },
    { id: 'st.delete', keys: 'Delete Backspace', label: 'Delete the selection', group: G, run: () => st().deleteSelection() },
    { id: 'st.undo', keys: 'mod+z', label: 'Undo', group: G, run: () => st().undo() },
    { id: 'st.redo', keys: 'mod+shift+z mod+y', label: 'Redo', group: G, run: () => st().redo() },
    { id: 'st.dup', keys: 'mod+d', label: 'Duplicate', group: G, run: () => st().duplicateSelection() },
    { id: 'st.copy', keys: 'mod+c', label: 'Copy (works across boards)', group: G, docOnly: true, run: () => undefined },
    { id: 'st.paste', keys: 'mod+v', label: 'Paste', group: G, docOnly: true, run: () => undefined },
    { id: 'st.all', keys: 'mod+a', label: 'Select everything', group: G, run: () => st().setSelection(st().nodes.filter((n) => !n.hidden).map((n) => n.id)) },
    { id: 'st.group', keys: 'mod+g', label: 'Group the selection into a frame', group: G, run: () => st().groupSelection() },
    { id: 'st.spot', keys: 's', label: 'Spotlight the selection (toggle)', group: G, run: toggleSpotlight },
    { id: 'st.fit', keys: '0', label: 'Zoom to fit', group: G, run: fitAll },
    { id: 'st.layout', keys: 'l', label: 'Auto-layout the selection (or the board)', group: G, run: () => st().layout(selectedNodeIds(st())) },
    { id: 'st.hypo', keys: 'shift+h', label: 'Add a hypothetical component', group: G, run: () => useStudioUi.getState().set({ hypoOpen: true }) },
    { id: 'st.anim', keys: 'shift+p', label: 'Animate the selected path', group: G, run: startAnimation },
    { id: 'st.edit', keys: 'Enter', label: 'Edit the label of the selected element', group: G, docOnly: true, run: () => undefined },
    { id: 'st.nudge', keys: 'ArrowLeft ArrowRight ArrowUp ArrowDown', label: 'Nudge the selection (Shift: further)', group: G, docOnly: true, run: () => undefined },
  ];
  useHotkeys(keys);

  // Enter and the arrow keys are handled here (not by the registry) so they never
  // steal Enter/arrows from a focused button, tab, radio or menu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('input, textarea, select, [contenteditable=true], button, a, [role=radio], [role=tab], [role=option], [role=menuitem], [role=slider], [role=dialog]')) return;
      const s = st();
      const ids = selectedNodeIds(s);
      if (e.key === 'Enter') {
        if (ids.length === 1) s.setEditing(ids[0]);
        else {
          const sel = s.edges.filter((x) => x.selected);
          if (sel.length === 1) s.setEditingEdge(sel[0].id);
          else return;
        }
        e.preventDefault();
        return;
      }
      const dir: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const d = dir[e.key];
      if (!d || !ids.length) return;
      e.preventDefault();
      const k = e.shiftKey ? 4 : 1;
      nudge(d[0] * k, d[1] * k);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
