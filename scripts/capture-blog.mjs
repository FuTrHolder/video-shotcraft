#!/usr/bin/env node

/**
 * capture-blog.mjs v12.0
 *
 * Purpose:
 *   Capture Blogger posts and their article-specific images.
 *
 * Critical rule:
 *   NEVER use a site-wide/homepage image as a post image.
 *   If an article-specific image cannot be proven, the capture FAILS.
 *
 * Image association priority:
 *   1. Exact article og:image
 *   2. Exact article twitter:image
 *   3. Exact article image_src
 *   4. Exact post-body image
 *   5. Image near Unsplash attribution inside exact post-body
 *   6. Valid feed-content image belonging to the exact feed entry
 *
 * Validation:
 *   - URL validation
 *   - HTTP download
 *   - image magic bytes
 *   - ImageMagick identify
 *   - minimum dimensions / file size
 *   - SHA-256 duplicate protection
 *   - perceptual duplicate protection
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const BLOG_URL = process.env.BLOG_URL || process.argv[2];

if (!BLOG_URL) {
  console.error("Usage: node scripts/capture-blog.mjs <BLOG_URL>");
  process.exit(1);
}

const OUTPUT_DIR =
  process.env.OUTPUT_DIR ||
  path.resolve(process.cwd(), "template/public/blog-assets");

const BLOG_JSON =
  process.env.BLOG_JSON ||
  path.resolve(process.cwd(), "template/public/blog.json");

const USER_AGENT =
  process.env.USER_AGENT ||
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36";

const MIN_FILE_SIZE = 5000;
const MIN_WIDTH = 200;
const MIN_HEIGHT = 150;

const MAX_POSTS = 5;
const FETCH_TIMEOUT = 30000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* -------------------------------------------------------------------------- */
/* Logging                                                                    */
/* -------------------------------------------------------------------------- */

function log(message = "") {
  console.log(message);
}

function warn(message = "") {
  console.warn(message);
}

/* -------------------------------------------------------------------------- */
/* Basic helpers                                                              */
/* -------------------------------------------------------------------------- */

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value) {
  return normalizeWhitespace(
    String(value || "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&#x27;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
  );
}

function normalizeComparableText(value) {
  return normalizeWhitespace(
    String(value || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&#x27;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .toLowerCase()
  );
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#47;/gi, "/")
    .replace(/&#x3D;/gi, "=")
    .replace(/&#61;/gi, "=")
    .replace(/&nbsp;/gi, " ");
}

function decodeEscapedUrl(value) {
  let result = String(value || "");

  result = result
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003d/gi, "=")
    .replace(/\\u002f/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"')
    .replace(/&amp;/gi, "&");

  return decodeHtml(result).trim();
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function absoluteUrl(url, base = BLOG_URL) {
  if (!url) return null;

  let value = decodeEscapedUrl(url)
    .replace(/^['"]+|['"]+$/g, "")
    .trim();

  if (!value) return null;

  if (value.startsWith("//")) {
    value = `https:${value}`;
  }

  try {
    return new URL(value, base).href;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* HTTP                                                                       */
/* -------------------------------------------------------------------------- */

async function fetchText(url, options = {}) {
  const maxRetries = options.maxRetries ?? 3;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();

      const timer = setTimeout(() => {
        controller.abort();
      }, FETCH_TIMEOUT);

      const response = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent": USER_AGENT,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: BLOG_URL,
        },
      });

      clearTimeout(timer);

      if (response.ok) {
        return await response.text();
      }

      if (
        (response.status === 429 ||
          response.status === 408 ||
          response.status >= 500) &&
        attempt < maxRetries
      ) {
        const delay = 1500 * Math.pow(2, attempt);
        warn(
          `HTTP ${response.status} for ${url}. Retrying in ${delay}ms...`
        );
        await sleep(delay);
        continue;
      }

      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    } catch (error) {
      if (attempt >= maxRetries) {
        throw error;
      }

      const delay = 1500 * Math.pow(2, attempt);

      warn(
        `Fetch failed: ${url}\n` +
          `Reason: ${error.message}\n` +
          `Retrying in ${delay}ms...`
      );

      await sleep(delay);
    }
  }

  throw new Error(`Unable to fetch ${url}`);
}

async function fetchBinary(url) {
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();

      const timer = setTimeout(() => {
        controller.abort();
      }, FETCH_TIMEOUT);

      const response = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          Referer: BLOG_URL,
        },
      });

      clearTimeout(timer);

      if (response.ok) {
        return {
          bytes: Buffer.from(await response.arrayBuffer()),
          contentType: response.headers.get("content-type") || "",
          finalUrl: response.url || url,
        };
      }

      if (
        (response.status === 429 ||
          response.status === 408 ||
          response.status >= 500) &&
        attempt < maxRetries
      ) {
        await sleep(1500 * Math.pow(2, attempt));
        continue;
      }

      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    } catch (error) {
      if (attempt >= maxRetries) {
        throw error;
      }

      await sleep(1500 * Math.pow(2, attempt));
    }
  }

  throw new Error(`Unable to download image: ${url}`);
}

/* -------------------------------------------------------------------------- */
/* URL filtering                                                              */
/* -------------------------------------------------------------------------- */

function isUnsplashPageUrl(url) {
  try {
    const parsed = new URL(url);

    return (
      parsed.hostname === "unsplash.com" ||
      parsed.hostname.endsWith(".unsplash.com")
    );
  } catch {
    return false;
  }
}

function isUnsplashImageUrl(url) {
  try {
    const parsed = new URL(url);

    return (
      parsed.hostname === "images.unsplash.com" ||
      parsed.hostname === "plus.unsplash.com"
    );
  } catch {
    return false;
  }
}

function isLikelyImageUrl(url) {
  if (!url) return false;

  const value = decodeEscapedUrl(url);

  if (isUnsplashPageUrl(value)) {
    return false;
  }

  if (value.startsWith("data:")) {
    return false;
  }

  if (
    value.startsWith("javascript:") ||
    value.startsWith("mailto:") ||
    value.startsWith("#")
  ) {
    return false;
  }

  let parsed;

  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (!/^https?:$/i.test(parsed.protocol)) {
    return false;
  }

  /*
   * Blogger image URLs:
   *
   * blogger.googleusercontent.com/img/b/...
   * googleusercontent.com/...
   *
   * may not always have a conventional extension.
   */
  if (
    parsed.hostname.includes("googleusercontent.com") ||
    parsed.hostname.includes("blogspot.com")
  ) {
    return true;
  }

  if (isUnsplashImageUrl(value)) {
    return true;
  }

  const pathname = parsed.pathname.toLowerCase();

  if (
    /\.(jpe?g|png|gif|webp|avif|bmp|svg|tiff?)$/i.test(pathname)
  ) {
    return true;
  }

  /*
   * CDN image URLs are frequently extensionless.
   */
  if (
    parsed.hostname.includes("cloudinary.com") ||
    parsed.hostname.includes("cdn.") ||
    parsed.hostname.includes("images.") ||
    parsed.hostname.includes("image.")
  ) {
    return true;
  }

  return false;
}

