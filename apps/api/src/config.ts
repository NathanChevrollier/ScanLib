import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

/**
 * Le `.env` vit à la racine du dépôt, mais les commandes se lancent depuis
 * `apps/api` (npm workspaces) comme depuis la racine. On remonte donc jusqu'au
 * premier `.env` trouvé. En production les variables viennent de l'environnement
 * du conteneur : l'absence de fichier n'est pas une erreur.
 */
function loadDotEnv(): void {
  let directory = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(directory, '.env');
    if (existsSync(candidate)) {
      loadEnv({ path: candidate });
      return;
    }
    const parent = resolve(directory, '..');
    if (parent === directory) break;
    directory = parent;
  }
  loadEnv();
}

loadDotEnv();

const csv = (fallback: string[]) =>
  z
    .string()
    .optional()
    .transform((value) =>
      value
        ? value
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
        : fallback,
    );

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => (value == null || value === '' ? fallback : value === 'true'));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(3001),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL est obligatoire.'),
  CORS_ORIGIN: csv(['http://localhost:5173']),

  JWT_SECRET: z.string().min(24, 'JWT_SECRET doit faire au moins 24 caractères.'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL: z.string().default('30d'),
  COOKIE_SECURE: bool(false),
  COOKIE_DOMAIN: z.string().optional(),
  ALLOW_OPEN_REGISTRATION: bool(false),

  TMDB_API_KEY: z.string().optional(),
  DEFAULT_WATCH_REGIONS: csv(['FR', 'US']),
  DEFAULT_LANGUAGES: csv(['fr', 'en']),
  // Activée d'office : meilleure source gratuite pour les liens de streaming
  // typés et la grille de diffusion. Le coupe-circuit du registre l'écarte
  // seul si son API retombe, sans casser la recherche.
  ENABLE_ANILIST: bool(true),
  PROVIDER_USER_AGENT: z.string().default('ScanLib/0.1 (self-hosted)'),

  ENABLE_JOBS: bool(true),

  // Notifications poussées. Sans ces clés, l'application fonctionne
  // normalement mais les notifications restent internes.
  // Générer la paire avec : npx web-push generate-vapid-keys
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:admin@localhost'),
  // Fuseau de référence pour le regroupement par jour (heatmap, séries de
  // jours consécutifs) et pour la planification des tâches.
  TIMEZONE: z.string().default('Europe/Paris'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`);
  throw new Error(`Configuration invalide :\n${issues.join('\n')}\n\nVoir .env.example.`);
}

export const config = {
  ...parsed.data,
  isProduction: parsed.data.NODE_ENV === 'production',
};

export type Config = typeof config;
