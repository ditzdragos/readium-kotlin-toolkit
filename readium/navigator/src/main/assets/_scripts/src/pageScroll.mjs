// Snaps the offset to the page width.
export function snapOffset(offset, pageWidth, rtl) {
  var value = offset + (rtl ? -1 : 1);
  return value - (value % pageWidth);
}

// Returns false if the page is already at the left-most scroll offset.
export function scrollPageLeft(scrollingElement, pageWidth, rtl) {
  var offset = scrollingElement.scrollLeft - pageWidth;
  var minOffset = rtl ? -(scrollingElement.scrollWidth - pageWidth) : 0;
  return scrollToOffset(
    scrollingElement,
    Math.max(offset, minOffset),
    pageWidth,
    rtl
  );
}

// Returns false if the page is already at the right-most scroll offset.
export function scrollPageRight(scrollingElement, pageWidth, rtl) {
  var offset = scrollingElement.scrollLeft + pageWidth;
  var maxOffset = rtl ? 0 : scrollingElement.scrollWidth - pageWidth;
  return scrollToOffset(
    scrollingElement,
    Math.min(offset, maxOffset),
    pageWidth,
    rtl
  );
}

// Returns whether the page moved toward the offset. Snapping and the browser's clamp can
// leave it where it was even when the offset is ahead, e.g. a scroll width that is not a
// whole number of pages.
function scrollToOffset(scrollingElement, offset, pageWidth, rtl) {
  var currentOffset = scrollingElement.scrollLeft;
  scrollingElement.scrollLeft = snapOffset(offset, pageWidth, rtl);
  var moved =
    (scrollingElement.scrollLeft - currentOffset) *
    Math.sign(offset - currentOffset);
  return moved / pageWidth > 0.01;
}
