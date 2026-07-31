import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

// Native ESLint flat config (no @eslint/eslintrc/FlatCompat legacy bridge).
//
// This project previously used FlatCompat.config({ plugins: ['react-refresh'], ... })
// to translate an old-style .eslintrc-shaped config into flat config. That
// bridge resolves plugins via a synchronous CJS `require`, which breaks for
// eslint-plugin-react-refresh (a pure-ESM package, "type": "module") — it
// fails to attach the plugin's rules correctly, producing "Could not find
// 'only-export-components' in plugin 'react-refresh'" even though the
// installed package genuinely exports that rule. Registering every plugin
// directly (native `import` + a `plugins: {}` object below) avoids that
// resolution path entirely and works with modern ESM-only plugin packages.
export default [
  {
    ignores: [
      'dist/**',
      'android/**',
      'playwright-report/**',
      'test-results/**',
      'coverage/**',
      '.eslintrc.cjs',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.es2020,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tsPlugin.configs.recommended.rules,
      // Only the two long-standing, stable react-hooks rules are enabled —
      // NOT the full `configs.recommended.rules` bundle, which in
      // eslint-plugin-react-hooks v7 also includes ~15 new, very strict
      // "React Compiler" purity rules (set-state-in-effect, refs,
      // static-components, immutability, purity, etc). Those assume code
      // written for React Compiler compatibility and flag many long-standing,
      // legitimate patterns already used throughout this codebase (e.g.
      // updating a ref's `.current` during render for a stable-callback
      // pattern, or calling a hoisted function before its declaration).
      // Enabling them wholesale would require a large, risky rewrite of
      // working code unrelated to actually fixing the lint tool.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // TypeScript's own compiler already catches genuinely undefined
      // variables/types; no-undef doesn't understand TS-only constructs
      // (ambient lib types like NodeJS.Timeout, BlobPart, EventListener,
      // type-only imports, etc.) and produces false positives for them.
      // This is TypeScript-ESLint's own documented recommendation:
      // https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined
      'no-undef': 'off',
    },
  },
];
