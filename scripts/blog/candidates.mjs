import {
  absoluteUrl,
  decodeEscapedUrl,
} from "./utils.mjs";

import {
  isLikelyImageUrl,
  isUnsplashPageUrl,
  normalizeBloggerImageUrl,
  isBloggerImageUrl,
  isUnsplashImageUrl,
} from "./image-url.mjs";

import {
  parseAttributes,
  extractSrcsetUrls,
} from "./html.mjs";

function addCandidate(
  list,
  url,
  source,
  score,
  extra = {}
) {
  const normalized =
    normalizeBloggerImageUrl(url) ||
    absoluteUrl(url);

  if (!normalized) return;

  if (
    !isLikelyImageUrl(
      normalized
    )
  ) {
    return;
  }

  if (
    isUnsplashPageUrl(
      normalized
    )
  ) {
    return;
  }

  list.push({
    url: normalized,
    source,
    score,
    ...extra,
  });
}

function extractImageCandidatesFromHtml(
  html,
  options = {}
) {
  const candidates = [];

  if (!html) {
    return candidates;
  }

  const imgRegex =
    /<img\b[^>]*>/gi;

  let match;

  while (
    (match = imgRegex.exec(html))
  ) {
    const tag = match[0];

    const attrs =
      parseAttributes(tag);

    const sources = [
      ["src", attrs.src, 700],
      [
        "data-src",
        attrs["data-src"],
        690,
      ],
      [
        "data-original",
        attrs["data-original"],
        685,
      ],
      [
        "data-lazy-src",
        attrs["data-lazy-src"],
        680,
      ],
      [
        "data-image",
        attrs["data-image"],
        675,
      ],
      [
        "data-url",
        attrs["data-url"],
        670,
      ],
      [
        "data-original-src",
        attrs["data-original-src"],
        665,
      ],
    ];

    for (
      const [name, url, score] of
        sources
    ) {
      if (url) {
        addCandidate(
          candidates,
          url,
          options.source ||
            "article-body",
          score,
          {
            attribute: name,
          }
        );
      }
    }

    for (
      const src of
        extractSrcsetUrls(
          attrs.srcset ||
            attrs["data-srcset"]
        )
    ) {
      addCandidate(
        candidates,
        src,
        options.source ||
          "article-body",
        710,
        {
          attribute:
            "srcset",
        }
      );
    }
  }

  const sourceRegex =
    /<source\b[^>]*>/gi;

  while (
    (match =
      sourceRegex.exec(html))
  ) {
    const attrs =
      parseAttributes(match[0]);

    if (attrs.src) {
      addCandidate(
        candidates,
        attrs.src,
        options.source ||
          "article-body",
        705,
        {
          attribute: "src",
        }
      );
    }

    for (
      const src of
        extractSrcsetUrls(
          attrs.srcset
        )
    ) {
      addCandidate(
        candidates,
        src,
        options.source ||
          "article-body",
        706,
        {
          attribute:
            "srcset",
        }
      );
    }
  }

  const cssUrlRegex =
    /url\(\s*(['"]?)(https?:\/\/.*?)\1\s*\)/gi;

  while (
    (match =
      cssUrlRegex.exec(html))
  ) {
    addCandidate(
      candidates,
      match[2],
      options.source ||
        "article-body",
      500,
      {
        attribute:
          "css-url",
      }
    );
  }

  const anchorRegex =
    /<a\b[^>]*>/gi;

  while (
    (match =
      anchorRegex.exec(html))
  ) {
    const attrs =
      parseAttributes(match[0]);

    const href = attrs.href
      ? attrs.href.trim()
      : "";

    if (!href) continue;

    const normalizedHref =
      absoluteUrl(href);

    if (!normalizedHref) {
      continue;
    }

    if (
      isUnsplashPageUrl(
        normalizedHref
      )
    ) {
      continue;
    }

    const lower =
      normalizedHref.toLowerCase();

    const isKnownImageHost =
      isBloggerImageUrl(
        normalizedHref
      ) ||
      isUnsplashImageUrl(
        normalizedHref
      ) ||
      lower.includes(
        "images.pexels.com/"
      ) ||
      lower.includes(
        "cloudinary.com/"
      );

    if (!isKnownImageHost) {
      continue;
    }

    addCandidate(
      candidates,
      normalizedHref,
      options.source ||
        "article-body",
      620,
      {
        attribute: "href",
      }
    );
  }

  return candidates;
}

function extractArticleMetaImages(
  html
) {
  const candidates = [];

  if (!html) return candidates;

  const metaRegex =
    /<meta\b[^>]*>/gi;

  let match;

  while (
    (match =
      metaRegex.exec(html))
  ) {
    const attrs =
      parseAttributes(match[0]);

    const property = (
      attrs.property ||
      attrs.name ||
      attrs.itemprop ||
      ""
    ).toLowerCase();

    const content =
      attrs.content;

    if (!content) continue;

    if (
      property ===
      "og:image"
    ) {
      addCandidate(
        candidates,
        content,
        "article-og",
        1200,
        {
          metaType:
            "og:image",
          association:
            "article-og",
        }
      );
    }

    if (
      property ===
      "twitter:image"
    ) {
      addCandidate(
        candidates,
        content,
        "article-twitter",
        1150,
        {
          metaType:
            "twitter:image",
          association:
            "article-twitter",
        }
      );
    }

    if (
      property ===
      "twitter:image:src"
    ) {
      addCandidate(
        candidates,
        content,
        "article-twitter",
        1140,
        {
          metaType:
            "twitter:image:src",
          association:
            "article-twitter",
        }
      );
    }

    if (
      property ===
      "image_src"
    ) {
      addCandidate(
        candidates,
        content,
        "article-meta",
        1130,
        {
          metaType:
            "image_src",
          association:
            "article-meta",
        }
      );
    }
  }

  return candidates;
}

export {
  addCandidate,
  extractImageCandidatesFromHtml,
  extractArticleMetaImages,
};
