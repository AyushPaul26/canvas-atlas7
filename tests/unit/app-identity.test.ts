import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PRODUCT_NAME, APPLICATION_ID, resolveUserDataDirectory } from '../../apps/desktop/src/main/identity';

const temporary: string[] = [];
const directory = () => { const path = mkdtempSync(join(tmpdir(), 'canvas-atlas-identity-')); temporary.push(path); return path; };
afterEach(() => temporary.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));

describe('Canvas Atlas identity and data continuity', () => {
  it('uses the new product name and the stable installation identity', () => {
    expect(PRODUCT_NAME).toBe('Canvas Atlas');
    expect(APPLICATION_ID).toBe('org.livingcanvas.desktop');
  });
  it('reuses an existing legacy user-data directory without copying or reading credentials', () => {
    for (const legacy of ['living-canvas', 'Living Canvas']) {
      const root = directory();
      const existing = join(root, legacy); mkdirSync(existing);
      expect(resolveUserDataDirectory(root)).toBe(existing);
    }
  });
  it('honors an explicit data directory and uses a stable directory for fresh installations', () => {
    const root = directory();
    expect(resolveUserDataDirectory(root)).toBe(join(root, 'canvas-atlas'));
    expect(resolveUserDataDirectory(root, './private/test-data')).toBe(resolve('./private/test-data'));
    mkdirSync(join(root, 'canvas-atlas')); mkdirSync(join(root, 'living-canvas'));
    expect(resolveUserDataDirectory(root)).toBe(join(root, 'canvas-atlas'));
  });
});
