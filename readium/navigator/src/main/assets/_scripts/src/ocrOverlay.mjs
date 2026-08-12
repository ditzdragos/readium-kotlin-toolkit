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

/** The deepest element the overlay's first word starts in. */
function innermostFirstElement(element) {
  let innermost = element;
  while (innermost.firstElementChild) {
    innermost = innermost.firstElementChild;
  }
  return innermost;
}

function overlayRotationDegrees(textOverlayElement) {
  if (!textOverlayElement) {
    return undefined;
  }

  // Books author the rotation as readily on a wrapper around the word as on the
  // overlay itself, so the walk has to start inside the overlay.
  const closestAngle = getClosestRotationDegrees(
    innermostFirstElement(textOverlayElement),
    textOverlayElement
  );
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
 * The `.text-overlay` elements a range covers, in reading order.
 *
 * Overlays are laid out in document order and a range is contiguous, so the
 * scan stops at the first overlay starting past the range's end. Touching
 * boundaries are excluded: a range ending where the next word begins covers no
 * part of it, and washing that word would read as a highlight running one word
 * long.
 *
 * Returns [] when the range is not inside an OCR overlay, or when it reaches
 * past the container the scan can see.
 */
export function overlayElementsInRange(range) {
  const startOverlay = overlayElement(range);
  if (!startOverlay) {
    return [];
  }

  const ocrContainer = startOverlay.closest(".ocr-container");
  if (!ocrContainer || !ocrContainer.ownerDocument) {
    return [startOverlay];
  }

  // A range reaching past the container covers words this scan cannot see, and
  // a partial answer is worse than none: the caller drops its client rects as
  // soon as one box exists, so the tail would go undecorated.
  if (range.endContainer && !ocrContainer.contains(range.endContainer)) {
    return [];
  }

  const probe = ocrContainer.ownerDocument.createRange();
  const covered = [];
  for (const overlay of ocrContainer.querySelectorAll(".text-overlay")) {
    probe.selectNodeContents(overlay);
    if (range.compareBoundaryPoints(Range.START_TO_END, probe) <= 0) {
      break;
    }
    if (range.compareBoundaryPoints(Range.END_TO_START, probe) < 0) {
      covered.push(overlay);
    }
  }

  return covered.length > 0 ? covered : [startOverlay];
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
 * The width the overlay's word occupies on one unwrapped line.
 *
 * `scrollWidth` cannot answer this: it never reports less than the box, so a
 * word that fits measures as the box itself. The probe inherits the overlay's
 * font, so it measures the same run the reader lays out, and `offsetWidth` is a
 * layout box — unlike a client rect, an overlay's rotation cannot inflate it.
 */
function unwrappedTextWidth(element) {
  const text = element.textContent ? element.textContent.trim() : "";
  const ownerDocument = element.ownerDocument;
  if (!text || !ownerDocument) {
    return 0;
  }

  const probe = ownerDocument.createElement("span");
  probe.textContent = text;
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.whiteSpace = "pre";

  element.appendChild(probe);
  const width = probe.offsetWidth;
  probe.remove();
  return width;
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
 * only be a swapped box. Measure the word, never the box that holds it — a
 * single letter is naturally portrait, and its box alone is wide enough to pass
 * for a whole line.
 *
 * `boxRect` must be the rect the decoration is about to occupy, resolved from
 * the percentages the overlay is authored in. The element's own layout box
 * cannot stand in for it: an `.ocr-container` whose children are all absolutely
 * positioned lays out zero pixels wide, and every percentage width under it
 * collapses with it, which reads as portrait for every word on the page.
 */
export function textRunsAlongBoxHeight(element, boxRect) {
  if (!element || !boxRect) {
    return false;
  }

  if (!(boxRect.height > boxRect.width * ORIENTATION_MARGIN)) {
    return false;
  }

  const lineHeight = lineHeightOf(element);
  return (
    lineHeight > 0 &&
    unwrappedTextWidth(element) > lineHeight * ORIENTATION_MARGIN
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

/**
 * Resolves how a decoration on a single OCR overlay must be placed.
 */
export function ocrOverlayPlacementForOverlay(textOverlayElement, ocrRect) {
  const rotationAngle = overlayRotationDegrees(textOverlayElement);
  if (!ocrRect || !textRunsAlongBoxHeight(textOverlayElement, ocrRect)) {
    return { rect: ocrRect ?? null, rotationAngle };
  }

  return {
    rect: quarterTurn(ocrRect),
    rotationAngle: uprightAngle(rotationAngle),
  };
}

/**
 * The boxes a decoration must occupy, one per `.text-overlay` its range covers.
 *
 * A range's own client rects cannot stand in for these. The invisible text is
 * laid out at the reader's font size inside a box authored in percentages of
 * the page, so the rects track the text, not the artwork word — and where the
 * `.ocr-container` shrink-wraps to zero width they collapse to x = 0 for every
 * word on the page. Only the authored box tracks the word.
 *
 * Counting client rects cannot tell a wrapped word from a span of several
 * words, which is why the overlays themselves decide: each contributes its own
 * box however many rects its text happened to produce.
 *
 * Returns [] — leaving the caller on its client-rect path — unless every
 * overlay the range covers yields a box.
 */
export function ocrOverlayBoxes(range, correctedRectForOverlay) {
  if (!range || typeof correctedRectForOverlay !== "function") {
    return [];
  }

  const boxes = [];
  for (const overlay of overlayElementsInRange(range)) {
    const ocrRect = correctedRectForOverlay(overlay);
    // One unauthored overlay forfeits the whole span: the caller keeps its
    // client rects only while there is no box at all, so a partial answer would
    // leave that word with no decoration rather than a misplaced one.
    if (!ocrRect) {
      return [];
    }
    boxes.push(ocrOverlayPlacementForOverlay(overlay, ocrRect));
  }
  return boxes;
}
