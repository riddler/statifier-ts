// XML source in, a generic element tree out.
//
// The first arrow of the pipeline: this layer knows XML and nothing else. It
// produces an element tree with a source span on every node, and a later pass
// gives the names meaning. The reference implementation parses with a
// streaming XML library; this is a small hand-written tokenizer and tree
// builder over the subset of XML that SCXML documents use, walked one
// character at a time.
//
// What it does, beyond splitting the markup:
//
// - Attribute values are normalized per XML 1.0 section 3.3.3 (the
//   reference's st-ADR-0043): a literal TAB, LF or CR in the raw value becomes
//   a space, a literal CR LF pair becomes ONE space, a character reference
//   keeps its decoded character, and nothing is trimmed or collapsed.
// - Character data folds line breaks per XML 1.0 section 2.11 (the reference's
//   st-ADR-0045): a literal CR LF pair and a literal lone CR each become one LF,
//   inside CDATA too, while a CR decoded from `&#xD;` stays a CR. The fold
//   reads the raw source, so a CR followed by a comment is a lone CR.
// - The five predefined entities and decimal and hex character references
//   are expanded in text and attribute values.
// - Every element carries the namespace its name resolves to under the
//   declarations in scope, or null when none is: a document that declares no
//   `xmlns` parses exactly as its declared twin does, and markup inside a
//   `<content>` element inherits the default namespace of its ancestors, as
//   ordinary XML namespace rules say. Rejecting a missing declaration is a
//   later layer's job. An empty declaration (`xmlns=""`, `xmlns:p=""`) binds
//   the empty string, as the reference's namespace scope does, and never
//   undeclares.
//
// What it does not do: validate names against any vocabulary, drop duplicate
// attributes, drop whitespace-only text, or read a document type definition.
// Comments, processing instructions, the XML declaration and a document type
// declaration produce no nodes. Anything outside the root element is
// discarded.
//
// Malformed input is a value, never a throw: `parseXml` answers the failing
// arm with a reason token and the zero-width location where parsing stopped.
//
// Offsets are UTF-16 code unit indices into the source string, so
// `source.slice(location.startOffset, location.endOffset)` recovers the raw
// text a node came from. Lines and columns are 1-based; columns count code
// points, and only LF starts a new line.

/** A source span: 1-based line and column, 0-based offsets, exclusive end. */
export interface Location {
  readonly startLine: number;
  readonly startColumn: number;
  readonly startOffset: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly endOffset: number;
}

/**
 * One attribute. `location` covers `name="value"` with its quotes;
 * `valueLocation` covers only the raw text inside the quotes. `value` is the
 * normalized, entity-expanded text, so it need not match that raw text.
 */
export interface Attribute {
  readonly name: string;
  readonly value: string;
  readonly location: Location;
  readonly valueLocation: Location;
}

/**
 * An element. `name` is the qualified name as written, prefix included;
 * `namespace` is the URI that name resolves to (the empty string when an
 * empty declaration is in scope for it), or null when no declaration is in
 * scope for it. `location` runs from the `<` of the start tag to the
 * character after the `>` of the end tag (the tag itself when self-closing).
 */
export interface Element {
  readonly type: "element";
  readonly name: string;
  readonly namespace: string | null;
  readonly attributes: readonly Attribute[];
  readonly children: readonly Node[];
  readonly location: Location;
}

/**
 * A run of character data between two tags, coalesced across any comment,
 * processing instruction or CDATA section inside it. `location` covers the
 * raw run; `value` is expanded and folded.
 */
export interface Text {
  readonly type: "text";
  readonly value: string;
  readonly location: Location;
}

export type Node = Element | Text;

/** Why a document was refused. */
export type ParseErrorReason =
  | "missing_root"
  | "content_before_root"
  | "content_after_root"
  | "unexpected_end"
  | "expected_name"
  | "expected_equals"
  | "expected_quote"
  | "expected_whitespace"
  | "expected_tag_end"
  | "lt_in_attribute_value"
  | "mismatched_end_tag"
  | "unclosed_element"
  | "unterminated_comment"
  | "double_hyphen_in_comment"
  | "unterminated_cdata"
  | "unterminated_processing_instruction"
  | "misplaced_xml_declaration"
  | "unterminated_doctype"
  | "unknown_entity"
  | "malformed_reference"
  | "invalid_character_reference"
  | "invalid_character"
  | "cdata_end_in_text";

