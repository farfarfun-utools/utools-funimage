const js = require('@eslint/js')
const globals = require('globals')

module.exports = [
  {
    ignores: ['utools/dist/**', 'node_modules/**', 'public/vendor/**', '.screenshot-tools/**'],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'src/**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.browser, Cropper: 'readonly' },
    },
  },
  {
    files: ['utools/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser, utools: 'readonly' },
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    files: ['vite.config.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: globals.node,
    },
  },
  {
    files: ['eslint.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node,
    },
  },
  {
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-duplicate-imports': 'error',
    },
  },
]
