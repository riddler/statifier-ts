// The corpus rules themselves: which cases a reader takes, given cases.
//
// These are the three rules `scripts/lib/corpus.mjs` describes, separated from
// the loading that reads them off disk. The separation is not taste. A reader
// that has the cases already - one running inside a host with no filesystem,
// given the corpus as data - needs the rules and cannot have the loader, and a
// module that holds both hands it `node:fs` through the import graph whether it
// calls the loader or not. So the rules live in this file, which reaches
// nothing outside the language, and the loader imports them like every other
// reader. `scripts/lib/corpus.mjs` re-exports all three, so a reader that wants
// the loader and the rules together still asks one module for both.
//
// THE RULES. Tiers are cumulative: tier N means tiers 1 through N, of the case
// files the manifest lists and of the cases they hold alike, so a reader
// narrowing a loaded case set to a claimed tier asks the same question the
// loader asks of the manifest. A surface's case set is every case for the
// evaluator, and the source-bearing cases for the compiler - a null-source
// case is absent from the compiler's set, not skipped by it. And a run
// claiming the corpus's own instruction-set version does not attempt a case
// tagged `retired`, while a run claiming an earlier version does; either way
// the case stays a member of the evaluator surface's case set, because the
// filter scopes a run and not the registry.

/**
 * The members of `items` in tiers 1 through `tier`.
 *
 * The cumulative rule, in the one form both things that need it can use: the
 * loader asks it of the manifest's tier files, and a reader narrowing an
 * already-loaded case set to a claimed tier asks it of the cases. `items` is
 * anything carrying a tier, because the rule is about the number and not about
 * what carries it.
 *
 * Sabotage: narrowing this to a strict comparison turns the suite red on both
 * readers at once - the ratchet check and the registry check each fail, which
 * is what says neither of them still decides the cumulative rule for itself.
 * It was run and reverted.
 */
export function throughTier(items, tier) {
  return items.filter((item) => item.tier <= tier);
}

/** Every case for the evaluator; the source-bearing cases for the compiler. */
export function surfaceCaseSet(cases, surface) {
  return surface === "compiler" ? cases.filter((item) => item.source !== null) : [...cases];
}

/**
 * Whether a run claiming `claimed` attempts this case.
 *
 * A `retired` tag marks a case whose opcodes were retired at or below the
 * corpus's own version. A runner claiming that version filters it out; a
 * runner claiming an earlier one - before the opcode was removed - runs it
 * normally, and that is what makes an earlier claim verifiable at all.
 *
 * Sabotage: replacing this with an unconditional yes turns the suite red on
 * both halves of that rule at once - a run then reports cases it cannot run,
 * and a claim then wants entries no run can produce. It was run and reverted.
 */
export function runsAtVersion(item, claimed, corpusVersion) {
  return !(item.features.includes("retired") && claimed >= corpusVersion);
}

/** The cases a run of this surface at this claimed version attempts. */
export function runnableCases(cases, surface, claimed, corpusVersion) {
  return surfaceCaseSet(cases, surface).filter((item) =>
    runsAtVersion(item, claimed, corpusVersion),
  );
}
