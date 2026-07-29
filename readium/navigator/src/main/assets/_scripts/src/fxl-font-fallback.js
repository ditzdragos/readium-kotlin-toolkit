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
  faceFor,
  faceKey,
  isNamedFamily,
  parseFamilyList,
  probeTextFrom,
} from "./fxlFontFit.mjs";

const CLONE_FACES = [
  { file: "NimbusRoman.woff2", weight: "400", style: "normal" },
  { file: "NimbusRoman-Italic.woff2", weight: "400", style: "italic" },
  { file: "NimbusRoman-Bold.woff2", weight: "700", style: "normal" },
  { file: "NimbusRoman-BoldItalic.woff2", weight: "700", style: "italic" },
];

/* Named by no publication, so measuring under it cannot collide with the page. */
const MEASUREMENT_FAMILY = "Readium FXL Metric Clone";

/* Identifies what `HtmlInjector` injected, among the publication's own sheets. */
const INJECTED_DEFAULT_PATH = "fxl-default-serif/";

const PROBE_SIZE = "72px";

/* Enough lines for a stable median without walking a whole comic spread. */
const MAX_SAMPLES_PER_FAMILY = 40;

function cloneFontDirectory() {
  const link =
    document.querySelector(
      'link[rel="preload"][href*="' + INJECTED_DEFAULT_PATH + '"]'
    ) ||
    document.querySelector(
      'link[rel="stylesheet"][href*="' + INJECTED_DEFAULT_PATH + '"]'
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

/* Named by no publication either, and this one is meant never to resolve. */
const IMPOSSIBLE_FAMILY = "Readium No Such Family 8f3a";

/*
 * Whether the availability probe can tell anything yet.
 *
 * `familyRenders` reads "all three generics measured the same" as "the family
 * drew the text itself". Before the page has laid anything out that reasoning
 * silently inverts: the generics have nothing to draw with either, so they too
 * measure alike, every family on the page reports as present, and the
 * correction concludes there is nothing to correct — which is indistinguishable
 * from success and is how RR-7953 came back.
 *
 * Asking the same question about a family that cannot exist says which of the
 * two situations this is: its generics have to disagree, and if they do not,
 * nothing measured here means anything yet.
 */
function probeDiscriminates(context, text) {
  return !familyRenders(context, IMPOSSIBLE_FAMILY, text);
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
 *
 * The padding has to be taken off in that same space, which means knowing what
 * the transform did. `offsetWidth` would answer that to the nearest whole pixel
 * — on a narrow padded box, a layout width of 10.4 reports 10 and puts the
 * scale out by 4% — so the used width is read from the computed style, which is
 * not rounded. It is the content width already, whatever `box-sizing` says, so
 * the border box to scale against is that plus the edges.
 */
function contentWidth(box, style, edges) {
  const width = box.getBoundingClientRect().width;
  const used = parseFloat(style.width);
  if (used > 0) {
    return width * (used / (used + edges));
  }
  const scale = box.offsetWidth > 0 ? width / box.offsetWidth : 1;
  return width - edges * scale;
}

/*
 * Elements whose text content is source rather than something the page draws.
 * Their characters must not reach the availability probe: a `<script>` body
 * contributes `{ } ; @ #`, which no publication sets in its overlay font, and
 * probing an embedded subset with characters it was never asked to carry is
 * exactly how a font that renders perfectly gets reported missing.
 */
const NON_RENDERED_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
  "TITLE",
]);

/* The shortest own text that can tell two faces apart when measured. */
const MIN_MEASURABLE_CHARACTERS = 2;

/*
 * Every element holding text of its own.
 *
 * Walked once per page and handed to each step in turn: `getComputedStyle`
 * returns a live declaration, so a record stays true across the corrections
 * below, and re-reading the DOM for each of them would cost another
 * `querySelectorAll("*")` and another style resolution per element — thousands
 * of both on an OCR page carrying a span per word.
 *
 * Text too short to measure is kept rather than dropped. It cannot be a sample
 * — one character says nothing about which face fits a line — but it still
 * wears a family and still draws a weight, and a page whose only bold is a
 * one-letter drop cap needs that bold face registered like any other: leaving
 * it out is what makes the WebView synthesise it.
 */
function textElements() {
  const found = [];
  const elements = document.body ? document.body.querySelectorAll("*") : [];
  for (const element of elements) {
    if (NON_RENDERED_TAGS.has(element.tagName)) {
      continue;
    }
    const text = ownText(element);
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const style = window.getComputedStyle(element);
    if (style.display === "none") {
      continue;
    }
    found.push({
      element,
      style,
      text,
      measurable: trimmed.length >= MIN_MEASURABLE_CHARACTERS,
    });
  }
  return found;
}

/* The named families a line ends up asking for, as the page currently stands. */
function familiesOf(style) {
  return parseFamilyList(style.fontFamily).filter(isNamedFamily);
}

/* A line, and the box to measure it against, ready for `measureLines`. */
function sampleFor({ element, style, measurable }) {
  if (!measurable) {
    return null;
  }
  const box = boxElementFor(element);
  if (!box) {
    return null;
  }
  const boxStyle = box === element ? style : window.getComputedStyle(box);
  return {
    element,
    box,
    boxStyle,
    face: faceFor(style),
    edges: horizontalEdges(boxStyle),
  };
}

/*
 * Overlay lines that cannot render in any face they name, grouped by the name
 * to register the clone under — the first, so the registration wins the stack.
 */
function unrenderableOverlays(context, textLines) {
  const candidates = [];
  for (const line of textLines) {
    const families = familiesOf(line.style);
    if (families.length > 0) {
      candidates.push({ line, families });
    }
  }

  /*
   * A publication that wraps each word in its own span leaves too few
   * characters to tell two faces apart, so those lines are probed with
   * everything on the page set in the same family instead.
   */
  const familyText = new Map();
  for (const { line, families } of candidates) {
    familyText.set(
      families[0],
      (familyText.get(families[0]) || "") + line.text
    );
  }

  const groups = new Map();
  const rendered = new Map();
  for (const { line, families } of candidates) {
    let probe = probeTextFrom(line.text);
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
    const name = families[0];
    let group = groups.get(name);
    if (!group) {
      group = { samples: [], faces: new Set() };
      groups.set(name, group);
    }
    /* Every line wearing the family, so no face it draws goes unregistered. */
    group.faces.add(faceKey(faceFor(line.style)));

    if (group.samples.length < MAX_SAMPLES_PER_FAMILY) {
      const sample = sampleFor(line);
      if (sample) {
        group.samples.push(sample);
      }
    }
  }

  /* A family with no measurable line carries no evidence to decide on. */
  for (const [name, group] of groups) {
    if (group.samples.length === 0) {
      groups.delete(name);
    }
  }
  return groups;
}

/* Below this, two rects are the same row however their baselines differ. */
const MIN_ROW_SEPARATION = 4;

/*
 * How many rows a line is broken across as the page actually lays it out.
 *
 * Counting distinct tops is not enough. An overlay line carrying a nested span
 * — a different size, a superscript, anything sitting a pixel or two off its
 * neighbours' baseline — hands back two tops for text that is plainly on one
 * row, and that miscount is a wrap this module would then try to cure. A row
 * below is a whole line-height below, so tops are grouped by a share of the
 * tallest rect on the line rather than by equality.
 */
function rowCount(range, element) {
  range.selectNodeContents(element);
  const tops = [];
  let tallest = 0;
  for (const rect of range.getClientRects()) {
    if (rect.width > 1 && rect.height > 1) {
      tops.push(rect.top);
      tallest = Math.max(tallest, rect.height);
    }
  }
  if (tops.length === 0) {
    return 1;
  }
  tops.sort((a, b) => a - b);
  const separation = Math.max(tallest / 2, MIN_ROW_SEPARATION);
  let rows = 1;
  for (let index = 1; index < tops.length; index++) {
    if (tops[index] - tops[index - 1] > separation) {
      rows++;
    }
  }
  return rows;
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
  /*
   * Between here and the restore the real overlay carries `!important`
   * declarations that are not the publication's. Anything thrown in that window
   * — a node detached by a page turn, a WebView torn down mid-measurement —
   * would otherwise leave them applied for the life of the document, which is
   * the very misalignment this module exists to remove. So the restore runs on
   * the way out either way.
   */
  try {
    for (const { element } of group) {
      for (const property of properties) {
        element.style.setProperty(
          property,
          declarations[property],
          "important"
        );
      }
    }

    const range = document.createRange();
    const rows = group.map(({ element }) => rowCount(range, element));

    for (const { box } of group) {
      box.style.setProperty("white-space", "nowrap", "important");
    }
    return group.map(({ element, box, boxStyle, edges }, index) => {
      range.selectNodeContents(element);
      return {
        rows: rows[index],
        boxWidth: contentWidth(box, boxStyle, edges),
        textWidth: range.getBoundingClientRect().width,
      };
    });
  } finally {
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
  }
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

function injectedDefaultStyleSheet() {
  for (const sheet of document.styleSheets) {
    if ((sheet.href || "").indexOf(INJECTED_DEFAULT_PATH) !== -1) {
      return sheet;
    }
  }
  return null;
}

/*
 * What the root would compute to had `fxl-default-serif.css` not been injected
 * — the family to hand back if the injected one turns out to fit worse.
 *
 * Asked by switching the stylesheet off and reading the page again, rather than
 * by recognising the default by its name. A publication is perfectly entitled
 * to ask for Times on `html` itself, and a name match cannot tell that apart
 * from ours; reverting it would then throw away the publication's own choice
 * for the user agent's, which is a correction nobody asked for. Switching the
 * sheet off answers with whatever the page says for itself, which is the only
 * thing there is to give back.
 *
 * `null` means there is nothing of ours in force: no injected sheet, or a page
 * that overrides it anyway.
 */
function familyWithoutInjectedDefault() {
  const sheet = injectedDefaultStyleSheet();
  if (!sheet) {
    return null;
  }
  const root = document.documentElement;
  const current = window.getComputedStyle(root).fontFamily;
  sheet.disabled = true;
  const without = window.getComputedStyle(root).fontFamily;
  sheet.disabled = false;
  return without === current ? null : without;
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
function linesInheritingPageDefault(textLines, withoutInjected) {
  const before = textLines.map(({ style }) => style.fontFamily);
  const saved = {
    value: document.documentElement.style.getPropertyValue("font-family"),
    priority: document.documentElement.style.getPropertyPriority("font-family"),
  };
  setRootFamily(withoutInjected, "important");
  const moved = textLines.filter(
    (line, index) => line.style.fontFamily !== before[index]
  );
  setRootFamily(saved.value, saved.priority);

  const samples = [];
  for (const line of moved) {
    const sample = sampleFor(line);
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
  const withoutInjected = familyWithoutInjectedDefault();
  if (withoutInjected === null) {
    return;
  }
  const group = linesInheritingPageDefault(textLines, withoutInjected);
  if (
    group.length > 0 &&
    fitsBetter(group, { "font-family": withoutInjected })
  ) {
    setRootFamily(withoutInjected, "");
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
  for (const line of textLines) {
    const sample = sampleFor(line);
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

/*
 * `needed` holds the weight/slope combinations the page actually draws in this
 * family, so the faces it never uses are neither fetched nor decoded. It is
 * gathered from every line wearing the family rather than from the sampled
 * ones: registering a family without the bold face a line elsewhere on the page
 * asks for would hand that line a synthetically emboldened regular, whose
 * metrics are not the clone's and not the artwork's.
 */
function cloneFaces(family, directory, needed) {
  const faces = [];
  for (const face of CLONE_FACES) {
    if (needed && !needed.has(faceKey(face))) {
      continue;
    }
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

  /*
   * The one walk of the page. Each step below re-reads the same records, whose
   * computed styles are live and so answer for the page as the previous step
   * left it — including `unrenderableOverlays`, which has to see whatever the
   * page default was just changed to.
   */
  const textLines = textElements();
  if (textLines.length === 0) {
    return Promise.resolve();
  }

  return fontsSettled(textLines)
    .then(() => pageIsMeasurable(context, textLines, MAX_FRAMES_WAITED))
    .then((measurable) =>
      measurable
        ? correctMeasuredOverlays(context, directory, textLines)
        : undefined
    );
}

function nextFrame() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 16);
    }
  });
}

/* Long enough for a page to lay out, short enough not to outlive one. */
const MAX_FRAMES_WAITED = 30;

/*
 * Holds off until the page can actually answer the two questions put to it.
 *
 * Neither has an answer before layout: the availability probe reports every
 * family present (see `probeDiscriminates`), and a line whose box has no width
 * yet offers no authored width to judge a face against, so it is dropped as
 * unmeasurable. Both failures read as "nothing to correct" rather than as
 * "ask again", which is exactly how a page keeps the wrong metrics.
 *
 * Waiting on `document.fonts.ready` used to hide this by happening to take long
 * enough. It is not a layout barrier and never was, so the wait is now for the
 * thing actually needed, and gives up rather than spinning if it never arrives.
 */
function pageIsMeasurable(context, textLines, framesLeft) {
  const text = probeTextFrom(textLines[0].text);
  const ready =
    probeDiscriminates(context, text) &&
    textLines.some(({ element }) => boxElementFor(element) !== null);
  if (ready) {
    return Promise.resolve(true);
  }
  if (framesLeft <= 0) {
    return Promise.resolve(false);
  }
  return nextFrame().then(() =>
    pageIsMeasurable(context, textLines, framesLeft - 1)
  );
}

function correctMeasuredOverlays(context, directory, textLines) {
  revertPageDefaultIfItHurts(textLines);

  const groups = unrenderableOverlays(context, textLines);
  if (groups.size === 0) {
    return Promise.resolve(restoreKerningIfItHelps(textLines));
  }

  const measuring = new Set();
  for (const { faces } of groups.values()) {
    for (const key of faces) {
      measuring.add(key);
    }
  }
  const measurementFaces = cloneFaces(MEASUREMENT_FAMILY, directory, measuring);

  /*
   * The measurement family has done its job once every group has a verdict, and
   * a page whose groups were all rejected has no use for it at all. Left
   * registered its faces stay resident in each of the preloaded spread's
   * WebViews, for pages the code decided not to touch.
   */
  const release = () => {
    for (const face of measurementFaces) {
      document.fonts.delete(face);
    }
  };

  return loadAll(measurementFaces)
    .then(() => {
      const substituted = [];
      for (const [family, { samples, faces }] of groups) {
        if (
          fitsBetter(samples, {
            "font-family": quoteFamily(MEASUREMENT_FAMILY),
          })
        ) {
          substituted.push.apply(
            substituted,
            cloneFaces(family, directory, faces)
          );
        }
      }
      if (substituted.length === 0) {
        return undefined;
      }
      return loadAll(substituted).then(() => document.fonts.ready);
    })
    .then(
      (value) => {
        release();
        return value;
      },
      (error) => {
        release();
        throw error;
      }
    )
    .then(() => restoreKerningIfItHelps(textLines));
}

/*
 * Nothing can be measured, or asked to render, until the faces the page draws
 * have finished loading: a face still in flight measures as whatever is
 * standing in for it, and the whole question here is which face is drawing.
 *
 * `document.fonts.ready` alone does not settle that. It promises only that the
 * faces the page has *asked* for have resolved, and at this point — straight
 * after parsing, before anything has been laid out on screen — a page may not
 * have asked for any of them. It then resolves immediately, with the
 * publication's own embedded faces still unfetched, and the probe reports a
 * font the book carries as missing: the clone is registered over a face that
 * would have drawn the page correctly. `font-display: swap`, which
 * `HtmlInjector` forces onto every publisher `@font-face`, makes that reading
 * doubly wrong, because the stand-in it measures is a real rendering that the
 * comparison then judges the substitution against.
 *
 * So the faces are asked for rather than waited on. Only the families the text
 * actually draws are requested — a face no line wears is one the page would
 * never have fetched, and fetching it here would put back the download this
 * module goes out of its way not to make.
 */
function drawnFacesRequested(textLines) {
  const drawn = new Set();
  for (const { style } of textLines) {
    for (const family of parseFamilyList(style.fontFamily)) {
      drawn.add(family.toLowerCase());
    }
  }
  const pending = [];
  document.fonts.forEach((face) => {
    if (face.status === "unloaded" && drawn.has(face.family.toLowerCase())) {
      pending.push(face.load().catch(() => {}));
    }
  });
  return Promise.all(pending);
}

function fontsSettled(textLines) {
  return drawnFacesRequested(textLines)
    .then(() => document.fonts.ready)
    .catch(() => {});
}

export function applyFontFallback() {
  if (typeof FontFace === "undefined" || !document.fonts) {
    return Promise.resolve();
  }
  return documentParsed().then(stylesheetsSettled).then(correctOverlayMetrics);
}
