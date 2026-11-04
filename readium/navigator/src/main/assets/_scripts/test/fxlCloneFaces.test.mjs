import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { claimFaces, cloneFaces } from "../src/fxlCloneFaces.mjs";

const DIRECTORY = "https://readium/assets/fonts/";
const REGULAR = "400 normal";
const BOLD = "700 normal";

let registered;
let constructed;

beforeEach(() => {
  registered = new Set();
  constructed = [];
  globalThis.document = {
    fonts: {
      add: (face) => registered.add(face),
      delete: (face) => registered.delete(face),
    },
  };
  globalThis.FontFace = class {
    constructor(family, source, descriptors) {
      this.family = family;
      this.source = source;
      Object.assign(this, descriptors);
      constructed.push(this);
    }
  };
});

describe("cloneFaces", () => {
  it("registers only the faces the page draws, keyed by face", () => {
    const faces = cloneFaces("Measure", DIRECTORY, new Set([BOLD]));

    assert.deepEqual([...faces.keys()], [BOLD]);
    assert.equal(
      faces.get(BOLD).source,
      `url("${DIRECTORY}NimbusRoman-Bold.woff2")`
    );
    assert.deepEqual([...registered], [faces.get(BOLD)]);
  });
});

describe("claimFaces (RR-9372)", () => {
  it("renames the measured face instead of fetching it again", () => {
    const unclaimed = cloneFaces("Measure", DIRECTORY, new Set([REGULAR]));
    const measured = unclaimed.get(REGULAR);
    constructed = [];

    const claimed = claimFaces(
      "Page Serif",
      DIRECTORY,
      new Set([REGULAR]),
      unclaimed
    );

    assert.deepEqual(claimed, [measured]);
    assert.equal(measured.family, "Page Serif");
    assert.deepEqual(constructed, []);
    assert.ok(registered.has(measured));
    assert.equal(unclaimed.size, 0);
  });

  it("clones a face another family already claimed", () => {
    const unclaimed = cloneFaces("Measure", DIRECTORY, new Set([REGULAR]));
    const first = claimFaces("First", DIRECTORY, new Set([REGULAR]), unclaimed);

    const second = claimFaces(
      "Second",
      DIRECTORY,
      new Set([REGULAR]),
      unclaimed
    );

    assert.equal(first[0].family, "First");
    assert.equal(second.length, 1);
    assert.notEqual(second[0], first[0]);
    assert.equal(second[0].family, "Second");
    assert.ok(registered.has(first[0]) && registered.has(second[0]));
  });

  it("leaves faces the family does not draw for the caller to release", () => {
    const unclaimed = cloneFaces(
      "Measure",
      DIRECTORY,
      new Set([REGULAR, BOLD])
    );

    claimFaces("Page Serif", DIRECTORY, new Set([REGULAR]), unclaimed);

    assert.deepEqual([...unclaimed.keys()], [BOLD]);
    assert.equal(unclaimed.get(BOLD).family, "Measure");
  });
});
