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

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

const wordContinuations = new WeakSet();

/**
 * Whether [element] is a glyph joined onto the word before it, so a reader of the page that
 * separates blocks must not separate it.
 */
export function continuesJoinedWord(element) {
  return wordContinuations.has(element);
}

function isBlank(text) {
  return !/\S/.test(text);
}

function isWhitespaceNode(node) {
  return node.nodeType === TEXT_NODE && isBlank(node.nodeValue || "");
}

function isSvgElement(node, localName) {
  return (
    node.nodeType === ELEMENT_NODE &&
    node.namespaceURI === SVG_NAMESPACE &&
    (node.localName || "").toLowerCase() === localName
  );
}

function isSvgGlyph(node) {
  return isSvgElement(node, "text");
}

function isHtmlGlyph(node) {
  return (
    node.nodeType === ELEMENT_NODE &&
    node.namespaceURI !== SVG_NAMESPACE &&
    Array.prototype.every.call(
      node.childNodes,
      (child) => child.nodeType === TEXT_NODE
    ) &&
    /^\s*\S+\s*$/.test(node.textContent || "")
  );
}

function boxHeight(a, b) {
  return Math.max(a.bottom - a.top, b.bottom - b.top);
}

function followsOnSameLine(a, b) {
  const drift = Math.abs(b.top + b.bottom - (a.top + a.bottom)) / 2;
  return (
    drift < SAME_LINE_DRIFT_PER_HEIGHT * boxHeight(a, b) && b.left > a.left
  );
}

/**
 * Whether [current] carries on the word [previous] ends: it starts on the same line, right where
 * [previous] stops. Each is a `{ text, rect }` of one glyph element.
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
 * Pairs each glyph element with the glyph element before it, collecting the whitespace between.
 * An SVG <g> only groups glyphs, so a run carries on into and out of it ("C" beside a <g> holding
 * "REEAAK"); any other element or text ends the run. HTML glyphs pair only across whitespace:
 * blocks written back to back already read as one word.
 */
function collectRuns(parent, state, runs) {
  const children = parent.childNodes;
  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    if (isWhitespaceNode(node)) {
      state.between.push(node);
      continue;
    }
    if (isSvgGlyph(node) || isHtmlGlyph(node)) {
      const previous = state.previous;
      if (
        previous &&
        isSvgGlyph(previous) === isSvgGlyph(node) &&
        (isSvgGlyph(node) || state.between.length > 0)
      ) {
        runs.push({ previous, current: node, between: state.between });
      }
      state.previous = node;
      state.between = [];
      continue;
    }
    if (isSvgElement(node, "g")) {
      collectRuns(node, state, runs);
      continue;
    }
    state.previous = null;
    state.between = [];
    if (node.nodeType === ELEMENT_NODE) {
      collectRuns(node, { previous: null, between: [] }, runs);
    }
  }
}

/**
 * Lettering set along a curve is drawn one glyph per element, each placed by its own transform
 * (RR-6148): an SVG <text> per glyph, or an HTML block per glyph or two (`<p>ju</p><p>m</p>
 * <p>p</p>`). The publisher's indentation leaves a newline between every pair, so the page's text
 * reads "R\nu\nm\nb\nl\ne" and each letter becomes a word. Whitespace outside an SVG <text> or
 * between two blocks is never drawn, so it can be removed between glyphs that touch, and kept (or
 * added) where a new word or line starts, without changing the page. Whitespace between inline
 * boxes is drawn, so inline glyphs never join.
 */
export function joinLetteringRuns(document) {
  const candidates = [];
  collectRuns(document.body, { previous: null, between: [] }, candidates);
  if (candidates.length === 0) {
    return;
  }

  const blockLevel = new Map();
  const isBlockLevel = (element) => {
    if (!blockLevel.has(element)) {
      const display = document.defaultView.getComputedStyle(element).display;
      blockLevel.set(element, !/^(inline|none|contents)/.test(display));
    }
    return blockLevel.get(element);
  };
  const runs = candidates.filter(
    ({ previous, current }) =>
      isSvgGlyph(current) || (isBlockLevel(previous) && isBlockLevel(current))
  );

  const measured = new Map();
  const measure = (element) => {
    if (!measured.has(element)) {
      measured.set(element, {
        text: element.textContent || "",
        rect: glyphRect(document, element),
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
      wordContinuations.add(current);
    } else if (
      between.length === 0 &&
      startsNewLine(measure(previous), measure(current))
    ) {
      current.parentNode.insertBefore(document.createTextNode("\n"), current);
    }
  }
}

function glyphRect(document, element) {
  if (isSvgGlyph(element)) {
    return element.getBoundingClientRect();
  }
  const range = document.createRange();
  range.selectNodeContents(element);
  return range.getBoundingClientRect();
}
