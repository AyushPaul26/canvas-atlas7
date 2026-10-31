// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { LessonSession } from '@living-canvas/protocol';
import LearningWorkspace, { UnderstandingCheck } from './LearningWorkspace';

afterEach(cleanup);
const session: LessonSession = { id: 'lesson', topic: 'Gravity', title: 'Gravity', createdAt: '2026-10-22T00:00:00Z', updatedAt: '2026-10-22T00:00:00Z', messages: [], beats: [], scene: [], controls: {}, plan: { id: 'plan', version: 1, title: 'Understanding gravity', sourceDocumentIds: [], concepts: [{ id: 'gravity', title: 'Mass and attraction', objectives: ['Predict how mass affects force'], prerequisiteIds: [], sourceRefs: [] }] }, learningProgress: { planId: 'plan', planVersion: 1, activeConceptId: 'gravity', conceptStates: { gravity: 'planned' }, status: 'planned' } };

it('shows objectives and waits for an explicit concept start', () => {
  const onStart = vi.fn();
  render(<LearningWorkspace session={session} busy={false} onStart={onStart} onSource={vi.fn()} />);
  expect(screen.getByText('Predict how mass affects force')).toBeTruthy();
  expect(onStart).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Start Teaching' }));
  expect(onStart).toHaveBeenCalledWith('gravity');
});

it('keeps answer, help and skip check evidence distinct', () => {
  const onAnswer = vi.fn();
  render(<UnderstandingCheck session={{ ...session, learningProgress: { ...session.learningProgress!, status: 'checking', pendingCheck: { conceptId: 'gravity', question: 'What changes if mass doubles?' } } }} busy={false} onAnswer={onAnswer} />);
  fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'The force doubles.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Share answer' }));
  expect(onAnswer).toHaveBeenLastCalledWith('The force doubles.');
  fireEvent.click(screen.getByRole('button', { name: 'Help me think it through' }));
  expect(onAnswer).toHaveBeenLastCalledWith('Help me with this understanding check. Please use a different explanation.');
  fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
  expect(onAnswer).toHaveBeenLastCalledWith('Skip this understanding check and continue.');
});

it('offers a return to an interrupted lesson without changing coverage', () => {
  const onReturn = vi.fn();
  render(<LearningWorkspace session={{ ...session, learningProgress: { ...session.learningProgress!, branchReturnPoint: { beatId: 'accepted', chunkId: 'chunk', offsetSeconds: .5, passId: 'pass' } } }} busy={false} onStart={vi.fn()} onSource={vi.fn()} onReturn={onReturn} />);
  fireEvent.click(screen.getByRole('button', { name: 'Back to lesson' }));
  expect(onReturn).toHaveBeenCalledTimes(1);
  expect(screen.getByText('0 of 1 concepts covered')).toBeTruthy();
});