/** A refusal: the reason token, a message for a human, and where it stopped. */
export interface ParseError {
  readonly reason: ParseErrorReason;
  readonly message: string;
  readonly location: Location;
}

export type ParseResult =
  | { readonly ok: true; readonly root: Element }
  | { readonly ok: false; readonly error: ParseError };

/** A position in the source: the offset and the line and column it sits at. */
interface Mark {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

interface Scope {
  readonly defaultNamespace: string | null;
  readonly prefixes: ReadonlyMap<string, string>;
}

interface OpenElement {
  readonly name: string;
  readonly namespace: string | null;
  readonly attributes: Attribute[];
  readonly children: Node[];
  readonly start: Mark;
  readonly scope: Scope;
}

interface TextRun {
  readonly start: Mark;
  end: Mark;
  value: string;
}

interface Cursor {
  readonly source: string;
  offset: number;
  line: number;
  column: number;
}

const EMPTY_SCOPE: Scope = { defaultNamespace: null, prefixes: new Map() };

const PREDEFINED_ENTITIES: ReadonlyMap<string, string> = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
]);

const TAB = 0x09;
const LF = 0x0a;
const CR = 0x0d;
const SPACE = 0x20;

/**
 * Parses `source` into its root element, or answers why it cannot.
 *
 * Never throws: every refusal is the failing arm, with the location where
 * parsing stopped.
 */
export function parseXml(source: string): ParseResult {
  const cursor: Cursor = { source, offset: 0, line: 1, column: 1 };
  if (source.charCodeAt(0) === 0xfeff) advance(cursor);

  const prolog = skipMisc(cursor, true);
  if (prolog !== null) return fail(prolog);
  if (cursor.offset >= source.length)
    return fail(errorAt(cursor, "missing_root", "no root element"));
  if (!startsWith(cursor, "<") || isNameStartAt(cursor, 1) === false) {
    return fail(errorAt(cursor, "content_before_root", "character data before the root element"));
  }

  const built = parseRoot(cursor);
  if (!built.ok) return built;

  const epilogue = skipMisc(cursor, false);
  if (epilogue !== null) return fail(epilogue);
  if (cursor.offset < source.length) {
    return fail(errorAt(cursor, "content_after_root", "content after the root element"));
  }
  return built;
}

function fail(error: ParseError): ParseResult {
  return { ok: false, error };
}

// Skips whitespace, comments and processing instructions outside the root
// element; before it (`prolog`) also the XML declaration and one document
// type declaration. Stops at the first other character.
function skipMisc(cursor: Cursor, prolog: boolean): ParseError | null {
  let sawDoctype = false;
  for (;;) {
    skipWhitespace(cursor);
    if (startsWith(cursor, "<!--")) {
      const error = skipComment(cursor);
      if (error !== null) return error;
    } else if (startsWith(cursor, "<?")) {
      const error = skipProcessingInstruction(cursor);
      if (error !== null) return error;
    } else if (prolog && !sawDoctype && startsWith(cursor, "<!DOCTYPE")) {
      const error = skipDoctype(cursor);
      if (error !== null) return error;
      sawDoctype = true;
    } else {
      return null;
    }
  }
}

// The element tree, built with an explicit stack so nesting depth never
// touches the call stack.
function parseRoot(cursor: Cursor): ParseResult {
  const stack: OpenElement[] = [];
  let run: TextRun | null = null;

  const flush = (): void => {
    const parent = stack[stack.length - 1];
    if (run !== null && parent !== undefined) {
      parent.children.push({
        type: "text",
        value: run.value,
        location: span(run.start, run.end),
      });
    }
    run = null;
  };

  for (;;) {
    if (cursor.offset >= cursor.source.length) {
      const open = stack[stack.length - 1];
      const name = open === undefined ? "" : open.name;
      return fail(errorAt(cursor, "unclosed_element", `element <${name}> is never closed`));
    }

    if (startsWith(cursor, "<!--")) {
      const error = skipComment(cursor);
      if (error !== null) return fail(error);
    } else if (startsWith(cursor, "<![CDATA[")) {
      const start = mark(cursor);
      const cdata = readCdata(cursor);
      if (typeof cdata !== "string") return fail(cdata);
      if (run === null) run = { start, end: start, value: "" };
      run.value += cdata;
      run.end = mark(cursor);
    } else if (startsWith(cursor, "<?")) {
      const error = skipProcessingInstruction(cursor);
      if (error !== null) return fail(error);
    } else if (startsWith(cursor, "</")) {
      flush();
      const open = stack.pop();
      const closed = closeElement(cursor, open);
      if (!closed.ok) return closed;
      const parent = stack[stack.length - 1];
      if (parent === undefined) return closed;
      parent.children.push(closed.root);
    } else if (startsWith(cursor, "<")) {
      flush();
      const parentScope = stack[stack.length - 1]?.scope ?? EMPTY_SCOPE;
      const opened = openElement(cursor, parentScope);
      if ("reason" in opened) return fail(opened);
      if (opened.selfClosing) {
        const element = finish(opened.element, mark(cursor));
        const parent = stack[stack.length - 1];
        if (parent === undefined) return { ok: true, root: element };
        parent.children.push(element);
      } else {
        stack.push(opened.element);
      }
    } else {
      const start = mark(cursor);
      const text = readCharacterData(cursor);
      if (typeof text !== "string") return fail(text);
      if (run === null) run = { start, end: start, value: "" };
      run.value += text;
      run.end = mark(cursor);
    }
  }
}

