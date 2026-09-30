/**
 * Types for the corpus rules, separated from the loader so that a reader with
 * no filesystem can import them. `scripts/lib/corpus.d.mts` re-exports these.
 */

export type Surface = "evaluator" | "compiler";

export interface ManifestTier {
  readonly tier: number;
  readonly file: string;
  readonly name: string;
  readonly case_count: number;
  readonly opcodes: readonly string[];
}

export interface Manifest {
  readonly corpus_hash: string;
  readonly isa_version: number;
  readonly tiers: readonly ManifestTier[];
}

/**
 * One case's metadata, and the raw line it came from. The values a case
 * carries are not read here: a reader that needs them decodes `line` with the
 * corpus decoder, which is what keeps an integral float a float.
 */
export interface CaseMetadata {
  readonly id: string;
  readonly tier: number;
  readonly source: string | null;
  readonly features: readonly string[];
  readonly line: string;
}

export function throughTier<Item extends { readonly tier: number }>(
  items: readonly Item[],
  tier: number,
): Item[];
export function surfaceCaseSet(cases: readonly CaseMetadata[], surface: Surface): CaseMetadata[];
export function runsAtVersion(item: CaseMetadata, claimed: number, corpusVersion: number): boolean;
export function runnableCases(
  cases: readonly CaseMetadata[],
  surface: Surface,
  claimed: number,
  corpusVersion: number,
): CaseMetadata[];
