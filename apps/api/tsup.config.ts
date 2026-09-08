import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/db/migrate.ts',
    'src/scripts/create-user.ts',
    'src/scripts/run-job.ts',
  ],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  sourcemap: true,
  splitting: false,
  // Les paquets de l'espace de travail ne sont que du TypeScript source : ils
  // doivent être intégrés au bundle, contrairement aux dépendances npm.
  noExternal: ['@scanlib/shared', '@scanlib/providers'],
});
