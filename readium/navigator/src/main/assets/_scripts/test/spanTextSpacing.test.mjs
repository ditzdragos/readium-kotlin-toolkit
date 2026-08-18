import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isSpacingCandidate,
  spansNeedingSpacing,
  processSpansForTextSpacing,
} from "../src/spanTextSpacing.mjs";

function span(style = {}, parent = null, text = "") {
  const element = {
    tagName: "SPAN",
    style,
    parentElement: parent,
    textContent: text,
  };
  if (parent) {
    parent.childNodes.push(element);
  }
  return element;
}

function textNode(value, parent = null) {
  const node = { nodeType: 3, nodeValue: value, parentElement: parent };
  if (parent) {
    parent.childNodes.push(node);
  }
  return node;
}

function parent() {
  const element = { tagName: "P", childNodes: [] };
  element.insertBefore = (node, reference) => {
    const at = element.childNodes.indexOf(reference);
    element.childNodes.splice(at, 0, node);
  };
  return element;
}

function documentOf(root) {
  return {
    querySelectorAll: () => root.childNodes.filter((n) => n.tagName === "SPAN"),
    createTextNode: (value) => ({ nodeType: 3, nodeValue: value }),
  };
}

function textContentOf(root) {
  return root.childNodes
    .map((n) => (n.nodeType === 3 ? n.nodeValue : ""))
    .join("");
}

describe("isSpacingCandidate", () => {
  it("accepts a span the page places itself", () => {
    assert.equal(
      isSpacingCandidate(span({ left: "12px", bottom: "40px" })),
      true
    );
    assert.equal(isSpacingCandidate(span({ bottom: "40px" })), true);
  });

  it("accepts an unplaced span that still carries text", () => {
    assert.equal(isSpacingCandidate(span({}, null, "word")), true);
  });

  it("rejects an empty span that only nudges kerning", () => {
    assert.equal(isSpacingCandidate(span({ marginLeft: "-4px" })), false);
    assert.equal(isSpacingCandidate(span({})), false);
  });
});

describe("spansNeedingSpacing", () => {
  it("separates two placed spans that start a new line", () => {
    const root = parent();
    span({ left: "100px", bottom: "80px" }, root);
    const next = span({ left: "100px", bottom: "40px" }, root);

    assert.deepEqual(spansNeedingSpacing([root.childNodes[0], next]), [next]);
  });

  it("leaves two placed spans that continue the same line alone", () => {
    const root = parent();
    const first = span({ left: "100px", bottom: "80px" }, root);
    const second = span({ left: "220px", bottom: "80px" }, root);

    assert.deepEqual(spansNeedingSpacing([first, second]), []);
  });

  it("never separates spans that carry no coordinate", () => {
    const root = parent();
    const spans = [
      span({ marginLeft: "-4px" }, root),
      span({ marginLeft: "-3px" }, root),
      span({ marginLeft: "-7px" }, root),
    ];

    assert.deepEqual(spansNeedingSpacing(spans), []);
  });

  it("pairs placed spans across a kerning span between them", () => {
    const root = parent();
    const first = span({ left: "100px", bottom: "80px" }, root);
    span({ marginLeft: "-4px" }, root);
    const third = span({ left: "100px", bottom: "40px" }, root);

    assert.deepEqual(spansNeedingSpacing(root.childNodes), [third]);
  });
});

describe("processSpansForTextSpacing", () => {
  it("keeps a word the publisher split around a kerning span whole", () => {
    // The shape "When I Grow Up" (9781338291162) ships on its second page.
    const root = parent();
    textNode("She has a ba", root);
    span({ marginLeft: "-4px" }, root);
    textNode("sket ", root);
    span({ marginLeft: "-3px" }, root);
    textNode("full of fun ha", root);
    span({ marginLeft: "-7px" }, root);
    textNode("ts for them to", root);

    processSpansForTextSpacing(documentOf(root));

    assert.equal(
      textContentOf(root),
      "She has a basket full of fun hats for them to"
    );
  });
});
