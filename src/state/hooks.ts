import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { getModel, getSearchIndex, type Model, type Scenario, type SearchIndex } from '@/model';
import { selectActiveLayers, useWorkspace } from './workspace';

/** The Meridian model with the active hypothetical layers applied. */
export function useModel(): Model {
  const layers = useWorkspace(useShallow(selectActiveLayers));
  return useMemo(() => getModel(layers), [layers]);
}

export function useSearchIndex(): SearchIndex {
  const model = useModel();
  return useMemo(() => getSearchIndex(model), [model]);
}

/** Baseline + hypothetical scenarios from the model, plus the user's custom ones. */
export function useScenarios(): Scenario[] {
  const model = useModel();
  const custom = useWorkspace((s) => s.customScenarios);
  return useMemo(() => [...model.scenarios, ...custom], [model, custom]);
}

export function useScenario(id: string | null | undefined): Scenario | undefined {
  const all = useScenarios();
  return useMemo(() => (id ? all.find((s) => s.id === id) : undefined), [all, id]);
}

/** True when at least one hypothetical layer is switched on. */
export function useHasHypothetical(): boolean {
  return useWorkspace((s) => s.activeLayerIds.length > 0);
}
