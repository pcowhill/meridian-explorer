/** Transient Studio UI flags shared between the toolbar, palette, hotkeys and dialogs. */
import { create } from 'zustand';
import type { WidgetKind } from './logic/widgets';

interface StudioUi {
  hypoOpen: boolean;
  /** Widget binding picker; `attachTo` = entity node the widget is attached to. */
  picker: { kind: WidgetKind; attachTo?: string } | null;
  templateDialog: null | 'selection' | 'board';
  generateOpen: boolean;
  dismissedCarry: string | null;
  set: (patch: Partial<Omit<StudioUi, 'set'>>) => void;
}

export const useStudioUi = create<StudioUi>()((set) => ({
  hypoOpen: false,
  picker: null,
  templateDialog: null,
  generateOpen: false,
  dismissedCarry: null,
  set: (patch) => set(patch),
}));
