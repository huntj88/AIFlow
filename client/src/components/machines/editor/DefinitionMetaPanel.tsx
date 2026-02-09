// ────────────────────────────────────────────────────────────────────────────
// Definition metadata panel — shown when no node is selected
// ────────────────────────────────────────────────────────────────────────────

import { useTranslation } from 'react-i18next';

import { useDefinitionEditor } from '@/hooks/useDefinitionEditor';

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

export function DefinitionMetaPanel() {
  const { t } = useTranslation();

  const name = useDefinitionEditor((s) => s.name);
  const description = useDefinitionEditor((s) => s.description);
  const inputSchema = useDefinitionEditor((s) => s.inputSchema);
  const outputSchema = useDefinitionEditor((s) => s.outputSchema);
  const timeoutMs = useDefinitionEditor((s) => s.timeoutMs);
  const maxDepth = useDefinitionEditor((s) => s.maxDepth);

  const setName = useDefinitionEditor((s) => s.setName);
  const setDescription = useDefinitionEditor((s) => s.setDescription);
  const setInputSchema = useDefinitionEditor((s) => s.setInputSchema);
  const setOutputSchema = useDefinitionEditor((s) => s.setOutputSchema);
  const setTimeoutMs = useDefinitionEditor((s) => s.setTimeoutMs);
  const setMaxDepth = useDefinitionEditor((s) => s.setMaxDepth);

  return (
    <div className="flex flex-col gap-3 overflow-y-auto p-3" data-testid="definition-meta-panel">
      <h3 className="text-sm font-semibold">{t('machines.editor.metaConfig')}</h3>

      {/* Name */}
      <label className="flex flex-col gap-1 text-xs">
        {t('machines.editor.name')}
        <input
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
          className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm"
          data-testid="def-name-input"
        />
      </label>

      {/* Description */}
      <label className="flex flex-col gap-1 text-xs">
        {t('machines.editor.description')}
        <textarea
          rows={3}
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
          }}
          className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm"
          data-testid="def-description-input"
        />
      </label>

      {/* Input Schema */}
      <label className="flex flex-col gap-1 text-xs">
        {t('machines.editor.inputSchema')}
        <textarea
          rows={4}
          value={inputSchema}
          onChange={(e) => {
            setInputSchema(e.target.value);
          }}
          className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-xs"
          data-testid="def-input-schema"
        />
      </label>

      {/* Output Schema */}
      <label className="flex flex-col gap-1 text-xs">
        {t('machines.editor.outputSchema')}
        <textarea
          rows={4}
          value={outputSchema}
          onChange={(e) => {
            setOutputSchema(e.target.value);
          }}
          className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-xs"
          data-testid="def-output-schema"
        />
      </label>

      {/* Timeout */}
      <label className="flex flex-col gap-1 text-xs">
        {t('machines.editor.timeout')}
        <input
          type="number"
          min={0}
          value={timeoutMs ?? ''}
          onChange={(e) => {
            setTimeoutMs(e.target.value ? Number(e.target.value) : undefined);
          }}
          className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm"
          data-testid="def-timeout-input"
        />
      </label>

      {/* Max Depth */}
      <label className="flex flex-col gap-1 text-xs">
        {t('machines.editor.maxDepth')}
        <input
          type="number"
          min={1}
          value={maxDepth ?? ''}
          onChange={(e) => {
            setMaxDepth(e.target.value ? Number(e.target.value) : undefined);
          }}
          className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm"
          data-testid="def-max-depth-input"
        />
      </label>
    </div>
  );
}
