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
import { log, logError, rangeFromLocator } from "./utils";

let styles = new Map();
let groups = new Map();
var lastGroupId = 0;

// Cache for expensive computed style calls
let documentWritingModeCache = null;
let documentColumnCountCache = null;

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

/**
 * Returns the closest element ancestor of the given node.
 */
function getContainingElement(node) {
  return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
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

  // Replace Unicode ligature 'ff' (U+FB00) with regular 'ff'
  document.body.innerHTML = document.body.innerHTML.replace(/\ufb00/g, "ff");

  // Process span elements to ensure proper text spacing
  processSpansForTextSpacing();

  // Setup scaling listeners after initial DOM modifications
  setupScalingListeners();
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
  if (spansLength === 0) return;

  // Group spans by parent element to analyze siblings
  // Use Map for better performance with many spans
  const spansByParent = new Map();
  for (let i = 0; i < spansLength; i++) {
    const span = spans[i];
    const parent = span.parentElement;
    const parentKey = parent
      ? parent.tagName + "_" + (parent.id || `p${i}`)
      : "orphan";
    if (!spansByParent.has(parentKey)) {
      spansByParent.set(parentKey, []);
    }
    spansByParent.get(parentKey).push(span);
  }

  // First pass: Process spans and mark those that need spacing
  for (const [parentKey, siblingSpansArray] of spansByParent) {
    const siblingSpans = siblingSpansArray.slice();

    // Sort spans by their vertical position (bottom value)
    siblingSpans.sort((a, b) => {
      const aBottom = parseFloat(a.style.bottom || "0");
      const bBottom = parseFloat(b.style.bottom || "0");
      return bBottom - aBottom; // Sort from top to bottom (larger bottom value is higher)
    });

    // Analyze bottom distances between adjacent siblings
    for (let i = 1; i < siblingSpans.length; i++) {
      const currentSpan = siblingSpans[i];
      const previousSpan = siblingSpans[i - 1];

      const currentBottom = parseFloat(currentSpan.style.bottom || "0");
      const previousBottom = parseFloat(previousSpan.style.bottom || "0");

      // Calculate vertical distance between spans
      const bottomDifference = Math.abs(previousBottom - currentBottom);

      // If there's a significant vertical gap, mark for spacing
      if (bottomDifference > 30) {
        previousSpan.setAttribute("data-needs-spacing", "true");
      }
    }
  }

  // Second pass: Insert spaces where needed
  // Collect spans that need spacing during first pass to avoid second query
  const spansNeedingSpacing = [];
  for (const [parentKey, siblingSpansArray] of spansByParent) {
    for (const span of siblingSpansArray) {
      if (span.hasAttribute("data-needs-spacing")) {
        spansNeedingSpacing.push(span);
      }
    }
  }
  
  for (const span of spansNeedingSpacing) {
    // Insert a space at the beginning of the span
    const textNode = span.firstChild;
    if (textNode && textNode.nodeType === Node.TEXT_NODE) {
      textNode.textContent = " " + textNode.textContent;
    } else {
      span.insertBefore(document.createTextNode(" "), span.firstChild);
    }

    // Remove the marker attribute
    span.removeAttribute("data-needs-spacing");
  }

  // Handle spans that contain word-spacing style (these already have explicit spacing)
  // Only query if we have spans to check
  const wordSpacedSpans = spansLength > 0 
    ? document.querySelectorAll('span[style*="word-spacing"]')
    : [];
  for (let i = 0; i < wordSpacedSpans.length; i++) {
    const span = wordSpacedSpans[i];
    // Ensure the browser's implicit spacing is preserved in extracted text
    if (span.textContent.trim() && !span.textContent.includes(" ")) {
      span.innerHTML = span.innerHTML.replace(
        /(<[^>]+>)([^\s<]+)(<[^>]+>|$)/g,
        "$1$2 $3"
      );
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
  var lastItemId = 0;
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

    log("adding decoration",groupName, JSON.stringify(decoration));
    let item = { id, decoration, range };
    items.push(item);
    layout(item);
  }

  function addEnhanced(decoration) {
    let id = decoration.id;

    let range = rangeFromLocator(decoration.locator);
    if (!range) {
      log("Can't locate DOM range for decoration", decoration);
      return;
    }

    let item = { id, decoration, range };
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
    if(enhanced){
        addEnhanced(decoration);
    }else{
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
    log("clearing all enhanced ",groupName, items);
      visibleContainers.forEach((container) => {
         log(`clearing container: ${container.id}`);
         container.remove();
         container = null;
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

    // Optionally, remove the item from the items array if you want to stop tracking it
    items = items.filter((item) => item.decoration.id !== decorationId);
  }

  /**
   * Recreates the decoration elements.
   *
   * To be called after reflowing the resource, for example.
   */
  function requestLayout() {
    log("requesting layout ",groupName, items.length);
    clearContainer();
    clearAllEnhanced();
    items.forEach((item) => layoutEnhanced(item));
  }

  /**
   * Layouts a single Decoration item.
   */
  function layout(item) {
    let groupContainer = requireContainer();

    let style = styles.get(item.decoration.style);
    if (!style) {
      logError("Unknown decoration style: ",item.decoration.style);
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

    const scrollingElement = document.scrollingElement;
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
        "Invalid decoration element ",item.decoration.element,": ",error.message
      );
      return;
    }

    if (style.layout === "boxes") {
      const doNotMergeHorizontallyAlignedRects =
        !documentWritingMode.startsWith("vertical");
      const startElement = getContainingElement(item.range.startContainer);
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
    }else{
        log("style layout: ",groupName,style.layout);
    }

    groupContainer.append(itemContainer);
    item.container = itemContainer;
    item.clickableElements = Array.from(
      itemContainer.querySelectorAll("[data-activable='1']")
    );
    if (item.clickableElements.length === 0) {
      item.clickableElements = Array.from(itemContainer.children);
    }

    Android.onHighlightRect(
            JSON.stringify({
              id: item.decoration.id,
              group: groupName,
              rect: toNativeRect(boundingRect)
            })
          );
  }

    // Cache regex to avoid recompilation
    const PAGE_NUMBER_REGEX = /^\d+$/;
    
    function isPageNumber(text) {
      if (!text) {
        log(`PAGE NUMBER DEBUG :: isPageNumber received null/undefined/empty text`);
        return false;
      }
      const trimmedText = text.trim();
      const isPageNum = PAGE_NUMBER_REGEX.test(trimmedText);
      log(`PAGE NUMBER DEBUG :: isPageNumber("${text}") -> trimmed: "${trimmedText}" -> result: ${isPageNum}`);
      // Only return true for strings that consist entirely of digits
      return isPageNum;
    }


  function layoutEnhanced(item, postMessage) {
      log(`PAGE NUMBER DEBUG :: layoutEnhanced called for decoration id: ${item.decoration.id}, group: ${groupName}`);

      let style = styles.get(item.decoration.style);
      if (!style) {
        logError(
              "Unknown decoration style ",item.decoration.style
            );
        return;
      }
        function postMessageWithInvalidRect() {
          logError('fallback to invalid rect');
          if (postMessage) {
            Android.onHighlightRect(
                      JSON.stringify({
                        id: item.decoration.id,
                        group: groupName,
                        rect: { left: 0, top: 0, width: 0, height: 0 }
                      })
                    );
          }
        }

      // Get the bounding rect for the decoration (cache this expensive call)
      // Only call once and reuse throughout the function
      let boundingRect = item.range.getBoundingClientRect();
      log(`PAGE NUMBER DEBUG :: boundingRect: top=${boundingRect.top}, left=${boundingRect.left}, width=${boundingRect.width}, height=${boundingRect.height}`);

      // Calculate which page (container) this decoration belongs to based on its left position
      let viewportWidth = window.innerWidth;
      let pageIndex = Math.floor(
        (boundingRect.left + window.scrollX) / viewportWidth
      ); // Calculate the page index
      log(`PAGE NUMBER DEBUG :: pageIndex: ${pageIndex}, viewportWidth: ${viewportWidth}, scrollX: ${window.scrollX}`);

         if (
                        boundingRect.left + boundingRect.width < 0 ||
                        boundingRect.top + boundingRect.height < 0
                      ) {
                        log(`PAGE NUMBER DEBUG :: decoration is off-screen, returning early`);
                        postMessageWithInvalidRect();
                        return;
                      }

       // Optimize: Cache text and check page number early to avoid unnecessary work
       const text = item.decoration.locator.text.highlight;
       log(`PAGE NUMBER DEBUG :: text.highlight: "${text}"`);
       const isPageNum = isPageNumber(text);
       
       if (isPageNum) {
             log(`PAGE NUMBER DEBUG :: Page number detected: "${text}"`);

             // Calculate absolute position in document
             const absoluteTop = boundingRect.top + window.scrollY;
             const absoluteBottom = absoluteTop + boundingRect.height;
             
             log(`PAGE NUMBER DEBUG :: absoluteTop: ${absoluteTop}, absoluteBottom: ${absoluteBottom}, scrollY: ${window.scrollY}`);

             // Get document height to determine page boundaries
             const documentHeight = Math.max(
               document.body.scrollHeight,
               document.body.offsetHeight,
               document.documentElement.clientHeight,
               document.documentElement.scrollHeight,
               document.documentElement.offsetHeight
             );
             
             // Get actual content height by checking the last few elements
             // This helps when document height includes extra padding/margins
             // Cache this calculation per document (it doesn't change often)
             let actualContentHeight = documentHeight;
             try {
               // More efficient: check last child and its siblings instead of all elements
               const body = document.body;
               if (body && body.lastElementChild) {
                 // Batch getBoundingClientRect calls by getting all rects at once
                 const lastElement = body.lastElementChild;
                 const lastElementRect = lastElement.getBoundingClientRect();
                 const lastElementBottom = lastElementRect.bottom + window.scrollY;
                 
                 // Only check up to 2 previous siblings to reduce DOM queries
                 let maxBottom = lastElementBottom;
                 let sibling = lastElement.previousElementSibling;
                 let checkedCount = 0;
                 const maxSiblingsToCheck = 2;
                 
                 while (sibling && checkedCount < maxSiblingsToCheck) {
                   const rect = sibling.getBoundingClientRect();
                   const bottom = rect.bottom + window.scrollY;
                   if (bottom > maxBottom) maxBottom = bottom;
                   sibling = sibling.previousElementSibling;
                   checkedCount++;
                 }
                 actualContentHeight = Math.min(maxBottom + 50, documentHeight); // Add small buffer
               }
             } catch (e) {
               // Fallback to documentHeight if calculation fails
               log(`PAGE NUMBER DEBUG :: Error calculating actual content height: ${e.message}`);
             }
             
             log(`PAGE NUMBER DEBUG :: documentHeight: ${documentHeight}, actualContentHeight: ${actualContentHeight}`);

             // Check if near top (within 30% of document start)
             // Use documentHeight for top since it's usually accurate
             const topThreshold = documentHeight * 0.3;
             const isAtTop = absoluteTop < topThreshold;
             
             // For bottom detection, use actualContentHeight as the primary reference
             // since documentHeight may include extra padding/margins
             // 1. Check if within bottom 25% of actual content (more conservative)
             // 2. Check if within reasonable distance from actual content end (300px)
             const bottomThresholdPercentage = actualContentHeight * 0.75; // Bottom 25% of actual content
             const bottomThresholdDistance = actualContentHeight - 300; // Within 300px of actual content end
             const distanceFromContentEnd = actualContentHeight - absoluteBottom;
             const isNearContentEnd = distanceFromContentEnd < 300; // Within 300px of actual content end
             
             // Use the more lenient threshold based on actual content height
             const bottomThreshold = Math.min(bottomThresholdPercentage, bottomThresholdDistance);
             const isAtBottomByThreshold = absoluteBottom > bottomThreshold;
             // Also check if very close to content end (within 150px) as a safety net
             const isAtBottom = isAtBottomByThreshold || (distanceFromContentEnd < 150);
             
             log(`PAGE NUMBER DEBUG :: topThreshold: ${topThreshold}, bottomThreshold: ${bottomThreshold} (based on actualContentHeight)`);
             log(`PAGE NUMBER DEBUG :: distanceFromContentEnd: ${distanceFromContentEnd}, isNearContentEnd: ${isNearContentEnd}`);
             log(`PAGE NUMBER DEBUG :: isAtTop: ${isAtTop}, isAtBottom: ${isAtBottom} (byThreshold: ${isAtBottomByThreshold}, byDistance: ${distanceFromContentEnd < 150})`);

             const isAtTopOrBottom = isAtTop || isAtBottom;
             
             log(`PAGE NUMBER DEBUG :: isAtTopOrBottom: ${isAtTopOrBottom}`);

             if (isAtTopOrBottom) {
               log(`PAGE NUMBER DEBUG :: Page number is at top or bottom, checking isolation`);

               // Optimize: Cache these values to avoid repeated property access
               const before = item.decoration.locator.text.before || "";
               const after = item.decoration.locator.text.after || "";

               log(`PAGE NUMBER DEBUG :: before: "${before}", after: "${after}"`);

               // Optimize: Combine checks to reduce operations
               const beforeIsIsolated = before.length === 0 || before.endsWith("\n") || !/[a-zA-Z0-9]/.test(before);
               const afterIsIsolated = after.length === 0 || after.startsWith("\n") || !/[a-zA-Z0-9]/.test(after);

               log(`PAGE NUMBER DEBUG :: beforeIsIsolated: ${beforeIsIsolated}, afterIsIsolated: ${afterIsIsolated}`);

               // Isolated page number if both before and after match our criteria
               if (beforeIsIsolated ||  afterIsIsolated) {
                 log(`PAGE NUMBER DEBUG :: Page number is isolated, returning with invalid rect`);
                 postMessageWithInvalidRect();
                 return;
               } else {
                 log(`PAGE NUMBER DEBUG :: Page number is NOT isolated, continuing with layout`);
               }
             } else {
               log(`PAGE NUMBER DEBUG :: Page number is NOT at top or bottom, continuing with layout`);
             }
           } else {
             log(`PAGE NUMBER DEBUG :: Not a page number, continuing with normal layout`);
           }

      // Optimize: Cache scrolling element and offsets
      let scrollingElement = document.scrollingElement;
      let yOffset = scrollingElement.scrollTop;
      let xOffset = window.scrollX - pageIndex * viewportWidth;

      let visibleAreaResponse = applyContainmentToArea(pageIndex); // Get or create the container for this page
      let visibleArea = visibleAreaResponse.visibleArea;
      let newArea = visibleAreaResponse.new;

      if (newArea) {
        visibleContainers.push(visibleArea);
      }

      // Create the decoration element
      let itemContainer = document.createElement("div");
      itemContainer.id = item.id;
      itemContainer.dataset.style = item.decoration.style;
      itemContainer.style.pointerEvents = "none";

      // Optimize: Cache element template creation
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

      // Optimize: Position function with cached values
      function positionElement(element, rect, boundingRect) {
        element.style.position = "absolute";
        const width = style.width;
        
        if (width === "wrap") {
          element.style.width = `${rect.width}px`;
          element.style.height = `${rect.height}px`;
          element.style.left = `${rect.left + xOffset}px`;
          element.style.top = `${rect.top + yOffset}px`;
        } else if (width === "viewport") {
          element.style.width = `${viewportWidth}px`;
          element.style.height = `${rect.height}px`;
          element.style.left = `${xOffset}px`;
          element.style.top = `${rect.top + yOffset}px`;
        } else if (width === "bounds") {
          element.style.width = `${boundingRect.width}px`;
          element.style.height = `${rect.height}px`;
          element.style.left = `${boundingRect.left + xOffset}px`;
          element.style.top = `${rect.top + yOffset}px`;
        } else if (width === "page") {
          element.style.width = `${viewportWidth}px`;
          element.style.height = `${rect.height}px`;
          element.style.left = `${xOffset}px`;
          element.style.top = `${rect.top + yOffset}px`;
        }
      }

      if (style.layout === "boxes") {
        // Optimize: Get client rects once and sort efficiently
        let clientRects = getClientRectsNoOverlap(
          item.range,
          true
        );

        // Optimize: Use more efficient sort
        clientRects.sort((r1, r2) => r1.top - r2.top);

        for (let clientRect of clientRects) {
          const line = elementTemplate.cloneNode(true);
          line.style.pointerEvents = "none";
          positionElement(line, clientRect, boundingRect);
          itemContainer.append(line);
        }
      } else if (style.layout === "bounds") {
        const bounds = elementTemplate.cloneNode(true);
        bounds.style.pointerEvents = "none";
        positionElement(bounds, boundingRect, boundingRect);
        itemContainer.append(bounds);
      }

      // Add the decoration to the corresponding visible area container (page)
      visibleArea.append(itemContainer);
      item.container = itemContainer;

    if (postMessage) {
    Android.onHighlightRect(
        JSON.stringify({
          id: item.decoration.id,
          group: groupName,
          rect: toNativeRect(boundingRect)
        })
      );
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
        visibleArea.style.cssText = `position:absolute;left:${visibleAreaLeft}px;top:0;margin-top:0;width:${viewportWidth}px;height:${viewportHeight}px;pointer-events:none`;
        
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
      
      // Clear style cache on resize as styles may have changed
      clearStyleCache();

      groups.forEach(function (group) {
        group.requestLayout();
      });
    });
    observer.observe(body);
  },
  false
);
