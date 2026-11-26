import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const fontFallback = readFileSync(
  new URL("../src/fxl-font-fallback.js", import.meta.url),
  "utf8"
);

describe("the fixed-layout page default (RR-9322)", () => {
  // RR-9322: unstyled overlay text is drawn in Times, as iOS draws it. A
  // box-fill vote swapped it for the wider sans on Good Night, Escargot, whose
  // loose boxes and hand-broken lines made sans look like the better fit.
  it("never writes the root's inline style", () => {
    assert.doesNotMatch(fontFallback, /documentElement\.style\b/);
    assert.doesNotMatch(fontFallback, /=\s*document\.documentElement\s*;/);
  });

  it("never switches the injected Times stylesheet off", () => {
    assert.doesNotMatch(fontFallback, /\.disabled\s*=/);
  });
});
