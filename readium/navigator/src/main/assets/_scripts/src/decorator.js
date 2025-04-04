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
import { log, logError, rangeFromLocator } from "./utils";

let styles = new Map();
let groups = new Map();
var lastGroupId = 0;

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

   // log(`Document body html content: ${document.body.innerHTML}`);

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
     // log(`Document body text content BEFORE: ${document.body.textContent}`);
     processSpansForTextSpacing();
     // log(`Document body text content AFTER: ${document.body.textContent}`);

     // log(
     //   `DID REGISTER TEMPLATES for ${
     //     document.location.href || document.title || "document"
     //   }`
     // );
   }

   /**
    * Processes spans in the document to ensure proper spacing between text segments.
    * This prevents words from being incorrectly stitched together when extracting text.
    */
   function processSpansForTextSpacing() {
     // Get all spans in the document
     const spans = document.querySelectorAll("span");

     // Group spans by parent element to analyze siblings
     const spansByParent = {};
     for (const span of spans) {
       const parentKey = span.parentElement
         ? span.parentElement.tagName +
           "_" +
           (span.parentElement.id || Math.random())
         : "orphan";
       if (!spansByParent[parentKey]) {
         spansByParent[parentKey] = [];
       }
       spansByParent[parentKey].push(span);
     }

     // First pass: Process spans and mark those that need spacing
     for (const parentKey in spansByParent) {
       const siblingSpans = spansByParent[parentKey].slice();

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
     for (const span of document.querySelectorAll(
       'span[data-needs-spacing="true"]'
     )) {
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
     const wordSpacedSpans = document.querySelectorAll(
       'span[style*="word-spacing"]'
     );
     for (const span of wordSpacedSpans) {
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

      for (const item of groupContent.items.reverse()) {
        if (!item.clickableElements) {
          continue;
        }
        for (const element of item.clickableElements) {
          let rect = element.getBoundingClientRect().toJSON();
          if (rectContainsPoint(rect, event.clientX, event.clientY, 1)) {
            return { group, item, element, rect };
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
  function update(decoration) {
    remove(decoration.id);
    add(decoration);
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
    items.forEach((item) => layout(item));
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
    itemContainer.setAttribute("id", item.id);
    itemContainer.setAttribute("data-style", item.decoration.style);
    itemContainer.style.setProperty("pointer-events", "none");

    let viewportWidth = window.innerWidth;
    let columnCount = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue(
        "column-count"
      )
    );
    let pageWidth = viewportWidth / (columnCount || 1);
    let scrollingElement = document.scrollingElement;
    let xOffset = scrollingElement.scrollLeft;
    let yOffset = scrollingElement.scrollTop;

    function positionElement(element, rect, boundingRect) {
      element.style.position = "absolute";

      if (style.width === "wrap") {
        element.style.width = `${rect.width}px`;
        element.style.height = `${rect.height}px`;
        element.style.left = `${rect.left + xOffset}px`;
        element.style.top = `${rect.top + yOffset}px`;
      } else if (style.width === "viewport") {
        element.style.width = `${viewportWidth}px`;
        element.style.height = `${rect.height}px`;
        let left = Math.floor(rect.left / viewportWidth) * viewportWidth;
        element.style.left = `${left + xOffset}px`;
        element.style.top = `${rect.top + yOffset}px`;
      } else if (style.width === "bounds") {
        element.style.width = `${boundingRect.width}px`;
        element.style.height = `${rect.height}px`;
        element.style.left = `${boundingRect.left + xOffset}px`;
        element.style.top = `${rect.top + yOffset}px`;
      } else if (style.width === "page") {
        element.style.width = `${pageWidth}px`;
        element.style.height = `${rect.height}px`;
        let left = Math.floor(rect.left / pageWidth) * pageWidth;
        element.style.left = `${left + xOffset}px`;
        element.style.top = `${rect.top + yOffset}px`;
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
      let doNotMergeHorizontallyAlignedRects = true;
      let clientRects = getClientRectsNoOverlap(
        item.range,
        doNotMergeHorizontallyAlignedRects
      );

      clientRects = clientRects.sort((r1, r2) => {
        if (r1.top < r2.top) {
          return -1;
        } else if (r1.top > r2.top) {
          return 1;
        } else {
          return 0;
        }
      });

      for (let clientRect of clientRects) {
        const line = elementTemplate.cloneNode(true);
        line.style.setProperty("pointer-events", "none");
        positionElement(line, clientRect, boundingRect);
        itemContainer.append(line);
      }
    } else if (style.layout === "bounds") {
      const bounds = elementTemplate.cloneNode(true);
      bounds.style.setProperty("pointer-events", "none");
      positionElement(bounds, boundingRect, boundingRect);

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

  function layoutEnhanced(item, postMessage) {
      let style = styles.get(item.decoration.style);
      if (!style) {
        logError(
              "Unknown decoration style ",item.decoration.style
            );
        return;
      }

      // Get the bounding rect for the decoration
      let boundingRect = item.range.getBoundingClientRect();

      // Calculate which page (container) this decoration belongs to based on its left position
      let viewportWidth = window.innerWidth;
      let pageIndex = Math.floor(
        (boundingRect.left + window.scrollX) / viewportWidth
      ); // Calculate the page index

      let visibleAreaResponse = applyContainmentToArea(pageIndex); // Get or create the container for this page
      let visibleArea = visibleAreaResponse.visibleArea;
      let newArea = visibleAreaResponse.new;

      if (newArea) {
        log(`new area`);
        visibleContainers.push(visibleArea);
      }

      // Create the decoration element
      let itemContainer = document.createElement("div");
      itemContainer.setAttribute("id", item.id);
      itemContainer.setAttribute("data-style", item.decoration.style);
      itemContainer.style.setProperty("pointer-events", "none");

      // Adjust the position of the decoration relative to the container (page)
      // let xOffset =
      //   boundingRect.left - pageIndex * viewportWidth + window.scrollX; // Relative position within the page
      let xOffset = window.scrollX - pageIndex * viewportWidth;
      // let yOffset = boundingRect.top + window.scrollY;

      let scrollingElement = document.scrollingElement;
      let yOffset = scrollingElement.scrollTop;

       log(`visible area :: bounding rect left: ${boundingRect.left}`);
       log(`visible area :: page index: ${pageIndex}`);
       log(`visible area :: viewport width: ${viewportWidth}`);
       log(`visible area :: window screen x: ${window.scrollX}`);

      log(`yoffset: ${yOffset}`);

      // Position the decoration element inside the page container
      function positionElement(element, rect, boundingRect) {
        element.style.position = "absolute";
        log(`style width: ${style.width}`);
        log(`rect left: ${rect.left}`);
        if (style.width === "wrap") {
          element.style.width = `${rect.width}px`;
          element.style.height = `${rect.height}px`;
          element.style.left = `${rect.left + xOffset}px`; // Position within the page
          element.style.top = `${rect.top + yOffset}px`;
        } else if (style.width === "viewport") {
          element.style.width = `${viewportWidth}px`;
          element.style.height = `${rect.height}px`;
          element.style.left = `${xOffset}px`; // Position within the page
          element.style.top = `${rect.top + yOffset}px`;
        } else if (style.width === "bounds") {
          element.style.width = `${boundingRect.width}px`;
          element.style.height = `${rect.height}px`;
          element.style.left = `${boundingRect.left + xOffset}px`;
          element.style.top = `${rect.top + yOffset}px`;
        } else if (style.width === "page") {
          element.style.width = `${viewportWidth}px`;
          element.style.height = `${rect.height}px`;
          element.style.left = `${xOffset}px`;
          element.style.top = `${rect.top + yOffset}px`;
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

      log(`style layout: ${style.layout}`);

      if (style.layout === "boxes") {
        let doNotMergeHorizontallyAlignedRects = true;
        let clientRects = getClientRectsNoOverlap(
          item.range,
          doNotMergeHorizontallyAlignedRects
        );

        clientRects = clientRects.sort((r1, r2) => {
          if (r1.top < r2.top) {
            return -1;
          } else if (r1.top > r2.top) {
            return 1;
          } else {
            return 0;
          }
        });

        for (let clientRect of clientRects) {
          const line = elementTemplate.cloneNode(true);
          line.style.setProperty("pointer-events", "none");
          positionElement(line, clientRect, boundingRect);
          itemContainer.append(line);
        }
      } else if (style.layout === "bounds") {
        const bounds = elementTemplate.cloneNode(true);
        bounds.style.setProperty("pointer-events", "none");
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
      container.setAttribute("id", groupId);
      container.setAttribute("data-group", groupName);
      container.style.setProperty("pointer-events", "none");

      requestAnimationFrame(function () {
        if (container != null) {
          document.body.append(container);
        }
      });
    }
    return container;
  }

  function applyContainmentToArea(pageIndex) {
    let viewportWidth = window.innerWidth;
    let visibleAreaLeft = pageIndex * viewportWidth; // Each page is one viewport width in size
    let visibleAreaId = `visible-area-${pageIndex}`;

    let newArea = false;
    let visibleArea = null;

    for (const container of visibleContainers) {
      if (container.id === visibleAreaId) {
        visibleArea = container;
        log(`using container from array: ${container.id}`);
        break;
      }
    }

    if (!visibleArea) {
      // Check if the visible area for this page already exists
      visibleArea = document.querySelector(`#${visibleAreaId}`);

      if (!visibleArea) {
        // Create a new container for the visible area (this page)
        visibleArea = document.createElement("div");
        visibleArea.classList.add("visible-area");
        visibleArea.setAttribute("id", visibleAreaId);
        visibleArea.style.position = "absolute";
        visibleArea.style.left = `${visibleAreaLeft}px`;
        visibleArea.style.top = `0px !important`;
        visibleArea.style.marginTop = `0px`;
        visibleArea.style.width = `${viewportWidth}px`;
        visibleArea.style.height = `${window.innerHeight}px`;
        visibleArea.style.pointerEvents = "none"; // Allow interactions to pass through
        document.body.appendChild(visibleArea);

        newArea = true;
      }
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

      groups.forEach(function (group) {
        group.requestLayout();
      });
    });
    observer.observe(body);
  },
  false
);
