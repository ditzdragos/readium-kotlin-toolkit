import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { keepDropCapImageSizes } from "../src/dropCapImages.mjs";

function image(attributes) {
  return {
    getAttribute(name) {
      return attributes[name] ?? null;
    },
  };
}

function chapter(images, { readiumCss = true } = {}) {
  const inserted = [];
  return {
    inserted,
    querySelector(selector) {
      assert.equal(selector, 'link[href$="ReadiumCSS-before.css"]');
      return readiumCss
        ? {
            after(node) {
              inserted.push(node);
            },
          }
        : null;
    },
    querySelectorAll() {
      return images;
    },
    createElement(tag) {
      return { tag, textContent: "" };
    },
  };
}

function rules(document) {
  return document.inserted.flatMap((node) => node.textContent.split("\n"));
}

describe("keepDropCapImageSizes", () => {
  it("keeps the publisher's height on a drop cap picture", () => {
    // "Just So Stories" (9781944686451): <span class="dropcap"><img height="120" …/></span>N the sea
    const document = chapter([image({ height: "120" })]);

    keepDropCapImageSizes(document);

    assert.equal(document.inserted.length, 1);
    assert.equal(document.inserted[0].tag, "style");
    assert.equal(rules(document).length, 1);
    assert.match(
      rules(document)[0],
      /:where\(\[height="120"\]\) \{ height: 120px; \}$/
    );
  });

  it("sizes at ReadiumCSS's specificity so the publisher's CSS still wins", () => {
    const document = chapter([image({ height: "120" })]);

    keepDropCapImageSizes(document);

    const selector = rules(document)[0].split(" {")[0];
    assert.match(selector, /^img(:where\([^{]*\))+$/);
  });

  it("keeps both dimensions and writes each size once", () => {
    const document = chapter([
      image({ width: "40", height: "96px" }),
      image({ width: "40", height: "96px" }),
    ]);

    keepDropCapImageSizes(document);

    assert.deepEqual(
      rules(document).map((rule) => rule.split("{ ")[1]),
      ["width: 40px; }", "height: 96px; }"]
    );
  });

  it("leaves pictures without a pixel size to the reader styles", () => {
    const document = chapter([
      image({}),
      image({ width: "50%", height: "auto" }),
    ]);

    keepDropCapImageSizes(document);

    assert.deepEqual(document.inserted, []);
  });

  it("does nothing when ReadiumCSS isn't on the page", () => {
    const document = chapter([image({ height: "120" })], { readiumCss: false });

    keepDropCapImageSizes(document);

    assert.deepEqual(document.inserted, []);
  });
});
