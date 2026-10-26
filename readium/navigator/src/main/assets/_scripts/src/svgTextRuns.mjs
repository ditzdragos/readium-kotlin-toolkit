//
//  Copyright 2021 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

// Within a word, glyph boxes overlap or touch; the narrowest word space is about a fifth of the
// glyph box height.
const TOUCHING_GAP_PER_HEIGHT = 0.12;

// Glyphs following a curve drift by under a fifth of their height from one to the next; the next
// line sits at least most of a box height lower, even when tight leading makes the boxes overlap.
const SAME_LINE_DRIFT_PER_HEIGHT = 0.5;

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

function boxHeight(a, b) {
  return Math.max(a.bottom - a.top, b.bottom - b.top);
}

function followsOnSameLine(a, b) {
  const drift = Math.abs(b.top + b.bottom - (a.top + a.bottom)) / 2;
  return drift < SAME_LINE_DRIFT_PER_HEIGHT * boxHeight(a, b) && b.left > a.left;
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
  return (
    followsOnSameLine(a, b) &&
    b.left - a.right < TOUCHING_GAP_PER_HEIGHT * boxHeight(a, b)
  );
}

/**
 * Whether [current] starts a new line after [previous]. Letter-spaced lettering leaves gaps on
 * one line too wide to count as touching, so only a line break proves a word ended there.
 */
function startsNewLine(previous, current) {
  return (
    !isBlank(previous.text) &&
    !isBlank(current.text) &&
    !followsOnSameLine(previous.rect, current.rect)
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
      startsNewLine(measure(previous), measure(current))
    ) {
      current.parentNode.insertBefore(document.createTextNode("\n"), current);
    }
  }
}
