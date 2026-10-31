// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const preview = vi.hoisted(() => vi.fn());
vi.mock('../bridge', () => ({ bridge: { getSourcePreview: preview } }));
import SourcePreview from './SourcePreview';
const source = { documentId: 'doc', extractionVersion: 1, sectionId: 'section', page: 4, start: 2, end: 30 };
beforeEach(() => { preview.mockReset(); HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); }; HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); }; });
afterEach(cleanup);

it('opens only the supplied saved source and displays its physical page with printed label', async () => {
  const onClose = vi.fn();
  preview.mockResolvedValue({ documentId: 'doc', page: 4, pageLabel: 'iv', caption: 'A diagram from your notes', dataUrl: 'data:image/png;base64,AA==', text: 'The extracted source text.', warnings: ['Some symbols may be missing.'] });
  await act(async () => { render(<SourcePreview source={source} onClose={onClose} />); });
  expect(screen.getByRole('heading', { name: 'Source · page iv' })).toBeTruthy();
  expect(preview).toHaveBeenCalledWith(source);
  expect(screen.getByAltText('A diagram from your notes').getAttribute('src')).toBe('data:image/png;base64,AA==');
  expect(screen.getByText('The extracted source text.')).toBeTruthy();
  expect(screen.getByText('Physical page 4 of the saved document')).toBeTruthy();
  expect(screen.getByText('Some symbols may be missing.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Close source' }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('retains a keyboard close path when a source is unavailable', async () => {
  preview.mockRejectedValue(new Error('The saved extraction is unavailable.'));
  const onClose = vi.fn(); await act(async () => { render(<SourcePreview source={source} onClose={onClose} />); });
  expect(screen.getByRole('alert').textContent).toContain('The saved extraction is unavailable.');
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: true, cancelable: true }));
  expect(onClose).toHaveBeenCalledTimes(1);
});
