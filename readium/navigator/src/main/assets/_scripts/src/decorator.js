//
//  Copyright 2021 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

import {
  getClientRectsNoOverlap,
  rectContainsPoint,
  toNativeRect,
} from "./rect";
import { setupScalingListeners } from "./scaling.js";
import { getOCRCorrectedRect, log, logError, rangeFromLocator } from "./utils";

let styles = new Map();
let groups = new Map();
var lastGroupId = 0;
const PAGE_NUMBER_DEBUG = false;
const PAGE_NUMBER_REGEX = /^\d+$/;

const ENTITY_MAP = {
  "&rsquo;": "'",
  "&lsquo;": "'",
  "&rdquo;": '"',
  "&ldquo;": '"',
  "&ndash;": "–",
  "&mdash;": "—",
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
};
const ENTITY_PATTERN = new RegExp(Object.keys(ENTITY_MAP).join("|"), "gi");

const LIGATURE_MAP = {
  "\uFB00": "ff",
  "\uFB01": "fi",
  "\uFB02": "fl",
  "\uFB03": "ffi",
  "\uFB04": "ffl",
  "\uFB05": "st",
  "\uFB06": "st",
  "\u0132": "IJ",
  "\u0133": "ij",
  "\u0152": "OE",
  "\u0153": "oe",
};
const LIGATURE_PATTERN = new RegExp(Object.keys(LIGATURE_MAP).join("|"), "g");

// Cache for expensive computed style calls
let documentWritingModeCache = null;
let documentColumnCountCache = null;
let viewportListenersAttached = false;
let relayoutScheduled = false;

/**
 * Returns the document body's writing mode (cached).
 */
function getDocumentWritingMode() {
  if (documentWritingModeCache === null) {
    documentWritingModeCache = getComputedStyle(document.body).writingMode;
  }
  return documentWritingModeCache;
}

/**
 * Clears cached computed styles (call after DOM changes that affect styles).
 */
function clearStyleCache() {
  documentWritingModeCache = null;
  documentColumnCountCache = null;
}

function pageNumberLog(...args) {
  if (PAGE_NUMBER_DEBUG) {
    log(...args);
  }
}

function safeRatio(a, b) {
  if (a === 0 && b === 0) {
    return 1;
  }
  if (a === 0 || b === 0) {
    return 0;
  }
  return a < b ? a / b : b / a;
}

function requestGroupsLayout() {
  if (relayoutScheduled) {
    return;
  }
  relayoutScheduled = true;

  requestAnimationFrame(() => {
    relayoutScheduled = false;
    clearStyleCache();
    groups.forEach(function (group) {
      group.requestLayout();
    });
  });
}

function setupViewportRelayoutListeners() {
  if (viewportListenersAttached) {
    return;
  }
  viewportListenersAttached = true;

  const onViewportChanged = () => requestGroupsLayout();

  window.addEventListener("readium:viewport-changed", onViewportChanged);
  window.addEventListener("orientationchange", onViewportChanged, {
    passive: true,
  });
  window.addEventListener("resize", onViewportChanged, { passive: true });

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", onViewportChanged, {
      passive: true,
    });
  }
}

/**
 * Returns the closest element ancestor of the given node.
 */
function getContainingElement(node) {
  return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
}

