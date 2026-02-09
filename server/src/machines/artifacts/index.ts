/**
 * Artifacts module barrel export (Task 08)
 *
 * Re-exports the factory service, filesystem implementation, and tree builder.
 *
 * @module
 */

export { ArtifactStoreFactory } from './ArtifactStoreFactory.js';
export type { ArtifactStoreFactory as ArtifactStoreFactoryInterface } from './ArtifactStoreFactory.js';

export { FsArtifactStoreLive, makeScopedArtifactStore } from './FsArtifactStore.js';

export { buildArtifactTree } from './ArtifactTreeBuilder.js';
