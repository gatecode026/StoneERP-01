import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'node_modules/**', 'docs/**', 'next-env.d.ts', 'coverage/**', 'public/sw.js', 'public/swe-worker*.js', 'playwright-report/**', 'test-results/**']),
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'react/no-unescaped-entities': 'off',
      '@next/next/no-img-element': 'off',
      // Legacy components (rewritten in Phase 6) use patterns the React-19 compiler rules flag. Warn, do not block.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/static-components': 'warn',
    },
  },
  { files: ['scripts/**', '*.config.*'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
]);
