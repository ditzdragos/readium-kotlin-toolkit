import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { measurementFaces } from "../src/fxlCloneFaces.mjs";

const DIRECTORY = "https://readium/assets/fonts/";
const REGULAR = "400 normal";
const BOLD = "700 normal";

let registered;
let constructed;
let failConstruction;

class FakeFontFace {
  constructor(family, source, descriptors) {
    if (failConstruction) {
      throw new SyntaxError("bad source");
    }
    this.name = family;
    this.source = source;
    Object.assign(this, descriptors);
    this.loads = 0;
    constructed.push(this);
  }
  get family() {
    return this.name;
  }
  set family(value) {
    if (this.refuseRename) {
      throw new SyntaxError("bad family");
    }
    this.name = value;
  }
  load() {
    this.loads++;
    return Promise.resolve(this);
  }
}

beforeEach(() => {
  registered = new Set();
  constructed = [];
  failConstruction = false;
  globalThis.document = {
    fonts: {
      add: (face) => registered.add(face),
      delete: (face) => registered.delete(face),
    },
  };
  globalThis.FontFace = FakeFontFace;
});

afterEach(() => {
  delete globalThis.document;
  delete globalThis.FontFace;
});

describe("measurementFaces (RR-9372)", () => {
  it("registers and loads only the faces the page draws", async () => {
    const pool = measurementFaces("Measure", DIRECTORY, new Set([BOLD]));
    await pool.loaded;

    assert.equal(constructed.length, 1);
    assert.equal(
      constructed[0].source,
      `url("${DIRECTORY}NimbusRoman-Bold.woff2")`
    );
    assert.equal(constructed[0].loads, 1);
    assert.ok(registered.has(constructed[0]));
  });

  it("hands a measured face to the winning family without fetching it again", () => {
    const pool = measurementFaces("Measure", DIRECTORY, new Set([REGULAR]));
    const [measured] = constructed;

    const claimed = pool.claim("Page Serif", [REGULAR]);
    pool.release();

    assert.deepEqual(claimed, [measured]);
    assert.equal(measured.family, "Page Serif");
    assert.equal(constructed.length, 1);
    assert.ok(registered.has(measured));
  });

  it("gives a second family its own copy of a face already claimed", () => {
    const pool = measurementFaces("Measure", DIRECTORY, new Set([REGULAR]));
    const [first] = pool.claim("First", [REGULAR]);

    const [second] = pool.claim("Second", [REGULAR]);

    assert.notEqual(second, first);
    assert.equal(first.family, "First");
    assert.equal(second.family, "Second");
    assert.ok(registered.has(first) && registered.has(second));
  });

  it("reuses what it has and copies the rest in one claim", () => {
    const pool = measurementFaces(
      "Measure",
      DIRECTORY,
      new Set([REGULAR, BOLD])
    );
    pool.claim("First", [BOLD]);
    const [, measuredBold] = constructed;

    const claimed = pool.claim("Second", [REGULAR, BOLD]);

    assert.equal(claimed.length, 2);
    assert.equal(claimed[0], constructed[0]);
    assert.notEqual(claimed[1], measuredBold);
    assert.equal(claimed[1].weight, "700");
  });

  it("releases only the faces no family claimed", () => {
    const pool = measurementFaces(
      "Measure",
      DIRECTORY,
      new Set([REGULAR, BOLD])
    );
    const [regular, bold] = constructed;
    pool.claim("Page Serif", [REGULAR]);

    pool.release();

    assert.ok(registered.has(regular));
    assert.ok(!registered.has(bold));
  });

  it("falls back to a fresh copy when a face refuses its new name", () => {
    const pool = measurementFaces("Measure", DIRECTORY, new Set([REGULAR]));
    const [measured] = constructed;
    measured.refuseRename = true;

    const [claimed] = pool.claim("Page Serif", [REGULAR]);

    assert.notEqual(claimed, measured);
    assert.equal(claimed.family, "Page Serif");
    assert.equal(measured.family, "Measure");
  });

  it("skips a face the WebView cannot construct", async () => {
    failConstruction = true;
    const pool = measurementFaces("Measure", DIRECTORY, new Set([REGULAR]));
    await pool.loaded;

    assert.equal(registered.size, 0);
    assert.deepEqual(pool.claim("Page Serif", [REGULAR]), []);
  });
});
