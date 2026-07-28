//
//  Copyright 2025 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

/*
 * RR-7953: fixed-layout pages that bake their text into the page image and lay
 * an invisible text overlay on top to anchor read-aloud highlights routinely
 * name the print typeface the artwork was set in — e.g.
 * `font-family: TimesNewRomanMTStd` — without embedding it. Android has no such
 * face, so the overlay silently falls back to Roboto, ~8% wider per character.
 *
 * `fxl-default-serif.css` cannot help here: it sets the Times-metric clone as
 * the `html` default, and any element-level declaration beats an inherited one.
 *
 * The consequence is worse than a slow rightward creep. Each overlay line is an
 * absolutely-positioned box with an authored fixed width and `text-align:
 * justify`; text 8% too wide overflows its box and wraps its last word onto a
 * second row inside the div, and justification then stretches what remains. On
 * one measured page four of six body lines wrapped, so the underline sat under
 * the wrong word — or under nothing — for the rest of the page.
 *
 * So: for text that cannot render in any face the page names, register the
 * bundled Times-metric clone under the name the page asked for, which puts the
 * overlay back on the artwork's metrics without fighting the cascade.
 *
 * Substituting is only right where it demonstrably helps, and two questions
 * decide that — both answered by measuring the page rather than by assuming.
 *
 * Is the named face really missing? Asked with the characters the page shows,
 * because a book that embeds a *subset* of its font carries exactly those
 * glyphs and no others: probing a subset with characters the book never uses
 * reports a perfectly good font missing, and replacing it is how a page that
 * was aligned stops being aligned.
 *
 * Would the clone fit better than what renders today? Asked by measuring both
 * against the widths the publisher authored for each line, because Times
 * metrics are right for a book whose artwork was set in a print serif and wrong
 * for one set in a sans or a display face — where the clone runs narrow and
 * walks the underline left of the word instead of right of it. No authored
 * width to measure against means no evidence, and no evidence means leaving the
 * page as it is.
 *
 * The same second question is owed to `fxl-default-serif.css`, which makes the
 * clone the page-wide default for overlays that name no font at all (RR-6369).
 * That default is the same bet on Times metrics, made without measuring, so a
 * book whose artwork is set in a sans face is moved off its artwork by it. Once
 * the page has been measured, a default that fits worse than what the WebView
 * would have used is put back — as is the pair-kerning the same stylesheet
 * turns off, which is the one correction that reaches a publication rendering
 * in a font it embeds itself.
 */

import {
  SYNTHETIC_PROBE_TEXT,
  evaluateSubstitution,
  isNamedFamily,
  parseFamilyList,
  probeTextFrom,
} from "./fxlFontFit.mjs";

const CLONE_FACES = [
  { file: "NimbusRoman.woff", weight: "400", style: "normal" },
  { file: "NimbusRoman-Italic.woff", weight: "400", style: "italic" },
  { file: "NimbusRoman-Bold.woff", weight: "700", style: "normal" },
  { file: "NimbusRoman-BoldItalic.woff", weight: "700", style: "italic" },
];

/* Named by no publication, so measuring under it cannot collide with the page. */
const MEASUREMENT_FAMILY = "Readium FXL Metric Clone";

const PROBE_SIZE = "72px";

/* Enough lines for a stable median without walking a whole comic spread. */
const MAX_SAMPLES_PER_FAMILY = 40;

function cloneFontDirectory() {
  const link =
    document.querySelector('link[rel="preload"][href*="fxl-default-serif/"]') ||
    document.querySelector(
      'link[rel="stylesheet"][href*="fxl-default-serif/"]'
    );
  if (!link || !link.href) {
    return null;
  }
  try {
    return new URL(".", link.href).href;
  } catch (error) {
    return null;
  }
}

function quoteFamily(family) {
  return '"' + family.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

/*
 * A family the platform cannot supply falls through to whichever generic
 * follows it, so measuring the same text against three different generics tells
 * us whether the family itself rendered it: identical widths mean the family
 * won, differing widths mean each generic won its own turn.
 */
function familyRenders(context, family, text) {
  const quoted = quoteFamily(family);
  const measure = (stack) => {
    context.font = PROBE_SIZE + " " + stack;
    return context.measureText(text).width;
  };
  const withMonospace = measure(quoted + ", monospace");
  const withSansSerif = measure(quoted + ", sans-serif");
  const withSerif = measure(quoted + ", serif");
  return withMonospace === withSansSerif && withSansSerif === withSerif;
}

function ownText(element) {
  let text = "";
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.nodeValue;
    }
  }
  return text;
}

