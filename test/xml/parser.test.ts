// The SCXML XML parser: the tree, the two XML normalizations, references,
// CDATA, the skipped constructs, namespaces, locations and refusals.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type Element,
  type Location,
  type Node,
  type ParseErrorReason,
  parseXml,
  type Text,
} from "../../src/xml/parser.js";

const SCXML = "http://www.w3.org/2005/07/scxml";

function root(source: string): Element {
  const result = parseXml(source);
  if (!result.ok) throw new Error(`expected a parse, got ${result.error.message}`);
  return result.root;
}

function slice(source: string, location: Location): string {
  return source.slice(location.startOffset, location.endOffset);
}

function asElement(node: Node | undefined): Element {
  if (node === undefined || node.type !== "element") throw new Error("expected an element");
  return node;
}

function text(node: Node | undefined): Text {
  if (node === undefined || node.type !== "text") throw new Error("expected a text node");
  return node;
}

function attributeValue(source: string): string {
  const attribute = root(source).attributes[0];
  if (attribute === undefined) throw new Error("expected an attribute");
  return attribute.value;
}

function textValue(source: string): string {
  return text(root(source).children[0]).value;
}

describe("attribute-value normalization", () => {
  // The record, st-ADR-0043 at v2.9.0, "Decision": "Statifier normalizes
  // attribute values per XML 1.0 3.3.3, in the parser, guided by the raw
  // source." Item 1: "a reference token keeps its decoded character
  // verbatim; a literal `#x20` / `#x9` / `#xA` / `#xD` appends `#x20`; a
  // literal `\r\n` pair is consumed as one unit and appends a single `#x20`
  // (2.11 folded in); everything else passes through." Item 2: "CDATA
  // treatment only. No leading/trailing trim, no collapsing of space runs".
  const table: ReadonlyArray<readonly [string, string, string]> = [
    ["a literal TAB becomes a space", "a\tb", "a b"],
    ["a literal LF becomes a space", "a\nb", "a b"],
    ["a literal CR becomes a space", "a\rb", "a b"],
    ["a literal CR LF pair becomes one space", "a\r\nb", "a b"],
    ["two CR LF pairs become two spaces", "a\r\n\r\nb", "a  b"],
    ["&#10; keeps its newline", "a&#10;b", "a\nb"],
    ["&#9; keeps its TAB", "a&#9;b", "a\tb"],
    ["&#xD; keeps its CR", "a&#xD;b", "a\rb"],
    ["a reference beside a literal newline differs from it", "&#10;\n", "\n "],
    ["nothing is trimmed", "  a  ", "  a  "],
    ["a run of spaces is not collapsed", "a   b", "a   b"],
    ["an entity expands", "a &lt; b", "a < b"],
  ];

  for (const [name, raw, expected] of table) {
    // Sabotage: appending the raw character instead of a space for a literal
    // TAB/LF/CR, or not consuming the LF after a CR, turns a row red.
    it(name, () => {
      expect(attributeValue(`<scxml cond="${raw}"/>`)).toBe(expected);
    });
  }

  // Sabotage: stopping the value at the other quote character turns this red.
  it("reads both quote styles, each holding the other", () => {
    const element = root(`<a x='say "hi"' y="it's"/>`);
    expect(element.attributes.map((a) => a.value)).toEqual(['say "hi"', "it's"]);
  });

  // Sabotage: pointing valueLocation at the normalized value's length instead
  // of the raw text turns this red.
  it("keeps the raw span while the value is normalized", () => {
    const source = '<scxml cond="a\r\nb"/>';
    const attribute = root(source).attributes[0];
    expect(attribute?.value).toBe("a b");
    expect(attribute && slice(source, attribute.valueLocation)).toBe("a\r\nb");
    expect(attribute && slice(source, attribute.location)).toBe('cond="a\r\nb"');
  });
});

