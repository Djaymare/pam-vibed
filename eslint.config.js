import js from '@eslint/js';
import ts from 'typescript-eslint';
import vue from 'eslint-plugin-vue';

export default [
  { ignores: ['artifacts/**', 'node_modules/**', 'dist/**'] },
  ...ts.configs.recommended.map((config) => ({ ...config, files: ['src/composables/**/*.ts'] })),
  ...vue.configs['flat/essential'],
  { files: ['src/**/*.vue'], languageOptions: { parserOptions: { parser: ts.parser } } },
  {
    ...js.configs.recommended,
    files: ['sidecar/assistant.cjs', 'sidecar/assistant/**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        Buffer: 'readonly',
        structuredClone: 'readonly',
        require: 'readonly',
        module: 'readonly',
        process: 'readonly',
      },
    },
    rules: { ...js.configs.recommended.rules, 'no-empty': ['error', { allowEmptyCatch: true }] },
  },
];
