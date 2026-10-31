// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { DocumentManifest } from '@living-canvas/protocol';
import MaterialImport from './MaterialImport';
afterEach(cleanup);
it('reports unreadable material and never offers an enabled outline request for empty text', () => {
  const document: DocumentManifest = { id: 'empty', name: 'Scanned notes.pdf', mimeType: 'application/pdf', byteSize: 100, sha256: 'a'.repeat(64), extractionVersion: 1, status: 'failed', pages: [], coverage: 0, warnings: ['OCR is not available.'], createdAt: '2026-10-22T00:00:00Z' };
  const onPlan = vi.fn();
  render(<MaterialImport documents={[document]} course={null} busy={false} importing={false} onImport={vi.fn()} onCancel={vi.fn()} onPlan={onPlan} onStart={vi.fn()} />);
  expect(screen.getByText('No readable text was found. Export a text-based PDF or use text or Markdown.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Create course outline' }));
  expect(onPlan).not.toHaveBeenCalled();
});

it('shows real import progress and permits cancellation without resubmitting', () => {
  const onImport = vi.fn(), onCancel = vi.fn();
  render(<MaterialImport documents={[]} course={null} busy={true} importing={true} progress="extracting · 3 of 9 pages" onImport={onImport} onCancel={onCancel} onPlan={vi.fn()} onStart={vi.fn()} />);
  expect(screen.getByRole('status').textContent).toContain('3 of 9 pages');
  fireEvent.click(screen.getByRole('button', { name: 'Upload Study Material' }));
  expect(onImport).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel import' }));
  expect(onCancel).toHaveBeenCalledTimes(1);
});
