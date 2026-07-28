import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MIN_FIT_IMPROVEMENT,
  SYNTHETIC_PROBE_TEXT,
  evaluateSubstitution,
  fitError,
  isGenericFamily,
  isNamedFamily,
  median,
  parseFamilyList,
  probeTextFrom,
  usableSamples,
} from "../src/fxlFontFit.mjs";

function sample({
  boxWidth = 300,
  textWidth = 300,
  substituteBoxWidth = boxWidth,
  substituteTextWidth = textWidth,
} = {}) {
  return { boxWidth, textWidth, substituteBoxWidth, substituteTextWidth };
}

describe("parseFamilyList", () => {
  it("splits an unquoted stack", () => {
    assert.deepEqual(parseFamilyList("TimesNewRomanMTStd, serif"), [
      "TimesNewRomanMTStd",
      "serif",
    ]);
  });

  it("keeps a quoted family containing a comma", () => {
    assert.deepEqual(parseFamilyList('"Adobe Caslon, Pro", serif'), [
      "Adobe Caslon, Pro",
      "serif",
    ]);
  });

  it("collapses runs of whitespace inside a name", () => {
    assert.deepEqual(parseFamilyList("Times   New   Roman"), [
      "Times New Roman",
    ]);
  });

  it("unescapes an escaped quote", () => {
    assert.deepEqual(parseFamilyList('"Book\\"ish"'), ['Book"ish']);
  });

  it("drops empty entries", () => {
    assert.deepEqual(parseFamilyList("Georgia, , serif"), ["Georgia", "serif"]);
  });
});

describe("isNamedFamily", () => {
  it("accepts a family a face could be registered under", () => {
    assert.equal(isNamedFamily("TimesNewRomanMTStd"), true);
    assert.equal(isNamedFamily("Times New Roman"), true);
  });

  it("rejects generics", () => {
    for (const generic of ["serif", "Sans-Serif", "monospace", "system-ui"]) {
      assert.equal(isGenericFamily(generic), true, generic);
      assert.equal(isNamedFamily(generic), false, generic);
    }
  });

  it("rejects CSS-wide keywords and vendor or functional values", () => {
    assert.equal(isNamedFamily("inherit"), false);
    assert.equal(isNamedFamily("-apple-system"), false);
    assert.equal(isNamedFamily("var(--book-font)"), false);
  });
});

describe("probeTextFrom", () => {
  it("probes with the characters the page shows, deduplicated", () => {
    const probe = probeTextFrom("The frog sat.");
    assert.equal(probe.startsWith("Thefrogsat."), true);
    assert.equal(/\s/.test(probe), false);
    for (const character of probe) {
      assert.equal("The frog sat.".includes(character), true, character);
    }
  });

  it("never introduces a glyph the page lacks, which is what misread subsets", () => {
    const probe = probeTextFrom("A frog, a fly, and an old lady.");
    for (const character of "@#$%WQ") {
      assert.equal(probe.includes(character), false, character);
    }
  });

  it("repeats short text so two faces still measure differently", () => {
    assert.equal(probeTextFrom("frog").length >= 24, true);
    assert.equal(probeTextFrom("frog").startsWith("frog"), true);
  });

  it("falls back to the synthetic probe when there is nothing to measure", () => {
    assert.equal(probeTextFrom("hi"), SYNTHETIC_PROBE_TEXT);
    assert.equal(probeTextFrom("   "), SYNTHETIC_PROBE_TEXT);
    assert.equal(probeTextFrom(null), SYNTHETIC_PROBE_TEXT);
  });

  it("caps how much of a long page it probes with", () => {
    const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const probe = probeTextFrom(alphabet + "0123456789.,;:!?'\"-—()[]{}");
    assert.equal(probe.length, 60);
  });
});

describe("median", () => {
  it("takes the middle of an odd sample", () => {
    assert.equal(median([3, 1, 2]), 2);
  });

  it("averages the middle pair of an even sample", () => {
    assert.equal(median([1, 2, 3, 4]), 2.5);
  });

  it("has no value for an empty sample", () => {
    assert.equal(median([]), null);
    assert.equal(fitError([]), null);
  });
});

describe("usableSamples", () => {
  it("keeps lines measured against a box that did not move", () => {
    assert.equal(usableSamples([sample()]).length, 1);
  });

  it("drops a box that resized with its text, which fits every face perfectly", () => {
    const shrinkToFit = sample({
      boxWidth: 300,
      textWidth: 300,
      substituteBoxWidth: 276,
      substituteTextWidth: 276,
    });
    assert.equal(usableSamples([shrinkToFit]).length, 0);
  });

  it("drops lines with nothing to measure", () => {
    assert.equal(usableSamples([sample({ boxWidth: 0 })]).length, 0);
    assert.equal(usableSamples([sample({ textWidth: 0 })]).length, 0);
    assert.equal(usableSamples([sample({ substituteTextWidth: 0 })]).length, 0);
  });

  it("drops a box holding a whole paragraph rather than one authored line", () => {
    const paragraph = sample({
      boxWidth: 300,
      textWidth: 300 * 3.2,
      substituteTextWidth: 300 * 2.9,
    });
    assert.equal(usableSamples([paragraph]).length, 0);
  });

  it("drops a line sitting in a box far wider than itself", () => {
    const caption = sample({
      boxWidth: 300,
      textWidth: 300 * 0.3,
      substituteTextWidth: 300 * 0.27,
    });
    assert.equal(usableSamples([caption]).length, 0);
  });

  it("keeps a line whose current face overflows the box it was authored into", () => {
    const overflowing = sample({
      boxWidth: 300,
      textWidth: 300 * 1.087,
      substituteTextWidth: 300,
    });
    assert.equal(usableSamples([overflowing]).length, 1);
  });

  it("tolerates sub-pixel drift in an authored width", () => {
    assert.equal(
      usableSamples([sample({ boxWidth: 300, substituteBoxWidth: 300.4 })])
        .length,
      1
    );
  });
});

