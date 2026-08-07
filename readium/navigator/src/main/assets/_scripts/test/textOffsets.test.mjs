import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  bestContextMatchIndex,
  lineBreakSeparator,
} from "../src/textOffsets.mjs";

describe("lineBreakSeparator", () => {
  it("adds nothing when the surrounding text is already pretty-printed", () => {
    assert.equal(lineBreakSeparator("|", "\n   |"), "");
  });

  it("adds nothing when the preceding text already ends in whitespace", () => {
    assert.equal(lineBreakSeparator("foo ", "bar"), "");
  });

  it("separates two words that nothing else separates", () => {
    assert.equal(lineBreakSeparator("foo", "bar"), "\n");
  });

  it("adds nothing at the start of a resource", () => {
    assert.equal(lineBreakSeparator("", "foo"), "");
  });

  it("adds nothing when no text follows", () => {
    assert.equal(lineBreakSeparator("foo", ""), "");
  });
});

describe("bestContextMatchIndex", () => {
  // RR-8661: the page that reproduced it, with "to" twice in one sentence.
  const page =
    "Why do we have to go to a new school? You KNOW why. Mom and Bruce moved, " +
    "and now we're closer to Dad.";
  const firstTo = page.indexOf("to");
  const secondTo = page.indexOf("to", firstTo + 1);

  it("picks the first of two identical words from its own context", () => {
    assert.equal(
      bestContextMatchIndex(page, {
        highlight: "to",
        before: "Why do we have ",
        after: " go to a new school?",
      }),
      firstTo
    );
  });

  it("picks the second of two identical words from its own context", () => {
    assert.equal(
      bestContextMatchIndex(page, {
        highlight: "to",
        before: "Why do we have to go ",
        after: " a new school?",
      }),
      secondTo
    );
  });

  it("still picks the right word when the context carries extra whitespace", () => {
    // The context a drifted extraction produces: same words, different whitespace.
    assert.equal(
      bestContextMatchIndex(page, {
        highlight: "to",
        before: "Why\ndo\nwe\nhave ",
        after: " go\nto\na\nnew school?",
      }),
      firstTo
    );
  });

  it("declines to guess without context", () => {
    assert.equal(
      bestContextMatchIndex(page, { highlight: "to", before: "", after: "" }),
      -1
    );
  });

  it("declines to guess when two occurrences fit equally well", () => {
    assert.equal(
      bestContextMatchIndex("a to b to c", {
        highlight: "to",
        before: " ",
        after: " ",
      }),
      -1
    );
  });

  it("declines to guess when the word is absent", () => {
    assert.equal(
      bestContextMatchIndex(page, {
        highlight: "zzz",
        before: "Why do we have ",
        after: " go",
      }),
      -1
    );
  });
});
