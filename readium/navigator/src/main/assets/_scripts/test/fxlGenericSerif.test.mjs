import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  declaredFontFaceFamily,
  putFamilyBeforeGenericSerif,
} from "../src/fxlGenericSerif.mjs";

const FAMILY = "Times New Roman";
const CLONE_FIRST = '"Times New Roman", serif';

function style(fontFamily, priority = "") {
  const declared = { value: fontFamily, priority };
  return {
    getPropertyValue: (property) =>
      property === "font-family" ? declared.value : "",
    getPropertyPriority: (property) =>
      property === "font-family" ? declared.priority : "",
    setProperty: (property, value, newPriority) => {
      assert.equal(property, "font-family");
      declared.value = value;
      declared.priority = newPriority;
    },
    declared,
  };
}

const styleRule = (fontFamily, priority) => ({
  type: 1,
  style: style(fontFamily, priority),
});

function page({ sheets = [], inline = [], root = null } = {}) {
  const documentElement = root || { style: style("") };
  return {
    documentElement,
    styleSheets: sheets,
    querySelectorAll: (selector) => {
      assert.equal(selector, "[style]");
      return [documentElement, ...inline];
    },
  };
}

describe("putFamilyBeforeGenericSerif (RR-9372)", () => {
  it("puts the family in front of serif in a style rule", () => {
    const rule = styleRule("serif");
    putFamilyBeforeGenericSerif(
      page({ sheets: [{ cssRules: [rule] }] }),
      FAMILY
    );
    assert.equal(rule.style.declared.value, CLONE_FIRST);
  });

  it("keeps an !important declaration important", () => {
    const rule = styleRule("serif", "important");
    putFamilyBeforeGenericSerif(
      page({ sheets: [{ cssRules: [rule] }] }),
      FAMILY
    );
    assert.equal(rule.style.declared.value, CLONE_FIRST);
    assert.equal(rule.style.declared.priority, "important");
  });

  it("leaves a rule that names a family or another generic", () => {
    const named = styleRule("HankBT-Roman");
    const sans = styleRule("sans-serif");
    putFamilyBeforeGenericSerif(
      page({ sheets: [{ cssRules: [named, sans] }] }),
      FAMILY
    );
    assert.equal(named.style.declared.value, "HankBT-Roman");
    assert.equal(sans.style.declared.value, "sans-serif");
  });

  it("reaches rules inside @media and @import", () => {
    const nested = styleRule("serif");
    const imported = styleRule("serif");
    const media = { type: 4, cssRules: [nested] };
    const importRule = { type: 3, styleSheet: { cssRules: [imported] } };
    putFamilyBeforeGenericSerif(
      page({ sheets: [{ cssRules: [importRule, media] }] }),
      FAMILY
    );
    assert.equal(nested.style.declared.value, CLONE_FIRST);
    assert.equal(imported.style.declared.value, CLONE_FIRST);
  });

  it("does not touch @font-face or @page descriptors", () => {
    const fontFace = { type: 5, style: style("serif") };
    const pageRule = { type: 6, style: style("serif") };
    putFamilyBeforeGenericSerif(
      page({ sheets: [{ cssRules: [fontFace, pageRule] }] }),
      FAMILY
    );
    assert.equal(fontFace.style.declared.value, "serif");
    assert.equal(pageRule.style.declared.value, "serif");
  });

  it("skips a sheet it may not read and carries on with the rest", () => {
    const rule = styleRule("serif");
    const unreadable = {
      get cssRules() {
        throw new Error("SecurityError");
      },
    };
    putFamilyBeforeGenericSerif(
      page({ sheets: [unreadable, { cssRules: [rule] }] }),
      FAMILY
    );
    assert.equal(rule.style.declared.value, CLONE_FIRST);
  });

  it("rewrites inline styles but leaves the root's, which the page-default revert owns", () => {
    const line = { style: style("serif") };
    const root = { style: style("serif") };
    putFamilyBeforeGenericSerif(page({ inline: [line], root }), FAMILY);
    assert.equal(line.style.declared.value, CLONE_FIRST);
    assert.equal(root.style.declared.value, "serif");
  });

  it("changes nothing when run again", () => {
    const rule = styleRule("serif");
    const document = page({ sheets: [{ cssRules: [rule] }] });
    putFamilyBeforeGenericSerif(document, FAMILY);
    putFamilyBeforeGenericSerif(document, FAMILY);
    assert.equal(rule.style.declared.value, CLONE_FIRST);
  });
});

const fontFaceRule = (fontFamily) => ({ type: 5, style: style(fontFamily) });

describe("declaredFontFaceFamily (RR-9372)", () => {
  it("names the family of the first @font-face, unquoted", () => {
    const sheet = {
      cssRules: [
        styleRule("serif"),
        fontFaceRule('"Times New Roman"'),
        fontFaceRule("Other"),
      ],
    };
    assert.equal(declaredFontFaceFamily(sheet), "Times New Roman");
  });

  it("is null without a sheet, a face, or readable rules", () => {
    assert.equal(declaredFontFaceFamily(null), null);
    assert.equal(
      declaredFontFaceFamily({ cssRules: [styleRule("serif")] }),
      null
    );
    assert.equal(
      declaredFontFaceFamily({
        get cssRules() {
          throw new Error("SecurityError");
        },
      }),
      null
    );
  });
});
