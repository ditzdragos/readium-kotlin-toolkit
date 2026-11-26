const DROP_CAP_IMAGES = [
  'span[class*="dropcap"] img',
  'span[class*="drop-cap"] img',
  "span.initial img",
  'img[class*="dropcap"]',
  'img[class*="drop-cap"]',
].join(", ");

const PIXEL_LENGTH = /^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$/;

// ReadiumCSS sizes every image `auto`, so a drop cap picture sized only by its attributes grew page-tall and hid its chapter's first letter (RR-9318); the rules match ReadiumCSS's specificity so a publisher's own sizing still wins.
export function keepDropCapImageSizes(document) {
  var readiumBefore = document.querySelector(
    'link[href$="ReadiumCSS-before.css"]'
  );
  if (!readiumBefore) {
    return;
  }
  var rules = [];
  var images = document.querySelectorAll(DROP_CAP_IMAGES);
  for (var i = 0; i < images.length; i++) {
    var image = images[i];
    for (var dimension of ["width", "height"]) {
      var rule = attributeSizeRule(dimension, image.getAttribute(dimension));
      if (rule && !rules.includes(rule)) {
        rules.push(rule);
      }
    }
  }
  if (rules.length === 0) {
    return;
  }
  var style = document.createElement("style");
  style.textContent = rules.join("\n");
  readiumBefore.after(style);
}

function attributeSizeRule(dimension, value) {
  var length = PIXEL_LENGTH.exec(value);
  if (!length) {
    return null;
  }
  return `img:where(${DROP_CAP_IMAGES}):where([${dimension}="${value}"]) { ${dimension}: ${length[1]}px; }`;
}
