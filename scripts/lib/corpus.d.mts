/**
 * Types for the loader that reads the vendored corpus, the provenance record
 * and the registries off disk. The rules' own types are
 * `scripts/lib/corpus-rules.d.mts` and are re-exported here, which is what lets
 * a reader ask one module for both.
 */

export * from "./corpus-rules.d.mts";

import type { CorpusSuite, Manifest, Registry } from "./corpus-rules.d.mts";

export interface Provenance {
  readonly repo: string;
  readonly tag: string;
  readonly sha: string;
  readonly corpus_hash: string;
}

export const REFERENCE_REPO: string;
export const CONFORMANCE_ROOT: string;
export const VENDORED_DIR: string;
export const PROVENANCE_FILE: string;
export const REGISTRY_FILE: string;

export function loadManifest(root?: string): Manifest;
export function loadProvenance(root?: string): Provenance;
export function loadRegistry(root?: string): Registry;
export function readRegistryText(root?: string): string;
export function loadReferenceRegistry(root?: string): Registry;
export function loadSuites(root?: string, manifest?: Manifest): CorpusSuite[];
export function computeCorpusHash(root?: string): string | null;
