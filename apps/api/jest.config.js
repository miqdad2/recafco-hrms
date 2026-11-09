/**
 * Jest config for @recafco/api integration/regression tests (introduced in TIME-01).
 *
 * Tests run against a dedicated, disposable local PostgreSQL database (default
 * `recafco_hrms_test`), never the dev or production database — see test/support/test-database.ts
 * for the safety guard. Files run serially (`maxWorkers: 1`) because they share that database.
 */
/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  testMatch: ['<rootDir>/test/**/*.spec.ts'],
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  setupFiles: ['<rootDir>/test/support/setup-env.ts'],
  globalSetup: '<rootDir>/test/support/global-setup.ts',
  maxWorkers: 1,
  testTimeout: 30000,
};
