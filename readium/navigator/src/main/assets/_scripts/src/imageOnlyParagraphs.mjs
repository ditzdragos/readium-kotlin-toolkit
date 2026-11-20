export const IMAGE_ONLY_ATTRIBUTE = "data-readium-image-only";

const INVISIBLE_CHARACTERS = /[\s\u00AD\u200B-\u200D\u2060]/g;

function textOutsideSvg(paragraph) {
  if (paragraph.querySelector("svg") === null) {
    return paragraph.textContent;
  }
  var copy = paragraph.cloneNode(true);
  var svgs = copy.querySelectorAll("svg");
  for (var i = 0; i < svgs.length; i++) {
    svgs[i].remove();
  }
  return copy.textContent;
}

// A paragraph holding only a picture keeps the publisher's alignment under the text-align setting (RR-6407).
export function isImageOnlyParagraph(paragraph) {
  return (
    paragraph.querySelector("img, svg") !== null &&
    textOutsideSvg(paragraph).replace(INVISIBLE_CHARACTERS, "") === ""
  );
}

export function markImageOnlyParagraphs(document) {
  var paragraphs = document.querySelectorAll("p");
  for (var i = 0; i < paragraphs.length; i++) {
    if (isImageOnlyParagraph(paragraphs[i])) {
      paragraphs[i].setAttribute(IMAGE_ONLY_ATTRIBUTE, "");
    }
  }
}
