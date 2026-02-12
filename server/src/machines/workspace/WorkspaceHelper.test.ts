/**
 * WorkspaceHelper — Unit Tests (Task 04)
 *
 * Tests for `makeWorkspaceContext`, `makeArtifactsWorkspaceContext`,
 * `computeArtifactsPath`, and `ensureArtifactsDir`.
 *
 * @module
 */

import { Effect } from 'effect';
import { describe, expect, it, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  makeWorkspaceContext,
  makeArtifactsWorkspaceContext,
  computeArtifactsPath,
  ensureArtifactsDir,
} from './WorkspaceHelper.js';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-helper-test-'));
});

function run<A>(effect: Effect.Effect<A>): Promise<A> {
  return Effect.runPromise(effect);
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe('makeWorkspaceContext', () => {
  it('returns the provided absolute path as root', () => {
    const ws = makeWorkspaceContext('/home/user/project');
    expect(ws.root).toBe('/home/user/project');
  });

  it('resolve returns absolute path for a simple filename', () => {
    const ws = makeWorkspaceContext('/home/user/project');
    expect(ws.resolve('file.txt')).toBe('/home/user/project/file.txt');
  });

  it('resolve returns absolute path for nested relative path', () => {
    const ws = makeWorkspaceContext('/home/user/project');
    expect(ws.resolve('sub/dir/file.txt')).toBe('/home/user/project/sub/dir/file.txt');
  });

  it('resolve allows path traversal outside root (no enforcement)', () => {
    const ws = makeWorkspaceContext('/home/user/project');
    const resolved = ws.resolve('../escape');
    expect(resolved).toBe('/home/user/escape');
  });
});

describe('makeArtifactsWorkspaceContext', () => {
  it('returns root as <artifactRoot>/<familyRootInstanceId>', () => {
    const aws = makeArtifactsWorkspaceContext('/data/artifacts', 'inst-root-001');
    expect(aws.root).toBe('/data/artifacts/inst-root-001');
  });

  it('resolve returns absolute path for a simple filename', () => {
    const aws = makeArtifactsWorkspaceContext('/data/artifacts', 'inst-root-001');
    expect(aws.resolve('report.json')).toBe('/data/artifacts/inst-root-001/report.json');
  });

  it('resolve returns absolute path for nested relative path', () => {
    const aws = makeArtifactsWorkspaceContext('/data/artifacts', 'inst-root-001');
    expect(aws.resolve('children/child-123/file.json')).toBe(
      '/data/artifacts/inst-root-001/children/child-123/file.json',
    );
  });

  it('same familyRootInstanceId produces same root for parent and child', () => {
    const parentAws = makeArtifactsWorkspaceContext('/data/artifacts', 'inst-root-001');
    const childAws = makeArtifactsWorkspaceContext('/data/artifacts', 'inst-root-001');
    expect(parentAws.root).toBe(childAws.root);
  });
});

describe('computeArtifactsPath', () => {
  it('returns the family root path', () => {
    const result = computeArtifactsPath('/data/artifacts', 'inst-root-001');
    expect(result).toBe('/data/artifacts/inst-root-001');
  });

  it('handles relative artifactRoot by resolving against cwd', () => {
    const result = computeArtifactsPath('./data/artifacts', 'inst-root-002');
    expect(result).toBe(path.resolve('./data/artifacts', 'inst-root-002'));
  });
});

describe('ensureArtifactsDir', () => {
  it('creates the directory on disk', async () => {
    const dirPath = path.join(tmpDir, 'artifacts', 'inst-001');
    expect(fs.existsSync(dirPath)).toBe(false);

    await run(ensureArtifactsDir(dirPath));

    expect(fs.existsSync(dirPath)).toBe(true);
    expect(fs.statSync(dirPath).isDirectory()).toBe(true);
  });

  it('creates nested directories recursively', async () => {
    const dirPath = path.join(tmpDir, 'deep', 'nested', 'artifacts', 'inst-002');
    expect(fs.existsSync(dirPath)).toBe(false);

    await run(ensureArtifactsDir(dirPath));

    expect(fs.existsSync(dirPath)).toBe(true);
  });

  it('is idempotent — second call succeeds without error', async () => {
    const dirPath = path.join(tmpDir, 'artifacts', 'inst-003');

    await run(ensureArtifactsDir(dirPath));
    expect(fs.existsSync(dirPath)).toBe(true);

    // Second call should not throw
    await run(ensureArtifactsDir(dirPath));
    expect(fs.existsSync(dirPath)).toBe(true);
  });
});
