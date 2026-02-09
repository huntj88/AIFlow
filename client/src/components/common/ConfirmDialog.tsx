import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

// ────────────────────────────────────────────────────────────────────────────
// ConfirmDialog — modal dialog for destructive action confirmations
// ────────────────────────────────────────────────────────────────────────────

interface ConfirmDialogProps {
  readonly open: boolean;
  readonly title?: string;
  readonly message: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly variant?: 'danger' | 'default';
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    },
    [onCancel],
  );

  useEffect(() => {
    if (!open) return;
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  const confirmBtnClass =
    variant === 'danger'
      ? 'rounded-md bg-red-500 px-4 py-2 text-sm text-white hover:bg-red-600'
      : 'rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm text-white hover:opacity-90';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      data-testid="confirm-dialog"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onCancel}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onCancel();
        }}
        role="button"
        tabIndex={-1}
        aria-label="Close dialog"
      />
      {/* Dialog */}
      <div className="relative z-10 max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-6 shadow-lg">
        <h3 className="mb-2 text-lg font-semibold text-[var(--color-text)]">
          {title ?? t('machines.confirm.title')}
        </h3>
        <p className="mb-6 text-sm text-[var(--color-text-muted)]">{message}</p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)]"
            data-testid="confirm-dialog-cancel"
          >
            {cancelLabel ?? t('machines.confirm.cancel')}
          </button>
          <button
            onClick={onConfirm}
            className={confirmBtnClass}
            data-testid="confirm-dialog-confirm"
          >
            {confirmLabel ?? t('machines.confirm.ok')}
          </button>
        </div>
      </div>
    </div>
  );
}
