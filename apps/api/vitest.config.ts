import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup-env.ts'],
    sequence: {
      concurrent: false
    },
    coverage: {
      reporter: ['text', 'lcov'],
      exclude: ['src/types/**']
    }
  }
});
