import { baseModel, type GuidedQuestion } from '@/model';
import { useApp, type ModeId } from '@/state/app';
import { useWorkspace } from '@/state/workspace';

/** Jump to a guided question's prepared starting point in the given mode. */
export function runQuestion(q: GuidedQuestion, mode: ModeId): void {
  const app = useApp.getState();
  // The integration question is about a proposal, so switch the example layer on.
  if (q.id === 'q-integration') useWorkspace.getState().setLayerActive('layer:simpay', true);
  if (mode === 'atlas') {
    app.atlasSetExpanded(q.atlas.expand.filter((id) => baseModel.has(id)));
    app.atlasFocus(q.atlas.focus ?? null);
    if (baseModel.has(q.atlas.select)) app.select({ type: 'entity', id: q.atlas.select }, { openInspector: true });
    app.setMode('atlas');
  } else if (mode === 'theater') {
    app.openInTheater(q.theater.scenario, q.theater.variant ?? null, 0);
  } else {
    app.sendToStudio({ title: q.studio.title, source: 'question', entities: q.studio.entities.filter((id) => baseModel.has(id)), note: q.question });
  }
}
