import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// *.perf.tsx is deliberately outside Vitest's normal test/spec discovery.
export default defineConfig({ envDir: false, plugins: [{
  name: 'perf-table-row-counter', enforce: 'pre',
  transform(source, id) {
    if (!id.endsWith('/PlanningBoardItemTable.tsx')) return;
    const marker = '}: PlanningBoardItemTableRowProps) {';
    if (!source.includes(marker)) throw new Error('Table row instrumentation marker changed');
    const probe = fileURLToPath(new URL('./tableRowProbe.ts', import.meta.url));
    return { code: `import { tableRowProbe } from ${JSON.stringify(probe)};\n` +
      source.replace(marker, `${marker}\n  tableRowProbe.renders++;`), map: null };
  }
}], test: {
  include: ['src/features/kiosk/grindingPlanningBoard/__perf__/*.perf.tsx'],
  globals: true, environment: 'jsdom', setupFiles: ['./src/test/setup.ts'], testTimeout: 120_000
} });