describe("line-break folding in character data", () => {
  // The record, st-ADR-0045 at v2.9.0, "Decision": "Statifier folds line
  // breaks in character data per XML 1.0 2.11, in the parser, guided by the
  // raw source." Item 1: "A literal `\r\n` pair and a literal lone `\r` in
  // the raw run each become one `\n`; a `\r` decoded from `&#xD;` stays
  // `\r`; everything else passes through. Only the 2.11 fold applies -
  // 3.3.3's whitespace-to-space mapping is attribute-specific and never
  // touches character data".
  const table: ReadonlyArray<readonly [string, string, string]> = [
    ["a CR LF pair folds to one LF", "a\r\nb", "a\nb"],
    ["a lone CR folds to LF", "c\rd", "c\nd"],
    ["&#xD; survives as a CR", "e&#xD;f", "e\rf"],
    ["a CR LF inside CDATA folds", "<![CDATA[g\r\nh]]>", "g\nh"],
    ["a CR before a comment is a lone CR", "i\r<!--c-->\nj", "i\n\nj"],
    ["a CR ending a CDATA section is a lone CR", "<![CDATA[k\r]]>\nl", "k\n\nl"],
    ["a TAB is kept", "m\tn", "m\tn"],
    ["an LF is kept", "o\np", "o\np"],
    ["two CR LF pairs fold to two LFs", "q\r\n\r\nr", "q\n\nr"],
  ];

  for (const [name, raw, expected] of table) {
    // Sabotage: appending the raw CR instead of an LF, or folding CR LF to
    // two LFs, turns a row red.
    it(name, () => {
      expect(textValue(`<script>${raw}</script>`)).toBe(expected);
    });
  }

  // Sabotage: spanning the folded value's length instead of the raw run
  // turns this red.
  it("keeps the raw span while the value is folded", () => {
    const source = "<script>a\r\nb</script>";
    const node = text(root(source).children[0]);
    expect(slice(source, node.location)).toBe("a\r\nb");
  });
});

describe("references", () => {
  const entities: ReadonlyArray<readonly [string, string]> = [
    ["&amp;", "&"],
    ["&lt;", "<"],
    ["&gt;", ">"],
    ["&quot;", '"'],
    ["&apos;", "'"],
  ];

  for (const [reference, character] of entities) {
    // Sabotage: dropping the entity from the predefined table turns this red
    // (the parse refuses it as unknown).
    it(`expands ${reference} in text and in an attribute value`, () => {
      const source = `<log expr="${reference}">${reference}</log>`;
      const element = root(source);
      expect(element.attributes[0]?.value).toBe(character);
      expect(text(element.children[0]).value).toBe(character);
    });
  }

  const characters: ReadonlyArray<readonly [string, string]> = [
    ["&#65;", "A"],
    ["&#x41;", "A"],
    ["&#x6c;", "l"],
    ["&#x4A;", "J"],
    ["&#x1F4DA;", "\u{1F4DA}"],
    ["&#128218;", "\u{1F4DA}"],
  ];

  for (const [reference, character] of characters) {
    // Sabotage: reading every character reference as decimal, or building it
    // with fromCharCode (which truncates past U+FFFF), turns a row red.
    it(`decodes the character reference ${reference}`, () => {
      expect(textValue(`<data>${reference}</data>`)).toBe(character);
      expect(attributeValue(`<data expr="${reference}"/>`)).toBe(character);
    });
  }

  // Sabotage: ending a run at a reference instead of continuing it turns
  // this red (the run would split into three nodes).
  it("keeps one text node across references", () => {
    const element = root("<a>x &amp; y</a>");
    expect(element.children).toHaveLength(1);
    expect(text(element.children[0]).value).toBe("x & y");
  });
});

