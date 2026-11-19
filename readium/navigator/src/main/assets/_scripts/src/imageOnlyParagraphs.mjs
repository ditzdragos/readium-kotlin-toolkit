export const IMAGE_ONLY_ATTRIBUTE = "data-readium-image-only";

// A paragraph holding only a picture keeps the publisher's alignment under the text-align setting (RR-6407).
export function isImageOnlyParagraph(paragraph) {
  return (
    paragraph.textContent.trim() === "" &&
    paragraph.querySelector("img, svg") !== null
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
