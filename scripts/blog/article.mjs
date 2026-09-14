import {
  absoluteUrl,
  escapeRegExp,
  normalizeComparableText,
  normalizeWhitespace,
} from "./utils.mjs";

import {
  addCandidate,
  extractImageCandidatesFromHtml,
  extractArticleMetaImages,
} from "./candidates.mjs";

import {
  isLikelyImageUrl,
  isUnsplashImageUrl,
  isUnsplashPageUrl,
} from "./image-url.mjs";

import { log } from "./logger.mjs";

/* -------------------------------------------------------------------------- */
/* Tag helpers                                                                */
/* -------------------------------------------------------------------------- */

function parseTagToken(token) {
  const match = String(token || "").match(
    /^<([a-z0-9:-]+)\b([^>]*)>/i
  );

  if (!match) {
    return null;
  }

  const fullName = match[1].toLowerCase();
  const attrs = match[2] || "";

  return {
    name: fullName,
    attrs,
    raw: token,
  };
}

/* -------------------------------------------------------------------------- */
/* Heading / title matching                                                   */
/* -------------------------------------------------------------------------- */

function findHeadingForTitle(html, title) {
  if (!html || !title) {
    return null;
  }

  const normalizedTitle =
    normalizeComparableText(title);

  if (!normalizedTitle) {
    return null;
  }

  const headingRegex =
    /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;

  let match;

  while ((match = headingRegex.exec(html))) {
    const headingText =
      normalizeComparableText(match[2]);

    if (!headingText) {
      continue;
    }

    if (
      headingText === normalizedTitle ||
      headingText.includes(normalizedTitle) ||
      normalizedTitle.includes(headingText)
    ) {
      return {
        index: match.index,
        end: headingRegex.lastIndex,
        level: Number(match[1]),
        text: normalizeWhitespace(match[2]),
      };
    }
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Exact post container detection                                             */
/* -------------------------------------------------------------------------- */

function blockMatchesPost(attrs, title) {
  if (!attrs || !title) {
    return false;
  }

  const lower = String(attrs).toLowerCase();

  /*
   * Do not use generic "post" as a standalone match.
   *
   * Blogger themes frequently contain:
   *   post-title
   *   entry-title
   *   post-header
   *
   * These are not necessarily article containers.
   */

  if (
    /\bpost-title\b/i.test(lower) ||
    /\bentry-title\b/i.test(lower) ||
    /\bpost-header\b/i.test(lower)
  ) {
    return false;
  }

  const normalizedTitle =
    normalizeComparableText(title);

  if (!normalizedTitle) {
    return false;
  }

  /*
   * class / id values that strongly indicate an article container.
   */
  const strongContainer =
    /\bpost-outer\b/i.test(lower) ||
    /\bpost-body\b/i.test(lower) ||
    /\bpost-content\b/i.test(lower) ||
    /\bentry-content\b/i.test(lower) ||
    /\barticle-body\b/i.test(lower) ||
    /\barticle-content\b/i.test(lower) ||
    /\bblog-post\b/i.test(lower) ||
    /\bpost\b/i.test(lower);

  if (!strongContainer) {
    return false;
  }

  return true;
}

/* -------------------------------------------------------------------------- */
/* Find exact post region                                                     */
/* -------------------------------------------------------------------------- */

function findExactPostRegion(html, title) {
  if (!html || !title) {
    return null;
  }

  /*
   * First try the heading/title location.
   */
  const heading = findHeadingForTitle(
    html,
    title
  );

  /*
   * Parse opening/closing tags with a lightweight nesting stack.
   *
   * This is intentionally not a DOM dependency because the GitHub Actions
   * workflow should work with the existing Node environment.
   */
  const tagRegex =
    /<!--[\s\S]*?-->|<![^>]*>|<\/?[a-z0-9:-]+\b[^>]*>/gi;

  const stack = [];

  let match;

  while ((match = tagRegex.exec(html))) {
    const token = match[0];

    if (
      token.startsWith("<!--") ||
      token.startsWith("<!")
    ) {
      continue;
    }

    const closing =
      /^<\//.test(token);

    const selfClosing =
      /\/\s*>$/.test(token);

    const parsed =
      parseTagToken(token);

    if (!parsed) {
      continue;
    }

    if (closing) {
      /*
       * Pop until the matching element is found.
       */
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].name === parsed.name) {
          stack.splice(i);
          break;
        }
      }

      continue;
    }

    const candidate = {
      name: parsed.name,
      attrs: parsed.attrs,
      start: match.index,
      openEnd: tagRegex.lastIndex,
    };

    /*
     * Only inspect likely container elements.
     */
    if (
      parsed.name === "article" ||
      parsed.name === "div" ||
      parsed.name === "section"
    ) {
      if (
        blockMatchesPost(
          parsed.attrs,
          title
        )
      ) {
        const closingEnd =
          findMatchingClosingTag(
            html,
            candidate.start,
            parsed.name
          );

        if (
          closingEnd !== null &&
          closingEnd > candidate.openEnd
        ) {
          const region =
            html.slice(
              candidate.start,
              closingEnd
            );

          /*
           * Prefer a region containing the exact title.
           */
          const comparable =
            normalizeComparableText(region);

          if (
            comparable.includes(
              normalizeComparableText(title)
            )
          ) {
            return {
              html: region,
              start: candidate.start,
              end: closingEnd,
              tag: parsed.name,
              attrs: parsed.attrs,
            };
          }
        }
      }
    }

    if (!selfClosing) {
      stack.push(candidate);
    }
  }

  /*
   * Fallback around the matching heading.
   *
   * This does NOT use a site-wide image.
   * It only returns a bounded region around the exact title.
   */
  if (heading) {
    const before =
      Math.max(
        0,
        heading.index - 5000
      );

    const after =
      Math.min(
        html.length,
        heading.end + 100000
      );

    const region =
      html.slice(before, after);

    return {
      html: region,
      start: before,
      end: after,
      tag: "heading-region",
      attrs: "",
    };
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Matching closing tag                                                      */
/* -------------------------------------------------------------------------- */

function findMatchingClosingTag(
  html,
  startIndex,
  tagName
) {
  const escaped =
    escapeRegExp(tagName);

  const tagRegex =
    new RegExp(
      `<\\/?${escaped}\\b[^>]*>`,
      "gi"
    );

  tagRegex.lastIndex = startIndex;

  let depth = 0;
  let match;

  while ((match = tagRegex.exec(html))) {
    const token = match[0];

    if (
      /^<\//.test(token)
    ) {
      depth--;

      if (depth === 0) {
        return tagRegex.lastIndex;
      }

      continue;
    }

    if (
      /\/\s*>$/.test(token)
    ) {
      continue;
    }

    depth++;
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Unsplash attribution detection                                             */
/* -------------------------------------------------------------------------- */

function findUnsplashAttributionCandidates(
  html
) {
  const candidates = [];

  if (!html) {
    return candidates;
  }

  /*
   * Look for explicit Unsplash image URLs first.
   */
  const imageRegex =
    /https?:\/\/(?:images|plus)\.unsplash\.com\/[^\s"'<>]+/gi;

  let match;

  while ((match = imageRegex.exec(html))) {
    const url = absoluteUrl(
      match[0]
    );

    if (!url) {
      continue;
    }

    if (
      !isUnsplashImageUrl(url)
    ) {
      continue;
    }

    addCandidate(
      candidates,
      url,
      "unsplash-attribution",
      850,
      {
        association:
          "exact-post-body-unsplash",
      }
    );
  }

  /*
   * Look for Unsplash attribution links.
   *
   * Example:
   *   Photo by Someone on Unsplash
   *
   * The attribution itself may be a page URL rather than an image URL.
   * We deliberately DO NOT treat the attribution page URL as an image.
   */
  const anchorRegex =
    /<a\b[^>]*href\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;

  while ((match = anchorRegex.exec(html))) {
    const href =
      match[1] ||
      match[2] ||
      match[3] ||
      "";

    const text =
      normalizeComparableText(
        match[4] || ""
      );

    if (!href) {
      continue;
    }

    const normalized =
      absoluteUrl(href);

    if (!normalized) {
      continue;
    }

    /*
     * Only attribution-related links.
     */
    const attributionText =
      text.includes("unsplash") ||
      text.includes("photo by") ||
      text.includes("image by") ||
      text.includes("photograph by");

    if (!attributionText) {
      continue;
    }

    /*
     * An Unsplash page URL is not itself an image.
     */
    if (
      isUnsplashPageUrl(normalized)
    ) {
      continue;
    }

    if (
      !isUnsplashImageUrl(normalized)
    ) {
      continue;
    }

    addCandidate(
      candidates,
      normalized,
      "unsplash-attribution",
      840,
      {
        association:
          "exact-post-body-unsplash",
      }
    );
  }

  /*
   * Some generated posts put the attribution in plain text next to an
   * image. Search a small surrounding region rather than the whole page.
   */
  const lowerHtml =
    String(html).toLowerCase();

  const markers = [
    "unsplash",
    "photo by",
    "image by",
    "photograph by",
  ];

  for (const marker of markers) {
    let offset = 0;

    while (true) {
      const index =
        lowerHtml.indexOf(
          marker,
          offset
        );

      if (index < 0) {
        break;
      }

      const nearbyStart =
        Math.max(
          0,
          index - 5000
        );

      const nearbyEnd =
        Math.min(
          html.length,
          index + 5000
        );

      const nearby =
        html.slice(
          nearbyStart,
          nearbyEnd
        );

      const imageCandidates =
        extractImageCandidatesFromHtml(
          nearby,
          {
            source:
              "unsplash-attribution",
          }
        );

      for (const candidate of imageCandidates) {
        if (
          isUnsplashImageUrl(
            candidate.url
          )
        ) {
          candidates.push({
            ...candidate,
            score:
              Math.max(
                candidate.score || 0,
                820
              ),
            association:
              "exact-post-body-unsplash",
          });
        }
      }

      offset =
        index + marker.length;
    }
  }

  return candidates;
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

export {
  parseTagToken,
  findHeadingForTitle,
  blockMatchesPost,
  findExactPostRegion,
  findMatchingClosingTag,
  findUnsplashAttributionCandidates,
};
