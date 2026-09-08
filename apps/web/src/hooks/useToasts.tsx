import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '../components/ui';

/**
 * Messages éphémères.
 *
 * Jusqu'ici, une action qui échouait — changer un statut, enregistrer une
 * préférence — ne disait rien : l'utilisateur croyait son geste enregistré
 * alors qu'il était perdu. Chaque mutation peut désormais signaler son échec,
 * et les réussites discrètes (lien enregistré, invitation créée) se confirment.
 */
type ToastKind = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastsValue {
  notify: (message: string, kind?: ToastKind) => void;
  /** Raccourci pour les gestionnaires d'erreur de mutation. */
  notifyError: (error: unknown, fallback?: string) => void;
}

const ToastsContext = createContext<ToastsValue | null>(null);

const DURATIONS: Record<ToastKind, number> = {
  // Une erreur doit rester le temps d'être lue et comprise.
  error: 8000,
  success: 3500,
  info: 5000,
};

export function ToastsProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current.slice(-3), { id, kind, message }]);
  }, []);

  const notifyError = useCallback(
    (error: unknown, fallback = 'Action impossible pour le moment.') => {
      notify(error instanceof Error && error.message ? error.message : fallback, 'error');
    },
    [notify],
  );

  const value = useMemo(() => ({ notify, notifyError }), [notify, notifyError]);

  return (
    <ToastsContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastsContext.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, DURATIONS[toast.kind]);
    return () => clearTimeout(timer);
  }, [toast.kind, onDismiss]);

  const Icon = toast.kind === 'error' ? AlertTriangle : toast.kind === 'success' ? CheckCircle2 : Info;
  const color =
    toast.kind === 'error'
      ? 'var(--color-danger)'
      : toast.kind === 'success'
        ? 'var(--color-success)'
        : 'var(--color-accent)';

  return (
    <div
      className={cn(
        'pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border px-3 py-2.5 shadow-lg',
        'bg-[var(--surface-raised)] text-sm',
      )}
      style={{ borderColor: color }}
    >
      <Icon size={17} className="mt-0.5 shrink-0" style={{ color }} />
      <p className="min-w-0 flex-1">{toast.message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Fermer"
        className="shrink-0 rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text)]"
      >
        <X size={15} />
      </button>
    </div>
  );
}

export function useToasts(): ToastsValue {
  const value = useContext(ToastsContext);
  if (!value) throw new Error('useToasts doit être utilisé dans ToastsProvider.');
  return value;
}
