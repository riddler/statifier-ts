### Changed

- A `<script>` body, top-level or in-line, compiles as a statement program and runs, where every script raised `error.execution` when it ran; a body that does not compile still loads and raises `error.execution` when it runs, naming why.
- The scion claim now covers every case of the scion suite, the three cases a `<script>` body decides included; a consumer relying on the claim should expect charts whose scripts write the datamodel to behave as the corpus says.
