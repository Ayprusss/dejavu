import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.js'],
    // The integration suite has its own config: it needs a real database, and
    // `npm test` must stay runnable with nothing running.
    exclude: ['tests/integration/**'],
    setupFiles: ['./tests/setup.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      include: ['src/**/*.js'],
      // Reported, never gated. See the Phase 1 notes in dejavu-execution-plan.md.
      thresholds: undefined,
    },
  },
});
