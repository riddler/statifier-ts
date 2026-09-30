// Records, in the conformance registry, the corpus cases a run observed to
// pass.
//
//   node scripts/ratchet.mjs
//
// Not yet: the conformance apparatus writes this. Until it lands this refuses,
// so nothing mistakes a no-op for a ratchet.

console.error("ratchet: not yet - no corpus apparatus exists in this repository");
process.exitCode = 1;
