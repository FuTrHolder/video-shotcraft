// scripts/capture-blog.mjs
// BLOG ANALYZER v10.8
//
// Blogger blog analyzer
// - Feed-first image extraction
// - Exact-post scoped article fallback
// - Robust <img>, srcset, data-* and raw URL extraction
// - Reject incomplete Blogger URLs such as /s1600/
// - ImageMagick 6 / 7 compatibility
// - Exact duplicate detection
// - Perceptual duplicate detection
// - blog.json generation

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import process from "node:process";
import { execFile } from "node:child_process";

const VERSION = "10.8";

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

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/131.0.0.0 Safari/537.36";

const IMAGE_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".avif",
];

const BAD_IMAGE_PATTERNS = [
  /\/feeds?\//i,
  /\/search\b/i,
  /\/label\//i,
  /\/archive\//i,
  /\.html?(?:[?#]|$)/i,
  /favicon/i,
  /logo/i,
  /icon/i,
  /avatar/i,
  /profile/i,
  /sprite/i,
  /tracking/i,
  /pixel/i,
  /analytics/i,
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
  "data-lazy-srcset",
  "data-srcset",
  "srcset",
];

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

function normalizeUrl(
  raw,
  baseUrl = BLOG_URL
) {
  if (!raw) return null;

  let value = String(raw).trim();

  value =
    decodeHtmlEntities(value);

  value =
    decodeEscapedHtml(value);

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

  if (!value) {
    return null;
  }

  if (
    value.startsWith("data:")
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
    const absolute =
      new URL(
        value,
        baseUrl
      );

    absolute.hash = "";

    return absolute.toString();
  } catch {
    return null;
  }
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

  const host =
    url.hostname.toLowerCase();

  const isBloggerHost =
    host.includes(
      "blogger.googleusercontent.com"
    ) ||
    host.includes(
      "googleusercontent.com"
    ) ||
    host.endsWith(
      ".bp.blogspot.com"
    ) ||
    host.endsWith(
      ".blogspot.com"
    );

  if (!isBloggerHost) {
    return normalized;
  }

  let pathname =
    url.pathname;

  pathname =
    pathname.replace(
      /\/s\d+(?:-[a-z0-9]+)*(?=\/)/i,
      "/s1600"
    );

  pathname =
    pathname.replace(
      /\/w\d+(?:-h\d+)?(?:-[a-z0-9]+)*(?=\/)/i,
      "/s1600"
    );

  pathname =
    pathname.replace(
      /\/h\d+(?:-w\d+)?(?:-[a-z0-9]+)*(?=\/)/i,
      "/s1600"
    );

  pathname =
    pathname.replace(
      /\/w\d+-h\d+(?:-[a-z0-9]+)*(?=\/)/i,
      "/s1600"
    );

  pathname =
    pathname.replace(
      /\/s\d+-h\d+(?:-[a-z0-9]+)*(?=\/)/i,
      "/s1600"
    );

  url.pathname =
    pathname;

  return url.toString();
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

  const host =
    parsed.hostname.toLowerCase();

  if (
    !host.includes(
      "googleusercontent.com"
    ) &&
    !host.endsWith(
      ".blogspot.com"
    ) &&
    !host.endsWith(
      ".bp.blogspot.com"
    )
  ) {
    return false;
  }

  const pathname =
    parsed.pathname;

  // Bare /s1600/ or /s1200/ etc.
  if (
    /\/s\d+(?:-[a-z0-9]+)*\/?$/i.test(
      pathname
    )
  ) {
    return true;
  }

  // Bare /w1200/ etc.
  if (
    /\/w\d+(?:-h\d+)?(?:-[a-z0-9]+)*\/?$/i.test(
      pathname
    )
  ) {
    return true;
  }

  // Bare /h1200/ etc.
  if (
    /\/h\d+(?:-w\d+)?(?:-[a-z0-9]+)*\/?$/i.test(
      pathname
    )
  ) {
    return true;
  }

  // No meaningful path after /img/b/.../
  if (
    /\/img\/b\/[^/]+\/[^/]+\/?$/i.test(
      pathname
    )
  ) {
    return true;
  }

  return false;
}

function looksLikeImageUrl(
  url
) {
  if (!url) {
    return false;
  }

  if (
    url.startsWith("data:")
  ) {
    return false;
  }

  if (
    isIncompleteBloggerUrl(url)
  ) {
    return false;
  }

  const lower =
    url.toLowerCase();

  if (
    BAD_IMAGE_PATTERNS.some(
      (pattern) =>
        pattern.test(lower)
    )
  ) {
    return false;
  }

  if (
    lower.includes(
      "blogger.googleusercontent.com"
    ) ||
    lower.includes(
      "googleusercontent.com"
    )
  ) {
    return true;
  }

  let pathname = "";

  try {
    pathname =
      new URL(url)
        .pathname
        .toLowerCase();
  } catch {
    pathname =
      lower;
  }

  return IMAGE_EXTENSIONS.some(
    (extension) =>
      pathname.endsWith(
        extension
      )
  );
}

function scoreImageUrl(
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

  const lowerContext =
    context.toLowerCase();

  if (
    lower.includes(
      "blogger.googleusercontent.com"
    )
  ) {
    score += 50;
  }

  if (
    lower.includes(
      "googleusercontent.com"
    )
  ) {
    score += 20;
  }

  if (
    /\.(jpg|jpeg|png|webp|avif|gif)(?:[?#]|$)/i.test(
      lower
    )
  ) {
    score += 15;
  }

  if (
    source === "feed-content"
  ) {
    score += 130;
  }

  if (
    source === "feed-media"
  ) {
    score += 125;
  }

  if (
    source === "feed-thumbnail"
  ) {
    score += 120;
  }

  if (
    source === "article-post-body"
  ) {
    score += 115;
  }

  if (
    source === "article-img"
  ) {
    score += 105;
  }

  if (
    source === "article-srcset"
  ) {
    score += 100;
  }

  if (
    source === "article-css"
  ) {
    score += 90;
  }

  if (
    source === "article-raw"
  ) {
    score += 80;
  }

  if (
    lowerContext.includes(
      "thumbnail"
    )
  ) {
    score -= 10;
  }

  if (
    lowerContext.includes(
      "logo"
    )
  ) {
    score -= 100;
  }

  if (
    lowerContext.includes(
      "icon"
    )
  ) {
    score -= 100;
  }

  return score;
}

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
      !looksLikeImageUrl(
        normalized
      )
    ) {
      continue;
    }

    const key =
      normalized;

    const existing =
      map.get(key);

    if (
      !existing ||
      candidate.score >
        existing.score
    ) {
      map.set(
        key,
        {
          ...candidate,
          url: normalized,
        }
      );
    }
  }

  return [
    ...map.values(),
  ].sort(
    (a, b) =>
      b.score - a.score
  );
}

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
    tag.match(regex);

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

