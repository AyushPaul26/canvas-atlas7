import { describe, expect, it, vi } from 'vitest';
import { createSpatialObject, disposeSpatialObject, updateSpatialObject } from '../../apps/desktop/src/renderer/visuals/visual-adapters';
import type { SpatialScene } from '../../packages/protocol/src/index';

describe('trusted spatial primitives', () => {
  it.each(['box','sphere','cylinder','cone','plane','line','arrow'] as const)('builds and disposes the bounded %s primitive with no remote assets', kind => {
    const node: SpatialScene['nodes'][number] = { id: 'node', kind, position: [1,2,3], scale: [2,3,4], material: 'blue' };
    const object = createSpatialObject(node);
    expect(object.position.toArray()).toEqual([1,2,3]); expect(object.scale.toArray()).toEqual([2,3,4]);
    const dispose = vi.fn(); object.traverse(child => { if ('geometry' in child) (child.geometry as { dispose: () => void }).dispose = dispose; });
    updateSpatialObject(object, node, { visible: false, opacity: .3, highlighted: true }); expect(object.visible).toBe(false);
    disposeSpatialObject(object); expect(dispose).toHaveBeenCalled();
  });
});
