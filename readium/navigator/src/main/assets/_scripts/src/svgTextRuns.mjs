//
//  Copyright 2021 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

// Within a word, glyph boxes overlap or touch; the narrowest word space is about a fifth of the
// glyph box height.
const TOUCHING_GAP_PER_HEIGHT = 0.12;

const TEXT_NODE = 3;

function isBlank(text) {
  return !/\S/.test(text);
}

function isWhitespaceNode(node) {
  return node.nodeType === TEXT_NODE && isBlank(node.nodeValue || "");
}

function isTextElement(node) {
  return (node.localName || "").toLowerCase() === "text";
}

/**
 * Whether [current] carries on the word [previous] ends: it starts on the same line, right where
 * [previous] stops. Each is a `{ text, rect }` of one SVG <text> element.
 */
export function continuesWord(previous, current) {
  if (isBlank(previous.text) || isBlank(current.text)) {
    return false;
  }
  const a = previous.rect;
  const b = current.rect;
  const sameLine = b.top < a.bottom && b.bottom > a.top;
  const height = Math.max(a.bottom - a.top, b.bottom - b.top);
  return (
    sameLine &&
    b.left > a.left &&
    b.left - a.right < TOUCHING_GAP_PER_HEIGHT * height
  );
}

/**
 * Lettering set along a curve is drawn one glyph per SVG <text> element, each placed by its own
 * transform (RR-6148). The publisher's indentation leaves a newline between every pair, so the
 * page's text reads "R\nu\nm\nb\nl\ne" and each letter becomes a word. Whitespace outside a
 * <text> is never drawn, so it can be removed between glyphs that touch, and kept (or added)
 * where a new word or line starts, without changing the page.
 */
export function joinSvgTextRuns(document) {
  const runs = [];
  const containers = new Set();
  const texts = document.body.querySelectorAll("svg text");
  for (let i = 0; i < texts.length; i++) {
    if (texts[i].parentNode) {
      containers.add(texts[i].parentNode);
    }
  }

  for (const container of containers) {
    let previous = null;
    let between = [];
    const children = container.childNodes;
    for (let i = 0; i < children.length; i++) {
      const node = children[i];
      if (isWhitespaceNode(node)) {
        between.push(node);
        continue;
      }
      if (isTextElement(node)) {
        if (previous) {
          runs.push({ previous, current: node, between });
        }
        previous = node;
      } else {
        previous = null;
      }
      between = [];
    }
  }
  if (runs.length === 0) {
    return;
  }

  const measured = new Map();
  const measure = (element) => {
    if (!measured.has(element)) {
      measured.set(element, {
        text: element.textContent || "",
        rect: element.getBoundingClientRect(),
      });
    }
    return measured.get(element);
  };
  const joins = runs.map((run) =>
    continuesWord(measure(run.previous), measure(run.current))
  );

  for (let i = 0; i < runs.length; i++) {
    const { previous, current, between } = runs[i];
    if (joins[i]) {
      between.forEach((node) => node.parentNode.removeChild(node));
    } else if (
      between.length === 0 &&
      !isBlank(measure(previous).text) &&
      !isBlank(measure(current).text)
    ) {
      current.parentNode.insertBefore(document.createTextNode("\n"), current);
    }
  }
}
