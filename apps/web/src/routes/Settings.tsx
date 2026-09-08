import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { CustomSources } from '../components/CustomSources';
import { PLATFORM_OPTIONS } from '../lib/platforms';
import { api } from '../lib/api';
import { useSession } from '../hooks/useSession';
import {
  Button,
  Card,
  CardGrid,
  ChipGroup,
  PageHeader,
  SectionTitle,
  Toggle,
  cn,
} from '../components/ui';

const languageOptions = [
  { value: 'fr', label: 'Français' },
  { value: 'en', label: 'Anglais' },
  { value: 'ja', label: 'Japonais' },
  { value: 'es', label: 'Espagnol' },
];

const regionOptions = [
  { value: 'FR', label: 'France' },
  { value: 'BE', label: 'Belgique' },
  { value: 'CH', label: 'Suisse' },
  { value: 'CA', label: 'Canada' },
  { value: 'US', label: 'États-Unis' },
  { value: 'GB', label: 'Royaume-Uni' },
];

const statusColors: Record<string, string> = {
  ok: 'var(--color-success)',
  degraded: 'var(--color-warning)',
  down: 'var(--color-danger)',
  disabled: 'var(--text-muted)',
};

/**
 * Préférences de l'application — ce qu'elle affiche et où elle va chercher.
 * Tout ce qui relève du compte lui-même vit dans l'onglet Profil.
 */
export function SettingsPage() {
  const { user, savePreferences, t } = useSession();

  const health = useQuery({
    queryKey: ['provider-health'],
    queryFn: () => api.providerHealth(),
    staleTime: 5 * 60_000,
  });

  if (!user) return null;
  const preferences = user.preferences;

  const exportLibrary = async () => {
    const payload = await api.exportLibrary();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `scanlib-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto w-full max-w-[110rem] space-y-6">
      <PageHeader
        title={t('nav.settings')}
        subtitle="Ce que l'application vous propose, et où elle va chercher ses informations."
      />

      <CardGrid>
        {/* Le bloc le plus dense occupe deux colonnes : les puces de plateformes
            se lisent mieux sur une rangée large que sur six lignes. */}
        <Card className="space-y-5 p-5 lg:col-span-2">
          <SectionTitle
            title="Liens officiels"
            hint="Ces préférences déterminent quels liens de lecture et de visionnage vous sont proposés."
          />

          <div className="grid gap-5 xl:grid-cols-2">
            <div>
              <p className="mb-2 text-sm font-medium">{t('settings.languages')}</p>
              <ChipGroup
                options={languageOptions}
                selected={preferences.languages}
                onChange={(languages) => void savePreferences({ languages })}
              />
            </div>

            <div>
              <p className="mb-2 text-sm font-medium">{t('settings.regions')}</p>
              <ChipGroup
                options={regionOptions}
                selected={preferences.regions}
                onChange={(regions) => void savePreferences({ regions })}
              />
            </div>
          </div>

          <div>
            <p className="mb-1 text-sm font-medium">{t('settings.platforms')}</p>
            <p className="mb-2 text-xs text-[var(--text-muted)]">
              Vos abonnements remontent en tête de la liste des liens.
            </p>
            <ChipGroup
              options={PLATFORM_OPTIONS}
              selected={preferences.ownedPlatforms}
              onChange={(ownedPlatforms) => void savePreferences({ ownedPlatforms })}
            />
          </div>

          <Toggle
            checked={preferences.officialOnly}
            onChange={(officialOnly) => void savePreferences({ officialOnly })}
            label={t('settings.officialOnly')}
          />
        </Card>

        <Card className="space-y-4 p-5">
          <SectionTitle title="Apparence" />
          <div>
            <p className="mb-2 text-sm font-medium">{t('settings.theme')}</p>
            <div className="flex gap-2">
              {(['system', 'light', 'dark'] as const).map((theme) => (
                <button
                  key={theme}
                  type="button"
                  onClick={() => void savePreferences({ theme })}
                  className={cn(
                    'min-h-11 flex-1 rounded-xl border text-sm transition-colors',
                    preferences.theme === theme
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
                      : 'border-[var(--border)] hover:border-[var(--color-ink-600)]',
                  )}
                >
                  {theme === 'system' ? 'Système' : theme === 'light' ? 'Clair' : 'Sombre'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">Langue de l'interface</p>
            <div className="flex gap-2">
              {(['fr', 'en'] as const).map((uiLanguage) => (
                <button
                  key={uiLanguage}
                  type="button"
                  onClick={() => void savePreferences({ uiLanguage })}
                  className={cn(
                    'min-h-11 flex-1 rounded-xl border text-sm transition-colors',
                    preferences.uiLanguage === uiLanguage
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
                      : 'border-[var(--border)] hover:border-[var(--color-ink-600)]',
                  )}
                >
                  {uiLanguage === 'fr' ? 'Français' : 'English'}
                </button>
              ))}
            </div>
          </div>
        </Card>

        <Card className="space-y-4 p-5 lg:col-span-2 2xl:col-span-1">
          <SectionTitle
            title="Mes sources"
            hint="Ajoutez les sites que vous utilisez : ils apparaissent en tête des liens de chaque fiche."
          />
          <CustomSources />
        </Card>

        <Card className="space-y-3 p-5">
          <SectionTitle
            title={t('settings.providers')}
            hint="Une source indisponible est simplement ignorée : les autres prennent le relais."
          />
          <ul className="space-y-2">
            {(health.data?.providers ?? []).map((provider) => (
              <li key={provider.provider} className="flex items-center gap-3 text-sm">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: statusColors[provider.status] ?? 'var(--text-muted)' }}
                />
                <span className="w-24 shrink-0 font-medium">{provider.provider}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-muted)]">
                  {provider.message ?? provider.status}
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="space-y-3 p-5">
          <SectionTitle
            title="Données"
            hint="Une sauvegarde complète de votre bibliothèque, au format JSON."
          />
          <Button icon={<Download size={16} />} onClick={() => void exportLibrary()}>
            {t('settings.export')}
          </Button>
        </Card>
      </CardGrid>
    </div>
  );
}
