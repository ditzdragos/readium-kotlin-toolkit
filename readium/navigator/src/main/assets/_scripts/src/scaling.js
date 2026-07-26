// scaling.js

import { DEBUG_MODE } from "./utils";

function debugLog(...args) {
  if (DEBUG_MODE) {
    console.log(...args);
  }
}

function debugWarn(...args) {
  if (DEBUG_MODE) {
    console.warn(...args);
  }
}

/** Debounce utility to limit how often a function is called */
function debounce(func, wait) {
  let timeout;
  return function () {
    const context = this;
    const args = arguments;
    clearTimeout(timeout);
    timeout = setTimeout(function () {
      timeout = null;
      func.apply(context, args);
    }, wait);
  };
}

const WRAPPER_ID = "r2-scale-wrapper";
const CONTAINER_ID = "r2-scale-container";

/** Viewport deltas below this are not worth a re-scale. */
const VIEWPORT_EPSILON_PX = 5;

let scalingListenersAttached = false;

/**
 * Whether this document is a fixed-layout resource, and so whether scaling applies
 * at all.
 *
 * The presence of a `<meta name="viewport">` cannot answer this: index-reflowable.js
 * injects one into every reflowable document on DOMContentLoaded. Reading a
 * reflowable page's size and wrapping it in a scaled container would collapse the
 * whole column-paginated chapter to the height of one screen. The bundle that set
 * this flag is the only reliable signal, and it is set before registerTemplates()
 * runs.
 */
function isFixedLayoutDocument() {
  return window.readium?.isFixedLayout === true;
}

function emitViewportChangedEvent() {
  try {
    window.dispatchEvent(
      new CustomEvent("readium:viewport-changed", {
        detail: {
          width: window.innerWidth,
          height: window.innerHeight,
          scale: window.r2CurrentScale ?? 1.0,
        },
      })
    );
  } catch (error) {
    debugWarn("[R2Scale] Failed to dispatch viewport changed event", error);
  }
}

/**
 * The largest scale at which the whole page still fits.
 *
 * Both axes have to bind. Fitting only one — which is what the WebView's own
 * loadWithOverviewMode does, and it fits the width — is what leaves a page taller
 * than the viewport anchored at the top with its bottom edge cut off.
 *
 * Scaling above 1.0 is deliberately not allowed: setupWebView turns on
 * useWideViewPort, so the CSS viewport is already exactly as wide as the
 * <meta viewport> width, and a larger scale could only overflow horizontally.
 */
function containScale(
  contentWidth,
  contentHeight,
  viewportWidth,
  viewportHeight
) {
  if (!(contentWidth > 0) || !(contentHeight > 0)) {
    return 1.0;
  }
  return Math.min(
    1.0,
    viewportWidth / contentWidth,
    viewportHeight / contentHeight
  );
}

function parseLength(value) {
  const length = parseFloat(value);
  return Number.isFinite(length) && length > 0 ? length : null;
}

/**
 * Matches `width=1200` but not the `width=` inside `min-width=` or `device-width`,
 * and accepts the fractional values some publications declare.
 */
function metaViewportLength(content, name) {
  const match = content.match(
    new RegExp(`(?:^|[;,\\s])${name}\\s*=\\s*([0-9.]+)`)
  );
  return match ? parseLength(match[1]) : null;
}

function dimensionsFromMetaViewport() {
  const meta = document.querySelector('meta[name="viewport"]');
  const content = meta && meta.getAttribute("content");
  if (!content) {
    return null;
  }
  const width = metaViewportLength(content, "width");
  const height = metaViewportLength(content, "height");
  return width && height
    ? { width, height, method: "viewport meta tag" }
    : null;
}

/**
 * An image-only fixed-layout page often states its size only on the SVG that wraps
 * the image, leaving the <meta viewport> at `width=device-width` or absent.
 */
function dimensionsFromSvg() {
  const svg = document.querySelector("svg");
  if (!svg) {
    return null;
  }
  const viewBox = svg.getAttribute("viewBox");
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/);
    const width = parseLength(parts[2]);
    const height = parseLength(parts[3]);
    if (width && height) {
      return { width, height, method: "svg viewBox" };
    }
  }
  const width = parseLength(svg.getAttribute("width"));
  const height = parseLength(svg.getAttribute("height"));
  return width && height ? { width, height, method: "svg width/height" } : null;
}

/** Last resort, and only valid before the content has been wrapped. */
function dimensionsFromBody() {
  const width = parseLength(document.body.scrollWidth);
  const height = parseLength(document.body.scrollHeight);
  return width && height ? { width, height, method: "body scroll size" } : null;
}

function contentDimensions() {
  return (
    dimensionsFromMetaViewport() || dimensionsFromSvg() || dimensionsFromBody()
  );
}

/**
 * The decoration overlays are positioned from getBoundingClientRect(), which
 * already reports post-transform coordinates, so they have to stay outside the
 * scaled container — moving them in would scale those coordinates a second time.
 * decorator.js marks every one of them with an inline `pointer-events: none`.
 */
function isDecorationLayer(node) {
  return node.style && node.style.pointerEvents === "none";
}

function isContentNode(node) {
  return (
    node.id !== WRAPPER_ID &&
    node.tagName !== "SCRIPT" &&
    node.tagName !== "STYLE" &&
    node.tagName !== "LINK" &&
    !isDecorationLayer(node)
  );
}

