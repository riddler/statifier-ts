### Changed

- A failure a processor's `deliver` answers is raised at the send's place in the run that handed it, ahead of the events that run has yet to take from its external queue, as the reference raises it; before, it was raised only after that run had taken them, so a send with no target through the Basic HTTP processor was taken after an event the same block sent the session itself. Each send is still handed to its processor once, and only once the call's state is written.