function normalizeBloggerImageUrl(url) {
  if (!url) return null;

  let value = decodeEscapedUrl(url);

  if (!isLikelyImageUrl(value)) {
    return null;
  }

  try {
    const parsed = new URL(value);

    /*
     * Convert small Blogger thumbnail variants to high resolution.
     *
     * /s72-c/
     * /s320/
     * /w1200/
     * etc.
     */

    parsed.pathname = parsed.pathname
      .replace(/\/s\d+(?:-[a-z0-9]+)?\//i, "/s1600/")
      .replace(/\/w\d+(?:-h\d+)?\//i, "/s1600/")
      .replace(/\/h\d+(?:-w\d+)?\//i, "/s1600/");

    return parsed.href;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* HTML parsing                                                               */
/* -------------------------------------------------------------------------- */

function parseAttributes(tag) {
  const attributes = {};

  const attrRegex =
    /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

  let match;

  while ((match = attrRegex.exec(tag))) {
    const name = match[1].toLowerCase();

    const value =
      match[2] !== undefined
        ? match[2]
        : match[3] !== undefined
        ? match[3]
        : match[4];

    attributes[name] = decodeEscapedUrl(value);
  }

  return attributes;
}

function stripHtml(value) {
  return decodeHtml(
    String(value || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

function extractSrcsetUrls(value) {
  const urls = [];

  if (!value) return urls;

  const parts = String(value).split(",");

  for (const part of parts) {
    const trimmed = part.trim();

    if (!trimmed) continue;

    const url = trimmed.split(/\s+/)[0];

    if (url) {
      urls.push(url);
    }
  }

  return urls;
}

/* -------------------------------------------------------------------------- */
/* Image candidate extraction                                                 */
/* -------------------------------------------------------------------------- */

function addCandidate(list, url, source, score, extra = {}) {
  const normalized =
    normalizeBloggerImageUrl(url) ||
    absoluteUrl(url);

  if (!normalized) return;

  if (!isLikelyImageUrl(normalized)) {
    return;
  }

  if (isUnsplashPageUrl(normalized)) {
    return;
  }

  list.push({
    url: normalized,
    source,
    score,
    ...extra,
  });
}

function extractImageCandidatesFromHtml(html, options = {}) {
  const candidates = [];

  if (!html) {
    return candidates;
  }

  /*
   * <img>
   */
  const imgRegex = /<img\b[^>]*>/gi;

  let match;

  while ((match = imgRegex.exec(html))) {
    const tag = match[0];
    const attrs = parseAttributes(tag);

    const sources = [
      ["src", attrs.src, 700],
      ["data-src", attrs["data-src"], 690],
      ["data-original", attrs["data-original"], 685],
      ["data-lazy-src", attrs["data-lazy-src"], 680],
      ["data-image", attrs["data-image"], 675],
      ["data-url", attrs["data-url"], 670],
      ["data-original-src", attrs["data-original-src"], 665],
    ];

    for (const [name, url, score] of sources) {
      if (url) {
        addCandidate(
          candidates,
          url,
          options.source || "article-body",
          score,
          {
            attribute: name,
          }
        );
      }
    }

    for (const src of extractSrcsetUrls(
      attrs.srcset || attrs["data-srcset"]
    )) {
      addCandidate(
        candidates,
        src,
        options.source || "article-body",
        710,
        {
          attribute: "srcset",
        }
      );
    }
  }

  /*
   * <source>
   */
  const sourceRegex = /<source\b[^>]*>/gi;

  while ((match = sourceRegex.exec(html))) {
    const attrs = parseAttributes(match[0]);

    if (attrs.src) {
      addCandidate(
        candidates,
        attrs.src,
        options.source || "article-body",
        705,
        {
          attribute: "src",
        }
      );
    }

    for (const src of extractSrcsetUrls(attrs.srcset)) {
      addCandidate(
        candidates,
        src,
        options.source || "article-body",
        706,
        {
          attribute: "srcset",
        }
      );
    }
  }

  /*
   * CSS background-image: url(...)
   */
  const cssUrlRegex = /url\(\s*(['"]?)(https?:\/\/.*?)\1\s*\)/gi;

  while ((match = cssUrlRegex.exec(html))) {
    addCandidate(
      candidates,
      match[2],
      options.source || "article-body",
      500,
      {
        attribute: "css-url",
      }
    );
  }

  /*
   * Nearby <a href="image">
   *
   * Only accept actual image-like URLs.
   * Generic Unsplash attribution pages are rejected.
   */
  const anchorRegex = /<a\b[^>]*>/gi;

  while ((match = anchorRegex.exec(html))) {
    const attrs = parseAttributes(match[0]);

    if (attrs.href && isLikelyImageUrl(attrs.href)) {
      addCandidate(
        candidates,
        attrs.href,
        options.source || "article-body",
        620,
        {
          attribute: "href",
        }
      );
    }
  }

  return candidates;
}

/* -------------------------------------------------------------------------- */
/* Meta image extraction                                                      */
/* -------------------------------------------------------------------------- */

function extractArticleMetaImages(html) {
  const candidates = [];

  if (!html) return candidates;

  const metaRegex = /<meta\b[^>]*>/gi;

  let match;

  while ((match = metaRegex.exec(html))) {
    const attrs = parseAttributes(match[0]);

    const property = (
      attrs.property ||
      attrs.name ||
      attrs.itemprop ||
      ""
    ).toLowerCase();

    const content = attrs.content;

    if (!content) continue;

    if (property === "og:image") {
      addCandidate(candidates, content, "article-og", 1200, {
        metaType: "og:image",
      });
    }

    if (property === "twitter:image") {
      addCandidate(candidates, content, "article-twitter", 1150, {
        metaType: "twitter:image",
      });
    }

    if (property === "twitter:image:src") {
      addCandidate(candidates, content, "article-twitter", 1140, {
        metaType: "twitter:image:src",
      });
    }

    if (
      property === "image_src" ||
      property === "image" ||
      property === "thumbnail"
    ) {
      addCandidate(candidates, content, "article-meta", 1100, {
        metaType: property,
      });
    }
  }

  /*
   * <link rel="image_src" href="...">
   */
  const linkRegex = /<link\b[^>]*>/gi;

  while ((match = linkRegex.exec(html))) {
    const attrs = parseAttributes(match[0]);

    const rel = String(attrs.rel || "").toLowerCase();

    if (
      rel
        .split(/\s+/)
        .includes("image_src") &&
      attrs.href
    ) {
      addCandidate(
        candidates,
        attrs.href,
        "article-meta",
        1090,
        {
          metaType: "link:image_src",
        }
      );
    }
  }

  return candidates;
}

/* -------------------------------------------------------------------------- */
/* Nesting-aware HTML block extraction                                        */
/* -------------------------------------------------------------------------- */

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

function parseTagToken(tagText, position) {
  const closing = /^<\s*\//.test(tagText);
  const nameMatch = tagText.match(/^<\s*\/?\s*([a-z0-9]+)/i);

  if (!nameMatch) return null;

  const name = nameMatch[1].toLowerCase();

  const selfClosing =
    /\/\s*>$/.test(tagText) ||
    VOID_TAGS.has(name);

  return {
    name,
    closing,
    selfClosing,
    position,
    text: tagText,
  };
}

function findHeadingForTitle(html, title) {
  const target = normalizeComparableText(title);

  const headingRegex = /<h([1-6])\b[^>]*>[\s\S]*?<\/h\1\s*>/gi;

  let match;

  while ((match = headingRegex.exec(html))) {
    const headingText = normalizeComparableText(
      stripHtml(match[0])
    );

    if (!headingText) continue;

    if (
      headingText === target ||
      headingText.includes(target) ||
      target.includes(headingText)
    ) {
      return {
        start: match.index,
        end: match.index + match[0].length,
        level: Number(match[1]),
        text: headingText,
      };
    }
  }

  return null;
}

function blockMatchesPost(attrs) {
  const classValue = String(attrs.class || "").toLowerCase();

  const idValue = String(attrs.id || "").toLowerCase();

  const itemprop = String(
    attrs.itemprop || ""
  ).toLowerCase();

  const semantic =
    `${classValue} ${idValue} ${itemprop}`;

  // Title/header blocks are NOT article containers.
  if (
    /\bpost-title\b/.test(classValue) ||
    /\bentry-title\b/.test(classValue) ||
    /\bpost-header\b/.test(classValue)
  ) {
    return false;
  }

  const patterns = [
    /\bpost-body\b/,
    /\bpost-body-container\b/,
    /\bpost-outer\b/,
    /\bblog-post\b/,
    /\bentry-content\b/,
    /\bpost-content\b/,
    /\barticle-body\b/,
    /\barticle-content\b/,
    /\barticlebody\b/,
  ];

  return (
    patterns.some((pattern) => pattern.test(semantic)) ||
    itemprop.split(/\s+/).includes("articlebody")
  );
}

function findExactPostRegion(html, title) {
  const heading = findHeadingForTitle(html, title);

  if (!heading) {
    return null;
  }

  /*
   * Scan the document once while maintaining a real tag stack.
   *
   * This avoids the v11.1 problem:
   *
   *   <div> ... <div> ... </div> ... </div>
   *
   * where a regex could stop at the wrong closing </div>.
   */
  const tagRegex = /<\/?[a-z0-9][^>]*>/gi;

  const stack = [];

  let match;

  const ancestorsAtHeading = [];

  while ((match = tagRegex.exec(html))) {
    const position = match.index;

    if (position > heading.start) {
      break;
    }

    const token = parseTagToken(match[0], position);

    if (!token) continue;

    if (token.closing) {
      /*
       * Find the most recent matching opening tag.
       */
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].name === token.name) {
          stack.splice(i, 1);
          break;
        }
      }

      continue;
    }

    if (token.selfClosing) {
      continue;
    }

    const attrs = parseAttributes(token.text);

    stack.push({
      name: token.name,
      start: token.position,
      attrs,
    });
  }

  for (const ancestor of stack) {
    const attrs = ancestor.attrs || {};

    if (
      ancestor.name === "article" ||
      blockMatchesPost(attrs)
    ) {
      ancestorsAtHeading.push(ancestor);
    }
  }

  if (!ancestorsAtHeading.length) {
    return null;
  }

  /*
   * Prefer the smallest / innermost matching semantic container.
   */
  const selected =
    ancestorsAtHeading[ancestorsAtHeading.length - 1];

  const end = findMatchingClosingTag(
    html,
    selected.start,
    selected.name
  );

  if (!end) {
    return null;
  }

  return {
    html: html.slice(selected.start, end),
    start: selected.start,
    end,
    tagName: selected.name,
    className: selected.attrs.class || "",
    heading,
  };
}

function findMatchingClosingTag(html, openingStart, tagName) {
  const tagRegex = /<\/?[a-z0-9][^>]*>/gi;

  tagRegex.lastIndex = openingStart;

  let depth = 0;

  let match;

  while ((match = tagRegex.exec(html))) {
    const token = parseTagToken(
      match[0],
      match.index
    );

    if (!token || token.name !== tagName) {
      continue;
    }

    if (token.closing) {
      depth--;

      if (depth === 0) {
        return match.index + match[0].length;
      }

      continue;
    }

    if (!token.selfClosing) {
      depth++;
    }
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Attribution-aware extraction                                               */
/* -------------------------------------------------------------------------- */

function findUnsplashAttributionCandidates(blockHtml) {
  const candidates = [];

  if (!blockHtml) {
    return candidates;
  }

  /*
   * Only inspect the area around an explicit:
   *
   *   Photo by ... Unsplash
   *
   * attribution.
   *
   * IMPORTANT:
   * We intentionally do NOT use
   * extractImageCandidatesFromHtml() here.
   *
   * That helper also inspects <a href>, which can contain
   * Blogger article/label navigation URLs rather than images.
   */

  const attributionRegex =
    /Photo\s+by[\s\S]{0,800}?Unsplash/gi;

  let match;

  while ((match = attributionRegex.exec(blockHtml))) {
    const start = Math.max(
      0,
      match.index - 5000
    );

    const end = Math.min(
      blockHtml.length,
      match.index +
        match[0].length +
        5000
    );

    const windowHtml =
      blockHtml.slice(start, end);

    /*
     * ------------------------------------------------------------
     * 1. <img> src / data-* attributes
     * ------------------------------------------------------------
     */

    const imgRegex =
      /<img\b[^>]*>/gi;

    let imgMatch;

    while (
      (imgMatch = imgRegex.exec(windowHtml))
    ) {
      const attrs =
        parseAttributes(imgMatch[0]);

      const imageAttributes = [
        "src",
        "data-src",
        "data-original",
        "data-lazy-src",
        "data-image",
        "data-url",
        "data-original-src",
      ];

      for (const attribute of imageAttributes) {
        if (!attrs[attribute]) {
          continue;
        }

        const url = attrs[attribute];

        if (
          !isLikelyImageUrl(url)
        ) {
          continue;
        }

        addCandidate(
          candidates,
          url,
          "article-unsplash",
          1100,
          {
            attribute,
            association: "article-body",
            reason:
              "unsplash-attribution-img",
          }
        );
      }

      /*
       * srcset
       */
      if (attrs.srcset) {
        const parts =
          attrs.srcset.split(",");

        for (const part of parts) {
          const tokens =
            part.trim().split(/\s+/);

          const url = tokens[0];

          if (
            !url ||
            !isLikelyImageUrl(url)
          ) {
            continue;
          }

          addCandidate(
            candidates,
            url,
            "article-unsplash",
            1080,
            {
              attribute: "srcset",
              association:
                "article-body",
              reason:
                "unsplash-attribution-srcset",
            }
          );
        }
      }
    }

    /*
     * ------------------------------------------------------------
     * 2. <source src/srcset>
     * ------------------------------------------------------------
     */

    const sourceRegex =
      /<source\b[^>]*>/gi;

    let sourceMatch;

    while (
      (sourceMatch =
        sourceRegex.exec(windowHtml))
    ) {
      const attrs =
        parseAttributes(
          sourceMatch[0]
        );

      if (attrs.src) {
        if (
          isLikelyImageUrl(attrs.src)
        ) {
          addCandidate(
            candidates,
            attrs.src,
            "article-unsplash",
            1070,
            {
              attribute: "source-src",
              association:
                "article-body",
              reason:
                "unsplash-attribution-source",
            }
          );
        }
      }

      if (attrs.srcset) {
        const parts =
          attrs.srcset.split(",");

        for (const part of parts) {
          const tokens =
            part.trim().split(/\s+/);

          const url = tokens[0];

          if (
            !url ||
            !isLikelyImageUrl(url)
          ) {
            continue;
          }

          addCandidate(
            candidates,
            url,
            "article-unsplash",
            1060,
            {
              attribute:
                "source-srcset",
              association:
                "article-body",
              reason:
                "unsplash-attribution-source-srcset",
            }
          );
        }
      }
    }

    /*
     * ------------------------------------------------------------
     * 3. CSS background-image
     * ------------------------------------------------------------
     */

    const cssRegex =
      /url\(\s*(['"]?)(https?:\/\/.*?)\1\s*\)/gi;

    let cssMatch;

    while (
      (cssMatch =
        cssRegex.exec(windowHtml))
    ) {
      const url = cssMatch[2];

      if (
        !isLikelyImageUrl(url)
      ) {
        continue;
      }

      addCandidate(
        candidates,
        url,
        "article-unsplash",
        1050,
        {
          attribute: "css-url",
          association:
            "article-body",
          reason:
            "unsplash-attribution-css",
        }
      );
    }

    /*
     * ------------------------------------------------------------
     * 4. Only allow actual Unsplash CDN URLs from raw HTML
     * ------------------------------------------------------------
     *
     * Do NOT accept arbitrary Blogger href URLs here.
     */

    const unsplashUrlRegex =
      /https?:\/\/images\.unsplash\.com\/[^\s"'<>\\]+/gi;

    let unsplashMatch;

    while (
      (unsplashMatch =
        unsplashUrlRegex.exec(windowHtml))
    ) {
      const url =
        unsplashMatch[0]
          .replace(/[),.;]+$/, "");

      addCandidate(
        candidates,
        url,
        "article-unsplash",
        1200,
        {
          attribute:
            "raw-unsplash-url",
          association:
            "article-body",
          reason:
            "unsplash-cdn-near-attribution",
        }
      );
    }
  }

  return candidates;
}
/* -------------------------------------------------------------------------- */
/* Feed parsing                                                               */
/* -------------------------------------------------------------------------- */

function extractFeedEntries(feedXml) {
  const entries = [];

  /*
   * Blogger can return either:
   *
   *   Atom: <entry>...</entry>
   *   RSS:  <item>...</item>
   *
   * The v12.0 parser only handled <entry>.
   */

  const isRss =
    /<rss\b/i.test(feedXml) ||
    /<channel\b/i.test(feedXml);

  const tagName = isRss ? "item" : "entry";

  const entryRegex = new RegExp(
    `<${tagName}\\b[\\s\\S]*?<\\/${tagName}\\s*>`,
    "gi"
  );

  let match;

  while ((match = entryRegex.exec(feedXml))) {
    const entry = match[0];

    const title =
      extractTagText(entry, "title") ||
      "";

    /*
     * Atom:
     *
     * <published>...</published>
     * <updated>...</updated>
     *
     * RSS:
     *
     * <pubDate>...</pubDate>
     */
    const published =
      extractTagText(entry, "published") ||
      extractTagText(entry, "pubDate") ||
      extractTagText(entry, "updated") ||
      "";

    /*
     * Blogger Atom uses:
     *
     * <summary>...</summary>
     * <content>...</content>
     *
     * RSS usually uses:
     *
     * <description>...</description>
     * <content:encoded>...</content:encoded>
     */
    const summary =
      extractTagRaw(entry, "summary") ||
      extractTagRaw(entry, "description") ||
      "";

    const content =
      extractTagRaw(entry, "content") ||
      extractTagRaw(entry, "content:encoded") ||
      extractTagRaw(entry, "description") ||
      "";

    const links = [];

    /*
     * ------------------------------------------------------------
     * Atom link format
     * ------------------------------------------------------------
     *
     * <link rel="alternate"
     *       type="text/html"
     *       href="https://..."/>
     *
     * ------------------------------------------------------------
     * RSS link format
     * ------------------------------------------------------------
     *
     * <link>https://...</link>
     * ------------------------------------------------------------
     */

    const atomLinkRegex =
      /<link\b[^>]*>/gi;

    let linkMatch;

    while ((linkMatch = atomLinkRegex.exec(entry))) {
      const attrs =
        parseAttributes(linkMatch[0]);

      if (attrs.href) {
        links.push({
          rel: attrs.rel || "",
          type: attrs.type || "",
          href: absoluteUrl(attrs.href),
        });
      }
    }

    /*
     * RSS <link> is text content, not an href attribute.
     */
    const rssLink =
      extractTagText(entry, "link");

    if (rssLink) {
      links.push({
        rel: "alternate",
        type: "text/html",
        href: absoluteUrl(rssLink),
      });
    }

    const alternate =
      links.find(
        (link) =>
          String(link.rel)
            .toLowerCase() ===
          "alternate"
      )?.href ||
      links.find(
        (link) =>
          String(link.type)
            .toLowerCase()
            .includes("text/html")
      )?.href ||
      links.find(
        (link) => link.href
      )?.href ||
      null;

    const categoryMatches = [];

    /*
     * Atom:
     *
     * <category term="Stocks"/>
     *
     * RSS:
     *
     * <category>Stocks</category>
     */
    const categoryRegex =
      /<category\b[^>]*>/gi;

    let categoryMatch;

    while (
      (categoryMatch =
        categoryRegex.exec(entry))
    ) {
      const attrs =
        parseAttributes(
          categoryMatch[0]
        );

      if (attrs.term) {
        categoryMatches.push(
          attrs.term
        );
      }
    }

    const rssCategoryRegex =
      /<category\b[^>]*>([\s\S]*?)<\/category\s*>/gi;

    let rssCategoryMatch;

    while (
      (rssCategoryMatch =
        rssCategoryRegex.exec(entry))
    ) {
      const category =
        normalizeWhitespace(
          stripHtml(
            rssCategoryMatch[1]
          )
        );

      if (
        category &&
        !categoryMatches.includes(
          category
        )
      ) {
        categoryMatches.push(
          category
        );
      }
    }

    /*
     * IMPORTANT
     *
     * Feed images are extracted ONLY from actual image
     * references in the feed content.
     *
     * We deliberately do NOT inspect arbitrary href values.
     *
     * This prevents:
     *
     * https://unsplash.com/@author
     *
     * from being treated as an image.
     */
    const feedCandidates = [
      ...extractImageCandidatesFromHtml(
        content,
        {
          source: "feed-content",
        }
      ),
      ...extractImageCandidatesFromHtml(
        summary,
        {
          source: "feed-summary",
        }
      ),
    ];

    for (
      const candidate of feedCandidates
    ) {
      candidate.association =
        "feed-content";
    }

    entries.push({
      title:
        normalizeWhitespace(
          stripHtml(title)
        ),

      published,

      url: alternate,

      summary,

      content,

      categories:
        categoryMatches,

      imageCandidates:
        feedCandidates,
    });
  }

  return entries;
}

function extractTagRaw(xml, tagName) {
  const escapedTag = escapeRegExp(tagName);

  const regex = new RegExp(
    `<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}\\s*>`,
    "i"
  );

  const match = xml.match(regex);

  return match ? match[1] : "";
}

function extractTagText(xml, tagName) {
  const escapedTag =
    escapeRegExp(tagName);

  const regex = new RegExp(
    `<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}\\s*>`,
    "i"
  );

  const match =
    xml.match(regex);

  return match
    ? normalizeWhitespace(
        stripHtml(match[1])
      )
    : "";
}

/* -------------------------------------------------------------------------- */
/* Candidate deduplication                                                    */
/* -------------------------------------------------------------------------- */

function dedupeCandidates(candidates) {
  const map = new Map();

  for (const candidate of candidates) {
    const key = candidate.url;

    const existing = map.get(key);

    if (!existing || candidate.score > existing.score) {
      map.set(key, candidate);
    }
  }

  return [...map.values()].sort(
    (a, b) => b.score - a.score
  );
}

/* -------------------------------------------------------------------------- */
/* Image validation                                                           */
/* -------------------------------------------------------------------------- */

function detectImageMagick() {
  let identifyCommand = null;
  let convertCommand = null;

  try {
    execFileSync("magick", ["-version"], {
      stdio: "ignore",
    });

    identifyCommand = "magick";
    convertCommand = "magick";
  } catch {
    try {
      execFileSync("identify", ["-version"], {
        stdio: "ignore",
      });

      identifyCommand = "identify";
      convertCommand = "convert";
    } catch {
      try {
        execFileSync("convert", ["-version"], {
          stdio: "ignore",
        });

        identifyCommand = "identify";
        convertCommand = "convert";
      } catch {
        throw new Error(
          "ImageMagick was not found. Install ImageMagick before capture."
        );
      }
    }
  }

  return {
    identifyCommand,
    convertCommand,
  };
}

const imageMagick = detectImageMagick();

log(`ImageMagick identify command: ${imageMagick.identifyCommand}`);
log(`ImageMagick convert command: ${imageMagick.convertCommand}`);

function magicBytesType(buffer) {
  if (!buffer || buffer.length < 12) {
    return null;
  }

  /*
   * JPEG
   */
  if (
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "jpeg";
  }

  /*
   * PNG
   */
  if (
    buffer[0] === 0x89 &&
    buffer.toString("ascii", 1, 4) === "PNG"
  ) {
    return "png";
  }

  /*
   * GIF
   */
  if (
    buffer.toString("ascii", 0, 6) === "GIF87a" ||
    buffer.toString("ascii", 0, 6) === "GIF89a"
  ) {
    return "gif";
  }

  /*
   * WEBP
   */
  if (
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }

  /*
   * AVIF / HEIF
   */
  if (
    buffer.toString("ascii", 4, 8) === "ftyp"
  ) {
    const brand = buffer
      .toString("ascii", 8, 16)
      .toLowerCase();

    if (
      brand.includes("avif") ||
      brand.includes("avis") ||
      brand.includes("heic") ||
      brand.includes("heix") ||
      brand.includes("mif1")
    ) {
      return "avif";
    }
  }

  /*
   * SVG
   */
  const beginning = buffer
    .toString("utf8", 0, Math.min(buffer.length, 1000))
    .trim()
    .toLowerCase();

  if (
    beginning.startsWith("<svg") ||
    beginning.startsWith("<?xml") &&
      beginning.includes("<svg")
  ) {
    return "svg";
  }

  return null;
}

function validateImageFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {
      valid: false,
      reason: "file-not-found",
    };
  }

  const stat = fs.statSync(filePath);

  if (stat.size < MIN_FILE_SIZE) {
    return {
      valid: false,
      reason: `file-too-small:${stat.size}`,
    };
  }

  const buffer = fs.readFileSync(filePath);

  const magicType = magicBytesType(buffer);

  if (!magicType) {
    return {
      valid: false,
      reason: "invalid-image-magic-bytes",
    };
  }

  let identifyArgs;

  if (imageMagick.identifyCommand === "magick") {
    identifyArgs = [
      "identify",
      "-format",
      "%m|%w|%h",
      filePath,
    ];
  } else {
    identifyArgs = [
      "-format",
      "%m|%w|%h",
      filePath,
    ];
  }

  try {
    const output = execFileSync(
      imageMagick.identifyCommand,
      identifyArgs,
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }
    ).trim();

    const [format, widthText, heightText] =
      output.split("|");

    const width = Number(widthText);
    const height = Number(heightText);

    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height)
    ) {
      return {
        valid: false,
        reason: "invalid-image-dimensions",
      };
    }

    if (
      width < MIN_WIDTH ||
      height < MIN_HEIGHT
    ) {
      return {
        valid: false,
        reason: `image-too-small:${width}x${height}`,
      };
    }

    return {
      valid: true,
      magicType,
      format,
      width,
      height,
      size: stat.size,
    };
  } catch (error) {
    return {
      valid: false,
      reason: `imagemagick-validation-failed:${error.message}`,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Perceptual fingerprint                                                     */
/* -------------------------------------------------------------------------- */

function perceptualFingerprint(filePath) {
  const outputDir = path.dirname(filePath);

  const tempFile = path.join(
    outputDir,
    `.fingerprint-${crypto.randomUUID()}.txt`
  );

  try {
    /*
     * Convert to a tiny grayscale image and calculate a simple
     * pixel hash. This is intentionally independent of the
     * original image encoding.
     */
    let args;

    if (imageMagick.convertCommand === "magick") {
      args = [
        filePath,
        "-resize",
        "16x16!",
        "-colorspace",
        "Gray",
        "-depth",
        "8",
        "txt:-",
      ];
    } else {
      args = [
        filePath,
        "-resize",
        "16x16!",
        "-colorspace",
        "Gray",
        "-depth",
        "8",
        "txt:-",
      ];
    }

    const output = execFileSync(
      imageMagick.convertCommand,
      args,
      {
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    const values = [];

    for (const line of output.split("\n")) {
      const match = line.match(
        /gray\((\d+)\)/i
      );

      if (match) {
        values.push(Number(match[1]));
      }
    }

    if (!values.length) {
      return null;
    }

    const average =
      values.reduce(
        (sum, value) => sum + value,
        0
      ) / values.length;

    return values
      .map((value) => (value >= average ? "1" : "0"))
      .join("");
  } catch {
    return null;
  } finally {
    try {
      fs.unlinkSync(tempFile);
    } catch {
      // ignore
    }
  }
}

function hammingDistance(a, b) {
  if (!a || !b || a.length !== b.length) {
    return Infinity;
  }

  let distance = 0;

  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      distance++;
    }
  }

  return distance;
}

/* -------------------------------------------------------------------------- */
/* Image download + validation                                                */
/* -------------------------------------------------------------------------- */

async function downloadAndValidateCandidate(
  candidate,
  index,
  usedHashes,
  usedFingerprints
) {
  log(
    `  Candidate score=${candidate.score} ` +
      `source=${candidate.source} ` +
      `association=${candidate.association || "unknown"}`
  );

  log(`  ${candidate.url}`);

  /*
   * Critical safety rule:
   *
   * A page-level / generic fallback is NEVER accepted.
   */
  const allowedAssociations = new Set([
    "article-og",
    "article-twitter",
    "article-meta",
    "article-body",
    "feed-content",
  ]);

  if (
    !candidate.association ||
    !allowedAssociations.has(candidate.association)
  ) {
    warn(
      `  Rejected: image is not article-specific.`
    );

    return null;
  }

  if (isUnsplashPageUrl(candidate.url)) {
    warn(
      `  Rejected: Unsplash page URL, not image URL.`
    );

    return null;
  }

  if (!isLikelyImageUrl(candidate.url)) {
    warn(
      `  Rejected: URL does not look like an image.`
    );

    return null;
  }

  let downloaded;

  try {
    downloaded =
      await fetchBinary(candidate.url);
  } catch (error) {
    warn(
      `  Download failed: ${error.message}`
    );

    return null;
  }

  const extension =
    magicBytesType(downloaded.bytes) ||
    "img";

  const filename =
    `post-${String(index).padStart(2, "0")}.${extension}`;

  const filePath =
    path.join(OUTPUT_DIR, filename);

  fs.writeFileSync(
    filePath,
    downloaded.bytes
  );

  const validation =
    validateImageFile(filePath);

  if (!validation.valid) {
    warn(
      `  Rejected: ${validation.reason}`
    );

    try {
      fs.unlinkSync(filePath);
    } catch {}

    return null;
  }

  const sha256 = crypto
    .createHash("sha256")
    .update(downloaded.bytes)
    .digest("hex");

  if (usedHashes.has(sha256)) {
    warn(
      `  Rejected: exact duplicate image.`
    );

    try {
      fs.unlinkSync(filePath);
    } catch {}

    return null;
  }

  const fingerprint =
    perceptualFingerprint(filePath);

  if (fingerprint) {
    for (const previous of usedFingerprints) {
      const distance =
        hammingDistance(
          fingerprint,
          previous.fingerprint
        );

      /*
       * 16x16 = 256 bits.
       *
       * Very small distance means visually identical
       * or almost identical image.
       */
      if (distance <= 8) {
        warn(
          `  Rejected: perceptual duplicate. ` +
            `distance=${distance}`
        );

        try {
          fs.unlinkSync(filePath);
        } catch {}

        return null;
      }
    }
  }

  usedHashes.add(sha256);

  if (fingerprint) {
    usedFingerprints.push({
      fingerprint,
      url: candidate.url,
    });
  }

  log(
    `  Accepted: ${validation.width}x${validation.height}, ` +
      `${validation.size} bytes`
  );

  return {
    localImage:
      path
        .relative(
          path.resolve(
            process.cwd(),
            "template/public"
          ),
          filePath
        )
        .split(path.sep)
        .join("/"),
    imageUrl: candidate.url,
    imageSource: candidate.source,
    imageAssociation:
      candidate.association,
    imageReason:
      candidate.reason || null,
    sha256,
    perceptualFingerprint:
      fingerprint,
    width: validation.width,
    height: validation.height,
    bytes: validation.size,
  };
}

/* -------------------------------------------------------------------------- */
/* Article-specific image resolution                                          */
/* -------------------------------------------------------------------------- */

async function resolveArticleImage(
  post,
  feedEntry,
  index,
  usedHashes,
  usedFingerprints
) {
  log("");
  log(
    `Post ${index}: ${post.title}`
  );
  log(`URL: ${post.url}`);

  /*
   * ------------------------------------------------------------------------
   * STEP 1
   * Exact article page
   * ------------------------------------------------------------------------
   */

  let articleHtml;

  try {
    articleHtml =
      await fetchText(post.url, {
        maxRetries: 3,
      });

    log(
      `Article page fetched: ${articleHtml.length} bytes`
    );
  } catch (error) {
    throw new Error(
      `Unable to fetch exact article page for Post ${index}: ` +
        error.message
    );
  }

  /*
   * ------------------------------------------------------------------------
   * STEP 2
   * Article-specific metadata
   * ------------------------------------------------------------------------
   */

  const metaCandidates =
    extractArticleMetaImages(
      articleHtml
    );

  log(
    `Article-specific meta image candidates: ${metaCandidates.length}`
  );

  /*
   * Metadata extracted from the exact article URL is
   * inherently article-specific.
   */
  for (const candidate of metaCandidates) {
    candidate.association =
      candidate.source.startsWith("article-")
        ? candidate.source
        : "article-meta";
  }

  const sortedMeta =
    dedupeCandidates(metaCandidates);

  for (const candidate of sortedMeta) {
    const result =
      await downloadAndValidateCandidate(
        candidate,
        index,
        usedHashes,
        usedFingerprints
      );

    if (result) {
      log(
        `Selected article-specific image: ${result.imageSource}`
      );

      return result;
    }
  }

  /*
   * ------------------------------------------------------------------------
   * STEP 3
   * Locate exact post container
   * ------------------------------------------------------------------------
   */

  const postRegion =
    findExactPostRegion(
      articleHtml,
      post.title
    );

  if (!postRegion) {
    warn(
      `Exact post container: NOT FOUND`
    );
  } else {
    log(
      `Exact post container: FOUND ` +
        `(tag=${postRegion.tagName}, ` +
        `class=${postRegion.className || "none"}, ` +
        `length=${postRegion.html.length})`
    );
  }

  if (postRegion) {
    /*
     * ----------------------------------------------------------------------
     * STEP 4
     * Actual images inside exact post body
     * ----------------------------------------------------------------------
     */

    const bodyCandidates =
      extractImageCandidatesFromHtml(
        postRegion.html,
        {
          source: "post-body",
        }
      );

    for (const candidate of bodyCandidates) {
      candidate.association =
        "article-body";
    }

    log(
      `Exact post-body image candidates: ${bodyCandidates.length}`
    );

    /*
     * Unsplash attribution-specific candidates get priority.
     */
    const attributionCandidates =
      findUnsplashAttributionCandidates(
        postRegion.html
      );

    log(
      `Unsplash-attribution candidates: ${attributionCandidates.length}`
    );

    const combined =
      dedupeCandidates([
        ...attributionCandidates,
        ...bodyCandidates,
      ]);

    for (const candidate of combined) {
      const result =
        await downloadAndValidateCandidate(
          candidate,
          index,
          usedHashes,
          usedFingerprints
        );

      if (result) {
        log(
          `Selected article-specific image: ${result.imageSource}`
        );

        return result;
      }
    }
  }

  /*
   * ------------------------------------------------------------------------
   * STEP 5
   * Feed content fallback
   *
   * IMPORTANT:
   *
   * This is still restricted to actual <img>/<source>/srcset
   * image references in THIS feed entry.
   *
   * Generic feed hrefs are never accepted.
   * ------------------------------------------------------------------------
   */

  const feedCandidates =
    feedEntry?.imageCandidates || [];

  for (const candidate of feedCandidates) {
    candidate.association =
      "feed-content";
  }

  log(
    `Exact feed-entry image candidates: ${feedCandidates.length}`
  );

  const sortedFeed =
    dedupeCandidates(feedCandidates);

  for (const candidate of sortedFeed) {
    const result =
      await downloadAndValidateCandidate(
        candidate,
        index,
        usedHashes,
        usedFingerprints
      );

    if (result) {
      log(
        `Selected article-specific image: feed-content`
      );

      return result;
    }
  }

  /*
   * ------------------------------------------------------------------------
   * STEP 6
   *
   * NO generic fallback.
   *
   * This is intentional.
   * ------------------------------------------------------------------------
   */

  throw new Error(
    `No article-specific image could be verified for Post ${index}. ` +
      `Capture aborted to prevent title/image mismatch.`
  );
}

/* -------------------------------------------------------------------------- */
/* Blog metadata                                                              */
/* -------------------------------------------------------------------------- */

function extractPageMetadata(html) {
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
    ) ||
    null;

  const language =
    extractHtmlLang(html) ||
    "en";

  return {
    title: normalizeWhitespace(
      stripHtml(title)
    ),
    description: normalizeWhitespace(
      stripHtml(description)
    ),
    ogImage: absoluteUrl(ogImage),
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

  while ((match = regex.exec(html))) {
    const attrs =
      parseAttributes(match[0]);

    if (
      String(
        attrs[attribute] || ""
      ).toLowerCase() ===
      String(value).toLowerCase()
    ) {
      return attrs.content || null;
    }
  }

  return null;
}

function extractHtmlLang(html) {
  const match =
    html.match(
      /<html\b[^>]*\blang=["']([^"']+)["']/i
    );

  return match ? match[1] : null;
}

/* -------------------------------------------------------------------------- */
/* Main                                                                       */
/* -------------------------------------------------------------------------- */

async function main() {
  log("");
  log("====================================================");
  log("BLOG ANALYZER v12.0");
  log("====================================================");
  log("Exact article-specific image association");
  log("Nesting-aware post container extraction");
  log("No site-wide image fallback");
  log("Real-image validation after download");
  log("Exact + perceptual duplicate protection");
  log("FAIL if article-specific image is not verified");
  log("====================================================");
  log("");

  fs.mkdirSync(
    OUTPUT_DIR,
    {
      recursive: true,
    }
  );

  /*
   * Clean previous captured images.
   */
  for (const filename of fs.readdirSync(
    OUTPUT_DIR
  )) {
    if (
      /^post-\d+\.(jpg|jpeg|png|gif|webp|avif|svg|bmp)$/i.test(
        filename
      )
    ) {
      try {
        fs.unlinkSync(
          path.join(
            OUTPUT_DIR,
            filename
          )
        );
      } catch {}
    }
  }

  /*
   * ------------------------------------------------------------------------
   * Feed
   * ------------------------------------------------------------------------
   */

  const feedUrl =
    new URL(
      "/feeds/posts/default?alt=atom&max-results=10",
      BLOG_URL
    ).href;

  log(`Feed URL: ${feedUrl}`);

  let feedXml;

  try {
    feedXml =
      await fetchText(feedUrl, {
        maxRetries: 4,
      });
  } catch (error) {
    throw new Error(
      `Feed fetch failed: ${error.message}`
    );
  }

  const feedEntries =
    extractFeedEntries(feedXml);

  log(
    `Feed fetched successfully.`
  );

  log(
    `Feed entries: ${feedEntries.length}`
  );

  if (!feedEntries.length) {
    throw new Error(
      "No feed entries were found."
    );
  }

  /*
   * ------------------------------------------------------------------------
   * Blog homepage metadata
   *
   * This metadata is allowed for site identity only.
   * It is NEVER used as a post image.
   * ------------------------------------------------------------------------
   */

  let homepageHtml = "";

  try {
    homepageHtml =
      await fetchText(BLOG_URL, {
        maxRetries: 2,
      });
  } catch (error) {
    warn(
      `Homepage metadata fetch failed: ${error.message}`
    );
  }

  const pageMetadata =
    extractPageMetadata(
      homepageHtml
    );

  /*
   * ------------------------------------------------------------------------
   * Select first five feed entries
   * ------------------------------------------------------------------------
   */

  const posts = [];

  for (
    let i = 0;
    i < Math.min(
      MAX_POSTS,
      feedEntries.length
    );
    i++
  ) {
    const entry =
      feedEntries[i];

    if (!entry.url) {
      throw new Error(
        `Feed entry ${i + 1} has no article URL.`
      );
    }

    posts.push({
      index: i + 1,
      title: entry.title,
      url: entry.url,
      published: entry.published,
      date: entry.published
        ? entry.published.slice(0, 10)
        : null,
      excerpt: normalizeWhitespace(
        stripHtml(
          entry.summary ||
            entry.content ||
            ""
        )
      ).slice(0, 500),
      categories:
        entry.categories,
      feedEntry: entry,
    });
  }

  if (posts.length < 5) {
    throw new Error(
      `Only ${posts.length} usable posts found. ` +
        `At least 5 posts are required.`
    );
  }

  /*
   * ------------------------------------------------------------------------
   * Capture images
   * ------------------------------------------------------------------------
   */

  const usedHashes = new Set();
  const usedFingerprints = [];

  const capturedPosts = [];

  for (const post of posts) {
    const image =
      await resolveArticleImage(
        post,
        post.feedEntry,
        post.index,
        usedHashes,
        usedFingerprints
      );

    if (!image) {
      throw new Error(
        `Post ${post.index} did not produce a verified article-specific image.`
      );
    }

    /*
     * Absolute safety check.
     */
    if (
      !image.imageAssociation ||
      ![
        "article-og",
        "article-twitter",
        "article-meta",
        "article-body",
        "feed-content",
      ].includes(
        image.imageAssociation
      )
    ) {
      throw new Error(
        `Post ${post.index}: invalid image association ` +
          `"${image.imageAssociation}".`
      );
    }

    capturedPosts.push({
      index: post.index,
      title: post.title,
      url: post.url,
      published: post.published,
      date: post.date,
      excerpt: post.excerpt,
      categories: post.categories,
      localImage: image.localImage,
      imageUrl: image.imageUrl,
      imageSource: image.imageSource,
      imageAssociation:
        image.imageAssociation,
      imageReason:
        image.imageReason,
      imageStats: {
        sha256: image.sha256,
        perceptualFingerprint:
          image.perceptualFingerprint,
        width: image.width,
        height: image.height,
        bytes: image.bytes,
      },
    });
  }

  /*
   * ------------------------------------------------------------------------
   * Final validation
   * ------------------------------------------------------------------------
   */

  if (capturedPosts.length !== 5) {
    throw new Error(
      `Expected 5 captured posts, got ${capturedPosts.length}.`
    );
  }

  const localImages =
    capturedPosts.map(
      (post) => post.localImage
    );

  const uniqueLocalImages =
    new Set(localImages);

  if (
    uniqueLocalImages.size !==
    capturedPosts.length
  ) {
    throw new Error(
      "Duplicate localImage references detected."
    );
  }

  const hashes =
    capturedPosts.map(
      (post) =>
        post.imageStats.sha256
    );

  if (
    new Set(hashes).size !==
    hashes.length
  ) {
    throw new Error(
      "Duplicate image SHA-256 detected."
    );
  }

  for (const post of capturedPosts) {
    if (
      !post.imageAssociation
    ) {
      throw new Error(
        `Post ${post.index}: missing imageAssociation.`
      );
    }

    if (
      post.imageSource === "fallback" ||
      post.imageSource === "post-meta" ||
      post.imageAssociation === "fallback"
    ) {
      throw new Error(
        `Post ${post.index}: forbidden fallback image source detected.`
      );
    }
  }

  /*
   * ------------------------------------------------------------------------
   * Site analysis
   * ------------------------------------------------------------------------
   */

  const topicText =
    capturedPosts
      .map(
        (post) =>
          `${post.title} ${post.excerpt}`
      )
      .join(" ");

  const analysis = {
    identity:
      pageMetadata.title ||
      "Funds Up",
    topics: [
      "US stock market",
      "market news",
      "technology stocks",
      "financial markets",
    ],
    audience:
      "Investors and readers interested in financial markets and stock-market news.",
    contentStyle:
      "Concise market-news summaries focused on actionable financial information.",
    valueProposition:
      "Fast summaries of market movements, signals, and major financial developments.",
  };

  /*
   * ------------------------------------------------------------------------
   * blog.json
   * ------------------------------------------------------------------------
   */

  const output = {
    version: 4,
    capturedAt:
      new Date().toISOString(),
    url: BLOG_URL,
    hostname:
      new URL(BLOG_URL).hostname,
    siteTitle:
      pageMetadata.title ||
      "Funds Up",
    description:
      pageMetadata.description ||
      "",
    pageHeading:
      pageMetadata.title ||
      "Funds Up",
    /*
     * IMPORTANT:
     *
     * This is site metadata only.
     * It is NOT used as a post image.
     */
    ogImage:
      pageMetadata.ogImage,
    language:
      pageMetadata.language ||
      "en",
    postCount:
      capturedPosts.length,
    analysis,
    posts:
      capturedPosts.map(
        (post) => ({
          index: post.index,
          title: post.title,
          url: post.url,
          published: post.published,
          date: post.date,
          excerpt: post.excerpt,
          categories: post.categories,
          localImage:
            post.localImage,
          imageSource:
            post.imageSource,
          imageAssociation:
            post.imageAssociation,
          imageReason:
            post.imageReason,
          imageUrl:
            post.imageUrl,
          imageStats:
            post.imageStats,
        })
      ),
    imageStats: {
      realImages:
        capturedPosts.length,
      uniqueImages:
        uniqueLocalImages.size,
      uniqueHashes:
        new Set(hashes).size,
      articleSpecific:
        capturedPosts.length,
    },
  };

  fs.mkdirSync(
    path.dirname(BLOG_JSON),
    {
      recursive: true,
    }
  );

  fs.writeFileSync(
    BLOG_JSON,
    JSON.stringify(
      output,
      null,
      2
    ) + "\n",
    "utf8"
  );

  /*
   * ------------------------------------------------------------------------
   * Final success output
   * ------------------------------------------------------------------------
   */

  log("");
  log("====================================================");
  log("BLOG ANALYZER v12.0 SUCCESS");
  log("====================================================");

  for (const post of capturedPosts) {
    log(
      `Post ${post.index}: ${post.title}`
    );

    log(
      `  Image: ${post.localImage}`
    );

    log(
      `  Source: ${post.imageSource}`
    );

    log(
      `  Association: ${post.imageAssociation}`
    );

    log(
      `  URL: ${post.imageUrl}`
    );
  }

  log("");
  log(
    `blog.json: ${BLOG_JSON}`
  );
  log(
    `Images: ${capturedPosts.length}`
  );
  log(
    `Unique images: ${uniqueLocalImages.size}`
  );
  log(
    `Article-specific images: ${capturedPosts.length}`
  );
  log("====================================================");
}

main().catch((error) => {
  console.error("");
  console.error("====================================================");
  console.error("BLOG ANALYZER v12.0 FAILED");
  console.error("====================================================");
  console.error(error?.stack || error?.message || error);
  console.error("====================================================");

  process.exit(1);
});
