import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
const packages = ['protocol','teacher','scene','simulation','timeline','voice'];
export default defineConfig({
  resolve: {alias: Object.fromEntries(packages.map(name => [`@living-canvas/${name}`,resolve(`packages/${name}/src/index.ts`)]))},
  test: {include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/integration/**/*.test.{ts,tsx}', 'packages/**/tests/**/*.test.ts', 'apps/desktop/src/renderer/**/*.test.{ts,tsx}'], environment:'node', testTimeout:15000, hookTimeout:15000},
});
