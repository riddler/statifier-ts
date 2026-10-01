### Added

- `exportPosition` writes a running chart's state as a plain JSON position in the reference's string-id vocabulary, and `importPosition` rebuilds a state over a compiled chart from one, refusing a malformed export or one naming states the chart does not hold; pending timers and the driver's other fields do not travel.
