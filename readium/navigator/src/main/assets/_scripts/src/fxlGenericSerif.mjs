//
//  Copyright 2025 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

import { quoteFamily, startsWithGenericSerif } from "./fxlFontFit.mjs";

const STYLE_RULE = 1;

/* A declared value with the clone put in front of its leading bare `serif`, or null when it has none. */
export function cloneBeforeGenericSerif(value, clone) {
  return startsWithGenericSerif(value)
    ? quoteFamily(clone) + ", " + value.trim()
    : null;
}

function rulesOf(sheet) {
  try {
    return sheet.cssRules;
  } catch (error) {
    return null;
  }
}

/* RR-9372: a generic can't be registered over, so the clone goes in front of `serif` in the page's own declarations. */
export function putCloneBeforeGenericSerif(document, clone) {
  const rewrite = (style) => {
    const value = cloneBeforeGenericSerif(
      style.getPropertyValue("font-family"),
      clone
    );
    if (value) {
      style.setProperty(
        "font-family",
        value,
        style.getPropertyPriority("font-family")
      );
    }
  };
  const walkRules = (rules) => {
    for (const rule of rules) {
      if (rule.type === STYLE_RULE) {
        rewrite(rule.style);
      }
      if (rule.styleSheet) {
        walkSheet(rule.styleSheet);
      }
      if (rule.cssRules) {
        walkRules(rule.cssRules);
      }
    }
  };
  const walkSheet = (sheet) => {
    const rules = rulesOf(sheet);
    if (rules) {
      walkRules(rules);
    }
  };

  for (const sheet of document.styleSheets) {
    walkSheet(sheet);
  }
  /* The root's inline family is where `revertPageDefaultIfItHurts` later writes the page default. */
  for (const element of document.querySelectorAll("[style]")) {
    if (element !== document.documentElement && element.style) {
      rewrite(element.style);
    }
  }
}

/*
 * RR-9372: the artwork and line boxes of these books were laid out in Times,
 * and Android draws a bare `serif` in the wider Noto Serif. A line with no
 * authored box (a single SVG glyph) doesn't move the highlight, so only a boxed
 * one triggers the rewrite.
 */
export function drawGenericSerifInClone(document, clone, lines, isBoxed) {
  const triggered = lines.some(
    (line) => startsWithGenericSerif(line.style.fontFamily) && isBoxed(line)
  );
  if (triggered) {
    putCloneBeforeGenericSerif(document, clone);
  }
  return triggered;
}
