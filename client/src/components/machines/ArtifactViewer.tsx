import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ArtifactRecord, ArtifactTree } from '@/types/machines';
import { apiClient } from '@/utils/apiClient';
import { runWithLogging } from '@/utils/logger';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

interface ArtifactViewerProps {
  readonly instanceId: string;
  readonly artifactTree: ArtifactTree | null;
  /** Flat artifact list (fallback when tree is not available). */
  readonly artifacts: readonly ArtifactRecord[];
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

export function ArtifactViewer({ instanceId, artifactTree, artifacts }: ArtifactViewerProps) {
  const { t } = useTranslation();

  if (artifactTree) {
    return (
      <div className="p-4" data-testid="artifact-viewer">
        <ArtifactTreeNode node={artifactTree} depth={0} />
      </div>
    );
  }

  // Fallback: flat list
  if (artifacts.length === 0) {
    return (
      <div
        className="py-8 text-center text-sm text-[var(--color-text-muted)]"
        data-testid="artifact-viewer-empty"
      >
        {t('machines.instance.artifacts_empty')}
      </div>
    );
  }

  return (
    <div className="p-4" data-testid="artifact-viewer">
      <div className="space-y-1">
        {artifacts.map((a) => (
          <ArtifactRow key={`${a.instanceId}-${a.name}`} artifact={a} instanceId={instanceId} />
        ))}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Tree node (recursive)
// ────────────────────────────────────────────────────────────────────────────

interface ArtifactTreeNodeProps {
  readonly node: ArtifactTree;
  readonly depth: number;
}

function ArtifactTreeNode({ node, depth }: ArtifactTreeNodeProps) {
  const [expanded, setExpanded] = useState(depth < 2);

  const hasContent = node.artifacts.length > 0 || node.children.length > 0;

  return (
    <div className={depth > 0 ? 'ml-4 border-l border-[var(--color-border)] pl-3' : ''}>
      {/* Instance header */}
      <button
        onClick={() => {
          setExpanded((prev) => !prev);
        }}
        className="flex w-full items-center gap-2 rounded-md p-1.5 text-left text-sm hover:bg-[var(--color-surface)]"
        data-testid={`artifact-tree-node-${node.instanceId}`}
      >
        <span className="text-xs">{expanded ? '▼' : '▶'}</span>
        <span className="text-base">📁</span>
        <span className="font-medium">{node.definitionName}</span>
        <span className="font-mono text-xs text-[var(--color-text-muted)]">
          {node.instanceId.slice(0, 8)}…
        </span>
        <span className="text-xs text-[var(--color-text-muted)]">
          ({node.artifacts.length} {node.artifacts.length === 1 ? 'file' : 'files'})
        </span>
      </button>

      {expanded && hasContent && (
        <div className="ml-4 mt-1 space-y-1">
          {/* Files */}
          {node.artifacts.map((a) => (
            <ArtifactRow key={`${a.instanceId}-${a.name}`} artifact={a} instanceId={a.instanceId} />
          ))}

          {/* Child instances */}
          {node.children.map((child) => (
            <ArtifactTreeNode key={child.instanceId} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Single artifact row
// ────────────────────────────────────────────────────────────────────────────

interface ArtifactRowProps {
  readonly artifact: ArtifactRecord;
  readonly instanceId: string;
}

function ArtifactRow({ artifact, instanceId }: ArtifactRowProps) {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    try {
      const buffer = await runWithLogging(apiClient.downloadArtifact(instanceId, artifact.name));
      const blob = new Blob([buffer], { type: artifact.mimeType ?? 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = artifact.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // Download error is handled by the store
    } finally {
      setDownloading(false);
    }
  }, [instanceId, artifact.name, artifact.mimeType]);

  const timestamp = new Date(artifact.createdAt).toLocaleTimeString();

  return (
    <div
      className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-[var(--color-surface)]"
      data-testid={`artifact-row-${artifact.name}`}
    >
      <span className="text-base">📄</span>
      <button
        onClick={() => void handleDownload()}
        disabled={downloading}
        className="flex-1 text-left font-mono text-xs text-blue-600 hover:underline dark:text-blue-400"
        data-testid={`artifact-download-${artifact.name}`}
      >
        {artifact.name}
      </button>
      <span className="text-xs text-[var(--color-text-muted)]">[{artifact.stateName}]</span>
      <span className="tabular-nums text-xs text-[var(--color-text-muted)]">
        {formatBytes(artifact.size)}
      </span>
      <span className="text-xs text-[var(--color-text-muted)]">{timestamp}</span>
    </div>
  );
}
