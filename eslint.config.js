import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Configuration volontairement legere : TypeScript en mode strict fait deja
 * l'essentiel du travail, ESLint n'intervient que sur ce que le compilateur ne
 * voit pas.
 */
export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/dist-types/**', '**/node_modules/**', '**/dev-dist/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Les scripts en ligne de commande parlent a l'utilisateur par la console.
    files: ['apps/api/src/scripts/**', 'apps/api/src/lib/logger.ts', 'scripts/**'],
    rules: { 'no-console': 'off' },
  },
);
