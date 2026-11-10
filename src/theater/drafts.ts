/**
 * Unsaved edits to custom scenarios, kept outside React component state so
 * they survive stepping, view switches and leaving/re-entering the Theater
 * during a session. Mirrored to sessionStorage so an accidental reload does
 * not lose them either. Saving moves a draft into the workspace.
 */
import { create } from 'zustand';
import type { Scenario } from '@/model';

const KEY = 'meridian-explorer:theater-drafts:v1';

function load(): Record<string, Scenario> {
  try {
    const raw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(KEY) : null;
    return raw ? (JSON.parse(raw) as Record<string, Scenario>) : {};
  } catch {
    return {};
  }
}

function persist(drafts: Record<string, Scenario>): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(drafts));
  } catch {
    /* storage full or unavailable — drafts stay in memory */
  }
}

interface DraftState {
  drafts: Record<string, Scenario>;
  setDraft: (scenario: Scenario) => void;
  clearDraft: (id: string) => void;
}

export const useDrafts = create<DraftState>()((set) => ({
  drafts: load(),
  setDraft: (scenario) =>
    set((s) => {
      const drafts = { ...s.drafts, [scenario.id]: scenario };
      persist(drafts);
      return { drafts };
    }),
  clearDraft: (id) =>
    set((s) => {
      if (!s.drafts[id]) return s;
      const drafts = { ...s.drafts };
      delete drafts[id];
      persist(drafts);
      return { drafts };
    }),
}));
