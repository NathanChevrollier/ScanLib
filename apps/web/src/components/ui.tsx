import clsx, { type ClassValue } from 'clsx';
import {
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { Loader2, X } from 'lucide-react';

export const cn = (...values: ClassValue[]) => clsx(values);

/* -------------------------------------------------------------------------
 * Boutons
 * ---------------------------------------------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-soft)]',
  secondary:
    'bg-[var(--surface-hover)] text-[var(--text)] border border-[var(--border)] hover:border-[var(--color-ink-600)]',
  ghost: 'text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]',
  danger: 'bg-[var(--color-danger)] text-white hover:opacity-90',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = 'secondary',
  loading,
  icon,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cn(
        // 44px de hauteur minimale : cible tactile confortable sur mobile.
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium',
        'transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]',
        buttonVariants[variant],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 size={16} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-11 items-center justify-center rounded-xl text-[var(--text-muted)]',
        'transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------
 * Conteneurs
 * ---------------------------------------------------------------------- */

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface-raised)]',
        className,
      )}
      {...props}
    />
  );
}

/** En-tête de page : titre, sous-titre facultatif et action alignée à droite. */
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? (
          <p className="mt-1 text-sm text-[var(--text-muted)]">{subtitle}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/**
 * Grille de fiches qui remplit la largeur disponible. `items-start` évite que
 * les fiches d'une même rangée s'étirent à la hauteur de la plus grande.
 */
export function CardGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('grid items-start gap-5 lg:grid-cols-2 2xl:grid-cols-3', className)}>
      {children}
    </div>
  );
}

export function SectionTitle({
  title,
  action,
  hint,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {hint ? <p className="mt-0.5 text-xs text-[var(--text-muted)]">{hint}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Badge({
  children,
  color,
  className,
}: {
  children: ReactNode;
  color?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
        className,
      )}
      style={
        color
          ? { backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)`, color }
          : undefined
      }
    >
      {children}
    </span>
  );
}

export function ProgressBar({ value, color }: { value: number; color?: string }) {
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-hover)]"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full transition-[width] duration-300"
        style={{ width: `${value}%`, backgroundColor: color ?? 'var(--color-accent)' }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------
 * États
 * ---------------------------------------------------------------------- */

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('animate-spin text-[var(--text-muted)]', className)} size={20} />;
}

export function LoadingBlock({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sm text-[var(--text-muted)]">
      <Spinner />
      {label}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-[var(--radius-card)] border border-dashed border-[var(--border)] px-6 py-14 text-center">
      {icon ? <div className="text-[var(--text-muted)]">{icon}</div> : null}
      <p className="font-medium">{title}</p>
      {description ? (
        <p className="max-w-sm text-sm text-[var(--text-muted)]">{description}</p>
      ) : null}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-4 py-3 text-sm">
      <p className="text-[var(--text)]">{message}</p>
      {onRetry ? (
        <Button variant="ghost" className="mt-2 px-0" onClick={onRetry}>
          Réessayer
        </Button>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Formulaires
 * ---------------------------------------------------------------------- */

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-[var(--text-muted)]">{hint}</span> : null}
    </label>
  );
}

const controlBase =
  'min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--color-accent)] focus:outline-none';

export const inputClass = cn('w-full', controlBase);

/**
 * Même habillage que les champs texte, mais largeur libre : Tailwind ne
 * fusionne pas les classes en conflit, `w-full` l'emporterait sur `w-auto`.
 */
export const selectClass = controlBase;

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-11 w-full items-center justify-between gap-4 text-left text-sm"
    >
      <span>{label}</span>
      <span
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full transition-colors',
          checked ? 'bg-[var(--color-accent)]' : 'bg-[var(--surface-hover)]',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-5 rounded-full bg-white transition-[left]',
            checked ? 'left-[22px]' : 'left-0.5',
          )}
        />
      </span>
    </button>
  );
}

/** Groupe de choix multiples sous forme de puces — filtres, langues, régions. */
export function ChipGroup<T extends string>({
  options,
  selected,
  onChange,
  color,
}: {
  options: { value: T; label: string }[];
  selected: T[];
  onChange: (values: T[]) => void;
  color?: (value: T) => string | undefined;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const active = selected.includes(option.value);
        const accent = color?.(option.value) ?? 'var(--color-accent)';
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() =>
              onChange(
                active
                  ? selected.filter((value) => value !== option.value)
                  : [...selected, option.value],
              )
            }
            className={cn(
              'min-h-9 rounded-full border px-3 text-xs font-medium transition-colors',
              active
                ? 'border-transparent text-white'
                : 'border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]',
            )}
            style={active ? { backgroundColor: accent } : undefined}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Modale
 * ---------------------------------------------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // Empêche le défilement de l'arrière-plan sur mobile.
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[10vh] backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'w-full overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] shadow-2xl outline-none',
          wide ? 'max-w-3xl' : 'max-w-lg',
        )}
      >
        {title ? (
          <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
            <h2 className="font-semibold">{title}</h2>
            <IconButton label="Fermer" onClick={onClose}>
              <X size={18} />
            </IconButton>
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}
