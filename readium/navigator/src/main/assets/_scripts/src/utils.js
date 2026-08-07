//
//  Copyright 2021 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

import { resetViewportRatioCache, toNativeRect } from "./rect";
import { bestContextMatchIndex, lineBreakSeparator } from "./textOffsets.mjs";
import { TextQuoteAnchor } from "./vendor/hypothesis/anchoring/types";
import { TextRange } from "./vendor/hypothesis/anchoring/text-range";

/**
 * Least Recently Used Cache with a limit wraping a Map object
 * The LRUCache constructor takes a limit argument which specifies the maximum number of items the cache can hold.
 * The get method removes and re-adds an item to ensure it's marked as the most recently used.
 * The set method checks the size of the cache, and removes the least recently used item if necessary before adding the new item.
 * The clear method clears the cache.
 */
class LRUCache {
  constructor(limit = 100) {
    // Default limit of 100 items
    this.limit = limit;
    this.map = new Map();
  }

  get(key) {
    if (!this.map.has(key)) return undefined;

    // Remove and re-add to ensure this item is the most recently used
    const value = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.map.size >= this.limit) {
      // Remove the least recently used item
      const firstKey = this.map.keys().next().value;
      this.map.delete(firstKey);
    }
    this.map.set(key, value);
  }

  clear() {
    this.map.clear();
  }
}

// Catch JS errors to log them in the app.
window.addEventListener(
  "error",
  function (event) {
    if (DEBUG_MODE) {
      Android.logError(event.message, event.filename, event.lineno);
    }
  },
  false
);

window.addEventListener(
  "load",
  function () {
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        // Clear caches when viewport changes
        clearUtilsCache();
        resetViewportRatioCache();
        onViewportWidthChanged();
        snapCurrentOffset();
      });
    });
    observer.observe(document.body);
  },
  false
);

/**
 * Having an odd number of columns when displaying two columns per screen causes snapping and page
 * turning issues. To fix this, we insert a blank virtual column at the end of the resource.
 */
function appendVirtualColumnIfNeeded() {
  const id = "readium-virtual-page";
  var virtualCol = document.getElementById(id);
  if (isScrollModeEnabled() || getColumnCountPerScreen() != 2) {
    if (virtualCol) {
      virtualCol.remove();
    }
  } else {
    var documentWidth = document.scrollingElement.scrollWidth;
    var colCount = documentWidth / pageWidth;
    var hasOddColCount = (Math.round(colCount * 2) / 2) % 1 > 0.1;
    if (hasOddColCount) {
      if (virtualCol) {
        virtualCol.remove();
      } else {
        virtualCol = document.createElement("div");
        virtualCol.setAttribute("id", id);
        virtualCol.style.breakBefore = "column";
        virtualCol.innerHTML = "&#8203;"; // zero-width space
        document.body.appendChild(virtualCol);
      }
    }
  }
}

export var pageWidth = 1;

function onViewportWidthChanged() {
  // We can't rely on window.innerWidth for the pageWidth on Android, because if the
  // device pixel ratio is not an integer, we get rounding issues offsetting the pages.
  //
  // See https://github.com/readium/readium-css/issues/97
  // and https://github.com/readium/r2-navigator-kotlin/issues/146
  var width = Android.getViewportWidth();
  pageWidth = width / window.devicePixelRatio;
  setProperty(
    "--RS__viewportWidth",
    "calc(" + width + "px / " + window.devicePixelRatio + ")"
  );

  appendVirtualColumnIfNeeded();
}

// Cache for expensive computed style calls
let columnCountCache = null;
let verticalWritingModeCache = null;
let rtlCache = null;

export function getColumnCountPerScreen() {
  if (columnCountCache === null) {
    columnCountCache = parseInt(
      window
        .getComputedStyle(document.documentElement)
        .getPropertyValue("column-count")
    );
  }
  return columnCountCache;
}

export function isScrollModeEnabled() {
  const style = document.documentElement.style;
  return (
    style.getPropertyValue("--USER__view").trim() == "readium-scroll-on" ||
    // FIXME: Will need to be removed in Readium 3.0, --USER__scroll was incorrect.
    style.getPropertyValue("--USER__scroll").trim() == "readium-scroll-on"
  );
}

export function isRTL() {
  if (rtlCache === null) {
    rtlCache = document.body.dir.toLowerCase() == "rtl";
  }
  return rtlCache;
}

export function isVerticalWritingMode() {
  if (verticalWritingModeCache === null) {
    verticalWritingModeCache = window
      .getComputedStyle(document.documentElement)
      .getPropertyValue("writing-mode");
  }
  return verticalWritingModeCache.startsWith("vertical");
}

