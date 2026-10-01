### Added

- The driver runs an `<invoke>` of the SCXML type in process: it compiles the content markup (a root that declares no namespace is read as SCXML), starts it as a child session on the parent's virtual clock with its datamodel seeded from the params its root `<data>` names, and returns `done.invoke.<id>` with the child's donedata when the child stops; leaving the invoking state stops the child.
- The driver state carries each live invocation with its child's own state nested in it (`invokedAs`, `invocations` and `mailbox`), so a state with a running child goes through JSON and steps as the original does; a position does not carry the child.
- Every w3c case that needs `<invoke>` is now claimed.

### Changed

- A send to `#_parent` from an invoked child, and a send to `#_<invokeid>` naming a live invocation, now deliver as external events instead of answering `error.communication`; an event a child sent and its parent had not taken is discarded once the invocation is cancelled.
- An `<invoke>` of a type other than SCXML raises `error.execution`, and one whose content is absent or does not compile raises `error.communication`, keeping its id live with no child.
