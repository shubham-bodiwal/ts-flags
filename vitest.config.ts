import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { 'ts-flags': '/src/index.ts' } },
  test: {
    coverage: {
      include: ['src/**/*.ts'],
      thresholds: { lines: 95, branches: 95, functions: 95, statements: 95 },
    },
  },
});
