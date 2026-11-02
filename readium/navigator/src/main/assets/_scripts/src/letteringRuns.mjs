//
//  Copyright 2021 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

import { containingElement, elementsCoveredByRange } from "./rangeCoverage.mjs";
import { mergeIntoLines } from "./rangeRects.mjs";
import { turnedBoxAround } from "./turnedBox.mjs";

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

// An OCR overlay is one word by construction, and its invisible text is laid out in a container
// that can be zero-width, so its geometry says nothing about the artwork (RR-8804).
function isOcrOverlay(node) {
  return Boolean(node.classList && node.classList.contains("text-overlay"));
}

function isHtmlGlyph(node) {
  return (
    node.nodeType === ELEMENT_NODE &&
    node.namespaceURI !== SVG_NAMESPACE &&
    !isOcrOverlay(node) &&
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

function boundsOf(corners) {
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  };
}

/**
 * Splits glyphs in reading order into the lines they are set on, each turned the way it reads.
 */
export function turnedBoxesByLine(glyphs) {
  const lines = [];
  let previous = null;
  for (const glyph of glyphs) {
    const bounds = boundsOf(glyph.corners);
    if (previous && followsOnSameLine(previous, bounds)) {
      lines[lines.length - 1].push(glyph);
    } else {
      lines.push([glyph]);
    }
    previous = bounds;
  }
  return lines.map(turnedBoxAround);
}

function glyphCorners(element) {
  const box = element.getBBox();
  const matrix = element.getScreenCTM();
  if (!matrix || !(box.width > 0) || !(box.height > 0)) {
    return null;
  }
  const onScreen = (x, y) => ({
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f,
  });
  return [
    onScreen(box.x, box.y),
    onScreen(box.x + box.width, box.y),
    onScreen(box.x + box.width, box.y + box.height),
    onScreen(box.x, box.y + box.height),
  ];
}

/** The part of [element]'s text that [range] covers. */
function coveredText(range, element) {
  const part = element.ownerDocument.createRange();
  part.selectNodeContents(element);
  if (range.compareBoundaryPoints(Range.START_TO_START, part) > 0) {
    part.setStart(range.startContainer, range.startOffset);
  }
  if (range.compareBoundaryPoints(Range.END_TO_END, part) < 0) {
    part.setEnd(range.endContainer, range.endOffset);
  }
  return part.toString();
}

/** A <text> set on several lines, through <tspan> positions, has one bounding box for them all. */
function spansSeveralLines(element) {
  const contents = element.ownerDocument.createRange();
  contents.selectNodeContents(element);
  return mergeIntoLines(Array.from(contents.getClientRects())).length > 1;
}

/**
 * The boxes a decoration on lettering must occupy: one per line the range covers, turned the way
 * its glyphs read. Lettering drawn one glyph per element places each glyph by its own transform,
 * so its client rect is the upright box around a turned glyph. Along a curve those boxes step up
 * or down letter by letter, and grouping them into lines cuts one word into several (RR-9333).
 * The range of a word set one HTML block per glyph also reports the whole box of every block it
 * covers, which leaves slivers of underline or read highlight beside and above the word.
 *
 * Returns [], leaving the caller on its client rects, unless the range covers whole glyph
 * elements, each set on one line: a box measured on a whole element would overreach a range
 * covering part of it, or span the lines it is set on. HTML text takes this path only when a
 * glyph it covers is turned, so upright text keeps its client rects.
 */
export function letteringLineBoxes(range) {
  const ancestor = containingElement(range.commonAncestorContainer);
  const svg = ancestor.closest("svg");
  return svg ? svgLineBoxes(range, svg) : htmlLineBoxes(range, ancestor);
}

/** Whether [covered], the text a range covers of [element], is all of it, set on one line. */
function coversWhole(covered, element) {
  return (
    covered.trim() === element.textContent.trim() &&
    !spansSeveralLines(element)
  );
}

function svgLineBoxes(range, svg) {
  const glyphs = [];
  for (const element of elementsCoveredByRange(
    range,
    svg.querySelectorAll("text")
  )) {
    const covered = coveredText(range, element);
    if (isBlank(covered)) {
      continue;
    }
    if (!coversWhole(covered, element)) {
      return [];
    }
    const corners = glyphCorners(element);
    if (!corners) {
      return [];
    }
    glyphs.push({ corners });
  }
  return glyphs.length > 0 ? turnedBoxesByLine(glyphs) : [];
}

function htmlLineBoxes(range, ancestor) {
  const candidates = isHtmlGlyph(ancestor)
    ? [ancestor]
    : Array.prototype.filter.call(ancestor.querySelectorAll("*"), isHtmlGlyph);
  const covered = elementsCoveredByRange(range, candidates);
  const coveredGlyphText = covered.map((element) => element.textContent);
  if (
    covered.length === 0 ||
    withoutWhitespace(range.toString()) !==
      withoutWhitespace(coveredGlyphText.join(""))
  ) {
    return [];
  }

  const glyphs = [];
  let anyTurned = false;
  for (const element of covered) {
    if (!coversWhole(coveredText(range, element), element)) {
      return [];
    }
    const turn = screenTurn(element);
    if (!turn) {
      return [];
    }
    const corners = turnedTextCorners(textRect(element), turn);
    if (!corners) {
      return [];
    }
    anyTurned = anyTurned || Math.abs(turn.sin) > UPRIGHT_SINE;
    glyphs.push({ corners });
  }
  return anyTurned ? turnedBoxesByLine(glyphs) : [];
}

function withoutWhitespace(text) {
  return text.replace(/\s+/g, "");
}

function textRect(element) {
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  return range.getBoundingClientRect();
}

// A turn under a third of a degree leaves a glyph upright to within a pixel across 150px.
const UPRIGHT_SINE = 0.006;

// Near 45° an upright box fits a turned box of almost any proportion, so it no longer tells the
// glyph's width from its height.
const MIN_PROPORTION_DETERMINANT = 0.25;

function parseMatrix(transform) {
  const match = /^matrix\(([^)]*)\)$/.exec(transform || "");
  return match ? match[1].split(",").map(Number) : null;
}