function finish(open: OpenElement, end: Mark): Element {
  return {
    type: "element",
    name: open.name,
    namespace: open.namespace,
    attributes: open.attributes,
    children: open.children,
    location: span(open.start, end),
  };
}

// Reads `</name S? >` and closes `open` with it.
function closeElement(cursor: Cursor, open: OpenElement | undefined): ParseResult {
  const tagStart = mark(cursor);
  advanceBy(cursor, 2);
  const name = readName(cursor);
  if (typeof name !== "string") return fail(name);
  skipWhitespace(cursor);
  if (!startsWith(cursor, ">")) return fail(expectedTagEnd(cursor));
  advance(cursor);
  if (open === undefined || open.name !== name) {
    const expected = open === undefined ? "no open element" : `</${open.name}>`;
    return fail(
      errorAtMark(tagStart, "mismatched_end_tag", `end tag </${name}> where ${expected} was due`),
    );
  }
  return { ok: true, root: finish(open, mark(cursor)) };
}

function expectedTagEnd(cursor: Cursor): ParseError {
  if (cursor.offset >= cursor.source.length) return unexpectedEnd(cursor);
  return errorAt(cursor, "expected_tag_end", "expected '>' to end the tag");
}

// Reads a start tag: `<name (S attr)* S? (> | />)`.
function openElement(
  cursor: Cursor,
  parentScope: Scope,
): { element: OpenElement; selfClosing: boolean } | ParseError {
  const start = mark(cursor);
  advance(cursor);
  const name = readName(cursor);
  if (typeof name !== "string") return name;

  const attributes: Attribute[] = [];
  for (;;) {
    const sawWhitespace = skipWhitespace(cursor);
    if (startsWith(cursor, ">")) {
      advance(cursor);
      return { element: open(name, attributes, start, parentScope), selfClosing: false };
    }
    if (startsWith(cursor, "/>")) {
      advanceBy(cursor, 2);
      return { element: open(name, attributes, start, parentScope), selfClosing: true };
    }
    if (cursor.offset >= cursor.source.length) return unexpectedEnd(cursor);
    if (!sawWhitespace) {
      return errorAt(cursor, "expected_whitespace", "expected whitespace before an attribute");
    }
    const attribute = readAttribute(cursor);
    if ("reason" in attribute) return attribute;
    attributes.push(attribute);
  }
}

function open(name: string, attributes: Attribute[], start: Mark, parentScope: Scope): OpenElement {
  const scope = declare(parentScope, attributes);
  return {
    name,
    namespace: resolve(name, scope),
    attributes,
    children: [],
    start,
    scope,
  };
}

// Folds an element's own `xmlns` and `xmlns:prefix` attributes over the scope
// it inherited. A value binds as written, the empty string included: an
// empty `xmlns=""` or `xmlns:p=""` declares the empty URI and undeclares
// nothing, as the reference's namespace scope does, so the element is not
// read as SCXML vocabulary.
function declare(parent: Scope, attributes: readonly Attribute[]): Scope {
  let defaultNamespace = parent.defaultNamespace;
  let prefixes: Map<string, string> | null = null;
  for (const attribute of attributes) {
    if (attribute.name === "xmlns") {
      defaultNamespace = attribute.value;
    } else if (attribute.name.startsWith("xmlns:") && attribute.name.length > 6) {
      if (prefixes === null) prefixes = new Map(parent.prefixes);
      prefixes.set(attribute.name.slice(6), attribute.value);
    }
  }
  return { defaultNamespace, prefixes: prefixes ?? parent.prefixes };
}

