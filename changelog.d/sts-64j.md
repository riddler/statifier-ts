### Added

- The entry point exports by name the types the public event and effect types reference: `Cause`, `Origin`, `Owner`, `EventType`, `ExecutionReason`, `BudgetExhausted`, `InvokeEffect`, `ExitEntryEffect`, `Effect`, `Log`, `CancelInvoke` and `BindingEffect`.

### Changed

- A registered send type's processor is called once the call's state is written, in the order the run made the calls, so a call refused as `unencodable_value` (a host event's data or a starting datamodel value that tagged-value text cannot carry, among others) calls no processor's `deliver` or `cancel`, and a host that retries it hands nothing twice.