// Clear caches when document changes
export function clearUtilsCache() {
  columnCountCache = null;
  verticalWritingModeCache = null;
  rtlCache = null;
  elementTextCache.clear();
}

// Scroll to the given TagId in document and snap.
export function scrollToId(id) {
  var element = document.getElementById(id);
  if (!element) {
    return false;
  }

  return scrollToRect(element.getBoundingClientRect());
}

// Position must be in the range [0 - 1], 0-100%.
export function scrollToPosition(position) {
  if (position < 0 || position > 1) {
    throw "scrollToPosition() must be given a position from 0.0 to 1.0";
  }

  let offset;
  if (isScrollModeEnabled()) {
    if (!isVerticalWritingMode()) {
      offset = document.scrollingElement.scrollHeight * position;
      document.scrollingElement.scrollTop = offset;
    } else {
      offset = document.scrollingElement.scrollWidth * position;
      document.scrollingElement.scrollLeft = -offset;
    }
    // window.scrollTo(0, offset);
  } else {
    var documentWidth = document.scrollingElement.scrollWidth;
    var factor = isRTL() ? -1 : 1;
    offset = documentWidth * position * factor;
    document.scrollingElement.scrollLeft = snapOffset(offset);
  }
}

// Scrolls to the first occurrence of the given text snippet.
//
// The expected text argument is a Locator object, as defined here:
// https://readium.org/architecture/models/locators/
export function scrollToLocator(locator) {
  let range = rangeFromLocator(locator);
  if (!range) {
    return false;
  }
  return scrollToRange(range);
}

function scrollToRange(range) {
  return scrollToRect(range.getBoundingClientRect());
}

function scrollToRect(rect) {
  if (isScrollModeEnabled()) {
    document.scrollingElement.scrollTop = rect.top + window.scrollY;
  } else {
    document.scrollingElement.scrollLeft = snapOffset(
      rect.left + window.scrollX
    );
  }

  return true;
}

export function scrollToStart() {
  if (isScrollModeEnabled() && !isVerticalWritingMode()) {
    document.scrollingElement.scrollTop = 0;
  } else {
    document.scrollingElement.scrollLeft = 0;
  }
}

export function scrollToEnd() {
  const scrollingElement = document.scrollingElement;

  if (isScrollModeEnabled()) {
    if (!isVerticalWritingMode()) {
      scrollingElement.scrollTop = document.body.scrollHeight;
    } else {
      scrollingElement.scrollLeft = -document.scrollingElement.scrollWidth;
    }
  } else {
    var factor = isRTL() ? -1 : 1;
    scrollingElement.scrollLeft = snapOffset(
      scrollingElement.scrollWidth * factor
    );
  }
}

// Returns false if the page is already at the left-most scroll offset.
export function scrollLeft() {
  var documentWidth = document.scrollingElement.scrollWidth;
  var offset = window.scrollX - pageWidth;
  var minOffset = isRTL() ? -(documentWidth - pageWidth) : 0;
  return scrollToOffset(Math.max(offset, minOffset));
}

// Returns false if the page is already at the right-most scroll offset.
export function scrollRight() {
  var documentWidth = document.scrollingElement.scrollWidth;
  var offset = window.scrollX + pageWidth;
  var maxOffset = isRTL() ? 0 : documentWidth - pageWidth;
  return scrollToOffset(Math.min(offset, maxOffset));
}

// Scrolls to the given left offset.
// Returns false if the page scroll position is already close enough to the given offset.
function scrollToOffset(offset) {
  //        Android.log("scrollToOffset " + offset);
  if (isScrollModeEnabled()) {
    throw "Called scrollToOffset() with scroll mode enabled. This can only be used in paginated mode.";
  }

  var currentOffset = window.scrollX;
  document.scrollingElement.scrollLeft = snapOffset(offset);
  // In some case the scrollX cannot reach the position respecting to innerWidth
  var diff = Math.abs(currentOffset - offset) / pageWidth;
  return diff > 0.01;
}

// Snap the offset to the screen width (page width).
function snapOffset(offset) {
  var value = offset + (isRTL() ? -1 : 1);
  return value - (value % pageWidth);
}

// Snaps the current offset to the page width.
export function snapCurrentOffset() {
  //        Android.log("snapCurrentOffset");
  if (isScrollModeEnabled()) {
    return;
  }
  var currentOffset = window.scrollX;
  // Adds half a page to make sure we don't snap to the previous page.
  var factor = isRTL() ? -1 : 1;
  var delta = factor * (pageWidth / 2);
  document.scrollingElement.scrollLeft = snapOffset(currentOffset + delta);
}

