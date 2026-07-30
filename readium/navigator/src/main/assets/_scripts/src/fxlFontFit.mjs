//
//  Copyright 2025 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

/**
 * Decides which fixed-layout text overlays should be re-pointed at the bundled
 * Times-metric clone, and — just as importantly — which should be left alone.
 *
 * Kept free of DOM globals and of the other script modules so it can be run
 * directly under Node by `test/fxlFontFit.test.mjs`; `.mjs` so Node treats it
 * as a module while webpack still runs it through Babel.
 */

const GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "math",
  "emoji",
  "fangsong",
]);

const CSS_WIDE_KEYWORDS = new Set([
  "inherit",
  "initial",
  "unset",
  "revert",
  "revert-layer",
]);

/**
 * Only used for text too short to probe with: a mix of wide, narrow and
 * non-alphabetic glyphs, so two different faces are unlikely to measure alike.
 */
export const SYNTHETIC_PROBE_TEXT = "mmmmmmmmmmlliWWWWQQQ@#$%";

const MIN_PROBE_CHARACTERS = 4;
const MAX_PROBE_CHARACTERS = 60;
const MIN_PROBE_LENGTH = 24;

/** A substitution has to beat the current rendering by this much to be worth it. */
export const MIN_FIT_IMPROVEMENT = 0.005;

/** Box widths this far apart (CSS px) came from different layouts. */
const BOX_WIDTH_TOLERANCE = 0.5;

/*
 * How much of its box a line has to cover for the box to say anything about the
 * face drawing it. A box holding a whole paragraph runs several times its own
 * width once measured unwrapped, and a caption sitting in a full-width frame
 * covers a fraction of it; neither was authored to the width of a line, so
 * neither can judge one face against another — and letting them try would hand
 * the vote to whichever face is narrower.
 */
const MIN_USABLE_FILL = 0.6;
const MAX_USABLE_FILL = 1.25;

