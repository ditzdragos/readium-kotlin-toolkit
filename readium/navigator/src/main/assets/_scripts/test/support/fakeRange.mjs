globalThis.Range = {
  START_TO_START: 0,
  START_TO_END: 1,
  END_TO_END: 2,
  END_TO_START: 3,
};

const COMPARED_POINTS = [
  ["start", "start"],
  ["end", "start"],
  ["end", "end"],
  ["start", "end"],
];

/**
 * A pair of boundary points on one document-order axis, comparable the way the
 * DOM compares two ranges. An element covers `element.start` to `element.end`.
 */
export function boundaries(start, end, source = "") {
  return {
    start,
    end,
    selectNodeContents(element) {
      this.start = element.start;
      this.end = element.end;
      this.contents = element;
    },
    setStart(container, offset) {
      this.start = container.position + offset;
    },
    setEnd(container, offset) {
      this.end = container.position + offset;
    },
    compareBoundaryPoints(how, other) {
      const [mine, theirs] = COMPARED_POINTS[how];
      return Math.sign(this[mine] - other[theirs]);
    },
    getClientRects() {
      return this.contents?.clientRects ?? [];
    },
    toString() {
      return source.slice(this.start, this.end);
    },
  };
}