describe("evaluateSubstitution", () => {
  it("substitutes when the page's own font overflows and the clone fits", () => {
    // RR-7953: an unembedded print serif falls back to Roboto, ~8% wider than
    // the box the line was authored into, and the line wraps.
    const overflowing = [1.087, 1.091, 1.084, 1.09].map((ratio) =>
      sample({
        boxWidth: 300,
        textWidth: 300 * ratio,
        substituteTextWidth: 301,
      })
    );
    const verdict = evaluateSubstitution(overflowing);
    assert.equal(verdict.improves, true);
    assert.equal(verdict.samples, 4);
    assert.equal(verdict.currentError > verdict.substituteError, true);
  });

  it("leaves a page alone when Times metrics run narrow of the artwork", () => {
    // A book whose artwork is set in a sans face: what renders today fills the
    // authored boxes and the clone would fall ~9% short of them.
    const alreadyFitting = [1.002, 0.998, 1.001, 1.0].map((ratio) =>
      sample({
        boxWidth: 300,
        textWidth: 300 * ratio,
        substituteTextWidth: 300 * 0.91,
      })
    );
    assert.equal(evaluateSubstitution(alreadyFitting).improves, false);
  });

  it("holds still for an improvement too small to be worth a substitution", () => {
    const marginal = [1, 1, 1].map(() =>
      sample({
        boxWidth: 300,
        textWidth: 300 * 1.004,
        substituteTextWidth: 300 * 1.001,
      })
    );
    const verdict = evaluateSubstitution(marginal);
    assert.equal(verdict.substituteError < verdict.currentError, true);
    assert.equal(verdict.improves, false);
  });

  it("substitutes once the improvement clears the threshold", () => {
    const worthwhile = [1, 1, 1].map(() =>
      sample({
        boxWidth: 300,
        textWidth: 300 * (1 + MIN_FIT_IMPROVEMENT * 3),
        substituteTextWidth: 300,
      })
    );
    assert.equal(evaluateSubstitution(worthwhile).improves, true);
  });

  it("has no verdict when the page authored no width to measure against", () => {
    const shrinkToFit = [1, 2, 3].map(() =>
      sample({
        boxWidth: 300,
        textWidth: 300,
        substituteBoxWidth: 274,
        substituteTextWidth: 274,
      })
    );
    assert.equal(evaluateSubstitution(shrinkToFit), null);
    assert.equal(evaluateSubstitution([]), null);
  });

  it("hands the page default back when the injected serif runs narrow", () => {
    // RR-6369 makes the Times clone the default for text the publication left
    // unstyled. A book whose artwork is set in a sans face is dragged off it:
    // here the clone covers 92% of each authored box and what the WebView would
    // have used covers all of it.
    const injectedDefaultTooNarrow = [0.92, 0.918, 0.923, 0.921].map((ratio) =>
      sample({
        boxWidth: 300,
        textWidth: 300 * ratio,
        substituteTextWidth: 300,
      })
    );
    assert.equal(evaluateSubstitution(injectedDefaultTooNarrow).improves, true);
  });

  it("keeps the page default on the books it was added for", () => {
    // The same measurement on Times-metric artwork: the clone fills the boxes
    // and the WebView's own sans overruns them by ~8%.
    const injectedDefaultFits = [1.0, 0.999, 1.001, 1.0].map((ratio) =>
      sample({
        boxWidth: 300,
        textWidth: 300 * ratio,
        substituteTextWidth: 300 * 1.087,
      })
    );
    assert.equal(evaluateSubstitution(injectedDefaultFits).improves, false);
  });

  it("gives pair-kerning back when the page was laid out with it", () => {
    // The same stylesheet turns kerning off for every overlay. A book whose
    // baked artwork was kerned is widened by that, by a fraction of a per cent
    // per pair rather than by a whole face.
    const unkernedTooWide = [1.012, 1.014, 1.011, 1.013].map((ratio) =>
      sample({
        boxWidth: 300,
        textWidth: 300 * ratio,
        substituteTextWidth: 300,
      })
    );
    assert.equal(evaluateSubstitution(unkernedTooWide).improves, true);
  });

  it("judges on the median, so one odd line cannot swing the page", () => {
    const mostlyFitting = [
      sample({ boxWidth: 300, textWidth: 300, substituteTextWidth: 273 }),
      sample({ boxWidth: 300, textWidth: 301, substituteTextWidth: 274 }),
      sample({ boxWidth: 300, textWidth: 299, substituteTextWidth: 275 }),
      sample({ boxWidth: 300, textWidth: 420, substituteTextWidth: 300 }),
    ];
    assert.equal(evaluateSubstitution(mostlyFitting).improves, false);
  });
});
