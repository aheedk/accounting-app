import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 60_000,
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    // One Postgres container is started once per run and shared by every test
    // file (see tests/helpers/globalSetup.ts). Files therefore must not run
    // concurrently -- each one truncates the shared database between tests.
    globalSetup: ['./tests/helpers/globalSetup.ts'],
    fileParallelism: false,
  },
});
