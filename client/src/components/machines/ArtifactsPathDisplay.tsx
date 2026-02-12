import { useTranslation } from 'react-i18next';

interface ArtifactsPathDisplayProps {
  readonly artifactsPath: string;
}

export function ArtifactsPathDisplay({ artifactsPath }: ArtifactsPathDisplayProps) {
  const { t } = useTranslation();

  return (
    <div className="text-sm text-[var(--color-text-muted)]" data-testid="artifacts-path-display">
      <span className="font-medium">{t('machines.instance.artifacts_directory')}:</span>{' '}
      <code className="select-all text-xs">{artifactsPath}</code>
    </div>
  );
}
