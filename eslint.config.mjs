import globals from 'globals'

export default [
  {
    ignores: ['node_modules/**', 'out/**', 'dist/**', 'release/**', 'build/**'],
  },
  {
    files: ['src/**/*.{js,jsx}', 'scripts/*.mjs', '*.config.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-dupe-args': 'error',
      'no-dupe-keys': 'error',
      'valid-typeof': 'error',
    },
  },
]