function extractSrcset(
  value
) {
  if (!value) {
    return [];
  }

  return String(value)
    .split(",")
    .map(
      (item) =>
        item.trim()
    )
    .map(
      (item) =>
        item.split(
          /\s+/
        )[0]
    )
    .filter(Boolean);
}

function cleanCandidateRawUrl(
  raw
) {
  if (!raw) {
    return null;
  }

  let value =
    String(raw).trim();

  value =
    decodeHtmlEntities(
      value
    );

  value =
    decodeEscapedHtml(
      value
    );

  // Remove HTML punctuation.
  value =
    value.replace(
      /^[("'`\s]+/,
      ""
    );

  value =
    value.replace(
      /["'`\s]+$/,
      ""
    );

  value =
    value.replace(
      /[;,]+$/,
      ""
    );

  // Remove an unmatched closing parenthesis.
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

function extractImageCandidatesFromRawHtml(
  html,
  sourcePrefix = "article"
) {
  const candidates = [];

  if (!html) {
    return candidates;
  }

  const decoded =
    decodeEscapedHtml(
      decodeHtmlEntities(
        html
      )
    );

  // ============================================================
  // 1. <img ...> tags
  // ============================================================

  const imgTags =
    decoded.match(
      /<img\b[^>]*>/gi
    ) || [];

  for (
    const tag of imgTags
  ) {
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

      if (
        attribute
          .toLowerCase()
          .includes("srcset")
      ) {
        const urls =
          extractSrcset(
            value
          );

        for (
          const src of urls
        ) {
          const cleaned =
            cleanCandidateRawUrl(
              src
            );

          const normalized =
            normalizeBloggerImageUrl(
              cleaned
            );

          if (!normalized) {
            continue;
          }

          if (
            !looksLikeImageUrl(
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
                : "article-srcset",
            score:
              scoreImageUrl(
                normalized,
                sourcePrefix ===
                  "feed"
                  ? "feed-content"
                  : "article-srcset",
                tag
              ),
          });
        }
      } else {
        const cleaned =
          cleanCandidateRawUrl(
            value
          );

        const normalized =
          normalizeBloggerImageUrl(
            cleaned
          );

        if (!normalized) {
          continue;
        }

        if (
          !looksLikeImageUrl(
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
              : "article-img",
          score:
            scoreImageUrl(
              normalized,
              sourcePrefix ===
                "feed"
                ? "feed-content"
                : "article-img",
              tag
            ),
        });
      }
    }

    // ----------------------------------------------------------
    // Additional fallback:
    // Search the entire img tag for Googleusercontent URLs.
    // ----------------------------------------------------------

    const tagUrls =
      extractGoogleusercontentUrls(
        tag
      );

    for (
      const rawUrl of tagUrls
    ) {
      const normalized =
        normalizeBloggerImageUrl(
          rawUrl
        );

      if (!normalized) {
        continue;
      }

      if (
        !looksLikeImageUrl(
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
            : "article-img",
        score:
          scoreImageUrl(
            normalized,
            sourcePrefix ===
              "feed"
              ? "feed-content"
              : "article-img",
            tag
          ) + 10,
      });
    }
  }

  // ============================================================
  // 2. <source ...> tags
  // ============================================================

  const sourceTags =
    decoded.match(
      /<source\b[^>]*>/gi
    ) || [];

  for (
    const tag of sourceTags
  ) {
    for (
      const attribute of [
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
        attribute
          .toLowerCase()
          .includes("srcset")
          ? extractSrcset(
              value
            )
          : [value];

      for (
        const src of values
      ) {
        const cleaned =
          cleanCandidateRawUrl(
            src
          );

        const normalized =
          normalizeBloggerImageUrl(
            cleaned
          );

        if (!normalized) {
          continue;
        }

        if (
          !looksLikeImageUrl(
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
              : "article-srcset",
          score:
            scoreImageUrl(
              normalized,
              sourcePrefix ===
                "feed"
                ? "feed-content"
                : "article-srcset",
              tag
            ),
        });
      }
    }
  }

  // ============================================================
  // 3. CSS url(...)
  // ============================================================

  const cssRegex =
    /url\(\s*(['"]?)(https?:\/\/[^'")\s]+)\1\s*\)/gi;

  for (
    const match of decoded.matchAll(
      cssRegex
    )
  ) {
    const cleaned =
      cleanCandidateRawUrl(
        match[2]
      );

    const normalized =
      normalizeBloggerImageUrl(
        cleaned
      );

    if (!normalized) {
      continue;
    }

    if (
      !looksLikeImageUrl(
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
        scoreImageUrl(
          normalized,
          sourcePrefix ===
            "feed"
            ? "feed-content"
            : "article-css",
          match[0]
        ),
    });
  }

  // ============================================================
  // 4. Raw Googleusercontent URLs
  //
  // IMPORTANT:
  // Only the supplied scoped HTML is searched.
  // ============================================================

  const rawUrls =
    extractGoogleusercontentUrls(
      decoded
    );

  for (
    const raw of rawUrls
  ) {
    const cleaned =
      cleanCandidateRawUrl(
        raw
      );

    const normalized =
      normalizeBloggerImageUrl(
        cleaned
      );

    if (!normalized) {
      continue;
    }

    if (
      !looksLikeImageUrl(
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
          : "article-raw",
      score:
        scoreImageUrl(
          normalized,
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

function extractGoogleusercontentUrls(
  html
) {
  if (!html) {
    return [];
  }

  const results = [];

  // ------------------------------------------------------------
  // Normal URL
  // ------------------------------------------------------------

  const normalRegex =
    /https?:\/\/[^"'<>\\\s]+googleusercontent\.com\/[^"'<>\\\s]+/gi;

  for (
    const match of html.matchAll(
      normalRegex
    )
  ) {
    let value =
      match[0];

    value =
      cleanCandidateRawUrl(
        value
      );

    if (!value) {
      continue;
    }

    // Critical:
    // Do not accept a URL ending only with /s1600/
    // or another Blogger resize directory.
    if (
      isIncompleteBloggerUrl(
        value
      )
    ) {
      continue;
    }

    results.push(
      value
    );
  }

  // ------------------------------------------------------------
  // Escaped URL
  // ------------------------------------------------------------

  const escapedRegex =
    /https?:\\\/\\\/[^"'<>\\\s]+googleusercontent\.com\\\/[^"'<>\\\s]+/gi;

  for (
    const match of html.matchAll(
      escapedRegex
    )
  ) {
    let value =
      decodeEscapedHtml(
        match[0]
      );

    value =
      cleanCandidateRawUrl(
        value
      );

    if (!value) {
      continue;
    }

    if (
      isIncompleteBloggerUrl(
        value
      )
    ) {
      continue;
    }

    results.push(
      value
    );
  }

  return [
    ...new Set(
      results
    ),
  ];
}

function extractFeedMediaCandidates(
  entry
) {
  const candidates = [];

  // ============================================================
  // media$thumbnail
  // ============================================================

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
      looksLikeImageUrl(
        normalized
      )
    ) {
      candidates.push({
        url:
          normalized,
        source:
          "feed-thumbnail",
        score:
          scoreImageUrl(
            normalized,
            "feed-thumbnail",
            "media$thumbnail"
          ),
      });
    }
  }

  // ============================================================
  // media$group / media$content
  // ============================================================

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
      !looksLikeImageUrl(
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
        scoreImageUrl(
          normalized,
          "feed-media",
          "media$content"
        ),
    });
  }

  // ============================================================
  // Feed content / summary
  // ============================================================

  const fragments = [];

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
    const extracted =
      extractImageCandidatesFromRawHtml(
        fragment,
        "feed"
      );

    candidates.push(
      ...extracted
    );
  }

  return dedupeCandidates(
    candidates
  );
}

function parseXmlEntries(
  xml
) {
  const entries = [];

  const entryRegex =
    /<entry\b[\s\S]*?<\/entry>/gi;

  for (
    const match
    of xml.matchAll(
      entryRegex
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
  const regex =
    new RegExp(
      `<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`,
      "i"
    );

  const match =
    xml.match(regex);

  if (!match) {
    return "";
  }

  return decodeHtmlEntities(
    match[1]
  )
    .replace(
      /<!\[CDATA\[([\s\S]*?)\]\]>/g,
      "$1"
    )
    .trim();
}

function xmlAttrValue(
  xml,
  tagName,
  attrName
) {
  const regex =
    new RegExp(
      `<${tagName}\\b[^>]*\\b${attrName}\\s*=\\s*["']([^"']+)["'][^>]*>`,
      "i"
    );

  const match =
    xml.match(regex);

  return match
    ? decodeHtmlEntities(
        match[1]
      )
    : "";
}

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

  const links = [
    ...xmlEntry.matchAll(
      /<link\b([^>]*)\/?>/gi
    ),
  ];

  let postUrl = "";

  for (
    const match
    of links
  ) {
    const attrs =
      match[1] ||
      "";

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
      decodeHtmlEntities(
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

  const categories = [
    ...xmlEntry.matchAll(
      /<category\b[^>]*\bterm\s*=\s*["']([^"']+)["'][^>]*\/?>/gi
    ),
  ].map(
    (match) =>
      decodeHtmlEntities(
        match[1]
      )
  );

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

  const mediaThumbnail =
    xmlAttrValue(
      xmlEntry,
      "media:thumbnail",
      "url"
    ) ||
    xmlAttrValue(
      xmlEntry,
      "media$thumbnail",
      "url"
    );

  if (
    mediaThumbnail
  ) {
    entryObject.media$thumbnail = {
      url:
        mediaThumbnail,
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
        ? new Date(
            published
          ).toISOString()
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

async function fetchText(
  url,
  {
    retries = 3,
    timeout = FETCH_TIMEOUT,
  } = {}
) {
  let lastError =
    null;

  for (
    let attempt = 0;
    attempt <= retries;
    attempt++
  ) {
    try {
      const controller =
        new AbortController();

      const timer =
        setTimeout(
          () =>
            controller.abort(),
          timeout
        );

      const response =
        await fetch(
          url,
          {
            headers: {
              "User-Agent":
                USER_AGENT,
              Accept:
                "application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8",
              "Accept-Language":
                "en-US,en;q=0.9",
            },
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
        return await response.text();
      }

      const status =
        response.status;

      if (
        status === 429 ||
        status === 408 ||
        status >= 500
      ) {
        if (
          attempt <
          retries
        ) {
          const wait =
            1200 *
            Math.pow(
              2,
              attempt
            );

          warn(
            `HTTP ${status} for ${url} - retrying in ${wait}ms`
          );

          await sleep(
            wait
          );

          continue;
        }
      }

      throw new Error(
        `HTTP ${status} ${response.statusText}`
      );
    } catch (error) {
      lastError =
        error;

      if (
        attempt <
        retries
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

async function fetchBinary(
  url,
  {
    retries = 2,
    timeout = FETCH_TIMEOUT,
  } = {}
) {
  let lastError =
    null;

  for (
    let attempt = 0;
    attempt <= retries;
    attempt++
  ) {
    try {
      const controller =
        new AbortController();

      const timer =
        setTimeout(
          () =>
            controller.abort(),
          timeout
        );

      const response =
        await fetch(
          url,
          {
            headers: {
              "User-Agent":
                USER_AGENT,
              Accept:
                "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
              Referer:
                BLOG_URL,
            },
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
        const arrayBuffer =
          await response.arrayBuffer();

        return Buffer.from(
          arrayBuffer
        );
      }

      const status =
        response.status;

      if (
        status === 429 ||
        status === 408 ||
        status >= 500
      ) {
        if (
          attempt <
          retries
        ) {
          await sleep(
            1000 *
              Math.pow(
                2,
                attempt
              )
          );

          continue;
        }
      }

      throw new Error(
        `HTTP ${status} ${response.statusText}`
      );
    } catch (error) {
      lastError =
        error;

      if (
        attempt <
        retries
      ) {
        await sleep(
          800 *
            Math.pow(
              2,
              attempt
            )
        );
      }
    }
  }

  throw (
    lastError ||
    new Error(
      `Failed to download ${url}`
    )
  );
}

async function commandExists(
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

async function detectImageMagick() {
  // ============================================================
  // Prefer ImageMagick 7 if installed.
  //
  // IM7:
  //   magick identify ...
  //   magick ...
  //
  // ImageMagick 6:
  //   identify ...
  //   convert ...
  // ============================================================

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

      const firstLine =
        result.stdout
          .split("\n")
          .find(
            (line) =>
              /ImageMagick/i.test(
                line
              )
          ) ||
        "";

      const versionMatch =
        firstLine.match(
          /ImageMagick\s+(\d+)\./i
        );

      const major =
        versionMatch
          ? Number(
              versionMatch[1]
            )
          : 7;

      if (
        major >= 7
      ) {
        return {
          version:
            firstLine.trim(),
          identifyCommand:
            "magick",
          convertCommand:
            "magick",
          identifyPrefix: [
            "identify",
          ],
          convertPrefix: [],
        };
      }

      // Some environments expose a "magick" shim
      // pointing to ImageMagick 6.
      if (
        await commandExists(
          "identify"
        ) &&
        await commandExists(
          "convert"
        )
      ) {
        return {
          version:
            firstLine.trim(),
          identifyCommand:
            "identify",
          convertCommand:
            "convert",
          identifyPrefix: [],
          convertPrefix: [],
        };
      }
    } catch {}
  }

  if (
    await commandExists(
      "identify"
    ) &&
    await commandExists(
      "convert"
    )
  ) {
    let version =
      "";

    try {
      const result =
        await runCommand(
          "identify",
          [
            "-version",
          ]
        );

      version =
        result.stdout
          .split("\n")
          .find(
            (line) =>
              /ImageMagick/i.test(
                line
              )
          )
          ?.trim() ||
        "";
    } catch {}

    return {
      version,
      identifyCommand:
        "identify",
      convertCommand:
        "convert",
      identifyPrefix: [],
      convertPrefix: [],
    };
  }

  throw new Error(
    "ImageMagick identify/convert command not found"
  );
}

async function runCommand(
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
            10 *
              1024 *
              1024,
          encoding:
            options.encoding ||
            "utf8",
        },
        (
          error,
          stdout,
          stderr
        ) => {
          if (error) {
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

async function validateImageFile(
  filePath,
  imageMagick
) {
  const stat =
    await fs.stat(
      filePath
    );

  if (
    stat.size <
    MIN_IMAGE_BYTES
  ) {
    return {
      valid:
        false,
      reason:
        `file too small: ${stat.size} bytes`,
    };
  }

  try {
    const args = [
      ...imageMagick.identifyPrefix,
      "-format",
      "%m %wx%h",
      filePath,
    ];

    const result =
      await runCommand(
        imageMagick.identifyCommand,
        args
      );

    const info =
      result.stdout.trim();

    const match =
      info.match(
        /(?:JPEG|JPG|PNG|WEBP|GIF|AVIF)\s+(\d+)x(\d+)/i
      );

    if (!match) {
      return {
        valid:
          false,
        reason:
          `unsupported image format: ${info}`,
      };
    }

    const width =
      Number(
        match[1]
      );

    const height =
      Number(
        match[2]
      );

    if (
      !Number.isFinite(
        width
      ) ||
      !Number.isFinite(
        height
      ) ||
      width < 200 ||
      height < 200
    ) {
      return {
        valid:
          false,
        reason:
          `image too small: ${width}x${height}`,
      };
    }

    return {
      valid:
        true,
      width,
      height,
      format:
        match[0]
          .split(/\s+/)[0],
      bytes:
        stat.size,
    };
  } catch (error) {
    return {
      valid:
        false,
      reason:
        `ImageMagick validation failed: ${error.message}`,
    };
  }
}

async function getPerceptualHash(
  filePath,
  imageMagick
) {
  try {
    const args = [
      ...imageMagick.convertPrefix,
      filePath,
      "-colorspace",
      "Gray",
      "-resize",
      "33x32!",
      "gray:-",
    ];

    const result =
      await runCommand(
        imageMagick.convertCommand,
        args,
        {
          maxBuffer:
            1024 *
            1024,
          encoding:
            "buffer",
        }
      );

    const bytes =
      Buffer.from(
        result.stdout
      );

    const expected =
      33 *
      32;

    if (
      bytes.length <
      expected
    ) {
      return null;
    }

    let bits =
      "";

    for (
      let y = 0;
      y < 32;
      y++
    ) {
      for (
        let x = 0;
        x < 32;
        x++
      ) {
        const left =
          bytes[
            y * 33 + x
          ];

        const right =
          bytes[
            y * 33 +
              x +
              1
          ];

        bits +=
          left < right
            ? "1"
            : "0";
      }
    }

    return bits;
  } catch {
    return null;
  }
}

function hammingDistance(
  a,
  b
) {
  if (
    !a ||
    !b ||
    a.length !==
      b.length
  ) {
    return Infinity;
  }

  let distance =
    0;

  for (
    let i = 0;
    i < a.length;
    i++
  ) {
    if (
      a[i] !==
      b[i]
    ) {
      distance++;
    }
  }

  return distance;
}

function isSameOrNearDuplicate(
  hash,
  existingHashes,
  threshold = 6
) {
  if (!hash) {
    return false;
  }

  for (
    const existing
    of existingHashes
  ) {
    const distance =
      hammingDistance(
        hash,
        existing
      );

    if (
      distance <=
      threshold
    ) {
      return true;
    }
  }

  return false;
}

async function sha256File(
  filePath
) {
  const buffer =
    await fs.readFile(
      filePath
    );

  return crypto
    .createHash(
      "sha256"
    )
    .update(buffer)
    .digest("hex");
}

function detectExtension(
  url,
  buffer
) {
  const content =
    buffer.subarray(
      0,
      Math.min(
        buffer.length,
        64
      )
    );

  // JPEG
  if (
    content[0] ===
      0xff &&
    content[1] ===
      0xd8 &&
    content[2] ===
      0xff
  ) {
    return ".jpg";
  }

  // PNG
  if (
    content[0] ===
        0x89 &&
    content[1] ===
        0x50 &&
    content[2] ===
        0x4e &&
    content[3] ===
        0x47
  ) {
    return ".png";
  }

  // GIF
  const header =
    content.toString(
      "ascii",
      0,
      6
    );

  if (
    header ===
      "GIF89a" ||
    header ===
      "GIF87a"
  ) {
    return ".gif";
  }

  // WEBP
  if (
    content.toString(
      "ascii",
      0,
      4
    ) === "RIFF" &&
    content.toString(
      "ascii",
      8,
      12
    ) === "WEBP"
  ) {
    return ".webp";
  }

  // AVIF / HEIF
  const ascii =
    content.toString(
      "ascii"
    );

  if (
    ascii.includes(
      "ftypavif"
    ) ||
    ascii.includes(
      "ftypavis"
    )
  ) {
    return ".avif";
  }

  try {
    const pathname =
      new URL(url)
        .pathname
        .toLowerCase();

    if (
      pathname.endsWith(
        ".png"
      )
    ) {
      return ".png";
    }

    if (
      pathname.endsWith(
        ".webp"
      )
    ) {
      return ".webp";
    }

    if (
      pathname.endsWith(
        ".gif"
      )
    ) {
      return ".gif";
    }

    if (
      pathname.endsWith(
        ".avif"
      )
    ) {
      return ".avif";
    }
  } catch {}

  return ".jpg";
}

async function downloadAndValidateCandidate(
  candidate,
  postIndex,
  imageMagick,
  duplicateState
) {
  const url =
    candidate.url;

  log(
    `  Candidate: ${url}`
  );

  // ------------------------------------------------------------
  // Safety check before downloading.
  // ------------------------------------------------------------

  if (
    isIncompleteBloggerUrl(
      url
    )
  ) {
    warn(
      "  Rejected: incomplete Blogger image URL"
    );

    return null;
  }

  if (
    !looksLikeImageUrl(
      url
    )
  ) {
    warn(
      "  Rejected: URL does not look like an image"
    );

    return null;
  }

  let buffer;

  try {
    buffer =
      await fetchBinary(
        url,
        {
          retries:
            2,
        }
      );
  } catch (error) {
    warn(
      `  Download failed: ${error.message}`
    );

    return null;
  }

  if (
    !buffer ||
    buffer.length <
      MIN_IMAGE_BYTES
  ) {
    warn(
      `  Rejected: downloaded file too small (${buffer?.length || 0} bytes)`
    );

    return null;
  }

  const extension =
    detectExtension(
      url,
      buffer
    );

  const filename =
    `post-${postIndex}${extension}`;

  const filePath =
    path.join(
      IMAGE_DIR,
      filename
    );

  await fs.writeFile(
    filePath,
    buffer
  );

  const validation =
    await validateImageFile(
      filePath,
      imageMagick
    );

  if (
    !validation.valid
  ) {
    warn(
      `  Rejected: ${validation.reason}`
    );

    await fs.rm(
      filePath,
      {
        force:
          true,
      }
    );

    return null;
  }

  const sha256 =
    await sha256File(
      filePath
    );

  if (
    duplicateState.sha256.has(
      sha256
    )
  ) {
    warn(
      "  Rejected: exact duplicate image"
    );

    await fs.rm(
      filePath,
      {
        force:
          true,
      }
    );

    return null;
  }

  const perceptualHash =
    await getPerceptualHash(
      filePath,
      imageMagick
    );

  if (
    perceptualHash &&
    isSameOrNearDuplicate(
      perceptualHash,
      duplicateState.perceptual,
      6
    )
  ) {
    warn(
      "  Rejected: perceptually duplicate image"
    );

    await fs.rm(
      filePath,
      {
        force:
          true,
      }
    );

    return null;
  }

  duplicateState.sha256.add(
    sha256
  );

  if (
    perceptualHash
  ) {
    duplicateState.perceptual.push(
      perceptualHash
    );
  }

  log(
    `  Accepted: ${validation.width}x${validation.height}, ${validation.bytes} bytes`
  );

  return {
    localImage:
      `images/${filename}`,
    imageSource:
      candidate.source,
    imageUrl:
      candidate.url,
    width:
      validation.width,
    height:
      validation.height,
    bytes:
      validation.bytes,
    sha256,
  };
}

function findExactPostContainer(
  html,
  postTitle,
  postUrl
) {
  if (!html) {
    return null;
  }

  const decoded =
    decodeEscapedHtml(
      decodeHtmlEntities(
        html
      )
    );

  const blocks = [];

  // ============================================================
  // Blogger post structures
  // ============================================================

  const blockRegex =
    /<(article|div|section)\b[^>]*\bclass\s*=\s*["'][^"']*(?:post-outer|post-body|blog-post|hentry|post)[^"']*["'][^>]*>/gi;

  for (
    const match
    of decoded.matchAll(
      blockRegex
    )
  ) {
    const start =
      match.index ??
      -1;

    if (
      start < 0
    ) {
      continue;
    }

    const openTagEnd =
      start +
      match[0].length;

    const tagName =
      match[1];

    const closeRegex =
      new RegExp(
        `<\\/${tagName}\\s*>`,
        "gi"
      );

    closeRegex.lastIndex =
      openTagEnd;

    const closeMatch =
      closeRegex.exec(
        decoded
      );

    if (
      !closeMatch
    ) {
      continue;
    }

    const end =
      closeMatch.index +
      closeMatch[0]
        .length;

    const fragment =
      decoded.slice(
        start,
        end
      );

    const text =
      cleanText(
        fragment
      );

    let score =
      0;

    if (
      postTitle &&
      text
        .toLowerCase()
        .includes(
          postTitle.toLowerCase()
        )
    ) {
      score +=
        200;
    }

    if (
      postUrl &&
      fragment.includes(
        postUrl
      )
    ) {
      score +=
        150;
    }

    if (
      /\bpost-body\b/i.test(
        match[0]
      )
    ) {
      score +=
        50;
    }

    if (
      /\bpost-outer\b/i.test(
        match[0]
      )
    ) {
      score +=
        40;
    }

    if (
      /<img\b/i.test(
        fragment
      )
    ) {
      score +=
        20;
    }

    blocks.push({
      fragment,
      score,
      start,
      end,
      reason:
        "class-block",
    });
  }

  blocks.sort(
    (a, b) =>
      b.score -
      a.score
  );

  if (
    blocks.length > 0
  ) {
    const best =
      blocks[0];

    if (
      best.score >=
      50
    ) {
      return best;
    }
  }

  // ============================================================
  // Permalink search
  // ============================================================

  if (postUrl) {
    const position =
      decoded.indexOf(
        postUrl
      );

    if (
      position >=
      0
    ) {
      const before =
        decoded.slice(
          0,
          position
        );

      const starts = [
        before.lastIndexOf(
          "<article"
        ),
        before.lastIndexOf(
          '<div class="post-outer'
        ),
        before.lastIndexOf(
          "<div class='post-outer"
        ),
        before.lastIndexOf(
          '<div class="post-body'
        ),
        before.lastIndexOf(
          "<div class='post-body"
        ),
      ].filter(
        (value) =>
          value >= 0
      );

      const start =
        starts.length
          ? Math.max(
              ...starts
            )
          : Math.max(
              0,
              position -
                50000
            );

      const after =
        decoded.slice(
          position
        );

      const endCandidates = [
        after.indexOf(
          "</article>"
        ),
        after.indexOf(
          "</div>"
        ),
      ].filter(
        (value) =>
          value >= 0
      );

      let relativeEnd =
        endCandidates.length
          ? Math.min(
              ...endCandidates
            )
          : Math.min(
              50000,
              after.length
            );

      const articleEnd =
        after.indexOf(
          "</article>"
        );

      if (
        articleEnd >=
          0 &&
        articleEnd ===
          relativeEnd
      ) {
        relativeEnd +=
          "</article>"
            .length;
      } else {
        relativeEnd +=
          "</div>".length;
      }

      const fragment =
        decoded.slice(
          start,
          position +
            relativeEnd
        );

      return {
        fragment,
        score:
          100,
        start,
        end:
          position +
          relativeEnd,
        reason:
          "permalink-ancestor",
      };
    }
  }

  // ============================================================
  // Title window
  // ============================================================

  if (
    postTitle
  ) {
    const titlePosition =
      decoded
        .toLowerCase()
        .indexOf(
          postTitle.toLowerCase()
        );

    if (
      titlePosition >=
      0
    ) {
      const start =
        Math.max(
          0,
          titlePosition -
            30000
        );

      const end =
        Math.min(
          decoded.length,
          titlePosition +
            60000
        );

      return {
        fragment:
          decoded.slice(
            start,
            end
          ),
        score:
          80,
        start,
        end,
        reason:
          "title-window",
      };
    }
  }

  return null;
}

async function getFeedUrl(
  blogUrl
) {
  const url =
    new URL(
      blogUrl
    );

  url.pathname =
    "/feeds/posts/default";

  url.search =
    new URLSearchParams({
      alt:
        "atom",
      "max-results":
        "10",
    }).toString();

  return url.toString();
}

async function analyze() {
  log("");
  log(
    `BLOG ANALYZER v${VERSION}`
  );
  log(
    "Feed-first Blogger image extraction"
  );
  log(
    "Exact-post scoped article fallback"
  );
  log(
    "Robust raw HTML image extraction"
  );
  log(
    "ImageMagick 6 / 7 compatible"
  );
  log("");

  await fs.mkdir(
    IMAGE_DIR,
    {
      recursive:
        true,
    }
  );

  // ------------------------------------------------------------
  // Remove previous generated images.
  // ------------------------------------------------------------

  const oldFiles =
    await fs.readdir(
      IMAGE_DIR
    ).catch(
      () => []
    );

  for (
    const file
    of oldFiles
  ) {
    await fs.rm(
      path.join(
        IMAGE_DIR,
        file
      ),
      {
        force:
          true,
        recursive:
          true,
      }
    );
  }

  // ------------------------------------------------------------
  // ImageMagick
  // ------------------------------------------------------------

  const imageMagick =
    await detectImageMagick();

  log(
    `ImageMagick identify command: ${imageMagick.identifyCommand}`
  );

  log(
    `ImageMagick convert command: ${imageMagick.convertCommand}`
  );

  if (
    imageMagick.version
  ) {
    log(
      `ImageMagick: ${imageMagick.version}`
    );
  }

  // ------------------------------------------------------------
  // Feed
  // ------------------------------------------------------------

  const feedUrl =
    await getFeedUrl(
      BLOG_URL
    );

  let feedXml;

  try {
    feedXml =
      await fetchText(
        feedUrl,
        {
          retries:
            4,
        }
      );
  } catch (error) {
    throw new Error(
      `Feed fetch failed: ${error.message}`
    );
  }

  log(
    "Feed fetched successfully."
  );

  const entryXmls =
    parseXmlEntries(
      feedXml
    );

  log(
    `Feed entries: ${entryXmls.length}`
  );

  if (
    entryXmls.length <
    MAX_POSTS
  ) {
    throw new Error(
      `Feed contains only ${entryXmls.length} posts. Need at least ${MAX_POSTS}.`
    );
  }

  const parsedPosts =
    entryXmls
      .slice(
        0,
        MAX_POSTS
      )
      .map(
        (
          entry,
          index
        ) =>
          parseFeedEntry(
            entry,
            index + 1
          )
      );

  const posts = [];

  const duplicateState =
    {
      sha256:
        new Set(),
      perceptual:
        [],
    };

  // ------------------------------------------------------------
  // Process posts
  // ------------------------------------------------------------

  for (
    const post
    of parsedPosts
  ) {
    log("");
    log(
      `Post ${post.index}: ${post.title}`
    );

    log(
      `URL: ${post.url}`
    );

    let candidates =
      extractFeedMediaCandidates(
        post.entry
      );

    log(
      `Feed image candidates: ${candidates.length}`
    );

    for (
      const candidate
      of candidates.slice(
        0,
        10
      )
    ) {
      log(
        `  Feed candidate score=${candidate.score} source=${candidate.source}`
      );

      log(
        `    ${candidate.url}`
      );
    }

    let selected =
      null;

    // ----------------------------------------------------------
    // Feed candidates
    // ----------------------------------------------------------

    for (
      const candidate
      of candidates
    ) {
      selected =
        await downloadAndValidateCandidate(
          candidate,
          post.index,
          imageMagick,
          duplicateState
        );

      if (
        selected
      ) {
        break;
      }
    }

    // ----------------------------------------------------------
    // Exact article fallback
    // ----------------------------------------------------------

    if (
      !selected
    ) {
      log(
        "Feed candidates failed. Fetching exact article page for fallback..."
      );

      let articleHtml;

      try {
        articleHtml =
          await fetchText(
            post.url,
            {
              retries:
                2,
            }
          );

        log(
          `Article page fetched: ${articleHtml.length} bytes`
        );
      } catch (error) {
        throw new Error(
          `Article page fetch failed for Post ${post.index}: ${error.message}`
        );
      }

      const container =
        findExactPostContainer(
          articleHtml,
          post.title,
          post.url
        );

      if (
        container
      ) {
        log(
          `Exact post container: FOUND (${container.reason}, score=${container.score})`
        );

        log(
          `Scoped HTML length: ${container.fragment.length}`
        );

        const imgCount =
          (
            container.fragment.match(
              /<img\b/gi
            ) || []
          ).length;

        log(
          `Scoped <img> tags: ${imgCount}`
        );

        candidates =
          extractImageCandidatesFromRawHtml(
            container.fragment,
            "article"
          );

        log(
          `Page-local image candidates: ${candidates.length}`
        );

        for (
          const candidate
          of candidates.slice(
            0,
            15
          )
        ) {
          log(
            `  Article candidate score=${candidate.score} source=${candidate.source}`
          );

          log(
            `    ${candidate.url}`
          );
        }

        for (
          const candidate
          of candidates
        ) {
          selected =
            await downloadAndValidateCandidate(
              candidate,
              post.index,
              imageMagick,
              duplicateState
            );

          if (
            selected
          ) {
            break;
          }
        }
      } else {
        log(
          "Exact post container: NOT FOUND"
        );

        // --------------------------------------------------------
        // Last resort:
        // title-local window.
        // --------------------------------------------------------

        const titlePosition =
          articleHtml
            .toLowerCase()
            .indexOf(
              post.title.toLowerCase()
            );

        if (
          titlePosition >=
          0
        ) {
          const windowStart =
            Math.max(
              0,
              titlePosition -
                30000
            );

          const windowEnd =
            Math.min(
              articleHtml.length,
              titlePosition +
                60000
            );

          const scopedWindow =
            articleHtml.slice(
              windowStart,
              windowEnd
            );

          candidates =
            extractImageCandidatesFromRawHtml(
              scopedWindow,
              "article"
            );

          log(
            `Title-window image candidates: ${candidates.length}`
          );

          for (
            const candidate
            of candidates
          ) {
            selected =
              await downloadAndValidateCandidate(
                candidate,
                post.index,
                imageMagick,
                duplicateState
              );

            if (
              selected
            ) {
              break;
            }
          }
        }
      }
    }

    if (
      !selected
    ) {
      throw new Error(
        `All image candidates were rejected for Post ${post.index}`
      );
    }

    posts.push({
      index:
        post.index,
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
        selected.localImage,
      imageSource:
        selected.imageSource,
    });

    log(
      `Selected source: ${selected.imageSource}`
    );

    log(
      `Selected image: ${selected.localImage}`
    );
  }

  // ------------------------------------------------------------
  // Homepage metadata
  //
  // IMPORTANT:
  // Homepage OG image is metadata only.
  // It is NOT used as a post image candidate.
  // ------------------------------------------------------------

  let homepageHtml =
    "";

  try {
    homepageHtml =
      await fetchText(
        BLOG_URL,
        {
          retries:
            2,
        }
      );
  } catch {
    warn(
      "Homepage metadata fetch failed. Continuing with feed data."
    );
  }

  const siteTitle =
    cleanText(
      xmlTagValue(
        feedXml,
        "title"
      )
    ) ||
    cleanText(
      homepageHtml.match(
        /<title[^>]*>([\s\S]*?)<\/title>/i
      )?.[1] ||
        ""
    );

  const feedSubtitle =
    cleanText(
      xmlTagValue(
        feedXml,
        "subtitle"
      )
    );

  const description =
    feedSubtitle ||
    cleanText(
      homepageHtml.match(
        /<meta\b[^>]*name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']*)["'][^>]*>/i
      )?.[1] ||
        ""
    );

  const pageHeading =
    cleanText(
      homepageHtml.match(
        /<h1\b[^>]*>([\s\S]*?)<\/h1>/i
      )?.[1] ||
        ""
    );

  const ogImage =
    normalizeBloggerImageUrl(
      homepageHtml.match(
        /<meta\b[^>]*property\s*=\s*["']og:image["'][^>]*content\s*=\s*["']([^"']+)["'][^>]*>/i
      )?.[1] ||
        ""
    );

  const hostname =
    new URL(
      BLOG_URL
    ).hostname;

  const result = {
    version:
      4,

    analyzerVersion:
      VERSION,

    capturedAt:
      new Date().toISOString(),

    url:
      BLOG_URL,

    hostname,

    siteTitle,

    description,

    pageHeading,

    ogImage:
      ogImage || "",

    language:
      "en",

    postCount:
      posts.length,

    analysis: {
      identity:
        siteTitle ||
        pageHeading ||
        "",

      topics:
        posts
          .flatMap(
            (post) =>
              post.categories ||
              []
          )
          .filter(
            Boolean
          )
          .slice(
            0,
            20
          ),

      audience:
        "Readers interested in practical information, market insights, technology, and actionable content.",

      contentStyle:
        "Concise, informative, problem-solving editorial content.",

      valueProposition:
        description ||
        "Practical information and actionable insights.",
    },

    posts,
  };

  // ------------------------------------------------------------
  // Final validation
  // ------------------------------------------------------------

  if (
    result.posts.length <
    MAX_POSTS
  ) {
    throw new Error(
      `Only ${result.posts.length} posts were successfully processed.`
    );
  }

  for (
    const post
    of result.posts
  ) {
    if (
      !post.title ||
      !post.url ||
      !post.excerpt ||
      !post.localImage
    ) {
      throw new Error(
        `Invalid post data for Post ${post.index}`
      );
    }

    const imagePath =
      path.join(
        OUTPUT_DIR,
        post.localImage
      );

    const stat =
      await fs.stat(
        imagePath
      );

    if (
      stat.size <
      MIN_IMAGE_BYTES
    ) {
      throw new Error(
        `Image too small for Post ${post.index}: ${post.localImage}`
      );
    }
  }

  await fs.writeFile(
    BLOG_JSON,
    JSON.stringify(
      result,
      null,
      2
    ),
    "utf8"
  );

  // ------------------------------------------------------------
  // Success
  // ------------------------------------------------------------

  log("");
  log(
    "=================================================="
  );
  log(
    `BLOG ANALYZER v${VERSION} SUCCESS`
  );
  log(
    "=================================================="
  );

  log(
    `Posts: ${result.posts.length}`
  );

  for (
    const post
    of result.posts
  ) {
    log(
      `Post ${post.index}: ${post.title}`
    );

    log(
      `  Image: ${post.localImage}`
    );

    log(
      `  Source: ${post.imageSource}`
    );
  }

  log("");
  log(
    `blog.json: ${BLOG_JSON}`
  );
  log("");
}

analyze().catch(
  (error) => {
    console.error("");
    console.error(
      `BLOG ANALYZER v${VERSION} FAILED`
    );
    console.error(
      `Error: ${error.message}`
    );
    console.error("");

    if (
      error.stack
    ) {
      console.error(
        error.stack
      );
    }

    console.error("");

    process.exit(
      1
    );
  }
);
