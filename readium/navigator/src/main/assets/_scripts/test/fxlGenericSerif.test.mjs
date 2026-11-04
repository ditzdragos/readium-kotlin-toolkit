import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  cloneBeforeGenericSerif,
  drawGenericSerifInClone,
  putCloneBeforeGenericSerif,
} from "../src/fxlGenericSerif.mjs";

const FAMILY = "Times New Roman";

/* `CSSRule.type` values. */
const STYLE_RULE = 1;
const IMPORT_RULE = 3;
const MEDIA_RULE = 4;
const FONT_FACE_RULE = 5;
const PAGE_RULE = 6;
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
  type: STYLE_RULE,
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

describe("putCloneBeforeGenericSerif (RR-9372)", () => {
  it("puts the family in front of serif in a style rule", () => {
    const rule = styleRule("serif");
    putCloneBeforeGenericSerif(
      page({ sheets: [{ cssRules: [rule] }] }),
      FAMILY
    );
    assert.equal(rule.style.declared.value, CLONE_FIRST);
  });

  it("keeps an !important declaration important", () => {
    const rule = styleRule("serif", "important");
    putCloneBeforeGenericSerif(
      page({ sheets: [{ cssRules: [rule] }] }),
      FAMILY
    );
    assert.equal(rule.style.declared.value, CLONE_FIRST);
    assert.equal(rule.style.declared.priority, "important");
  });

  it("leaves a rule that names a family or another generic", () => {
    const named = styleRule("HankBT-Roman");
    const sans = styleRule("sans-serif");
    putCloneBeforeGenericSerif(
      page({ sheets: [{ cssRules: [named, sans] }] }),
      FAMILY
    );
    assert.equal(named.style.declared.value, "HankBT-Roman");
    assert.equal(sans.style.declared.value, "sans-serif");
  });

  it("reaches rules inside @media and @import", () => {
    const nested = styleRule("serif");
    const imported = styleRule("serif");
    const media = { type: MEDIA_RULE, cssRules: [nested] };
    const importRule = {
      type: IMPORT_RULE,
      styleSheet: { cssRules: [imported] },
    };
    putCloneBeforeGenericSerif(
      page({ sheets: [{ cssRules: [importRule, media] }] }),
      FAMILY
    );
    assert.equal(nested.style.declared.value, CLONE_FIRST);
    assert.equal(imported.style.declared.value, CLONE_FIRST);
  });

  it("does not touch @font-face or @page descriptors", () => {
    const fontFace = { type: FONT_FACE_RULE, style: style("serif") };
    const pageRule = { type: PAGE_RULE, style: style("serif") };
    putCloneBeforeGenericSerif(
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
    putCloneBeforeGenericSerif(
      page({ sheets: [unreadable, { cssRules: [rule] }] }),
      FAMILY
    );
    assert.equal(rule.style.declared.value, CLONE_FIRST);
  });

  it("rewrites inline styles but leaves the root's, which the page-default revert owns", () => {
    const line = { style: style("serif") };
    const root = { style: style("serif") };
    putCloneBeforeGenericSerif(page({ inline: [line], root }), FAMILY);
    assert.equal(line.style.declared.value, CLONE_FIRST);
    assert.equal(root.style.declared.value, "serif");
  });

  it("skips an element with no inline style object, such as one in a foreign namespace", () => {
    const line = { style: style("serif") };
    putCloneBeforeGenericSerif(page({ inline: [{}, line] }), FAMILY);
    assert.equal(line.style.declared.value, CLONE_FIRST);
  });

  it("changes nothing when run again", () => {
    const rule = styleRule("serif");
    const document = page({ sheets: [{ cssRules: [rule] }] });
    putCloneBeforeGenericSerif(document, FAMILY);
    putCloneBeforeGenericSerif(document, FAMILY);
    assert.equal(rule.style.declared.value, CLONE_FIRST);
  });
});

describe("cloneBeforeGenericSerif", () => {
  it("puts the family in front of a bare generic serif", () => {
    assert.equal(
      cloneBeforeGenericSerif("serif", FAMILY),
      '"Times New Roman", serif'
    );
    assert.equal(
      cloneBeforeGenericSerif(" SERIF ", FAMILY),
      '"Times New Roman", SERIF'
    );
  });

  it("catches serif ahead of a named family, which never draws", () => {
    assert.equal(
      cloneBeforeGenericSerif("serif, Georgia", FAMILY),
      '"Times New Roman", serif, Georgia'
    );
  });

  it("leaves a stack whose first entry is a named family", () => {
    assert.equal(
      cloneBeforeGenericSerif('"Times New Roman", serif', FAMILY),
      null
    );
    assert.equal(
      cloneBeforeGenericSerif("TimesNewRomanMTStd, serif", FAMILY),
      null
    );
  });

  it("leaves a stack that reaches another generic first", () => {
    assert.equal(cloneBeforeGenericSerif("sans-serif, serif", FAMILY), null);
    assert.equal(cloneBeforeGenericSerif("ui-serif", FAMILY), null);
  });

  it("does not mistake a family quoted as serif for the generic", () => {
    assert.equal(cloneBeforeGenericSerif('"serif"', FAMILY), null);
    assert.equal(cloneBeforeGenericSerif("'serif'", FAMILY), null);
  });

  it("has nothing to rewrite in an empty or keyword value", () => {
    assert.equal(cloneBeforeGenericSerif("", FAMILY), null);
    assert.equal(cloneBeforeGenericSerif("inherit", FAMILY), null);
  });

  it("leaves its own result alone, so a retried pass changes nothing", () => {
    const once = cloneBeforeGenericSerif("serif", FAMILY);
    assert.equal(cloneBeforeGenericSerif(once, FAMILY), null);
  });
});

describe("drawGenericSerifInClone (RR-9372)", () => {
  const line = (fontFamily, boxed) => ({ style: { fontFamily }, boxed });
  const isBoxed = ({ boxed }) => boxed;

  it("rewrites the page when a boxed line asks for bare serif", () => {
    const rule = styleRule("serif");
    drawGenericSerifInClone(
      page({ sheets: [{ cssRules: [rule] }] }),
      FAMILY,
      [line("sans-serif", true), line("serif", true)],
      isBoxed
    );
    assert.equal(rule.style.declared.value, CLONE_FIRST);
  });

  it("leaves the page alone when only unboxed lines ask for it", () => {
    const rule = styleRule("serif");
    drawGenericSerifInClone(
      page({ sheets: [{ cssRules: [rule] }] }),
      FAMILY,
      [line("serif", false), line("Georgia, serif", true)],
      isBoxed
    );
    assert.equal(rule.style.declared.value, "serif");
  });
});