/*
 * The box a line was authored into. That is the line's own element in most
 * publications, but one that wraps each line in a span has to be measured
 * against the block holding it — and only when that block holds nothing else,
 * since otherwise its width says nothing about this line.
 */
function boxElementFor(element) {
  if (element.clientWidth > 0) {
    return element;
  }
  const text = element.textContent.trim();
  let ancestor = element.parentElement;
  while (ancestor && ancestor !== document.body) {
    if (ancestor.clientWidth > 0) {
      return ancestor.textContent.trim() === text ? ancestor : null;
    }
    ancestor = ancestor.parentElement;
  }
  return null;
}

function horizontalEdges(style) {
  return (
    (parseFloat(style.paddingLeft) || 0) +
    (parseFloat(style.paddingRight) || 0) +
    (parseFloat(style.borderLeftWidth) || 0) +
    (parseFloat(style.borderRightWidth) || 0)
  );
}

/*
 * Width of the box available to a line, read the same way its text is — from a
 * client rect, so a page the publisher put under a transform reports both in
 * the same space, and so the box is not rounded to whole pixels the way
 * `clientWidth` would round it.
 */
function contentWidth(box, edges) {
  const width = box.getBoundingClientRect().width;
  const scale = box.offsetWidth > 0 ? width / box.offsetWidth : 1;
  return width - edges * scale;
}

/* Every element holding text of its own, with the families it ends up asking for. */
function textElements() {
  const found = [];
  const elements = document.body ? document.body.querySelectorAll("*") : [];
  for (const element of elements) {
    const text = ownText(element);
    if (text.trim().length < 2) {
      continue;
    }
    const style = window.getComputedStyle(element);
    const families = parseFamilyList(style.fontFamily).filter(isNamedFamily);
    found.push({ element, style, families, text });
  }
  return found;
}

/* A line, and the box to measure it against, ready for `measureLines`. */
function sampleFor(element, style) {
  const box = boxElementFor(element);
  if (!box) {
    return null;
  }
  return {
    element,
    box,
    edges: horizontalEdges(
      box === element ? style : window.getComputedStyle(box)
    ),
  };
}

/*
 * Overlay lines that cannot render in any face they name, grouped by the name
 * to register the clone under — the first, so the registration wins the stack.
 */
function unrenderableOverlays(context, textLines) {
  const candidates = textLines.filter(({ families }) => families.length > 0);

  /*
   * A publication that wraps each word in its own span leaves too few
   * characters to tell two faces apart, so those lines are probed with
   * everything on the page set in the same family instead.
   */
  const familyText = new Map();
  for (const { families, text } of candidates) {
    familyText.set(families[0], (familyText.get(families[0]) || "") + text);
  }

  const groups = new Map();
  const rendered = new Map();
  for (const { element, style, families, text } of candidates) {
    let probe = probeTextFrom(text);
    if (probe === SYNTHETIC_PROBE_TEXT) {
      probe = probeTextFrom(familyText.get(families[0]));
    }
    const renders = (family) => {
      const key = family + " " + probe;
      if (!rendered.has(key)) {
        rendered.set(key, familyRenders(context, family, probe));
      }
      return rendered.get(key);
    };
    if (families.some(renders)) {
      continue;
    }
    const sample = sampleFor(element, style);
    if (!sample) {
      continue;
    }
    const group = groups.get(families[0]) || [];
    if (group.length < MAX_SAMPLES_PER_FAMILY) {
      group.push(sample);
      groups.set(families[0], group);
    }
  }
  return groups;
}

/* How many rows a line is broken across as the page actually lays it out. */
function rowCount(range, element) {
  const tops = new Set();
  range.selectNodeContents(element);
  for (const rect of range.getClientRects()) {
    if (rect.width > 1 && rect.height > 1) {
      tops.add(Math.round(rect.top));
    }
  }
  return Math.max(tops.size, 1);
}

/*
 * How each line sits in its box, laid out as the given declarations ask for.
 *
 * Two observations, and they have to be taken in this order. First the page as
 * it stands, to count the rows a line is broken across — the wrap is the damage,
 * so it has to be measured where it happens. Then again under `nowrap`, which
 * keeps a line that overflows measurable instead of folding it onto a second
 * row, and which is also what gives away a box that merely shrinks to fit its
 * text: that box moves between the passes, an authored one does not.
 */
