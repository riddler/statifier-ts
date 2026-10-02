### Changed

- The validator's two generic error types are renamed for their stage: `ErrorOf` is now `ValidationErrorOf`, beside the lowering stage's `LoweringErrorOf`, and `Empty`, the detail of a validation reason that carries none, is now `ValidationNoDetail`; a host that names either uses the new name.
