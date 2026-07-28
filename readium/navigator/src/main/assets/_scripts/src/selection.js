//
//  Copyright 2021 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

import { toNativeRect } from "./rect";
import { DEBUG_MODE, logError, log as logNative, snapCurrentOffset } from "./utils";
import { TextRange } from "./vendor/hypothesis/anchoring/text-range";

// Polyfill for Android API 26
import matchAll from "string.prototype.matchall";
matchAll.shim();

const debug = true;

// Last stationary press, used to resolve the word under the finger when a selection
// starts. Registered eagerly rather than on `load`, so that a press landing before the
// resource finished loading is still recorded.
let lastPress = null;

const PRESS_MOVE_TOLERANCE = 10;

// The engine selects the pressed word first and only then widens the selection, so the
// snap has to stay armed for a moment after the press.
const PRESS_SNAP_WINDOW_MS = 1500;

function onPressStart(x, y) {
  lastPress = { x, y, moved: false, time: Date.now() };
}

function onPressMove(x, y) {
  if (!lastPress || lastPress.moved) return;
  if (
    Math.abs(x - lastPress.x) > PRESS_MOVE_TOLERANCE ||
    Math.abs(y - lastPress.y) > PRESS_MOVE_TOLERANCE
  ) {
    lastPress.moved = true;
  }
}

const PRESS_LISTENER_OPTIONS = { capture: true, passive: true };

document.addEventListener(
  "touchstart",
  (event) => {
    const touch = event.touches[0];
    if (touch) onPressStart(touch.clientX, touch.clientY);
  },
  PRESS_LISTENER_OPTIONS
);
document.addEventListener(
  "touchmove",
  (event) => {
    const touch = event.touches[0];
    if (touch) onPressMove(touch.clientX, touch.clientY);
  },
  PRESS_LISTENER_OPTIONS
);
document.addEventListener(
  "mousedown",
  (event) => onPressStart(event.clientX, event.clientY),
  PRESS_LISTENER_OPTIONS
);
document.addEventListener(
  "mousemove",
  (event) => onPressMove(event.clientX, event.clientY),
  PRESS_LISTENER_OPTIONS
);

document.addEventListener("selectionchange", snapSelectionToPressedWord);

// Notify native code that the selection changes.
window.addEventListener(
  "load",
  function () {
    var isSelecting = false;
    document.addEventListener("selectionchange", function () {
      const collapsed = window.getSelection().isCollapsed;

      if (collapsed && isSelecting) {
        isSelecting = false;
        Android.onSelectionEnd();
        // Snaps the current column in case the user shifted the scroll by dragging the text selection.
        snapCurrentOffset();
      } else if (!collapsed && !isSelecting) {
        isSelecting = true;
        Android.onSelectionStart();
      }
    });
  },
  false
);

const WORD_CHARACTER_REGEX = /[\p{L}\p{N}'’-]/u;
const LETTER_OR_DIGIT_REGEX = /[\p{L}\p{N}]/u;

function isWordCharacter(character) {
  return character !== undefined && WORD_CHARACTER_REGEX.test(character);
}

// A long press over a block whose text is a single node makes the engine select the whole
// block instead of a word. Reduce such a selection to the word that was actually pressed.
function snapSelectionToPressedWord() {
  try {
    if (!isPressStationary()) {
      return;
    }
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      return;
    }
    if (!/\s/.test(selection.toString().trim())) {
      return;
    }
    const word = pressedWord();
    if (!word) {
      return;
    }
    // Ignore a press that no longer points inside what is selected.
    if (selection.getRangeAt(0).comparePoint(word.node, word.start) !== 0) {
      return;
    }
    selection.setBaseAndExtent(word.node, word.start, word.node, word.end);
  } catch (e) {
    if (DEBUG_MODE) logError(e);
  }
}

function isPressStationary() {
  return (
    lastPress !== null &&
    !lastPress.moved &&
    Date.now() - lastPress.time <= PRESS_SNAP_WINDOW_MS
  );
}

