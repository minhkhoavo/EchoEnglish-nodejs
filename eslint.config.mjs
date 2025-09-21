// eslint.config.js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import { globalIgnores } from 'eslint/config';

export default tseslint.config([
  // Ignore build + node_modules
  globalIgnores(['dist', 'node_modules']),

  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      globals: {
        ...globals.node, // Node.js environment
      },
    },
    extends: [
      js.configs.recommended, // ESLint mặc định
      ...tseslint.configs.recommended, // TypeScript rules
    ],
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn'],
      'no-unused-vars': 'off', // để tránh conflict
      'no-console': 'off', // cho phép console.log trong server
    },
  },
]);
