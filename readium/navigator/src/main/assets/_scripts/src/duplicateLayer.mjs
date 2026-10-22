// Some books draw a line twice, stacked: an outline with no fill over the filled text. Both copies
// are in the text the reader expects, so the outline copy is skipped like a page number (RR-7856).

const MIN_OVERLAP = 0.5;

const duplicateByLayer = new WeakMap();

export function normalizedText(text) {
  return (text || "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
}

export function isTransparentColor(color) {
  if (color === "transparent") return true;
  const match = /^rgba\(([^)]+)\)$/.exec(color || "");
  if (!match) return false;
  const channels = match[1].split(/[\s,/]+/).filter(Boolean);
  return channels.length === 4 && parseFloat(channels[3]) === 0;
}

function overlapRatio(a, b) {
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  const smallerArea = Math.min(a.width * a.height, b.width * b.height);
  if (width <= 0 || height <= 0 || smallerArea <= 0) return 0;
  return (width * height) / smallerArea;
}

function unfilledLayer(element, fillColorOf) {
  let layer = null;
  for (
    let node = element;
    node && node.parentElement && String(node.tagName).toUpperCase() !== "BODY";
    node = node.parentElement
  ) {
    if (!isTransparentColor(fillColorOf(node))) break;
    layer = node;
  }
  return layer;
}

/**
 * Whether `element` sits in a layer whose text has no fill and that covers a filled sibling with
 * the same words.
 */
export function isUnfilledDuplicateLayer(element, fillColorOf) {
  const layer = unfilledLayer(element, fillColorOf);
  if (!layer) return false;
  if (!duplicateByLayer.has(layer)) {
    duplicateByLayer.set(layer, coversFilledCopy(layer, fillColorOf));
  }
  return duplicateByLayer.get(layer);
}

function coversFilledCopy(layer, fillColorOf) {
  const text = normalizedText(layer.textContent);
  if (!text) return false;
  const rect = layer.getBoundingClientRect();
  return Array.from(layer.parentElement.children).some(
    (sibling) =>
      sibling !== layer &&
      normalizedText(sibling.textContent) === text &&
      !isTransparentColor(fillColorOf(sibling)) &&
      overlapRatio(rect, sibling.getBoundingClientRect()) >= MIN_OVERLAP
  );
}
