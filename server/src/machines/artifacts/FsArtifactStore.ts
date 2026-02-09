/**
 * FsArtifactStore — Filesystem-backed ArtifactStore implementation (Task 08)
 *
 * Provides sandboxed file operations scoped to each machine instance with
 * hierarchical storage mirroring parent-child instance relationships.
 * All path traversal attempts are rejected for security.
 *
 * Directory structure:
 *   <ARTIFACT_ROOT>/<instanceId>/              — root-level instance
 *   <ARTIFACT_ROOT>/<parentId>/children/<id>/  — child instance
 *
 * @module
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { Effect, Layer } from 'effect';

import type { ArtifactRecord, ArtifactStore } from '../types.js';
import { mkStoreError } from '../types.js';
import type { MachineStore } from '../store/MachineStore.js';
import { MachineStore as MachineStoreTag } from '../store/MachineStore.js';
import type { ArtifactStoreFactory } from './ArtifactStoreFactory.js';
import { ArtifactStoreFactory as ArtifactStoreFactoryTag } from './ArtifactStoreFactory.js';

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

const DEFAULT_ARTIFACT_ROOT = './data/artifacts';

function getArtifactRoot(): string {
  // eslint-disable-next-line @typescript-eslint/dot-notation
  return process.env['ARTIFACT_ROOT'] ?? DEFAULT_ARTIFACT_ROOT;
}

// ────────────────────────────────────────────────────────────────────────────
// Security — Path traversal prevention
// ────────────────────────────────────────────────────────────────────────────

/**
 * Validate a filename for path traversal attacks.
 * Rejects `../`, absolute paths, and backslash separators.
 */
function validateFilename(name: string): void {
  if (name.includes('..')) {
    throw new Error(`Path traversal detected: filename contains '..'`);
  }
  if (name.startsWith('/')) {
    throw new Error(`Absolute paths are not allowed: '${name}'`);
  }
  if (name.includes('\\')) {
    throw new Error(`Backslash path separators are not allowed: '${name}'`);
  }
  if (name.length === 0) {
    throw new Error('Filename must not be empty');
  }
}

/**
 * Resolve a filename within a base directory and verify the resolved path
 * stays within that directory (defense-in-depth).
 */
function safeResolve(baseDir: string, name: string): string {
  const resolved = path.resolve(baseDir, name);
  const normalizedBase = path.resolve(baseDir);
  if (!resolved.startsWith(normalizedBase + path.sep) && resolved !== normalizedBase) {
    throw new Error(`Path traversal detected: resolved path escapes instance directory`);
  }
  return resolved;
}

// ────────────────────────────────────────────────────────────────────────────
// Directory resolution
// ────────────────────────────────────────────────────────────────────────────

/**
 * Compute the directory for an instance's artifacts.
 * - Root instance → `<ARTIFACT_ROOT>/<instanceId>/`
 * - Child instance → `<ARTIFACT_ROOT>/<parentId>/children/<instanceId>/`
 */
function instanceDir(instanceId: string, parentInstanceId?: string): string {
  const root = path.resolve(getArtifactRoot());
  if (parentInstanceId) {
    return path.join(root, parentInstanceId, 'children', instanceId);
  }
  return path.join(root, instanceId);
}

// ────────────────────────────────────────────────────────────────────────────
// Scoped ArtifactStore factory function
// ────────────────────────────────────────────────────────────────────────────

/**
 * Create a scoped `ArtifactStore` for a specific instance + state execution.
 *
 * `readChild` / `listChild` require a `MachineStore` to validate the
 * descendant relationship. The store is passed explicitly so this module
 * remains a pure function (no ambient service dependency).
 */