describe("CDATA, comments and the skipped constructs", () => {
  // Sabotage: expanding references or reading tags inside CDATA turns this
  // red.
  it("takes a CDATA section verbatim and coalesces it with its neighbours", () => {
    const source = "<script>a<![CDATA[<b> &amp; ]]>c</script>";
    const element = root(source);
    expect(element.children).toHaveLength(1);
    const node = text(element.children[0]);
    expect(node.value).toBe("a<b> &amp; c");
    expect(slice(source, node.location)).toBe("a<![CDATA[<b> &amp; ]]>c");
  });

  // Sabotage: starting a run only on character data turns this red (a
  // CDATA-only element would have no text).
  it("makes a text node from a CDATA section alone, even an empty one", () => {
    expect(textValue("<script><![CDATA[x]]></script>")).toBe("x");
    expect(textValue("<script><![CDATA[]]></script>")).toBe("");
  });

  // Sabotage: flushing the run at a comment turns this red (two nodes).
  it("coalesces text across a comment and a processing instruction", () => {
    const source = "<a>x<!-- note -->y<?pi data?>z</a>";
    const element = root(source);
    expect(element.children).toHaveLength(1);
    const node = text(element.children[0]);
    expect(node.value).toBe("xyz");
    expect(slice(source, node.location)).toBe("x<!-- note -->y<?pi data?>z");
  });

  // Sabotage: making a node for a comment turns this red.
  it("makes no node for a comment alone", () => {
    expect(root("<a><!-- only --></a>").children).toEqual([]);
  });

  // Sabotage: not skipping the prolog turns this red (content before the
  // root).
  it("skips the XML declaration, a byte order mark, comments, a doctype and trailing misc", () => {
    const source =
      '﻿<?xml version="1.0" encoding="UTF-8"?>\n<!-- licence -->\n' +
      '<!DOCTYPE scxml [ <!ENTITY x "]>"> ]>\n<?pi x?>\n' +
      '<scxml xmlns="http://www.w3.org/2005/07/scxml"/>\n<!-- after -->\n<?pi y?>\n';
    const element = root(source);
    expect(element.name).toBe("scxml");
    expect(slice(source, element.location)).toBe(
      '<scxml xmlns="http://www.w3.org/2005/07/scxml"/>',
    );
  });

  // A quote inside a comment or a processing instruction in the internal
  // subset need not close. The reference at v2.9.0 accepts both documents:
  // its XML library ends the declaration by counting angle brackets and its
  // markup scanner by bracket depth, and neither reads a quote.
  //
  // Sabotage: dropping the second scan, by the reference's rule, turns this
  // red with unterminated_doctype.
  it("skips a quote inside a comment and inside a processing instruction in the internal subset", () => {
    for (const subset of ["<!-- it's on loan -->", '<?shelf say "hi ?>']) {
      const source = `<!DOCTYPE scxml [${subset}]>\n<scxml/>`;
      const element = root(source);
      expect(element.name).toBe("scxml");
      expect(element.location).toMatchObject({ startLine: 2, startColumn: 1 });
    }
  });

  // A quote opened inside a subset comment or PI and closed after it still
  // pairs, and `<!-->]>` still ends the declaration: the first scan answers
  // these as before, and so does the reference at v2.9.0.
  //
  // Sabotage: skipping a subset comment or PI whole, quotes and all, turns
  // this red with unterminated_doctype.
  it("keeps a quote that pairs across a subset comment or PI, and an unclosed comment opener", () => {
    for (const source of [
      '<!DOCTYPE a [<!-- " -->"]><a/>',
      "<!DOCTYPE a [<?p ' ?>']><a/>",
      "<!DOCTYPE a [<!-->]><a/>",
    ]) {
      expect(root(source).name).toBe("a");
    }
  });

  // Both scans are linear: the second runs once, over the declaration, only
  // when the first runs off the end. A rescan per opener took seconds here.
  //
  // Sabotage: rescanning from every subset opener to the end of the source
  // turns this red.
  it("skips a subset of many openers in linear time", () => {
    const source = `<!DOCTYPE a [${"<?".repeat(100_000)}' ]><a/>`;
    const started = performance.now();
    const result = parseXml(source);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(result.ok ? "" : result.error.reason).toBe("unterminated_doctype");
  });

  // Sabotage: dropping whitespace-only runs turns this red.
  it("keeps whitespace-only text runs", () => {
    const element = root("<a>\n  <b/>\n</a>");
    expect(element.children.map((child) => child.type)).toEqual(["text", "element", "text"]);
    expect(text(element.children[0]).value).toBe("\n  ");
  });

  // Sabotage: storing attributes in a map keyed by name turns this red.
  it("keeps duplicate attributes and prefixed names as written", () => {
    const element = root('<ns0:scxml xmlns:ns0="urn:x" id="a" id="b"/>');
    expect(element.name).toBe("ns0:scxml");
    expect(element.attributes.map((a) => [a.name, a.value])).toEqual([
      ["xmlns:ns0", "urn:x"],
      ["id", "a"],
      ["id", "b"],
    ]);
  });

  // Sabotage: recursing per element instead of keeping an explicit stack
  // turns this red with a stack overflow.
  it("parses deep nesting without touching the call stack", () => {
    const depth = 50_000;
    const source = `${"<s>".repeat(depth)}${"</s>".repeat(depth)}`;
    let node: Element = root(source);
    let seen = 1;
    while (node.children.length > 0) {
      node = asElement(node.children[0]);
      seen++;
    }
    expect(seen).toBe(depth);
  });
});

