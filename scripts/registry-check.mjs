// The registry check: a gate stage that will hold the conformance registry -
// which corpus cases this package claims to pass - to the rules a claim obeys.
//
//   node scripts/registry-check.mjs
//
// No registry exists yet, because no corpus is vendored and nothing is
// claimed, so the stage says so and passes. The conformance apparatus replaces
// this file with the real check; until then a green here means only that there
// is no registry.

console.log("registry: no registry yet");
