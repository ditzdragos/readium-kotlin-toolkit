import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { VisibleAreas } from "../src/visibleAreas.mjs";

function fakeDocument() {
  function createElement() {
    return {
      id: "",
      className: "",
      style: { cssText: "" },
      children: [],
      parentElement: null,
      get childElementCount() {
        return this.children.length;
      },
      get isConnected() {
        let node = this;
        while (node.parentElement) {
          node = node.parentElement;
        }
        return node === body;
      },
      appendChild(child) {
        child.parentElement = this;
        this.children.push(child);
        return child;
      },
      remove() {
        if (!this.parentElement) {
          return;
        }
        const index = this.parentElement.children.indexOf(this);
        if (index !== -1) {
          this.parentElement.children.splice(index, 1);
        }
        this.parentElement = null;
      },
    };
  }

  const body = createElement();

  return {
    body,
    createElement,
    getElementById(id) {
      return body.children.find((child) => child.id === id) ?? null;
    },
  };
}

function decorationIn(area, document) {
  return area.appendChild(document.createElement());
}

describe("VisibleAreas", () => {
  it("hands the same page element to every group", () => {
    const document = fakeDocument();
    const next = new VisibleAreas(document);
    const correct = new VisibleAreas(document);

    assert.equal(next.acquire(0, 800, 600), correct.acquire(0, 800, 600));
    assert.equal(document.body.childElementCount, 1);
  });

  it("gives each page index its own element, positioned for the viewport", () => {
    const document = fakeDocument();
    const areas = new VisibleAreas(document);

    const first = areas.acquire(0, 800, 600);
    const second = areas.acquire(2, 800, 600);

    assert.notEqual(first, second);
    assert.match(second.style.cssText, /left:1600px/);
    assert.match(second.style.cssText, /width:800px;height:600px/);
  });

  it("resizes an element it acquired for an earlier viewport", () => {
    const document = fakeDocument();
    const areas = new VisibleAreas(document);

    areas.acquire(1, 800, 600);
    const resized = areas.acquire(1, 400, 300);

    assert.match(resized.style.cssText, /left:400px/);
    assert.match(resized.style.cssText, /width:400px;height:300px/);
  });

  it("keeps a page element another group is still drawing in", () => {
    const document = fakeDocument();
    const next = new VisibleAreas(document);
    const correct = new VisibleAreas(document);

    const area = next.acquire(0, 800, 600);
    const underline = decorationIn(area, document);
    correct.acquire(0, 800, 600);

    correct.release();

    assert.equal(underline.isConnected, true);
    assert.equal(document.getElementById("visible-area-0"), area);
  });

  it("still paints into the live element after another group released", () => {
    const document = fakeDocument();
    const next = new VisibleAreas(document);
    const correct = new VisibleAreas(document);

    next.acquire(0, 800, 600);
    correct.acquire(0, 800, 600);
    correct.release();

    const underline = decorationIn(next.acquire(0, 800, 600), document);

    assert.equal(underline.isConnected, true);
  });

  it("removes a page element no group is drawing in any more", () => {
    const document = fakeDocument();
    const areas = new VisibleAreas(document);

    areas.acquire(0, 800, 600);
    areas.release();

    assert.equal(document.getElementById("visible-area-0"), null);
  });

  it("replaces a claim on an element that was removed elsewhere", () => {
    const document = fakeDocument();
    const next = new VisibleAreas(document);

    const stale = next.acquire(0, 800, 600);
    stale.remove();

    const area = next.acquire(0, 800, 600);

    assert.notEqual(area, stale);
    assert.equal(area.isConnected, true);
  });
});
