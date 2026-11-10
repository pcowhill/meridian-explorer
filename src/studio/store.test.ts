import { beforeEach, describe, expect, it } from 'vitest';
import { entityNode, makeNode } from './logic/build';
import { lineDiff, parseJson, parseMembers } from './nodes/widgets';
import { parseLines } from './nodes/common';
import { newBoard, selectedNodeIds, useStudio } from './store';

const st = () => useStudio.getState();
const EP = 'ep:POST /api/transfers';
const FN = 'be:money/movements#createTransfer';

beforeEach(() => {
  st().load(newBoard('Test'));
});

describe('studio store history', () => {
  it('undo and redo restore exact snapshots', () => {
    const a = makeNode('note', { x: 0, y: 0 }, { label: 'a' });
    st().addNodes([a]);
    st().updateNodeData(a.id, { label: 'b' });
    st().setNodeStyle([a.id], { fill: 'blue' });
    expect(st().past).toHaveLength(3);
    const after = st().nodes;
    st().undo();
    expect(st().nodes[0].data.style).toBeUndefined();
    st().undo();
    expect(st().nodes[0].data.label).toBe('a');
    st().undo();
    expect(st().nodes).toHaveLength(0);
    st().redo();
    st().redo();
    st().redo();
    expect(st().nodes).toEqual(after);
    expect(st().future).toHaveLength(0);
  });

  it('coalesces repeated edits with the same key', () => {
    const a = makeNode('note', { x: 0, y: 0 }, { label: '' });
    st().addNodes([a]);
    st().updateNodeData(a.id, { label: 'h' }, 'typing');
    st().updateNodeData(a.id, { label: 'he' }, 'typing');
    st().updateNodeData(a.id, { label: 'hey' }, 'typing');
    expect(st().past).toHaveLength(2);
    st().undo();
    expect(st().nodes[0].data.label).toBe('');
  });

  it('a gesture checkpoint makes a whole drag one undo step', () => {
    const a = makeNode('note', { x: 0, y: 0 }, {});
    st().addNodes([a]);
    st().checkpoint();
    for (let i = 1; i <= 5; i++) st().onNodesChange([{ type: 'position', id: a.id, position: { x: i * 10, y: 0 }, dragging: true }]);
    expect(st().nodes[0].position.x).toBe(50);
    st().undo();
    expect(st().nodes[0].position.x).toBe(0);
  });

  it('selection changes do not create history', () => {
    const a = makeNode('note', { x: 0, y: 0 }, {});
    st().addNodes([a]);
    const n = st().past.length;
    st().onNodesChange([{ type: 'select', id: a.id, selected: false }]);
    st().setSelection([a.id]);
    expect(st().past).toHaveLength(n);
  });
});

describe('studio store editing', () => {
  it('delete respects locks and removes connected edges', () => {
    const a = makeNode('note', { x: 0, y: 0 }, {});
    const b = makeNode('note', { x: 300, y: 0 }, {});
    st().addNodes([a, b]);
    st().connect(a.id, b.id);
    st().setSelection([a.id]);
    st().toggleLock();
    st().setSelection([a.id, b.id]);
    st().deleteSelection();
    expect(st().nodes.map((n) => n.id)).toEqual([a.id]);
    expect(st().edges).toHaveLength(0);
  });

  it('connect between entities records known relations, otherwise an unverified sketch', () => {
    const a = entityNode(EP, { x: 0, y: 0 });
    const b = entityNode(FN, { x: 300, y: 0 });
    const c = entityNode('db:Card', { x: 600, y: 0 });
    st().addNodes([a, b, c]);
    const known = st().connect(b.id, a.id)!;
    expect(known.source).toBe(a.id); // direction follows the model
    expect(known.data?.relationIds?.length).toBeGreaterThan(0);
    const sketch = st().connect(a.id, c.id)!;
    expect(sketch.data?.relationIds).toBeUndefined();
    expect(sketch.data?.strokeStyle).toBe('dashed');
  });

  it('duplicates, hides/shows, groups and nudges', () => {
    const a = makeNode('note', { x: 0, y: 0 }, {});
    st().addNodes([a]);
    st().duplicateSelection();
    expect(st().nodes).toHaveLength(2);
    expect(selectedNodeIds(st())).toHaveLength(1);
    const copy = selectedNodeIds(st())[0];
    expect(st().nodes.find((n) => n.id === copy)!.position).toEqual({ x: 32, y: 32 });
    st().hideSelection();
    expect(st().nodes.find((n) => n.id === copy)!.hidden).toBe(true);
    st().showElements([copy]);
    expect(st().nodes.find((n) => n.id === copy)!.hidden).toBe(false);
    st().setSelection([a.id]);
    st().nudge(16, 0);
    st().nudge(16, 0);
    expect(st().nodes.find((n) => n.id === a.id)!.position.x).toBe(32);
    const frameId = st().groupSelection('G')!;
    expect(st().nodes.find((n) => n.id === a.id)!.parentId).toBe(frameId);
    expect(st().nodes[0].id).toBe(frameId);
  });

  it('pastes a clipboard snapshot with fresh ids', () => {
    const a = makeNode('note', { x: 0, y: 0 }, { label: 'x' });
    st().pasteElements({ nodes: [a], edges: [] }, { x: 500, y: 500 });
    expect(st().nodes).toHaveLength(1);
    expect(st().nodes[0].id).not.toBe(a.id);
    expect(st().nodes[0].position).toEqual({ x: 500, y: 500 });
  });

  it('dropping a node on a frame puts it inside', () => {
    const f = makeNode('frame', { x: 0, y: 0 }, { label: 'F' }, { w: 400, h: 300 });
    const a = makeNode('note', { x: 100, y: 100 }, {});
    st().addNodes([f, a]);
    st().endDrag([a.id]);
    expect(st().nodes.find((n) => n.id === a.id)!.parentId).toBe(f.id);
  });

  it('z-order keeps frames beneath content', () => {
    const f = makeNode('frame', { x: 0, y: 0 }, {});
    const a = makeNode('note', { x: 0, y: 0 }, {});
    const b = makeNode('note', { x: 0, y: 0 }, {});
    st().addNodes([f, a, b]);
    st().setSelection([a.id]);
    st().zOrder('front');
    const z = (id: string) => st().nodes.find((n) => n.id === id)!.zIndex!;
    expect(z(a.id)).toBeGreaterThan(z(b.id));
    st().zOrder('back');
    expect(z(a.id)).toBeLessThan(z(b.id));
    expect(z(a.id)).toBeGreaterThan(z(f.id));
  });
});

describe('widget helpers', () => {
  it('parses members, line specs, JSON and line diffs', () => {
    expect(parseMembers('id: string\namount?: number\nvalidate(x): Result')).toEqual([
      { name: 'id', type: 'string', method: false, optional: false },
      { name: 'amount', type: 'number', method: false, optional: true },
      { name: 'validate(x)', type: 'Result', method: true, optional: false },
    ]);
    expect(parseLines('3-5, 9')).toEqual([3, 4, 5, 9]);
    expect(parseJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseJson('{bad').ok).toBe(false);
    expect(lineDiff('a\nb', 'a\nc')).toEqual({ left: ['same', 'removed'], right: ['same', 'added'] });
  });
});
