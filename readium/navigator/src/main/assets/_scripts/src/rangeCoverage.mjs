//
//  Copyright 2021 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

const ELEMENT_NODE = 1;

/** The node itself when it is an element, else the element holding it. */
export function containingElement(node) {
  return node.nodeType === ELEMENT_NODE ? node : node.parentElement;
}

/** The part of [element]'s text that [range] covers. */
export function coveredText(range, element) {
  const part = element.ownerDocument.createRange();
  part.selectNodeContents(element);
  if (range.compareBoundaryPoints(Range.START_TO_START, part) > 0) {
    part.setStart(range.startContainer, range.startOffset);
  }
  if (range.compareBoundaryPoints(Range.END_TO_END, part) < 0) {
    part.setEnd(range.endContainer, range.endOffset);
  }
  return part.toString();
}

function isBlank(text) {
  return !/\S/.test(text);
}

/**
 * Whether [range] reaches into [element] but covers none of its text: it ends at the start of the
 * element's text node, which the DOM orders after the start of the element itself (RR-9689).
 */
function onlyTouches(range, element) {
  return (
    !isBlank(element.textContent || "") && isBlank(coveredText(range, element))
  );
}

/**
 * The elements [range] covers, out of [elements]: siblings in document order, none inside
 * another. Touching boundaries are excluded: a range ending where the next element begins, or at
 * the start of its text, covers no part of it.
 *
 * Elements in document order end in document order too, so a binary search finds the first one
 * the range reaches, and the walk stops at the first one starting past its end. A word on a page
 * of thousands of glyphs costs a handful of comparisons rather than a scan from the top.
 */
export function elementsCoveredByRange(range, elements) {
  if (elements.length === 0) {
    return [];
  }
  const probe = elements[0].ownerDocument.createRange();
  const endsBeforeRange = (element) => {
    probe.selectNodeContents(element);
    return range.compareBoundaryPoints(Range.END_TO_START, probe) >= 0;
  };
  const startsAfterRange = (element) => {
    probe.selectNodeContents(element);
    return range.compareBoundaryPoints(Range.START_TO_END, probe) <= 0;
  };

  let low = 0;
  let high = elements.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (endsBeforeRange(elements[middle])) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  const covered = [];
  for (let i = low; i < elements.length; i++) {
    if (startsAfterRange(elements[i])) {
      break;
    }
    covered.push(elements[i]);
  }
  if (covered.length > 0 && onlyTouches(range, covered[covered.length - 1])) {
    covered.pop();
  }
  if (covered.length > 0 && onlyTouches(range, covered[0])) {
    covered.shift();
  }
  return covered;
}
