import { useTranslation } from 'react-i18next';

import type { MachineInstance } from '@/types/machines';

type InstanceStatus = MachineInstance['status'];

const STATUS_STYLES: Record<InstanceStatus, string> = {
  running: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  completed: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  error: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  cancelled: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
  suspended: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  waiting_for_child: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
};

interface StatusBadgeProps {
  readonly status: InstanceStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const { t } = useTranslation();

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
      data-testid={`status-badge-${status}`}
    >
      {t(`machines.status.${status}`)}
    </span>
  );
}
