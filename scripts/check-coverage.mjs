// Fails when test coverage is below the floor on any measure. Run after `ng test --coverage`:
//
//   node scripts/check-coverage.mjs
//
// The floor is 80% and can be raised (never lowered without a reason) with COVERAGE_FLOOR.
// It reads the summary written by the json-summary reporter, which counts every file under src/app,
// including files no test touches: a figure that leaves those out flatters the code.

import { readFile } from 'node:fs/promises';

const FLOOR = Number(process.env.COVERAGE_FLOOR ?? 80);
const file = process.argv[2] ?? 'coverage/offerladder/coverage-summary.json';

let total;
try {
  total = JSON.parse(await readFile(file, 'utf8')).total;
} catch {
  console.error(`No coverage summary at ${file}. Run "npm run test:coverage" first.`);
  process.exit(1);
}

const measures = ['statements', 'branches', 'functions', 'lines'];
const short = measures.filter((m) => !(total[m]?.pct >= FLOOR));
for (const m of measures) console.log(`${m.padEnd(10)} ${String(total[m]?.pct ?? 'n/a').padStart(6)}%  (${total[m]?.covered}/${total[m]?.total})`);
if (short.length) {
  console.error(`\nCoverage is below ${FLOOR}% for: ${short.join(', ')}. Add tests before merging.`);
  process.exit(1);
}
console.log(`\nCoverage is at or above ${FLOOR}% on every measure.`);