function resolve(name: string, scope: Scope): string | null {
  const colon = name.indexOf(":");
  if (colon < 0) return scope.defaultNamespace;
  return scope.prefixes.get(name.slice(0, colon)) ?? null;
}

// Reads `name S? = S? quoted-value`, normalizing the value per XML 1.0 3.3.3.
function readAttribute(cursor: Cursor): Attribute | ParseError {
  const start = mark(cursor);
  const name = readName(cursor);
  if (typeof name !== "string") return name;
  skipWhitespace(cursor);
  if (!startsWith(cursor, "=")) {
    if (cursor.offset >= cursor.source.length) return unexpectedEnd(cursor);
    return errorAt(cursor, "expected_equals", `expected '=' after attribute ${name}`);
  }
  advance(cursor);
  skipWhitespace(cursor);
  const quote = cursor.source.charCodeAt(cursor.offset);
  if (quote !== 0x22 && quote !== 0x27) {
    if (cursor.offset >= cursor.source.length) return unexpectedEnd(cursor);
    return errorAt(cursor, "expected_quote", `expected a quoted value for attribute ${name}`);
  }
  advance(cursor);
  const valueStart = mark(cursor);

  let value = "";
  for (;;) {
    if (cursor.offset >= cursor.source.length) return unexpectedEnd(cursor);
    const code = cursor.source.charCodeAt(cursor.offset);
    if (code === quote) break;
    if (code === 0x3c) {
      return errorAt(cursor, "lt_in_attribute_value", "'<' is not allowed in an attribute value");
    }
    if (code === 0x26) {
      const decoded = readReference(cursor);
      if (typeof decoded !== "string") return decoded;
      value += decoded;
    } else if (code === CR) {
      advance(cursor);
      if (cursor.source.charCodeAt(cursor.offset) === LF) advance(cursor);
      value += " ";
    } else if (code === LF || code === TAB) {
      advance(cursor);
      value += " ";
    } else {
      const error = checkCharacter(cursor, code);
      if (error !== null) return error;
      value += takeCodePoint(cursor);
    }
  }
  const valueEnd = mark(cursor);
  advance(cursor);
  return {
    name,
    value,
    location: span(start, mark(cursor)),
    valueLocation: span(valueStart, valueEnd),
  };
}

// Reads character data up to the next `<`, expanding references and folding
// line breaks per XML 1.0 2.11.
function readCharacterData(cursor: Cursor): string | ParseError {
  let value = "";
  for (;;) {
    if (cursor.offset >= cursor.source.length) return value;
    const code = cursor.source.charCodeAt(cursor.offset);
    if (code === 0x3c) return value;
    if (code === 0x26) {
      const decoded = readReference(cursor);
      if (typeof decoded !== "string") return decoded;
      value += decoded;
    } else if (code === CR) {
      advance(cursor);
      if (cursor.source.charCodeAt(cursor.offset) === LF) advance(cursor);
      value += "\n";
    } else if (code === 0x5d && startsWith(cursor, "]]>")) {
      return errorAt(cursor, "cdata_end_in_text", "']]>' is not allowed in character data");
    } else {
      const error = checkCharacter(cursor, code);
      if (error !== null) return error;
      value += takeCodePoint(cursor);
    }
  }
}

// Reads `<![CDATA[ ... ]]>`: the content verbatim except that line breaks
// fold, since XML 1.0 2.11 applies before any markup is recognized.
function readCdata(cursor: Cursor): string | ParseError {
  advanceBy(cursor, 9);
  let value = "";
  for (;;) {
    if (cursor.offset >= cursor.source.length) {
      return errorAt(cursor, "unterminated_cdata", "a CDATA section is never closed");
    }
    if (startsWith(cursor, "]]>")) {
      advanceBy(cursor, 3);
      return value;
    }
    const code = cursor.source.charCodeAt(cursor.offset);
    if (code === CR) {
      advance(cursor);
      if (cursor.source.charCodeAt(cursor.offset) === LF) advance(cursor);
      value += "\n";
    } else {
      const error = checkCharacter(cursor, code);
      if (error !== null) return error;
      value += takeCodePoint(cursor);
    }
  }
}

