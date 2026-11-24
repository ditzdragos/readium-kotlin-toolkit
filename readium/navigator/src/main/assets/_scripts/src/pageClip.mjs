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

// RR-9338: content past a fixed-layout page box widens the document and the pager pages it as an extra page.
export function clipPageOverflow(document, getComputedStyle) {
  const root = document.documentElement;
  const body = document.body;
  const page = document.scrollingElement || root;
  if (!body || root.hasAttribute("data-readium-page-clip")) {
    return false;
  }
  if (page.scrollWidth <= page.clientWidth + 1) {
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
  root.style.setProperty("min-height", "100%", "important");
  root.style.setProperty("contain", "layout", "important");
  root.setAttribute("data-readium-page-clip", "");
  return true;
}
