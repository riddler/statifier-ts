/**
 * Types for the corpus rules, separated from the loader so that a reader with
 * no filesystem can import them. `scripts/lib/corpus.d.mts` re-exports these.
 */

export type SuiteName = "scion" | "w3c" | "statifier";
export type ClaimName = "scion" | "statifier" | "w3c-mandatory" | "w3c-optional";

/**
 * One step of a case: the event sent, the active leaf ids expected after it,
 * and, on a statifier case only, the exported position expected once those
 * agree.
 */
export interface CorpusStep {
  readonly event: { readonly name: string; readonly data?: unknown };
  readonly configuration: readonly string[];
  readonly expect_position?: unknown;
}

/** One corpus case, in the shape the reference's `schema/case.json` defines. */
export interface CorpusCase {
  readonly id: string;
  readonly suite: SuiteName;
  readonly spec: string;
  readonly conformance: "mandatory" | "optional" | null;
  readonly description: string;
  readonly required_features: readonly string[];
  readonly source: string;
  readonly initial_configuration: readonly string[];
  readonly steps: readonly CorpusStep[];
  readonly upstream?: Readonly<Record<string, string>>;
  readonly host?: Readonly<Record<string, unknown>>;
}

/** One suite of the corpus, as the loader reads it. */
export interface CorpusSuite {
  readonly suite: SuiteName;
  readonly file: string;
  readonly cases: readonly CorpusCase[];
}

export interface ManifestSuite {
  readonly suite: SuiteName;
  readonly file: string;
  readonly case_count: number;
}

export interface Manifest {
  readonly corpus_hash: string;
  readonly suites: readonly ManifestSuite[];
  readonly upstreams: readonly Readonly<Record<string, string>>[];
}

export interface RegistryEntry {
  readonly case_id: string;
  readonly suite: SuiteName;
}

export interface Registry {
  readonly implementation: string;
  readonly corpus_hash: string;
  readonly claims: readonly string[];
  readonly entries: readonly RegistryEntry[];
}

/** One case's result in a runner report: a pass, or a fail with its reason. */
export type CaseResult =
  | { readonly case_id: string; readonly suite: SuiteName; readonly result: "pass" }
  | {
      readonly case_id: string;
      readonly suite: SuiteName;
      readonly result: "fail";
      readonly reason: string;
    };

/** A runner report: one suite of one corpus, every case once, in corpus order. */
export interface SuiteReport {
  readonly implementation: string;
  readonly corpus_hash: string;
  readonly suite: SuiteName;
  readonly results: readonly CaseResult[];
}

export const SUITE_ORDER: readonly SuiteName[];
export const CLAIM_NAMES: readonly ClaimName[];
export const IMPLEMENTATION: "statifier-ts";

export function claimOf(testCase: CorpusCase): ClaimName | null;
export function compareEntries(left: RegistryEntry, right: RegistryEntry): number;
export function claimsOf(
  entries: readonly RegistryEntry[],
  casesById: ReadonlyMap<string, CorpusCase>,
): ClaimName[];
export function encodeRegistry(registry: Registry): string;
export function indexCases(suites: readonly CorpusSuite[]): Map<string, CorpusCase>;
export function hashFindings(
  computed: string | null,
  fields: readonly (readonly [string, string | null | undefined])[],
): string[];
export function registryFindings(input: {
  readonly registry: Registry;
  readonly manifestHash: string;
  readonly suites: readonly CorpusSuite[];
  readonly results: readonly CaseResult[];
}): { findings: string[]; claimMade: boolean };
export function reportFindings(
  report: SuiteReport,
  manifestHash: string,
  suites: readonly CorpusSuite[],
): string[];
export function ratchet(input: {
  readonly registry: Registry;
  readonly reports: readonly SuiteReport[];
  readonly manifestHash: string;
  readonly suites: readonly CorpusSuite[];
}):
  | { readonly refusals: string[]; readonly registry?: undefined; readonly added?: undefined }
  | { readonly refusals?: undefined; readonly registry: Registry; readonly added: RegistryEntry[] };
export function unclaimed(
  referenceRegistry: Registry,
  registry: Registry,
  suiteNames: readonly string[],
): RegistryEntry[];
