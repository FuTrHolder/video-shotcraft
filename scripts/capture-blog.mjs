#!/usr/bin/env node

/**
 * capture-blog.mjs v14.0
 *
 * Purpose:
 *   Capture Blogger posts and their article-specific images.
 *
 * Critical rules:
 *   1. NEVER use a site-wide/homepage image as a post image.
 *   2. NEVER use a generic fallback image.
 *   3. A post is accepted only when its image can be proven
 *      to belong to that exact article/feed entry.
 *   4. If one candidate post fails image verification,
 *      skip it and continue searching the feed.
 *   5. Capture exactly MAX_POSTS verified posts.
 *
 * Image association priority:
 *   1. Exact article og:image
 *   2. Exact article twitter:image
 *   3. Exact article image_src
 *   4. Exact post-body image
 *   5. Image near Unsplash attribution inside exact post-body
 *   6. Valid feed-content image belonging to exact feed entry
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
const MAX_FEED_ENTRIES = 10;
const FETCH_TIMEOUT = 30000;
const IMAGE_FETCH_TIMEOUT = 60000;
const IMAGE_MAX_RETRIES = 4;
const CURL_MAX_BYTES = 50 * 1024 * 1024;

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

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
  return String(value || "").replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
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
          `HTTP ${response.status} for ${url}. ` +
            `Retrying in ${delay}ms...`
        );

        await sleep(delay);
        continue;
      }

      throw new Error(
        `HTTP ${response.status} ${response.statusText}`
      );
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
  let lastError = null;

  /*
   * First try Node/undici.  Images hosted outside Blogger (for example
   * i.ibb.co) can occasionally fail at the connection layer even when the
   * same URL is reachable with curl.  We therefore keep curl as a fallback.
   */
  for (let attempt = 1; attempt <= IMAGE_MAX_RETRIES; attempt++) {
    let timer = null;

    try {
      const controller = new AbortController();

      timer = setTimeout(() => {
        controller.abort();
      }, IMAGE_FETCH_TIMEOUT);

      const response = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent": USER_AGENT,
          Accept:
            "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          Connection: "keep-alive",
        },
      });

      if (response.ok) {
        const bytes = Buffer.from(await response.arrayBuffer());

        if (!bytes.length) {
          throw new Error("HTTP 200 but response body was empty");
        }

        log(
          `  Image download succeeded via Node fetch ` +
            `(attempt ${attempt}/${IMAGE_MAX_RETRIES}, ` +
            `${bytes.length} bytes, HTTP ${response.status})`
        );

        return {
          bytes,
          contentType:
            response.headers.get("content-type") || "",
          finalUrl: response.url || url,
          method: "node-fetch",
        };
      }

      const status = response.status;
      const statusText = response.statusText || "";
      lastError = new Error(
        `HTTP ${status} ${statusText}`.trim()
      );

      warn(
        `  Image download attempt ${attempt}/${IMAGE_MAX_RETRIES} ` +
          `returned HTTP ${status} for ${url}`
      );

      if (
        !(
          status === 408 ||
          status === 425 ||
          status === 429 ||
          status >= 500
        )
      ) {
        break;
      }
    } catch (error) {
      lastError = error;

      warn(
        `  Image download attempt ${attempt}/${IMAGE_MAX_RETRIES} failed.`
      );
      warn(`    URL: ${url}`);
      warn(`    Error: ${error?.message || error}`);
      warn(`    Name: ${error?.name || "unknown"}`);

      if (error?.cause) {
        warn(
          `    Cause: ${error.cause.code || "unknown"} ` +
            `${error.cause.message || ""}`.trim()
        );
      }
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (attempt < IMAGE_MAX_RETRIES) {
      const delay = Math.min(8000, 1000 * 2 ** (attempt - 1));
      warn(`    Retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }

  /*
   * Fallback: curl is normally available on GitHub-hosted Ubuntu runners.
   * This is deliberately a fallback, not the primary path, so the normal
   * Node implementation remains portable.
   */
  try {
    execFileSync("curl", ["--version"], {
      stdio: "ignore",
      timeout: 5000,
    });

    log("  Node image fetch failed; trying curl fallback...");

    const curlArgs = [
      "--location",
      "--fail",
      "--silent",
      "--show-error",
      "--compressed",
      "--max-time",
      String(Math.ceil(IMAGE_FETCH_TIMEOUT / 1000)),
      "--connect-timeout",
      "20",
      "--retry",
      "2",
      "--retry-delay",
      "2",
      "--retry-all-errors",
      "-A",
      USER_AGENT,
      "-H",
      "Accept: image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      url,
    ];

    const bytes = execFileSync("curl", curlArgs, {
      encoding: "buffer",
      maxBuffer: CURL_MAX_BYTES,
      timeout: IMAGE_FETCH_TIMEOUT + 10000,
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (!bytes || !bytes.length) {
      throw new Error("curl returned an empty response body");
    }

    log(
      `  Image download succeeded via curl ` +
        `(${bytes.length} bytes)`
    );

    return {
      bytes: Buffer.from(bytes),
      contentType: "",
      finalUrl: url,
      method: "curl",
    };
  } catch (error) {
    const curlMessage =
      error?.stderr?.toString?.("utf8")?.trim() ||
      error?.message ||
      String(error);

    warn(`  curl fallback failed: ${curlMessage}`);

    const detail = lastError
      ? `${lastError.name || "Error"}: ${lastError.message || lastError}`
      : "no previous Node fetch error";

    throw new Error(
      `Unable to download image. Node fetch: ${detail}. ` +
        `curl: ${curlMessage}`
    );
  }
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

function isBloggerImageUrl(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();

    if (
      hostname === "blogger.googleusercontent.com" &&
      pathname.includes("/img/")
    ) {
      return true;
    }

    if (
      hostname === "bp.blogspot.com" ||
      hostname.endsWith(".bp.blogspot.com")
    ) {
      return true;
    }

    return false;
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
   * Blogger image hosts only.
   *
   * IMPORTANT:
   * Do not accept every googleusercontent.com/blogspot.com URL.
   * A normal Blogger article URL must never be considered an image.
   */
  if (isBloggerImageUrl(value)) {
    return true;
  }

  /*
   * Unsplash CDN.
   */
  if (isUnsplashImageUrl(value)) {
    return true;
  }

  const pathname = parsed.pathname.toLowerCase();

  /*
   * Conventional image extensions.
   */
  if (
    /\.(jpe?g|png|gif|webp|avif|bmp|svg|tiff?)$/i.test(
      pathname
    )
  ) {
    return true;
  }

  /*
   * Other known image/CDN hosts.
   */
  if (
    parsed.hostname.includes("cloudinary.com") ||
    parsed.hostname.includes("images.") ||
    parsed.hostname.includes("image.") ||
    parsed.hostname.includes("img.")
  ) {
    return true;
  }

  return false;
}

function normalizeBloggerImageUrl(url) {
  if (!url) return null;

  let value = decodeEscapedUrl(url);

  if (!isBloggerImageUrl(value)) {
    return null;
  }

  try {
    const parsed = new URL(value);

    parsed.pathname = parsed.pathname
      .replace(
        /\/s\d+(?:-[a-z0-9]+)?\//i,
        "/s1600/"
      )
      .replace(
        /\/w\d+(?:-h\d+)?\//i,
        "/s1600/"
      )
      .replace(
        /\/h\d+(?:-w\d+)?\//i,
        "/s1600/"
      );

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

function extractImageCandidatesFromHtml(
  html,
  options = {}
) {
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

    for (
      const src of extractSrcsetUrls(
        attrs.srcset ||
          attrs["data-srcset"]
      )
    ) {
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
  const sourceRegex =
    /<source\b[^>]*>/gi;

  while ((match = sourceRegex.exec(html))) {
    const attrs =
      parseAttributes(match[0]);

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

    for (
      const src of extractSrcsetUrls(
        attrs.srcset
      )
    ) {
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
  const cssUrlRegex =
    /url\(\s*(['"]?)(https?:\/\/.*?)\1\s*\)/gi;

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
   * <a href="image">
   *
   * Only accept known image hosts.
   * Never accept Blogger article/navigation URLs.
   */
  const anchorRegex =
    /<a\b[^>]*>/gi;

  while ((match = anchorRegex.exec(html))) {
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

    if (isUnsplashPageUrl(normalizedHref)) {
      continue;
    }

    const lower =
      normalizedHref.toLowerCase();

    const isKnownImageHost =
      isBloggerImageUrl(normalizedHref) ||
      isUnsplashImageUrl(normalizedHref) ||
      lower.includes("images.pexels.com/") ||
      lower.includes("cloudinary.com/");

    if (!isKnownImageHost) {
      continue;
    }

    addCandidate(
      candidates,
      normalizedHref,
      options.source || "article-body",
      620,
      {
        attribute: "href",
      }
    );
  }

  return candidates;
}

/* -------------------------------------------------------------------------- */
/* Meta image extraction                                                      */
/* -------------------------------------------------------------------------- */

function extractArticleMetaImages(html) {
  const candidates = [];

  if (!html) return candidates;

  const metaRegex =
    /<meta\b[^>]*>/gi;

  let match;

  while ((match = metaRegex.exec(html))) {
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

    if (property === "og:image") {
      addCandidate(
        candidates,
        content,
        "article-og",
        1200,
        {
          metaType: "og:image",
          association: "article-og",
        }
      );
    }

    if (property === "twitter:image") {
      addCandidate(
        candidates,
        content,
        "article-twitter",
        1150,
        {
          metaType: "twitter:image",
          association: "article-twitter",
        }
      );
    }

    if (
      property === "twitter:image:src"
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
      property === "image_src" ||
      property === "image" ||
      property === "thumbnail"
    ) {
      addCandidate(
        candidates,
        content,
        "article-meta",
        1100,
        {
          metaType: property,
          association:
            "article-meta",
        }
      );
    }
  }

  /*
   * <link rel="image_src" href="...">
   */
  const linkRegex =
    /<link\b[^>]*>/gi;

  while ((match = linkRegex.exec(html))) {
    const attrs =
      parseAttributes(match[0]);

    const rel = String(
      attrs.rel || ""
    ).toLowerCase();

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
          metaType:
            "link:image_src",
          association:
            "article-meta",
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

function parseTagToken(
  tagText,
  position
) {
  const closing =
    /^<\s*\//.test(tagText);

  const nameMatch =
    tagText.match(
      /^<\s*\/?\s*([a-z0-9]+)/i
    );

  if (!nameMatch) return null;

  const name =
    nameMatch[1].toLowerCase();

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

function findHeadingForTitle(
  html,
  title
) {
  const target =
    normalizeComparableText(title);

  const headingRegex =
    /<h([1-6])\b[^>]*>[\s\S]*?<\/h\1\s*>/gi;

  let match;

  while ((match = headingRegex.exec(html))) {
    const headingText =
      normalizeComparableText(
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
        end:
          match.index +
          match[0].length,
        level: Number(match[1]),
        text: headingText,
      };
    }
  }

  return null;
}

function blockMatchesPost(attrs) {
  const classValue =
    String(attrs.class || "")
      .toLowerCase();

  const idValue =
    String(attrs.id || "")
      .toLowerCase();

  const itemprop =
    String(attrs.itemprop || "")
      .toLowerCase();

  const semantic =
    `${classValue} ${idValue} ${itemprop}`;

  /*
   * Title/header blocks are NOT article containers.
   */
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
    patterns.some(
      (pattern) =>
        pattern.test(semantic)
    ) ||
    itemprop
      .split(/\s+/)
      .includes("articlebody")
  );
}

function findExactPostRegion(
  html,
  title
) {
  const heading =
    findHeadingForTitle(
      html,
      title
    );

  if (!heading) {
    return null;
  }

  const tagRegex =
    /<\/?[a-z0-9][^>]*>/gi;

  const stack = [];

  let match;

  while (
    (match = tagRegex.exec(html))
  ) {
    const position =
      match.index;

    if (
      position >
      heading.start
    ) {
      break;
    }

    const token =
      parseTagToken(
        match[0],
        position
      );

    if (!token) continue;

    if (token.closing) {
      for (
        let i =
          stack.length - 1;
        i >= 0;
        i--
      ) {
        if (
          stack[i].name ===
          token.name
        ) {
          stack.splice(i, 1);
          break;
        }
      }

      continue;
    }

    if (token.selfClosing) {
      continue;
    }

    const attrs =
      parseAttributes(
        token.text
      );

    stack.push({
      name: token.name,
      start: token.position,
      attrs,
    });
  }

  const ancestors = [];

  for (
    const ancestor of stack
  ) {
    const attrs =
      ancestor.attrs || {};

    if (
      ancestor.name === "article" ||
      blockMatchesPost(attrs)
    ) {
      ancestors.push(
        ancestor
      );
    }
  }

  if (!ancestors.length) {
    return null;
  }

  /*
   * Prefer the smallest / innermost
   * matching semantic container.
   */
  const selected =
    ancestors[
      ancestors.length - 1
    ];

  const end =
    findMatchingClosingTag(
      html,
      selected.start,
      selected.name
    );

  if (!end) {
    return null;
  }

  return {
    html: html.slice(
      selected.start,
      end
    ),
    start:
      selected.start,
    end,
    tagName:
      selected.name,
    className:
      selected.attrs.class ||
      "",
    heading,
  };
}

function findMatchingClosingTag(
  html,
  openingStart,
  tagName
) {
  const tagRegex =
    /<\/?[a-z0-9][^>]*>/gi;

  tagRegex.lastIndex =
    openingStart;

  let depth = 0;

  let match;

  while (
    (match = tagRegex.exec(html))
  ) {
    const token =
      parseTagToken(
        match[0],
        match.index
      );

    if (
      !token ||
      token.name !== tagName
    ) {
      continue;
    }

    if (token.closing) {
      depth--;

      if (depth === 0) {
        return (
          match.index +
          match[0].length
        );
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

function findUnsplashAttributionCandidates(
  blockHtml
) {
  const candidates = [];

  if (!blockHtml) {
    return candidates;
  }

  const searchableHtml = decodeHtml(blockHtml);

  const attributionRegex =
    /Photo\s+by[\s\S]{0,800}?Unsplash/gi;

  let match;

  while (
    (match =
      attributionRegex.exec(
        searchableHtml
      ))
  ) {
    const start =
      Math.max(
        0,
        match.index - 5000
      );

    const end =
      Math.min(
        blockHtml.length,
        match.index +
          match[0].length +
          5000
      );

    const windowHtml =
      blockHtml.slice(
        start,
        end
      );

    /*
     * <img>
     */
    const imgRegex =
      /<img\b[^>]*>/gi;

    let imgMatch;

    while (
      (imgMatch =
        imgRegex.exec(
          windowHtml
        ))
    ) {
      const attrs =
        parseAttributes(
          imgMatch[0]
        );

      const imageAttributes = [
        "src",
        "data-src",
        "data-original",
        "data-lazy-src",
        "data-image",
        "data-url",
        "data-original-src",
      ];

      for (
        const attribute of
          imageAttributes
      ) {
        if (
          !attrs[attribute]
        ) {
          continue;
        }

        const url =
          attrs[attribute];

        if (
          !isLikelyImageUrl(
            url
          )
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
            association:
              "article-body",
            reason:
              "unsplash-attribution-img",
          }
        );
      }

      /*
       * srcset
       */
      if (attrs.srcset) {
        for (
          const url of
            extractSrcsetUrls(
              attrs.srcset
            )
        ) {
          if (
            !isLikelyImageUrl(
              url
            )
          ) {
            continue;
          }

          addCandidate(
            candidates,
            url,
            "article-unsplash",
            1080,
            {
              attribute:
                "srcset",
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
     * <source>
     */
    const sourceRegex =
      /<source\b[^>]*>/gi;

    let sourceMatch;

    while (
      (sourceMatch =
        sourceRegex.exec(
          windowHtml
        ))
    ) {
      const attrs =
        parseAttributes(
          sourceMatch[0]
        );

      if (attrs.src) {
        addCandidate(
          candidates,
          attrs.src,
          "article-unsplash",
          1070,
          {
            attribute: "src",
            association:
              "article-body",
            reason:
              "unsplash-attribution-source",

                          association:
                "article-body",
              reason:
                "unsplash-attribution-source",
            }
        );
      }

      if (attrs.srcset) {
        for (
          const url of
            extractSrcsetUrls(
              attrs.srcset
            )
        ) {
          if (
            !isLikelyImageUrl(
              url
            )
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
                "srcset",
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
     * Look for concrete image URLs in
     * the local attribution window.
     */
    const concreteUrlRegex =
      /https?:\/\/[^\s"'<>]+/gi;

    let urlMatch;

    while (
      (urlMatch =
        concreteUrlRegex.exec(
          windowHtml
        ))
    ) {
      let url =
        urlMatch[0];

      url = url
        .replace(
          /[),.;]+$/g,
          ""
        )
        .trim();

      if (
        !isLikelyImageUrl(
          url
        )
      ) {
        continue;
      }

      addCandidate(
        candidates,
        url,
        "article-unsplash",
        1000,
        {
          attribute:
            "nearby-url",
          association:
            "article-body",
          reason:
            "unsplash-attribution-url",
        }
      );
    }
  }

  return candidates;
}

/* -------------------------------------------------------------------------- */
/* Feed extraction                                                            */
/* -------------------------------------------------------------------------- */

function extractXmlTag(
  xml,
  tagName
) {
  const regex =
    new RegExp(
      `<${escapeRegExp(
        tagName
      )}\\b[^>]*>([\\s\\S]*?)<\\/${escapeRegExp(
        tagName
      )}\\s*>`,
      "i"
    );

  const match =
    xml.match(regex);

  return match
    ? match[1]
    : "";
}

function extractXmlAttribute(
  tag,
  attribute
) {
  const regex =
    new RegExp(
      `${escapeRegExp(
        attribute
      )}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
      "i"
    );

  const match =
    tag.match(regex);

  if (!match) {
    return "";
  }

  return decodeEscapedUrl(
    match[1] ??
      match[2] ??
      match[3] ??
      ""
  );
}

function parseFeedLink(
  linkTag
) {
  const href =
    extractXmlAttribute(
      linkTag,
      "href"
    );

  const rel =
    extractXmlAttribute(
      linkTag,
      "rel"
    ).toLowerCase();

  if (
    href &&
    (!rel || rel === "alternate")
  ) {
    return absoluteUrl(
      href
    );
  }

  const text =
    stripHtml(
      linkTag
    );

  if (text) {
    return absoluteUrl(
      text
    );
  }

  return null;
}

function extractFeedEntries(
  feedXml
) {
  const entries = [];

  /*
   * Atom
   */
  const atomRegex =
    /<entry\b[\s\S]*?<\/entry\s*>/gi;

  let match;

  while (
    (match =
      atomRegex.exec(feedXml))
  ) {
    const entryXml =
      match[0];

    const title =
      normalizeText(
        stripHtml(
          extractXmlTag(
            entryXml,
            "title"
          )
        )
      );

    if (!title) {
      continue;
    }

    const published =
      normalizeText(
        stripHtml(
          extractXmlTag(
            entryXml,
            "published"
          )
        )
      );

    const updated =
      normalizeText(
        stripHtml(
          extractXmlTag(
            entryXml,
            "updated"
          )
        )
      );

    const summary =
      extractXmlTag(
        entryXml,
        "summary"
      );

    const content =
      extractXmlTag(
        entryXml,
        "content"
      );

    const linkTags =
      entryXml.match(
        /<link\b[^>]*>/gi
      ) || [];

    let url = null;

    for (
      const linkTag of
        linkTags
    ) {
      const parsed =
        parseFeedLink(
          linkTag
        );

      if (parsed) {
        url = parsed;
        break;
      }
    }

    if (!url) {
      continue;
    }

    const categories = [];

    const categoryRegex =
      /<category\b[^>]*>/gi;

    let categoryMatch;

    while (
      (categoryMatch =
        categoryRegex.exec(
          entryXml
        ))
    ) {
      const term =
        extractXmlAttribute(
          categoryMatch[0],
          "term"
        );

      if (term) {
        categories.push(
          normalizeText(term)
        );
      }
    }

    const imageCandidates = [];

    /*
     * Decode feed HTML before looking for
     * embedded images.
     *
     * Blogger feeds often entity-encode
     * the content HTML.
     */
    const decodedContent =
      decodeHtml(content);

    const decodedSummary =
      decodeHtml(summary);

    imageCandidates.push(
      ...extractImageCandidatesFromHtml(
        decodedContent,
        {
          source:
            "feed-content",
        }
      )
    );

    imageCandidates.push(
      ...extractImageCandidatesFromHtml(
        decodedSummary,
        {
          source:
            "feed-content",
        }
      )
    );

    /*
     * Direct Atom media namespace support.
     *
     * Examples:
     *   <media:content url="...">
     *   <media:thumbnail url="...">
     */
    const mediaRegex =
      /<media:(?:content|thumbnail)\b[^>]*>/gi;

    let mediaMatch;

    while (
      (mediaMatch =
        mediaRegex.exec(
          entryXml
        ))
    ) {
      const mediaTag =
        mediaMatch[0];

      const mediaUrl =
        extractXmlAttribute(
          mediaTag,
          "url"
        ) ||
        extractXmlAttribute(
          mediaTag,
          "src"
        ) ||
        extractXmlAttribute(
          mediaTag,
          "href"
        );

      if (!mediaUrl) {
        continue;
      }

      addCandidate(
        imageCandidates,
        mediaUrl,
        "feed-content",
        900,
        {
          attribute:
            "media:url",
          association:
            "feed-entry",
        }
      );
    }

    entries.push({
      title,
      url,
      published:
        published ||
        updated ||
        null,
      updated:
        updated ||
        null,
      summary:
        stripHtml(
          decodedSummary
        ),
      content:
        decodedContent,
      categories,
      imageCandidates,
      raw:
        entryXml,
    });
  }

  /*
   * RSS fallback.
   */
  if (!entries.length) {
    const itemRegex =
      /<item\b[\s\S]*?<\/item\s*>/gi;

    while (
      (match =
        itemRegex.exec(feedXml))
    ) {
      const itemXml =
        match[0];

      const title =
        normalizeText(
          stripHtml(
            extractXmlTag(
              itemXml,
              "title"
            )
          )
        );

      if (!title) {
        continue;
      }

      const link =
        absoluteUrl(
          stripHtml(
            extractXmlTag(
              itemXml,
              "link"
            )
          )
        );

      if (!link) {
        continue;
      }

      const pubDate =
        normalizeText(
          stripHtml(
            extractXmlTag(
              itemXml,
              "pubDate"
          )
        )
      );

      const description =
        extractXmlTag(
          itemXml,
          "description"
        );

      const encoded =
        extractXmlTag(
          itemXml,
          "content:encoded"
        );

      const decodedDescription =
        decodeHtml(
          description
        );

      const decodedEncoded =
        decodeHtml(
          encoded
        );

      const imageCandidates = [];

      imageCandidates.push(
        ...extractImageCandidatesFromHtml(
          decodedEncoded,
          {
            source:
              "feed-content",
          }
        )
      );

      imageCandidates.push(
        ...extractImageCandidatesFromHtml(
          decodedDescription,
          {
            source:
              "feed-content",
          }
        )
      );

      entries.push({
        title,
        url: link,
        published:
          pubDate || null,
        updated: null,
        summary:
          stripHtml(
            decodedDescription
          ),
        content:
          decodedEncoded,
        categories: [],
        imageCandidates,
        raw:
          itemXml,
      });
    }
  }

  return entries;
}

/* -------------------------------------------------------------------------- */
/* Feed URL discovery                                                         */
/* -------------------------------------------------------------------------- */

function buildFeedUrls(
  blogUrl
) {
  const base =
    new URL(blogUrl);

  const origin =
    `${base.protocol}//${base.host}`;

  return [
    `${origin}/feeds/posts/default?alt=atom&max-results=${MAX_FEED_ENTRIES}`,
    `${origin}/feeds/posts/default?alt=rss&max-results=${MAX_FEED_ENTRIES}`,
    `${origin}/feeds/posts/default?max-results=${MAX_FEED_ENTRIES}`,
  ];
}

async function fetchFeed() {
  const feedUrls =
    buildFeedUrls(
      BLOG_URL
    );

  let lastError =
    null;

  for (
    const feedUrl of
      feedUrls
  ) {
    try {
      log(
        `Fetching feed: ${feedUrl}`
      );

      const xml =
        await fetchText(
          feedUrl
        );

      if (
        !/<(?:entry|item)\b/i.test(
          xml
        )
      ) {
        throw new Error(
          "Response does not appear to contain feed entries"
        );
      }

      const entries =
        extractFeedEntries(
          xml
        );

      if (
        entries.length
      ) {
        log(
          `Feed entries found: ${entries.length}`
        );

        return {
          url: feedUrl,
          xml,
          entries,
        };
      }

      throw new Error(
        "Feed parsed successfully but contained no entries"
      );
    } catch (error) {
      lastError =
        error;

      warn(
        `Feed failed: ${feedUrl}`
      );

      warn(
        `Reason: ${error.message}`
      );
    }
  }

  throw new Error(
    `Unable to obtain a usable Blogger feed. ` +
      `${lastError?.message || ""}`
  );
}

/* -------------------------------------------------------------------------- */
/* Article page helpers                                                       */
/* -------------------------------------------------------------------------- */

function extractPageTitle(
  html
) {
  const titleMatch =
    html.match(
      /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i
    );

  if (!titleMatch) {
    return "";
  }

  return normalizeText(
    stripHtml(
      titleMatch[1]
    )
  );
}

function extractDescription(
  html
) {
  const metaRegex =
    /<meta\b[^>]*>/gi;

  let match;

  while (
    (match =
      metaRegex.exec(html))
  ) {
    const attrs =
      parseAttributes(
        match[0]
      );

    const name = String(
      attrs.name ||
        attrs.property ||
        ""
    ).toLowerCase();

    if (
      name ===
      "description"
    ) {
      return normalizeText(
        attrs.content || ""
      );
    }
  }

  return "";
}

function extractLanguage(
  html
) {
  const htmlMatch =
    html.match(
      /<html\b[^>]*>/i
    );

  if (!htmlMatch) {
    return null;
  }

  const attrs =
    parseAttributes(
      htmlMatch[0]
    );

  return (
    attrs.lang ||
    null
  );
}

function extractPageHeading(
  html,
  title
) {
  const heading =
    findHeadingForTitle(
      html,
      title
    );

  if (heading) {
    return stripHtml(
      html.slice(
        heading.start,
        heading.end
      )
    );
  }

  const h1 =
    html.match(
      /<h1\b[^>]*>[\s\S]*?<\/h1\s*>/i
    );

  return h1
    ? normalizeText(
        stripHtml(h1[0])
      )
    : "";
}

function findPostText(
  blockHtml
) {
  return normalizeWhitespace(
    stripHtml(
      blockHtml
    )
  );
}

function makeExcerpt(
  text,
  maxLength = 240
) {
  const normalized =
    normalizeWhitespace(
      text
    );

  if (
    normalized.length <=
    maxLength
  ) {
    return normalized;
  }

  return (
    normalized
      .slice(
        0,
        maxLength - 1
      )
      .trimEnd() +
    "…"
  );
}

/* -------------------------------------------------------------------------- */
/* Candidate ranking                                                          */
/* -------------------------------------------------------------------------- */

function dedupeCandidates(
  candidates
) {
  const seen =
    new Set();

  const result = [];

  for (
    const candidate of
      candidates
  ) {
    if (
      !candidate ||
      !candidate.url
    ) {
      continue;
    }

    const key =
      candidate.url
        .toLowerCase();

    if (
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);

    result.push(
      candidate
    );
  }

  return result.sort(
    (a, b) =>
      (b.score || 0) -
      (a.score || 0)
  );
}

function rankImageCandidates(
  candidates
) {
  const ranked =
    dedupeCandidates(
      candidates
    );

  /*
   * Association priority is intentionally
   * stronger than generic extraction score.
   */
  const associationWeight = {
    "article-og":
      5000,
    "article-twitter":
      4800,
    "article-meta":
      4600,
    "article-body":
      4200,
    "feed-entry":
      3800,
    "": 0,
  };

  return ranked.sort(
    (a, b) => {
      const aScore =
        (associationWeight[
          a.association || ""
        ] || 0) +
        (a.score || 0);

      const bScore =
        (associationWeight[
          b.association || ""
        ] || 0) +
        (b.score || 0);

      return (
        bScore -
        aScore
      );
    }
  );
}

/* -------------------------------------------------------------------------- */
/* Image validation                                                           */
/* -------------------------------------------------------------------------- */

function detectImageType(
  bytes
) {
  if (!bytes || bytes.length < 12) {
    return null;
  }

  /*
   * JPEG
   */
  if (
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "jpeg";
  }

  /*
   * PNG
   */
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }

  /*
   * GIF
   */
  const gifHeader =
    bytes
      .subarray(0, 6)
      .toString(
        "ascii"
      );

  if (
    gifHeader === "GIF87a" ||
    gifHeader === "GIF89a"
  ) {
    return "gif";
  }

  /*
   * WEBP
   */
  if (
    bytes
      .subarray(0, 4)
      .toString(
        "ascii"
      ) === "RIFF" &&
    bytes
      .subarray(8, 12)
      .toString(
        "ascii"
      ) === "WEBP"
  ) {
    return "webp";
  }

  /*
   * AVIF / HEIF
   */
  const box =
    bytes
      .subarray(4, 12)
      .toString(
        "ascii"
      );

  if (
    box === "ftypavif" ||
    box === "ftypavis"
  ) {
    return "avif";
  }

  if (
    box === "ftypheic" ||
    box === "ftypheix" ||
    box === "ftyphevc" ||
    box === "ftypmif1" ||
    box === "ftypmsf1"
  ) {
    return "heif";
  }

  /*
   * BMP
   */
  if (
    bytes[0] === 0x42 &&
    bytes[1] === 0x4d
  ) {
    return "bmp";
  }

  return null;
}

