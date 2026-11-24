const BACKGROUND_LONGHANDS = [
  "color",
  "image",
  "repeat",
  "position",
  "size",
  "attachment",
  "origin",
  "clip",
];

function declaredPageWidth(document) {
  const viewport = document.querySelector('meta[name="viewport"]');
  const match = /(?:^|[\s,;])width\s*=\s*([0-9.]+)/i.exec(
    (viewport && viewport.getAttribute("content")) || ""
  );
  return match ? parseFloat(match[1]) : NaN;
}

// RR-9338: content past a fixed-layout page box widens the document and the pager pages it as an extra page.
export function clipPageOverflow(document, getComputedStyle) {
  const root = document.documentElement;
  const body = document.body;
  const page = document.scrollingElement || root;
  if (!body || root.hasAttribute("data-readium-page-clip")) {
    return false;
  }
  const pageWidth = declaredPageWidth(document);
  if (!(pageWidth > 0) || page.scrollWidth <= pageWidth + 1) {
    return false;
  }

  const rootStyle = getComputedStyle(root);
  const bodyStyle = getComputedStyle(body);
  if (rootStyle.overflowX === "visible" && rootStyle.overflowY === "visible") {
    body.style.setProperty("overflow", "visible", "important");
  }
  if (
    rootStyle.backgroundColor === "rgba(0, 0, 0, 0)" &&
    rootStyle.backgroundImage === "none"
  ) {
    for (const longhand of BACKGROUND_LONGHANDS) {
      const property = "background-" + longhand;
      root.style.setProperty(
        property,
        bodyStyle.getPropertyValue(property),
        "important"
      );
    }
    body.style.setProperty("background", "none", "important");
  }
  root.style.setProperty("height", "100%", "important");
  root.style.setProperty("contain", "layout", "important");
  root.setAttribute("data-readium-page-clip", "");
  return true;
}
