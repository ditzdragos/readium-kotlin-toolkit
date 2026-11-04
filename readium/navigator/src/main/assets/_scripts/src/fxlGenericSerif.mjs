//
//  Copyright 2025 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

import { genericSerifWithFamily } from "./fxlFontFit.mjs";

const STYLE_RULE = 1;

/* RR-9372: a generic can't be registered over, so the family goes in front of `serif` in the page's own declarations. */
export function putFamilyBeforeGenericSerif(document, family) {
  const rewrite = (style) => {
    const value = genericSerifWithFamily(
      style.getPropertyValue("font-family"),
      family
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
    let rules;
    try {
      rules = sheet.cssRules;
    } catch (error) {
      return;
    }
    walkRules(rules);
  };

  for (const sheet of document.styleSheets) {
    walkSheet(sheet);
  }
  /* The root's inline family is the page default `revertPageDefaultIfItHurts` already measured and chose. */
  for (const element of document.querySelectorAll("[style]")) {
    if (element !== document.documentElement) {
      rewrite(element.style);
    }
  }
}