function getImageMagickCommand() {
  try {
    execFileSync(
      "magick",
      [
        "-version",
      ],
      {
        stdio:
          "ignore",
        timeout:
          5000,
      }
    );

    return "magick";
  } catch {
    try {
      execFileSync(
        "convert",
        [
          "-version",
        ],
        {
          stdio:
            "ignore",
          timeout:
            5000,
        }
      );

      return "convert";
    } catch {
      return null;
    }
  }
}

function identifyImage(
  filePath
) {
  const command =
    getImageMagickCommand();

  if (!command) {
    throw new Error(
      "ImageMagick is not installed"
    );
  }

  const output =
    execFileSync(
      command,
      [
        filePath,
        "-format",
        "%m|%w|%h|%b",
        "info:",
      ],
      {
        encoding:
          "utf8",
        timeout:
          30000,
        maxBuffer:
          1024 * 1024,
      }
    ).trim();

  const parts =
    output.split("|");

  if (
    parts.length <
    4
  ) {
    throw new Error(
      `Unexpected ImageMagick output: ${output}`
    );
  }

  return {
    format:
      parts[0],
    width:
      Number(parts[1]),
    height:
      Number(parts[2]),
    bytes:
      parts[3],
  };
}

function validateImageFile(
  filePath,
  expectedBytes
) {
  const stat =
    fs.statSync(
      filePath
    );

  if (
    stat.size <
    MIN_FILE_SIZE
  ) {
    throw new Error(
      `Image file too small: ${stat.size} bytes`
    );
  }

  if (
    expectedBytes &&
    expectedBytes.length
  ) {
    const magic =
      detectImageType(
        expectedBytes
      );

    if (!magic) {
      throw new Error(
        "Downloaded data does not have a recognized image signature"
      );
    }
  }

  const info =
    identifyImage(
      filePath
    );

  if (
    !Number.isFinite(
      info.width
    ) ||
    !Number.isFinite(
      info.height
    )
  ) {
    throw new Error(
      `Invalid image dimensions: ${info.width}x${info.height}`
    );
  }

  if (
    info.width <
      MIN_WIDTH ||
    info.height <
      MIN_HEIGHT
  ) {
    throw new Error(
      `Image dimensions too small: ${info.width}x${info.height}`
    );
  }

  return {
    ...info,
    fileSize:
      stat.size,
  };
}