function pressedWord() {
  if (!document.caretRangeFromPoint) {
    return null;
  }
  const caret = document.caretRangeFromPoint(lastPress.x, lastPress.y);
  if (!caret || caret.startContainer.nodeType !== Node.TEXT_NODE) {
    return null;
  }
  const node = caret.startContainer;
  const text = node.data;
  let index = caret.startOffset;
  if (!isWordCharacter(text[index]) && isWordCharacter(text[index - 1])) {
    index -= 1;
  }
  if (!isWordCharacter(text[index])) {
    return null;
  }
  let start = index;
  let end = index + 1;
  while (start > 0 && isWordCharacter(text[start - 1])) start -= 1;
  while (end < text.length && isWordCharacter(text[end])) end += 1;
  while (start < end && !LETTER_OR_DIGIT_REGEX.test(text[start])) start += 1;
  while (end > start && !LETTER_OR_DIGIT_REGEX.test(text[end - 1])) end -= 1;
  return start < end ? { node, start, end } : null;
}

export function getCurrentSelection() {
  const text = getCurrentSelectionText();
  if (!text) {
    return null;
  }
  const rect = getSelectionRect();
  return { text, rect };
}

function getSelectionRect() {
  try {
    let sel = window.getSelection();
    if (!sel) {
      return;
    }
    let range = sel.getRangeAt(0);

    return toNativeRect(range.getBoundingClientRect());
  } catch (e) {
    if (DEBUG_MODE) logError(e);
    return null;
  }
}

// Cache document.body.textContent as it's expensive and doesn't change often during selection
let cachedBodyText = null;
let cachedBodyTextTimestamp = 0;
const BODY_TEXT_CACHE_TTL = 100; // Cache for 100ms

function getCachedBodyText() {
  const now = Date.now();
  if (cachedBodyText === null || (now - cachedBodyTextTimestamp) > BODY_TEXT_CACHE_TTL) {
    cachedBodyText = document.body.textContent;
    cachedBodyTextTimestamp = now;
  }
  return cachedBodyText;
}

// Pre-compile regex patterns for better performance
const NEWLINE_REGEX = /\n/g;
const MULTI_SPACE_REGEX = /\s\s+/g;
const WORD_BOUNDARY_START_REGEX = /\P{L}\p{L}/gu;
const WORD_BOUNDARY_END_REGEX = /\p{L}\P{L}/gu;

function getCurrentSelectionText() {
  const selection = window.getSelection();
  if (!selection) {
    return undefined;
  }
  if (selection.isCollapsed) {
    return undefined;
  }
  const highlight = selection.toString();
  // Use pre-compiled regex patterns
  const cleanHighlight = highlight
    .trim()
    .replace(NEWLINE_REGEX, " ")
    .replace(MULTI_SPACE_REGEX, " ");
  if (cleanHighlight.length === 0) {
    return undefined;
  }
  if (!selection.anchorNode || !selection.focusNode) {
    return undefined;
  }
  const range =
    selection.rangeCount === 1
      ? selection.getRangeAt(0)
      : createOrderedRange(
          selection.anchorNode,
          selection.anchorOffset,
          selection.focusNode,
          selection.focusOffset
        );
  if (!range || range.collapsed) {
    if (DEBUG_MODE) log("$$$$$$$$$$$$$$$$$ CANNOT GET NON-COLLAPSED SELECTION RANGE?!");
    return undefined;
  }

  // Use cached body text
  const text = getCachedBodyText();
  const textRange = TextRange.fromRange(range).relativeTo(document.body);
  const start = textRange.start.offset;
  const end = textRange.end.offset;

  const snippetLength = 200;

  // Compute the text before the highlight, ignoring the first "word", which might be cut.
  let before = text.slice(Math.max(0, start - snippetLength), start);
  // Reset regex lastIndex for global regex
  WORD_BOUNDARY_START_REGEX.lastIndex = 0;
  let firstWordStart = WORD_BOUNDARY_START_REGEX.exec(before)?.index;
  if (firstWordStart !== undefined && firstWordStart !== -1) {
    before = before.slice(firstWordStart + 1);
  }

  // Compute the text after the highlight, ignoring the last "word", which might be cut.
  let after = text.slice(end, Math.min(text.length, end + snippetLength));
  // Reset regex lastIndex
  WORD_BOUNDARY_END_REGEX.lastIndex = 0;
  const matches = Array.from(after.matchAll(WORD_BOUNDARY_END_REGEX));
  let lastWordEnd = matches.length > 0 ? matches[matches.length - 1] : null;
  if (lastWordEnd !== null && lastWordEnd.index > 1) {
    after = after.slice(0, lastWordEnd.index + 1);
  }

  return { highlight, before, after };
}

