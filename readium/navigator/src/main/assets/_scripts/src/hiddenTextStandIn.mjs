import { containingElement } from "./rangeCoverage.mjs";

const standIns = new WeakMap();

function normalized(text) {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function isVisuallyHidden(style) {
  return (
    style.overflow === "hidden" &&
    parseFloat(style.width) <= 1 &&
    parseFloat(style.height) <= 1
  );
}

function imageWithAlt(hidden) {
  const text = normalized(hidden.textContent);
  for (let scope = hidden.parentElement; scope; scope = scope.parentElement) {
    const images = scope.querySelectorAll("img[alt]");
    for (let i = 0; i < images.length; i++) {
      if (normalized(images[i].alt) === text) {
        return images[i];
      }
    }
  }
  return null;
}

export function hiddenTextStandIn(element, getStyle) {
  if (standIns.has(element)) {
    return standIns.get(element);
  }
  let standIn = null;
  if (isVisuallyHidden(getStyle(element))) {
    standIn = imageWithAlt(element);
  } else if (element.parentElement && element !== element.ownerDocument.body) {
    standIn = hiddenTextStandIn(element.parentElement, getStyle);
  }
  standIns.set(element, standIn);
  return standIn;
}

// Text clipped out of sight is drawn on the image that shows it, e.g. a chapter title set as a picture (RR-9717).
export function hiddenTextStandInRect(range) {
  const element = containingElement(range.startContainer);
  const standIn = element && hiddenTextStandIn(element, getComputedStyle);
  return standIn ? standIn.getBoundingClientRect() : null;
}
