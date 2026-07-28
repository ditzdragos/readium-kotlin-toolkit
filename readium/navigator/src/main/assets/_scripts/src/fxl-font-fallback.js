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
 * Resolve every font family the page declares. For those the platform cannot
 * supply, register the bundled Times-metric clone under that exact name, which
 * puts the overlay back on the artwork's metrics without fighting the cascade.
 * A publication that embeds the family itself resolves fine and is left alone.
 */

const CLONE_FACES = [
  { file: "NimbusRoman.woff", weight: "400", style: "normal" },
  { file: "NimbusRoman-Italic.woff", weight: "400", style: "italic" },
  { file: "NimbusRoman-Bold.woff", weight: "700", style: "normal" },
  { file: "NimbusRoman-BoldItalic.woff", weight: "700", style: "italic" },
];

const NON_FAMILY_KEYWORDS = new Set([
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
  "inherit",
  "initial",
  "unset",
  "revert",
  "revert-layer",
]);

// Mixes wide, narrow and non-alphabetic glyphs so two different faces are very
// unlikely to measure the same.
const PROBE_TEXT = "mmmmmmmmmmlliWWWWQQQ@#$%";
const PROBE_SIZE = "72px";

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

function parseFamilyList(value) {
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

function isCandidateFamily(family) {
  return (
    !NON_FAMILY_KEYWORDS.has(family.toLowerCase()) &&
    family.indexOf("(") === -1 &&
    family.charAt(0) !== "-"
  );
}

function collectFromRules(rules, families) {
  for (const rule of rules) {
    if (
      typeof CSSFontFaceRule !== "undefined" &&
      rule instanceof CSSFontFaceRule
    ) {
      continue;
    }
    if (rule.style && rule.style.fontFamily) {
      for (const family of parseFamilyList(rule.style.fontFamily)) {
        families.add(family);
      }
    }
    if (rule.cssRules) {
      collectFromRules(rule.cssRules, families);
    }
  }
}

function declaredFamilies() {
  const families = new Set();
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch (error) {
      continue;
    }
    if (rules) {
      collectFromRules(rules, families);
    }
  }
  for (const element of document.querySelectorAll("[style]")) {
    const inline = element.style && element.style.fontFamily;
    if (inline) {
      for (const family of parseFamilyList(inline)) {
        families.add(family);
      }
    }
  }
  return Array.from(families).filter(isCandidateFamily);
}

function quoteFamily(family) {
  return '"' + family.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

/*
 * A family the platform cannot supply falls through to whichever generic
 * follows it, so measuring the same text against three different generics tells
 * us whether the family itself resolved: identical widths mean the family won,
 * differing widths mean each generic won its own turn.
 */
function familyResolves(context, family) {
  const quoted = quoteFamily(family);
  const measure = (stack) => {
    context.font = PROBE_SIZE + " " + stack;
    return context.measureText(PROBE_TEXT).width;
  };
  const withMonospace = measure(quoted + ", monospace");
  const withSansSerif = measure(quoted + ", sans-serif");
  const withSerif = measure(quoted + ", serif");
  return withMonospace === withSansSerif && withSansSerif === withSerif;
}

function registerClone(family, directory) {
  return CLONE_FACES.map((face) => {
    let fontFace;
    try {
      fontFace = new FontFace(family, 'url("' + directory + face.file + '")', {
        weight: face.weight,
        style: face.style,
        display: "swap",
      });
    } catch (error) {
      return Promise.resolve();
    }
    document.fonts.add(fontFace);
    return fontFace.load().catch(() => {});
  });
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

function cloneUnresolvableFamilies() {
  const directory = cloneFontDirectory();
  const context = document.createElement("canvas").getContext("2d");
  if (!directory || !context) {
    return Promise.resolve();
  }

  const loading = [];
  for (const family of declaredFamilies()) {
    if (!familyResolves(context, family)) {
      loading.push.apply(loading, registerClone(family, directory));
    }
  }
  if (loading.length === 0) {
    return Promise.resolve();
  }
  return Promise.all(loading).then(function () {
    return document.fonts.ready;
  });
}

export function applyFontFallback() {
  if (typeof FontFace === "undefined" || !document.fonts) {
    return Promise.resolve();
  }
  return documentParsed()
    .then(stylesheetsSettled)
    .then(cloneUnresolvableFamilies);
}