export function parseFamilyList(value) {
  const families = [];
  let current = "";
  let quote = null;
  for (let i = 0; i < value.length; i++) {
    const character = value[i];
    if (quote) {
      if (character === "\\") {
        current += value[++i] || "";
      } else if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ",") {
      families.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  families.push(current);
  return families
    .map((family) => family.trim().replace(/\s+/g, " "))
    .filter((family) => family.length > 0);
}

export function isGenericFamily(family) {
  return GENERIC_FAMILIES.has(family.toLowerCase());
}

/** A name a face could be registered under: not a generic, not a CSS keyword. */
export function isNamedFamily(family) {
  const lowercased = family.toLowerCase();
  return (
    !GENERIC_FAMILIES.has(lowercased) &&
    !CSS_WIDE_KEYWORDS.has(lowercased) &&
    family.indexOf("(") === -1 &&
    family.charAt(0) !== "-"
  );
}

/**
 * Which of the four bundled clone faces a line would be drawn in.
 *
 * Substituting a family changes neither the weight nor the slope the page asked
 * for, so a page whose overlay is set entirely in one face has no use for the
 * other three. Registering a family *without* a face some line asks for is not
 * neutral, though: the WebView then synthesises it from the face that is there,
 * and a synthetically emboldened regular carries neither the clone's metrics
 * nor the artwork's — so this has to answer for every line, not just the
 * sampled ones.
 *
 * 600 is the CSS threshold at which `font-weight` selects a bold face; a
 * computed weight is always a number, and an unparseable one is treated as
 * regular rather than guessed at.
 */
export function faceFor(style) {
  const weight = parseInt(style.fontWeight, 10);
  return {
    weight: weight >= 600 ? "700" : "400",
    style: /italic|oblique/.test(style.fontStyle) ? "italic" : "normal",
  };
}

/** Identity of a face, for comparing what a page needs against what is bundled. */
export function faceKey(face) {
  return face.weight + " " + face.style;
}

/**
 * Probe text built from the characters the page actually shows.
 *
 * The obvious probe — a fixed string of wide and narrow glyphs — misreads a
 * publication that embeds a *subset* of its font: the subset carries the
 * characters the book uses and nothing else, so probing with `@#$%` measures
 * per-glyph fallback rather than the family, and a font that renders the page
 * perfectly well is reported missing. Probing with the page's own characters
 * asks the only question that matters: can this family draw this text?
 *
 * Repeated rather than padded, so a page with few distinct characters still
 * measures wide enough to separate two faces without introducing glyphs the
 * page never uses.
 */
export function probeTextFrom(text) {
  const characters = [];
  const seen = new Set();
  for (const character of String(text || "")) {
    if (character <= " " || seen.has(character)) {
      continue;
    }
    seen.add(character);
    characters.push(character);
    if (characters.length === MAX_PROBE_CHARACTERS) {
      break;
    }
  }
  if (characters.length < MIN_PROBE_CHARACTERS) {
    return SYNTHETIC_PROBE_TEXT;
  }
  let probe = characters.join("");
  while (probe.length < MIN_PROBE_LENGTH) {
    probe += probe;
  }
  return probe;
}

export function median(values) {
  if (values.length === 0) {
    return null;
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Keeps the samples that can tell two faces apart.
 *
 * A box whose width follows its text — an absolutely positioned overlay left to
 * shrink to fit — measures as a perfect fit under every face, so it would
 * always vote for whatever is rendering now. Such a box gives itself away by
 * changing width between the two passes; an authored width does not move.
 */
export function usableSamples(samples) {
  return samples.filter((sample) => {
    if (
      !(sample.boxWidth > 0) ||
      !(sample.textWidth > 0) ||
      !(sample.substituteTextWidth > 0) ||
      Math.abs(sample.boxWidth - sample.substituteBoxWidth) >
        BOX_WIDTH_TOLERANCE
    ) {
      return false;
    }
    const fills = [
      sample.textWidth / sample.boxWidth,
      sample.substituteTextWidth / sample.boxWidth,
    ];
    return (
      Math.min(fills[0], fills[1]) <= MAX_USABLE_FILL &&
      Math.max(fills[0], fills[1]) >= MIN_USABLE_FILL
    );
  });
}

/**
 * How far a face is from filling the boxes the publisher authored.
 *
 * These overlays are generated from the print layout, so a line's box is the
 * width that line occupied in the artwork: the face that belongs there fills it
 * exactly. Too wide and the line overflows and wraps — the failure RR-7953
 * chased. Too narrow and every word after the first sits left of the artwork.
 */
export function fitError(ratios) {
  const ratio = median(ratios);
  return ratio === null ? null : Math.abs(ratio - 1);
}

/**
 * Whether re-pointing these overlays at the clone measurably improves how they
 * sit in the boxes the publisher authored.
 *
 * Lines that wrap decide it first. A line whose text overruns its box folds its
 * last word onto a second row and takes every following word with it, which is
 * the failure RR-7953 chased; a line merely narrower than its box is off by the
 * slack, and on the justified overlays these books use most of that slack is
 * taken back by the stretching the layout does anyway. So a rendering that
 * wraps fewer lines wins outright, however each one fills its box, and only
 * when both wrap the same number does the closer fill decide.
 *
 * One line is not a majority, though. A line sitting at a fill of almost
 * exactly 1 wraps or does not on sub-pixel rounding, and letting that single
 * line carry the whole family means the same book can be drawn in a different
 * font from one layout to the next. So a lone wrap is asked to agree with the
 * fill before it decides: it still wins when the substitution is no worse
 * across the page, and is refused when it would have to make every other line
 * fit worse to save that one. Two or more wraps are the failure itself, and
 * decide on their own.
 *
 * Returns `null` when the page offers no authored box to judge against, as with
 * overlays that size themselves to their text. Substituting then is a guess,
 * and a guess that lands on a book whose artwork is set in a sans or display
 * face leaves the underline further off the word than doing nothing.
 */
export function evaluateSubstitution(
  samples,
  minImprovement = MIN_FIT_IMPROVEMENT
) {
  const usable = usableSamples(samples);
  if (usable.length === 0) {
    return null;
  }
  const wrapped = usable.filter((sample) => sample.rows > 1).length;
  const wrappedAfter = usable.filter(
    (sample) => sample.substituteRows > 1
  ).length;
  const currentError = fitError(
    usable.map((sample) => sample.textWidth / sample.boxWidth)
  );
  const substituteError = fitError(
    usable.map((sample) => sample.substituteTextWidth / sample.boxWidth)
  );
  return {
    samples: usable.length,
    wrapped,
    wrappedAfter,
    currentError,
    substituteError,
    improves:
      wrappedAfter === wrapped
        ? substituteError + minImprovement < currentError
        : wrappedAfter < wrapped &&
          (wrapped - wrappedAfter > 1 || substituteError <= currentError),
  };
}

/**
 * Whether a page has yet to answer what was asked of it.
 *
 * `evaluateSubstitution` returns `null` for a group whose lines offered no
 * usable width to judge a face against. That is the right answer for overlays
 * which size themselves to their text, and the wrong one for a page asked
 * before it had laid those lines out — and at the moment of asking the two look
 * identical. Only the second changes with time, so a set of verdicts that
 * decided nothing is treated as a question still open rather than as a page
 * with nothing to correct: the alternative is what RR-7953 keeps returning as,
 * an empty measurement mistaken for a clean bill of health and never repeated.
 */
export function evidenceIsMissing(verdicts) {
  return verdicts.length > 0 && verdicts.every((verdict) => verdict === null);
}
