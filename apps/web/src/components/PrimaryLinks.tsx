import { useState } from 'react';
import { Check, ExternalLink, Link2, Pencil, Trash2 } from 'lucide-react';
import type { PrimaryLinks as PrimaryLinksValue, WorkKind } from '@scanlib/shared';
import { Badge, Button, cn, inputClass } from './ui';

type Language = 'fr' | 'en';

const labels: Record<Language, string> = { fr: 'Français', en: 'Anglais' };

/**
 * Les deux liens principaux d'une œuvre, saisis par l'utilisateur.
 *
 * Les liens automatiques mènent au mieux à une page de résultats ; ceux-ci
 * mènent à la page qu'on ouvre réellement pour cette série précise. Un par
 * langue, et ils prennent la tête de tous les autres — c'est le bouton
 * « Lire » ou « Regarder » de la fiche qui les utilise.
 */
export function PrimaryLinksEditor({
  kind,
  value,
  busy,
  onSave,
}: {
  kind: WorkKind;
  value: PrimaryLinksValue;
  busy?: boolean;
  onSave: (links: Partial<Record<Language, string | null>>) => void;
}) {
  const [editing, setEditing] = useState<Language | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const verb = kind === 'manga' ? 'Lire' : 'Regarder';

  const start = (language: Language) => {
    setEditing(language);
    setDraft(value[language] ?? '');
    setError(null);
  };

  const save = (language: Language) => {
    const trimmed = draft.trim();
    if (trimmed && !/^https?:\/\//i.test(trimmed)) {
      setError('Le lien doit commencer par https://');
      return;
    }
    onSave({ [language]: trimmed || null });
    setEditing(null);
    setError(null);
  };

  return (
    <div className="space-y-2">
      {(['fr', 'en'] as Language[]).map((language) => {
        const url = value[language];

        if (editing === language) {
          return (
            <div key={language} className="flex flex-wrap items-center gap-2">
              <Badge color="var(--color-accent)">{language.toUpperCase()}</Badge>
              <input
                autoFocus
                type="url"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') save(language);
                  if (event.key === 'Escape') setEditing(null);
                }}
                placeholder={`https://… la page ${labels[language].toLowerCase()} de cette œuvre`}
                className={cn(inputClass, 'min-w-0 flex-1')}
              />
              <Button variant="primary" icon={<Check size={15} />} onClick={() => save(language)} loading={busy}>
                Enregistrer
              </Button>
              <Button variant="ghost" onClick={() => setEditing(null)}>
                Annuler
              </Button>
              {error ? (
                <p className="w-full text-xs text-[var(--color-danger)]">{error}</p>
              ) : null}
            </div>
          );
        }

        return (
          <div key={language} className="flex items-center gap-2">
            <Badge color={url ? 'var(--color-accent)' : undefined}>{language.toUpperCase()}</Badge>

            {url ? (
              <>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-w-0 flex-1 items-center gap-2 truncate rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--surface-hover)]"
                >
                  <ExternalLink size={14} className="shrink-0 text-[var(--text-muted)]" />
                  <span className="truncate">{url}</span>
                </a>
                <button
                  type="button"
                  aria-label={`Modifier le lien ${labels[language]}`}
                  onClick={() => start(language)}
                  className="flex size-9 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  aria-label={`Supprimer le lien ${labels[language]}`}
                  onClick={() => onSave({ [language]: null })}
                  className="flex size-9 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--color-danger)]"
                >
                  <Trash2 size={14} />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => start(language)}
                className="flex min-h-9 flex-1 items-center gap-2 rounded-lg border border-dashed border-[var(--border)] px-3 text-sm text-[var(--text-muted)] hover:border-[var(--color-accent)] hover:text-[var(--text)]"
              >
                <Link2 size={14} />
                Ajouter le lien {labels[language].toLowerCase()} — il deviendra le bouton «&nbsp;{verb}&nbsp;»
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
