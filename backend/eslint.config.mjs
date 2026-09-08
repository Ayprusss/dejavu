import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

// Injected by Vitest at runtime via `globals: true` in vitest.config.js.
const vitestGlobals = {
  describe: 'readonly',
  it: 'readonly',
  test: 'readonly',
  expect: 'readonly',
  vi: 'readonly',
  beforeAll: 'readonly',
  afterAll: 'readonly',
  beforeEach: 'readonly',
  afterEach: 'readonly',
};

export default [
  { ignores: ['coverage/**', 'node_modules/**', 'postman/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    // Tests are CommonJS but run with Vitest's globals injected.
    files: ['tests/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...vitestGlobals } },
  },
  {
    // Config and setup files are ESM.
    files: ['**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  prettier,
];
