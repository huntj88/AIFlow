import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { StateMachineDefinition } from '@/types/machines';

interface QuickStartPanelProps {
  readonly definitions: StateMachineDefinition[];
  readonly isLoading: boolean;
  readonly onLaunch: (definitionId: string, input: unknown, workspaceRoot: string) => void;
}

export function QuickStartPanel({ definitions, isLoading, onLaunch }: QuickStartPanelProps) {
  const { t } = useTranslation();
  const [selectedDefinitionId, setSelectedDefinitionId] = useState('');
  const [inputJson, setInputJson] = useState('{}');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [workspaceRoot, setWorkspaceRoot] = useState('');
  const [workspaceRootError, setWorkspaceRootError] = useState<string | null>(null);

  const validateJson = useCallback(
    (value: string) => {
      try {
        JSON.parse(value);
        setJsonError(null);
        return true;
      } catch {
        setJsonError(t('machines.quickstart.invalid_json'));
        return false;
      }
    },
    [t],
  );

  const handleLaunch = () => {
    if (!selectedDefinitionId) return;
    if (!validateJson(inputJson)) return;

    if (!workspaceRoot.startsWith('/')) {
      setWorkspaceRootError(t('machines.quickstart.invalid_workspace_root'));
      return;
    }
    setWorkspaceRootError(null);

    const parsed = JSON.parse(inputJson) as unknown;
    onLaunch(selectedDefinitionId, parsed, workspaceRoot);
  };

  return (
    <div
      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
      data-testid="quick-start-panel"
    >
      <h3 className="mb-3 text-base font-semibold">{t('machines.quickstart.title')}</h3>

      <div className="mb-3">
        <select
          value={selectedDefinitionId}
          onChange={(e) => {
            setSelectedDefinitionId(e.target.value);
          }}
          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]"
          data-testid="definition-select"
        >
          <option value="">{t('machines.quickstart.select_definition')}</option>
          {definitions.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} (v{d.version})
            </option>
          ))}
        </select>
      </div>

      <div className="mb-3">
        <label className="mb-1 block text-xs text-[var(--color-text-muted)]">
          {t('machines.quickstart.input_label')}
        </label>
        <textarea
          value={inputJson}
          onChange={(e) => {
            setInputJson(e.target.value);
            if (jsonError) {
              validateJson(e.target.value);
            }
          }}
          placeholder={t('machines.quickstart.input_placeholder')}
          rows={4}
          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)]"
          data-testid="json-input"
        />
        {jsonError && (
          <p className="mt-1 text-xs text-red-500" data-testid="json-error">
            {jsonError}
          </p>
        )}
      </div>

      <div className="mb-3">
        <label className="mb-1 block text-xs text-[var(--color-text-muted)]">
          {t('machines.quickstart.workspace_root_label')}
        </label>
        <input
          type="text"
          value={workspaceRoot}
          onChange={(e) => {
            setWorkspaceRoot(e.target.value);
            if (workspaceRootError && e.target.value.startsWith('/')) {
              setWorkspaceRootError(null);
            }
          }}
          placeholder={t('machines.quickstart.workspace_root_placeholder')}
          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]"
          data-testid="workspace-root-input"
        />
        {workspaceRootError && (
          <p className="mt-1 text-xs text-red-500" data-testid="workspace-root-error">
            {workspaceRootError}
          </p>
        )}
      </div>

      <button
        onClick={handleLaunch}
        disabled={!selectedDefinitionId || !workspaceRoot || isLoading}
        className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm text-white disabled:opacity-50"
        data-testid="launch-button"
      >
        {t('machines.quickstart.launch')}
      </button>
    </div>
  );
}
