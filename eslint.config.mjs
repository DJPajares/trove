import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['**/dist/**', '**/.next/**', '**/node_modules/**']),
  js.configs.recommended,
  tseslint.configs.recommended,
);