// Cache the higher level css elements for faster calculating the word by word dom ranges.
// The entry keeps the element's text so it is concatenated once per element instead of
// once per word lookup.
let elementTextCache = new LRUCache(10); // Key: cssSelector, Value: { element, text }

// The cached text is a snapshot, so a text-node mutation invalidates it. Only those do:
// decoration highlights add and remove elements constantly, which would keep the cache cold.
let textMutationObserver = null;

function mutationTouchesText(mutation) {
  if (mutation.type === "characterData") {
    return true;
  }
  for (const node of mutation.addedNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      return true;
    }
  }
  for (const node of mutation.removedNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      return true;
    }
  }
  return false;
}

function observeTextMutations() {
  if (textMutationObserver || !document.body) {
    return;
  }
  textMutationObserver = new MutationObserver((mutations) => {
    if (mutations.some(mutationTouchesText)) {
      elementTextCache.clear();
    }
  });
  textMutationObserver.observe(document.body, {
    characterData: true,
    childList: true,
    subtree: true,
  });
}

function cachedElementFor(cssSelector) {
  const cached = elementTextCache.get(cssSelector);
  if (cached && cached.element.isConnected) {
    return cached;
  }

  const element = document.querySelector(cssSelector);
  if (!element) {
    return null;
  }

  observeTextMutations();

  const entry = { element, text: element.textContent };
  elementTextCache.set(cssSelector, entry);
  return entry;
}

/**
 * Builds a range spanning the [start, end) character offsets of `root`'s text, which may span
 * several of its text nodes. Null when they fall outside it.
 *
 * @param {Node} root
 * @param {number} start
 * @param {number} end
 * @returns {Range | null}
 */
function rangeFromTextOffsets(root, start, end) {
  try {
    return TextRange.fromOffsets(root, start, end).toRange();
  } catch {
    return null;
  }
}

class AmbiguousLocatorError extends Error {}

/**
 * Resolves the locator's body-relative offsets, returning the range only if the text there and
 * on either side agrees with the locator — otherwise the caller should fall back.
 */
function rangeFromOffsetsWithContext(locations, text) {
  const exact = rangeFromTextOffsets(
    document.body,
    locations.start,
    locations.end
  );
  if (!exact || exact.toString() !== text.highlight) {
    return null;
  }

  if (text.before) {
    const beforeStart = Math.max(0, locations.start - text.before.length);
    const beforeRange = rangeFromTextOffsets(
      document.body,
      beforeStart,
      locations.start
    );
    if (beforeRange && !text.before.endsWith(beforeRange.toString())) {
      return null;
    }
  }

  if (text.after) {
    // No range at all means the locator sits at the end of the resource, which contradicts
    // nothing; only text that disagrees does.
    const afterRange = rangeFromTextOffsets(
      document.body,
      locations.end,
      locations.end + text.after.length
    );
    if (afterRange && !text.after.startsWith(afterRange.toString())) {
      return null;
    }
  }

  return exact;
}

/**
 * Whether the text around `highlightIndex` agrees with the locator's before/after context, which
 * is what tells a short repeated word from its neighbours (RR-8486).
 */
function contextMatchesAt(entireText, highlightIndex, highlight, locatorText) {
  const before = locatorText.before;
  const after = locatorText.after;

  const beforeMatches =
    !before ||
    before.endsWith(
      entireText.slice(
        Math.max(0, highlightIndex - before.length),
        highlightIndex
      )
    );
  if (!beforeMatches) {
    return false;
  }

  const highlightEnd = highlightIndex + highlight.length;
  return (
    !after ||
    after.startsWith(
      entireText.slice(highlightEnd, highlightEnd + after.length)
    )
  );
}

function rangeFromContextMatch(root, text) {
  const index = bestContextMatchIndex(root.textContent, text);
  if (index === -1) {
    return null;
  }
  return rangeFromTextOffsets(root, index, index + text.highlight.length);
}

