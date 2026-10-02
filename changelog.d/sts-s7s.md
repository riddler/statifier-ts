### Fixed

- A driver state whose child's `invokedAs` is not its invocation's `invokeId`, whose host session's `invokedAs` is not null, or that carries two invocation records with one `invokeId` is refused as `malformed_state` with a `bad_shape` detail naming the field (`invocations[0].state.invokedAs`, `invokedAs`, `invocations[1].invokeId`), where it decoded into a child that could not reach its parent or silently dropped one of the two records.
