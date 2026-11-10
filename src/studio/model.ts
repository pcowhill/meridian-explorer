/** The model as it is right now (with active hypothetical layers), for use outside React render. */
import { getModel, type Model } from '@/model';
import { selectActiveLayers, useWorkspace } from '@/state/workspace';

export function currentModel(): Model {
  return getModel(selectActiveLayers(useWorkspace.getState()));
}
