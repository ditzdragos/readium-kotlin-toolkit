import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isSpacingCandidate,
  spansNeedingSpacing,
  processSpansForTextSpacing,
} from "../src/spanTextSpacing.mjs";

function container(element) {
  element.childNodes = [];
  element.insertBefore = (node, reference) => {
    const at = element.childNodes.indexOf(reference);
    element.childNodes.splice(at, 0, node);
  };
  return element;
}

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

function run(style, parent, children) {
  const element = container({ tagName: "span", style, parentElement: parent });
  parent.childNodes.push(element);
  children(element);
  element.textContent = textContentOf(element);
  return element;
}

function rendered(element, computed) {
  element.ownerDocument = {
    defaultView: {
      getComputedStyle: () => ({
        display: "inline",
        position: "static",
        cssFloat: "none",
        ...computed,
      }),
    },
  };
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
  return container({ tagName: "P" });
}

function spansIn(root) {
  return (root.childNodes || []).flatMap((n) =>
    n.tagName && n.tagName.toLowerCase() === "span"
      ? [n, ...spansIn(n)]
      : spansIn(n)
  );
}

function documentOf(root) {
  return {
    querySelectorAll: () => spansIn(root),
    createTextNode: (value) => ({ nodeType: 3, nodeValue: value }),
  };
}

function textContentOf(root) {
  return (root.childNodes || [])
    .map((n) => {
      if (n.nodeType === 3) {
        return n.nodeValue;
      }
      return n.childNodes ? textContentOf(n) : n.textContent;
    })
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

  it("rejects a span carrying text inside a placed run", () => {
    const root = parent();
    let kerned;
    run({ left: "7355px", bottom: "20110px" }, root, (line) => {
      textNode("ke", line);
      kerned = span({ marginLeft: "5.3px" }, line, "ep");
    });

    assert.equal(isSpacingCandidate(kerned), false);
  });

  it("rejects a span nested deeper inside a placed run", () => {
    const root = parent();
    let gap;
    run({ left: "7355px", bottom: "20110px" }, root, (line) => {
      run({ marginLeft: "5.3px" }, line, (kerned) => {
        gap = span({ wordSpacing: "0px" }, kerned, " ");
      });
    });

    assert.equal(isSpacingCandidate(gap), false);
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

  it("still separates unplaced spans that carry text outside a placed run", () => {
    const root = parent();
    span({}, root, "African");
    const next = span({}, root, "elephant");

    assert.deepEqual(spansNeedingSpacing(root.childNodes), [next]);
  });

  it("still separates placed runs that hold kerned spans", () => {
    const root = parent();
    run({ left: "100px", bottom: "80px" }, root, (line) => {
      textNode("ke", line);
      span({ marginLeft: "5.3px" }, line, "ep");
    });
    const next = run({ left: "100px", bottom: "40px" }, root, (line) => {
      textNode("cool", line);
    });

    assert.deepEqual(spansNeedingSpacing(spansIn(root)), [next]);
  });
});

describe("spansNeedingSpacing between unplaced spans", () => {
  it("keeps a floated drop cap joined to the rest of its word", () => {
    // The shape "Escargot" (9781466896970) ships on its first story page.
    const root = parent();
    rendered(span({}, root, "B"), { display: "block", cssFloat: "left" });
    rendered(span({}, root, "onjour!"));

    assert.deepEqual(spansNeedingSpacing(root.childNodes), []);
  });

  it("keeps two spans in the same line flow joined", () => {
    const root = parent();
    rendered(span({}, root, "sun"));
    rendered(span({}, root, "flower"));

    assert.deepEqual(spansNeedingSpacing(root.childNodes), []);
  });

  it("separates spans a stylesheet positions on their own", () => {
    const root = parent();
    rendered(span({}, root, "African"), { position: "absolute" });
    const next = rendered(span({}, root, "elephant"), {
      position: "absolute",
    });

    assert.deepEqual(spansNeedingSpacing(root.childNodes), [next]);
  });

  it("separates a span laid out as its own block", () => {
    const root = parent();
    rendered(span({}, root, "African"), { display: "block" });
    const next = rendered(span({}, root, "elephant"));

    assert.deepEqual(spansNeedingSpacing(root.childNodes), [next]);
  });
});

describe("processSpansForTextSpacing", () => {
  it("extracts a drop-cap word as one word", () => {
    const root = parent();
    rendered(span({}, root, "B"), { display: "block", cssFloat: "left" });
    rendered(span({}, root, "onjour!"));
    textNode(" I see you are staring at me!", root);

    processSpansForTextSpacing(documentOf(root));

    assert.equal(textContentOf(root), "Bonjour! I see you are staring at me!");
  });

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

  it("keeps words the publisher kerned with spans that carry text whole", () => {
    // The shape "E is for Elephant" (9780744043068) ships on page004.
    const root = parent();
    run({ left: "7355.2px", bottom: "20110.7px" }, root, (line) => {
      textNode("Elephants", line);
      span({ wordSpacing: "0px" }, line, " ");
      textNode("ke", line);
      run({ marginLeft: "5.3px" }, line, (kerned) => {
        textNode("ep", kerned);
        span({ wordSpacing: "0px" }, kerned, " ");
        textNode("cool", kerned);
        span({ wordSpacing: "0px" }, kerned, " ");
        textNode("by ", kerned);
        span({ wordSpacing: "0px" }, kerned, " ");
      });
    });
    run({ left: "9096.64px", bottom: "17806.7px" }, root, (line) => {
      textNode("f", line);
      span({ marginLeft: "57.6px" }, line, "l");
      span({ marginLeft: "-19.2px" }, line, "apping their ears.");
    });

    processSpansForTextSpacing(documentOf(root));

    assert.equal(
      textContentOf(root).replace(/\s+/g, " "),
      "Elephants keep cool by flapping their ears."
    );
  });
});