// Reads `&name;`, `&#digits;` or `&#xhex;` and answers the character it
// stands for.
function readReference(cursor: Cursor): string | ParseError {
  const start = mark(cursor);
  const source = cursor.source;
  const semicolon = source.indexOf(";", cursor.offset + 1);
  const body = semicolon < 0 ? "" : source.slice(cursor.offset + 1, semicolon);
  if (semicolon < 0 || body.length === 0 || hasReferenceBreak(body)) {
    return errorAtMark(start, "malformed_reference", "'&' does not start a reference");
  }

  let decoded: string;
  if (body.charCodeAt(0) === 0x23) {
    const code = characterReferenceValue(body);
    if (code === null) {
      return errorAtMark(
        start,
        "invalid_character_reference",
        `&${body}; is not a valid character reference`,
      );
    }
    decoded = String.fromCodePoint(code);
  } else {
    const entity = PREDEFINED_ENTITIES.get(body);
    if (entity === undefined) {
      return errorAtMark(start, "unknown_entity", `&${body}; is not a predefined entity`);
    }
    decoded = entity;
  }
  advanceBy(cursor, body.length + 2);
  return decoded;
}

// A reference body runs to the first `;` and never spans whitespace, markup
// or a quote; one that does means the `&` began no reference at all. The
// quote matters in an attribute value, where the `;` found may lie past the
// value's closing quote.
function hasReferenceBreak(body: string): boolean {
  for (let i = 0; i < body.length; i++) {
    const code = body.charCodeAt(i);
    if (isWhitespace(code) || code === 0x3c || code === 0x26 || code === 0x22 || code === 0x27) {
      return true;
    }
  }
  return false;
}

// `#digits` or `#xhex` to the code point it names, or null when it names
// nothing XML allows as a character.
function characterReferenceValue(body: string): number | null {
  const hex = body.charCodeAt(1) === 0x78;
  const digits = body.slice(hex ? 2 : 1);
  if (digits.length === 0) return null;
  let value = 0;
  for (let i = 0; i < digits.length; i++) {
    const digit = digitValue(digits.charCodeAt(i), hex);
    if (digit === null) return null;
    value = value * (hex ? 16 : 10) + digit;
    if (value > 0x10ffff) return null;
  }
  return isXmlChar(value) ? value : null;
}

function digitValue(code: number, hex: boolean): number | null {
  if (code >= 0x30 && code <= 0x39) return code - 0x30;
  if (!hex) return null;
  if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10;
  if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10;
  return null;
}

// XML 1.0's Char production.
function isXmlChar(code: number): boolean {
  if (code === TAB || code === LF || code === CR) return true;
  if (code >= 0x20 && code <= 0xd7ff) return true;
  if (code >= 0xe000 && code <= 0xfffd) return true;
  return code >= 0x10000 && code <= 0x10ffff;
}

// Refuses a character XML does not allow: a control character, a
// non-character, or a surrogate code unit that is not half of a pair. A
// whole pair is left to `takeCodePoint`, which keeps it together. A lone
// surrogate is refused as its character reference is, since XML 1.0's Char
// production excludes the surrogate block.
function checkCharacter(cursor: Cursor, code: number): ParseError | null {
  if (code < SPACE && code !== TAB && code !== LF && code !== CR) {
    return errorAt(cursor, "invalid_character", "a control character is not allowed in XML");
  }
  if (code === 0xfffe || code === 0xffff) {
    return errorAt(cursor, "invalid_character", "a non-character is not allowed in XML");
  }
  if (code >= 0xd800 && code <= 0xdfff && !isPairAt(cursor.source, cursor.offset)) {
    return errorAt(cursor, "invalid_character", "a lone surrogate is not allowed in XML");
  }
  return null;
}

// Whether the code unit at `index` is a high surrogate followed by a low one.
function isPairAt(source: string, index: number): boolean {
  const low = source.charCodeAt(index + 1);
  return isHighSurrogateAt(source, index) && low >= 0xdc00 && low <= 0xdfff;
}

// Skips `<!-- ... -->`, refusing `--` inside it as XML 1.0 2.5 does.
function skipComment(cursor: Cursor): ParseError | null {
  advanceBy(cursor, 4);
  for (;;) {
    if (cursor.offset >= cursor.source.length) {
      return errorAt(cursor, "unterminated_comment", "a comment is never closed");
    }
    if (startsWith(cursor, "--")) {
      if (startsWith(cursor, "-->")) {
        advanceBy(cursor, 3);
        return null;
      }
      return errorAt(cursor, "double_hyphen_in_comment", "'--' is not allowed inside a comment");
    }
    advance(cursor);
  }
}