// Returns a range from a locator; it first searches for the higher level css element in the cache
function rangeFromCachedLocator(locator) {
  const cached = cachedElementFor(locator.locations.cssSelector);
  if (!cached) {
    throw new Error("Locator range could not be calculated");
  }

  const entireText = cached.text;
  const highlight = locator.text.highlight;
  let searchIndex = 0;
  let foundIndex = -1;
  let matchCount = 0;

  while (searchIndex < entireText.length) {
    const highlightIndex = entireText.indexOf(highlight, searchIndex);
    if (highlightIndex === -1) {
      break; // No more occurrences of highlight text
    }

    if (contextMatchesAt(entireText, highlightIndex, highlight, locator.text)) {
      if (foundIndex === -1) {
        foundIndex = highlightIndex;
      }
      matchCount++;
      if (matchCount > 1) {
        break;
      }
    }

    // Search for the next occurrence of the highlight text
    searchIndex = highlightIndex + 1;
  }

  if (foundIndex === -1) {
    throw new Error("Locator range could not be calculated");
  }

  // Several occurrences fit the context equally well, so defer to the caller's offsets rather
  // than guessing at the first.
  if (matchCount > 1) {
    throw new AmbiguousLocatorError();
  }

  const range = rangeFromTextOffsets(
    cached.element,
    foundIndex,
    foundIndex + highlight.length
  );
  if (!range) {
    throw new Error("Locator range could not be calculated");
  }

  return range;
}

export function rangeFromLocator(locator) {
  try {
    // Reduce logging in production - only log in debug mode
    if (DEBUG_MODE) {
      log("rangeFromLocator: locator", JSON.stringify(locator));
    }
    let locations = locator.locations;
    let text = locator.text;
    if (text && text.highlight) {
      // Tried first because it only walks the locator's own element, reusing a cached
      // concatenation of its text, where the offset path below walks the whole body.
      var root;
      let ambiguousInElement = false;
      if (locations && locations.cssSelector) {
        try {
          const range = rangeFromCachedLocator(locator);
          if (DEBUG_MODE) {
            log("rangeFromLocator: found range from cached locator", range);
          }
          return range;
        } catch (error) {
          ambiguousInElement = error instanceof AmbiguousLocatorError;
          if (DEBUG_MODE) {
            log("failed getting the range from css selector");
          }
          // root = document.querySelector(locations.cssSelector);
        }
      }

      // The context check is not redundant: these offsets are only accurate to within a few
      // characters, so a short repeated word resolves to a plausible neighbour (RR-8486).
      if (
        locations &&
        Number.isFinite(locations.start) &&
        Number.isFinite(locations.end)
      ) {
        const exact = rangeFromOffsetsWithContext(locations, text);
        if (exact) {
          if (DEBUG_MODE) {
            log("rangeFromLocator: resolved directly from offsets");
          }
          return exact;
        }
      }

      // Neither path could name a single occurrence, so the windowed search below would only
      // pick one arbitrarily.
      if (ambiguousInElement) {
        throw new Error("Locator range could not be calculated");
      }

      if (!root) {
        root = document.body;
      }

      const byContext = rangeFromContextMatch(root, text);
      if (byContext) {
        if (DEBUG_MODE) {
          log("rangeFromLocator: resolved from surrounding context");
        }
        return byContext;
      }

      let start = null;
      let end = null;

      if (locations && root.textContent.length > 0) {
        // If there is info about the start and end positions from the client, use that
        if (locations.start !== undefined && locations.end !== undefined) {
          start = Math.max(locations.start - 10, 0);
          end = Math.min(locations.end + 10, root.textContent.length);
        }
        if (DEBUG_MODE) {
          log(
            "rangeFromLocator: Text at actual range: [",
            root.textContent.slice(locations.start, locations.end),
            "]"
          );
          log(
            "rangeFromLocator: Text at adjusted range: ",
            root.textContent.slice(start, end)
          );
        }
      }

      let anchor = new TextQuoteAnchor(root, text.highlight, {
        prefix: text.before,
        suffix: text.after,
      });

      if (DEBUG_MODE) {
        log(
          "rangeFromLocator: anchor",
          JSON.stringify(anchor),
          text.highlight,
          start,
          end
        );
      }
      let result = anchor.toRange({}, start, end);
      if (DEBUG_MODE) {
        log("rangeFromLocator: found range", result);
      }
      return result;
    }

    if (locations) {
      var element = null;

      if (!element && locations.cssSelector) {
        element = document.querySelector(locations.cssSelector);
      }

      if (!element && locations.fragments) {
        for (const htmlId of locations.fragments) {
          element = document.getElementById(htmlId);
          if (element) {
            break;
          }
        }
      }

      if (element) {
        let range = document.createRange();
        range.setStartBefore(element);
        range.setEndAfter(element);
        if (DEBUG_MODE) {
          log("rangeFromLocator: found element", element);
        }
        return range;
      }
    }
  } catch (e) {
    if (DEBUG_MODE) logError("Cannot parse range " + e);
  }

  return null;
}

