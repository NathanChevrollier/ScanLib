import { useEffect, useState } from 'react';
import { Check, Minus, Plus } from 'lucide-react';
import type { WorkKind } from '@scanlib/shared';
import { Button, IconButton, cn, inputClass } from './ui';

/**
 * Réglage direct de l'avancement : « j'en suis au chapitre 1050 ».
 *
 * Cocher les unités une par une convient quand on suit une série au fil de
 * l'eau, mais pas pour rattraper une série commencée ailleurs ni pour corriger
 * une erreur. D'où trois gestes : reculer d'un cran, avancer d'un cran, ou
 * saisir le numéro directement — l'unité saisie et toutes les précédentes
 * passent à terminé, les suivantes redeviennent à consommer.
 */
export function ProgressControl({
  kind,
  current,
  total,
  busy,
  onSet,
}: {
  kind: WorkKind;
  /** Numéro de la dernière unité terminée, 0 si rien n'est commencé. */
  current: number;
  /** Numéro le plus élevé connu, pour borner la saisie. */
  total: number | null;
  busy?: boolean;
  onSet: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(current));
  const unit = kind === 'manga' ? 'Chapitre' : 'Épisode';

  // La saisie suit la valeur du serveur tant que l'utilisateur ne la modifie pas.
  useEffect(() => setDraft(String(current)), [current]);

  const commit = () => {
    const parsed = Number.parseFloat(draft.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed < 0) {
      setDraft(String(current));
      return;
    }
    const bounded = total != null ? Math.min(parsed, total) : parsed;
    if (bounded !== current) onSet(bounded);
    else setDraft(String(current));
  };

  const step = (delta: number) => {
    const next = Math.max(0, current + delta);
    if (total != null && next > total) return;
    onSet(next);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-[var(--text-muted)]">{unit}</span>

      <div className="flex items-center gap-1 rounded-xl border border-[var(--border)] p-1">
        <IconButton
          label={`${unit} précédent`}
          onClick={() => step(-1)}
          disabled={busy || current <= 0}
          className="size-9"
        >
          <Minus size={16} />
        </IconButton>

        <input
          type="text"
          inputMode="decimal"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') setDraft(String(current));
          }}
          aria-label={`Numéro du dernier ${unit.toLowerCase()} terminé`}
          className={cn(inputClass, 'h-9 min-h-0 w-20 text-center tabular-nums')}
        />

        <IconButton
          label={`${unit} suivant`}
          onClick={() => step(1)}
          disabled={busy || (total != null && current >= total)}
          className="size-9"
        >
          <Plus size={16} />
        </IconButton>
      </div>

      {total != null ? (
        <span className="text-sm text-[var(--text-muted)]">/ {total}</span>
      ) : null}

      {draft !== String(current) ? (
        <Button variant="primary" icon={<Check size={15} />} onClick={commit} loading={busy}>
          Appliquer
        </Button>
      ) : null}

      {total != null && current < total ? (
        <Button onClick={() => onSet(total)} disabled={busy}>
          Tout marquer
        </Button>
      ) : null}
      {current > 0 ? (
        <Button variant="ghost" onClick={() => onSet(0)} disabled={busy}>
          Réinitialiser
        </Button>
      ) : null}
    </div>
  );
}