/**
 * Moves the wrapped content back onto the body and drops the wrapper.
 *
 * The content is taken from the wrapper when the container is the element that
 * went missing: it is still inside the wrapper at that point, and removing the
 * wrapper without moving it out first would delete the page.
 */
function unwrap() {
  const wrapper = document.getElementById(WRAPPER_ID);
  if (!wrapper) {
    return;
  }
  const container = document.getElementById(CONTAINER_ID);
  const source = container || wrapper;
  Array.from(source.children).forEach(function (child) {
    if (child !== wrapper) {
      document.body.appendChild(child);
    }
  });
  wrapper.remove();
}

function buildWrapper(dimensions) {
  const wrapper = document.createElement("div");
  wrapper.id = WRAPPER_ID;
  wrapper.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        overflow: hidden; background-color: transparent;
        display: flex; align-items: center; justify-content: center;
        box-sizing: border-box; padding: 0; margin: 0;
        pointer-events: none;
    `;

  const container = document.createElement("div");
  container.id = CONTAINER_ID;
  container.style.cssText = `
        width: ${dimensions.width}px; height: ${dimensions.height}px;
        transform-origin: center center;
        position: relative;
        background-color: white;
        overflow: hidden;
        pointer-events: auto;
    `;

  const content = Array.from(document.body.children).filter(isContentNode);
  document.body.appendChild(wrapper);
  wrapper.appendChild(container);
  content.forEach(function (node) {
    container.appendChild(node);
  });
  return container;
}

function storedDimensions(container) {
  if (window.r2ContentDimensions) {
    return window.r2ContentDimensions;
  }
  const width = parseLength(container.style.width);
  const height = parseLength(container.style.height);
  return width && height ? { width, height, method: "from style" } : null;
}

/**
 * Scales the fixed-layout content so the whole page fits, and centres it.
 *
 * Builds the wrapper on the first call and only re-applies the transform after
 * that. Rebuilding would have to move the content out and back in, which risks
 * both the page and the decoration overlays for no gain.
 */
function scaleToViewport() {
  if (!isFixedLayoutDocument()) {
    return;
  }
  if (window.r2ScalingInProgress) {
    debugLog("[R2Scale] Scaling already in progress, skipping.");
    return;
  }
  window.r2ScalingInProgress = true;
  try {
    if (
      document.getElementById(WRAPPER_ID) &&
      !document.getElementById(CONTAINER_ID)
    ) {
      debugWarn("[R2Scale] Scale wrapper lost its container, rebuilding.");
      unwrap();
    }

    let container = document.getElementById(CONTAINER_ID);
    const dimensions = container
      ? storedDimensions(container)
      : contentDimensions();
    if (!dimensions) {
      debugWarn(
        "[R2Scale] No usable content dimensions, leaving content unscaled."
      );
      return;
    }

    if (!container) {
      document.documentElement.style.margin = "0";
      document.documentElement.style.padding = "0";
      document.body.style.margin = "0";
      document.body.style.padding = "0";
      document.body.style.backgroundColor = "white";
      container = buildWrapper(dimensions);
      debugLog(
        `[R2Scale] Wrapped ${dimensions.width}x${dimensions.height} content (${dimensions.method})`
      );
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const scale = containScale(
      dimensions.width,
      dimensions.height,
      viewportWidth,
      viewportHeight
    );

    container.style.transform = `scale(${scale})`;
    window.r2ScalingApplied = true;
    window.r2ContentDimensions = dimensions;
    window.r2CurrentScale = scale;
    window.r2LastJSViewport = { width: viewportWidth, height: viewportHeight };

    debugLog(
      `[R2Scale] Scaled to ${scale.toFixed(
        3
      )} for viewport ${viewportWidth}x${viewportHeight}`
    );
  } finally {
    window.r2ScalingInProgress = false;
  }
  emitViewportChangedEvent();
}

/**
 * Applies scaling and centering to fixed-layout content.
 */
export function applyInitialScaling() {
  scaleToViewport();
}

/**
 * Updates the scaling factor when viewport dimensions change.
 */
export function updateScaling() {
  if (
    window.r2ScalingApplied &&
    window.r2LastJSViewport &&
    Math.abs(window.r2LastJSViewport.width - window.innerWidth) <
      VIEWPORT_EPSILON_PX &&
    Math.abs(window.r2LastJSViewport.height - window.innerHeight) <
      VIEWPORT_EPSILON_PX
  ) {
    debugLog("[R2Scale] Viewport dimensions nearly unchanged, skipping.");
    return;
  }
  scaleToViewport();
}

/**
 * Sets up the necessary event listeners for scaling.
 * This should be called once the core Readium scripts are ready.
 */
export function setupScalingListeners() {
  if (!isFixedLayoutDocument()) {
    debugLog("[R2Scale] Reflowable resource, scaling setup skipped.");
    return;
  }

  applyInitialScaling();

  if (scalingListenersAttached) {
    return;
  }
  scalingListenersAttached = true;

  const onViewportChanged = debounce(function () {
    updateScaling();
  }, 120);

  window.addEventListener("resize", onViewportChanged, { passive: true });
  window.addEventListener("orientationchange", onViewportChanged, {
    passive: true,
  });

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", onViewportChanged, {
      passive: true,
    });
  }
}
