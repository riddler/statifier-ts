### Changed

- An empty namespace declaration (`xmlns=""` or `xmlns:p=""`) binds the empty string instead of undeclaring, so an SCXML element under one is refused as `foreign_element`, as the reference does.

### Fixed

- A document type declaration whose internal subset holds a quote inside a comment or a processing instruction parses instead of being refused as `unterminated_doctype`.
- A document type declaration whose internal subset holds a `]` inside a comment or a processing instruction parses instead of being refused as `content_before_root`.
- A lone surrogate in text, an attribute value or a CDATA section is refused as `invalid_character`, as its character reference already was.
- An `&` whose would-be reference runs past a quote is refused as `malformed_reference` instead of `unknown_entity`.
