#!/usr/bin/env node

/**
 * BLOG ANALYZER v10.6
 *
 * Goals
 * - Capture the latest 5 Blogger posts from a public blog.
 * - Extract an image that belongs to EACH specific post.
 * - Prefer Blogger JSON feed data over article-page requests.
 * - Never use site-wide OG/Twitter meta images as a normal image candidate.
 * - Never borrow another post's image.
 * - Handle Blogger HTTP 429 without excessive retries.
 * - Validate downloaded files with ImageMagick.
 * - Reject duplicate images.
 * - Write blog.json + local image files for Remotion.
 *
 * Usage:
 *   node scripts/capture-blog.mjs "$BLOG_URL"
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";

const BLOG_URL = process.argv[2];

if (!BLOG_URL) {
  console.error("Usage: node scripts/capture-blog.mjs <BLOG_URL>");
  process.exit(1);
}

const OUTPUT_ROOT = path.resolve(
  process.env.GITHUB_WORKSPACE || process.cwd(),
  "template/public/blog"
);

const IMAGE_DIR = path.join(OUTPUT_ROOT, "images");
const BLOG_JSON_PATH = path.join(OUTPUT_ROOT, "blog.json");

const MAX_POSTS = 5;
const FEED_MAX_RESULTS = 10;

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const REQUEST_TIMEOUT_MS = 30000;
const MAX_ARTICLE_RETRIES = 1;

const MIN_IMAGE_BYTES = 5000;

const BAD_IMAGE_EXTENSIONS = new Set([
  ".html",
  ".htm",
  ".xml",
  ".json",
  ".txt",
  ".svg",
]);

const IMAGE_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/bmp",
  "image/tiff",
]);

// ------------------------------------------------------------
// ImageMagick detection
// ------------------------------------------------------------

function findCommand(commands) {
  for (const command of commands) {
    try {
      const result = spawnSync(command, ["-version"], {
        stdio: "ignore",
      });

      if (result.status === 0) {
        return command;
      }
    } catch {
      // Continue.
    }
  }

  return null;
}

const IDENTIFY_COMMAND = findCommand(["magick", "identify"]);
const CONVERT_COMMAND = findCommand(["magick", "convert"]);

if (!IDENTIFY_COMMAND || !CONVERT_COMMAND) {
  throw new Error(
    "ImageMagick is required but identify/convert commands were not found."
  );
}

function getImageMagickVersion() {
  try {
    return execFileSync(IDENTIFY_COMMAND, ["-version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
      .split("\n")[0]
      .trim();
  } catch {
    return "unknown";
  }
}

console.log(`ImageMagick identify command: ${IDENTIFY_COMMAND}`);
console.log(`ImageMagick convert command: ${CONVERT_COMMAND}`);
console.log(`Version: ${getImageMagickVersion()}`);
console.log("============================================================");
console.log("BLOG ANALYZER v10.6");
console.log(`Blog URL: ${BLOG_URL}`);
console.log(`Output: ${OUTPUT_ROOT}`);
console.log("============================================================");

// ------------------------------------------------------------
// Generic helpers
// ------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#47;/gi, "/")
    .replace(/&#(\d+);/g, (_, n) => {
      try {
        return String.fromCodePoint(Number(n));
      } catch {
        return _;
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      try {
        return String.fromCodePoint(parseInt(n, 16));
      } catch {
        return _;
      }
    });
}

function htmlToText(html) {
  return normalizeWhitespace(
    decodeHtmlEntities(
      String(html || "")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
        .replace(/<[^>]+>/g, " ")
    )
  );
}

function normalizeTitle(title) {
  return normalizeWhitespace(title)
    .toLowerCase()
    .replace(/[“”"'`]/g, "")
    .replace(/[—–−-]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleSimilarity(a, b) {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);

  if (!x || !y) return 0;
  if (x === y) return 1;

  const ax = new Set(x.split(" "));
  const by = new Set(y.split(" "));

  const intersection = [...ax].filter((word) => by.has(word)).length;
  const union = new Set([...ax, ...by]).size;

  return union ? intersection / union : 0;
}

function isAbsoluteHttpUrl(url) {
  return /^https?:\/\//i.test(String(url || "").trim());
}

function safeUrl(value, baseUrl = BLOG_URL) {
  if (!value) return null;

  let decoded = decodeHtmlEntities(String(value).trim());

  decoded = decoded
    .replace(/^['"]|['"]$/g, "")
    .replace(/&amp;/gi, "&");

  if (!decoded || decoded.startsWith("data:")) {
    return null;
  }

  try {
    const result = new URL(decoded, baseUrl);

    if (!["http:", "https:"].includes(result.protocol)) {
      return null;
    }

    return result.href;
  } catch {
    return null;
  }
}

function normalizeBloggerImageUrl(url) {
  const normalized = safeUrl(url);

  if (!normalized) return null;

  try {
    const u = new URL(normalized);

    if (
      u.hostname === "blogger.googleusercontent.com" ||
      u.hostname.endsWith(".googleusercontent.com")
    ) {
      // Blogger image URLs often contain:
      // /s72-c/
      // /s320/
      // /w1200/
      // /w400-h300/
      // etc.
      //
      // Request the original/larger image where possible.
      u.pathname = u.pathname
        .replace(/\/s\d+(?:-[a-z0-9]+)?(?=\/)/gi, "/s1600")
        .replace(/\/w\d+(?:-h\d+)?(?=\/)/gi, "/s1600")
        .replace(/\/h\d+(?:-w\d+)?(?=\/)/gi, "/s1600")
        .replace(/\/s\d+-c(?=\/)/gi, "/s1600");

      return u.href;
    }

    return u.href;
  } catch {
    return normalized;
  }
}

function isObviouslyBadImageUrl(url) {
  if (!url) return true;

  const lower = url.toLowerCase();

  if (lower.startsWith("data:")) return true;

  try {
    const u = new URL(url);

    if (!["http:", "https:"].includes(u.protocol)) {
      return true;
    }

    const pathname = u.pathname.toLowerCase();

    for (const ext of BAD_IMAGE_EXTENSIONS) {
      if (pathname.endsWith(ext)) {
        return true;
      }
    }

    if (
      pathname.includes("/feeds/") ||
      pathname.includes("/search") ||
      pathname.includes("/label/") ||
      pathname.includes("/archive/") ||
      pathname.includes("/p/")
    ) {
      return true;
    }

    return false;
  } catch {
    return true;
  }
}

// ------------------------------------------------------------
// HTTP
// ------------------------------------------------------------

function buildHeaders(targetUrl, accept = "*/*") {
  const headers = {
    "User-Agent": USER_AGENT,
    Accept: accept,
    "Accept-Language": "en-US,en;q=0.9,ko;q=0.8",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  };

  try {
    const host = new URL(targetUrl).hostname;

    if (
      host.endsWith("blogspot.com") ||
      host.endsWith("blogspot.kr") ||
      host.endsWith("blogger.com") ||
      host.endsWith("googleusercontent.com")
    ) {
      headers.Referer = BLOG_URL;
    }
  } catch {
    // Ignore invalid host.
  }

  return headers;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        ...buildHeaders(url, options.accept || "*/*"),
        ...(options.headers || {}),
      },
    });

    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTextOnce(url, options = {}) {
  const response = await fetchWithTimeout(url, {
    ...options,
    accept:
      options.accept ||
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  });

  const text = await response.text();

  return {
    response,
    text,
  };
}

