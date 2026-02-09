import { useTranslation } from 'react-i18next';

import type { StateMachineDefinition } from '@/types/machines';

interface DefinitionCardProps {
  readonly definition: StateMachineDefinition;
  readonly onEdit: (id: string) => void;
  readonly onDelete: (id: string) => void;
}

export function DefinitionCard({ definition, onEdit, onDelete }: DefinitionCardProps) {
  const { t } = useTranslation();

  const handleDelete = () => {
    const msg = t('machines.definitions.delete_confirm', { name: definition.name });
    if (window.confirm(msg)) {
      onDelete(definition.id);
    }
  };

  return (
    <div
      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
      data-testid={`definition-card-${definition.id}`}
    >
      <div className="mb-2 flex items-start justify-between">
        <div>
          <h3 className="text-base font-semibold">{definition.name}</h3>
          <span className="text-xs text-[var(--color-text-muted)]">
            {t('machines.definitions.version', { version: definition.version })}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              onEdit(definition.id);
            }}
            className="rounded-md bg-[var(--color-accent)] px-3 py-1 text-xs text-white"
            data-testid={`edit-definition-${definition.id}`}
          >
            {t('machines.definitions.edit')}
          </button>
          <button
            onClick={handleDelete}
            className="rounded-md bg-red-500 px-3 py-1 text-xs text-white"
            data-testid={`delete-definition-${definition.id}`}
          >
            {t('machines.definitions.delete')}
          </button>
        </div>
      </div>

      {definition.metadata.description && (
        <p className="mb-2 text-sm text-[var(--color-text-muted)]">
          {definition.metadata.description}
        </p>
      )}

      {definition.metadata.tags && definition.metadata.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {definition.metadata.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-text-muted)]"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
