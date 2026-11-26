import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DROP_CAP_IMAGES,
  keepDropCapImageSizes,
} from "../src/dropCapImages.mjs";

function image(attributes) {
  return {
    style: {},
    getAttribute(name) {
      return attributes[name] ?? null;
    },
  };
}

function documentWith(images) {
  return {
    querySelectorAll(selector) {
      assert.equal(selector, DROP_CAP_IMAGES);
      return images;
    },
  };
}

describe("keepDropCapImageSizes", () => {
  it("keeps the publisher's height on a drop cap picture", () => {
    // "Just So Stories" (9781944686451): <span class="dropcap"><img height="120" …/></span>N the sea
    const initial = image({ height: "120" });

    keepDropCapImageSizes(documentWith([initial]));

    assert.deepEqual(initial.style, { height: "120px" });
  });

  it("keeps both dimensions when the publisher sets both", () => {
    const initial = image({ width: "40", height: "96px" });

    keepDropCapImageSizes(documentWith([initial]));

    assert.deepEqual(initial.style, { width: "40px", height: "96px" });
  });

  it("leaves a drop cap picture without a size to the reader styles", () => {
    const initial = image({});

    keepDropCapImageSizes(documentWith([initial]));

    assert.deepEqual(initial.style, {});
  });

  it("ignores sizes that are not pixel lengths", () => {
    const initial = image({ width: "50%", height: "auto" });

    keepDropCapImageSizes(documentWith([initial]));

    assert.deepEqual(initial.style, {});
  });

  it("selects pictures inside drop cap spans and drop cap pictures", () => {
    assert.match(DROP_CAP_IMAGES, /span\[class\*="dropcap"\] img/);
    assert.match(DROP_CAP_IMAGES, /img\[class\*="dropcap"\]/);
  });
});