async function fetchTextWithLimitedRetry(url, label) {
  let lastError = null;

  for (let attempt = 0; attempt <= MAX_ARTICLE_RETRIES; attempt++) {
    try {
      const { response, text } = await fetchTextOnce(url);

      if (response.ok) {
        return {
          status: response.status,
          text,
          headers: response.headers,
        };
      }

      if (response.status === 429) {
        if (attempt < MAX_ARTICLE_RETRIES) {
          const retryAfter = Number(response.headers.get("retry-after"));

          const waitMs = Number.isFinite(retryAfter)
            ? Math.min(Math.max(retryAfter * 1000, 1000), 12000)
            : 2500;

          console.log(
            `${label}: HTTP 429. Retry ${attempt + 1}/${MAX_ARTICLE_RETRIES} after ${waitMs}ms`
          );

          await sleep(waitMs);
          continue;
        }

        throw new Error(`${label}: HTTP 429 Too Many Requests`);
      }

      throw new Error(`${label}: HTTP ${response.status}`);
    } catch (error) {
      lastError = error;

      if (attempt < MAX_ARTICLE_RETRIES) {
        const waitMs = 1500 + attempt * 1000;

        console.log(
          `${label}: ${error.message}. Retry ${attempt + 1}/${MAX_ARTICLE_RETRIES} after ${waitMs}ms`
        );

        await sleep(waitMs);
      }
    }
  }

  throw lastError || new Error(`${label}: request failed`);
}

