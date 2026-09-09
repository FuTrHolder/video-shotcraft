// scripts/capture-blog.mjs
// BLOG ANALYZER v11.0
//
// Blogger blog analyzer
//
// v11 architecture:
// 1. Fetch Blogger Atom feed.
// 2. Extract images from media:thumbnail / media:content directly.
// 3. Extract images from feed content / summary.
// 4. If feed image extraction fails, fetch the exact article page.
// 5. Locate the exact post container.
// 6. Extract candidates from:
//      - <img src>
//      - <img data-*>
//      - <img srcset>
//      - <source src/srcset>
//      - nearest <a href>
//      - CSS url()
//      - Googleusercontent URLs
//      - JSON/script embedded URLs
// 7. DO NOT require .jpg/.png extension.
// 8. Download candidate and verify actual image bytes.
// 9. Use ImageMagick identify for real image validation.
// 10. Reject exact and perceptual duplicates.
// 11. Write blog.json.
//
// Designed for GitHub Actions Ubuntu + Node 22.
// Compatible with ImageMagick 6 and 7.

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import process from "node:process";
import { execFile } from "node:child_process";

// ============================================================
// Configuration
// ============================================================

const VERSION = "11.0";

const BLOG_URL =
  process.env.BLOG_URL ||
  process.argv[2] ||
  "https://funds-up.blogspot.com/";

const OUTPUT_DIR = path.resolve(
  "template/public/blog"
);

const IMAGE_DIR = path.join(
  OUTPUT_DIR,
  "images"
);

const BLOG_JSON = path.join(
  OUTPUT_DIR,
  "blog.json"
);

const FETCH_TIMEOUT = 25000;

const MAX_POSTS = 5;

const MIN_IMAGE_BYTES = 5000;

const MIN_IMAGE_WIDTH = 240;

const MIN_IMAGE_HEIGHT = 160;

const MAX_CANDIDATES_PER_POST = 80;

const MAX_ARTICLE_HTML_SCAN = 1000000;

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/131.0.0.0 Safari/537.36";

const IMAGE_CONTENT_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/bmp",
  "image/tiff",
  "image/svg+xml",
];

const IMAGE_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".avif",
  ".bmp",
  ".tif",
  ".tiff",
];

const BAD_IMAGE_PATTERNS = [
  /\/feeds?\//i,
  /\/search\b/i,
  /\/label\//i,
  /\/archive\//i,
  /favicon/i,
  /sprite/i,
  /tracking/i,
  /pixel/i,
  /analytics/i,
  /spacer/i,
  /blank\.gif/i,
  /transparent\.(gif|png)/i,
  /data:image/i,
];

const IMAGE_ATTRIBUTES = [
  "src",
  "data-src",
  "data-original",
  "data-lazy-src",
  "data-lazy",
  "data-image",
  "data-image-url",
  "data-url",
  "data-fallback-src",
  "data-original-src",
  "data-original-url",
  "data-lazy-url",
  "data-bg",
  "data-background",
  "data-background-image",
  "data-img",
  "data-image-src",
  "srcset",
  "data-srcset",
  "data-lazy-srcset",
];

const ANCHOR_ATTRIBUTES = [
  "href",
  "data-href",
  "data-url",
];

let IMAGE_MAGICK = {
  identify: "identify",
  convert: "convert",
  version: "",
  major: 6,
};

// ============================================================
// Logging
// ============================================================

function log(...args) {
  console.log(...args);
}

function warn(...args) {
  console.warn(...args);
}

function sleep(ms) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}

// ============================================================
// Text / HTML helpers
// ============================================================

