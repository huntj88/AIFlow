import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

// ────────────────────────────────────────────────────────────────────────────
// Placeholder — Task 30 will implement the full definition editor.
// ────────────────────────────────────────────────────────────────────────────

export function MachineDefinitionPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const isNew = !id;

  return (
    <div data-testid="machine-definition-page">
      <h2 className="mb-4 text-2xl font-semibold">
        {isNew
          ? t('machines.definition_editor.title_new')
          : t('machines.definition_editor.title_edit')}
      </h2>
      <p className="text-[var(--color-text-muted)]">
        {t('machines.definition_editor.placeholder')}
      </p>
    </div>
  );
}

export default MachineDefinitionPage;
