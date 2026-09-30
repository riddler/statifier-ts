// Vendors the reference's conformance corpus into this repository.
//
//   node scripts/corpus-refresh.mjs
//
// Not yet: the conformance apparatus writes this. Until it lands this refuses,
// so nothing mistakes a no-op for a refresh.

console.error("corpus:refresh: not yet - no corpus apparatus exists in this repository");
process.exitCode = 1;
