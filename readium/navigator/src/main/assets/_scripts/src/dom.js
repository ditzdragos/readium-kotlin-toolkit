//
//  Copyright 2022 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

import { getCssSelector } from "css-selector-generator";
import { isScrollModeEnabled } from "./utils";

// See. https://github.com/JayPanoz/architecture/tree/touch-handling/misc/touch-handling
// Use Set for O(1) lookup instead of array indexOf
const INTERACTIVE_TAGS = new Set([
  "a",
  "audio",
  "button",
  "canvas",
  "details",
  "input",
  "label",
  "option",
  "select",
  "submit",
  "textarea",
  "video",
]);

export function nearestInteractiveElement(element) {
  if (element == null) {
    return null;
  }
  if (INTERACTIVE_TAGS.has(element.nodeName.toLowerCase())) {
    return element.outerHTML;
  }

  // Checks whether the element is editable by the user.
  if (
    element.hasAttribute("contenteditable") &&
    element.getAttribute("contenteditable").toLowerCase() != "false"
  ) {
    return element.outerHTML;
  }

  // Checks parents recursively because the touch might be for example on an <em> inside a <a>.
  if (element.parentElement) {
    return nearestInteractiveElement(element.parentElement);
  }

  return null;
}

export function findFirstVisibleLocator() {
  const element = findElement(document.body);
  return {
    href: "#",
    type: "application/xhtml+xml",
    locations: {
      cssSelector: getCssSelector(element),
    },
    text: {
      highlight: element.textContent,
    },
  };
}

function findElement(rootElement) {
  for (var i = 0; i < rootElement.children.length; i++) {
    const child = rootElement.children[i];
    if (!shouldIgnoreElement(child) && isElementVisible(child)) {
      return findElement(child);
    }
  }
  return rootElement;
}

function isElementVisible(element) {
  if (readium.isFixedLayout) return true;

  if (element === document.body || element === document.documentElement) {
    return true;
  }
  if (!document || !document.documentElement || !document.body) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  if (isScrollModeEnabled()) {
    return rect.bottom > 0 && rect.top < window.innerHeight;
  } else {
    return rect.right > 0 && rect.left < window.innerWidth;
  }
}

// Cache computed styles to avoid repeated expensive calls
const styleCache = new WeakMap();

function shouldIgnoreElement(element) {
  // Check cache first
  let cachedStyle = styleCache.get(element);
  if (!cachedStyle) {
    const elStyle = getComputedStyle(element);
    if (!elStyle) {
      return false;
    }
    cachedStyle = {
      display: elStyle.getPropertyValue("display"),
      opacity: elStyle.getPropertyValue("opacity")
    };
    styleCache.set(element, cachedStyle);
  }
  
  if (cachedStyle.display != "block") {
    return true;
  }
  // Cannot be relied upon, because web browser engine reports invisible when out of view in
  // scrolled columns!
  // const visibility = elStyle.getPropertyValue("visibility");
  // if (visibility === "hidden") {
  //     return false;
  // }
  if (cachedStyle.opacity === "0") {
    return true;
  }

  return false;
}