export function makeScopedArtifactStore(
  instanceId: string,
  stateName: string,
  parentInstanceId: string | undefined,
  store: MachineStore,
): ArtifactStore {
  const dir = instanceDir(instanceId, parentInstanceId);

  // ── Helpers ──────────────────────────────────────────────────────────

  /** Walk `parentInstanceId` chain to verify `candidateId` is a descendant. */
  function assertDescendant(
    candidateId: string,
  ): Effect.Effect<void, import('../types.js').StoreError> {
    return Effect.gen(function* () {
      // Walk up from candidateId; if we reach instanceId, it's a descendant
      let current = candidateId;
      const visited = new Set<string>();
      while (current !== instanceId) {
        if (visited.has(current)) {
          return yield* Effect.fail(
            mkStoreError({
              operation: 'readChild',
              cause: `Instance '${candidateId}' is not a descendant of '${instanceId}'`,
            }),
          );
        }
        visited.add(current);
        const inst = yield* store.getInstance(current).pipe(
          Effect.mapError(() =>
            mkStoreError({
              operation: 'readChild',
              cause: `Instance '${candidateId}' is not a descendant of '${instanceId}'`,
            }),
          ),
        );
        if (!inst.parentInstanceId) {
          return yield* Effect.fail(
            mkStoreError({
              operation: 'readChild',
              cause: `Instance '${candidateId}' is not a descendant of '${instanceId}'`,
            }),
          );
        }
        current = inst.parentInstanceId;
      }
    });
  }

  /**
   * Resolve the directory for a descendant instance by looking up its
   * `parentInstanceId` in the store, matching the same logic used when
   * the artifact was originally written.
   */
  function resolveDescendantDir(
    childInstanceId: string,
  ): Effect.Effect<string, import('../types.js').StoreError> {
    return store.getInstance(childInstanceId).pipe(
      Effect.map((inst) => instanceDir(inst.id, inst.parentInstanceId)),
      Effect.mapError(() =>
        mkStoreError({
          operation: 'readChild',
          cause: `Instance '${childInstanceId}' not found`,
        }),
      ),
    );
  }

  // ── ArtifactStore implementation ─────────────────────────────────────

  return {
    write(name, content, metadata?) {
      return Effect.gen(function* () {
        const record = yield* Effect.tryPromise({
          try: async () => {
            validateFilename(name);
            const filePath = safeResolve(dir, name);
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, content);

            const rec: ArtifactRecord = {
              name,
              instanceId,
              stateName,
              size: content.byteLength,
              mimeType:
                // eslint-disable-next-line @typescript-eslint/dot-notation
                metadata && typeof metadata['mimeType'] === 'string'
                  ? // eslint-disable-next-line @typescript-eslint/dot-notation
                    metadata['mimeType']
                  : undefined,
              metadata: metadata ?? undefined,
              createdAt: new Date().toISOString(),
            };

            // Persist record metadata as a sidecar JSON file
            const metaPath = filePath + '.meta.json';
            await fs.writeFile(metaPath, JSON.stringify(rec, null, 2), 'utf-8');

            return rec;
          },
          catch: (cause) => mkStoreError({ operation: 'write', cause }),
        });

        // Append the artifact record to the instance in the MachineStore
        const instance = yield* store
          .getInstance(instanceId)
          .pipe(Effect.catchAll(() => Effect.succeed(null)));
        if (instance) {
          yield* store
            .updateInstance(instanceId, {
              artifacts: [...instance.artifacts, record],
            })
            .pipe(Effect.catchAll(() => Effect.void));
        }

        return record;
      });
    },

    read(name) {
      return Effect.tryPromise({
        try: async () => {
          validateFilename(name);
          const filePath = safeResolve(dir, name);
          const buffer = await fs.readFile(filePath);
          return new Uint8Array(buffer);
        },
        catch: (cause) => {
          const err = cause as NodeJS.ErrnoException | null;
          if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
            return mkStoreError({
              operation: 'read',
              cause: `Artifact '${name}' not found for instance '${instanceId}'`,
            });
          }
          return mkStoreError({ operation: 'read', cause });
        },
      }) as Effect.Effect<
        Uint8Array,
        import('../types.js').StoreError | import('../types.js').NotFoundError
      >;
    },

    list() {
      return Effect.tryPromise({
        try: async () => {
          try {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            const records: ArtifactRecord[] = [];

            for (const entry of entries) {
              // Skip directories and metadata sidecar files
              if (entry.isDirectory() || entry.name.endsWith('.meta.json')) continue;

              const metaPath = path.join(dir, entry.name + '.meta.json');
              try {
                const metaContent = await fs.readFile(metaPath, 'utf-8');
                records.push(JSON.parse(metaContent) as ArtifactRecord);
              } catch {
                // No sidecar; build a minimal record from the file itself
                const stat = await fs.stat(path.join(dir, entry.name));
                records.push({
                  name: entry.name,
                  instanceId,
                  stateName,
                  size: stat.size,
                  createdAt: stat.birthtime.toISOString(),
                });
              }
            }

            return records;
          } catch (e) {
            const err = e as NodeJS.ErrnoException;
            // Directory doesn't exist yet → no artifacts
            if (err.code === 'ENOENT') return [];
            throw e;
          }
        },
        catch: (cause) => mkStoreError({ operation: 'list', cause }),
      });
    },

    readChild(childInstanceId, name) {
      return Effect.gen(function* () {
        yield* assertDescendant(childInstanceId);

        validateFilename(name);
        const cDir = yield* resolveDescendantDir(childInstanceId);
        const filePath = safeResolve(cDir, name);

        return yield* Effect.tryPromise({
          try: async () => {
            const buffer = await fs.readFile(filePath);
            return new Uint8Array(buffer);
          },
          catch: (cause) => {
            const err = cause as NodeJS.ErrnoException | null;
            if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
              return mkStoreError({
                operation: 'readChild',
                cause: `Artifact '${name}' not found for child instance '${childInstanceId}'`,
              });
            }
            return mkStoreError({ operation: 'readChild', cause });
          },
        });
      }) as Effect.Effect<Uint8Array, import('../types.js').StoreError>;
    },

    listChild(childInstanceId) {
      return Effect.gen(function* () {
        yield* assertDescendant(childInstanceId);

        const cDir = yield* resolveDescendantDir(childInstanceId);
        return yield* Effect.tryPromise({
          try: async () => {
            try {
              const entries = await fs.readdir(cDir, { withFileTypes: true });
              const records: ArtifactRecord[] = [];

              for (const entry of entries) {
                if (entry.isDirectory() || entry.name.endsWith('.meta.json')) continue;

                const metaPath = path.join(cDir, entry.name + '.meta.json');
                try {
                  const metaContent = await fs.readFile(metaPath, 'utf-8');
                  records.push(JSON.parse(metaContent) as ArtifactRecord);
                } catch {
                  const stat = await fs.stat(path.join(cDir, entry.name));
                  records.push({
                    name: entry.name,
                    instanceId: childInstanceId,
                    stateName: '',
                    size: stat.size,
                    createdAt: stat.birthtime.toISOString(),
                  });
                }
              }

              return records;
            } catch (e) {
              const err = e as NodeJS.ErrnoException;
              if (err.code === 'ENOENT') return [];
              throw e;
            }
          },
          catch: (cause) => mkStoreError({ operation: 'listChild', cause }),
        });
      });
    },

    resolvePath(name) {
      return Effect.try({
        try: () => {
          validateFilename(name);
          return safeResolve(dir, name);
        },
        catch: (cause) => mkStoreError({ operation: 'resolvePath', cause }),
      });
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Layer
// ────────────────────────────────────────────────────────────────────────────

/**
 * Layer that provides a filesystem-backed `ArtifactStoreFactory`.
 * Requires `MachineStore` in the environment for descendant validation.
 */
export const FsArtifactStoreLive: Layer.Layer<ArtifactStoreFactory, never, MachineStore> =
  Layer.effect(
    ArtifactStoreFactoryTag,
    Effect.gen(function* () {
      const store = yield* MachineStoreTag;
      return {
        makeScoped(id: string, state: string, parentId?: string) {
          return makeScopedArtifactStore(id, state, parentId, store);
        },
      };
    }),
  );