function rotationDegreesFromTransform(transform) {
  if (!transform || transform === "none") {
    return undefined;
  }

  const rotateMatch = transform.match(/rotate\(([-\d.]+)deg\)/);
  if (rotateMatch) {
    const angle = parseFloat(rotateMatch[1]);
    return Number.isFinite(angle) ? angle : undefined;
  }

  try {
    const matrix = new DOMMatrixReadOnly(transform);
    const angle = (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI;
    if (Number.isFinite(angle) && Math.abs(angle) > 0.01) {
      return angle;
    }
  } catch (error) {
    return undefined;
  }

  return undefined;
}

function getClosestRotationDegrees(node, boundaryElement = null) {
  let element = getContainingElement(node);
  while (element) {
    const style = window.getComputedStyle(element);
    const angle = rotationDegreesFromTransform(style.transform);
    if (angle !== undefined) {
      return angle;
    }
    if (boundaryElement && element === boundaryElement) {
      break;
    }
    element = element.parentElement;
  }
  return undefined;
}

/**
 * Registers a list of additional supported Decoration Templates.
 *
 * Each template object is indexed by the style ID.
 */
export function registerTemplates(newStyles) {
  var stylesheet = "";

  for (const [id, style] of Object.entries(newStyles)) {
    styles.set(id, style);
    if (style.stylesheet) {
      stylesheet += style.stylesheet + "\n";
    }
  }

  if (stylesheet) {
    let styleElement = document.createElement("style");
    styleElement.innerHTML = stylesheet;
    document.getElementsByTagName("head")[0].appendChild(styleElement);
  }

  // Append our containment style for the visible area
  let containStyle = document.createElement("style");
  containStyle.innerHTML = `
    .visible-area {
      contain: layout paint style;
      position: absolute;
      width: 100%;
      height: 100%;
      top: 0px;
    }
  `;
  document.head.appendChild(containStyle);

  let imgStyle = document.createElement("style");
  imgStyle.innerHTML = `
    img {
      pointer-events: none;
    }
  `;
  document.head.appendChild(imgStyle);

  // Decode common entities before further text normalization.
  document.body.innerHTML = document.body.innerHTML.replace(
    ENTITY_PATTERN,
    (match) => ENTITY_MAP[match.toLowerCase()]
  );

  // Replace common Unicode ligatures.
  document.body.innerHTML = document.body.innerHTML.replace(
    LIGATURE_PATTERN,
    (match) => LIGATURE_MAP[match]
  );

  // Add newlines before <div> and <p> tags to preserve line breaks if a new line is not present
  document.body.innerHTML = document.body.innerHTML.replace(
    /([^\n])<(div|p)/g,
    "$1\n<$2"
  );

  // Add newlines after </div> and </p> tags, but only if a newline doesn't already exist
  document.body.innerHTML = document.body.innerHTML.replace(
    /<\/(div|p)>([^\n])/g,
    "</$1>\n$2"
  );

  // Replace all br tag variants with the same tags plus a newline character
  // This handles both <br/> and <br /> formats in a single operation
  document.body.innerHTML = document.body.innerHTML.replace(
    /<br\s*\/>/g,
    "$&\n"
  );

  // Process span elements to ensure proper text spacing
  processSpansForTextSpacing();

  // Setup scaling listeners after initial DOM modifications
  setupScalingListeners();
  setupViewportRelayoutListeners();
}

/**
 * Processes spans in the document to ensure proper spacing between text segments.
 * This prevents words from being incorrectly stitched together when extracting text.
 */
function processSpansForTextSpacing() {
  // Get all spans in the document - cache the query result
  const spans = document.querySelectorAll("span");
  const spansLength = spans.length;

  // Early return if no spans
  if (spansLength === 0) {
    return;
  }

  // Group spans by parent element to analyze siblings
  const spansByParent = new Map();
  for (let i = 0; i < spansLength; i++) {
    const span = spans[i];
    const parent = span.parentElement;
    const parentKey = parent || span;
    if (!spansByParent.has(parentKey)) {
      spansByParent.set(parentKey, []);
    }
    spansByParent.get(parentKey).push(span);
  }

  // First pass: Process spans and mark those that need spacing
  const spansNeedingSpacing = [];
  for (const siblingSpans of spansByParent.values()) {
    for (let i = 1; i < siblingSpans.length; i++) {
      const currentSpan = siblingSpans[i];
      const previousSpan = siblingSpans[i - 1];

      const currentBottom = parseFloat(currentSpan.style.bottom || "0");
      const previousBottom = parseFloat(previousSpan.style.bottom || "0");
      const currentLeft = parseFloat(currentSpan.style.left || "0");
      const previousLeft = parseFloat(previousSpan.style.left || "0");

      const bottomDifference = safeRatio(previousBottom, currentBottom);
      const leftDifference = safeRatio(previousLeft, currentLeft);

      if (
        bottomDifference < 0.87 ||
        leftDifference > 0.99 ||
        leftDifference < 0.1
      ) {
        spansNeedingSpacing.push(currentSpan);
      }
    }
  }

  // Second pass: Insert spaces where needed
  for (let i = 0; i < spansNeedingSpacing.length; i++) {
    const span = spansNeedingSpacing[i];
    if (span.parentElement) {
      span.parentElement.insertBefore(document.createTextNode(" "), span);
    }
  }
}

/**
 * Returns an instance of DecorationGroup for the given group name.
 */
export function getDecorations(groupName) {
  var group = groups.get(groupName);
  if (!group) {
    let id = "r2-decoration-" + lastGroupId++;
    group = DecorationGroup(id, groupName);
    groups.set(groupName, group);
  }
  return group;
}

/**
 * Handles click events on a Decoration.
 * Returns whether a decoration matched this event.
 */
export function handleDecorationClickEvent(event, clickEvent) {
  if (groups.size === 0) {
    return false;
  }

  function findTarget() {
    for (const [group, groupContent] of groups) {
      if (!groupContent.isActivable()) {
        continue;
      }

      // Iterate in reverse order (most recent first) but avoid creating new array
      const items = groupContent.items;
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        if (!item.clickableElements) {
          continue;
        }
        for (let j = 0; j < item.clickableElements.length; j++) {
          const element = item.clickableElements[j];
          let rect = element.getBoundingClientRect();
          if (rectContainsPoint(rect, event.clientX, event.clientY, 1)) {
            return { group, item, element, rect: rect.toJSON() };
          }
        }
      }
    }
  }

  let target = findTarget();
  if (!target) {
    return false;
  }

  return Android.onDecorationActivated(
    JSON.stringify({
      id: target.item.decoration.id,
      group: target.group,
      rect: toNativeRect(target.item.range.getBoundingClientRect()),
      click: clickEvent,
    })
  );
}

