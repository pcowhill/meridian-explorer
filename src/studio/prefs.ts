/** Per-viewer Studio conveniences (panel open, toggles). Browser storage only; safe when unavailable. */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type PaletteTab = 'meridian' | 'shapes' | 'widgets' | 'templates';

interface Prefs {
  paletteOpen: boolean;
  paletteTab: PaletteTab;
  autoConnect: boolean;
  snap: boolean;
  minimap: boolean;
  /** Selection panel shows style / arrange sections. */
  panelExpanded: boolean;
  set: (patch: Partial<Omit<Prefs, 'set'>>) => void;
}

const safeStorage = createJSONStorage(() => {
  try {
    return window.localStorage;
  } catch {
    return { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
  }
});

export const usePrefs = create<Prefs>()(
  persist(
    (set) => ({
      paletteOpen: true,
      paletteTab: 'meridian',
      autoConnect: true,
      snap: true,
      minimap: false,
      panelExpanded: false,
      set: (patch) => set(patch),
    }),
    { name: 'meridian-explorer:studio-prefs:v1', storage: safeStorage, partialize: ({ set: _set, ...rest }) => rest },
  ),
);