/**
 * The turn CSS gives [element] on screen, its own transform after its ancestors', as `{ cos, sin }`
 * of the angle its text reads at. Null when a transform does more than turn and scale evenly
 * (a skew, a stretch, a mirror, a 3D transform), since the text box then is no rectangle on screen
 * that its upright box describes.
 */
function screenTurn(element) {
  const view = element.ownerDocument.defaultView;
  let [a, b, c, d] = [1, 0, 0, 1];
  for (let node = element; node; node = node.parentElement) {
    const transform = view.getComputedStyle(node).transform;
    if (!transform || transform === "none") {
      continue;
    }
    const matrix = parseMatrix(transform);
    if (!matrix || matrix.some(Number.isNaN)) {
      return null;
    }
    const [ma, mb, mc, md] = matrix;
    [a, b, c, d] = [
      ma * a + mc * b,
      mb * a + md * b,
      ma * c + mc * d,
      mb * c + md * d,
    ];
  }
  const scale = Math.hypot(a, b);
  const tolerance = scale / 100;
  if (
    !(scale > 0) ||
    Math.abs(a - d) > tolerance ||
    Math.abs(b + c) > tolerance
  ) {
    return null;
  }
  return { cos: a / scale, sin: b / scale };
}

/**
 * The corners of a text box turned by [turn], from [rect], the upright box around it, clockwise
 * from its top left. The upright box of a box w × h turned by θ is w|cos θ| + h|sin θ| wide and
 * w|sin θ| + h|cos θ| high, centred where the turned box is, so both sides follow from it.
 */
function turnedTextCorners(rect, { cos, sin }) {
  const c = Math.abs(cos);
  const s = Math.abs(sin);
  const determinant = c * c - s * s;
  if (Math.abs(determinant) < MIN_PROPORTION_DETERMINANT) {
    return null;
  }
  const uprightWidth = rect.right - rect.left;
  const uprightHeight = rect.bottom - rect.top;
  const width = (uprightWidth * c - uprightHeight * s) / determinant;
  const height = (uprightHeight * c - uprightWidth * s) / determinant;
  if (!(width > 0) || !(height > 0)) {
    return null;
  }
  const centreX = (rect.left + rect.right) / 2;
  const centreY = (rect.top + rect.bottom) / 2;
  const at = (along, across) => ({
    x: centreX + cos * along - sin * across,
    y: centreY + sin * along + cos * across,
  });
  return [
    at(-width / 2, -height / 2),
    at(width / 2, -height / 2),
    at(width / 2, height / 2),
    at(-width / 2, height / 2),
  ];
}

/**
 * Pairs each glyph element with the glyph element before it, collecting the whitespace between.
 * An SVG <g> only groups glyphs, so a run carries on into and out of it ("C" beside a <g> holding
 * "REEAAK"); any other element or text ends the run. HTML glyphs pair across whitespace and
 * back to back alike: the page's text puts a line break before every <p> that does not carry on
 * a joined word, so `<p>s</p><p>t</p><p>r</p>` reads as separate letters too (RR-9376).
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
      if (previous && isSvgGlyph(previous) === isSvgGlyph(node)) {
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
      isSvgGlyph(current) &&
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
