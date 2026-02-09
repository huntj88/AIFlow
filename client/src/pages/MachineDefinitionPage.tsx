import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { DefinitionEditor } from '@/components/machines/editor/DefinitionEditor';
import type { StateMachineDefinition } from '@/types/machines';
import { apiClient } from '@/utils/apiClient';
import { runWithLogging } from '@/utils/logger';

// ────────────────────────────────────────────────────────────────────────────
// Page — wraps DefinitionEditor with route param handling
// ────────────────────────────────────────────────────────────────────────────

export function MachineDefinitionPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === 'new';

  const [definition, setDefinition] = useState<StateMachineDefinition | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isNew || !id) return;

    let cancelled = false;

    const fetchDef = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const def = await runWithLogging(apiClient.getDefinition(id));
        if (!cancelled) {
          setDefinition(def);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void fetchDef();

    return () => {
      cancelled = true;
    };
  }, [id, isNew]);

  if (isLoading) {
    return (
      <div className="flex h-[calc(100vh-4rem)] flex-col p-6" data-testid="machine-definition-page">
        <div className="mb-4 h-6 w-48 animate-pulse rounded bg-[var(--color-border)]" />
        <div className="flex-1 animate-pulse rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="flex items-center justify-center py-12 text-red-500"
        data-testid="machine-definition-page"
      >
        {error}
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col" data-testid="machine-definition-page">
      <h2 className="shrink-0 px-4 py-2 text-lg font-semibold">
        {isNew
          ? t('machines.definition_editor.title_new')
          : t('machines.definition_editor.title_edit')}
      </h2>
      <div className="flex-1 overflow-hidden">
        <DefinitionEditor existingDefinition={definition} />
      </div>
    </div>
  );
}

export default MachineDefinitionPage;