// Skips `<? ... ?>`. A target spelled `xml` is the XML declaration, which is
// allowed only at the very start of the document.
function skipProcessingInstruction(cursor: Cursor): ParseError | null {
  const start = mark(cursor);
  advanceBy(cursor, 2);
  const target = readName(cursor);
  if (typeof target !== "string") return target;
  const atDocumentStart = start.offset === 0 || (start.offset === 1 && isBomAt(cursor.source, 0));
  if (target.toLowerCase() === "xml" && !atDocumentStart) {
    return errorAtMark(
      start,
      "misplaced_xml_declaration",
      "the XML declaration is allowed only at the start of the document",
    );
  }
  for (;;) {
    if (cursor.offset >= cursor.source.length) {
      return errorAt(
        cursor,
        "unterminated_processing_instruction",
        "a processing instruction is never closed",
      );
    }
    if (startsWith(cursor, "?>")) {
      advanceBy(cursor, 2);
      return null;
    }
    advance(cursor);
  }
}

// Skips `<!DOCTYPE ... >`, internal subset and quoted literals included. The
// declarations inside it are not read: only the predefined entities expand.
//
// The first scan reads a quote as a literal start and ends at a `>` outside
// any literal and outside the subset's brackets. Only when it runs off the
// end of the source does a second scan run, by the reference's rule, where a
// quote is text: the declaration ends at the `>` that balances `<!DOCTYPE`
// against every `<` and `>` inside it, and that `>` must also be one that
// closes it at square-bracket depth zero. That accepts a lone quote inside a
// subset comment or processing instruction, which the first scan reads as a
// literal that never closes, and accepts nothing the reference refuses. Each
// scan is linear.
function skipDoctype(cursor: Cursor): ParseError | null {
  const start = mark(cursor);
  if (scanDoctype(cursor)) return null;
  const end = mark(cursor);
  rewind(cursor, start);
  if (scanDoctypeAsReference(cursor)) return null;
  rewind(cursor, end);
  return errorAt(cursor, "unterminated_doctype", "a document type declaration is never closed");
}

// The first scan: true past the closing `>`, false at the end of the source.
function scanDoctype(cursor: Cursor): boolean {
  advanceBy(cursor, 9);
  let quote = 0;
  let depth = 0;
  for (;;) {
    if (cursor.offset >= cursor.source.length) return false;
    const code = cursor.source.charCodeAt(cursor.offset);
    advance(cursor);
    if (quote !== 0) {
      if (code === quote) quote = 0;
    } else if (code === 0x22 || code === 0x27) {
      quote = code;
    } else if (code === 0x5b) {
      depth++;
    } else if (code === 0x5d) {
      depth--;
    } else if (code === 0x3e && depth <= 0) {
      return true;
    }
  }
}

// The second scan, the reference's two readings of a declaration at once:
// its XML library ends it at the `>` that brings the count of open angle
// brackets, `<!DOCTYPE` included, to zero, and its markup scanner ends it at
// the first `>` at square-bracket depth zero, a `]` never taking the depth
// below zero. Neither reads a quote. True past the closing `>` when both end
// at the same `>`; false otherwise.
function scanDoctypeAsReference(cursor: Cursor): boolean {
  advanceBy(cursor, 9);
  let angles = 1;
  let depth = 0;
  let angleEnd = -1;
  let bracketEnd = -1;
  for (;;) {
    if (cursor.offset >= cursor.source.length) return false;
    const offset = cursor.offset;
    const code = cursor.source.charCodeAt(offset);
    advance(cursor);
    if (angleEnd < 0) {
      if (code === 0x3c) {
        angles++;
      } else if (code === 0x3e) {
        if (angles === 1) angleEnd = offset;
        else angles--;
      }
    }
    if (bracketEnd < 0) {
      if (code === 0x5b) {
        depth++;
      } else if (code === 0x5d) {
        depth = Math.max(depth - 1, 0);
      } else if (code === 0x3e && depth === 0) {
        bracketEnd = offset;
      }
    }
    if (angleEnd >= 0 && bracketEnd >= 0) return angleEnd === bracketEnd;
  }
}

