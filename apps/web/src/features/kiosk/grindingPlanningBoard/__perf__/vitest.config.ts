import { defineConfig } from 'vitest/config';

// *.perf.tsx is deliberately outside Vitest's normal test/spec discovery.
export default defineConfig({ test: {
  include: ['src/features/kiosk/grindingPlanningBoard/__perf__/*.perf.tsx'],
  globals: true, environment: 'jsdom', setupFiles: ['./src/test/setup.ts'], testTimeout: 120_000
} });
