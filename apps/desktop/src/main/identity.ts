import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const PRODUCT_NAME = 'Canvas Atlas';
// Retain installer/taskbar identity so upgrading does not create a second app.
export const APPLICATION_ID = 'org.livingcanvas.desktop';

export function resolveUserDataDirectory(appData: string, configured?: string): string {
  if (configured) return resolve(configured);
  // Reuse the directory in place: credentials remain protected by the same OS
  // account, and lessons and installed voice models do not need to be copied.
  for (const directory of ['canvas-atlas', 'living-canvas', 'Living Canvas']) {
    const candidate = join(appData, directory);
    if (existsSync(candidate)) return candidate;
  }
  return join(appData, 'canvas-atlas');
}
