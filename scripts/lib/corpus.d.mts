/**
 * Types for the shared corpus rules and the loading that reads the vendored
 * copy off disk, so that the runner and the registry check read the corpus
 * through the same implementation the ratchet script writes against.
 *
 * The rules' own types are `scripts/lib/corpus-rules.d.mts` and are re-exported
 * here, which is what lets a reader ask one module for both.
 */

export type {
  CaseMetadata,
  Manifest,
  ManifestTier,
  Surface,
} from "./corpus-rules.d.mts";
export { runnableCases, runsAtVersion, surfaceCaseSet, throughTier } from "./corpus-rules.d.mts";

import type { CaseMetadata, Manifest } from "./corpus-rules.d.mts";

export function loadManifest(): Manifest;
export function loadCases(tier: number, manifest?: Manifest): CaseMetadata[];
