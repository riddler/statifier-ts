/**
 * Types for the publish guard's checks of a build's output, so a test runs
 * the same implementation the guard runs.
 */

export interface PublishCheck {
  readonly label: string;
  readonly ok: boolean;
}

export function packedFiles(root: string): Set<string> | string;
export function checkBuildOutput(
  root: string,
  outDir?: string,
): { checks: PublishCheck[]; stop: string | null };