function createOrderedRange(startNode, startOffset, endNode, endOffset) {
  const range = new Range();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  if (!range.collapsed) {
    return range;
  }
  if (DEBUG_MODE) log(">>> createOrderedRange COLLAPSED ... RANGE REVERSE?");
  const rangeReverse = new Range();
  rangeReverse.setStart(endNode, endOffset);
  rangeReverse.setEnd(startNode, startOffset);
  if (!rangeReverse.collapsed) {
    if (DEBUG_MODE) log(">>> createOrderedRange RANGE REVERSE OK.");
    return range;
  }
  if (DEBUG_MODE) log(">>> createOrderedRange RANGE REVERSE ALSO COLLAPSED?!");
  return undefined;
}

export function convertRangeInfo(document, rangeInfo) {
  const startElement = document.querySelector(
    rangeInfo.startContainerElementCssSelector
  );
  if (!startElement) {
    if (DEBUG_MODE) log("^^^ convertRangeInfo NO START ELEMENT CSS SELECTOR?!");
    return undefined;
  }
  let startContainer = startElement;
  if (rangeInfo.startContainerChildTextNodeIndex >= 0) {
    if (
      rangeInfo.startContainerChildTextNodeIndex >=
      startElement.childNodes.length
    ) {
      if (DEBUG_MODE) {
        log(
          "^^^ convertRangeInfo rangeInfo.startContainerChildTextNodeIndex >= startElement.childNodes.length?!"
        );
      }
      return undefined;
    }
    startContainer =
      startElement.childNodes[rangeInfo.startContainerChildTextNodeIndex];
    if (startContainer.nodeType !== Node.TEXT_NODE) {
      if (DEBUG_MODE) log("^^^ convertRangeInfo startContainer.nodeType !== Node.TEXT_NODE?!");
      return undefined;
    }
  }
  const endElement = document.querySelector(
    rangeInfo.endContainerElementCssSelector
  );
  if (!endElement) {
    if (DEBUG_MODE) log("^^^ convertRangeInfo NO END ELEMENT CSS SELECTOR?!");
    return undefined;
  }
  let endContainer = endElement;
  if (rangeInfo.endContainerChildTextNodeIndex >= 0) {
    if (
      rangeInfo.endContainerChildTextNodeIndex >= endElement.childNodes.length
    ) {
      if (DEBUG_MODE) {
        log(
          "^^^ convertRangeInfo rangeInfo.endContainerChildTextNodeIndex >= endElement.childNodes.length?!"
        );
      }
      return undefined;
    }
    endContainer =
      endElement.childNodes[rangeInfo.endContainerChildTextNodeIndex];
    if (endContainer.nodeType !== Node.TEXT_NODE) {
      if (DEBUG_MODE) log("^^^ convertRangeInfo endContainer.nodeType !== Node.TEXT_NODE?!");
      return undefined;
    }
  }
  return createOrderedRange(
    startContainer,
    rangeInfo.startOffset,
    endContainer,
    rangeInfo.endOffset
  );
}

export function location2RangeInfo(location) {
  const locations = location.locations;
  const domRange = locations.domRange;
  const start = domRange.start;
  const end = domRange.end;

  return {
    endContainerChildTextNodeIndex: end.textNodeIndex,
    endContainerElementCssSelector: end.cssSelector,
    endOffset: end.offset,
    startContainerChildTextNodeIndex: start.textNodeIndex,
    startContainerElementCssSelector: start.cssSelector,
    startOffset: start.offset,
  };
}

function log() {
  if (debug) {
    logNative.apply(null, arguments);
  }
}
