### Added

- `compile(source, options)` turns SCXML text into a Chart - the compiled Machine and the chart's identity, a SHA-256 of the source's UTF-8 bytes beside an optional name and version - or answers every error from the first stage that refused it.
- An expression that does not compile where the chart loads is a compile error naming the element, the attribute and where it was written.
