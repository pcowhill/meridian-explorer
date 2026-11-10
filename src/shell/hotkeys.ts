/**
 * Keyboard shortcut registry. Components declare shortcuts with `useHotkeys`;
 * one window listener dispatches them, and the shortcut reference dialog lists
 * whatever is currently registered — so the documentation cannot drift from
 * the behaviour. Every shortcut also has a visible button somewhere.
 */
import { useEffect, useSyncExternalStore } from 'react';

export type HotkeyGroup = 'Everywhere' | 'Presenting' | 'Architecture Atlas' | 'Scenario Theater' | 'Explanation Studio';

export interface Hotkey {
  /** Unique id. */
  id: string;
  /**
   * Key combo: modifiers joined by `+` then the key, e.g. `mod+k`, `shift+/`,
   * `ArrowRight`, `e`. `mod` = ⌘ on macOS, Ctrl elsewhere. Several alternatives
   * may be given separated by a space: `/ mod+k`.
   */
  keys: string;
  label: string;
  group: HotkeyGroup;
  run: (e: KeyboardEvent) => void;
  /** Fire even when focus is in a text field (only for modifier combos). */
  allowInInput?: boolean;
  /** Listed in the reference but handled elsewhere (e.g. by a canvas library). */
  docOnly?: boolean;
}

const registry = new Map<string, Hotkey>();
const listeners = new Set<() => void>();
let snapshot: Hotkey[] = [];
const emit = () => {
  snapshot = [...registry.values()];
  listeners.forEach((l) => l());
};

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

function matches(combo: string, e: KeyboardEvent): boolean {
  const parts = combo.split('+');
  const key = parts[parts.length - 1];
  const mods = new Set(parts.slice(0, -1));
  const wantMod = mods.has('mod');
  const wantShift = mods.has('shift');
  const wantAlt = mods.has('alt');
  const hasMod = isMac ? e.metaKey : e.ctrlKey;
  if (wantMod !== hasMod) return false;
  if (!wantMod && (e.metaKey || e.ctrlKey)) return false;
  if (wantAlt !== e.altKey) return false;
  const eventKey = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const target = key.length === 1 ? key.toLowerCase() : key;
  // Symbols that need Shift on most layouts (`?`, `+`, `<`, `>`): match the produced character and ignore Shift.
  const symbol = key.length === 1 && !/[a-z0-9]/i.test(key);
  if (symbol) return eventKey === target;
  if (wantShift !== e.shiftKey) return false;
  if (target === 'space') return e.key === ' ' || e.code === 'Space';
  return eventKey === target;
}

function inTextField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

let attached = false;
function attach() {
  if (attached || typeof window === 'undefined') return;
  attached = true;
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.isComposing) return;
    const typing = inTextField(e.target);
    // Later registrations win, so a mode's shortcut can shadow a global one.
    const all = [...registry.values()].reverse();
    for (const h of all) {
      if (h.docOnly) continue;
      if (typing && !h.allowInInput) continue;
      if (h.keys.split(' ').some((combo) => matches(combo, e))) {
        e.preventDefault();
        h.run(e);
        return;
      }
    }
  });
}

/** Register shortcuts for as long as the component is mounted (and `enabled`). */
export function useHotkeys(hotkeys: Hotkey[], enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    attach();
    for (const h of hotkeys) registry.set(h.id, h);
    emit();
    return () => {
      for (const h of hotkeys) if (registry.get(h.id) === h) registry.delete(h.id);
      emit();
    };
    // Callers pass a fresh array each render; re-register so handlers never go stale.
  });
}

/** Currently registered shortcuts, for the reference dialog. */
export function useRegisteredHotkeys(): Hotkey[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot,
    () => snapshot,
  );
}

/** Human-readable rendering of a combo, e.g. `mod+k` → `⌘K` / `Ctrl+K`. */
export function formatKeys(keys: string): string[] {
  return keys.split(' ').map((combo) =>
    combo
      .split('+')
      .map((p) => {
        if (p === 'mod') return isMac ? '⌘' : 'Ctrl';
        if (p === 'shift') return isMac ? '⇧' : 'Shift';
        if (p === 'alt') return isMac ? '⌥' : 'Alt';
        if (p === 'ArrowRight') return '→';
        if (p === 'ArrowLeft') return '←';
        if (p === 'ArrowUp') return '↑';
        if (p === 'ArrowDown') return '↓';
        if (p === 'space') return 'Space';
        if (p === 'Escape') return 'Esc';
        if (p === 'Delete') return 'Del';
        return p.length === 1 ? p.toUpperCase() : p;
      })
      .join(isMac ? '' : '+'),
  );
}
