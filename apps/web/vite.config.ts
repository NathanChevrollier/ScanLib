import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiUrl = env.VITE_API_URL || 'http://localhost:3001';

  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        // Service worker écrit à la main : la génération automatique ne permet
        // pas de recevoir les notifications poussées.
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        includeAssets: ['favicon.svg'],
        manifest: {
          name: 'ScanLib',
          short_name: 'ScanLib',
          description: 'Bibliotheque unifiee de scans, animes, series et films',
          lang: 'fr',
          theme_color: '#0b0d12',
          background_color: '#0b0d12',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/',
          // Une seule icone vectorielle : elle sert a toutes les tailles et
          // evite d'embarquer des PNG a maintenir en double.
          icons: [
            { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
            { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
          ],
        },
        // Les règles de cache vivent désormais dans `src/sw.ts`.
        injectManifest: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        },
      }),
    ],
    resolve: {
      alias: {
        // Le paquet partage son code source TypeScript : on l'aliase vers les
        // sources pour que Vite le transpile comme le reste de l'application.
        '@scanlib/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
      },
    },
    optimizeDeps: { exclude: ['@scanlib/shared'] },
    // Front et API partagent l'origine, en developpement comme en preview :
    // c'est la configuration de production (Caddy) et cela evite toute question
    // de cookies inter-domaines.
    server: {
      port: 5173,
      proxy: { '/api': { target: apiUrl, changeOrigin: true } },
    },
    preview: {
      port: 4173,
      proxy: { '/api': { target: apiUrl, changeOrigin: true } },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      rollupOptions: {
        output: {
          // Le socle React change bien moins souvent que le code applicatif :
          // le separer garde le cache du navigateur utile entre deux deploiements.
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            query: ['@tanstack/react-query'],
          },
        },
      },
    },
  };
});