describe("namespaces", () => {
  // Sabotage: resolving an unprefixed name to null regardless of scope turns
  // this red.
  it("resolves the default namespace and inherits it", () => {
    const element = root(`<scxml xmlns="${SCXML}"><state><final/></state></scxml>`);
    expect(element.namespace).toBe(SCXML);
    const state = asElement(element.children[0]);
    expect(state.namespace).toBe(SCXML);
    expect(asElement(state.children[0]).namespace).toBe(SCXML);
  });

  // Sabotage: refusing a document with no declaration turns this red.
  it("parses a document with no declaration, its names in no namespace", () => {
    const element = root('<scxml version="1.0"><state id="a"/></scxml>');
    expect(element.namespace).toBeNull();
    expect(asElement(element.children[0]).namespace).toBeNull();
  });

  // Sabotage: letting a declaration on one child leak to its sibling turns
  // this red.
  it("scopes a declaration to its element's subtree", () => {
    const element = root(`<scxml xmlns="${SCXML}"><a xmlns="urn:other"><b/></a><c/></scxml>`);
    const a = asElement(element.children[0]);
    expect(a.namespace).toBe("urn:other");
    expect(asElement(a.children[0]).namespace).toBe("urn:other");
    expect(asElement(element.children[1]).namespace).toBe(SCXML);
  });

  // Decided against the reference at v2.9.0: its namespace scope
  // (`Statifier.Lowering.Namespace.declare/2`) puts the value of a bare
  // `xmlns` into the scope as written, so `xmlns=""` binds the empty string
  // rather than undeclaring, and lowering reports the element as
  // foreign_element with the URI "". An empty xmlns is a declaration of the
  // empty URI here too, never null, which would lower as SCXML vocabulary.
  //
  // Sabotage: reading an empty xmlns as null, or ignoring it, turns this red.
  it("binds the empty string for an empty xmlns, as the reference does", () => {
    const element = root(`<scxml xmlns="${SCXML}"><a xmlns=""><b/></a><c/></scxml>`);
    const a = asElement(element.children[0]);
    expect(a.namespace).toBe("");
    expect(asElement(a.children[0]).namespace).toBe("");
    expect(asElement(element.children[1]).namespace).toBe(SCXML);
  });

  // Sabotage: resolving a prefixed name against the default namespace turns
  // this red.
  it("resolves a prefix and answers null for an undeclared one", () => {
    const element = root(
      `<ns0:scxml xmlns:ns0="${SCXML}" xmlns="urn:d"><ns0:state/><x:y/><plain/></ns0:scxml>`,
    );
    expect(element.namespace).toBe(SCXML);
    expect(element.children.map((child) => asElement(child).namespace)).toEqual([
      SCXML,
      null,
      "urn:d",
    ]);
  });

  // Decided: `xmlns:p=""` does NOT undeclare the prefix. Undeclaring a
  // prefix is a Namespaces in XML 1.1 rule (1.0 makes the empty value an
  // error), and the reference at v2.9.0 does neither: its namespace scope
  // (`Statifier.Lowering.Namespace.declare/2`) binds the prefix to the
  // empty string as written, so `p:b` resolves to "" and lowers as
  // foreign_element. This parser matches it: the prefix binds "", never
  // null, so the element is not read as SCXML vocabulary.
  //
  // Sabotage: resolving a prefix against the parent's map instead of the
  // element's own declarations, or reading the empty value as null, turns
  // this red.
  it("binds a prefix declared with an empty value to the empty string", () => {
    const element = root('<a xmlns:p="urn:p"><p:b xmlns:p=""/><p:c/></a>');
    expect(asElement(element.children[0]).namespace).toBe("");
    expect(asElement(element.children[1]).namespace).toBe("urn:p");
  });
});

