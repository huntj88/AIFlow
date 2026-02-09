/**
 * ArtifactStore — Unit Tests (Task 08)
 *
 * Tests for the filesystem-backed `ArtifactStore` implementation, security
 * (path traversal), child/descendant validation, and the `ArtifactTreeBuilder`.
 *
 * @module
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import { Effect, Layer } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { MachineInstance } from '../types.js';
import { MachineStore as MachineStoreTag } from '../store/MachineStore.js';
import { InMemoryMachineStoreLive } from '../store/InMemoryMachineStore.js';
import { makeScopedArtifactStore } from './FsArtifactStore.js';
import { ArtifactStoreFactory as ArtifactStoreFactoryTag } from './ArtifactStoreFactory.js';
import { FsArtifactStoreLive } from './FsArtifactStore.js';
import { buildArtifactTree } from './ArtifactTreeBuilder.js';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

let tmpDir: string;

/** Create a unique temp directory for each test. */
beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aiflow-artifacts-'));
  // eslint-disable-next-line @typescript-eslint/dot-notation
  process.env['ARTIFACT_ROOT'] = tmpDir;
});

/** Clean up the temp directory after each test. */
afterEach(async () => {
  // eslint-disable-next-line @typescript-eslint/dot-notation
  delete process.env['ARTIFACT_ROOT'];
  await fs.rm(tmpDir, { recursive: true, force: true });
});

/** Get a MachineStore from the in-memory layer. */
function getStore() {
  return Effect.runSync(Effect.provide(MachineStoreTag, InMemoryMachineStoreLive));
}

/** Minimal valid instance input. */
function instanceInput(
  overrides?: Partial<Omit<MachineInstance, 'id' | 'createdAt' | 'updatedAt'>>,
): Omit<MachineInstance, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    definitionId: 'def-001',
    definitionVersion: 1,
    status: 'running',
    currentState: 'start',
    stateData: {},
    input: {},
    history: [],
    logs: [],
    artifacts: [],
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Write & Read
// ────────────────────────────────────────────────────────────────────────────

