import { useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { CustomPlatform, WorkKind } from '@scanlib/shared';
import { customPlatformSchema, workKindLabels, workKinds } from '@scanlib/shared';
import { useSession } from '../hooks/useSession';
import { Badge, Button, ChipGroup, Field, cn, inputClass, selectClass } from './ui';

const kindOptions: { value: CustomPlatform['kind']; label: string }[] = [
  { value: 'stream', label: 'Visionnage' },
  { value: 'read', label: 'Lecture' },
  { value: 'buy', label: 'Achat' },
];

/**
 * Sources ajoutées par l'utilisateur.
 *
 * Le registre livré ne contient que des plateformes dont l'URL de recherche a
 * été vérifiée. Chacun suivant ses propres sites, cet écran permet d'en
 * déclarer d'autres sans toucher au code : ils apparaissent en tête des liens
 * de chaque fiche.
 */
export function CustomSources() {
  const { user, savePreferences } = useSession();
  const sources = user?.preferences.customPlatforms ?? [];

  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<CustomPlatform['kind']>('stream');
  const [urlTemplate, setUrlTemplate] = useState('');
  const [language, setLanguage] = useState('fr');
  const [worksFor, setWorksFor] = useState<WorkKind[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setLabel('');
    setUrlTemplate('');
    setWorksFor([]);
    setError(null);
    setOpen(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    const candidate = {
      // Identifiant dérivé du nom : l'utilisateur n'a pas à en inventer un.
      id: slug(label) || `source-${Date.now().toString(36)}`,
      label: label.trim(),
      kind,
      urlTemplate: urlTemplate.trim(),
      language: language || null,
      worksFor,
    };

    const parsed = customPlatformSchema.safeParse(candidate);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Source invalide.');
      return;
    }
    if (sources.some((source) => source.id === parsed.data.id)) {
      setError('Une source porte déjà ce nom.');
      return;
    }

    setBusy(true);
    try {
      await savePreferences({ customPlatforms: [...sources, parsed.data] });
      reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Enregistrement impossible.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    await savePreferences({
      customPlatforms: sources.filter((source) => source.id !== id),
    });
  };

  return (
    <div className="space-y-3">
      {sources.length > 0 ? (
        <ul className="space-y-2">
          {sources.map((source) => (
            <li
              key={source.id}
              className="flex items-center gap-3 rounded-xl border border-[var(--border)] px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{source.label}</p>
                <p className="truncate text-[11px] text-[var(--text-muted)]">
                  {source.urlTemplate}
                </p>
              </div>
              <Badge>{kindOptions.find((option) => option.value === source.kind)?.label}</Badge>
              {source.language ? <Badge>{source.language.toUpperCase()}</Badge> : null}
              <button
                type="button"
                aria-label={`Supprimer ${source.label}`}
                onClick={() => void remove(source.id)}
                className="flex size-9 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--color-danger)]"
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[var(--text-muted)]">
          Aucune source personnalisée. Les liens proviennent uniquement des plateformes vérifiées.
        </p>
      )}

      {open ? (
        <form
          onSubmit={submit}
          className="space-y-3 rounded-xl border border-[var(--border)] p-3"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nom affiché">
              <input
                className={inputClass}
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Mon site de lecture"
                required
              />
            </Field>
            <Field label="Type">
              <select
                className={cn(selectClass, 'w-full')}
                value={kind}
                onChange={(event) => setKind(event.target.value as CustomPlatform['kind'])}
              >
                {kindOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field
            label="Adresse de recherche"
            hint="Écrivez {titre} à l'endroit où le titre de l'œuvre doit apparaître."
          >
            <input
              className={inputClass}
              value={urlTemplate}
              onChange={(event) => setUrlTemplate(event.target.value)}
              placeholder="https://exemple.fr/recherche?q={titre}"
              required
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Langue du contenu">
              <select
                className={cn(selectClass, 'w-full')}
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
              >
                <option value="fr">Français</option>
                <option value="en">Anglais</option>
                <option value="ja">Japonais</option>
                <option value="">Non précisée</option>
              </select>
            </Field>
            <div>
              <span className="mb-1.5 block text-sm font-medium">
                Types d’œuvres <span className="text-[var(--text-muted)]">(vide = tous)</span>
              </span>
              <ChipGroup
                options={workKinds.map((value) => ({
                  value,
                  label: workKindLabels[value].fr,
                }))}
                selected={worksFor}
                onChange={setWorksFor}
              />
            </div>
          </div>

          {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}

          <div className="flex gap-2">
            <Button type="submit" variant="primary" loading={busy}>
              Ajouter
            </Button>
            <Button onClick={reset}>Annuler</Button>
          </div>
        </form>
      ) : (
        <Button icon={<Plus size={16} />} onClick={() => setOpen(true)}>
          Ajouter une source
        </Button>
      )}
    </div>
  );
}

/** « Mon Site de Lecture » → « mon-site-de-lecture ». */
function slug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}