/**
 * Creates a DecorationGroup object from a unique HTML ID and its name.
 */
export function DecorationGroup(groupId, groupName) {
  var items = [];
  var container = null;
  var activable = false;
  var visibleContainers = [];
  var visibleContainersMap = new Map(); // O(1) lookup for visible containers

  function isActivable() {
    return activable;
  }

  function setActivable() {
    activable = true;
  }

  function emitHighlightRect(item, rect, ocrLayout = false) {
    Android.onHighlightRect(
      JSON.stringify({
        id: item.decoration.id,
        group: groupName,
        rect: rect,
        ocrLayout: ocrLayout,
      })
    );
  }

  /**
   * Adds a new decoration to the group.
   */
  function add(decoration) {
    let id = decoration.id;

    let range = rangeFromLocator(decoration.locator);
    if (!range) {
      log("Can't locate DOM range for decoration", decoration);
      return;
    }

    log("adding decoration", groupName, JSON.stringify(decoration));
    let item = { id, decoration, range, enhanced: false };
    items.push(item);
    layout(item, true);
  }

  function addEnhanced(decoration) {
    let id = decoration.id;

    let range = rangeFromLocator(decoration.locator);
    if (!range) {
      log("Can't locate DOM range for decoration", decoration);
      return;
    }

    let item = { id, decoration, range, enhanced: true };
    items.push(item);
    layoutEnhanced(item, true);
  }

  /**
   * Removes the decoration with given ID from the group.
   */
  function remove(decorationId) {
    let index = items.findIndex((i) => i.decoration.id === decorationId);
    if (index === -1) {
      return;
    }

    let item = items[index];
    items.splice(index, 1);
    item.clickableElements = null;
    if (item.container) {
      item.container.remove();
      item.container = null;
    }
  }

  /**
   * Notifies that the given decoration was modified and needs to be updated.
   */
  function update(decoration, enhanced) {
    remove(decoration.id);
    if (enhanced) {
      addEnhanced(decoration);
    } else {
      add(decoration);
    }
  }

  /**
   * Removes all decorations from this group.
   */
  function clear() {
    clearContainer();
    items.length = 0;
  }

  function clearAllEnhanced() {
    log("clearing all enhanced ", groupName, items);
    visibleContainers.forEach((container) => {
      log(`clearing container: ${container.id}`);
      container.remove();
    });

    visibleContainers.length = 0;
    visibleContainersMap.clear();
  }

  function clearEnhanced(decorationId) {
    // Iterate over each item in the items array
    log("trying to clear decoration: ", decorationId);
    items.forEach((item) => {
      // Check if the item's decoration id matches the one we want to remove
      if (item.decoration.id === decorationId && item.container) {
        item.container.remove();
      }
    });

    for (let index = items.length - 1; index >= 0; index--) {
      if (items[index].decoration.id === decorationId) {
        items.splice(index, 1);
      }
    }
  }

  /**
   * Recreates the decoration elements.
   *
   * To be called after reflowing the resource, for example.
   */
  function requestLayout() {
    log("requesting layout ", groupName, items.length);
    clearContainer();
    clearAllEnhanced();
    items.forEach((item) => {
      if (item.enhanced) {
        layoutEnhanced(item, false);
      } else {
        layout(item, false);
      }
    });
  }

  /**
   * Layouts a single Decoration item.
   */
  function layout(item, postMessage = true) {
    let groupContainer = requireContainer();

    let style = styles.get(item.decoration.style);
    if (!style) {
      logError(`Unknown decoration style: ${item.decoration.style}`);
      return;
    }

    let itemContainer = document.createElement("div");
    itemContainer.id = item.id;
    itemContainer.dataset.style = item.decoration.style;
    itemContainer.style.pointerEvents = "none";

    const documentWritingMode = getDocumentWritingMode();
    const isVertical =
      documentWritingMode === "vertical-rl" ||
      documentWritingMode === "vertical-lr";

    const scrollingElement = document.scrollingElement || document.documentElement;
    const { scrollLeft: xOffset, scrollTop: yOffset } = scrollingElement;
    const viewportWidth = isVertical ? window.innerHeight : window.innerWidth;
    const viewportHeight = isVertical ? window.innerWidth : window.innerHeight;

    // Use cached column count if available
    if (documentColumnCountCache === null) {
      documentColumnCountCache =
        parseInt(
          getComputedStyle(document.documentElement).getPropertyValue(
            "column-count"
          )
        ) || 1;
    }
    const columnCount = documentColumnCountCache;
    const pageSize =
      (isVertical ? viewportHeight : viewportWidth) / columnCount;

    function positionElement(element, rect, boundingRect, writingMode) {
      element.style.position = "absolute";
      const isVerticalRL = writingMode === "vertical-rl";
      const isVerticalLR = writingMode === "vertical-lr";

      if (isVerticalRL || isVerticalLR) {
        if (style.width === "wrap") {
          element.style.width = `${rect.width}px`;
          element.style.height = `${rect.height}px`;
          if (isVerticalRL) {
            element.style.right = `${
              -rect.right - xOffset + scrollingElement.clientWidth
            }px`;
          } else {
            // vertical-lr
            element.style.left = `${rect.left + xOffset}px`;
          }
          element.style.top = `${rect.top + yOffset}px`;
        } else if (style.width === "viewport") {
          element.style.width = `${rect.height}px`;
          element.style.height = `${viewportWidth}px`;
          const top = Math.floor(rect.top / viewportWidth) * viewportWidth;
          if (isVerticalRL) {
            element.style.right = `${-rect.right - xOffset}px`;
          } else {
            // vertical-lr
            element.style.left = `${rect.left + xOffset}px`;
          }
          element.style.top = `${top + yOffset}px`;
        } else if (style.width === "bounds") {
          element.style.width = `${boundingRect.height}px`;
          element.style.height = `${viewportWidth}px`;
          if (isVerticalRL) {
            element.style.right = `${
              -boundingRect.right - xOffset + scrollingElement.clientWidth
            }px`;
          } else {
            // vertical-lr
            element.style.left = `${boundingRect.left + xOffset}px`;
          }
          element.style.top = `${boundingRect.top + yOffset}px`;
        } else if (style.width === "page") {
          element.style.width = `${rect.height}px`;
          element.style.height = `${pageSize}px`;
          const top = Math.floor(rect.top / pageSize) * pageSize;
          if (isVerticalRL) {
            element.style.right = `${
              -rect.right - xOffset + scrollingElement.clientWidth
            }px`;
          } else {
            // vertical-lr
            element.style.left = `${rect.left + xOffset}px`;
          }
          element.style.top = `${top + yOffset}px`;
        }
      } else {
        if (style.width === "wrap") {
          element.style.width = `${rect.width}px`;
          element.style.height = `${rect.height}px`;
          element.style.left = `${rect.left + xOffset}px`;
          element.style.top = `${rect.top + yOffset}px`;
        } else if (style.width === "viewport") {
          element.style.width = `${viewportWidth}px`;
          element.style.height = `${rect.height}px`;
          const left = Math.floor(rect.left / viewportWidth) * viewportWidth;
          element.style.left = `${left + xOffset}px`;
          element.style.top = `${rect.top + yOffset}px`;
        } else if (style.width === "bounds") {
          element.style.width = `${boundingRect.width}px`;
          element.style.height = `${rect.height}px`;
          element.style.left = `${boundingRect.left + xOffset}px`;
          element.style.top = `${rect.top + yOffset}px`;
        } else if (style.width === "page") {
          element.style.width = `${pageSize}px`;
          element.style.height = `${rect.height}px`;
          const left = Math.floor(rect.left / pageSize) * pageSize;
          element.style.left = `${left + xOffset}px`;
          element.style.top = `${rect.top + yOffset}px`;
        }
      }
    }

    let boundingRect = item.range.getBoundingClientRect();

    let elementTemplate;
    try {
      let template = document.createElement("template");
      template.innerHTML = item.decoration.element.trim();
      elementTemplate = template.content.firstElementChild;
    } catch (error) {
      logError(
        `Invalid decoration element "${item.decoration.element}": ${error.message}`
      );
      return;
    }

    if (style.layout === "boxes") {
      const doNotMergeHorizontallyAlignedRects =
        !documentWritingMode.startsWith("vertical");
      const startElement =
        getContainingElement(item.range.startContainer) || document.body;
      // Decorated text may have a different writingMode from document body
      const decoratorWritingMode = getComputedStyle(startElement).writingMode;

      const clientRects = getClientRectsNoOverlap(
        item.range,
        doNotMergeHorizontallyAlignedRects
      ).sort((r1, r2) => {
        if (r1.top !== r2.top) return r1.top - r2.top;
        if (decoratorWritingMode === "vertical-rl") {
          return r2.left - r1.left;
        } else if (decoratorWritingMode === "vertical-lr") {
          return r1.left - r2.left;
        } else {
          return r1.left - r2.left;
        }
      });

      for (let clientRect of clientRects) {
        const line = elementTemplate.cloneNode(true);
        line.style.pointerEvents = "none";
        line.dataset.writingMode = decoratorWritingMode;
        positionElement(line, clientRect, boundingRect, documentWritingMode);
        itemContainer.append(line);
      }
    } else if (style.layout === "bounds") {
      const bounds = elementTemplate.cloneNode(true);
      bounds.style.pointerEvents = "none";
      bounds.dataset.writingMode = documentWritingMode;
      positionElement(bounds, boundingRect, boundingRect, documentWritingMode);

      itemContainer.append(bounds);
    } else {
      log("style layout: ", groupName, style.layout);
    }

    groupContainer.append(itemContainer);
    item.container = itemContainer;
    item.clickableElements = Array.from(
      itemContainer.querySelectorAll("[data-activable='1']")
    );
    if (item.clickableElements.length === 0) {
      item.clickableElements = Array.from(itemContainer.children);
    }

    if (postMessage) {
      emitHighlightRect(item, toNativeRect(boundingRect), false);
    }
  }

  function isPageNumber(text) {
    return !!text && PAGE_NUMBER_REGEX.test(text.trim());
  }

  function layoutEnhanced(item, postMessage = true) {
    const style = styles.get(item.decoration.style);
    if (!style) {
      logError(`Unknown decoration style: ${item.decoration.style}`);
      return;
    }

    function postMessageWithInvalidRect() {
      if (postMessage) {
        emitHighlightRect(item, { left: 0, top: 0, width: 0, height: 0 }, false);
      }
    }

    let boundingRect;
    let pageIndex;
    const viewportWidth = Math.max(window.innerWidth || 0, 1);
    try {
      boundingRect = item.range.getBoundingClientRect();
      const userInfo = item.decoration.userInfo || {};
      const shouldIgnoreOffscreen = userInfo.shoulNotBeIgnored !== true;
      if (
        shouldIgnoreOffscreen &&
        (boundingRect.left + boundingRect.width < 0 ||
          boundingRect.top + boundingRect.height < 0)
      ) {
        postMessageWithInvalidRect();
        return;
      }

      pageIndex = Math.floor((boundingRect.left + window.scrollX) / viewportWidth);
      if (!Number.isFinite(pageIndex)) {
        postMessageWithInvalidRect();
        return;
      }
      pageIndex = Math.max(0, pageIndex);
    } catch (error) {
      logError(`Error calculating page index: ${error.message}`);
      postMessageWithInvalidRect();
      return;
    }

    let startNode = item.range.startContainer;
    if (startNode && startNode.nodeType === Node.TEXT_NODE) {
      startNode = startNode.parentElement;
    }

    const text = item.decoration.locator.text.highlight || "";
    const startTime = performance.now();
    if (isPageNumber(text)) {
      pageNumberLog(`PAGE NUMBER :: page number detected: ${text}`);

      const isAtTopOrBottom =
        boundingRect.top < window.innerHeight * 0.2 ||
        boundingRect.top > window.innerHeight * 0.8;

      if (isAtTopOrBottom) {
        pageNumberLog(`PAGE NUMBER :: is at top or bottom: ${text}`);

        const before = item.decoration.locator.text.before || "";
        const after = item.decoration.locator.text.after || "";

        const beforeEndsWithPunctuationAndWhitespace = /[.!?;:]\s*$/.test(
          before
        );
        const beforeHasMultipleNewlines = /\n\s*\n/.test(before);
        const beforeEndsWithSignificantWhitespace = /\s{2,}$/.test(before);

        const beforeIsIsolated =
          before.length === 0 || before.endsWith("\n") || !/[a-zA-Z0-9]/.test(before);
        const afterIsIsolated =
          after.length === 0 || after.startsWith("\n") || !/[a-zA-Z0-9]/.test(after);

        let isDOMIsolated = false;
        try {
          let nodeForCheck = item.range.startContainer;
          if (nodeForCheck.nodeType === Node.TEXT_NODE) {
            nodeForCheck = nodeForCheck.parentElement;
          }

          const parentText = nodeForCheck.textContent.trim();
          const isOnlyPageNumber = parentText === text.trim();
          const parentHasMinimalContent = parentText.length <= 5;

          isDOMIsolated = isOnlyPageNumber || parentHasMinimalContent;

          pageNumberLog(
            `PAGE NUMBER :: DOM isolation check - parentText: "${parentText}", isOnlyPageNumber: ${isOnlyPageNumber}, isDOMIsolated: ${isDOMIsolated}`
          );
        } catch (error) {
          pageNumberLog(
            `PAGE NUMBER :: DOM isolation check failed: ${error.message}`
          );
        }

        const isIsolatedPageNumber = beforeIsIsolated && afterIsIsolated;
        const isIsolatedWithEnhancements =
          isIsolatedPageNumber ||
          (isDOMIsolated && afterIsIsolated) ||
          (beforeEndsWithPunctuationAndWhitespace &&
            isDOMIsolated &&
            after.length === 0) ||
          (beforeHasMultipleNewlines &&
            (after.length === 0 || after.startsWith("\n"))) ||
          (beforeEndsWithSignificantWhitespace &&
            isDOMIsolated &&
            after.length === 0);

        const endTime = performance.now();
        const elapsedTime = endTime - startTime;
        pageNumberLog(
          `PAGE NUMBER :: isolation check took ${elapsedTime.toFixed(
            3
          )} ms for: ${text}`
        );

        pageNumberLog(`PAGE NUMBER :: before: "${before}"`);
        pageNumberLog(
          `PAGE NUMBER :: before is empty: ${before.length === 0} | before ends in newline: ${before.endsWith(
            "\n"
          )} | before has no alphanumeric: ${!/[a-zA-Z0-9]/.test(before)}`
        );
        pageNumberLog(
          `PAGE NUMBER :: before ends with punctuation+whitespace: ${beforeEndsWithPunctuationAndWhitespace} | has multiple newlines: ${beforeHasMultipleNewlines} | ends with significant whitespace: ${beforeEndsWithSignificantWhitespace}`
        );

        pageNumberLog(`PAGE NUMBER :: after: "${after}"`);
        pageNumberLog(
          `PAGE NUMBER :: after is empty: ${after.length === 0} | after begins with newline: ${after.startsWith(
            "\n"
          )} | after has no alphanumeric: ${!/[a-zA-Z0-9]/.test(after)}`
        );
        pageNumberLog(
          `PAGE NUMBER :: original isolated: ${isIsolatedPageNumber} | with enhancements: ${isIsolatedWithEnhancements}`
        );

        if (isIsolatedWithEnhancements) {
          pageNumberLog(`PAGE NUMBER :: is isolated: ${text}`);
          postMessageWithInvalidRect();
          return;
        }
      }
    }

    const scrollingElement = document.scrollingElement || document.documentElement;
    const yOffset = scrollingElement.scrollTop;
    const xOffset = window.scrollX - pageIndex * viewportWidth;
    const visibleArea = applyContainmentToArea(pageIndex).visibleArea;

    let itemContainer = document.createElement("div");
    itemContainer.id = item.id;
    itemContainer.dataset.style = item.decoration.style;
    itemContainer.style.pointerEvents = "none";

    const ocrRect = getOCRCorrectedRect(item.range);
    let ocrLayout = false;
    let computedLeft = undefined;
    let computedTop = undefined;
    let computedWidth = undefined;
    let computedHeight = undefined;
    let rotationAngle = undefined;

    if (ocrRect) {
      ocrLayout = true;
      computedLeft = ocrRect.left;
      computedTop = ocrRect.top;
      computedWidth = `${ocrRect.width}px`;
      computedHeight = `${ocrRect.height}px`;

      let overlayStartNode = item.range.startContainer;
      if (overlayStartNode && overlayStartNode.nodeType === Node.TEXT_NODE) {
        overlayStartNode = overlayStartNode.parentElement;
      }
      const textOverlayElement = overlayStartNode?.closest(".text-overlay");
      if (textOverlayElement) {
        const closestAngle = getClosestRotationDegrees(
          overlayStartNode,
          textOverlayElement
        );
        if (closestAngle !== undefined) {
          rotationAngle = closestAngle;
        }

        const computedStyle = window.getComputedStyle(textOverlayElement);
        const transform = computedStyle.transform;
        if (rotationAngle === undefined && transform && transform !== "none") {
          const inlineAngle = rotationDegreesFromTransform(
            textOverlayElement.style.transform
          );
          if (inlineAngle !== undefined) {
            rotationAngle = inlineAngle;
          } else {
            rotationAngle = rotationDegreesFromTransform(transform);
          }
        }
      }
    }

    let elementTemplate;
    try {
      let template = document.createElement("template");
      template.innerHTML = item.decoration.element.trim();
      elementTemplate = template.content.firstElementChild;
    } catch (error) {
      logError(
        `Invalid decoration element "${item.decoration.element}": ${error.message}`
      );
      return;
    }

    function positionElement(
      element,
      rect,
      elementBoundingRect,
      useOverlayPosition = false
    ) {
      element.style.position = useOverlayPosition ? "fixed" : "absolute";
      const width = style.width;

      const leftPos =
        useOverlayPosition && computedLeft !== undefined
          ? computedLeft
          : rect.left;
      const topPos =
        useOverlayPosition && computedTop !== undefined ? computedTop : rect.top;
      const finalXOffset = useOverlayPosition ? 0 : xOffset;
      const finalYOffset = useOverlayPosition ? 0 : yOffset;

      if (width === "wrap") {
        if (
          useOverlayPosition &&
          computedWidth !== undefined &&
          computedHeight !== undefined
        ) {
          element.style.width = `${computedWidth}`;
          element.style.height = `${computedHeight}`;
        } else {
          element.style.width = `${rect.width}px`;
          element.style.height = `${rect.height}px`;
        }

        element.style.left = `${leftPos + finalXOffset}px`;
        element.style.top = `${topPos + finalYOffset}px`;
      } else if (width === "viewport") {
        element.style.width = `${viewportWidth}px`;
        element.style.height = `${rect.height}px`;
        element.style.left = `${finalXOffset}px`;
        element.style.top = `${topPos + finalYOffset}px`;
      } else if (width === "bounds") {
        element.style.width = `${elementBoundingRect.width}px`;
        element.style.height = `${rect.height}px`;
        element.style.left = `${elementBoundingRect.left + finalXOffset}px`;
        element.style.top = `${topPos + finalYOffset}px`;
      } else if (width === "page") {
        element.style.width = `${viewportWidth}px`;
        element.style.height = `${rect.height}px`;
        element.style.left = `${finalXOffset}px`;
        element.style.top = `${topPos + finalYOffset}px`;
      }

      if (rotationAngle !== undefined) {
        const supportsIndependentRotate =
          typeof CSS !== "undefined" &&
          typeof CSS.supports === "function" &&
          CSS.supports("rotate", "1deg");

        if (supportsIndependentRotate) {
          // Keep any existing template transform/animation (eg moving-container),
          // and compose rotation through the independent rotate property.
          element.style.rotate = `${rotationAngle}deg`;
          element.style.transformOrigin = "center";
          return element;
        }

        // Fallback for engines without CSS rotate support:
        // wrap the element so template transforms stay on child while wrapper rotates.
        const wrapper = document.createElement("div");
        wrapper.style.position = element.style.position;
        wrapper.style.left = element.style.left;
        wrapper.style.top = element.style.top;
        wrapper.style.width = element.style.width;
        wrapper.style.height = element.style.height;
        wrapper.style.pointerEvents = "none";
        wrapper.style.transform = `rotate(${rotationAngle}deg)`;
        wrapper.style.transformOrigin = "center";

        element.style.position = "absolute";
        element.style.left = "0px";
        element.style.top = "0px";
        element.style.width = "100%";
        element.style.height = "100%";
        wrapper.append(element);
        return wrapper;
      }

      return element;
    }

    try {
      if (style.layout === "boxes") {
        const clientRects = getClientRectsNoOverlap(item.range, true).sort(
          (rectA, rectB) => rectA.top - rectB.top
        );
        const useOverlay = clientRects.length === 1 && ocrLayout;

        for (let clientRect of clientRects) {
          const line = elementTemplate.cloneNode(true);
          line.style.pointerEvents = "none";
          const positionedLine = positionElement(
            line,
            clientRect,
            boundingRect,
            useOverlay
          );
          itemContainer.append(positionedLine);
        }
      } else if (style.layout === "bounds") {
        const bounds = elementTemplate.cloneNode(true);
        bounds.style.pointerEvents = "none";
        const positionedBounds = positionElement(
          bounds,
          boundingRect,
          boundingRect,
          ocrLayout
        );
        itemContainer.append(positionedBounds);
      }
    } catch (error) {
      logError(`Error calculating position: ${error.message}`);
      postMessageWithInvalidRect();
      return;
    }

    visibleArea.append(itemContainer);
    item.container = itemContainer;

    if (postMessage) {
      emitHighlightRect(item, toNativeRect(boundingRect), ocrLayout);
    }
  }

  /**
   * Returns the group container element, after making sure it exists.
   */
  function requireContainer() {
    if (!container) {
      container = document.createElement("div");
      container.id = groupId;
      container.dataset.group = groupName;
      container.style.pointerEvents = "none";
      document.body.append(container);
    }
    return container;
  }

  function applyContainmentToArea(pageIndex) {
    // Optimize: Cache viewport dimensions
    let viewportWidth = window.innerWidth;
    let viewportHeight = window.innerHeight;
    let visibleAreaId = `visible-area-${pageIndex}`;

    let newArea = false;
    let visibleArea = null;

    // Optimize: Use Map for O(1) lookup instead of array iteration
    visibleArea = visibleContainersMap.get(visibleAreaId);

    if (!visibleArea) {
      // Optimize: Only query DOM if not found in cache
      visibleArea = document.getElementById(visibleAreaId);

      if (!visibleArea) {
        // Create a new container for the visible area (this page)
        visibleArea = document.createElement("div");
        visibleArea.className = "visible-area";
        visibleArea.id = visibleAreaId;
        
        // Optimize: Batch style assignments
        const visibleAreaLeft = pageIndex * viewportWidth;
        visibleArea.style.cssText = `position:absolute;left:${visibleAreaLeft}px;top:0px;margin-top:0px;width:${viewportWidth}px;height:${viewportHeight}px;pointer-events:none;z-index:999`;

        document.body.appendChild(visibleArea);
        newArea = true;
      }

      // Cache in both array and map
      visibleContainers.push(visibleArea);
      visibleContainersMap.set(visibleAreaId, visibleArea);
    }

    return { visibleArea: visibleArea, new: newArea };
  }

  /**
   * Removes the group container.
   */
  function clearContainer() {
    if (container) {
      container.remove();
      container = null;
    }
  }

  return {
    add,
    addEnhanced,
    remove,
    update,
    clear,
    clearEnhanced,
    clearAllEnhanced,
    items,
    requestLayout,
    isActivable,
    setActivable,
  };
}

window.addEventListener(
  "load",
  function () {
    // Will relayout all the decorations when the document body is resized.
    const body = document.body;
    var lastSize = { width: 0, height: 0 };
    const observer = new ResizeObserver(() => {
      if (
        lastSize.width === body.clientWidth &&
        lastSize.height === body.clientHeight
      ) {
        return;
      }
      lastSize = {
        width: body.clientWidth,
        height: body.clientHeight,
      };
      requestGroupsLayout();
    });
    observer.observe(body);
  },
  false
);