function getTextFrom(highlight, range) {
  const text = document.body.textContent;
  const textRange = TextRange.fromRange(range).relativeTo(document.body);
  const start = textRange.start.offset;
  const end = textRange.end.offset;

  const snippetLength = 200;

  let before = text.slice(Math.max(0, start - snippetLength), start);
  const firstWordStart = before.search(/\P{L}\p{L}/gu);
  if (firstWordStart !== -1) {
    before = before.slice(firstWordStart + 1);
  }

  let after = text.slice(end, Math.min(text.length, end + snippetLength));
  const lastWordEnd = Array.from(after.matchAll(/\p{L}\P{L}/gu)).pop();
  if (lastWordEnd !== undefined && lastWordEnd.index > 1) {
    after = after.slice(0, lastWordEnd.index + 1);
  }

  return { highlight, before, after };
}

export function getFirstVisibleWordText() {
  const range = document.createRange();
  const nodeIterator = document.createNodeIterator(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function (node) {
        // Only accept text nodes that are not empty
        if (node.nodeValue.trim().length > 0) {
          range.selectNodeContents(node);
          const rect = range.getBoundingClientRect();

          // Check if any part of the rect is within the viewport (horizontal and vertical)
          if (
            rect.right > 0 &&
            rect.left < window.innerWidth &&
            rect.bottom > 0 &&
            rect.top < window.innerHeight
          ) {
            return NodeFilter.FILTER_ACCEPT;
          }
        }
        return NodeFilter.FILTER_REJECT;
      },
    }
  );

  let documentNode;
  while ((documentNode = nodeIterator.nextNode())) {
    const words = documentNode.nodeValue.trim().split(/\s+/);
    if (words.length > 0) {
      // Loop through each word to find the first visible word within the viewport
      for (let i = 0; i < words.length; i++) {
        const wordIndex = documentNode.nodeValue.indexOf(words[i]);

        // Create a range for each word
        const wordRange = document.createRange();
        wordRange.setStart(documentNode, wordIndex);
        wordRange.setEnd(documentNode, wordIndex + words[i].length);

        const wordRect = wordRange.getBoundingClientRect();

        // Check if the word is within the current viewport
        if (
          wordRect.right > 0 &&
          wordRect.left < window.innerWidth &&
          wordRect.bottom > 0 &&
          wordRect.top < window.innerHeight
        ) {
          // Return the locator for the first visible word
          return { text: getTextFrom(words[i], wordRange) };
        }
      }
    }
  }

  return null; // Return null if no visible word is found
}

export function getFirstVisibleWordTextOnSide(side) {
  const halfWidth = window.innerWidth / 2;
  const minX = side === "right" ? halfWidth : 0;
  const maxX = side === "left" ? halfWidth : window.innerWidth;

  const range = document.createRange();
  const nodeIterator = document.createNodeIterator(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function (node) {
        if (node.nodeValue.trim().length > 0) {
          range.selectNodeContents(node);
          const rect = range.getBoundingClientRect();
          if (
            rect.right > minX &&
            rect.left < maxX &&
            rect.bottom > 0 &&
            rect.top < window.innerHeight
          ) {
            return NodeFilter.FILTER_ACCEPT;
          }
        }
        return NodeFilter.FILTER_REJECT;
      },
    }
  );

  let documentNode;
  while ((documentNode = nodeIterator.nextNode())) {
    const words = documentNode.nodeValue.trim().split(/\s+/);
    if (words.length > 0) {
      for (let i = 0; i < words.length; i++) {
        const wordIndex = documentNode.nodeValue.indexOf(words[i]);
        const wordRange = document.createRange();
        wordRange.setStart(documentNode, wordIndex);
        wordRange.setEnd(documentNode, wordIndex + words[i].length);

        const wordRect = wordRange.getBoundingClientRect();
        const wordCenter = (wordRect.left + wordRect.right) / 2;

        if (
          wordCenter >= minX &&
          wordCenter < maxX &&
          wordRect.bottom > 0 &&
          wordRect.top < window.innerHeight
        ) {
          return { text: getTextFrom(words[i], wordRange) };
        }
      }
    }
  }

  return null;
}

/// User Settings.

export function setCSSProperties(properties) {
  for (const name in properties) {
    setProperty(name, properties[name]);
  }
}

// For setting user setting.
export function setProperty(key, value) {
  if (value === null) {
    removeProperty(key);
  } else {
    var root = document.documentElement;
    // The `!important` annotation is added with `setProperty()` because if it's part of the
    // `value`, it will be ignored by the Web View.
    root.style.setProperty(key, value, "important");
  }
}

// For removing user setting.
export function removeProperty(key) {
  var root = document.documentElement;

  root.style.removeProperty(key);
}

/// Toolkit

export var DEBUG_MODE = false;

