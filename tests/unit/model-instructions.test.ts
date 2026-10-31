import { expect, it } from 'vitest';
import { simulationArtifactSchema } from '../../packages/protocol/src/index';
import { buildTeacherInstructions } from '../../packages/teacher/src/index';

it('supplies an admitted data-only example alongside legacy, timing and safety-compatible teaching guidance', () => {
  const instructions = buildTeacherInstructions();
  const match = instructions.match(/Example source object for a slope lesson: (\{[^\n]+\})\. Declare px/);
  expect(match).toBeTruthy();
  const controls = ['px', 'py'].map(id => ({ id, label: id, type: 'number', value: 2, min: -4, max: 4 }));
  expect(simulationArtifactSchema.safeParse({ id: 'slope', title: 'Slope', engine: 'model', source: match![1], controls, assumptions: [], validation: 'illustrative' }).success).toBe(true);
  expect(instructions).toContain('UNIFORM gravity');
  expect(instructions).toContain('not an inverse-square');
  expect(instructions).toContain('globalThis.simulation');
  expect(instructions).toContain('No AI request is needed for each control change');
});