function cleanText(value) {
  if (!value) return "";

  return String(value)
    .replace(
      /<script[\s\S]*?<\/script>/gi,
      " "
    )
    .replace(
      /<style[\s\S]*?<\/style>/gi,
      " "
    )
    .replace(
      /<[^>]+>/g,
      " "
    )
    .replace(
      /&nbsp;/gi,
      " "
    )
    .replace(
      /&amp;/gi,
      "&"
    )
    .replace(
      /&quot;/gi,
      '"'
    )
    .replace(
      /&#39;/gi,
      "'"
    )
    .replace(
      /&#x27;/gi,
      "'"
    )
    .replace(
      /&lt;/gi,
      "<"
    )
    .replace(
      /&gt;/gi,
      ">"
    )
    .replace(
      /&#x2F;/gi,
      "/"
    )
    .replace(
      /&#47;/gi,
      "/"
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

function decodeHtmlEntities(value) {
  if (!value) return "";

  return String(value)
    .replace(
      /&amp;/gi,
      "&"
    )
    .replace(
      /&quot;/gi,
      '"'
    )
    .replace(
      /&#39;/gi,
      "'"
    )
    .replace(
      /&#x27;/gi,
      "'"
    )
    .replace(
      /&lt;/gi,
      "<"
    )
    .replace(
      /&gt;/gi,
      ">"
    )
    .replace(
      /&#x2F;/gi,
      "/"
    )
    .replace(
      /&#47;/gi,
      "/"
    )
    .replace(
      /&#x3D;/gi,
      "="
    )
    .replace(
      /&#61;/gi,
      "="
    )
    .replace(
      /&#x26;/gi,
      "&"
    )
    .replace(
      /&#38;/gi,
      "&"
    );
}

function decodeEscapedHtml(value) {
  if (!value) return "";

  return String(value)
    .replace(
      /\\\//g,
      "/"
    )
    .replace(
      /\\"/g,
      '"'
    )
    .replace(
      /\\'/g,
      "'"
    )
    .replace(
      /\\\\/g,
      "\\"
    );
}

function decodeRepeated(value) {
  let current =
    String(value ?? "");

  for (let i = 0; i < 3; i++) {
    const next =
      decodeEscapedHtml(
        decodeHtmlEntities(
          current
        )
      );

    if (next === current) {
      break;
    }

    current = next;
  }

  return current;
}

// ============================================================
// URL helpers
// ============================================================

function normalizeUrl(
  raw,
  baseUrl = BLOG_URL
) {
  if (!raw) {
    return null;
  }

  let value =
    decodeRepeated(
      String(raw).trim()
    );

  value =
    value.replace(
      /^url\(\s*/i,
      ""
    );

  value =
    value.replace(
      /\s*\)$/i,
      ""
    );

  value =
    value.trim();

  value =
    value.replace(
      /^["'`]+/,
      ""
    );

  value =
    value.replace(
      /["'`]+$/,
      ""
    );

  if (!value) {
    return null;
  }

  if (
    /^data:/i.test(value)
  ) {
    return null;
  }

  if (
    /^javascript:/i.test(value)
  ) {
    return null;
  }

  if (
    value.startsWith("//")
  ) {
    value =
      `https:${value}`;
  }

  try {
    const url =
      new URL(
        value,
        baseUrl
      );

    url.hash = "";

    return url.toString();
  } catch {
    return null;
  }
}

function getHost(url) {
  try {
    return new URL(
      url
    ).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isGoogleImageHost(
  url
) {
  const host =
    getHost(url);

  return (
    host.includes(
      "googleusercontent.com"
    ) ||
    host.includes(
      "ggpht.com"
    ) ||
    host.endsWith(
      ".bp.blogspot.com"
    )
  );
}

function isBloggerHost(
  url
) {
  const host =
    getHost(url);

  return (
    host.includes(
      "googleusercontent.com"
    ) ||
    host.endsWith(
      ".bp.blogspot.com"
    ) ||
    host.endsWith(
      ".blogspot.com"
    )
  );
}

function isResizeOnlyPath(
  pathname
) {
  if (!pathname) {
    return false;
  }

  const value =
    pathname.trim();

  if (
    /\/(?:s|w|h)\d+(?:-[a-z0-9]+)*\/?$/i.test(
      value
    )
  ) {
    return true;
  }

  if (
    /\/(?:w\d+-h\d+|h\d+-w\d+|s\d+-h\d+)(?:-[a-z0-9]+)*\/?$/i.test(
      value
    )
  ) {
    return true;
  }

  return false;
}

function isIncompleteBloggerUrl(
  url
) {
  if (!url) {
    return true;
  }

  let parsed;

  try {
    parsed =
      new URL(url);
  } catch {
    return true;
  }

  if (
    !isBloggerHost(url)
  ) {
    return false;
  }

  const pathname =
    parsed.pathname;

  if (
    isResizeOnlyPath(
      pathname
    )
  ) {
    return true;
  }

  if (
    /\/img\/b\/[^/]+\/[^/]+\/?$/i.test(
      pathname
    )
  ) {
    return true;
  }

  return false;
}

function normalizeBloggerImageUrl(
  raw
) {
  const normalized =
    normalizeUrl(raw);

  if (!normalized) {
    return null;
  }

  let url;

  try {
    url =
      new URL(normalized);
  } catch {
    return null;
  }

  if (
    !isBloggerHost(
      normalized
    )
  ) {
    return normalized;
  }

  let pathname =
    url.pathname;

  /*
   * Blogger image URL examples:
   *
   * /img/b/.../s640/image.jpg
   * /img/b/.../w1200/image.jpg
   * /img/b/.../s72-c/image.jpg
   *
   * Convert resize directory to /s1600/
   * while preserving the actual filename.
   */

  pathname =
    pathname.replace(
      /\/s\d+(?:-[a-z0-9]+)*(?=\/[^/]+$)/i,
      "/s1600"
    );

  pathname =
    pathname.replace(
      /\/w\d+(?:-h\d+)?(?:-[a-z0-9]+)*(?=\/[^/]+$)/i,
      "/s1600"
    );

  pathname =
    pathname.replace(
      /\/h\d+(?:-w\d+)?(?:-[a-z0-9]+)*(?=\/[^/]+$)/i,
      "/s1600"
    );

  pathname =
    pathname.replace(
      /\/w\d+-h\d+(?:-[a-z0-9]+)*(?=\/[^/]+$)/i,
      "/s1600"
    );

  pathname =
    pathname.replace(
      /\/s\d+-h\d+(?:-[a-z0-9]+)*(?=\/[^/]+$)/i,
      "/s1600"
    );

  url.pathname =
    pathname;

  return url.toString();
}

/*
 * v11 does NOT require an image extension.
 *
 * CDN URLs such as:
 *
 * https://images.unsplash.com/photo-123?auto=format&w=1200
 *
 * are valid image candidates.
 *
 * The actual image validation happens AFTER download.
 */

function looksLikeImageCandidateUrl(
  url
) {
  if (!url) {
    return false;
  }

  if (
    /^data:/i.test(url)
  ) {
    return false;
  }

  const normalized =
    normalizeUrl(url);

  if (!normalized) {
    return false;
  }

  if (
    isIncompleteBloggerUrl(
      normalized
    )
  ) {
    return false;
  }

  const lower =
    normalized.toLowerCase();

  if (
    BAD_IMAGE_PATTERNS.some(
      (pattern) =>
        pattern.test(
          lower
        )
    )
  ) {
    return false;
  }

  let parsed;

  try {
    parsed =
      new URL(
        normalized
      );
  } catch {
    return false;
  }

  if (
    !/^https?:$/i.test(
      parsed.protocol
    )
  ) {
    return false;
  }

  return true;
}

function looksLikeDefiniteImageUrl(
  url
) {
  if (!url) {
    return false;
  }

  try {
    const pathname =
      new URL(url)
        .pathname
        .toLowerCase();

    return IMAGE_EXTENSIONS.some(
      (ext) =>
        pathname.endsWith(
          ext
        )
    );
  } catch {
    return false;
  }
}

// ============================================================
// Candidate scoring
// ============================================================

function scoreImageCandidate(
  url,
  source,
  context = ""
) {
  if (!url) {
    return -Infinity;
  }

  let score = 0;

  const lower =
    url.toLowerCase();

  const ctx =
    String(
      context
    ).toLowerCase();

  if (
    isGoogleImageHost(url)
  ) {
    score += 45;
  }

  if (
    looksLikeDefiniteImageUrl(
      url
    )
  ) {
    score += 15;
  }

  switch (source) {
    case "feed-media":
      score += 180;
      break;

    case "feed-thumbnail":
      score += 165;
      break;

    case "feed-content":
      score += 155;
      break;

    case "article-anchor":
      score += 150;
      break;

    case "article-post-body":
      score += 145;
      break;

    case "article-img":
      score += 135;
      break;

    case "article-srcset":
      score += 125;
      break;

    case "article-source":
      score += 120;
      break;

    case "article-css":
      score += 95;
      break;

    case "article-script":
      score += 80;
      break;

    case "article-raw":
      score += 70;
      break;

    default:
      score += 40;
      break;
  }

  if (
    /thumbnail|thumb|avatar|profile|logo|icon|sprite/i.test(
      ctx
    )
  ) {
    score -= 60;
  }

  if (
    /header|footer|sidebar|navigation|navbar/i.test(
      ctx
    )
  ) {
    score -= 40;
  }

  if (
    lower.includes(
      "images.unsplash.com"
    )
  ) {
    score += 20;
  }

  if (
    lower.includes(
      "images.pexels.com"
    )
  ) {
    score += 20;
  }

  if (
    lower.includes(
      "cloudinary.com"
    )
  ) {
    score += 15;
  }

  return score;
}

// ============================================================
// Candidate deduplication
// ============================================================

function dedupeCandidates(
  candidates
) {
  const map =
    new Map();

  for (
    const candidate
    of candidates
  ) {
    if (
      !candidate?.url
    ) {
      continue;
    }

    const normalized =
      normalizeBloggerImageUrl(
        candidate.url
      );

    if (!normalized) {
      continue;
    }

    if (
      !looksLikeImageCandidateUrl(
        normalized
      )
    ) {
      continue;
    }

    const existing =
      map.get(
        normalized
      );

    if (
      !existing ||
      candidate.score >
        existing.score
    ) {
      map.set(
        normalized,
        {
          ...candidate,
          url:
            normalized,
        }
      );
    }
  }

  return [
    ...map.values(),
  ]
    .sort(
      (a, b) =>
        b.score - a.score
    )
    .slice(
      0,
      MAX_CANDIDATES_PER_POST
    );
}

// ============================================================
// HTML attribute extraction
// ============================================================

function extractAttribute(
  tag,
  attributeName
) {
  const escaped =
    attributeName.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

  const regex =
    new RegExp(
      `\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
      "i"
    );

  const match =
    tag.match(
      regex
    );

  if (!match) {
    return null;
  }

  return (
    match[1] ??
    match[2] ??
    match[3] ??
    null
  );
}

function extractAllAttributes(
  tag
) {
  const attributes =
    [];

  const regex =
    /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

  for (
    const match
    of tag.matchAll(
      regex
    )
  ) {
    attributes.push({
      name:
        match[1],
      value:
        match[2] ??
        match[3] ??
        match[4] ??
        "",
    });
  }

  return attributes;
}

function extractSrcset(
  value
) {
  if (!value) {
    return [];
  }

  const result =
    [];

  for (
    const part
    of String(value).split(",")
  ) {
    const trimmed =
      part.trim();

    if (!trimmed) {
      continue;
    }

    const pieces =
      trimmed.split(
        /\s+/
      );

    if (
      pieces[0]
    ) {
      result.push(
        pieces[0]
      );
    }
  }

  return result;
}

function cleanCandidateRawUrl(
  raw
) {
  if (!raw) {
    return null;
  }

  let value =
    decodeRepeated(
      String(raw).trim()
    );

  value =
    value.replace(
      /^[(<\s"'`]+/,
      ""
    );

  value =
    value.replace(
      /[>\s"'`,;]+$/,
      ""
    );

  while (
    value.endsWith(")") &&
    (
      value.match(
        /\(/g
      ) || []
    ).length <
      (
        value.match(
          /\)/g
        ) || []
      ).length
  ) {
    value =
      value.slice(
        0,
        -1
      );
  }

  return value;
}

// ============================================================
// Googleusercontent URL extraction
// ============================================================

function extractGoogleusercontentUrls(
  html
) {
  if (!html) {
    return [];
  }

  const results =
    [];

  const patterns = [
    /https?:\/\/[^"'<>\\\s]+googleusercontent\.com\/[^"'<>\\\s]+/gi,
    /https?:\/\/[^"'<>\\\s]+ggpht\.com\/[^"'<>\\\s]+/gi,
    /https?:\\\/\\\/[^"'<>\\\s]+googleusercontent\.com\\\/[^"'<>\\\s]+/gi,
  ];

  for (
    const regex
    of patterns
  ) {
    for (
      const match
      of html.matchAll(
        regex
      )
    ) {
      const cleaned =
        cleanCandidateRawUrl(
          match[0]
        );

      if (!cleaned) {
        continue;
      }

      const normalized =
        normalizeBloggerImageUrl(
          cleaned
        );

      if (!normalized) {
        continue;
      }

      if (
        isIncompleteBloggerUrl(
          normalized
        )
      ) {
        continue;
      }

      results.push(
        normalized
      );
    }
  }

  return [
    ...new Set(
      results
    ),
  ];
}

// ============================================================
// Extract image candidates from HTML
// ============================================================

function extractImageCandidatesFromRawHtml(
  html,
  sourcePrefix = "article"
) {
  const candidates =
    [];

  if (!html) {
    return candidates;
  }

  const decoded =
    decodeRepeated(
      html
    );

  // ----------------------------------------------------------
  // <img>
  // ----------------------------------------------------------

  const imgTags =
    decoded.match(
      /<img\b[^>]*>/gi
    ) || [];

  for (
    let index = 0;
    index < imgTags.length;
    index++
  ) {
    const tag =
      imgTags[index];

    const tagContext =
      tag.slice(
        0,
        1200
      );

    // --------------------------------------------------------
    // Direct image attributes
    // --------------------------------------------------------

    for (
      const attribute
      of IMAGE_ATTRIBUTES
    ) {
      const value =
        extractAttribute(
          tag,
          attribute
        );

      if (!value) {
        continue;
      }

      const isSrcset =
        /srcset/i.test(
          attribute
        );

      const values =
        isSrcset
          ? extractSrcset(
              value
            )
          : [value];

      for (
        const raw
        of values
      ) {
        const cleaned =
          cleanCandidateRawUrl(
            raw
          );

        if (!cleaned) {
          continue;
        }

        const normalized =
          normalizeBloggerImageUrl(
            cleaned
          );

        if (!normalized) {
          continue;
        }

        /*
         * A bare Blogger resize URL is not useful.
         *
         * Example:
         * /s1600/
         *
         * It will be recovered from a nearby anchor
         * or another data-* attribute below.
         */

        if (
          isIncompleteBloggerUrl(
            normalized
          )
        ) {
          continue;
        }

        if (
          !looksLikeImageCandidateUrl(
            normalized
          )
        ) {
          continue;
        }

        const source =
          sourcePrefix ===
          "feed"
            ? "feed-content"
            : isSrcset
              ? "article-srcset"
              : "article-img";

        candidates.push({
          url:
            normalized,
          source,
          score:
            scoreImageCandidate(
              normalized,
              source,
              tagContext
            ),
          tagIndex:
            index,
        });
      }
    }

    // --------------------------------------------------------
    // Googleusercontent URLs inside tag
    // --------------------------------------------------------

    for (
      const rawUrl
      of extractGoogleusercontentUrls(
        tag
      )
    ) {
      if (
        !looksLikeImageCandidateUrl(
          rawUrl
        )
      ) {
        continue;
      }

      candidates.push({
        url:
          rawUrl,
        source:
          sourcePrefix ===
          "feed"
            ? "feed-content"
            : "article-img",
        score:
          scoreImageCandidate(
            rawUrl,
            sourcePrefix ===
              "feed"
              ? "feed-content"
              : "article-img",
            tagContext
          ) + 10,
        tagIndex:
          index,
      });
    }

    // --------------------------------------------------------
    // IMPORTANT: recover image from data-filename / filename
    // --------------------------------------------------------

    const filename =
      extractAttribute(
        tag,
        "data-filename"
      ) ||
      extractAttribute(
        tag,
        "data-file-name"
      ) ||
      extractAttribute(
        tag,
        "data-name"
      );

    if (
      filename
    ) {
      const allAttributes =
        extractAllAttributes(
          tag
        );

      for (
        const attr
        of allAttributes
      ) {
        const attrValue =
          attr.value;

        if (
          !/googleusercontent\.com/i.test(
            attrValue
          )
        ) {
          continue;
        }

        const normalized =
          normalizeBloggerImageUrl(
            attrValue
          );

        if (!normalized) {
          continue;
        }

        if (
          !isIncompleteBloggerUrl(
            normalized
          )
        ) {
          candidates.push({
            url:
              normalized,
            source:
              "article-img",
            score:
              scoreImageCandidate(
                normalized,
                "article-img",
                tag
              ) + 5,
            tagIndex:
              index,
          });
        }
      }
    }

    // --------------------------------------------------------
    // Recover the nearest <a href> around this <img>
    // --------------------------------------------------------

    const before =
      decoded.slice(
        Math.max(
          0,
          decoded.indexOf(
            tag
          ) - 3000
        ),
        decoded.indexOf(
          tag
        )
      );

    const afterStart =
      decoded.indexOf(
        tag
      ) + tag.length;

    const after =
      decoded.slice(
        afterStart,
        Math.min(
          decoded.length,
          afterStart + 3000
        )
      );

    const surrounding =
      `${before}${tag}${after}`;

    const anchorRegex =
      /<a\b[^>]*>/gi;

    let anchorMatch;

    while (
      (
        anchorMatch =
          anchorRegex.exec(
            surrounding
          )
      ) !== null
    ) {
      const anchorTag =
        anchorMatch[0];

      const href =
        extractAttribute(
          anchorTag,
          "href"
        ) ||
        extractAttribute(
          anchorTag,
          "data-href"
        ) ||
        extractAttribute(
          anchorTag,
          "data-url"
        );

      if (!href) {
        continue;
      }

      const normalized =
        normalizeBloggerImageUrl(
          cleanCandidateRawUrl(
            href
          )
        );

      if (!normalized) {
        continue;
      }

      if (
        isIncompleteBloggerUrl(
          normalized
        )
      ) {
        continue;
      }

      if (
        !looksLikeImageCandidateUrl(
          normalized
        )
      ) {
        continue;
      }

      candidates.push({
        url:
          normalized,
        source:
          sourcePrefix ===
          "feed"
            ? "feed-content"
            : "article-anchor",
        score:
          scoreImageCandidate(
            normalized,
            sourcePrefix ===
              "feed"
              ? "feed-content"
              : "article-anchor",
            anchorTag
          ),
        tagIndex:
          index,
      });
    }
  }

  // ----------------------------------------------------------
  // <source>
  // ----------------------------------------------------------

  const sourceTags =
    decoded.match(
      /<source\b[^>]*>/gi
    ) || [];

  for (
    const tag
    of sourceTags
  ) {
    for (
      const attribute
      of [
        "src",
        "data-src",
        "srcset",
        "data-srcset",
      ]
    ) {
      const value =
        extractAttribute(
          tag,
          attribute
        );

      if (!value) {
        continue;
      }

      const values =
        /srcset/i.test(
          attribute
        )
          ? extractSrcset(
              value
            )
          : [value];

      for (
        const raw
        of values
      ) {
        const normalized =
          normalizeBloggerImageUrl(
            cleanCandidateRawUrl(
              raw
            )
          );

        if (!normalized) {
          continue;
        }

        if (
          isIncompleteBloggerUrl(
            normalized
          )
        ) {
          continue;
        }

        if (
          !looksLikeImageCandidateUrl(
            normalized
          )
        ) {
          continue;
        }

        candidates.push({
          url:
            normalized,
          source:
            sourcePrefix ===
            "feed"
              ? "feed-content"
              : "article-source",
          score:
            scoreImageCandidate(
              normalized,
              sourcePrefix ===
                "feed"
                ? "feed-content"
                : "article-source",
              tag
            ),
        });
      }
    }
  }

  // ----------------------------------------------------------
  // CSS url(...)
  // ----------------------------------------------------------

  const cssRegex =
    /url\(\s*(['"]?)(https?:\/\/[^'")\s]+)\1\s*\)/gi;

  for (
    const match
    of decoded.matchAll(
      cssRegex
    )
  ) {
    const normalized =
      normalizeBloggerImageUrl(
        cleanCandidateRawUrl(
          match[2]
        )
      );

    if (!normalized) {
      continue;
    }

    if (
      isIncompleteBloggerUrl(
        normalized
      )
    ) {
      continue;
    }

    if (
      !looksLikeImageCandidateUrl(
        normalized
      )
    ) {
      continue;
    }

    candidates.push({
      url:
        normalized,
      source:
        sourcePrefix ===
        "feed"
          ? "feed-content"
          : "article-css",
      score:
        scoreImageCandidate(
          normalized,
          sourcePrefix ===
            "feed"
            ? "feed-content"
            : "article-css",
          match[0]
        ),
    });
  }

  // ----------------------------------------------------------
  // Raw Googleusercontent
  // ----------------------------------------------------------

  for (
    const raw
    of extractGoogleusercontentUrls(
      decoded
    )
  ) {
    if (
      !looksLikeImageCandidateUrl(
        raw
      )
    ) {
      continue;
    }

    candidates.push({
      url:
        raw,
      source:
        sourcePrefix ===
        "feed"
          ? "feed-content"
          : "article-raw",
      score:
        scoreImageCandidate(
          raw,
          sourcePrefix ===
            "feed"
            ? "feed-content"
            : "article-raw",
          raw
        ),
    });
  }

  return dedupeCandidates(
    candidates
  );
}

// ============================================================
// Feed XML helpers
// ============================================================

function parseXmlEntries(
  xml
) {
  const entries =
    [];

  const regex =
    /<entry\b[\s\S]*?<\/entry>/gi;

  for (
    const match
    of xml.matchAll(
      regex
    )
  ) {
    entries.push(
      match[0]
    );
  }

  return entries;
}

function xmlTagValue(
  xml,
  tagName
) {
  const escaped =
    tagName.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

  const regex =
    new RegExp(
      `<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`,
      "i"
    );

  const match =
    xml.match(
      regex
    );

  if (!match) {
    return "";
  }

  let value =
    match[1];

  value =
    value.replace(
      /<!\[CDATA\[([\s\S]*?)\]\]>/g,
      "$1"
    );

  return decodeRepeated(
    value
  ).trim();
}

function xmlAttrValues(
  xml,
  tagName,
  attrName
) {
  const values =
    [];

  const escapedTag =
    tagName.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

  const escapedAttr =
    attrName.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

  const regex =
    new RegExp(
      `<${escapedTag}\\b[^>]*\\b${escapedAttr}\\s*=\\s*["']([^"']+)["'][^>]*>`,
      "gi"
    );

  for (
    const match
    of xml.matchAll(
      regex
    )
  ) {
    values.push(
      decodeRepeated(
        match[1]
      )
    );
  }

  return [
    ...new Set(
      values
    ),
  ];
}

// ============================================================
// Parse feed entry
// ============================================================

function parseFeedEntry(
  xmlEntry,
  index
) {
  const title =
    cleanText(
      xmlTagValue(
        xmlEntry,
        "title"
      )
    );

  const published =
    xmlTagValue(
      xmlEntry,
      "published"
    ) ||
    xmlTagValue(
      xmlEntry,
      "updated"
    );

  const content =
    xmlTagValue(
      xmlEntry,
      "content"
    );

  const summary =
    xmlTagValue(
      xmlEntry,
      "summary"
    );

  const links =
    [
      ...xmlEntry.matchAll(
        /<link\b([^>]*)\/?>/gi
      ),
    ];

  let postUrl =
    "";

  for (
    const match
    of links
  ) {
    const attrs =
      match[1] || "";

    const relMatch =
      attrs.match(
        /\brel\s*=\s*["']([^"']+)["']/i
      );

    const hrefMatch =
      attrs.match(
        /\bhref\s*=\s*["']([^"']+)["']/i
      );

    if (!hrefMatch) {
      continue;
    }

    const rel =
      relMatch?.[1] ||
      "";

    const href =
      decodeRepeated(
        hrefMatch[1]
      );

    if (
      rel ===
      "alternate"
    ) {
      postUrl =
        href;

      break;
    }

    if (!postUrl) {
      postUrl =
        href;
    }
  }

  const categories =
    [
      ...xmlEntry.matchAll(
        /<category\b[^>]*\bterm\s*=\s*["']([^"']+)["'][^>]*\/?>/gi
      ),
    ].map(
      (match) =>
        decodeRepeated(
          match[1]
        )
    );

  // ----------------------------------------------------------
  // media:thumbnail
  // ----------------------------------------------------------

  const thumbnailUrls =
    xmlAttrValues(
      xmlEntry,
      "media:thumbnail",
      "url"
    );

  // ----------------------------------------------------------
  // media:content
  // ----------------------------------------------------------

  const mediaContentUrls =
    xmlAttrValues(
      xmlEntry,
      "media:content",
      "url"
    );

  // Some feeds expose media:content under a slightly
  // different serialized namespace form.
  const mediaContentUrls2 =
    xmlAttrValues(
      xmlEntry,
      "media$content",
      "url"
    );

  const mediaUrls =
    [
      ...new Set([
        ...mediaContentUrls,
        ...mediaContentUrls2,
      ]),
    ];

  const entryObject = {
    title,
    published,
    url:
      postUrl,
    content: {
      $t:
        content,
    },
    summary: {
      $t:
        summary,
    },
  };

  if (
    thumbnailUrls.length
  ) {
    entryObject.media$thumbnail =
      {
        url:
          thumbnailUrls[0],
      };
  }

  if (
    mediaUrls.length
  ) {
    entryObject.media$group =
      {
        "media$content":
          mediaUrls.map(
            (url) => ({
              url,
            })
          ),
      };
  }

  return {
    index,
    title,
    url:
      postUrl,
    published,
    date:
      published
        ? safeIsoDate(
            published
          )
        : "",
    excerpt:
      cleanText(
        summary ||
          content
      ).slice(
        0,
        300
      ),
    categories,
    entry:
      entryObject,
  };
}

function safeIsoDate(
  value
) {
  try {
    return new Date(
      value
    ).toISOString();
  } catch {
    return "";
  }
}

// ============================================================
// Feed image extraction
// ============================================================

function extractFeedMediaCandidates(
  entry
) {
  const candidates =
    [];

  // ----------------------------------------------------------
  // media:thumbnail
  // ----------------------------------------------------------

  const thumbnail =
    entry?.media$thumbnail?.url ||
    entry?.[
      "media$thumbnail"
    ]?.url;

  if (thumbnail) {
    const normalized =
      normalizeBloggerImageUrl(
        thumbnail
      );

    if (
      normalized &&
      !isIncompleteBloggerUrl(
        normalized
      ) &&
      looksLikeImageCandidateUrl(
        normalized
      )
    ) {
      candidates.push({
        url:
          normalized,
        source:
          "feed-thumbnail",
        score:
          scoreImageCandidate(
            normalized,
            "feed-thumbnail",
            "media:thumbnail"
          ),
      });
    }
  }

  // ----------------------------------------------------------
  // media:content
  // ----------------------------------------------------------

  const mediaGroup =
    entry?.media$group?.[
      "media$content"
    ] ||
    entry?.[
      "media$group"
    ]?.[
      "media$content"
    ] ||
    [];

  const mediaItems =
    Array.isArray(
      mediaGroup
    )
      ? mediaGroup
      : [mediaGroup];

  for (
    const media
    of mediaItems
  ) {
    if (
      !media?.url
    ) {
      continue;
    }

    const normalized =
      normalizeBloggerImageUrl(
        media.url
      );

    if (
      !normalized ||
      isIncompleteBloggerUrl(
        normalized
      )
    ) {
      continue;
    }

    if (
      !looksLikeImageCandidateUrl(
        normalized
      )
    ) {
      continue;
    }

    candidates.push({
      url:
        normalized,
      source:
        "feed-media",
      score:
        scoreImageCandidate(
          normalized,
          "feed-media",
          "media:content"
        ),
    });
  }

  // ----------------------------------------------------------
  // content / summary
  // ----------------------------------------------------------

  const fragments =
    [];

  if (
    entry?.content?.$t
  ) {
    fragments.push(
      entry.content.$t
    );
  }

  if (
    entry?.summary?.$t
  ) {
    fragments.push(
      entry.summary.$t
    );
  }

  for (
    const fragment
    of fragments
  ) {
    candidates.push(
      ...extractImageCandidatesFromRawHtml(
        fragment,
        "feed"
      )
    );
  }

  return dedupeCandidates(
    candidates
  );
}

// ============================================================
// HTTP fetch
// ============================================================

function buildHeaders(
  kind = "html"
) {
  const headers = {
    "User-Agent":
      USER_AGENT,
    "Accept-Language":
      "en-US,en;q=0.9",
    "Cache-Control":
      "no-cache",
  };

  if (
    kind === "feed"
  ) {
    headers.Accept =
      "application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8";
  } else if (
    kind === "image"
  ) {
    headers.Accept =
      "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8";
    headers.Referer =
      BLOG_URL;
  } else {
    headers.Accept =
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
  }

  return headers;
}

async function fetchResponse(
  url,
  {
    retries = 3,
    timeout = FETCH_TIMEOUT,
    kind = "html",
  } = {}
) {
  let lastError =
    null;

  for (
    let attempt = 0;
    attempt <= retries;
    attempt++
  ) {
    let timer;

    try {
      const controller =
        new AbortController();

      timer =
        setTimeout(
          () =>
            controller.abort(),
          timeout
        );

      const response =
        await fetch(
          url,
          {
            headers:
              buildHeaders(
                kind
              ),
            redirect:
              "follow",
            signal:
              controller.signal,
          }
        );

      clearTimeout(
        timer
      );

      if (
        response.ok
      ) {
        return response;
      }

      const status =
        response.status;

      const retryable =
        status === 429 ||
        status === 408 ||
        status === 425 ||
        status >= 500;

      if (
        retryable &&
        attempt < retries
      ) {
        let wait =
          1200 *
          Math.pow(
            2,
            attempt
          );

        const retryAfter =
          response.headers.get(
            "retry-after"
          );

        if (
          retryAfter
        ) {
          const seconds =
            Number(
              retryAfter
            );

          if (
            Number.isFinite(
              seconds
            )
          ) {
            wait =
              Math.max(
                wait,
                seconds *
                  1000
              );
          }
        }

        warn(
          `HTTP ${status} for ${url} - retrying in ${wait}ms`
        );

        await sleep(
          wait
        );

        continue;
      }

      throw new Error(
        `HTTP ${status} ${response.statusText}`
      );
    } catch (error) {
      if (timer) {
        clearTimeout(
          timer
        );
      }

      lastError =
        error;

      if (
        attempt < retries
      ) {
        const wait =
          1000 *
          Math.pow(
            2,
            attempt
          );

        warn(
          `Fetch failed: ${url} - retrying in ${wait}ms`
        );

        await sleep(
          wait
        );

        continue;
      }
    }
  }

  throw (
    lastError ||
    new Error(
      `Failed to fetch ${url}`
    )
  );
}

async function fetchText(
  url,
  options = {}
) {
  const response =
    await fetchResponse(
      url,
      {
        ...options,
        kind:
          options.kind ||
          "html",
      }
    );

  return await response.text();
}

async function fetchBinary(
  url,
  {
    retries = 2,
    timeout = FETCH_TIMEOUT,
  } = {}
) {
  const response =
    await fetchResponse(
      url,
      {
        retries,
        timeout,
        kind:
          "image",
      }
    );

  const arrayBuffer =
    await response.arrayBuffer();

  return {
    buffer:
      Buffer.from(
        arrayBuffer
      ),
    contentType:
      response.headers.get(
        "content-type"
      ) || "",
    finalUrl:
      response.url ||
      url,
  };
}

// ============================================================
// ImageMagick
// ============================================================

function commandExists(
  command
) {
  return new Promise(
    (resolve) => {
      execFile(
        command,
        ["-version"],
        {
          timeout:
            10000,
        },
        (error) => {
          resolve(
            !error
          );
        }
      );
    }
  );
}

function runCommand(
  command,
  args,
  options = {}
) {
  return new Promise(
    (resolve, reject) => {
      execFile(
        command,
        args,
        {
          timeout:
            options.timeout ||
            30000,
          maxBuffer:
            options.maxBuffer ||
            1024 * 1024,
          encoding:
            options.encoding ??
            "utf8",
        },
        (
          error,
          stdout,
          stderr
        ) => {
          if (error) {
            error.stdout =
              stdout;
            error.stderr =
              stderr;
            reject(
              error
            );
            return;
          }

          resolve({
            stdout,
            stderr,
          });
        }
      );
    }
  );
}

async function detectImageMagick() {
  let versionOutput =
    "";

  if (
    await commandExists(
      "magick"
    )
  ) {
    try {
      const result =
        await runCommand(
          "magick",
          ["-version"]
        );

      versionOutput =
        String(
          result.stdout
        );

      const match =
        versionOutput.match(
          /ImageMagick\s+(\d+)/i
        );

      const major =
        match
          ? Number(
              match[1]
            )
          : 7;

      /*
       * ImageMagick 7:
       *   magick identify ...
       *
       * ImageMagick 6:
       *   identify ...
       *   convert ...
       *
       * The GitHub runner may have a "magick" shim pointing
       * to ImageMagick 6 convert. Never call:
       *
       *   magick identify
       *
       * when major === 6.
       */

      if (
        major >= 7
      ) {
        IMAGE_MAGICK = {
          identify:
            "magick",
          convert:
            "magick",
          version:
            versionOutput.trim(),
          major,
        };

        return;
      }
    } catch {
      // Continue to direct commands.
    }
  }

  if (
    await commandExists(
      "identify"
    ) &&
    await commandExists(
      "convert"
    )
  ) {
    const result =
      await runCommand(
        "identify",
        ["-version"]
      );

    versionOutput =
      String(
        result.stdout
      );

    const match =
      versionOutput.match(
        /ImageMagick\s+(\d+)/i
      );

    IMAGE_MAGICK = {
      identify:
        "identify",
      convert:
        "convert",
      version:
        versionOutput.trim(),
      major:
        match
          ? Number(
              match[1]
            )
          : 6,
    };

    return;
  }

  throw new Error(
    "ImageMagick identify/convert was not found."
  );
}

// ============================================================
// Image validation
// ============================================================

function contentTypeLooksLikeImage(
  contentType
) {
  if (!contentType) {
    return false;
  }

  const normalized =
    contentType
      .split(";")[0]
      .trim()
      .toLowerCase();

  return IMAGE_CONTENT_TYPES.includes(
    normalized
  );
}

function bufferLooksLikeImage(
  buffer
) {
  if (
    !buffer ||
    buffer.length < 12
  ) {
    return false;
  }

  // JPEG
  if (
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return true;
  }

  // PNG
  if (
    buffer
      .subarray(
        0,
        8
      )
      .equals(
        Buffer.from([
          0x89,
          0x50,
          0x4e,
          0x47,
          0x0d,
          0x0a,
          0x1a,
          0x0a,
        ])
      )
  ) {
    return true;
  }

  // GIF
  const gif =
    buffer
      .subarray(
        0,
        6
      )
      .toString(
        "ascii"
      );

  if (
    gif ===
      "GIF87a" ||
    gif ===
      "GIF89a"
  ) {
    return true;
  }

  // WEBP
  if (
    buffer
      .subarray(
        0,
        4
      )
      .toString(
        "ascii"
      ) ===
      "RIFF" &&
    buffer
      .subarray(
        8,
        12
      )
      .toString(
        "ascii"
      ) ===
      "WEBP"
  ) {
    return true;
  }

  // BMP
  if (
    buffer
      .subarray(
        0,
        2
      )
      .toString(
        "ascii"
      ) ===
      "BM"
  ) {
    return true;
  }

  // TIFF
  const tiff =
    buffer
      .subarray(
        0,
        4
      )
      .toString(
        "ascii"
      );

  if (
    tiff ===
      "II*\0" ||
    tiff ===
      "MM\0*"
  ) {
    return true;
  }

  // AVIF / HEIF
  if (
    buffer.length >= 16
  ) {
    const box =
      buffer
        .subarray(
          4,
          12
        )
        .toString(
          "ascii"
        );

    if (
      box ===
      "ftyp"
    ) {
      const brand =
        buffer
          .subarray(
            8,
            12
          )
          .toString(
            "ascii"
          );

      if (
        /avif|avis|heic|heix|hevc|mif1/i.test(
          brand
        )
      ) {
        return true;
      }
    }
  }

  return false;
}

async function validateImageBuffer(
  buffer,
  tempFile
) {
  if (
    !buffer ||
    buffer.length <
      MIN_IMAGE_BYTES
  ) {
    return {
      valid:
        false,
      reason:
        `image too small (${buffer?.length || 0} bytes)`,
    };
  }

  await fs.writeFile(
    tempFile,
    buffer
  );

  try {
    const result =
      await runCommand(
        IMAGE_MAGICK.identify,
        [
          "-format",
          "%m|%wx%h|%[mime]",
          tempFile,
        ],
        {
          timeout:
            30000,
        }
      );

    const output =
      String(
        result.stdout
      ).trim();

    const parts =
      output.split("|");

    const format =
      parts[0] ||
      "";

    const dimensions =
      parts[1] ||
      "";

    const mime =
      parts[2] ||
      "";

    const dimensionMatch =
      dimensions.match(
        /^(\d+)x(\d+)$/
      );

    const width =
      dimensionMatch
        ? Number(
            dimensionMatch[1]
          )
        : 0;

    const height =
      dimensionMatch
        ? Number(
            dimensionMatch[2]
          )
        : 0;

    if (
      !width ||
      !height
    ) {
      return {
        valid:
          false,
        reason:
          "ImageMagick could not determine dimensions",
      };
    }

    if (
      width <
        MIN_IMAGE_WIDTH ||
      height <
        MIN_IMAGE_HEIGHT
    ) {
      return {
        valid:
          false,
        reason:
          `image too small (${width}x${height})`,
        width,
        height,
        format,
        mime,
      };
    }

    return {
      valid:
        true,
      width,
      height,
      format,
      mime,
    };
  } catch (error) {
    return {
      valid:
        false,
      reason:
        `ImageMagick validation failed: ${
          error.message
        }`,
    };
  }
}

// ============================================================
// Perceptual fingerprint
// ============================================================

async function perceptualFingerprint(
  file
) {
  /*
   * 16x16 grayscale fingerprint.
   *
   * This catches visually identical images that have different
   * file sizes / encodings.
   */

  try {
    const result =
      await runCommand(
        IMAGE_MAGICK.convert,
        [
          file,
          "-colorspace",
          "Gray",
          "-resize",
          "16x16!",
          "-depth",
          "8",
          "txt:-",
        ],
        {
          timeout:
            30000,
          maxBuffer:
            1024 * 1024 * 4,
        }
      );

    const text =
      String(
        result.stdout
      );

    const values =
      [];

    for (
      const line
      of text.split("\n")
    ) {
      const match =
        line.match(
          /:\s*\(\s*(\d+)/ 
        );

      if (
        match
      ) {
        values.push(
          Number(
            match[1]
          )
        );
      }
    }

    if (
      values.length <
      100
    ) {
      return null;
    }

    return values.join(
      ","
    );
  } catch {
    return null;
  }
}

function hammingLikeDifference(
  a,
  b
) {
  if (
    !a ||
    !b
  ) {
    return 1;
  }

  const aa =
    a
      .split(",")
      .map(Number);

  const bb =
    b
      .split(",")
      .map(Number);

  const length =
    Math.min(
      aa.length,
      bb.length
    );

  if (!length) {
    return 1;
  }

  let diff =
    0;

  for (
    let i = 0;
    i < length;
    i++
  ) {
    diff +=
      Math.abs(
        aa[i] -
          bb[i]
      );
  }

  const max =
    length * 255;

  return max
    ? diff / max
    : 1;
}

// ============================================================
// Download and validate one candidate
// ============================================================

async function downloadAndValidateCandidate(
  candidate,
  postIndex
) {
  const tempFile =
    path.join(
      IMAGE_DIR,
      `.candidate-${postIndex}-${crypto.randomBytes(6).toString("hex")}.img`
    );

  try {
    const result =
      await fetchBinary(
        candidate.url,
        {
          retries:
            2,
          timeout:
            FETCH_TIMEOUT,
        }
      );

    const {
      buffer,
      contentType,
      finalUrl,
    } = result;

    if (
      buffer.length <
      MIN_IMAGE_BYTES
    ) {
      return {
        valid:
          false,
        reason:
          `download too small (${buffer.length} bytes)`,
      };
    }

    /*
     * Do not reject solely because Content-Type is missing.
     *
     * Some CDNs incorrectly return application/octet-stream.
     * ImageMagick remains the final authority.
     */

    const contentTypeImage =
      contentTypeLooksLikeImage(
        contentType
      );

    const signatureImage =
      bufferLooksLikeImage(
        buffer
      );

    if (
      !contentTypeImage &&
      !signatureImage
    ) {
      /*
       * Still allow ImageMagick to decide. This handles
       * unusual image formats and CDN mislabeling.
       */
    }

    const validation =
      await validateImageBuffer(
        buffer,
        tempFile
      );

    if (
      !validation.valid
    ) {
      return {
        valid:
          false,
        reason:
          validation.reason,
        finalUrl,
        contentType,
      };
    }

    const sha256 =
      crypto
        .createHash(
          "sha256"
        )
        .update(
          buffer
        )
        .digest(
          "hex"
        );

    const fingerprint =
      await perceptualFingerprint(
        tempFile
      );

    return {
      valid:
        true,
      buffer,
      finalUrl,
      contentType,
      sha256,
      fingerprint,
      width:
        validation.width,
      height:
        validation.height,
      format:
        validation.format,
      mime:
        validation.mime,
    };
  } catch (error) {
    return {
      valid:
        false,
      reason:
        error.message,
    };
  } finally {
    await fs.rm(
      tempFile,
      {
        force:
          true,
      }
    );
  }
}

// ============================================================
// Exact post container
// ============================================================

function normalizeCompareText(
  value
) {
  return cleanText(
    value
  )
    .toLowerCase()
    .replace(
      /[^a-z0-9가-힣]+/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

function extractMetaContent(
  html,
  property
) {
  const regex =
    new RegExp(
      `<meta\\b[^>]*(?:property|name)\\s*=\\s*["']${property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*\\bcontent\\s*=\\s*["']([^"']+)["'][^>]*>`,
      "i"
    );

  const match =
    html.match(
      regex
    );

  return match
    ? decodeRepeated(
        match[1]
      )
    : "";
}

function findExactPostContainer(
  html,
  post
) {
  const title =
    normalizeCompareText(
      post.title
    );

  const postUrl =
    normalizeUrl(
      post.url
    );

  const urlPath =
    postUrl
      ? new URL(
          postUrl
        ).pathname
      : "";

  const candidates =
    [];

  // ----------------------------------------------------------
  // Strategy 1: Blogger post body class
  // ----------------------------------------------------------

  const postBlockRegex =
    /<(?:div|article|section)\b[^>]*(?:class|id)\s*=\s*["'][^"']*(?:post-body|post-content|post-body-container|hentry|blog-post|post)[^"']*["'][^>]*>[\s\S]*?<\/(?:div|article|section)>/gi;

  for (
    const match
    of html.matchAll(
      postBlockRegex
    )
  ) {
    const block =
      match[0];

    const normalized =
      normalizeCompareText(
        block
      );

    let score =
      80;

    if (
      title &&
      normalized.includes(
        title
      )
    ) {
      score +=
        100;
    }

    if (
      urlPath &&
      block.includes(
        urlPath
      )
    ) {
      score +=
        80;
    }

    if (
      /post-body/i.test(
        block
      )
    ) {
      score +=
        80;
    }

    candidates.push({
      html:
        block,
      score,
      method:
        "class-block",
    });
  }

  // ----------------------------------------------------------
  // Strategy 2: Find title and expand around it
  // ----------------------------------------------------------

  if (
    title
  ) {
    const normalizedHtml =
      normalizeCompareText(
        html
      );

    const titleIndex =
      normalizedHtml.indexOf(
        title
      );

    if (
      titleIndex >= 0
    ) {
      /*
       * Because normalized text has a different length from HTML,
       * use a direct cleaned title search as a second attempt.
       */

      const escapedTitle =
        post.title
          .trim()
          .replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
          );

      const titleRegex =
        new RegExp(
          escapedTitle,
          "i"
        );

      const match =
        titleRegex.exec(
          html
        );

      if (match) {
        const start =
          Math.max(
            0,
            match.index -
              50000
          );

        const end =
          Math.min(
            html.length,
            match.index +
              250000
          );

        candidates.push({
          html:
            html.slice(
              start,
              end
            ),
          score:
            120,
          method:
            "title-window",
        });
      }
    }
  }

  // ----------------------------------------------------------
  // Strategy 3: post URL
  // ----------------------------------------------------------

  if (
    urlPath
  ) {
    const index =
      html.indexOf(
        urlPath
      );

    if (
      index >= 0
    ) {
      const start =
        Math.max(
          0,
          index -
            50000
        );

      const end =
        Math.min(
          html.length,
          index +
            250000
        );

      candidates.push({
        html:
          html.slice(
            start,
            end
          ),
        score:
          110,
        method:
          "url-window",
      });
    }
  }

  if (
    !candidates.length
  ) {
    return null;
  }

  candidates.sort(
    (a, b) =>
      b.score -
      a.score
  );

  return (
    candidates[0]
  );
}

// ============================================================
// Page metadata
// ============================================================

function extractPageMetadata(
  html
) {
  const title =
    cleanText(
      (
        html.match(
          /<title\b[^>]*>([\s\S]*?)<\/title>/i
        ) || []
      )[1] || ""
    );

  const description =
    extractMetaContent(
      html,
      "description"
    );

  const ogImage =
    extractMetaContent(
      html,
      "og:image"
    ) ||
    extractMetaContent(
      html,
      "twitter:image"
    );

  const h1 =
    cleanText(
      (
        html.match(
          /<h1\b[^>]*>([\s\S]*?)<\/h1>/i
        ) || []
      )[1] || ""
    );

  return {
    title,
    description,
    ogImage:
      normalizeBloggerImageUrl(
        ogImage
      ),
    pageHeading:
      h1,
  };
}

// ============================================================
// Feed URL generation
// ============================================================

function buildFeedUrls(
  blogUrl
) {
  const base =
    new URL(
      blogUrl
    );

  const origin =
    `${base.protocol}//${base.host}`;

  return [
    `${origin}/feeds/posts/default?alt=atom&max-results=10`,
    `${origin}/feeds/posts/default?alt=json&max-results=10`,
    `${origin}/feeds/posts/default?max-results=10`,
  ];
}

// ============================================================
// Fetch feed
// ============================================================

async function fetchBloggerFeed(
  blogUrl
) {
  const feedUrls =
    buildFeedUrls(
      blogUrl
    );

  let lastError =
    null;

  for (
    const feedUrl
    of feedUrls
  ) {
    try {
      const xml =
        await fetchText(
          feedUrl,
          {
            retries:
              3,
            timeout:
              FETCH_TIMEOUT,
            kind:
              "feed",
          }
        );

      const entries =
        parseXmlEntries(
          xml
        );

      if (
        entries.length
      ) {
        return {
          xml,
          feedUrl,
          entries,
        };
      }

      /*
       * The second endpoint may return JSON. Try to handle it
       * as a fallback below.
       */

      try {
        const json =
          JSON.parse(
            xml
          );

        if (
          json?.feed?.entry
        ) {
          return {
            json,
            feedUrl,
            entries:
              json.feed.entry,
          };
        }
      } catch {
        // Not JSON.
      }
    } catch (error) {
      lastError =
        error;

      warn(
        `Feed failed: ${feedUrl}: ${error.message}`
      );
    }
  }

  throw (
    lastError ||
    new Error(
      "Unable to fetch Blogger feed."
    )
  );
}

// ============================================================
// JSON feed conversion
// ============================================================

function parseJsonFeedEntries(
  entries
) {
  return entries.map(
    (
      item,
      index
    ) => {
      const title =
        cleanText(
          item.title?.$t ||
          item.title ||
          ""
        );

      const content =
        item.content?.$t ||
        item.content ||
        "";

      const summary =
        item.summary?.$t ||
        item.summary ||
        "";

      let url =
        "";

      const links =
        Array.isArray(
          item.link
        )
          ? item.link
          : [];

      for (
        const link
        of links
      ) {
        if (
          link.rel ===
          "alternate" &&
          link.href
        ) {
          url =
            link.href;

          break;
        }

        if (
          !url &&
          link.href
        ) {
          url =
            link.href;
        }
      }

      const published =
        item.published?.$t ||
        item.published ||
        item.updated?.$t ||
        item.updated ||
        "";

      const categories =
        (
          item.category ||
          []
        ).map(
          (category) =>
            category.term ||
            category
        );

      const mediaThumbnail =
        item.media$thumbnail?.url ||
        item.media$thumbnail?.[
          "$t"
        ] ||
        "";

      const mediaContent =
        item.media$group?.[
          "media$content"
        ] ||
        [];

      return {
        index:
          index + 1,
        title,
        url,
        published,
        date:
          safeIsoDate(
            published
          ),
        excerpt:
          cleanText(
            summary ||
              content
          ).slice(
            0,
            300
          ),
        categories,
        entry:
          {
            title,
            published,
            url,
            content: {
              $t:
                content,
            },
            summary: {
              $t:
                summary,
            },
            ...(mediaThumbnail
              ? {
                  media$thumbnail:
                    {
                      url:
                        mediaThumbnail,
                    },
                }
              : {}),
            ...(mediaContent.length
              ? {
                  media$group:
                    {
                      "media$content":
                        mediaContent,
                    },
                }
              : {}),
          },
      };
    }
  );
}

// ============================================================
// Post-level image selection
// ============================================================

async function selectImageForPost(
  post,
  articleHtml,
  postIndex,
  usedHashes,
  usedFingerprints
) {
  let candidates =
    extractFeedMediaCandidates(
      post.entry
    );

  log(
    `Feed image candidates: ${candidates.length}`
  );

  /*
   * Feed candidate attempt.
   *
   * Important:
   * We actually download and validate candidates here.
   * A URL is not considered a real image until this point.
   */

  if (
    candidates.length
  ) {
    log(
      `Trying ${Math.min(
        candidates.length,
        12
      )} feed candidates...`
    );

    for (
      const candidate
      of candidates.slice(
        0,
        12
      )
    ) {
      log(
        `  Feed candidate score=${candidate.score} source=${candidate.source}`
      );
      log(
        `  ${candidate.url}`
      );

      const result =
        await downloadAndValidateCandidate(
          candidate,
          postIndex
        );

      if (
        !result.valid
      ) {
        log(
          `  Rejected: ${result.reason}`
        );
        continue;
      }

      if (
        usedHashes.has(
          result.sha256
        )
      ) {
        log(
          `  Rejected: exact duplicate`
        );
        continue;
      }

      if (
        result.fingerprint
      ) {
        let duplicate =
          false;

        for (
          const previous
          of usedFingerprints
        ) {
          const difference =
            hammingLikeDifference(
              result.fingerprint,
              previous
            );

          if (
            difference <
            0.035
          ) {
            duplicate =
              true;

            log(
              `  Rejected: perceptual duplicate (difference=${difference.toFixed(
                4
              )})`
            );

            break;
          }
        }

        if (
          duplicate
        ) {
          continue;
        }
      }

      return {
        ...result,
        candidate,
      };
    }
  }

  // ----------------------------------------------------------
  // Article fallback
  // ----------------------------------------------------------

  if (
    !articleHtml
  ) {
    log(
      "Feed candidates failed. Fetching exact article page for fallback..."
    );

    articleHtml =
      await fetchText(
        post.url,
        {
          retries:
            3,
          timeout:
            FETCH_TIMEOUT,
          kind:
            "html",
        }
      );

    log(
      `Article page fetched: ${articleHtml.length} bytes`
    );
  }

  const container =
    findExactPostContainer(
      articleHtml,
      post
    );

  let scopedHtml =
    articleHtml;

  if (
    container
  ) {
    scopedHtml =
      container.html;

    log(
      `Exact post container: FOUND (${container.method}, score=${container.score})`
    );
  } else {
    log(
      "Exact post container: NOT FOUND - using article HTML"
    );
  }

  if (
    scopedHtml.length >
    MAX_ARTICLE_HTML_SCAN
  ) {
    scopedHtml =
      scopedHtml.slice(
        0,
        MAX_ARTICLE_HTML_SCAN
      );
  }

  const imgCount =
    (
      scopedHtml.match(
        /<img\b/gi
      ) || []
    ).length;

  log(
    `Scoped HTML length: ${scopedHtml.length}`
  );

  log(
    `Scoped <img> tags: ${imgCount}`
  );

  candidates =
    extractImageCandidatesFromRawHtml(
      scopedHtml,
      "article"
    );

  log(
    `Page-local image candidates: ${candidates.length}`
  );

  for (
    const candidate
    of candidates.slice(
      0,
      40
    )
  ) {
    log(
      `  Article candidate score=${candidate.score} source=${candidate.source}`
    );

    log(
      `  ${candidate.url}`
    );

    const result =
      await downloadAndValidateCandidate(
        candidate,
        postIndex
      );

    if (
      !result.valid
    ) {
      log(
        `  Rejected: ${result.reason}`
      );
      continue;
    }

    if (
      usedHashes.has(
        result.sha256
      )
    ) {
      log(
        `  Rejected: exact duplicate`
      );
      continue;
    }

    if (
      result.fingerprint
    ) {
      let duplicate =
        false;

      for (
        const previous
        of usedFingerprints
      ) {
        const difference =
          hammingLikeDifference(
            result.fingerprint,
            previous
          );

        if (
          difference <
          0.035
        ) {
          duplicate =
            true;

          log(
            `  Rejected: perceptual duplicate (difference=${difference.toFixed(
              4
            )})`
          );

          break;
        }
      }

      if (
        duplicate
      ) {
        continue;
      }
    }

    return {
      ...result,
      candidate,
    };
  }

  return null;
}

// ============================================================
// Blog identity analysis
// ============================================================

function inferTopics(
  posts
) {
  const text =
    posts
      .map(
        (post) =>
          `${post.title} ${post.excerpt} ${
            post.categories?.join(
              " "
            ) || ""
          }`
      )
      .join(" ")
      .toLowerCase();

  const topics =
    [];

  const keywordGroups = [
    {
      topic:
        "US Stock Market",
      words:
        [
          "nasdaq",
          "nyse",
          "stock",
          "stocks",
          "market",
          "s&p",
          "dow",
          "earnings",
          "shares",
        ],
    },
    {
      topic:
        "Technology",
      words:
        [
          "technology",
          "tech",
          "ai",
          "artificial intelligence",
          "semiconductor",
          "chip",
          "software",
        ],
    },
    {
      topic:
        "Investing",
      words:
        [
          "invest",
          "investing",
          "investor",
          "portfolio",
          "valuation",
          "dividend",
        ],
    },
    {
      topic:
        "Macro Economy",
      words:
        [
          "inflation",
          "fed",
          "interest rate",
          "economy",
          "economic",
          "gdp",
          "jobs",
        ],
    },
  ];

  for (
    const group
    of keywordGroups
  ) {
    const matches =
      group.words.filter(
        (word) =>
          text.includes(
            word
          )
      ).length;

    if (
      matches >= 1
    ) {
      topics.push(
        group.topic
      );
    }
  }

  if (
    !topics.length
  ) {
    topics.push(
      "General News and Analysis"
    );
  }

  return topics;
}

function inferAudience(
  posts
) {
  const text =
    posts
      .map(
        (post) =>
          `${post.title} ${post.excerpt}`
      )
      .join(" ")
      .toLowerCase();

  if (
    /stock|nasdaq|nyse|market|invest|earnings|shares/.test(
      text
    )
  ) {
    return [
      "US stock market readers",
      "retail investors",
      "technology-focused investors",
    ];
  }

  return [
    "general readers",
    "news and analysis readers",
  ];
}

function inferContentStyle(
  posts
) {
  const titles =
    posts.map(
      (post) =>
        post.title
    );

  const questionCount =
    titles.filter(
      (title) =>
        /^(how|what|why|when|where|which)\b/i.test(
          title
        )
    ).length;

  const newsCount =
    titles.filter(
      (title) =>
        /close|market|earnings|shares|stock|news|rises|falls|jumps|drops/i.test(
          title
        )
    ).length;

  if (
    newsCount >=
    Math.ceil(
      posts.length / 2
    )
  ) {
    return "Concise financial news and market analysis";
  }

  if (
    questionCount >=
    Math.ceil(
      posts.length / 2
    )
  ) {
    return "Problem-solving and explanatory content";
  }

  return "Informational articles with concise analysis";
}

// ============================================================
// Main analysis
// ============================================================

async function analyze() {
  log(
    `BLOG ANALYZER v${VERSION}`
  );

  log(
    "Blogger feed-first image extraction"
  );

  log(
    "Exact-post scoped article fallback"
  );

  log(
    "Real-image validation after download"
  );

  log(
    "URL-extension independent image detection"
  );

  log(
    "ImageMagick 6 / 7 compatible"
  );

  log(
    "Exact + perceptual duplicate protection"
  );

  log(
    `Blog URL: ${BLOG_URL}`
  );

  await fs.mkdir(
    IMAGE_DIR,
    {
      recursive:
        true,
    }
  );

  await detectImageMagick();

  log(
    `ImageMagick identify command: ${IMAGE_MAGICK.identify}`
  );

  log(
    `ImageMagick convert command: ${IMAGE_MAGICK.convert}`
  );

  log(
    `ImageMagick: ${IMAGE_MAGICK.version}`
  );

  // ----------------------------------------------------------
  // Feed
  // ----------------------------------------------------------

  const feed =
    await fetchBloggerFeed(
      BLOG_URL
    );

  log(
    "Feed fetched successfully."
  );

  let posts;

  if (
    feed.entries?.length &&
    typeof feed.entries[0] ===
      "string"
  ) {
    posts =
      feed.entries.map(
        (
          xmlEntry,
          index
        ) =>
          parseFeedEntry(
            xmlEntry,
            index + 1
          )
      );
  } else {
    posts =
      parseJsonFeedEntries(
        feed.entries || []
      );
  }

  log(
    `Feed entries: ${posts.length}`
  );

  if (
    posts.length <
    MAX_POSTS
  ) {
    throw new Error(
      `Only ${posts.length} feed entries found. Expected at least ${MAX_POSTS}.`
    );
  }

  posts =
    posts.slice(
      0,
      MAX_POSTS
    );

  // ----------------------------------------------------------
  // Clean previous captures
  // ----------------------------------------------------------

  await fs.rm(
    IMAGE_DIR,
    {
      recursive:
        true,
      force:
        true,
    }
  );

  await fs.mkdir(
    IMAGE_DIR,
    {
      recursive:
        true,
    }
  );

  // ----------------------------------------------------------
  // Process posts
  // ----------------------------------------------------------

  const selectedPosts =
    [];

  const usedHashes =
    new Set();

  const usedFingerprints =
    [];

  for (
    let i = 0;
    i < posts.length;
    i++
  ) {
    const post =
      posts[i];

    log("");
    log(
      `Post ${i + 1}: ${post.title}`
    );

    log(
      `URL: ${post.url}`
    );

    if (
      !post.url
    ) {
      throw new Error(
        `Post ${i + 1} has no URL`
      );
    }

    /*
     * Feed first.
     *
     * Article HTML is NOT fetched unless feed candidates fail.
     */

    let result =
      await selectImageForPost(
        post,
        null,
        i + 1,
        usedHashes,
        usedFingerprints
      );

    if (!result) {
      throw new Error(
        `All image candidates were rejected for Post ${
          i + 1
        }`
      );
    }

    usedHashes.add(
      result.sha256
    );

    if (
      result.fingerprint
    ) {
      usedFingerprints.push(
        result.fingerprint
      );
    }

    const extension =
      imageExtensionFromMime(
        result.mime,
        result.format
      );

    const filename =
      `post-${i + 1}${extension}`;

    const outputFile =
      path.join(
        IMAGE_DIR,
        filename
      );

    await fs.writeFile(
      outputFile,
      result.buffer
    );

    const relativeImage =
      `blog/images/${filename}`;

    log(
      `Selected image: ${result.candidate.url}`
    );

    log(
      `Source: ${result.candidate.source}`
    );

    log(
      `Final URL: ${result.finalUrl}`
    );

    log(
      `Image: ${result.width}x${result.height} ${result.format} ${result.mime}`
    );

    log(
      `Saved: ${relativeImage}`
    );

    selectedPosts.push({
      index:
        i + 1,
      title:
        post.title,
      url:
        post.url,
      published:
        post.published,
      date:
        post.date,
      excerpt:
        post.excerpt,
      categories:
        post.categories,
      localImage:
        relativeImage,
      imageSource:
        result.candidate.source,
    });

    /*
     * Small delay between posts to reduce the chance of Blogger
     * returning 429 when article fallback is needed.
     */
    if (
      i <
      posts.length - 1
    ) {
      await sleep(
        350
      );
    }
  }

  // ----------------------------------------------------------
  // Blog metadata
  // ----------------------------------------------------------

  let homepageHtml =
    "";

  try {
    homepageHtml =
      await fetchText(
        BLOG_URL,
        {
          retries:
            2,
          timeout:
            FETCH_TIMEOUT,
          kind:
            "html",
        }
      );
  } catch (
    error
  ) {
    warn(
      `Homepage metadata fetch failed: ${error.message}`
    );
  }

  const metadata =
    homepageHtml
      ? extractPageMetadata(
          homepageHtml
        )
      : {
          title:
            "",
          description:
            "",
          ogImage:
            "",
          pageHeading:
            "",
        };

  const siteTitle =
    metadata.title ||
    "Funds-Up";

  const description =
    metadata.description ||
    "";

  const topics =
    inferTopics(
      selectedPosts
    );

  const audience =
    inferAudience(
      selectedPosts
    );

  const contentStyle =
    inferContentStyle(
      selectedPosts
    );

  const valueProposition =
    topics.includes(
      "US Stock Market"
    )
      ? "Concise US stock market and technology-focused financial updates"
      : "Concise informational news and analysis";

  const result =
    {
      version:
        4,

      analyzerVersion:
        VERSION,

      capturedAt:
        new Date().toISOString(),

      url:
        BLOG_URL,

      hostname:
        getHost(
          BLOG_URL
        ),

      siteTitle,

      description,

      pageHeading:
        metadata.pageHeading ||
        siteTitle,

      ogImage:
        metadata.ogImage ||
        "",

      language:
        "en",

      postCount:
        selectedPosts.length,

      analysis: {
        identity:
          siteTitle,

        topics,

        audience,

        contentStyle,

        valueProposition,
      },

      posts:
        selectedPosts,
    };

  await fs.writeFile(
    BLOG_JSON,
    JSON.stringify(
      result,
      null,
      2
    ) + "\n",
    "utf8"
  );

  log("");
  log(
    "============================================================"
  );

  log(
    `BLOG ANALYZER v${VERSION} SUCCESS`
  );

  log(
    `Posts captured: ${selectedPosts.length}`
  );

  log(
    `Images captured: ${selectedPosts.length}`
  );

  log(
    `Output: ${BLOG_JSON}`
  );

  log(
    "============================================================"
  );

  return result;
}

// ============================================================
// Image extension
// ============================================================

function imageExtensionFromMime(
  mime,
  format
) {
  const normalized =
    String(
      mime || ""
    )
      .split(";")[0]
      .trim()
      .toLowerCase();

  switch (
    normalized
  ) {
    case "image/jpeg":
    case "image/jpg":
      return ".jpg";

    case "image/png":
      return ".png";

    case "image/webp":
      return ".webp";

    case "image/gif":
      return ".gif";

    case "image/avif":
      return ".avif";

    case "image/bmp":
      return ".bmp";

    case "image/tiff":
      return ".tiff";

    case "image/svg+xml":
      return ".svg";
  }

  const lowerFormat =
    String(
      format || ""
    ).toLowerCase();

  if (
    lowerFormat.includes(
      "jpeg"
    )
  ) {
    return ".jpg";
  }

  if (
    lowerFormat.includes(
      "png"
    )
  ) {
    return ".png";
  }

  if (
    lowerFormat.includes(
      "webp"
    )
  ) {
    return ".webp";
  }

  if (
    lowerFormat.includes(
      "avif"
    )
  ) {
    return ".avif";
  }

  return ".jpg";
}

// ============================================================
// Error handling
// ============================================================

analyze()
  .catch(
    (error) => {
      console.error("");
      console.error(
        `BLOG ANALYZER v${VERSION} FAILED`
      );
      console.error(
        `Error: ${error.message}`
      );

      if (
        error.stack
      ) {
        console.error(
          error.stack
        );
      }

      process.exit(
        1
      );
    }
  );
