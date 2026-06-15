module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
    jest: true
  },
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module'
  },
  extends: [
    'eslint:recommended',
    'prettier'
  ],
  plugins: [],
  rules: {
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'no-console': 'off',
    'prefer-const': 'warn',
    'no-var': 'error',
    'eqeqeq': ['error', 'smart'],
    'no-undef': 'off'  // Node.js globals handled by env
  },
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'coverage/',
    'public/',
    '*.config.js',
    'database.sqlite*'
  ]
};