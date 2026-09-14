import {
  normalizeWhitespace,
  absoluteUrl,
} from "./utils.mjs";

import {
  parseAttributes,
  stripHtml,
} from "./html.mjs";

function extractPageMetadata(
  html
) {
  const title =
    extractMetaContent(
      html,
      "property",
      "og:title"
    ) ||
    extractMetaContent(
      html,
      "name",
      "title"
    ) ||
    "";

  const description =
    extractMetaContent(
      html,
      "property",
      "og:description"
    ) ||
    extractMetaContent(
      html,
      "name",
      "description"
    ) ||
    "";

  const ogImage =
    extractMetaContent(
      html,
      "property",
      "og:image"
    ) || null;

  const language =
    extractHtmlLang(html) ||
    "en";

  return {
    title:
      normalizeWhitespace(
        stripHtml(title)
      ),

    description:
      normalizeWhitespace(
        stripHtml(description)
      ),

    ogImage:
      absoluteUrl(
        ogImage
      ),

    language,
  };
}

function extractMetaContent(
  html,
  attribute,
  value
) {
  const regex =
    /<meta\b[^>]*>/gi;

  let match;

  while (
    (match = regex.exec(html))
  ) {
    const attrs =
      parseAttributes(
        match[0]
      );

    if (
      String(
        attrs[attribute] || ""
      ).toLowerCase() ===
      String(
        value
      ).toLowerCase()
    ) {
      return (
        attrs.content ||
        null
      );
    }
  }

  return null;
}

function extractHtmlLang(
  html
) {
  const match =
    html.match(
      /<html\b[^>]*\blang=["']([^"']+)["']/i
    );

  return match
    ? match[1]
    : null;
}

export {
  extractPageMetadata,
};
