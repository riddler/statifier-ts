// The corpus check: a gate stage that will hold the vendored conformance
// corpus to the provenance recorded beside it.
//
//   node scripts/corpus-check.mjs
//
// No corpus is vendored yet, so there is nothing to hold to anything, and the
// stage says so and passes. The conformance apparatus replaces this file with
// the real check; until then a green here means only that there is no corpus.

console.log("corpus:check: no corpus vendored yet");
