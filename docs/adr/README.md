# Architecture Decision Records

| # | Decision | Status |
|---|---|---|
| [0001](0001-a-conformant-sibling.md) | A conformant sibling of the Elixir engine, not a second reference implementation | proposed |
| [0003](0003-the-conformance-apparatus.md) | The conformance apparatus | proposed |

New ADRs: next number, same three-section format (Context, Decision,
Consequences). A record that states a public signature adds a Typespecs
section, and a record that states one or defines the shape of a JSON document
adds a Worked example section showing it; a record that does neither, such as
a charter, adds neither. Pick the number against a freshly fetched remote.

This repository inherits the family's ADR practice rather than restating it,
so there is no local "record architecture decisions" record. A bare
`ADR-NNNN` cites this repository's own records; a cross-repo citation carries
the owning repo's beads prefix - `sts-ADR-0001` is how another repo cites this
repository's ADR-0001, `st-ADR-0001` is statifier-ex's and `pts-ADR-0001` is
predicator-ts's. Records in sibling repos that are still being drafted are
cited by bead id until their number is assigned.

A record cites code by anchor - a file and the function, type or heading it
names - together with the commit it was read at, never by line number alone,
because a line number moves with every edit above it and an anchor does not.

A change to a record adds lines and removes none. The measure is the change's
diff against the point where it left the default branch -
`git diff origin/main...HEAD` over a record shows no removed line - so an
amendment or a note is an insertion, and a line that has merged is not rewritten
by a later change. Two removals are consistent with this. The first is a
change's own text: because the measure is the change as a whole, a change may
reword or rewrap lines it added itself before it merges. The second is an
acceptance: moving a record from proposed to accepted replaces each Status line
it moves, and may amend a sentence that the move itself makes false, such as one
stating that the record stays at proposed, rewrapping the paragraph that
sentence sits in; it changes nothing else. This covers the numbered records; the
index at the top of this file is not a record.
