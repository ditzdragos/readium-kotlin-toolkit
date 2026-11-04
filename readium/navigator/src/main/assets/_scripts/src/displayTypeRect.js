//
//  Copyright 2021 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

import { getClientRectsNoOverlap } from "./rect";
import { mergeIntoLines } from "./rangeRects.mjs";
import { containingElement } from "./rangeCoverage.mjs";
import { inkFittedRect, isDisplayType } from "./displayType.mjs";

const ADJACENT_TEXT_LOOKUP_LIMIT = 8;

/** The client rect of the nearest text node before or after [range] that has any. */
export function adjacentTextRect(range, forward) {
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) =>
        node.textContent.trim()
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP,
    }
  );
  walker.currentNode = forward ? range.endContainer : range.startContainer;
  for (let i = 0; i < ADJACENT_TEXT_LOOKUP_LIMIT; i++) {
    const node = forward ? walker.nextNode() : walker.previousNode();
    if (!node) return null;
    if (range.intersectsNode(node)) continue;
    const nodeRange = document.createRange();
    nodeRange.selectNodeContents(node);
    const rects = nodeRange.getClientRects();
    if (rects.length > 0) return forward ? rects[0] : rects[rects.length - 1];
  }
  return null;
}

function neighbourTextHeight(range, forward) {
  const node = forward ? range.endContainer : range.startContainer;
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.nodeValue;
    let index = -1;
    if (forward) {
      const after = text.slice(range.endOffset).search(/\S/);
      if (after !== -1) index = range.endOffset + after;
    } else {
      const before = text.slice(0, range.startOffset).search(/\S\s*$/);
      if (before !== -1) index = before;
    }
    if (index !== -1) {
      const character = document.createRange();
      character.setStart(node, index);
      character.setEnd(node, index + 1);
      return character.getBoundingClientRect().height;
    }
  }
  return adjacentTextRect(range, forward)?.height;
}

let textMeasureContext = null;

function measureInk(element, text) {
  const style = getComputedStyle(element);
  if (style.writingMode !== "horizontal-tb") return null;
  const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  if (!document.fonts.check(font)) return null;
  textMeasureContext ??= document.createElement("canvas").getContext("2d");
  textMeasureContext.font = font;
  const metrics = textMeasureContext.measureText(text);
  return {
    fontAscent: metrics.fontBoundingBoxAscent,
    fontDescent: metrics.fontBoundingBoxDescent,
    inkAscent: metrics.actualBoundingBoxAscent,
    inkDescent: metrics.actualBoundingBoxDescent,
  };
}

/**
 * The rect of a one-line [range] set in display type, fitted to its ink, or null for any other
 * range. See [inkFittedRect].
 */
export function displayTypeRect(range, boundingRect) {
  const neighbourHeights = [
    neighbourTextHeight(range, false),
    neighbourTextHeight(range, true),
  ];
  if (!isDisplayType(boundingRect.height, neighbourHeights)) return null;

  const lines = mergeIntoLines(getClientRectsNoOverlap(range, true));
  const element = containingElement(range.startContainer);
  const text = range.toString().trim();
  if (lines.length !== 1 || !element || !text) return null;

  const metrics = measureInk(element, text);
  return (
    metrics &&
    inkFittedRect(
      lines[0],
      metrics,
      Math.max(...neighbourHeights.filter((h) => h > 0))
    )
  );
}
