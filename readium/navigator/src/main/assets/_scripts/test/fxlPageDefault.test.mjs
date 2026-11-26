import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const fontFallback = readFileSync(
  new URL("../src/fxl-font-fallback.js", import.meta.url),
  "utf8"
);

describe("the fixed-layout page default (RR-9322)", () => {
  it("is never handed back from the injected Times to the WebView's own", () => {
    // RR-9322: unstyled overlay text is drawn in Times, as iOS draws it. A
    // box-fill vote swapped it for the wider sans on Good Night, Escargot, whose
    // loose boxes and hand-broken lines made sans look like the better fit.
    const rootFamilyWrite =
      /documentElement\.style\.(setProperty|removeProperty)\(\s*["']font-family["']|documentElement\.style\.fontFamily\s*=/;
    assert.doesNotMatch(fontFallback, rootFamilyWrite);
  });
});
