export const DROP_CAP_IMAGES = [
  'span[class*="dropcap"] img',
  'span[class*="drop-cap"] img',
  "span.initial img",
  'img[class*="dropcap"]',
  'img[class*="drop-cap"]',
].join(", ");

const PIXEL_LENGTH = /^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$/;

// ReadiumCSS sizes every image `auto`, so a drop cap drawn as a picture grew to a page-tall float and left its chapter without a first letter (RR-9318).
export function keepDropCapImageSizes(document) {
  var images = document.querySelectorAll(DROP_CAP_IMAGES);
  for (var i = 0; i < images.length; i++) {
    ["width", "height"].forEach(function (dimension) {
      var length = PIXEL_LENGTH.exec(images[i].getAttribute(dimension) ?? "");
      if (length) {
        images[i].style[dimension] = length[1] + "px";
      }
    });
  }
}
