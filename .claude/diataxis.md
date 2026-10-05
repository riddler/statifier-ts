---
# The docs manifest the documentation tools read. Generated from the family's manifest
# table: change a key there and regenerate. The two prose lines below may be sharpened.
product: "@riddler/statifier"
family: statifier
audience: "TypeScript developers running charts in a browser, Node or React Native"
tone: "plain, second person, no marketing"
terminology:
  use:
    - execution
    - chart
    - document
    - revision
  avoid:
    - "run (noun)"
    - workflow instance
example_world: library-loan
docs_root: docs
quadrants:
  tutorials: docs/tutorials
  how_to: docs/guides
  reference: docs/reference
  explanation: docs/explanation
readme: README.md
reference_generator: typedoc
publish: site-later
contributor_paths:
  - docs/adr
  - docs/plans
  - docs/spikes
  - docs/research
  - docs/design
  - docs/measurements
  - CLAUDE.md
executed_snippets:
  - test/readme.test.ts
readme_max_lines: 700
---

The statechart interpreter core in TypeScript, corpus-identical to the Elixir engine.
Examples are written in the library loan: a copy of a book lent to a patron, due, renewed, returned or lost.