function rewind(cursor: Cursor, to: Mark): void {
  cursor.offset = to.offset;
  cursor.line = to.line;
  cursor.column = to.column;
}

// Reads an XML Name at the cursor.
function readName(cursor: Cursor): string | ParseError {
  const start = cursor.offset;
  if (!isNameStartAt(cursor, 0)) {
    if (cursor.offset >= cursor.source.length) return unexpectedEnd(cursor);
    return errorAt(cursor, "expected_name", "expected a name");
  }
  advance(cursor);
  while (
    cursor.offset < cursor.source.length &&
    isNameChar(cursor.source.charCodeAt(cursor.offset))
  ) {
    advance(cursor);
  }
  return cursor.source.slice(start, cursor.offset);
}

function isNameStartAt(cursor: Cursor, ahead: number): boolean {
  const index = cursor.offset + ahead;
  if (index >= cursor.source.length) return false;
  return isNameStartChar(cursor.source.charCodeAt(index));
}

// XML 1.0's NameStartChar, with every code unit from U+00C0 up accepted as a
// letter: the ranges the production excludes above there are punctuation no
// SCXML name uses, and a surrogate half stands for a supplementary letter.
function isNameStartChar(code: number): boolean {
  return (
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0x41 && code <= 0x5a) ||
    code === 0x5f ||
    code === 0x3a ||
    (code >= 0xc0 && code !== 0xd7 && code !== 0xf7 && code !== 0xfeff)
  );
}

function isNameChar(code: number): boolean {
  return (
    isNameStartChar(code) ||
    (code >= 0x30 && code <= 0x39) ||
    code === 0x2d ||
    code === 0x2e ||
    code === 0xb7
  );
}

function isWhitespace(code: number): boolean {
  return code === SPACE || code === TAB || code === LF || code === CR;
}

function skipWhitespace(cursor: Cursor): boolean {
  const start = cursor.offset;
  while (
    cursor.offset < cursor.source.length &&
    isWhitespace(cursor.source.charCodeAt(cursor.offset))
  ) {
    advance(cursor);
  }
  return cursor.offset > start;
}

function isBomAt(source: string, index: number): boolean {
  return source.charCodeAt(index) === 0xfeff;
}

function startsWith(cursor: Cursor, text: string): boolean {
  return cursor.source.startsWith(text, cursor.offset);
}

// Moves past one code unit, keeping the line and column: LF starts a line,
// and the second half of a surrogate pair does not move the column.
function advance(cursor: Cursor): void {
  const code = cursor.source.charCodeAt(cursor.offset);
  if (code === LF) {
    cursor.line++;
    cursor.column = 1;
  } else if (
    !(code >= 0xdc00 && code <= 0xdfff && isHighSurrogateAt(cursor.source, cursor.offset - 1))
  ) {
    cursor.column++;
  }
  cursor.offset++;
}

function advanceBy(cursor: Cursor, count: number): void {
  for (let i = 0; i < count; i++) advance(cursor);
}

function isHighSurrogateAt(source: string, index: number): boolean {
  const code = source.charCodeAt(index);
  return code >= 0xd800 && code <= 0xdbff;
}

// Takes one code point (one code unit, or a surrogate pair) and answers it.
function takeCodePoint(cursor: Cursor): string {
  const start = cursor.offset;
  advance(cursor);
  const low = cursor.source.charCodeAt(cursor.offset);
  if (isHighSurrogateAt(cursor.source, start) && low >= 0xdc00 && low <= 0xdfff) advance(cursor);
  return cursor.source.slice(start, cursor.offset);
}

function mark(cursor: Cursor): Mark {
  return { offset: cursor.offset, line: cursor.line, column: cursor.column };
}

function span(start: Mark, end: Mark): Location {
  return {
    startLine: start.line,
    startColumn: start.column,
    startOffset: start.offset,
    endLine: end.line,
    endColumn: end.column,
    endOffset: end.offset,
  };
}

function errorAt(cursor: Cursor, reason: ParseErrorReason, message: string): ParseError {
  return errorAtMark(mark(cursor), reason, message);
}

function errorAtMark(at: Mark, reason: ParseErrorReason, message: string): ParseError {
  const location = span(at, at);
  return {
    reason,
    message: `${message} (line ${at.line}, column ${at.column})`,
    location,
  };
}

function unexpectedEnd(cursor: Cursor): ParseError {
  return errorAt(cursor, "unexpected_end", "the document ends inside a tag");
}
