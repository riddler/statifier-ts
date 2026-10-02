### Added

- The entry point exports by name every type a compile error reaches, as types only: `ParseError`, `ParseErrorReason`, `Location`, `LoweringError`, `LoweringErrorOf`, `ValidationError`, `ErrorOf`, `Empty`, `DefaultTransitionOwner`, `StateKind`, `CompilerError` and `ExpressionOwner`, so a host can name the member of `CompileError` it narrows to.