function measureLines(group, declarations) {
  const properties = declarations ? Object.keys(declarations) : [];
  const restore = group.map(({ element, box }) => ({
    element,
    box,
    declared: properties.map((property) => ({
      property,
      value: element.style.getPropertyValue(property),
      priority: element.style.getPropertyPriority(property),
    })),
    whiteSpace: box.style.getPropertyValue("white-space"),
    whiteSpacePriority: box.style.getPropertyPriority("white-space"),
  }));
  for (const { element } of group) {
    for (const property of properties) {
      element.style.setProperty(property, declarations[property], "important");
    }
  }

  const range = document.createRange();
  const rows = group.map(({ element }) => rowCount(range, element));

  for (const { box } of group) {
    box.style.setProperty("white-space", "nowrap", "important");
  }
  const measurements = group.map(({ element, box, edges }, index) => {
    range.selectNodeContents(element);
    return {
      rows: rows[index],
      boxWidth: contentWidth(box, edges),
      textWidth: range.getBoundingClientRect().width,
    };
  });

  for (const saved of restore) {
    for (const { property, value, priority } of saved.declared) {
      if (value) {
        saved.element.style.setProperty(property, value, priority);
      } else {
        saved.element.style.removeProperty(property);
      }
    }
    if (saved.whiteSpace) {
      saved.box.style.setProperty(
        "white-space",
        saved.whiteSpace,
        saved.whiteSpacePriority
      );
    } else {
      saved.box.style.removeProperty("white-space");
    }
  }
  return measurements;
}

/* How each line sits in its box now, against how it would sit laid out this way. */
function fitAgainst(group, declarations) {
  const current = measureLines(group, null);
  const alternative = measureLines(group, declarations);
  return current.map((measurement, index) => ({
    rows: measurement.rows,
    boxWidth: measurement.boxWidth,
    textWidth: measurement.textWidth,
    substituteRows: alternative[index].rows,
    substituteBoxWidth: alternative[index].boxWidth,
    substituteTextWidth: alternative[index].textWidth,
  }));
}

function fitsBetter(group, declarations) {
  const verdict = evaluateSubstitution(fitAgainst(group, declarations));
  return verdict !== null && verdict.improves;
}

/* What `fxl-default-serif.css` leaves as the page's font-family. */
const INJECTED_DEFAULT = ["times new roman", "serif"];

/* What the WebView would have drawn the unstyled text in without it. */
const USER_AGENT_DEFAULT = "initial";

function pageDefaultIsInjected() {
  const families = parseFamilyList(
    window.getComputedStyle(document.documentElement).fontFamily
  ).map((family) => family.toLowerCase());
  return (
    families.length === INJECTED_DEFAULT.length &&
    families.every((family, index) => family === INJECTED_DEFAULT[index])
  );
}

function setRootFamily(value, priority) {
  if (value) {
    document.documentElement.style.setProperty("font-family", value, priority);
  } else {
    document.documentElement.style.removeProperty("font-family");
  }
}

/*
 * The lines wearing the page default, found by moving the root's family and
 * seeing which lines move with it. Asked that way rather than by matching the
 * default's name, so a publication that asks for Times itself is left holding
 * its own choice.
 */
function linesInheritingPageDefault(textLines) {
  const before = textLines.map(
    ({ element }) => window.getComputedStyle(element).fontFamily
  );
  const saved = {
    value: document.documentElement.style.getPropertyValue("font-family"),
    priority: document.documentElement.style.getPropertyPriority("font-family"),
  };
  setRootFamily(USER_AGENT_DEFAULT, "important");
  const moved = textLines.filter(
    ({ element }, index) =>
      window.getComputedStyle(element).fontFamily !== before[index]
  );
  setRootFamily(saved.value, saved.priority);

  const samples = [];
  for (const { element, style } of moved) {
    const sample = sampleFor(element, style);
    if (sample) {
      samples.push(sample);
    }
    if (samples.length === MAX_SAMPLES_PER_FAMILY) {
      break;
    }
  }
  return samples;
}

/*
 * Hands the page default back to the WebView where the publication's unstyled
 * lines fill their authored boxes better without the injected one. Set inline
 * on the root, which supplies only what the publication left unsaid: a family
 * the page declares for itself still wins, exactly as it did before.
 */
