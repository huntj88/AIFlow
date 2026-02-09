import { useTranslation } from 'react-i18next';

import type { MachineInstance, StateMachineDefinition } from '@/types/machines';

import { StatusBadge } from './StatusBadge';

interface InstanceRowProps {
  readonly instance: MachineInstance;
  readonly definitions: StateMachineDefinition[];
  readonly onSelect: (id: string) => void;
  readonly onResume: (id: string) => void;
}

export function InstanceRow({ instance, definitions, onSelect, onResume }: InstanceRowProps) {
  const { t } = useTranslation();

  const definition = definitions.find((d) => d.id === instance.definitionId);
  const definitionName = definition?.name ?? instance.definitionId;

  const createdAt = new Date(instance.createdAt).toLocaleString();

  return (
    <tr
      className="cursor-pointer border-b border-[var(--color-border)] hover:bg-[var(--color-surface)]"
      onClick={() => {
        onSelect(instance.id);
      }}
      data-testid={`instance-row-${instance.id}`}
    >
      <td className="px-4 py-3 text-sm">{definitionName}</td>
      <td className="px-4 py-3 text-sm">
        <StatusBadge status={instance.status} />
      </td>
      <td className="px-4 py-3 text-sm">{instance.currentState}</td>
      <td className="px-4 py-3 text-sm text-[var(--color-text-muted)]">{createdAt}</td>
      <td className="px-4 py-3 text-right text-sm">
        {instance.status === 'suspended' && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onResume(instance.id);
            }}
            className="rounded-md bg-amber-500 px-3 py-1 text-xs text-white hover:bg-amber-600"
            data-testid={`resume-instance-${instance.id}`}
          >
            {t('machines.instances.resume')}
          </button>
        )}
      </td>
    </tr>
  );
}
