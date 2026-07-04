// Flat ESLint config for the monorepo.
//
// Deliberately MINIMAL. The goal (per AUDIT_FINDINGS §5.2) is to enforce the
// React rules-of-hooks class — the exact bug that white-screened prod once —
// not to run a full style sweep. So we:
//   • parse every .ts/.tsx so the rules can run,
//   • turn on `react-hooks` in the app (`rules-of-hooks` = error, the real
//     guard; `exhaustive-deps` = warn so it informs without blocking),
//   • leave everything else quiet, so `pnpm lint` is green today and the CI
//     gate is meaningful from day one.
// Stricter rulesets (js/tseslint recommended) can be layered on later without
// touching the gate.

import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.expo/**',
      '**/web-build/**',
      '**/build/**',
      '**/coverage/**',
      'reference/**',
      '**/*.config.js',
      '**/*.config.cjs',
      '**/*.config.mjs',
    ],
  },
  {
    // Parse TS/TSX everywhere (types are checked by `tsc` separately; here we
    // just need a parser so lint rules can see the AST). The plugin is
    // registered so existing `// eslint-disable @typescript-eslint/...`
    // comments resolve to a known rule instead of erroring — but no
    // @typescript-eslint rules are enabled yet.
    files: ['**/*.{ts,tsx}'],
    plugins: { '@typescript-eslint': tseslint.plugin },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    linterOptions: {
      // Pre-existing disable comments target rules we don't run yet (no-console,
      // @typescript-eslint/*). Silence the "unused directive" noise so the gate
      // output stays focused on the real react-hooks signal.
      reportUnusedDisableDirectives: 'off',
    },
  },
  {
    // React hooks rules apply to the app only (server is plain Node).
    files: ['app/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
);