async function downloadImage(url, outputPath) {
  const response = await fetchWithTimeout(url, {
    accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
  });

  const contentType = (response.headers.get("content-type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  if (!IMAGE_CONTENT_TYPES.has(contentType)) {
    throw new Error(`Invalid Content-Type: ${contentType || "unknown"}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.length < MIN_IMAGE_BYTES) {
    throw new Error(`Image too small: ${buffer.length} bytes`);
  }

  fs.writeFileSync(outputPath, buffer);

  return {
    contentType,
    bytes: buffer.length,
  };
}

// ------------------------------------------------------------
// Lightweight HTML parser
// ------------------------------------------------------------

class HtmlNode {
  constructor(type, tagName = null, attributes = {}) {
    this.type = type;
    this.tagName = tagName;
    this.attributes = attributes;
    this.children = [];
    this.parent = null;
    this.text = "";
  }
}

function parseAttributes(tagText) {
  const attrs = {};

  const attrRegex =
    /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

  let match;

  while ((match = attrRegex.exec(tagText))) {
    const name = match[1].toLowerCase();

    if (name === "img" || name === "div" || name === "span") {
      continue;
    }

    attrs[name] = decodeHtmlEntities(
      match[2] ?? match[3] ?? match[4] ?? ""
    );
  }

  return attrs;
}

function parseHtml(html) {
  const root = new HtmlNode("root");
  const stack = [root];

  const tokenRegex =
    /<!--[\s\S]*?-->|<![^>]*>|<\/?[a-zA-Z][^>]*>/g;

  let cursor = 0;
  let match;

  const voidTags = new Set([
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

  while ((match = tokenRegex.exec(html))) {
    const token = match[0];

    if (match.index > cursor) {
      const text = html.slice(cursor, match.index);

      if (text.trim()) {
        const node = new HtmlNode("text");
        node.text = decodeHtmlEntities(text);
        node.parent = stack[stack.length - 1];
        stack[stack.length - 1].children.push(node);
      }
    }

    cursor = tokenRegex.lastIndex;

    if (token.startsWith("<!--") || token.startsWith("<!")) {
      continue;
    }

    if (/^<\//.test(token)) {
      const closingName = token
        .slice(2, -1)
        .trim()
        .toLowerCase();

      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName === closingName) {
          stack.length = i;
          break;
        }
      }

      continue;
    }

    const selfClosing = /\/>$/.test(token);

    const inner = token
      .slice(1, token.length - (selfClosing ? 2 : 1))
      .trim();

    const nameMatch = inner.match(/^([^\s/>]+)/);

    if (!nameMatch) continue;

    const tagName = nameMatch[1].toLowerCase();

    const node = new HtmlNode(
      "element",
      tagName,
      parseAttributes(inner)
    );

    node.parent = stack[stack.length - 1];
    stack[stack.length - 1].children.push(node);

    if (!selfClosing && !voidTags.has(tagName)) {
      stack.push(node);
    }
  }

  if (cursor < html.length) {
    const text = html.slice(cursor);

    if (text.trim()) {
      const node = new HtmlNode("text");
      node.text = decodeHtmlEntities(text);
      node.parent = stack[stack.length - 1];
      stack[stack.length - 1].children.push(node);
    }
  }

  return root;
}

function walkNodes(root, callback) {
  callback(root);

  for (const child of root.children || []) {
    walkNodes(child, callback);
  }
}

function elementNodes(root) {
  const result = [];

  walkNodes(root, (node) => {
    if (node.type === "element") {
      result.push(node);
    }
  });

  return result;
}

function nodeText(node) {
  if (!node) return "";

  if (node.type === "text") {
    return node.text;
  }

  let result = "";

  for (const child of node.children || []) {
    result += " " + nodeText(child);
  }

  return normalizeWhitespace(result);
}

function hasClassOrId(node, patterns) {
  if (!node || node.type !== "element") return false;

  const value = [
    node.attributes.class || "",
    node.attributes.id || "",
  ]
    .join(" ")
    .toLowerCase();

  return patterns.some((pattern) => value.includes(pattern));
}

function getAncestorChain(node) {
  const result = [];

  let current = node;

  while (current) {
    result.push(current);
    current = current.parent;
  }

  return result;
}

// ------------------------------------------------------------
// Image extraction from HTML
// ------------------------------------------------------------

function addCandidate(list, url, source, score = 0) {
  const normalized = normalizeBloggerImageUrl(url);

  if (!normalized || isObviouslyBadImageUrl(normalized)) {
    return;
  }

  if (!list.some((item) => item.url === normalized)) {
    list.push({
      url: normalized,
      source,
      score,
    });
  }
}

function extractUrlsFromSrcset(value) {
  if (!value) return [];

  return String(value)
    .split(",")
    .map((part) => {
      const pieces = part.trim().split(/\s+/);
      return pieces[0];
    })
    .filter(Boolean);
}

function extractImageCandidatesFromNode(root, sourcePrefix) {
  const candidates = [];

  const nodes = elementNodes(root);

  for (const node of nodes) {
    if (node.tagName === "img") {
      const attrs = node.attributes;

      const srcAttributes = [
        ["src", 100],
        ["data-src", 95],
        ["data-original", 94],
        ["data-lazy-src", 93],
        ["data-lazy", 92],
        ["data-image", 91],
        ["data-image-url", 90],
        ["data-url", 89],
      ];

      for (const [attribute, score] of srcAttributes) {
        if (attrs[attribute]) {
          addCandidate(
            candidates,
            attrs[attribute],
            `${sourcePrefix}-img`,
            score
          );
        }
      }

      for (const attribute of ["srcset", "data-srcset"]) {
        if (attrs[attribute]) {
          for (const url of extractUrlsFromSrcset(attrs[attribute])) {
            addCandidate(
              candidates,
              url,
              `${sourcePrefix}-srcset`,
              85
            );
          }
        }
      }
    }

    if (node.tagName === "source") {
      for (const attribute of ["src", "srcset", "data-src", "data-srcset"]) {
        if (!attrsSafe(node, attribute)) continue;

        const value = node.attributes[attribute];

        if (attribute.includes("srcset")) {
          for (const url of extractUrlsFromSrcset(value)) {
            addCandidate(
              candidates,
              url,
              `${sourcePrefix}-source`,
              70
            );
          }
        } else {
          addCandidate(
            candidates,
            value,
            `${sourcePrefix}-source`,
            70
          );
        }
      }
    }

    // CSS background-image only inside the exact post content scope.
    const style = node.attributes.style || "";

    const backgroundRegex =
      /background-image\s*:\s*url\(\s*(['"]?)(.*?)\1\s*\)/gi;

    let match;

    while ((match = backgroundRegex.exec(style))) {
      addCandidate(
        candidates,
        match[2],
        `${sourcePrefix}-background`,
        50
      );
    }
  }

  return candidates;
}

function attrsSafe(node, attribute) {
  return Boolean(
    node &&
      node.attributes &&
      node.attributes[attribute]
  );
}

// ------------------------------------------------------------
// Feed image extraction
// ------------------------------------------------------------

function extractFeedImageCandidates(entry) {
  const candidates = [];

  const thumbnail =
    entry?.media$thumbnail?.url ||
    entry?.media$thumbnail?.["url"];

  if (thumbnail) {
    addCandidate(
      candidates,
      thumbnail,
      "feed-thumbnail",
      120
    );
  }

  const mediaGroup =
    entry?.media$group?.["media$content"] ||
    entry?.media$group?.media$content ||
    [];

  for (const item of Array.isArray(mediaGroup) ? mediaGroup : []) {
    if (item?.url) {
      addCandidate(
        candidates,
        item.url,
        "feed-media-content",
        115
      );
    }
  }

  const mediaContent =
    entry?.["media$content"] ||
    entry?.media$content ||
    [];

  for (const item of Array.isArray(mediaContent) ? mediaContent : []) {
    if (item?.url) {
      addCandidate(
        candidates,
        item.url,
        "feed-media-content",
        115
      );
    }
  }

  const htmlFragments = [];

  if (entry?.content?.$t) {
    htmlFragments.push(entry.content.$t);
  }

  if (entry?.summary?.$t) {
    htmlFragments.push(entry.summary.$t);
  }

  for (const fragment of htmlFragments) {
    if (!fragment) continue;

    try {
      const root = parseHtml(fragment);

      const fragmentCandidates =
        extractImageCandidatesFromNode(root, "feed-content");

      for (const candidate of fragmentCandidates) {
        addCandidate(
          candidates,
          candidate.url,
          candidate.source,
          Math.max(candidate.score, 100)
        );
      }
    } catch (error) {
      console.warn(
        `Feed HTML parsing warning: ${error.message}`
      );
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  return candidates;
}

// ------------------------------------------------------------
// Exact article container detection
// ------------------------------------------------------------

const POST_CONTAINER_HINTS = [
  "post-body",
  "post-content",
  "post-body-container",
  "post-outer",
  "post",
  "entry-content",
  "entry",
  "hentry",
  "blog-post",
  "article-body",
  "article-content",
  "blog-posts",
];

function isLikelyPostContainer(node) {
  if (!node || node.type !== "element") {
    return false;
  }

  if (
    node.tagName === "article" ||
    node.tagName === "main"
  ) {
    return true;
  }

  return hasClassOrId(node, POST_CONTAINER_HINTS);
}

function findTitleNodes(root, title) {
  const target = normalizeTitle(title);

  if (!target) return [];

  const headings = elementNodes(root).filter((node) =>
    ["h1", "h2", "h3", "h4"].includes(node.tagName)
  );

  return headings
    .map((node) => ({
      node,
      similarity: titleSimilarity(nodeText(node), title),
    }))
    .filter((item) => item.similarity >= 0.75)
    .sort((a, b) => b.similarity - a.similarity);
}

function findPermalinkNodes(root, postUrl) {
  const target = safeUrl(postUrl);

  if (!target) return [];

  let targetObj;

  try {
    targetObj = new URL(target);
  } catch {
    return [];
  }

  const anchors = elementNodes(root).filter(
    (node) => node.tagName === "a"
  );

  return anchors
    .map((node) => {
      const href = safeUrl(node.attributes.href);

      if (!href) {
        return null;
      }

      try {
        const hrefObj = new URL(href);

        const same =
          hrefObj.hostname === targetObj.hostname &&
          hrefObj.pathname === targetObj.pathname;

        return same ? node : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function scoreContainer(node, title) {
  if (!node || node.type !== "element") {
    return -Infinity;
  }

  let score = 0;

  if (node.tagName === "article") score += 50;
  if (node.tagName === "main") score += 10;

  if (hasClassOrId(node, ["post-body"])) {
    score += 80;
  }

  if (hasClassOrId(node, ["entry-content"])) {
    score += 75;
  }

  if (hasClassOrId(node, ["post-content"])) {
    score += 75;
  }

  if (hasClassOrId(node, ["hentry"])) {
    score += 60;
  }

  if (hasClassOrId(node, ["post-outer"])) {
    score += 55;
  }

  if (hasClassOrId(node, ["blog-post"])) {
    score += 55;
  }

  const text = nodeText(node);

  const similarity = titleSimilarity(text, title);

  score += similarity * 40;

  const images = extractImageCandidatesFromNode(
    node,
    "container"
  );

  score += Math.min(images.length, 5) * 5;

  return score;
}

function findExactPostContainer(root, post) {
  const candidates = [];

  // ----------------------------------------------------------
  // Method 1: Exact title heading → ancestor post container
  // ----------------------------------------------------------

  const titleNodes = findTitleNodes(root, post.title);

  for (const item of titleNodes) {
    const ancestors = getAncestorChain(item.node);

    for (const ancestor of ancestors) {
      if (isLikelyPostContainer(ancestor)) {
        candidates.push({
          node: ancestor,
          score:
            scoreContainer(ancestor, post.title) +
            item.similarity * 100,
          reason: "title-ancestor",
        });

        break;
      }
    }
  }

  // ----------------------------------------------------------
  // Method 2: Exact permalink → ancestor post container
  // ----------------------------------------------------------

  const permalinkNodes = findPermalinkNodes(root, post.url);

  for (const node of permalinkNodes) {
    const ancestors = getAncestorChain(node);

    for (const ancestor of ancestors) {
      if (isLikelyPostContainer(ancestor)) {
        candidates.push({
          node: ancestor,
          score:
            scoreContainer(ancestor, post.title) + 80,
          reason: "permalink-ancestor",
        });

        break;
      }
    }
  }

  // ----------------------------------------------------------
  // Method 3: If the page has <article>, inspect each article.
  // ----------------------------------------------------------

  const articles = elementNodes(root).filter(
    (node) => node.tagName === "article"
  );

  for (const article of articles) {
    const similarity = titleSimilarity(
      nodeText(article),
      post.title
    );

    if (similarity >= 0.35) {
      candidates.push({
        node: article,
        score: scoreContainer(article, post.title) + 60,
        reason: "article-title-similarity",
      });
    }
  }

  // ----------------------------------------------------------
  // Choose the highest-scoring candidate.
  // ----------------------------------------------------------

  candidates.sort((a, b) => b.score - a.score);

  if (!candidates.length) {
    return null;
  }

  return candidates[0];
}

// ------------------------------------------------------------
// Article-page image extraction
// ------------------------------------------------------------

function extractArticleScopedCandidates(html, post) {
  const root = parseHtml(html);

  const containerResult = findExactPostContainer(root, post);

  if (!containerResult) {
    console.log("Exact post container: NOT FOUND");

    return {
      container: null,
      candidates: [],
    };
  }

  console.log(
    `Exact post container: FOUND (${containerResult.reason}, score=${containerResult.score.toFixed(
      1
    )})`
  );

  const candidates = extractImageCandidatesFromNode(
    containerResult.node,
    "article-container"
  );

  candidates.sort((a, b) => b.score - a.score);

  return {
    container: containerResult.node,
    candidates,
  };
}

// ------------------------------------------------------------
// Metadata extraction
// ------------------------------------------------------------

function getEntryLink(entry) {
  const links = Array.isArray(entry?.link)
    ? entry.link
    : [];

  const alternate = links.find(
    (link) => link.rel === "alternate" && link.href
  );

  return alternate?.href || null;
}

function getPublishedDate(entry) {
  return (
    entry?.published?.$t ||
    entry?.updated?.$t ||
    null
  );
}

function formatDate(dateString) {
  if (!dateString) return null;

  const date = new Date(dateString);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function getCategories(entry) {
  const categories = Array.isArray(entry?.category)
    ? entry.category
    : [];

  return categories
    .map((category) => category?.term)
    .filter(Boolean);
}

function getExcerpt(entry) {
  const html =
    entry?.summary?.$t ||
    entry?.content?.$t ||
    "";

  const text = htmlToText(html);

  if (text.length <= 280) {
    return text;
  }

  return `${text.slice(0, 277).trim()}...`;
}

function getSiteTitle(feed) {
  return (
    feed?.feed?.title?.$t ||
    new URL(BLOG_URL).hostname
  );
}

function getSiteDescription(feed) {
  return (
    feed?.feed?.subtitle?.$t ||
    feed?.feed?.description?.$t ||
    ""
  );
}

// ------------------------------------------------------------
// Image validation
// ------------------------------------------------------------

function identifyImage(filePath) {
  try {
    const output = execFileSync(
      IDENTIFY_COMMAND,
      [
        "-format",
        "%m|%w|%h",
        filePath,
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }
    ).trim();

    if (!output) {
      throw new Error("ImageMagick returned no information");
    }

    const [format, width, height] = output.split("|");

    return {
      format,
      width: Number(width),
      height: Number(height),
    };
  } catch (error) {
    throw new Error(
      `ImageMagick could not identify image: ${error.message}`
    );
  }
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

/**
 * Generate a small grayscale perceptual fingerprint.
 *
 * Instead of hashing the original encoded file bytes, resize the
 * image to a tiny grayscale representation. This helps detect
 * visually identical images saved with different JPEG/PNG encoding.
 */
function perceptualFingerprint(filePath) {
  const tempPath = `${filePath}.fingerprint.raw`;

  try {
    execFileSync(
      CONVERT_COMMAND,
      [
        filePath,
        "-resize",
        "32x32!",
        "-colorspace",
        "Gray",
        "-depth",
        "8",
        "gray:" + tempPath,
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    const buffer = fs.readFileSync(tempPath);

    return crypto
      .createHash("sha256")
      .update(buffer)
      .digest("hex");
  } catch {
    return null;
  } finally {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // Ignore.
    }
  }
}

function validateImage(filePath) {
  const stat = fs.statSync(filePath);

  if (stat.size < MIN_IMAGE_BYTES) {
    throw new Error(
      `Image file too small: ${stat.size} bytes`
    );
  }

  const info = identifyImage(filePath);

  if (!Number.isFinite(info.width) || !Number.isFinite(info.height)) {
    throw new Error("Invalid image dimensions");
  }

  if (info.width < 200 || info.height < 150) {
    throw new Error(
      `Image dimensions too small: ${info.width}x${info.height}`
    );
  }

  const sha256 = sha256File(filePath);
  const perceptual = perceptualFingerprint(filePath);

  return {
    bytes: stat.size,
    ...info,
    sha256,
    perceptual,
  };
}

// ------------------------------------------------------------
// Candidate selection
// ------------------------------------------------------------

async function tryCandidate(
  candidate,
  postIndex,
  candidateIndex
) {
  const extensionPath =
    path.join(
      IMAGE_DIR,
      `.candidate-${postIndex}-${candidateIndex}.bin`
    );

  console.log(
    `Candidate ${candidateIndex}: ${candidate.url}`
  );

  try {
    console.log(
      `Downloading image: ${candidate.url}`
    );

    const downloaded = await downloadImage(
      candidate.url,
      extensionPath
    );

    console.log(
      `Content-Type: ${downloaded.contentType}`
    );

    console.log(
      `Downloaded: ${downloaded.bytes} bytes`
    );

    const info = validateImage(extensionPath);

    console.log(
      `ImageMagick: ${info.format}|${info.width}|${info.height}`
    );

    return {
      ...candidate,
      filePath: extensionPath,
      validation: info,
    };
  } catch (error) {
    console.log(`Rejected: ${error.message}`);

    try {
      fs.unlinkSync(extensionPath);
    } catch {
      // Ignore.
    }

    return null;
  }
}

function isDuplicateImage(validation, usedImages) {
  if (!validation) return false;

  for (const used of usedImages) {
    // Exact encoded bytes.
    if (
      validation.sha256 &&
      used.sha256 &&
      validation.sha256 === used.sha256
    ) {
      return true;
    }

    // Same normalized grayscale fingerprint.
    if (
      validation.perceptual &&
      used.perceptual &&
      validation.perceptual === used.perceptual
    ) {
      return true;
    }
  }

  return false;
}

async function selectImageForPost(
  post,
  postIndex,
  feedCandidates,
  articleCandidates,
  usedImages
) {
  const allCandidates = [];

  // Feed candidates get the highest priority.
  for (const candidate of feedCandidates) {
    allCandidates.push({
      ...candidate,
      priority: 300,
    });
  }

  // Article candidates are second priority.
  for (const candidate of articleCandidates) {
    allCandidates.push({
      ...candidate,
      priority: 200,
    });
  }

  // De-duplicate candidate URLs.
  const unique = [];

  for (const candidate of allCandidates) {
    if (!unique.some((x) => x.url === candidate.url)) {
      unique.push(candidate);
    }
  }

  unique.sort(
    (a, b) =>
      b.priority +
      b.score -
      (a.priority + a.score)
  );

  console.log(
    `Image candidates for Post ${postIndex}: ${unique.length}`
  );

  if (!unique.length) {
    return null;
  }

  let candidateNumber = 0;

  for (const candidate of unique) {
    candidateNumber++;

    const result = await tryCandidate(
      candidate,
      postIndex,
      candidateNumber
    );

    if (!result) {
      continue;
    }

    if (
      isDuplicateImage(
        result.validation,
        usedImages
      )
    ) {
      console.log(
        "Rejected: image is a duplicate of an already selected post image"
      );

      try {
        fs.unlinkSync(result.filePath);
      } catch {
        // Ignore.
      }

      continue;
    }

    return result;
  }

  return null;
}

// ------------------------------------------------------------
// Feed URL
// ------------------------------------------------------------

function buildFeedUrls(blogUrl) {
  const base = new URL(blogUrl);

  const origin = `${base.protocol}//${base.host}`;

  return [
    `${origin}/feeds/posts/default?alt=json&max-results=${FEED_MAX_RESULTS}`,
    `${origin}/feeds/posts/default?alt=json-in-script&max-results=${FEED_MAX_RESULTS}`,
  ];
}

async function fetchBloggerFeed() {
  const urls = buildFeedUrls(BLOG_URL);

  let lastError = null;

  for (const feedUrl of urls) {
    console.log(`Feed URL: ${feedUrl}`);

    try {
      const response = await fetchWithTimeout(feedUrl, {
        accept:
          "application/json,application/javascript,text/javascript,*/*;q=0.8",
      });

      if (!response.ok) {
        throw new Error(
          `Feed HTTP ${response.status}`
        );
      }

      const text = await response.text();

      let jsonText = text.trim();

      // Handle JSON-in-script style response if encountered.
      jsonText = jsonText
        .replace(/^callback\s*\(/i, "")
        .replace(/\);\s*$/i, "")
        .trim();

      const data = JSON.parse(jsonText);

      return {
        data,
        feedUrl,
      };
    } catch (error) {
      lastError = error;

      console.log(
        `Feed request failed: ${error.message}`
      );

      // Do not hammer Blogger with repeated requests.
      await sleep(1200);
    }
  }

  throw (
    lastError ||
    new Error("Unable to fetch Blogger JSON feed")
  );
}

// ------------------------------------------------------------
// Cleanup
// ------------------------------------------------------------

function cleanOutputDirectory() {
  fs.mkdirSync(IMAGE_DIR, {
    recursive: true,
  });

  for (const file of fs.readdirSync(IMAGE_DIR)) {
    const fullPath = path.join(IMAGE_DIR, file);

    if (
      file.startsWith(".candidate-") ||
      /^post-\d+\.(jpg|jpeg|png|webp)$/i.test(file)
    ) {
      try {
        fs.unlinkSync(fullPath);
      } catch {
        // Ignore.
      }
    }
  }
}

// ------------------------------------------------------------
// Main
// ------------------------------------------------------------

async function main() {
  cleanOutputDirectory();

  console.log("Fetching Blogger JSON Feed...");

  const { data: feed, feedUrl } =
    await fetchBloggerFeed();

  const entries = Array.isArray(feed?.feed?.entry)
    ? feed.feed.entry
    : [];

  console.log("Feed fetched successfully.");
  console.log(`Feed entries: ${entries.length}`);

  if (entries.length < MAX_POSTS) {
    throw new Error(
      `Blogger feed returned only ${entries.length} posts. Required: ${MAX_POSTS}`
    );
  }

  const selectedPosts = [];
  const usedImages = [];

  for (
    let index = 0;
    index < MAX_POSTS;
    index++
  ) {
    const entry = entries[index];

    const title =
      entry?.title?.$t ||
      `Untitled Post ${index + 1}`;

    const postUrl = getEntryLink(entry);

    if (!postUrl) {
      throw new Error(
        `Post ${index + 1} has no alternate URL: ${title}`
      );
    }

    console.log(
      "------------------------------------------------------------"
    );

    console.log(
      `Post ${index + 1}: ${title}`
    );

    console.log(`URL: ${postUrl}`);

    // --------------------------------------------------------
    // 1. Feed-level image extraction
    // --------------------------------------------------------

    const feedCandidates =
      extractFeedImageCandidates(entry);

    console.log(
      `Feed image candidates: ${feedCandidates.length}`
    );

    // --------------------------------------------------------
    // 2. Try Feed candidates FIRST.
    // --------------------------------------------------------

    let selected = await selectImageForPost(
      {
        title,
        url: postUrl,
      },
      index + 1,
      feedCandidates,
      [],
      usedImages
    );

    // --------------------------------------------------------
    // 3. Only if Feed images fail, request exact article.
    // --------------------------------------------------------

    let articleHtml = null;

    if (!selected) {
      console.log(
        "Feed candidates failed. Fetching exact article page for fallback..."
      );

      try {
        const result =
          await fetchTextWithLimitedRetry(
            postUrl,
            `Article page ${index + 1}`
          );

        articleHtml = result.text;

        console.log(
          `Article page fetched: ${articleHtml.length} bytes`
        );
      } catch (error) {
        console.log(
          `Article page fetch failed: ${error.message}`
        );
      }
    }

    // --------------------------------------------------------
    // 4. Exact post container only.
    // --------------------------------------------------------

    let articleCandidates = [];

    if (!selected && articleHtml) {
      const scoped =
        extractArticleScopedCandidates(
          articleHtml,
          {
            title,
            url: postUrl,
          }
        );

      articleCandidates =
        scoped.candidates;

      console.log(
        `Page-local image candidates: ${articleCandidates.length}`
      );

      selected = await selectImageForPost(
        {
          title,
          url: postUrl,
        },
        index + 1,
        [],
        articleCandidates,
        usedImages
      );
    }

    // --------------------------------------------------------
    // 5. Do NOT use site-wide OG/Twitter metadata.
    // --------------------------------------------------------

    if (!selected) {
      throw new Error(
        `All image candidates were rejected for Post ${
          index + 1
        }: ${title}`
      );
    }

    // --------------------------------------------------------
    // 6. Save final image.
    // --------------------------------------------------------

    const finalPath = path.join(
      IMAGE_DIR,
      `post-${index + 1}.jpg`
    );

    // Convert every accepted source to JPEG.
    try {
      execFileSync(
        CONVERT_COMMAND,
        [
          selected.filePath,
          "-auto-orient",
          "-strip",
          "-quality",
          "92",
          finalPath,
        ],
        {
          stdio: ["ignore", "pipe", "pipe"],
        }
      );
    } catch (error) {
      throw new Error(
        `Failed to convert image to JPEG: ${error.message}`
      );
    }

    try {
      fs.unlinkSync(selected.filePath);
    } catch {
      // Ignore.
    }

    const finalValidation =
      validateImage(finalPath);

    if (
      isDuplicateImage(
        finalValidation,
        usedImages
      )
    ) {
      throw new Error(
        `Exact/visual duplicate image detected after conversion for Post ${
          index + 1
        }: ${title}`
      );
    }

    usedImages.push({
      sha256: finalValidation.sha256,
      perceptual: finalValidation.perceptual,
    });

    console.log(
      `Selected image: blog/images/post-${index + 1}.jpg`
    );

    console.log(
      `Selected source: ${selected.source}`
    );

    console.log(
      `Selected URL: ${selected.url}`
    );

    console.log(
      `Selected bytes: ${finalValidation.bytes}`
    );

    // --------------------------------------------------------
    // 7. Build post data.
    // --------------------------------------------------------

    selectedPosts.push({
      index: index + 1,
      title,
      url: postUrl,
      published: getPublishedDate(entry),
      date: formatDate(
        getPublishedDate(entry)
      ),
      excerpt: getExcerpt(entry),
      categories: getCategories(entry),
      localImage:
        `blog/images/post-${index + 1}.jpg`,
      imageSource: selected.source,
    });

    // Small delay between article requests.
    // Feed extraction normally means this is not reached.
    await sleep(350);
  }

  // ----------------------------------------------------------
  // Final validation
  // ----------------------------------------------------------

  if (selectedPosts.length !== MAX_POSTS) {
    throw new Error(
      `Expected ${MAX_POSTS} posts, got ${selectedPosts.length}`
    );
  }

  const imagePaths = selectedPosts.map(
    (post) =>
      path.join(
        OUTPUT_ROOT,
        post.localImage.replace(
          /^blog[\\/]/,
          ""
        )
      )
  );

  const imageHashes = new Set();
  const perceptualHashes = new Set();

  for (let i = 0; i < imagePaths.length; i++) {
    const filePath = imagePaths[i];

    if (!fs.existsSync(filePath)) {
      throw new Error(
        `Missing image file: ${filePath}`
      );
    }

    const validation =
      validateImage(filePath);

    if (imageHashes.has(validation.sha256)) {
      throw new Error(
        `Exact duplicate image detected: ${filePath}`
      );
    }

    if (
      validation.perceptual &&
      perceptualHashes.has(
        validation.perceptual
      )
    ) {
      throw new Error(
        `Visual duplicate image detected: ${filePath}`
      );
    }

    imageHashes.add(validation.sha256);

    if (validation.perceptual) {
      perceptualHashes.add(
        validation.perceptual
      );
    }
  }

  // ----------------------------------------------------------
  // Blog metadata
  // ----------------------------------------------------------

  const hostname = new URL(BLOG_URL).hostname;

  const siteTitle =
    getSiteTitle(feed);

  const description =
    getSiteDescription(feed);

  const firstPostTitle =
    selectedPosts[0]?.title || "";

  const blogJson = {
    version: 10.6,
    capturedAt: new Date().toISOString(),
    url: BLOG_URL,
    hostname,
    siteTitle,
    description,
    pageHeading: siteTitle,
    ogImage: null,
    language: "en",
    postCount: selectedPosts.length,

    analysis: {
      identity:
        "English-language financial and U.S. market content",
      topics: [
        "U.S. stock market",
        "financial markets",
        "market news",
        "economic indicators",
        "investing",
      ],
      audience:
        "Readers interested in financial markets, investing, and market-moving news",
      contentStyle:
        "Short, information-focused financial news and market analysis",
      valueProposition:
        "Concise market updates and actionable context for investors",
    },

    feed: {
      url: feedUrl,
      entriesFetched: entries.length,
    },

    posts: selectedPosts,
  };

  fs.writeFileSync(
    BLOG_JSON_PATH,
    JSON.stringify(blogJson, null, 2),
    "utf8"
  );

  console.log(
    "============================================================"
  );

  console.log(
    `BLOG ANALYZER v10.6 SUCCESS`
  );

  console.log(
    `Posts captured: ${selectedPosts.length}`
  );

  console.log(
    `blog.json: ${BLOG_JSON_PATH}`
  );

  console.log(
    `Images: ${IMAGE_DIR}`
  );

  console.log(
    "============================================================"
  );
}

main().catch((error) => {
  console.error(
    "============================================================"
  );

  console.error(
    "BLOG ANALYZER v10.6 FAILED"
  );

  console.error(
    `Error: ${error.message}`
  );

  console.error(
    "============================================================"
  );

  process.exit(1);
});