describe("the relaxed rule for markup inside <content>", () => {
  // The reference's content-markup records at v2.9.0: st-ADR-0042 quotes the
  // SCXML recommendation's G.6, "if no namespace is specified, the inline
  // content will be placed in the SCXML namespace", and decides that "a root
  // that resolves to no namespace at all compiles as SCXML vocabulary". At
  // this layer that means inline markup parses as ordinary elements under
  // the declarations in scope, and a namespace-less document is not refused.

  // Sabotage: giving elements inside <content> a fresh empty scope turns this
  // red.
  it("places undeclared markup inside <content> in the enclosing default namespace", () => {
    const source =
      `<scxml xmlns="${SCXML}" version="1.0"><state><invoke><content>` +
      '<scxml version="1.0"><final/></scxml></content></invoke></state></scxml>';
    const content = asElement(
      asElement(asElement(asElement(root(source).children[0]).children[0]).children[0]),
    );
    expect(content.name).toBe("content");
    const child = asElement(content.children[0]);
    expect(child.name).toBe("scxml");
    expect(child.namespace).toBe(SCXML);
    expect(slice(source, child.location)).toBe('<scxml version="1.0"><final/></scxml>');
  });

  // Sabotage: refusing a root with no xmlns turns this red.
  it("parses the same markup on its own, in no namespace", () => {
    const element = root('<scxml version="1.0"><final/></scxml>');
    expect(element.namespace).toBeNull();
  });

  // Sabotage: forcing content markup into the SCXML namespace turns this red.
  it("keeps a namespace the content markup declares for itself", () => {
    const source = `<scxml xmlns="${SCXML}"><content><book xmlns="urn:loan"/></content></scxml>`;
    const content = asElement(root(source).children[0]);
    expect(asElement(content.children[0]).namespace).toBe("urn:loan");
  });
});

describe("locations", () => {
  // Sabotage: resetting the column to 0 instead of 1 at a line feed, or not
  // counting the line, turns this red.
  it("puts a line and column on every node and slices back to the raw text", () => {
    const source = '<scxml>\n  <state id="loan">\n    text\n  </state>\n</scxml>';
    const scxml = root(source);
    expect(scxml.location).toMatchObject({ startLine: 1, startColumn: 1, endLine: 5 });
    expect(slice(source, scxml.location)).toBe(source);
    const state = asElement(scxml.children[1]);
    expect(state.location).toMatchObject({ startLine: 2, startColumn: 3, endLine: 4 });
    expect(slice(source, state.location)).toBe('<state id="loan">\n    text\n  </state>');
    const id = state.attributes[0];
    expect(id?.location).toMatchObject({ startLine: 2, startColumn: 10, endColumn: 19 });
    expect(id?.valueLocation).toMatchObject({ startLine: 2, startColumn: 14, endColumn: 18 });
    const run = text(state.children[0]);
    expect(run.location).toMatchObject({ startLine: 2, startColumn: 20, endLine: 4, endColumn: 3 });
  });

  // Sabotage: advancing the column on both halves of a surrogate pair turns
  // this red.
  it("counts columns in code points", () => {
    const source = "<a>\u{1F4DA}<b/></a>";
    const b = asElement(root(source).children[1]);
    expect(b.location.startColumn).toBe(5);
    expect(b.location.startOffset).toBe(5);
  });

  // A leading byte order mark is skipped as content but counted as a
  // position: the offset includes it, so a slice still recovers the raw
  // text, and so does the column, which counts code points from the start
  // of the source. That is the reference's coordinate rule at v2.9.0
  // (`Statifier.Parser.Location.at_offset/2` counts every code point of
  // the prefix, `line_and_column/1`), so the root after a mark starts at
  // column 2. (The reference's own parser refuses a leading mark outright;
  // this parser accepts one, and only the coordinates follow the
  // reference.)
  //
  // Sabotage: not advancing past the mark, or advancing the offset without
  // the column, turns this red.
  it("counts a leading byte order mark in the offset and the column", () => {
    const source = "\u{FEFF}<scxml>\n<state/></scxml>";
    const element = root(source);
    expect(element.location).toMatchObject({ startLine: 1, startColumn: 2, startOffset: 1 });
    expect(slice(source, element.location)).toBe("<scxml>\n<state/></scxml>");
    expect(asElement(element.children[1]).location).toMatchObject({ startLine: 2, startColumn: 1 });
  });

  // Sabotage: spanning a self-closing element past its tag turns this red.
  it("spans a self-closing element as its tag", () => {
    const source = "<a> <b x='1' /> </a>";
    const b = asElement(root(source).children[1]);
    expect(slice(source, b.location)).toBe("<b x='1' />");
  });

  // Sabotage: requiring the equals sign right after the name turns this red.
  it("tolerates whitespace around the equals sign and before the end of an end tag", () => {
    const source = '<a id = "x" ></a >';
    const element = root(source);
    expect(element.attributes[0]?.value).toBe("x");
    expect(slice(source, element.attributes[0]?.location ?? element.location)).toBe('id = "x"');
    expect(slice(source, element.location)).toBe(source);
  });
});

