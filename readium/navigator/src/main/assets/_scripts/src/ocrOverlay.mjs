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

export function overlayElement(range) {
  let startNode = range.startContainer;
  if (startNode && startNode.nodeType === Node.TEXT_NODE) {
    startNode = startNode.parentElement;
  }
  if (!startNode || typeof startNode.closest !== "function") {
    return null;
  }
  return startNode.closest(".text-overlay");
}

export function overlayRotationDegrees(range) {
  const textOverlayElement = overlayElement(range);
  if (!textOverlayElement) {
    return undefined;
  }
  const startNode =
    range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement
      : range.startContainer;

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

const ORIENTATION_MARGIN = 1.2;

function lineHeightOf(element) {
  const style = window.getComputedStyle(element);
  const lineHeight = parseFloat(style.lineHeight);
  if (Number.isFinite(lineHeight) && lineHeight > 0) {
    return lineHeight;
  }
  const fontSize = parseFloat(style.fontSize);
  return Number.isFinite(fontSize) && fontSize > 0 ? fontSize * 1.2 : 0;
}

/**
 * Some overlays are authored a quarter turn off: the word runs along the box's
 * height rather than its width, because the OCR normalises the angle into a
 * narrow range and emits the equivalent box with its sides swapped. Anchoring a
 * line at `bottom: 0` on such a box draws it across the short far end — beside
 * the word instead of under it.
 *
 * Both comparisons are scale-free, so the reader's font size cancels out: a
 * portrait box holding a word that is naturally wider than a line is tall can
 * only be a swapped box.
 */
export function textRunsAlongBoxHeight(element) {
  if (!element) {
    return false;
  }

  const boxWidth = element.clientWidth;
  const boxHeight = element.clientHeight;
  if (!(boxHeight > boxWidth * ORIENTATION_MARGIN)) {
    return false;
  }

  const lineHeight = lineHeightOf(element);
  return (
    lineHeight > 0 && element.scrollWidth > lineHeight * ORIENTATION_MARGIN
  );
}

function quarterTurn(rect) {
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  return {
    left: centerX - rect.height / 2,
    top: centerY - rect.width / 2,
    width: rect.height,
    height: rect.width,
  };
}

function uprightAngle(rotationAngle) {
  const angle = rotationAngle ?? 0;
  return angle > 0 ? angle - 90 : angle + 90;
}

export function ocrOverlayPlacement(range, ocrRect) {
  const rotationAngle = overlayRotationDegrees(range);
  if (!ocrRect || !textRunsAlongBoxHeight(overlayElement(range))) {
    return { rect: ocrRect ?? null, rotationAngle };
  }

  return {
    rect: quarterTurn(ocrRect),
    rotationAngle: uprightAngle(rotationAngle),
  };
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
  if (clientRectCount !== 1) {
    return { box: null, rotationAngle: overlayRotationDegrees(range) };
  }

  const placement = ocrOverlayPlacement(range, ocrRect);
  return { box: placement.rect, rotationAngle: placement.rotationAngle };
}
