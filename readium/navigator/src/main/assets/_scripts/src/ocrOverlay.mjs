//
//  Copyright 2025 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

/**
 * Geometry helpers for OCR picture books: a full-page artwork image with an
 * invisible `.text-overlay` per word, positioned in percentages of the page
 * inside an `.ocr-container`.
 *
 * The overlay box tracks the artwork word, while the invisible text inside it
 * is laid out at the reader's font size and hugs the top of that box, so only
 * the overlay box can carry a decoration.
 */

function containingElement(node) {
  return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
}

export function rotationDegreesFromTransform(transform) {
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

export function getClosestRotationDegrees(node, boundaryElement = null) {
  let element = containingElement(node);
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

export function overlayRotationDegrees(range) {
  let startNode = range.startContainer;
  if (startNode && startNode.nodeType === Node.TEXT_NODE) {
    startNode = startNode.parentElement;
  }
  if (!startNode || typeof startNode.closest !== "function") {
    return undefined;
  }

  const textOverlayElement = startNode.closest(".text-overlay");
  if (!textOverlayElement) {
    return undefined;
  }

  const closestAngle = getClosestRotationDegrees(startNode, textOverlayElement);
  if (closestAngle !== undefined) {
    return closestAngle;
  }

  const transform = window.getComputedStyle(textOverlayElement).transform;
  if (!transform || transform === "none") {
    return undefined;
  }

  const inlineAngle = rotationDegreesFromTransform(
    textOverlayElement.style.transform
  );
  return inlineAngle !== undefined
    ? inlineAngle
    : rotationDegreesFromTransform(transform);
}

/**
 * Resolves how a decoration on an OCR overlay must be placed.
 *
 * `box` is the overlay rect the decoration should occupy, and is only offered
 * when the invisible text produced a single client rect: once it wraps, each
 * rect covers part of the word and none of them maps onto the overlay box.
 */
export function ocrOverlayGeometry(range, ocrRect, clientRectCount) {
  if (!range || !ocrRect) {
    return { box: null, rotationAngle: undefined };
  }

  return {
    box: clientRectCount === 1 ? ocrRect : null,
    rotationAngle: overlayRotationDegrees(range),
  };
}
