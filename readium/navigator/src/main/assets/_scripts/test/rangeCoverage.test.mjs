import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { boundaries } from "./support/fakeRange.mjs";
import { elementsCoveredByRange } from "../src/rangeCoverage.mjs";

const document = { createRange: () => boundaries(0, 0) };

/** Elements of five positions each, two apart, in document order. */
function elements(count) {
  return Array.from({ length: count }, (_, index) => ({
    index,
    start: index * 7,
    end: index * 7 + 5,
    ownerDocument: document,
  }));
}

function indexes(covered) {
  return covered.map((element) => element.index);
}

describe("elementsCoveredByRange", () => {
  it("returns the elements the range reaches into", () => {
    const all = elements(10);

    assert.deepEqual(
      indexes(elementsCoveredByRange(boundaries(16, 30), all)),
      [2, 3, 4]
    );
  });

  it("leaves out elements the range only touches", () => {
    const all = elements(10);

    assert.deepEqual(indexes(elementsCoveredByRange(boundaries(19, 28), all)), [
      3,
    ]);
  });

  it("finds a range deep in a long list in a few comparisons", () => {
    const all = elements(4000);
    const range = boundaries(all[2500].start, all[2501].end);
    let comparisons = 0;
    const compare = range.compareBoundaryPoints;
    range.compareBoundaryPoints = function (how, other) {
      comparisons++;
      return compare.call(this, how, other);
    };

    assert.deepEqual(indexes(elementsCoveredByRange(range, all)), [2500, 2501]);
    assert.ok(comparisons < 20, `${comparisons} comparisons`);
  });

  it("returns nothing for a range between elements", () => {
    assert.deepEqual(elementsCoveredByRange(boundaries(5, 7), elements(3)), []);
  });

  it("returns nothing when there are no elements", () => {
    assert.deepEqual(elementsCoveredByRange(boundaries(0, 5), []), []);
  });
});