function revertPageDefaultIfItHurts(textLines) {
  if (!pageDefaultIsInjected()) {
    return;
  }
  const group = linesInheritingPageDefault(textLines);
  if (
    group.length > 0 &&
    fitsBetter(group, { "font-family": USER_AGENT_DEFAULT })
  ) {
    setRootFamily(USER_AGENT_DEFAULT, "");
  }
}

/*
 * `fxl-default-serif.css` also turns pair-kerning off for every overlay, on the
 * evidence of a book whose baked artwork was laid out without it (RR-6369).
 * That is another metric imposed on the page without asking it — and the only
 * one that reaches a publication rendering in a font it embeds itself, which
 * both font substitutions leave alone. A book whose artwork *was* kerned is
 * widened by it, so the same question is put to the same authored boxes.
 *
 * Asked last, once the page is wearing the face it is going to keep. Kerning
 * moves a line by a fraction of a percent; a page overflowing because its font
 * is 8% too wide would let it fire as a stand-in for the decision that actually
 * belongs to the font, and then be judged on a rendering that no longer exists.
 */
function kerningIsSuppressed() {
  return (
    !!document.body &&
    window.getComputedStyle(document.body).fontKerning === "none"
  );
}

function restoreKerningIfItHelps(textLines) {
  if (!kerningIsSuppressed()) {
    return;
  }
  const group = [];
  for (const { element, style } of textLines) {
    const sample = sampleFor(element, style);
    if (sample) {
      group.push(sample);
    }
    if (group.length === MAX_SAMPLES_PER_FAMILY) {
      break;
    }
  }
  if (group.length === 0 || !fitsBetter(group, { "font-kerning": "normal" })) {
    return;
  }
  const override = document.createElement("style");
  override.textContent = "* { font-kerning: normal; }";
  (document.head || document.documentElement).appendChild(override);
}

function cloneFaces(family, directory) {
  const faces = [];
  for (const face of CLONE_FACES) {
    let fontFace;
    try {
      fontFace = new FontFace(family, 'url("' + directory + face.file + '")', {
        weight: face.weight,
        style: face.style,
        display: "swap",
      });
    } catch (error) {
      continue;
    }
    document.fonts.add(fontFace);
    faces.push(fontFace);
  }
  return faces;
}

function loadAll(faces) {
  return Promise.all(faces.map((face) => face.load().catch(() => {})));
}

function documentParsed() {
  if (document.readyState !== "loading") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    document.addEventListener("DOMContentLoaded", resolve, { once: true });
  });
}

function stylesheetsSettled() {
  const pending = [];
  for (const link of document.querySelectorAll('link[rel~="stylesheet"]')) {
    if (link.sheet) {
      continue;
    }
    pending.push(
      new Promise((resolve) => {
        link.addEventListener("load", resolve, { once: true });
        link.addEventListener("error", resolve, { once: true });
      })
    );
  }
  return Promise.all(pending);
}

function correctOverlayMetrics() {
  const directory = cloneFontDirectory();
  const context = document.createElement("canvas").getContext("2d");
  if (!directory || !context) {
    return Promise.resolve();
  }

  revertPageDefaultIfItHurts(textElements());

  /* Re-read the page: the correction above may have changed what it wears. */
  const groups = unrenderableOverlays(context, textElements());
  if (groups.size === 0) {
    return Promise.resolve(restoreKerningIfItHelps(textElements()));
  }

  return loadAll(cloneFaces(MEASUREMENT_FAMILY, directory))
    .then(() => {
      const substituted = [];
      for (const [family, group] of groups) {
        if (
          fitsBetter(group, { "font-family": quoteFamily(MEASUREMENT_FAMILY) })
        ) {
          substituted.push.apply(substituted, cloneFaces(family, directory));
        }
      }
      if (substituted.length === 0) {
        return undefined;
      }
      return loadAll(substituted).then(() => document.fonts.ready);
    })
    .then(() => restoreKerningIfItHelps(textElements()));
}

/*
 * Nothing can be measured, or asked to render, until the faces the page and the
 * injected default point at have finished loading: a face still in flight
 * measures as whatever is standing in for it.
 */
function fontsSettled() {
  return document.fonts.ready.catch(() => {});
}

export function applyFontFallback() {
  if (typeof FontFace === "undefined" || !document.fonts) {
    return Promise.resolve();
  }
  return documentParsed()
    .then(stylesheetsSettled)
    .then(fontsSettled)
    .then(correctOverlayMetrics);
}
