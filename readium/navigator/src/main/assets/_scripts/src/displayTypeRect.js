//
//  Copyright 2021 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

import { getClientRectsNoOverlap } from "./rect";
import { mergeIntoLines } from "./rangeRects.mjs";
import { containingElement } from "./rangeCoverage.mjs";
import { isUpright } from "./letteringRuns.mjs";
import { overlayElement } from "./ocrOverlay.mjs";
import {
  displayTypeBodyHeight,
  inkFittedRect,
  neighbourCharacterIndex,
  renderedText,
} from "./displayType.mjs";

// A neighbour further than this many text nodes away is not beside the word.
const NEIGHBOUR_LOOKUP_LIMIT = 8;

function characterHeight(node, index) {
  const character = document.createRange();
  character.setStart(node, index);
  character.setEnd(node, index + 1);
  return character.getBoundingClientRect().height;
}

/** The height of the nearest non-space character before or after [range], or null. */
function neighbourCharacterHeight(range, forward) {
  let node = forward ? range.endContainer : range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return null;
  let offset = forward ? range.endOffset : range.startOffset;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  walker.currentNode = node;
  for (let i = 0; i <= NEIGHBOUR_LOOKUP_LIMIT && node; i++) {
    const index = neighbourCharacterIndex(node.nodeValue, offset, forward);
    if (index !== -1) return characterHeight(node, index);
    node = forward ? walker.nextNode() : walker.previousNode();
    offset = forward ? 0 : node?.nodeValue.length;
  }
  return null;
}

let textMeasureContext = null;

function measureInk(element, text) {
  const style = getComputedStyle(element);
  if (style.writingMode !== "horizontal-tb") return null;
  const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  try {
    if (!document.fonts.check(font)) return null;
  } catch (error) {
    return null;
  }
  textMeasureContext ??= document.createElement("canvas").getContext("2d");
  if (!textMeasureContext) return null;
  textMeasureContext.font = font;
  textMeasureContext.fontVariantCaps = style.fontVariantCaps;
  const metrics = textMeasureContext.measureText(
    renderedText(text, style.textTransform)
  );
  return {
    fontAscent: metrics.fontBoundingBoxAscent,
    fontDescent: metrics.fontBoundingBoxDescent,
    inkAscent: metrics.actualBoundingBoxAscent,
    inkDescent: metrics.actualBoundingBoxDescent,
  };
}

/**
 * The rect of a one-line, upright [range] set in display type, fitted to its ink, or null for any
 * other range: body text, OCR overlays, turned or vertical text. See [inkFittedRect].
 */
export function displayTypeRect(range) {
  const firstLine = range.getClientRects()[0];
  const text = range.toString().trim();
  if (!firstLine || !text || overlayElement(range)) return null;

  const bodyHeight = displayTypeBodyHeight(firstLine.height, [
    () => neighbourCharacterHeight(range, false),
    () => neighbourCharacterHeight(range, true),
  ]);
  if (bodyHeight === null) return null;

  const element = containingElement(range.startContainer);
  if (!element || !isUpright(element)) return null;
  const lines = mergeIntoLines(getClientRectsNoOverlap(range, true));
  if (lines.length !== 1) return null;

  const metrics = measureInk(element, text);
  return metrics && inkFittedRect(lines[0], metrics, bodyHeight);
}

/** Where [range]'s word is on screen: its ink when it is display type, else its bounding rect. */
export function wordRect(range) {
  return displayTypeRect(range) ?? range.getBoundingClientRect();
}
