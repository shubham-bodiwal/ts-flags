// Fails if the ESM core + React entry exceed the budget (gzipped).
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const BUDGET = 3 * 1024;
let total = 0;
for (const file of ['dist/index.js', 'dist/react.js']) {
  const bytes = gzipSync(readFileSync(file), { level: 9 }).length;
  total += bytes;
  console.log(`${file.padEnd(16)} ${bytes} B gzipped`);
}
console.log(`${'total'.padEnd(16)} ${total} B / ${BUDGET} B budget`);
if (total > BUDGET) process.exit(1);
