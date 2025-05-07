//
//  Copyright 2021 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

import { toNativeRect } from "./rect";
import { TextQuoteAnchor } from "./vendor/hypothesis/anchoring/types";

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

export function getColumnCountPerScreen() {
  return parseInt(
    window
      .getComputedStyle(document.documentElement)
      .getPropertyValue("column-count")
  );
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
  return document.body.dir.toLowerCase() == "rtl";
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
  //        Android.log("scrollToPosition " + position);
  if (position < 0 || position > 1) {
    throw "scrollToPosition() must be given a position from 0.0 to  1.0";
  }

  let offset;
  if (isScrollModeEnabled()) {
    offset = document.scrollingElement.scrollHeight * position;
    document.scrollingElement.scrollTop = offset;
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
  //        Android.log("scrollToStart");
  if (!isScrollModeEnabled()) {
    document.scrollingElement.scrollLeft = 0;
  } else {
    document.scrollingElement.scrollTop = 0;
    window.scrollTo(0, 0);
  }
}

export function scrollToEnd() {
  //        Android.log("scrollToEnd");
  if (!isScrollModeEnabled()) {
    var factor = isRTL() ? -1 : 1;
    document.scrollingElement.scrollLeft = snapOffset(
      document.scrollingElement.scrollWidth * factor
    );
  } else {
    document.scrollingElement.scrollTop = document.body.scrollHeight;
    window.scrollTo(0, document.body.scrollHeight);
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

// Cache the higher level css elements range for faster calculating the word by word dom ranges
let elementRangeCache = new LRUCache(10); // Key: cssSelector, Value: entire element range

// Caches the css element range
function cacheElementRange(cssSelector) {
  const element = document.querySelector(cssSelector);
  if (element) {
    const range = document.createRange();
    range.selectNodeContents(element);
    elementRangeCache.set(cssSelector, range);
  }
}

// Returns a range from a locator; it first searches for the higher level css element in the cache
function rangeFromCachedLocator(locator) {
  const cssSelector = locator.locations.cssSelector;
  const entireRange = elementRangeCache.get(cssSelector);
  if (!entireRange) {
    cacheElementRange(cssSelector);
    return rangeFromCachedLocator(locator);
  }

  const entireText = entireRange.toString();
  let startIndex = 0;
  let foundIndex = -1;

  while (startIndex < entireText.length) {
    const highlightIndex = entireText.indexOf(
      locator.text.highlight,
      startIndex
    );
    if (highlightIndex === -1) {
      break; // No more occurrences of highlight text
    }

    const beforeText = locator.text.before
      ? entireText.slice(
          Math.max(0, highlightIndex - locator.text.before.length),
          highlightIndex
        )
      : "";
    const afterText = locator.text.after
      ? entireText.slice(
          highlightIndex + locator.text.highlight.length,
          highlightIndex +
            locator.text.highlight.length +
            locator.text.after.length
        )
      : "";

    const beforeTextMatches =
      !locator.text.before || locator.text.before.endsWith(beforeText);
    const afterTextMatches =
      !locator.text.after || locator.text.after.startsWith(afterText);

    if (beforeTextMatches && afterTextMatches) {
      // Highlight text from locator was found
      foundIndex = highlightIndex;
      break;
    }

    // Update startIndex for next iteration to search for next occurrence of highlight text
    startIndex = highlightIndex + 1;
  }

  if (foundIndex === -1) {
    throw new Error("Locator range could not be calculated");
  }

  const highlightStartIndex = foundIndex;
  const highlightEndIndex = foundIndex + locator.text.highlight.length;

  const subRange = document.createRange();
  let count = 0;
  let node;
  const nodeIterator = document.createNodeIterator(
    entireRange.commonAncestorContainer, // This should be a Document or DocumentFragment node
    NodeFilter.SHOW_TEXT
  );

  for (node = nodeIterator.nextNode(); node; node = nodeIterator.nextNode()) {
    const nodeEndIndex = count + node.nodeValue.length;
    if (nodeEndIndex > startIndex) {
      break;
    }
    count = nodeEndIndex;
  }

  subRange.setStart(node, highlightStartIndex - count);
  subRange.setEnd(node, highlightEndIndex - count);

  return subRange;
}

export function rangeFromLocator(locator) {
  try {
//    log("=========================")
    log("rangeFromLocator: locator", JSON.stringify(locator));
    let locations = locator.locations;
    let text = locator.text;
    if (text && text.highlight) {
      var root;
      if (locations && locations.cssSelector) {
        try {
          const range = rangeFromCachedLocator(locator);
//            log("rangeFromLocator: found range from cached locator", range);
          return range;
        } catch {
          log("failed getting the range from css selector");
          // root = document.querySelector(locations.cssSelector);
        }
      }

      if (!root) {
        root = document.body;
      }

      let start = null;
      let end = null;

      if (locations && root.textContent.length > 0) {
        // If there is info about the start and end positions from the client, use that
        if (locations.start !== undefined && locations.end !== undefined) {
//          log("actual start and end:", locations.start, locations.end, root.textContent.length);
          start = Math.max(locations.start-10, 0);
          end = Math.min(locations.end+10, root.textContent.length);
//          log("adjusted start and end: ",start, end, root.textContent.length);
        }
      }

       log("rangeFromLocator: Text at actual range: [", root.textContent.slice(locations.start,locations.end),"]");
       log("rangeFromLocator: Text at adjusted range: ", root.textContent.slice(start, end));

      let anchor = new TextQuoteAnchor(root, text.highlight, {
        prefix: text.before,
        suffix: text.after,
      });

      log("rangeFromLocator: anchor", JSON.stringify(anchor), text.highlight ,start, end);
      let result = anchor.toRange({}, start, end);
      log("rangeFromLocator: found range", result);
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
        log("rangeFromLocator: found element", element);
        return range;
      }
    }
  } catch (e) {
    logError("Cannot parse range "+e);
  }

  return null;
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
 * Gets the bounding rect of a range from a locator.
 * @param {Object} locator - The locator object.
 * @returns {DOMRect | null} - The bounding rect of the range, or null if not found.
 */
export function getRectFromLocator(locator) {
  let range = rangeFromLocator(locator);
  if (range) {
    return toNativeRect(range.getBoundingClientRect());
  }
  return null;
}

export function getHtmlBodyTextContent() {
  return document.body.textContent;
}

export function calculateHorizontalPageRanges() {
  const currentScrollX = window.scrollX;
  const currentInnerWidth = window.innerWidth;

  const rangeData = {};
  let node = document.body.firstChild;
  let currentPage = 0;
  let rangeIndex = 0;
  let pageWidth = currentInnerWidth;

  // const pagesPerRange = 2;
  let currentTextLength = 0;
  const minCharactersPerRange = 1000;
  let previousElementRect = new DOMRect(0, 0, 0, 0);

  function processElement(element) {
    // log("node name " + element.nodeName);
    // log("<" + element.textContent + ">");

    let rect;

    let processText = false;
    if (element.nodeType === Node.TEXT_NODE) {
      if (/\S/.test(element.textContent)) {
        processText = true;
        let range = document.createRange();
        range.selectNode(element);
        rect = range.getBoundingClientRect();
      } else {
        // log("node text does not have text");
        addTextToRange(element.textContent, rangeIndex);
      }
    } else if (
      element.nodeType === Node.ELEMENT_NODE &&
      element.textContent.length > 0
    ) {
      processText = true;
      rect = element.getBoundingClientRect();
    } else if (element.nodeName === "br") {
      // log(`adding br as new line`);
      addTextToRange("\n", rangeIndex);
    }

    if (processText) {
      rect.x += currentScrollX;

      // log("rect x: " + rect.x);
      // log("rext width: " + rect.width);
      // log("current page: " + currentPage);
      // log("current text length: " + currentTextLength);
      // log("current page x: " + currentPage * pageWidth);
      // log("next page x: " + (currentPage + 1) * pageWidth);

      if (rect.x > (currentPage + 1) * pageWidth) {
        const additionalPages = Math.floor(rect.x / pageWidth - currentPage);
        currentPage = currentPage + additionalPages;
        // log("increase current page: " + currentPage);

        // log("previous rect x: " + previousElementRect.x);
        // log("previous rect width: " + previousElementRect.width);

        // if previousElementRect.x + previousElementRect.width is more than curent page x+width, then we compare with next next page max x

        let maxX = previousElementRect.x + previousElementRect.width;
        if (maxX > (currentPage + 1) * pageWidth) {
          maxX = (currentPage + 1) * pageWidth + pageWidth;
        }
        if (currentTextLength >= minCharactersPerRange && maxX < rect.x) {
          rangeIndex++;
          // currentTextLength = 0;
          // log("increase range index: " + rangeIndex);
          currentTextLength = element.textContent.length;
          addTextToRange(element.textContent, rangeIndex);
          previousElementRect = rect;
          return;
        }
      }

      if (
        currentTextLength >= minCharactersPerRange &&
        rect.x + rect.width > (currentPage + 1) * pageWidth
      ) {
        // log("paragraph does not fit on current page");
        processTextContent(element, element.textContent);
      } else {
        // if (
        //   currentTextLength + element.textContent.length >
        //   minCharactersPerRange
        // ) {
        //   log("paragraph is too big; analyze words");
        //   processTextContent(element, element.textContent);
        // } else {
        // log("add entire paragraph");
        currentTextLength += element.textContent.length;
        addTextToRange(element.textContent, rangeIndex);
        // }
      }

      previousElementRect = rect;
    }
  }

  function processTextContent(element, textContent) {
    const originalWords = textContent.split(/(\s|[-–—―‒])/g).filter(Boolean);
    if (originalWords.length === 0) {
      // No words to process, though textContent was presumably non-empty to call this.
      // This case should ideally not be hit if called with non-empty textContent.
      return;
    }

    let low = 0;
    let high = originalWords.length;
    let bestFitNumWords = 0;

    // Binary search for the maximum number of words that fit
    while (low <= high) {
      let midNumWords = low + Math.floor((high - low) / 2);
      if (midNumWords === 0) {
        // 0 words always fit.
        bestFitNumWords = Math.max(bestFitNumWords, midNumWords); // Ensure bestFitNumWords can be 0
        low = midNumWords + 1;
        continue;
      }

      const currentWords = originalWords.slice(0, midNumWords);
      const textToTest = currentWords.join("");

      try {
        let rect;
        // Use TextQuoteAnchor to find the first occurrence of textToTest from the start of the element.
        // We assume textToTest is unique enough at the start or TextQuoteAnchor picks the first one.
        let anchor = new TextQuoteAnchor(element, textToTest, { prefix: "", suffix: "" });
        let range = anchor.toRange();
        rect = range.getBoundingClientRect();
        rect.x += currentScrollX;

        if (rect.x + rect.width <= (currentPage + 1) * pageWidth) {
          // This number of words fits. Try more.
          bestFitNumWords = midNumWords;
          low = midNumWords + 1;
        } else {
          // This number of words overflows. Try fewer.
          high = midNumWords - 1;
        }
      } catch (e) {
        // If TextQuoteAnchor fails (e.g., text not found, which shouldn't happen for slice(0, N)),
        // or if getBoundingClientRect fails, treat as overflow to be safe.
        // logError("Error in processTextContent binary search: " + e);
        high = midNumWords - 1;
      }
    }

    const fittingText = originalWords.slice(0, bestFitNumWords).join("");
    const overflowingText = originalWords.slice(bestFitNumWords).join("");

    addTextToRange(fittingText, rangeIndex);
    currentTextLength += fittingText.length; // Add to current range's text length

    if (overflowingText.length > 0) {
      currentPage++;
      rangeIndex++;
      currentTextLength = overflowingText.length; // Reset for the new range
      addTextToRange(overflowingText, rangeIndex);
    }
    // If overflowingText is empty, currentTextLength has been correctly updated for the current range.
  }

  function addTextToRange(text, range) {
    const existingText = rangeData[range.toString()];
    if (existingText !== undefined) {
      const newText = existingText + text;
      rangeData[range.toString()] = newText;
    } else {
      rangeData[range.toString()] = text;
    }

    // log("adding text: <" + text + ">");
    // log("to range index: " + range);
  }

  function processNode(node) {
    // log(`process node with name : ${node.nodeName} and type: ${node.nodeType}`);

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

    const keys = Object.keys(rangeData);

    if (node.nodeName === "p" && keys.length > 0) {
      const lastKey = keys[keys.length - 1];
      const lastItem = rangeData[lastKey];
      if (!/\s$/.test(lastItem)) {
        // log(`appending new line before paragraph`);
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
