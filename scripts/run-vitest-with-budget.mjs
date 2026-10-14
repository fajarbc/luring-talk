import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_BUDGET_MS = 5_000;
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const vitestCli = resolve(scriptDirectory, '../node_modules/vitest/vitest.mjs');
const startedAt = process.hrtime.bigint();
const result = spawnSync(process.execPath, [vitestCli, 'run', ...process.argv.slice(2)], {
  stdio: 'inherit',
});
const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

if (result.error) {
  console.error(`Unable to start Vitest: ${result.error.message}`);
  process.exitCode = 1;
} else if (result.status !== 0) {
  process.exitCode = result.status ?? 1;
} else if (elapsedMs > TEST_BUDGET_MS) {
  console.error(
    `Vitest suite took ${elapsedMs.toFixed(0)}ms, exceeding the ${TEST_BUDGET_MS}ms budget.`,
  );
  process.exitCode = 1;
} else {
  console.log(`Vitest suite completed in ${elapsedMs.toFixed(0)}ms.`);
}
