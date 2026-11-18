import { defineConfig, type Options } from 'tsup';

const shared: Options = { format: ['esm', 'cjs'], dts: true, minify: true, sourcemap: true, target: 'es2020' };

export default defineConfig([
  { ...shared, entry: { index: 'src/index.ts' }, clean: true },
  // React entry imports the core by package name so the core isn't bundled twice; 'use client' for Next.js App Router.
  { ...shared, entry: { react: 'src/react.ts' }, external: ['react', 'ts-flags'], banner: { js: "'use client';" } },
]);
