import * as path from 'node:path';

/** Metadata describing a resolved transcript artifact path. */
export interface CliTranscriptPath {
  readonly workspace: 'artifacts';
  readonly path: string;
  readonly resolvedPath: string;
  readonly label: string;
}

/** Inputs for constructing a transcript lineage/path resolver. */
export interface CliTranscriptPathResolverOptions {
  readonly artifactsRoot: string;
  /** Child-instance lineage from root → current instance (root instance = empty). */
  readonly lineageInstanceIds: readonly string[];
  readonly stateName: string;
  /** 1-based visit index for the current state execution. */
  readonly visitIndex: number;
}

/** Resolver function that returns a transcript path for the given label. */
export type CliTranscriptPathResolver = (label: string) => CliTranscriptPath;

const sanitizeSegment = (value: string, fallback: string): string => {
  const cleaned = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return cleaned.length > 0 ? cleaned : fallback;
};

/** Derive a deterministic transcript label from command name/path. */
export const deriveCliTranscriptLabel = (command: string): string => {
  const base = path.basename(command.trim());
  return sanitizeSegment(base.length > 0 ? base : command, 'command').toLowerCase();
};

const padVisitIndex = (visitIndex: number): string =>
  String(Math.max(visitIndex, 1)).padStart(3, '0');

/**
 * Create a transcript path resolver for one state visit.
 *
 * Path format:
 * - root: `<stateName>/<visitIndex>-<label>-log.txt`
 * - child: `children/<childInstanceId>/<stateName>/<visitIndex>-<label>-log.txt`
 * - nested child: recursive `children/<instanceId>/...`
 */
export const makeCliTranscriptPathResolver = (
  opts: CliTranscriptPathResolverOptions,
): CliTranscriptPathResolver => {
  const safeStateName = sanitizeSegment(opts.stateName, 'state');
  const lineageSegments = opts.lineageInstanceIds.flatMap((instanceId) => [
    'children',
    sanitizeSegment(instanceId, 'instance'),
  ]);
  const visit = padVisitIndex(opts.visitIndex);

  return (label: string) => {
    const safeLabel = sanitizeSegment(label, 'command').toLowerCase();
    const fileName = `${visit}-${safeLabel}-log.txt`;
    const relativePath = path.posix.join(...lineageSegments, safeStateName, fileName);

    return {
      workspace: 'artifacts',
      path: relativePath,
      resolvedPath: path.resolve(opts.artifactsRoot, relativePath),
      label: safeLabel,
    };
  };
};