function debounce(delay, func) {
  var timeout;
  return function () {
    var self = this;
    var args = arguments;
    function callback() {
      func.apply(self, args);
      timeout = null;
    }
    clearTimeout(timeout);
    timeout = setTimeout(callback, delay);
  };
}

export function log() {
  if (DEBUG_MODE) {
    var message = Array.prototype.slice.call(arguments).join(" ");
    Android.log(message);
  }
}

export function logError(message) {
  if (DEBUG_MODE) {
    Android.logError(message, "", 0);
  }
}

/**
 * Resolves the page box the OCR overlay percentages are relative to.
 *
 * An `.ocr-container` whose children are all absolutely positioned has no in-flow content
 * and a 0x0 box; its sized child then carries both the page dimensions and the container's
 * offset. An ancestor is a last resort, as it loses that offset.
 *
 * @param {Element} ocrContainer
 * @returns {DOMRect | null}
 */
function getOCRReferenceRect(ocrContainer) {
  const hasArea = (rect) => rect.width > 0 && rect.height > 0;

  const img = ocrContainer.querySelector("img");
  if (img && hasArea(img.getBoundingClientRect())) {
    return img.getBoundingClientRect();
  }

  const containerRect = ocrContainer.getBoundingClientRect();
  if (hasArea(containerRect)) {
    return containerRect;
  }

  for (const child of ocrContainer.children) {
    const childRect = child.getBoundingClientRect();
    if (hasArea(childRect)) {
      return childRect;
    }
  }

  let element = ocrContainer.parentElement;
  while (element) {
    const rect = element.getBoundingClientRect();
    if (hasArea(rect)) {
      return rect;
    }
    element = element.parentElement;
  }

  return null;
}

/**
 * Calculates corrected viewport coordinates for OCR text-overlay elements.
 *
 * Returns null when the range is not inside an OCR overlay.
 */
export function getOCRCorrectedRect(range) {
  if (!range) {
    return null;
  }

  let startNode = range.startContainer;
  if (!startNode) {
    return null;
  }
  if (startNode.nodeType === Node.TEXT_NODE) {
    startNode = startNode.parentElement;
  }
  if (!startNode || typeof startNode.closest !== "function") {
    return null;
  }

  const textOverlayElement = startNode.closest(".text-overlay");
  if (!textOverlayElement) {
    return null;
  }

  const ocrContainer = textOverlayElement.closest(".ocr-container");
  if (!ocrContainer) {
    return null;
  }

  const containerRect = getOCRReferenceRect(ocrContainer);
  if (!containerRect) {
    return null;
  }

  const styleTop = textOverlayElement.style.top;
  const styleLeft = textOverlayElement.style.left;
  const styleWidth = textOverlayElement.style.width;
  const styleHeight = textOverlayElement.style.height;

  if (
    styleTop &&
    styleLeft &&
    styleTop.includes("%") &&
    styleLeft.includes("%") &&
    styleWidth &&
    styleHeight &&
    styleWidth.includes("%") &&
    styleHeight.includes("%")
  ) {
    const topPercent = parseFloat(styleTop) / 100;
    const leftPercent = parseFloat(styleLeft) / 100;
    const widthPercent = parseFloat(styleWidth) / 100;
    const heightPercent = parseFloat(styleHeight) / 100;

    const scaledTop = containerRect.top + containerRect.height * topPercent;
    const scaledLeft = containerRect.left + containerRect.width * leftPercent;
    const scaledWidth = containerRect.width * widthPercent;
    const scaledHeight = containerRect.height * heightPercent;

    return {
      left: scaledLeft,
      top: scaledTop,
      right: scaledLeft + scaledWidth,
      bottom: scaledTop + scaledHeight,
      width: scaledWidth,
      height: scaledHeight,
      x: scaledLeft,
      y: scaledTop,
    };
  }

  return null;
}

/**
 * Gets the bounding rect of a range from a locator.
 * @param {Object} locator - The locator object.
 * @returns {DOMRect | null} - The bounding rect of the range, or null if not found.
 */
export function getRectFromLocator(locator) {
  let range = rangeFromLocator(locator);
  if (range) {
    const ocrRect = getOCRCorrectedRect(range);
    if (ocrRect) {
      return toNativeRect(ocrRect);
    }
    return toNativeRect(range.getBoundingClientRect());
  }
  return null;
}

export function getHtmlBodyTextContent() {
  return document.body.textContent;
}