describe("malformed input", () => {
  // Each row: the source, the reason token, and the line and column where
  // parsing stopped.
  const table: ReadonlyArray<readonly [string, ParseErrorReason, number, number]> = [
    ["", "missing_root", 1, 1],
    ["  <!-- c -->  ", "missing_root", 1, 15],
    ["text<a/>", "content_before_root", 1, 1],
    ["<a/>text", "content_after_root", 1, 5],
    ["<a/><b/>", "content_after_root", 1, 5],
    ["<a", "unexpected_end", 1, 3],
    ['<a x="1', "unexpected_end", 1, 8],
    ["<a x", "unexpected_end", 1, 5],
    ["<a x=", "unexpected_end", 1, 6],
    ["<a></", "unexpected_end", 1, 6],
    ["<a></a", "unexpected_end", 1, 7],
    ["<1a/>", "content_before_root", 1, 1],
    ["<a><1/></a>", "expected_name", 1, 5],
    ["<a x/>", "expected_equals", 1, 5],
    ["<a x=1/>", "expected_quote", 1, 6],
    ['<a x="1"y="2"/>', "expected_whitespace", 1, 9],
    ["<a></a x>", "expected_tag_end", 1, 8],
    ['<a x="<"/>', "lt_in_attribute_value", 1, 7],
    ["<a>\n  <b></c>\n</a>", "mismatched_end_tag", 2, 6],
    ["<a><b>", "unclosed_element", 1, 7],
    ["<a><!-- open", "unterminated_comment", 1, 13],
    ["<a><!-- a -- b --></a>", "double_hyphen_in_comment", 1, 11],
    ["<a><![CDATA[x", "unterminated_cdata", 1, 14],
    ["<a><?pi x", "unterminated_processing_instruction", 1, 10],
    ["<a><?xml version='1.0'?></a>", "misplaced_xml_declaration", 1, 4],
    ["<!DOCTYPE a [", "unterminated_doctype", 1, 14],
    ["<!DOCTYPE a [<!-- x", "unterminated_doctype", 1, 20],
    ["<!DOCTYPE a [<?pi x", "unterminated_doctype", 1, 20],
    ["<!DOCTYPE a [<!-- [ -->]><a/>", "unterminated_doctype", 1, 30],
    ["<!DOCTYPE a [<!-->' -->]><a/>", "unterminated_doctype", 1, 30],
    ["<!DOCTYPE a [<!-- a > ' -->]><a/>", "unterminated_doctype", 1, 34],
    ["<!DOCTYPE a [<!-- ] -->]><a/>", "content_before_root", 1, 24],
    ["<!DOCTYPE a [<!-- ' -->]>\u0001<a/>", "content_before_root", 1, 26],
    ["<a>&nbsp;</a>", "unknown_entity", 1, 4],
    ["<a>R&D</a>", "malformed_reference", 1, 5],
    ["<a>&amp</a>", "malformed_reference", 1, 4],
    ["<a>&;</a>", "malformed_reference", 1, 4],
    ["<a>& b;</a>", "malformed_reference", 1, 4],
    ['<a><b x="&c"/>d;</a>', "malformed_reference", 1, 10],
    ["<a><b x='&c'/>d;</a>", "malformed_reference", 1, 10],
    ["<a>&#0;</a>", "invalid_character_reference", 1, 4],
    ["<a>&#x;</a>", "invalid_character_reference", 1, 4],
    ["<a>&#Xe9;</a>", "invalid_character_reference", 1, 4],
    ["<a>&#12a;</a>", "invalid_character_reference", 1, 4],
    ["<a>&#xG1;</a>", "invalid_character_reference", 1, 4],
    ["<a>&#xFFFE;</a>", "invalid_character_reference", 1, 4],
    ["<a>&#x110000;</a>", "invalid_character_reference", 1, 4],
    ["<a>&#xD800;</a>", "invalid_character_reference", 1, 4],
    ["<a>\u0001</a>", "invalid_character", 1, 4],
    ['<a x="\u0001"/>', "invalid_character", 1, 7],
    ["<a><![CDATA[\u0001]]></a>", "invalid_character", 1, 13],
    ["<a>￿</a>", "invalid_character", 1, 4],
    ["<a>\uD800</a>", "invalid_character", 1, 4],
    ["<a>x\uDC00</a>", "invalid_character", 1, 5],
    ['<a x="\uD800y"/>', "invalid_character", 1, 7],
    ["<a><![CDATA[\uDBFF]]></a>", "invalid_character", 1, 13],
    ["<a>x]]>y</a>", "cdata_end_in_text", 1, 5],
    ["<a><? x?></a>", "expected_name", 1, 6],
  ];

  for (const [source, reason, line, column] of table) {
    // Sabotage: answering a different reason, or stamping the location at the
    // start of the document, turns a row red.
    it(`refuses ${JSON.stringify(source)} as ${reason}`, () => {
      const result = parseXml(source);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.reason).toBe(reason);
      expect(result.error.location.startLine).toBe(line);
      expect(result.error.location.startColumn).toBe(column);
      expect(result.error.location.endOffset).toBe(result.error.location.startOffset);
      expect(result.error.message).toContain(`line ${line}, column ${column}`);
    });
  }

  // Sabotage: letting any refusal escape as a throw turns this red.
  it("never throws, whatever the input", () => {
    const inputs = ["<", "<!", "<!-", "<![CDATA", "<?", "&", "</a>", "<a/", "﻿", "<a>&#"];
    for (const input of inputs) {
      expect(() => parseXml(input)).not.toThrow();
      expect(parseXml(input).ok).toBe(false);
    }
  });

  // Sabotage: naming the outer element instead of the innermost open one
  // turns this red.
  it("names the element left open", () => {
    const result = parseXml("<a><b>");
    expect(result.ok ? "" : result.error.message).toContain("<b>");
  });
});

describe("the regular-expression rule under src/", () => {
  function files(directory: string): string[] {
    return readdirSync(directory).flatMap((entry) => {
      const path = join(directory, entry);
      return statSync(path).isDirectory() ? files(path) : [path];
    });
  }

  // Sabotage: writing a lookbehind or a named group anywhere under src/
  // turns this red.
  it("finds no lookbehind and no named group in any source file", () => {
    const sources = files(join(import.meta.dirname, "..", "..", "src"));
    expect(sources.length).toBeGreaterThan(0);
    const hits = sources.filter((path) => readFileSync(path, "utf8").includes("(?<"));
    expect(hits).toEqual([]);
  });
});