/* -------------------------------------------------------------------------- */
/* Perceptual duplicate helpers                                               */
/* -------------------------------------------------------------------------- */

function calculateAverageHash(
  filePath
) {
  const command =
    getImageMagickCommand();

  if (!command) {
    return null;
  }

  try {
    const output =
      execFileSync(
        command,
        [
          filePath,
          "-colorspace",
          "Gray",
          "-resize",
          "16x16!",
          "-depth",
          "8",
          "txt:-",
        ],
        {
          encoding:
            "utf8",
          timeout:
            30000,
          maxBuffer:
            5 *
            1024 *
            1024,
        }
      );

    const values = [];

    for (
      const line of
        output.split(
          "\n"
        )
    ) {
      const match =
        line.match(
          /:\s*\((\d+),/
        );

      if (match) {
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

    const average =
      values.reduce(
        (sum, value) =>
          sum + value,
        0
      ) /
      values.length;

    return values
      .map(
        (value) =>
          value >=
          average
            ? "1"
            : "0"
      )
      .join("");
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

  let distance = 0;

  for (
    let i = 0;
    i < a.length;
    i++
  ) {
    if (
      a[i] !== b[i]
    ) {
      distance++;
    }
  }

  return distance;
}

function isPerceptualDuplicate(
  hash,
  existingHashes
) {
  if (!hash) {
    return false;
  }

  for (
    const existing of
      existingHashes
  ) {
    const distance =
      hammingDistance(
        hash,
        existing
      );

    /*
     * 256-bit average hash.
     * A very small Hamming distance
     * means the images are visually
     * near-identical.
     */
    if (
      distance <= 8
    ) {
      return true;
    }
  }

  return false;
}

/* -------------------------------------------------------------------------- */
/* Candidate verification                                                    */
/* -------------------------------------------------------------------------- */

async function verifyImageCandidate(
  candidate,
  context
) {
  const {
    postIndex,
    title,
    seenHashes,
    seenPerceptualHashes,
  } = context;

  log(
    `  Trying image candidate: ${candidate.url}`
  );

  let download;

  try {
    download =
      await fetchBinary(
        candidate.url
      );
  } catch (error) {
    warn(
      `  Download failed: ${error.message}`
    );

    return null;
  }

  const imageType =
    detectImageType(
      download.bytes
    );

  if (!imageType) {
    warn(
      "  Rejected: downloaded bytes are not a recognized image"
    );

    return null;
  }

  const hash =
    crypto
      .createHash(
        "sha256"
      )
      .update(
        download.bytes
      )
      .digest(
        "hex"
      );

  if (
    seenHashes.has(hash)
  ) {
    warn(
      "  Rejected: exact duplicate image"
    );

    return null;
  }

  const safeBase =
    String(
      title || `post-${postIndex + 1}`
    )
      .toLowerCase()
      .replace(
        /[^a-z0-9]+/g,
        "-"
      )
      .replace(
        /^-+|-+$/g,
        ""
      )
      .slice(
        0,
        60
      ) ||
    `post-${postIndex + 1}`;

  const extension =
    imageType === "jpeg"
      ? "jpg"
      : imageType;

  const filename =
    `${String(
      postIndex + 1
    ).padStart(
      2,
      "0"
    )}-${safeBase}.${extension}`;

  const outputPath =
    path.join(
      OUTPUT_DIR,
      filename
    );

  fs.writeFileSync(
    outputPath,
    download.bytes
  );

  let imageInfo;

  try {
    imageInfo =
      validateImageFile(
        outputPath,
        download.bytes
      );
  } catch (error) {
    try {
      fs.unlinkSync(
        outputPath
      );
    } catch {}

    warn(
      `  Rejected by image validation: ${error.message}`
    );

    return null;
  }

  const perceptualHash =
    calculateAverageHash(
      outputPath
    );

  if (
    isPerceptualDuplicate(
      perceptualHash,
      seenPerceptualHashes
    )
  ) {
    try {
      fs.unlinkSync(
        outputPath
      );
    } catch {}

    warn(
      "  Rejected: perceptual duplicate image"
    );

    return null;
  }

  seenHashes.add(
    hash
  );

  if (
    perceptualHash
  ) {
    seenPerceptualHashes.add(
      perceptualHash
    );
  }

  log(
    `  Verified image: ${filename} ` +
      `(${imageInfo.width}x${imageInfo.height}, ` +
      `${imageInfo.fileSize} bytes, ` +
      `${candidate.source})`
  );

  return {
    filename,
    localImage:
      `/blog-assets/${filename}`,
    source:
      candidate.source,
    association:
      candidate.association ||
      "",
    url:
      candidate.url,
    finalUrl:
      download.finalUrl ||
      candidate.url,
    method:
      download.method ||
      "unknown",
    type:
      imageType,
    width:
      imageInfo.width,
    height:
      imageInfo.height,
    fileSize:
      imageInfo.fileSize,
    sha256:
      hash,
    perceptualHash:
      perceptualHash ||
      null,
  };
}

/* -------------------------------------------------------------------------- */
/* Article image resolution                                                   */
/* -------------------------------------------------------------------------- */

async function resolveArticleImage(
  post,
  articleHtml,
  exactRegion,
  context
) {
  const candidates = [];

  /*
   * 1. Exact article meta images.
   */
  const metaCandidates =
    extractArticleMetaImages(
      articleHtml
    );

  log(
    `  Article-specific meta image candidates: ${metaCandidates.length}`
  );

  candidates.push(
    ...metaCandidates
  );

  /*
   * 2. Exact post-body image candidates.
   */
  if (exactRegion) {
    const bodyCandidates =
      extractImageCandidatesFromHtml(
        exactRegion.html,
        {
          source:
            "article-body",
        }
      );

    log(
      `  Exact post-body image candidates: ${bodyCandidates.length}`
    );

    for (
      const candidate of
        bodyCandidates
    ) {
      candidate.association =
        "article-body";
    }

    candidates.push(
      ...bodyCandidates
    );
  } else {
    log(
      "  Exact post-body image candidates: 0 (no exact region)"
    );
  }

  /*
   * 3. Unsplash attribution scoped
   *    strictly to exact article region.
   */
  if (exactRegion) {
    const unsplashCandidates =
      findUnsplashAttributionCandidates(
        exactRegion.html
      );

    log(
      `  Unsplash-attribution candidates: ${unsplashCandidates.length}`
    );

    candidates.push(
      ...unsplashCandidates
    );
  } else {
    log(
      "  Unsplash-attribution candidates: 0 (no exact region)"
    );
  }

  /*
   * 4. Exact feed-entry image candidates.
   */
  const feedCandidates =
    Array.isArray(
      post.imageCandidates
    )
      ? post.imageCandidates
      : [];

  log(
    `  Exact feed-entry image candidates: ${feedCandidates.length}`
  );

  for (
    const candidate of
      feedCandidates
  ) {
    candidate.association =
      "feed-entry";
  }

  candidates.push(
    ...feedCandidates
  );

  const ranked =
    rankImageCandidates(
      candidates
    );

  if (!ranked.length) {
    return null;
  }

  log(
    `  Ranked article-specific image candidates: ${ranked.length}`
  );

  for (
    const candidate of
      ranked
  ) {
    const verified =
      await verifyImageCandidate(
        candidate,
        context
      );

    if (verified) {
      return verified;
    }
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Date helpers                                                               */
/* -------------------------------------------------------------------------- */

function normalizeDate(
  value
) {
  if (!value) {
    return null;
  }

  const parsed =
    new Date(value);

  if (
    Number.isNaN(
      parsed.getTime()
    )
  ) {
    return value;
  }

  return parsed
    .toISOString();
}

/* -------------------------------------------------------------------------- */
/* Main post capture                                                          */
/* -------------------------------------------------------------------------- */

async function capturePosts(
  feedEntries
) {
  fs.mkdirSync(
    OUTPUT_DIR,
    {
      recursive: true,
    }
  );

  /*
   * Remove previous generated assets
   * so stale images cannot accidentally
   * be included in a new run.
   */
  for (
    const filename of
      fs.readdirSync(
        OUTPUT_DIR
      )
  ) {
    const fullPath =
      path.join(
        OUTPUT_DIR,
        filename
      );

    try {
      if (
        fs.statSync(
          fullPath
        ).isFile()
      ) {
        fs.unlinkSync(
          fullPath
        );
      }
    } catch {}
  }

  const verifiedPosts = [];

  const seenHashes =
    new Set();

  const seenPerceptualHashes =
    new Set();

  /*
   * Work through all available feed
   * candidates until five verified
   * articles have been obtained.
   */
  for (
    let feedIndex = 0;
    feedIndex <
      feedEntries.length &&
      verifiedPosts.length <
        MAX_POSTS;
    feedIndex++
  ) {
    const feedPost =
      feedEntries[
        feedIndex
      ];

    const postNumber =
      verifiedPosts.length +
      1;

    log("");
    log(
      `============================================================`
    );
    log(
      `Feed candidate ${feedIndex + 1}/${feedEntries.length}`
    );
    log(
      `Verified target ${postNumber}/${MAX_POSTS}`
    );
    log(
      `Title: ${feedPost.title}`
    );
    log(
      `URL: ${feedPost.url}`
    );
    log(
      `============================================================`
    );

    let articleHtml;

    try {
      log(
        `Fetching article page: ${feedPost.url}`
      );

      articleHtml =
        await fetchText(
          feedPost.url
        );

      log(
        `Article page fetched: ${articleHtml.length} bytes`
      );
    } catch (error) {
      warn(
        `Article fetch failed: ${error.message}`
      );

      log(
        "Skipping feed candidate and continuing..."
      );

      continue;
    }

    const exactRegion =
      findExactPostRegion(
        articleHtml,
        feedPost.title
      );

    if (exactRegion) {
      log(
        `Exact post container: FOUND ` +
          `(tag=${exactRegion.tagName}, ` +
          `class=${exactRegion.className || "(none)"}, ` +
          `length=${exactRegion.html.length})`
      );
    } else {
      warn(
        "Exact post container: NOT FOUND"
      );
    }

    const pageTitle =
      extractPageTitle(
        articleHtml
      );

    const pageDescription =
      extractDescription(
        articleHtml
      );

    const pageHeading =
      extractPageHeading(
        articleHtml,
        feedPost.title
      );

    const language =
      extractLanguage(
        articleHtml
      );

    const bodyText =
      exactRegion
        ? findPostText(
            exactRegion.html
          )
        : normalizeWhitespace(
            stripHtml(
              articleHtml
            )
          );

    const excerpt =
      makeExcerpt(
        feedPost.summary ||
          bodyText ||
          pageDescription
      );

    let image;

    try {
      image =
        await resolveArticleImage(
          feedPost,
          articleHtml,
          exactRegion,
          {
            postIndex:
              verifiedPosts.length,
            title:
              feedPost.title,
            seenHashes,
            seenPerceptualHashes,
          }
        );
    } catch (error) {
      warn(
        `Image resolution failed: ${error.message}`
      );

      image = null;
    }

    if (!image) {
      warn(
        "No article-specific image could be verified."
      );

      log(
        "Skipping this feed candidate and continuing..."
      );

      continue;
    }

    const categories =
      Array.isArray(
        feedPost.categories
      )
        ? feedPost.categories
        : [];

    const verifiedPost = {
      index:
        verifiedPosts.length + 1,
      title:
        feedPost.title,
      url:
        feedPost.url,
      published:
        normalizeDate(
          feedPost.published
        ),
      date:
        normalizeDate(
          feedPost.published ||
            feedPost.updated
        ),
      excerpt,
      categories,
      localImage:
        image.localImage,
      imageSource:
        image.source,
      imageAssociation:
        image.association,
      imageUrl:
        image.url,
      imageFinalUrl:
        image.finalUrl,
      imageDownloadMethod:
        image.method,
      imageWidth:
        image.width,
      imageHeight:
        image.height,
      imageFileSize:
        image.fileSize,
      imageSha256:
        image.sha256,
      imagePerceptualHash:
        image.perceptualHash,
      pageTitle,
      pageHeading,
      language:
        language ||
        null,
    };

    verifiedPosts.push(
      verifiedPost
    );

    log("");
    log(
      `VERIFIED POST ${verifiedPosts.length}/${MAX_POSTS}`
    );
    log(
      `Title: ${verifiedPost.title}`
    );
    log(
      `Image: ${verifiedPost.localImage}`
    );
    log(
      `Source: ${verifiedPost.imageSource}`
    );
  }

  if (
    verifiedPosts.length !==
    MAX_POSTS
  ) {
    throw new Error(
      `Unable to obtain ${MAX_POSTS} verified ` +
        `article-specific posts. Only ` +
        `${verifiedPosts.length} were verified from ` +
        `${feedEntries.length} feed candidates. ` +
        `No generic fallback image will be used.`
    );
  }

  return verifiedPosts;
}

/* -------------------------------------------------------------------------- */
/* JSON output                                                                */
/* -------------------------------------------------------------------------- */

function writeBlogJson(
  feed,
  posts
) {
  const output = {
    version:
      "14.0",
    capturedAt:
      new Date().toISOString(),
    url:
      BLOG_URL,
    hostname:
      (() => {
        try {
          return new URL(
            BLOG_URL
          ).hostname;
        } catch {
          return "";
        }
      })(),
    siteTitle:
      posts[0]?.pageTitle ||
      "",
    description:
      "",
    pageHeading:
      posts[0]?.pageHeading ||
      "",
    ogImage:
      posts[0]?.imageUrl ||
      null,
    language:
      posts[0]?.language ||
      null,
    postCount:
      posts.length,
    analysis: {
      feedUrl:
        feed.url,
      feedEntriesChecked:
        feed.entries.length,
      verifiedPosts:
        posts.length,
      genericFallbackUsed:
        false,
      imageAssociationPolicy:
        "article-specific-only",
    },
    posts,
  };

  fs.mkdirSync(
    path.dirname(
      BLOG_JSON
    ),
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
    ),
    "utf8"
  );

  log("");
  log(
    `blog.json written: ${BLOG_JSON}`
  );
}

/* -------------------------------------------------------------------------- */
/* Final validation                                                           */
/* -------------------------------------------------------------------------- */

function validateOutput(
  posts
) {
  if (
    !Array.isArray(
      posts
    )
  ) {
    throw new Error(
      "Posts output is not an array"
    );
  }

  if (
    posts.length !==
    MAX_POSTS
  ) {
    throw new Error(
      `Expected ${MAX_POSTS} posts, got ${posts.length}`
    );
  }

  const seenUrls =
    new Set();

  const seenImages =
    new Set();

  for (
    let i = 0;
    i < posts.length;
    i++
  ) {
    const post =
      posts[i];

    if (
      !post.title
    ) {
      throw new Error(
        `Post ${i + 1} has no title`
      );
    }

    if (
      !post.url
    ) {
      throw new Error(
        `Post ${i + 1} has no URL`
      );
    }

    if (
      !post.excerpt
    ) {
      throw new Error(
        `Post ${i + 1} has no excerpt`
      );
    }

    if (
      !post.localImage
    ) {
      throw new Error(
        `Post ${i + 1} has no localImage`
      );
    }

    if (
      seenUrls.has(
        post.url
      )
    ) {
      throw new Error(
        `Duplicate post URL: ${post.url}`
      );
    }

    seenUrls.add(
      post.url
    );

    if (
      seenImages.has(
        post.localImage
      )
    ) {
      throw new Error(
        `Duplicate local image: ${post.localImage}`
      );
    }

    seenImages.add(
      post.localImage
    );

    const relative =
      post.localImage.replace(
        /^\/blog-assets\//,
        ""
      );

    const filePath =
      path.join(
        OUTPUT_DIR,
        relative
      );

    if (
      !fs.existsSync(
        filePath
      )
    ) {
      throw new Error(
        `Image file missing: ${filePath}`
      );
    }

    const stat =
      fs.statSync(
        filePath
      );

    if (
      stat.size <
      MIN_FILE_SIZE
    ) {
      throw new Error(
        `Image file too small: ${filePath}`
      );
    }

    if (
      post.imageAssociation ===
        "generic-fallback" ||
      post.imageSource ===
        "generic-fallback"
    ) {
      throw new Error(
        `Generic fallback image detected for post ${i + 1}`
      );
    }
  }

  log("");
  log(
    "============================================================"
  );
  log(
    "FINAL VALIDATION PASSED"
  );
  log(
    `Verified posts: ${posts.length}/${MAX_POSTS}`
  );
  log(
    "Generic fallback: DISABLED"
  );
  log(
    "All local images: PRESENT"
  );
  log(
    "Duplicate protection: PASSED"
  );
  log(
    "============================================================"
  );
}

/* -------------------------------------------------------------------------- */
/* Main                                                                       */
/* -------------------------------------------------------------------------- */

async function main() {
  log(
    "============================================================"
  );
  log(
    "BLOG ANALYZER v14.0"
  );
  log(
    "============================================================"
  );
  log(
    `Blog URL: ${BLOG_URL}`
  );
  log(
    `Output directory: ${OUTPUT_DIR}`
  );
  log(
    `Blog JSON: ${BLOG_JSON}`
  );
  log(
    `Target verified posts: ${MAX_POSTS}`
  );
  log(
    `Feed candidates: ${MAX_FEED_ENTRIES}`
  );
  log(
    "Generic fallback: DISABLED"
  );
  log(
    "============================================================"
  );

  const feed =
    await fetchFeed();

  const posts =
    await capturePosts(
      feed.entries.slice(
        0,
        MAX_FEED_ENTRIES
      )
    );

  validateOutput(
    posts
  );

  writeBlogJson(
    feed,
    posts
  );

  log("");
  log(
    "============================================================"
  );
  log(
    "BLOG ANALYZER v14.0 SUCCESS"
  );
  log(
    "============================================================"
  );
}

main().catch(
  (error) => {
    console.error("");
    console.error(
      "============================================================"
    );
    console.error(
      "BLOG ANALYZER v14.0 FAILED"
    );
    console.error(
      "============================================================"
    );
    console.error(
      error?.stack ||
        error?.message ||
        error
    );

    process.exit(1);
  }
);

  ) {
    throw new Error(
      `Only ${candidatePosts.length} feed candidates available. ` +
        `At least ${MAX_POSTS} candidates are required.`
    );
  }

  log("");
  log(
    `Candidate post pool: ${candidatePosts.length}`
  );

  /*
   * ------------------------------------------------------------------------
   * Capture images
   * ------------------------------------------------------------------------
   */

  const usedHashes =
    new Set();

  const usedFingerprints =
    [];

  const capturedPosts =
    [];

  for (
    const candidate of
      candidatePosts
  ) {
    if (
      capturedPosts.length >=
      MAX_POSTS
    ) {
      break;
    }

    const captureIndex =
      capturedPosts.length +
      1;

    log("");
    log(
      "----------------------------------------------------"
    );
    log(
      `Trying candidate ${captureIndex} / ${MAX_POSTS} target`
    );
    log(
      `Feed title: ${candidate.title}`
    );
    log(
      `Feed date: ${candidate.date || "unknown"}`
    );
    log(
      "----------------------------------------------------"
    );

    try {
      const image =
        await resolveArticleImage(
          candidate,
          candidate.feedEntry,
          captureIndex,
          usedHashes,
          usedFingerprints
        );

      if (
        !image ||
        !image.localImage ||
        !image.imageUrl
      ) {
        throw new Error(
          "No verified image result returned."
        );
      }

      const allowedAssociations =
        new Set([
          "article-og",
          "article-twitter",
          "article-meta",
          "article-body",
          "feed-content",
        ]);

      if (
        !image.imageAssociation ||
        !allowedAssociations.has(
          image.imageAssociation
        )
      ) {
        throw new Error(
          `Invalid image association "${image.imageAssociation}".`
        );
      }

      capturedPosts.push({
        index:
          captureIndex,

        title:
          candidate.title,

        url:
          candidate.url,

        published:
          candidate.published,

        date:
          candidate.date,

        excerpt:
          candidate.excerpt,

        categories:
          candidate.categories,

        localImage:
          image.localImage,

        imageUrl:
          image.imageUrl,

        imageSource:
          image.imageSource,

        imageAssociation:
          image.imageAssociation,

        imageReason:
          image.imageReason,

        imageStats: {
          sha256:
            image.sha256,

          perceptualFingerprint:
            image.perceptualFingerprint,

          width:
            image.width,

          height:
            image.height,

          bytes:
            image.bytes,
        },
      });

      log("");
      log(
        `VERIFIED POST ${capturedPosts.length}/${MAX_POSTS}`
      );
      log(
        `Title: ${candidate.title}`
      );
      log(
        `Image: ${image.localImage}`
      );
      log(
        `Association: ${image.imageAssociation}`
      );
    } catch (error) {
      /*
       * IMPORTANT:
       *
       * One bad article must NOT abort the entire capture.
       * The candidate is skipped and the next feed entry
       * is tested.
       */

      warn("");
      warn(
        `SKIPPED candidate: ${candidate.title}`
      );
      warn(
        `Reason: ${error?.message || error}`
      );
      warn(
        "Continuing with the next feed entry..."
      );

      continue;
    }
  }

  /*
   * ------------------------------------------------------------------------
   * Final requirement
   * ------------------------------------------------------------------------
   */

  if (
    capturedPosts.length !==
    MAX_POSTS
  ) {
    throw new Error(
      `Unable to obtain ${MAX_POSTS} verified article-specific posts. ` +
        `Only ${capturedPosts.length} were verified from ` +
        `${candidatePosts.length} feed candidates. ` +
        `No generic fallback image will be used.`
    );
  }

  /*
   * ------------------------------------------------------------------------
   * Final validation
   * ------------------------------------------------------------------------
   */

  const localImages =
    capturedPosts.map(
      (post) =>
        post.localImage
    );

  const uniqueLocalImages =
    new Set(
      localImages
    );

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

  for (
    const post of
      capturedPosts
  ) {
    if (
      !post.imageAssociation
    ) {
      throw new Error(
        `Post ${post.index}: missing imageAssociation.`
      );
    }

    if (
      post.imageSource ===
        "fallback" ||
      post.imageAssociation ===
        "fallback"
    ) {
      throw new Error(
        `Post ${post.index}: forbidden fallback image detected.`
      );
    }
  }

  /*
   * ------------------------------------------------------------------------
   * Site analysis
   * ------------------------------------------------------------------------
   */

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
    version: 5,

    capturedAt:
      new Date().toISOString(),

    url:
      BLOG_URL,

    hostname:
      new URL(
        BLOG_URL
      ).hostname,

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
     * Site metadata only.
     * NEVER used as a post image.
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
    path.dirname(
      BLOG_JSON
    ),
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
  log(
    "===================================================="
  );
  log(
    "BLOG ANALYZER v14.0 SUCCESS"
  );
  log(
    "===================================================="
  );

  for (
    const post of
      capturedPosts
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
  log(
    "===================================================="
  );
}

main().catch(
  (error) => {
    console.error("");
    console.error(
      "===================================================="
    );
    console.error(
      "BLOG ANALYZER v14.0 FAILED"
    );
    console.error(
      "===================================================="
    );
    console.error(
      error?.stack ||
        error?.message ||
        error
    );
    console.error(
      "===================================================="
    );

    process.exit(1);
  }
);

  ) {
    throw new Error(
      `Only ${candidatePosts.length} feed candidates available. ` +
        `At least ${MAX_POSTS} candidates are required.`
    );
  }

  log("");
  log(
    `Candidate post pool: ${candidatePosts.length}`
  );

  /*
   * ------------------------------------------------------------------------
   * Capture images
   * ------------------------------------------------------------------------
   */

  const usedHashes =
    new Set();

  const usedFingerprints =
    [];

  const capturedPosts =
    [];

  for (
    const candidate of
      candidatePosts
  ) {
    if (
      capturedPosts.length >=
      MAX_POSTS
    ) {
      break;
    }

    const captureIndex =
      capturedPosts.length +
      1;

    log("");
    log(
      "----------------------------------------------------"
    );
    log(
      `Trying candidate ${captureIndex} / ${MAX_POSTS} target`
    );
    log(
      `Feed title: ${candidate.title}`
    );
    log(
      `Feed date: ${candidate.date || "unknown"}`
    );
    log(
      "----------------------------------------------------"
    );

    try {
      const image =
        await resolveArticleImage(
          candidate,
          candidate.feedEntry,
          captureIndex,
          usedHashes,
          usedFingerprints
        );

      if (
        !image ||
        !image.localImage ||
        !image.imageUrl
      ) {
        throw new Error(
          "No verified image result returned."
        );
      }

      const allowedAssociations =
        new Set([
          "article-og",
          "article-twitter",
          "article-meta",
          "article-body",
          "feed-content",
        ]);

      if (
        !image.imageAssociation ||
        !allowedAssociations.has(
          image.imageAssociation
        )
      ) {
        throw new Error(
          `Invalid image association "${image.imageAssociation}".`
        );
      }

      capturedPosts.push({
        index:
          captureIndex,

        title:
          candidate.title,

        url:
          candidate.url,

        published:
          candidate.published,

        date:
          candidate.date,

        excerpt:
          candidate.excerpt,

        categories:
          candidate.categories,

        localImage:
          image.localImage,

        imageUrl:
          image.imageUrl,

        imageSource:
          image.imageSource,

        imageAssociation:
          image.imageAssociation,

        imageReason:
          image.imageReason,

        imageStats: {
          sha256:
            image.sha256,

          perceptualFingerprint:
            image.perceptualFingerprint,

          width:
            image.width,

          height:
            image.height,

          bytes:
            image.bytes,
        },
      });

      log("");
      log(
        `VERIFIED POST ${capturedPosts.length}/${MAX_POSTS}`
      );
      log(
        `Title: ${candidate.title}`
      );
      log(
        `Image: ${image.localImage}`
      );
      log(
        `Association: ${image.imageAssociation}`
      );
    } catch (error) {
      warn("");
      warn(
        `SKIPPED candidate: ${candidate.title}`
      );
      warn(
        `Reason: ${error?.message || error}`
      );
      warn(
        "Continuing with the next feed entry..."
      );

      continue;
    }
  }

  /*
   * ------------------------------------------------------------------------
   * Final requirement
   * ------------------------------------------------------------------------
   */

  if (
    capturedPosts.length !==
    MAX_POSTS
  ) {
    throw new Error(
      `Unable to obtain ${MAX_POSTS} verified article-specific posts. ` +
        `Only ${capturedPosts.length} were verified from ` +
        `${candidatePosts.length} feed candidates. ` +
        `No generic fallback image will be used.`
    );
  }

  /*
   * ------------------------------------------------------------------------
   * Final validation
   * ------------------------------------------------------------------------
   */

  const localImages =
    capturedPosts.map(
      (post) =>
        post.localImage
    );

  const uniqueLocalImages =
    new Set(
      localImages
    );

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

  for (
    const post of
      capturedPosts
  ) {
    if (
      !post.imageAssociation
    ) {
      throw new Error(
        `Post ${post.index}: missing imageAssociation.`
      );
    }

    if (
      post.imageSource ===
        "fallback" ||
      post.imageAssociation ===
        "fallback"
    ) {
      throw new Error(
        `Post ${post.index}: forbidden fallback image detected.`
      );
    }
  }

  /*
   * ------------------------------------------------------------------------
   * Site analysis
   * ------------------------------------------------------------------------
   */

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
    version: 5,

    capturedAt:
      new Date().toISOString(),

    url:
      BLOG_URL,

    hostname:
      new URL(
        BLOG_URL
      ).hostname,

    siteTitle:
      pageMetadata.title ||
      "Funds Up",

    description:
      pageMetadata.description ||
      "",

    pageHeading:
      pageMetadata.title ||
      "Funds Up",

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
    path.dirname(
      BLOG_JSON
    ),
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

  log("");
  log(
    "===================================================="
  );
  log(
    "BLOG ANALYZER v14.0 SUCCESS"
  );
  log(
    "===================================================="
  );

  for (
    const post of
      capturedPosts
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
  log(
    "===================================================="
  );
}

main().catch(
  (error) => {
    console.error("");
    console.error(
      "===================================================="
    );
    console.error(
      "BLOG ANALYZER v14.0 FAILED"
    );
    console.error(
      "===================================================="
    );
    console.error(
      error?.stack ||
        error?.message ||
        error
    );
    console.error(
      "===================================================="
    );

    process.exit(1);
  }
);
