import { describe, expect, it } from 'vitest';
import { getTeachingToolParameters } from '../../packages/teacher/src/index';

describe('strict account tool schemas', () => {
  it('adds the engine choice without exceeding the 100-property provider schema budget', () => {
    const schema = getTeachingToolParameters() as any;
    let count = 0;
    const visit = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      if ('properties' in value && value.properties && typeof value.properties === 'object') count += Object.keys(value.properties).length;
      Object.values(value).forEach(visit);
    };
    visit(schema);
    expect(count).toBeLessThanOrEqual(100);
    expect(schema.properties.simulation.anyOf[0].properties.engine).toBeDefined();
  });
  it('uses supported unions and homogeneous arrays for spatial coordinates', () => {
    const schema = getTeachingToolParameters() as any;
    const visit = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      expect(value).not.toHaveProperty('oneOf');
      expect(value).not.toHaveProperty('prefixItems');
      for (const child of Object.values(value)) visit(child);
    };
    visit(schema);
    const action = schema.properties.cues.anyOf[0].items.properties.action;
    expect(action.anyOf).toHaveLength(6);
    const point = schema.properties.spatialScene.anyOf[0].properties.nodes.items.properties.position;
    expect(point).toMatchObject({ type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } });
    expect(schema.required).toEqual(Object.keys(schema.properties));
    expect(schema.additionalProperties).toBe(false);
  });
});