export function calculateHorizontalPageRanges() {
  const rangeData = {};
  let node = document.body.firstChild;
  let currentPage = 0;
  let rangeIndex = 0;
  // Use the global pageWidth instead of window.innerWidth for consistency
  const pageWidthValue = pageWidth > 1 ? pageWidth : window.innerWidth;

  // const pagesPerRange = 2;
  let currentTextLength = 0;
  const minCharactersPerRange = 1000;
  let previousElementRect = new DOMRect(0, 0, 0, 0);
  // Track last range key to avoid Object.keys() calls
  let lastRangeKey = null;
  // A <br> breaks the line without contributing a character, so emitting one here unconditionally
  // makes this text longer than document.body.textContent — the space every offset resolves in.
  // Held until the next text arrives, and dropped unless it is the only thing separating two
  // words (RR-8661).
  let pendingLineBreak = false;

  function processElement(element) {
    if (DEBUG_MODE) log("node name " + element.nodeName);

    // Cache textContent to avoid multiple DOM queries
    const elementTextContent = element.textContent;
    if (DEBUG_MODE) log("<" + elementTextContent + ">");

    let rect;

    let processText = false;
    if (element.nodeType === Node.TEXT_NODE) {
      if (/\S/.test(elementTextContent)) {
        processText = true;
        let range = document.createRange();
        range.selectNode(element);
        rect = range.getBoundingClientRect();
      } else {
        if (DEBUG_MODE) log("node text does not have text");
        addTextToRange(elementTextContent, rangeIndex);
      }
    } else if (
      element.nodeType === Node.ELEMENT_NODE &&
      elementTextContent.length > 0
    ) {
      processText = true;
      rect = element.getBoundingClientRect();
    } else if (element.nodeName === "br") {
      if (DEBUG_MODE) log(`holding br as new line`);
      pendingLineBreak = true;
    }

    if (processText) {
      rect.x += window.scrollX;

      if (DEBUG_MODE) log("rect x: " + rect.x);
      if (DEBUG_MODE) log("rext width: " + rect.width);
      if (DEBUG_MODE) log("current page: " + currentPage);
      if (DEBUG_MODE) log("current text length: " + currentTextLength);
      if (DEBUG_MODE) log("current page x: " + currentPage * pageWidthValue);
      if (DEBUG_MODE) log("next page x: " + (currentPage + 1) * pageWidthValue);

      // Use >= instead of > to handle boundary cases correctly
      if (rect.x >= (currentPage + 1) * pageWidthValue) {
        const pageDiff = rect.x / pageWidthValue - currentPage;
        // Ensure additionalPages is non-negative
        const additionalPages = Math.max(0, Math.floor(pageDiff));
        currentPage = currentPage + additionalPages;
        if (DEBUG_MODE) log("increase current page: " + currentPage);

        if (DEBUG_MODE) log("previous rect x: " + previousElementRect.x);
        if (DEBUG_MODE)
          log("previous rect width: " + previousElementRect.width);

        // if previousElementRect.x + previousElementRect.width is more than curent page x+width, then we compare with next next page max x

        let maxX = previousElementRect.x + previousElementRect.width;
        if (maxX > (currentPage + 1) * pageWidthValue) {
          maxX = (currentPage + 2) * pageWidthValue;
        }
        if (currentTextLength >= minCharactersPerRange && maxX < rect.x) {
          rangeIndex++;
          // currentTextLength = 0;
          if (DEBUG_MODE) log("increase range index: " + rangeIndex);
          currentTextLength = elementTextContent.length;
          addTextToRange(elementTextContent, rangeIndex);
          previousElementRect = rect;
          return;
        }
      }

      if (
        currentTextLength >= minCharactersPerRange &&
        rect.x + rect.width > (currentPage + 1) * pageWidthValue
      ) {
        if (DEBUG_MODE) log("paragraph does not fit on current page");
        processTextContent(element, elementTextContent);
      } else {
        // if (
        //   currentTextLength + elementTextContent.length >
        //   minCharactersPerRange
        // ) {
        //   log("paragraph is too big; analyze words");
        //   processTextContent(element, elementTextContent);
        // } else {
        if (DEBUG_MODE) log("add entire paragraph");
        currentTextLength += elementTextContent.length;
        addTextToRange(elementTextContent, rangeIndex);
        // }
      }

      previousElementRect = rect;
    }
  }

  function processTextContent(element, textContent) {
    const pageRightEdge = (currentPage + 1) * pageWidthValue;

    // Keeping the delimiters preserves each token's offset, so its rect resolves from that
    // rather than from a search for its text.
    const tokens = [];
    let tokenOffset = 0;
    for (const part of textContent.split(/(\s|[-–—―‒])/g)) {
      if (part.length > 0) {
        tokens.push({ text: part, start: tokenOffset });
      }
      tokenOffset += part.length;
    }

    const measurable = [];
    for (let index = 0; index < tokens.length; index++) {
      if (/\S/.test(tokens[index].text)) {
        measurable.push(index);
      }
    }

    function rectForToken(index) {
      const token = tokens[index];
      const range = rangeFromTextOffsets(
        element,
        token.start,
        token.start + token.text.length
      );
      if (!range) {
        if (DEBUG_MODE) log("could not find range for word");
        return null;
      }

      const rect = range.getBoundingClientRect();
      return new DOMRect(
        rect.x + window.scrollX,
        rect.y,
        rect.width,
        rect.height
      );
    }

    // Tokens wrap into later columns in order, so "past the page edge" only ever flips false to
    // true — the split point is a binary search, not a walk back from the end.
    let low = 0;
    let high = measurable.length - 1;
    let lastFitting = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const rect = rectForToken(measurable[middle]);
      if (rect && rect.x + rect.width <= pageRightEdge) {
        lastFitting = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    if (DEBUG_MODE && measurable.length > 0) {
      const lastRect = rectForToken(measurable[measurable.length - 1]);
      if (lastRect && lastRect.x > (currentPage + 2) * pageWidthValue) {
        log("text does not fit on the next page");
      }
    }

    if (lastFitting === -1 && measurable.length > 0) {
      const firstRect = rectForToken(measurable[0]);
      if (firstRect && firstRect.x > pageRightEdge) {
        // This should never happen!!!
        if (DEBUG_MODE) log("this should never happen");
        rangeIndex += 1;
        currentPage += 1; // Move to the next page
        //TODO the element must go through the regular processing in this case
        currentTextLength = textContent.length;
        addTextToRange(textContent, rangeIndex);
        return;
      }
    }

    const splitToken = lastFitting === -1 ? 0 : measurable[lastFitting] + 1;
    const splitOffset =
      splitToken < tokens.length
        ? tokens[splitToken].start
        : textContent.length;

    addTextToRange(textContent.slice(0, splitOffset), rangeIndex);
    currentPage += 1;
    rangeIndex += 1;

    // TODO do we need to also check the current text length here????
    const remainderText = textContent.slice(splitOffset);
    currentTextLength = remainderText.length;
    addTextToRange(remainderText, rangeIndex);
  }

  function addTextToRange(text, range) {
    const rangeKey = range.toString();
    const existingText = rangeData[rangeKey];

    if (pendingLineBreak) {
      pendingLineBreak = false;
      const precedingText =
        existingText !== undefined
          ? existingText
          : lastRangeKey !== null
          ? rangeData[lastRangeKey]
          : "";
      text = lineBreakSeparator(precedingText, text) + text;
    }

    if (existingText !== undefined) {
      const newText = existingText + text;
      rangeData[rangeKey] = newText;
    } else {
      rangeData[rangeKey] = text;
      // Update last range key when adding to a new range
      if (
        lastRangeKey === null ||
        parseInt(rangeKey) > parseInt(lastRangeKey)
      ) {
        lastRangeKey = rangeKey;
      }
    }

    if (DEBUG_MODE) log("adding text: <" + text + ">");
    if (DEBUG_MODE) log("to range index: " + range);
  }

  function processNode(node) {
    if (DEBUG_MODE)
      log(
        `process node with name : ${node.nodeName} and type: ${node.nodeType}`
      );

    // Disabling this until we find a way to integrate this in the app;

    // if (node.nodeType === Node.ELEMENT_NODE && node.textContent.length > 0) {
    //   // Check the opacity of the element
    //   let computedStyle = window.getComputedStyle(node);
    //   let opacity = computedStyle.opacity;

    //   if (opacity === "0") {
    //     log(`Element has opacity 0, skipping processing: ${node.textContent}`);
    //     return;
    //   }
    // }

    // log("process node <" + node.textContent + ">");

    // Use tracked lastRangeKey instead of Object.keys() for better performance
    if (node.nodeName === "p" && lastRangeKey !== null) {
      const lastItem = rangeData[lastRangeKey];
      if (lastItem && !/\s$/.test(lastItem)) {
        if (DEBUG_MODE) log(`appending new line before paragraph`);
        addTextToRange("\n", rangeIndex);
      }
    }

    if (node.childNodes.length > 0) {
      let child = node.firstChild;
      while (child) {
        // log("<         1         >");
        processNode(child);
        child = child.nextSibling;
      }
    } else {
      processElement(node);
    }
  }

  while (node) {
    processNode(node);
    node = node.nextSibling;
  }

  return rangeData;
}
