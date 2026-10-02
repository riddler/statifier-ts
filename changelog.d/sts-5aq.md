### Changed

- An empty namespace declaration (`xmlns=""` or `xmlns:p=""`) binds the empty string instead of undeclaring, so an SCXML element under one is refused as `foreign_element`, as the reference does.

### Fixed

- A document type declaration that holds an unpaired quote anywhere in its internal subset, inside a comment or a processing instruction included, or elsewhere in the declaration, parses instead of being refused as `unterminated_doctype` where the reference accepts it, unless a `>` that ends a comment, a processing instruction or a markup declaration inside it comes after a `]` that has closed every `[` before it; a document refused after such a declaration now reports what follows the declaration.
- A lone surrogate in text, an attribute value or a CDATA section is refused as `invalid_character`, as its character reference already was.
- An `&` whose would-be reference runs past a quote is refused as `malformed_reference` instead of `unknown_entity`.