describe('FsArtifactStore — Write & Read', () => {
  it('writes and reads a file', async () => {
    const store = getStore();
    const artifactStore = makeScopedArtifactStore('inst-001', 'process', undefined, store);

    const content = new TextEncoder().encode('hello world');
    const record = await Effect.runPromise(artifactStore.write('report.txt', content));

    expect(record.name).toBe('report.txt');
    expect(record.instanceId).toBe('inst-001');
    expect(record.stateName).toBe('process');
    expect(record.size).toBe(content.byteLength);
    expect(record.createdAt).toBeTruthy();

    const read = await Effect.runPromise(artifactStore.read('report.txt'));
    expect(new TextDecoder().decode(read)).toBe('hello world');
  });

  it('ArtifactRecord has correct fields', async () => {
    const store = getStore();
    const artifactStore = makeScopedArtifactStore('inst-002', 'generate', undefined, store);

    const content = new Uint8Array([1, 2, 3, 4, 5]);
    const metadata = { description: 'test artifact', tags: ['test'] };
    const record = await Effect.runPromise(artifactStore.write('data.bin', content, metadata));

    expect(record.name).toBe('data.bin');
    expect(record.instanceId).toBe('inst-002');
    expect(record.stateName).toBe('generate');
    expect(record.size).toBe(5);
    expect(record.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(record.metadata).toEqual(metadata);
  });

  it('list returns all written artifacts', async () => {
    const store = getStore();
    const artifactStore = makeScopedArtifactStore('inst-003', 'upload', undefined, store);

    await Effect.runPromise(artifactStore.write('file1.txt', new TextEncoder().encode('one')));
    await Effect.runPromise(artifactStore.write('file2.txt', new TextEncoder().encode('two')));
    await Effect.runPromise(artifactStore.write('file3.txt', new TextEncoder().encode('three')));

    const list = await Effect.runPromise(artifactStore.list());
    const names = list.map((r) => r.name).sort();
    expect(names).toEqual(['file1.txt', 'file2.txt', 'file3.txt']);
  });

  it('read non-existent file → error', async () => {
    const store = getStore();
    const artifactStore = makeScopedArtifactStore('inst-004', 'process', undefined, store);

    const result = await Effect.runPromiseExit(artifactStore.read('nope.txt'));
    expect(result._tag).toBe('Failure');
  });

  it('list on empty instance returns empty array', async () => {
    const store = getStore();
    const artifactStore = makeScopedArtifactStore('inst-005', 'process', undefined, store);

    const list = await Effect.runPromise(artifactStore.list());
    expect(list).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Security — Path Traversal Prevention
// ────────────────────────────────────────────────────────────────────────────

describe('FsArtifactStore — Path Traversal Prevention', () => {
  it('rejects write with ../ in filename', async () => {
    const store = getStore();
    const artifactStore = makeScopedArtifactStore('inst-sec-1', 'process', undefined, store);

    const result = await Effect.runPromiseExit(
      artifactStore.write('../evil.txt', new TextEncoder().encode('bad')),
    );
    expect(result._tag).toBe('Failure');
  });

  it('rejects write with absolute path', async () => {
    const store = getStore();
    const artifactStore = makeScopedArtifactStore('inst-sec-2', 'process', undefined, store);

    const result = await Effect.runPromiseExit(
      artifactStore.write('/etc/passwd', new TextEncoder().encode('bad')),
    );
    expect(result._tag).toBe('Failure');
  });

  it('rejects write with backslash in filename', async () => {
    const store = getStore();
    const artifactStore = makeScopedArtifactStore('inst-sec-3', 'process', undefined, store);

    const result = await Effect.runPromiseExit(
      artifactStore.write('foo\\bar.txt', new TextEncoder().encode('bad')),
    );
    expect(result._tag).toBe('Failure');
  });

  it('rejects read with ../ in filename', async () => {
    const store = getStore();
    const artifactStore = makeScopedArtifactStore('inst-sec-4', 'process', undefined, store);

    const result = await Effect.runPromiseExit(artifactStore.read('../../secret'));
    expect(result._tag).toBe('Failure');
  });

  it('rejects resolvePath with ../ in filename', async () => {
    const store = getStore();
    const artifactStore = makeScopedArtifactStore('inst-sec-5', 'process', undefined, store);

    const result = await Effect.runPromiseExit(artifactStore.resolvePath('../escape'));
    expect(result._tag).toBe('Failure');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Directory Structure
// ────────────────────────────────────────────────────────────────────────────

describe('FsArtifactStore — Directory Structure', () => {
  it('parent artifacts at <ARTIFACT_ROOT>/<parentId>/', async () => {
    const store = getStore();
    const artifactStore = makeScopedArtifactStore('parent-001', 'process', undefined, store);

    await Effect.runPromise(artifactStore.write('report.txt', new TextEncoder().encode('data')));

    const filePath = path.join(tmpDir, 'parent-001', 'report.txt');
    const stat = await fs.stat(filePath);
    expect(stat.isFile()).toBe(true);
  });

  it('child artifacts at <ARTIFACT_ROOT>/<parentId>/children/<childId>/', async () => {
    const store = getStore();
    const artifactStore = makeScopedArtifactStore('child-001', 'process', 'parent-001', store);

    await Effect.runPromise(artifactStore.write('results.csv', new TextEncoder().encode('a,b,c')));

    const filePath = path.join(tmpDir, 'parent-001', 'children', 'child-001', 'results.csv');
    const stat = await fs.stat(filePath);
    expect(stat.isFile()).toBe(true);
  });

  it('resolvePath returns correct absolute path', async () => {
    const store = getStore();
    const artifactStore = makeScopedArtifactStore('inst-resolve', 'step1', undefined, store);

    const resolved = await Effect.runPromise(artifactStore.resolvePath('output.json'));
    expect(resolved).toBe(path.resolve(tmpDir, 'inst-resolve', 'output.json'));
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Child / Descendant Operations
// ────────────────────────────────────────────────────────────────────────────

describe('FsArtifactStore — readChild & listChild', () => {
  it('readChild with valid child → success', async () => {
    const store = getStore();

    // Create parent instance in the store
    const parent = await Effect.runPromise(
      store.saveInstance(instanceInput({ status: 'running' })),
    );

    // Create child instance in the store
    const child = await Effect.runPromise(
      store.saveInstance(instanceInput({ parentInstanceId: parent.id, status: 'completed' })),
    );

    // Write an artifact as the child
    const childArtifactStore = makeScopedArtifactStore(child.id, 'work', parent.id, store);
    await Effect.runPromise(
      childArtifactStore.write('child-output.txt', new TextEncoder().encode('child data')),
    );

    // Parent reads child's artifact
    const parentArtifactStore = makeScopedArtifactStore(parent.id, 'process', undefined, store);
    const data = await Effect.runPromise(
      parentArtifactStore.readChild(child.id, 'child-output.txt'),
    );
    expect(new TextDecoder().decode(data)).toBe('child data');
  });

  it('readChild with non-descendant ID → error', async () => {
    const store = getStore();

    // Create two unrelated instances
    const inst1 = await Effect.runPromise(store.saveInstance(instanceInput({ status: 'running' })));
    const inst2 = await Effect.runPromise(store.saveInstance(instanceInput({ status: 'running' })));

    const artifactStore = makeScopedArtifactStore(inst1.id, 'process', undefined, store);

    const result = await Effect.runPromiseExit(artifactStore.readChild(inst2.id, 'file.txt'));
    expect(result._tag).toBe('Failure');
  });

  it('listChild returns child artifacts', async () => {
    const store = getStore();

    const parent = await Effect.runPromise(
      store.saveInstance(instanceInput({ status: 'running' })),
    );
    const child = await Effect.runPromise(
      store.saveInstance(instanceInput({ parentInstanceId: parent.id, status: 'completed' })),
    );

    // Write artifacts as child
    const childArtifactStore = makeScopedArtifactStore(child.id, 'work', parent.id, store);
    await Effect.runPromise(childArtifactStore.write('a.txt', new TextEncoder().encode('aaa')));
    await Effect.runPromise(childArtifactStore.write('b.txt', new TextEncoder().encode('bbb')));

    // Parent lists child artifacts
    const parentArtifactStore = makeScopedArtifactStore(parent.id, 'process', undefined, store);
    const list = await Effect.runPromise(parentArtifactStore.listChild(child.id));
    const names = list.map((r) => r.name).sort();
    expect(names).toEqual(['a.txt', 'b.txt']);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Grandchild Nesting
// ────────────────────────────────────────────────────────────────────────────

describe('FsArtifactStore — Grandchild Nesting', () => {
  it('grandchild nesting works correctly', async () => {
    const store = getStore();

    const parent = await Effect.runPromise(
      store.saveInstance(instanceInput({ status: 'running' })),
    );
    const child = await Effect.runPromise(
      store.saveInstance(instanceInput({ parentInstanceId: parent.id, status: 'running' })),
    );
    const grandchild = await Effect.runPromise(
      store.saveInstance(instanceInput({ parentInstanceId: child.id, status: 'completed' })),
    );

    // Write artifact as grandchild (grandchild's parent is child)
    const grandchildStore = makeScopedArtifactStore(grandchild.id, 'deep-work', child.id, store);
    await Effect.runPromise(
      grandchildStore.write('deep.txt', new TextEncoder().encode('deep data')),
    );

    // Child can read grandchild's artifact
    const childStore = makeScopedArtifactStore(child.id, 'work', parent.id, store);
    const data = await Effect.runPromise(childStore.readChild(grandchild.id, 'deep.txt'));
    expect(new TextDecoder().decode(data)).toBe('deep data');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// ArtifactStoreFactory Layer
// ────────────────────────────────────────────────────────────────────────────

describe('FsArtifactStoreLive — Layer', () => {
  it('provides ArtifactStoreFactory via layer', async () => {
    const layer = FsArtifactStoreLive.pipe(Layer.provide(InMemoryMachineStoreLive));

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const factory = yield* ArtifactStoreFactoryTag;
        const artifactStore = factory.makeScoped('layer-inst', 'step1');

        yield* artifactStore.write('test.txt', new TextEncoder().encode('via layer'));
        const data = yield* artifactStore.read('test.txt');
        return new TextDecoder().decode(data);
      }).pipe(Effect.provide(layer)),
    );

    expect(result).toBe('via layer');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// ArtifactTreeBuilder
// ────────────────────────────────────────────────────────────────────────────

describe('ArtifactTreeBuilder', () => {
  it('builds correct recursive tree', async () => {
    const store = getStore();

    // Create instances with artifacts
    const parent = await Effect.runPromise(
      store.saveInstance(
        instanceInput({
          status: 'completed',
          artifacts: [
            {
              name: 'parent-file.txt',
              instanceId: 'will-be-overwritten',
              stateName: 'start',
              size: 10,
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        }),
      ),
    );

    const child1 = await Effect.runPromise(
      store.saveInstance(
        instanceInput({
          parentInstanceId: parent.id,
          status: 'completed',
          artifacts: [
            {
              name: 'child1-file.txt',
              instanceId: 'will-be-overwritten',
              stateName: 'work',
              size: 20,
              createdAt: '2026-01-01T00:00:01.000Z',
            },
          ],
        }),
      ),
    );

    const child2 = await Effect.runPromise(
      store.saveInstance(
        instanceInput({
          parentInstanceId: parent.id,
          status: 'completed',
          artifacts: [],
        }),
      ),
    );

    const grandchild = await Effect.runPromise(
      store.saveInstance(
        instanceInput({
          parentInstanceId: child1.id,
          status: 'completed',
          artifacts: [
            {
              name: 'gc-file.txt',
              instanceId: 'will-be-overwritten',
              stateName: 'deep',
              size: 5,
              createdAt: '2026-01-01T00:00:02.000Z',
            },
          ],
        }),
      ),
    );

    const tree = await Effect.runPromise(buildArtifactTree(parent.id, store));

    // Root
    expect(tree.instanceId).toBe(parent.id);
    expect(tree.artifacts).toHaveLength(1);
    expect(tree.artifacts[0].name).toBe('parent-file.txt');

    // Children
    expect(tree.children).toHaveLength(2);

    const c1 = tree.children.find((c) => c.instanceId === child1.id);
    const c2 = tree.children.find((c) => c.instanceId === child2.id);

    if (!c1 || !c2) throw new Error('Expected both children to be present');

    expect(c1.artifacts).toHaveLength(1);
    expect(c1.artifacts[0].name).toBe('child1-file.txt');

    expect(c2.artifacts).toEqual([]);

    // Grandchild
    expect(c1.children).toHaveLength(1);
    expect(c1.children[0].instanceId).toBe(grandchild.id);
    expect(c1.children[0].artifacts).toHaveLength(1);
    expect(c1.children[0].artifacts[0].name).toBe('gc-file.txt');

    // No further nesting
    expect(c1.children[0].children).toEqual([]);
    expect(c2.children).toEqual([]);

    // Keep linter happy
    void child2;
    void grandchild;
  });

  it('returns error for non-existent instance', async () => {
    const store = getStore();

    const result = await Effect.runPromiseExit(buildArtifactTree('nonexistent-id', store));
    expect(result._tag).toBe('Failure');
  });
});
