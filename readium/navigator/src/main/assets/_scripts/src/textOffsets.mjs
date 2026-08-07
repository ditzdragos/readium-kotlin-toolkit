//
//  Copyright 2021 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

/**
 * Offsets into a resource's text only address the right word while that text has the same
 * characters as `document.body.textContent`, which is the space every range resolves in. These
 * helpers keep the extracted text in that space, and recover the right word when an offset has
 * drifted out of it anyway.
 */

/**
 * The text a `<br>` should contribute between `precedingText` and `nextText`.
 *
 * A line break renders as a break but occupies no character, so emitting "\n" for every `<br>`
 * makes the extracted text longer than the DOM's and shifts every offset after it (RR-8661). It
 * still has to separate two words that nothing else separates, which is the only case left here.
 *
 * @param {string} precedingText - Text already emitted.
 * @param {string} nextText - Text about to be emitted.
 * @returns {string}
 */
export function lineBreakSeparator(precedingText, nextText) {
  if (!precedingText || !nextText) {
    return "";
  }
  if (/\s$/.test(precedingText) || /^\s/.test(nextText)) {
    return "";
  }
  return "\n";
}

function collapseWhitespace(value) {
  return value.replace(/\s+/g, " ");
}

function commonSuffixLength(left, right) {
  let count = 0;
  while (
    count < left.length &&
    count < right.length &&
    left[left.length - 1 - count] === right[right.length - 1 - count]
  ) {
    count++;
  }
  return count;
}

function commonPrefixLength(left, right) {
  let count = 0;
  while (
    count < left.length &&
    count < right.length &&
    left[count] === right[count]
  ) {
    count++;
  }
  return count;
}

/**
 * The index of the occurrence of `locatorText.highlight` in `entireText` whose surrounding text
 * agrees most with the locator's own before/after, or -1 when no single occurrence stands out.
 *
 * A drifted offset is worse than no offset: a windowed search around it names a neighbouring
 * occurrence of the same short word with full confidence, which is how "to" ends up underlined one
 * word along (RR-8661, RR-8486). Context does not drift, so it is what separates a repeated word
 * from its twin. Whitespace is collapsed on both sides because that is what the drift is made of.
 *
 * @param {string} entireText
 * @param {{highlight: string, before?: string, after?: string}} locatorText
 * @returns {number}
 */
export function bestContextMatchIndex(entireText, locatorText) {
  const highlight = locatorText.highlight;
  if (!highlight) {
    return -1;
  }

  const before = locatorText.before || "";
  const after = locatorText.after || "";
  const expectedBefore = collapseWhitespace(before);
  const expectedAfter = collapseWhitespace(after);
  if (!expectedBefore && !expectedAfter) {
    return -1;
  }

  let bestIndex = -1;
  let bestScore = 0;
  let bestIsUnique = false;

  for (
    let index = entireText.indexOf(highlight);
    index !== -1;
    index = entireText.indexOf(highlight, index + 1)
  ) {
    const end = index + highlight.length;
    const score =
      commonSuffixLength(
        collapseWhitespace(
          entireText.slice(Math.max(0, index - before.length), index)
        ),
        expectedBefore
      ) +
      commonPrefixLength(
        collapseWhitespace(entireText.slice(end, end + after.length)),
        expectedAfter
      );

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
      bestIsUnique = true;
    } else if (score === bestScore) {
      bestIsUnique = false;
    }
  }

  return bestIsUnique ? bestIndex : -1;
}
