import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['dist/**', 'node_modules/**']),
  {
    files: ['**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/worker/**'],
    languageOptions: { globals: globals.browser },
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
  },
  {
    files: ['src/worker/**/*.ts'],
    languageOptions: { globals: globals.worker },
  },
  prettier,
]);
