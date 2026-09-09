import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {execFileSync} from "node:child_process";

const VERSION = "11.1";

const rawUrl = process.argv[2];

if (!rawUrl) {
  console.error("Usage: node scripts/capture-blog.mjs <blog-url>");
  process.exit(1);
}

const stripMarkdownUrl = (value) => {
  const text = String(value || "").trim();
  const match = text.match(/^\[[^\]]+\]\((https?:\/\/[^)]+)\)$/i);
  return match ? match[1] : text;
};

const BLOG_URL = stripMarkdownUrl(rawUrl);

let parsedUrl;

try {
  parsedUrl = new URL(BLOG_URL);

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("Unsupported protocol");
  }
} catch {
  console.error(`Invalid blog URL: ${BLOG_URL}`);
  process.exit(1);
}

const OUTPUT_DIR = path.resolve("template/public/blog");
const POSTS_DIR = path.join(OUTPUT_DIR, "images");

fs.rmSync(OUTPUT_DIR, {
  recursive: true,
  force: true,
});

fs.mkdirSync(POSTS_DIR, {
  recursive: true,
});

const clean = (value = "") =>
  String(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const unique = (items) => [
  ...new Set(
    (items || [])
      .filter(Boolean)
      .map((item) => String(item).trim())
      .filter(Boolean),
  ),
];

const asArray = (value) =>
  Array.isArray(value) ? value : value ? [value] : [];

const absoluteUrl = (value) => {
  if (!value) return "";

  try {
    const url = new URL(String(value).trim(), parsedUrl.href);

    if (!["http:", "https:"].includes(url.protocol)) {
      return "";
    }

    return url.href;
  } catch {
    return "";
  }
};

const decodeHtml = (value = "") =>
  String(value)
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#47;/gi, "/")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x3D;/gi, "=");

const stripHtml = (value = "") =>
  clean(
    decodeHtml(
      String(value)
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " "),
    ),
  );

const normalizeUrlText = (value = "") => {
  return decodeHtml(String(value))
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003d/gi, "=")
    .replace(/\\\//g, "/")
    .trim();
};

/* ============================================================
 * Blogger image URL handling
 * ============================================================ */

const isBloggerHost = (url) => {
  try {
    const host = new URL(url).hostname.toLowerCase();

    return (
      host === "blogger.googleusercontent.com" ||
      host.endsWith(".googleusercontent.com") ||
      host === "blogspot.com" ||
      host.endsWith(".blogspot.com")
    );
  } catch {
    return false;
  }
};

const isUnsplashPageUrl = (url) => {
  try {
    const host = new URL(url).hostname.toLowerCase();

    if (!host.includes("unsplash.com")) {
      return false;
    }

    /*
     * Unsplash image CDN:
     * images.unsplash.com
     *
     * Unsplash website pages:
     * unsplash.com
     */
    return !host.startsWith("images.unsplash.com");
  } catch {
    return false;
  }
};

const isImageLikeUrl = (value) => {
  if (!value) return false;

  const url = absoluteUrl(value);

  if (!url) return false;

  if (/^data:/i.test(url)) {
    return false;
  }

  if (isUnsplashPageUrl(url)) {
    return false;
  }

  try {
    const parsed = new URL(url);

    const pathname = parsed.pathname.toLowerCase();

    if (
      pathname.endsWith(".jpg") ||
      pathname.endsWith(".jpeg") ||
      pathname.endsWith(".png") ||
      pathname.endsWith(".webp") ||
      pathname.endsWith(".gif") ||
      pathname.endsWith(".avif") ||
      pathname.endsWith(".bmp") ||
      pathname.endsWith(".tif") ||
      pathname.endsWith(".tiff")
    ) {
      return true;
    }

    if (isBloggerHost(url)) {
      if (
        /\/s\d+(?:-[^/]+)?\/$/i.test(pathname) ||
        /\/w\d+(?:-h\d+)?(?:-[^/]+)?\/$/i.test(pathname) ||
        /\/h\d+(?:-w\d+)?(?:-[^/]+)?\/$/i.test(pathname)
      ) {
        return false;
      }

      if (
        /\/img\/b\//i.test(pathname) ||
        /googleusercontent\.com/i.test(url)
      ) {
        return true;
      }
    }

    if (url.includes("images.unsplash.com")) {
      return true;
    }

    if (
      /[?&](?:format|fm)=(?:jpg|jpeg|png|webp|gif|avif)/i.test(url)
    ) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
};

const isIncompleteBloggerUrl = (value) => {
  const url = absoluteUrl(value);

  if (!url) return true;

  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;

    /*
     * Examples of invalid Blogger URLs:
     *
     * /s1600/
     * /w1200/
     * /h60/
     * /w1200-h675-p-k-no-nu/
     */
    if (/\/(?:s\d+|w\d+|h\d+)(?:-[^/]+)?\/$/i.test(pathname)) {
      return true;
    }

    /*
     * Googleusercontent image path must have an actual file
     * or a concrete path component after the resize segment.
     */
    if (
      /googleusercontent\.com/i.test(parsed.hostname) &&
      /\/(?:s\d+|w\d+|h\d+)(?:-[^/]+)?\/$/i.test(pathname)
    ) {
      return true;
    }

    return false;
  } catch {
    return true;
  }
};

const normalizeBloggerImageUrl = (value) => {
  let url = absoluteUrl(normalizeUrlText(value));

  if (!url) return "";

  if (isUnsplashPageUrl(url)) {
    return "";
  }

  try {
    const parsed = new URL(url);

    /*
     * Blogger path style:
     *
     * /s72-c/file.jpg
     * /s1600/file.jpg
     * /w1200/file.jpg
     * /w72-h72-p-k-no-nu/file.jpg
     *
     * Normalize to a large image while preserving filename.
     */

    parsed.pathname = parsed.pathname
      .replace(
        /\/s\d+(?:-[^/]+)?\//i,
        "/s1600/",
      )
      .replace(
        /\/w\d+(?:-h\d+)?(?:-[^/]+)?\//i,
        "/s1600/",
      )
      .replace(
        /\/h\d+(?:-w\d+)?(?:-[^/]+)?\//i,
        "/s1600/",
      );

    /*
     * Blogger query resize:
     * ?=s72
     */
    parsed.search = parsed.search.replace(
      /=s\d+(?:-[^&]*)?/gi,
      "=s1600",
    );

    url = parsed.href;
  } catch {
    return "";
  }

  if (isIncompleteBloggerUrl(url)) {
    return "";
  }

  return url;
};

/* ============================================================
 * HTML attribute extraction
 * ============================================================ */

const getAttributes = (tag) => {
  const attrs = {};

  const regex =
    /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;

  let match;

  while ((match = regex.exec(tag))) {
    const key = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";

    attrs[key] = decodeHtml(value);
  }

  return attrs;
};

const parseSrcset = (value) => {
  if (!value) return [];

  return String(value)
    .split(",")
    .map((part) => {
      const pieces = part.trim().split(/\s+/);
      return pieces[0] || "";
    })
    .filter(Boolean);
};

/* ============================================================
 * Extract actual image URLs from HTML
 * ============================================================ */

const extractImageUrlsFromHtml = (html, options = {}) => {
  const {
    allowAnchors = true,
    includeRawUrls = true,
  } = options;

  const candidates = [];

  const add = (value) => {
    const normalized = normalizeBloggerImageUrl(value);

    if (!normalized) return;

    if (!isImageLikeUrl(normalized)) return;

    if (isIncompleteBloggerUrl(normalized)) return;

    candidates.push(normalized);
  };

  /*
   * ----------------------------------------------------------
   * 1. <img ...>
   * ----------------------------------------------------------
   */
  const imgRegex = /<img\b[^>]*>/gi;

  let imgMatch;

  while ((imgMatch = imgRegex.exec(html))) {
    const tag = imgMatch[0];
    const attrs = getAttributes(tag);

    const directAttributes = [
      "src",
      "data-src",
      "data-original",
      "data-original-src",
      "data-lazy-src",
      "data-lazy",
      "data-image",
      "data-image-url",
      "data-url",
      "data-filename",
      "data-full",
      "data-full-src",
      "data-large",
      "data-large-src",
      "data-original-image",
      "data-original-url",
    ];

    for (const attr of directAttributes) {
      if (attrs[attr]) {
        add(attrs[attr]);
      }
    }

    /*
     * srcset / data-srcset
     */
    for (const attr of [
      "srcset",
      "data-srcset",
      "data-lazy-srcset",
    ]) {
      if (attrs[attr]) {
        for (const value of parseSrcset(attrs[attr])) {
          add(value);
        }
      }
    }

    /*
     * Blogger occasionally stores the full image URL
     * in style="background-image:url(...)"
     */
    if (attrs.style) {
      const styleMatches = attrs.style.match(
        /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi,
      );

      if (styleMatches) {
        for (const item of styleMatches) {
          const match = item.match(
            /url\(\s*['"]?([^'")]+)['"]?\s*\)/i,
          );

          if (match?.[1]) {
            add(match[1]);
          }
        }
      }
    }

    /*
     * Look around the <img> tag for an enclosing <a href>.
     *
     * This is important for Blogger because:
     *
     * <img src=".../s1600/">
     *
     * can be wrapped by:
     *
     * <a href=".../s1600/file.webp">
     *
     * The <a> URL is often the real full image.
     */
    if (allowAnchors) {
      const start = Math.max(0, imgMatch.index - 1500);
      const before = html.slice(start, imgMatch.index);

      const anchorMatches = [
        ...before.matchAll(
          /<a\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)')/gi,
        ),
      ];

      for (const anchor of anchorMatches.slice(-3)) {
        const href = anchor[1] || anchor[2] || "";

        if (isImageLikeUrl(href)) {
          add(href);
        }
      }

      const afterStart = imgMatch.index + tag.length;
      const after = html.slice(
        afterStart,
        Math.min(html.length, afterStart + 1500),
      );

      const afterAnchorMatches = [
        ...after.matchAll(
          /<a\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)')/gi,
        ),
      ];

      for (const anchor of afterAnchorMatches.slice(0, 2)) {
        const href = anchor[1] || anchor[2] || "";

        if (isImageLikeUrl(href)) {
          add(href);
        }
      }
    }
  }

  /*
   * ----------------------------------------------------------
   * 2. <source srcset>
   * ----------------------------------------------------------
   */
  const sourceRegex = /<source\b[^>]*>/gi;

  let sourceMatch;

  while ((sourceMatch = sourceRegex.exec(html))) {
    const attrs = getAttributes(sourceMatch[0]);

    for (const attr of [
      "src",
      "srcset",
      "data-src",
      "data-srcset",
    ]) {
      if (!attrs[attr]) continue;

      if (attr.includes("srcset")) {
        for (const value of parseSrcset(attrs[attr])) {
          add(value);
        }
      } else {
        add(attrs[attr]);
      }
    }
  }

  /*
   * ----------------------------------------------------------
   * 3. Raw image URLs
   *
   * Only accept concrete image URLs.
   * Never accept generic hrefs such as:
   *
   * https://unsplash.com/@user
   * https://unsplash.com/
   * ----------------------------------------------------------
   */
  if (includeRawUrls) {
    const rawRegex =
      /https?:\/\/[^"'<>\\\s]+/gi;

    let rawMatch;

    while ((rawMatch = rawRegex.exec(html))) {
      const raw = normalizeUrlText(rawMatch[0])
        .replace(/[),;]+$/g, "");

      if (isImageLikeUrl(raw)) {
        add(raw);
      }
    }
  }

  return unique(candidates);
};

/* ============================================================
 * Feed image extraction
 * ============================================================ */

const getEntryLink = (entry) => {
  const links = asArray(entry?.link);

  return (
    links.find((item) => item?.rel === "alternate")?.href ||
    links.find((item) => item?.href)?.href ||
    ""
  );
};

const feedImageCandidates = (entry) => {
  const candidates = [];

  const add = (value) => {
    const normalized = normalizeBloggerImageUrl(value);

    if (!normalized) return;

    if (!isImageLikeUrl(normalized)) return;

    candidates.push(normalized);
  };

  /*
   * Blogger JSON media:thumbnail
   */
  add(entry?.media$thumbnail?.url);

  /*
   * Blogger JSON media:group
   */
  const group = entry?.media$group;

  if (group) {
    for (const item of asArray(group.media$content)) {
      add(item?.url);
    }

    for (const item of asArray(group.media$thumbnail)) {
      add(item?.url);
    }
  }

  /*
   * Actual article HTML from JSON feed.
   *
   * This is the most important part for the current bug.
   */
  const content = entry?.content?.$t || "";
  const summary = entry?.summary?.$t || "";

  candidates.push(
    ...extractImageUrlsFromHtml(content, {
      allowAnchors: true,
      includeRawUrls: true,
    }),
  );

  candidates.push(
    ...extractImageUrlsFromHtml(summary, {
      allowAnchors: true,
      includeRawUrls: true,
    }),
  );

  return unique(candidates);
};

/* ============================================================
 * Article HTML extraction
 * ============================================================ */

const findArticleImageCandidates = (html, title) => {
  const candidates = [];

  /*
   * Strategy 1:
   * Extract from common Blogger post-body regions.
   *
   * We do NOT depend on one specific class such as "class-block".
   */
  const regionPatterns = [
    /<div[^>]+class=["'][^"']*\bpost-body\b[^"']*["'][^>]*>[\s\S]{0,500000}?<\/div>/gi,

    /<div[^>]+class=["'][^"']*\bpost-body-container\b[^"']*["'][^>]*>[\s\S]{0,500000}?<\/div>/gi,

    /<div[^>]+class=["'][^"']*\bentry-content\b[^"']*["'][^>]*>[\s\S]{0,500000}?<\/div>/gi,

    /<div[^>]+class=["'][^"']*\bpost-content\b[^"']*["'][^>]*>[\s\S]{0,500000}?<\/div>/gi,

    /<div[^>]+itemprop=["']articleBody["'][^>]*>[\s\S]{0,500000}?<\/div>/gi,

    /<article\b[^>]*>[\s\S]{0,500000}<\/article>/gi,
  ];

  for (const pattern of regionPatterns) {
    const matches = [...html.matchAll(pattern)];

    for (const match of matches) {
      const region = match[0];

      const extracted = extractImageUrlsFromHtml(region, {
        allowAnchors: true,
        includeRawUrls: true,
      });

      candidates.push(...extracted);
    }
  }

  /*
   * Strategy 2:
   *
   * If the structured regions failed, scan all <img> tags,
   * but score those close to the article title/post body.
   *
   * This prevents selecting sidebar images from older posts.
   */
  const titleText = clean(title).toLowerCase();

  const imgRegex = /<img\b[^>]*>/gi;

  let match;

  while ((match = imgRegex.exec(html))) {
    const start = Math.max(0, match.index - 8000);
    const end = Math.min(
      html.length,
      match.index + 8000,
    );

    const context = html
      .slice(start, end)
      .toLowerCase();

    let score = 0;

    if (context.includes("post-body")) score += 100;
    if (context.includes("entry-content")) score += 80;
    if (context.includes("post-content")) score += 80;
    if (context.includes("articlebody")) score += 80;

    if (titleText && context.includes(titleText)) {
      score += 100;
    }

    const extracted = extractImageUrlsFromHtml(
      match[0],
      {
        allowAnchors: true,
        includeRawUrls: true,
      },
    );

    for (const url of extracted) {
      candidates.push({
        url,
        score,
      });
    }
  }

  const normalized = [];

  for (const item of candidates) {
    if (typeof item === "string") {
      normalized.push(item);
    } else if (item?.url) {
      normalized.push(item.url);
    }
  }

  return unique(normalized);
};

/* ============================================================
 * HTTP
 * ============================================================ */

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const fetchWithRetry = async (
  url,
  options = {},
  retries = 2,
) => {
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        ...options,
        headers: {
          "user-agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36 BlogPromoBot/11.1",
          accept:
            options.accept ||
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          ...options.headers,
        },
      });

      if (response.ok) {
        return response;
      }

      if (
        response.status === 429 ||
        response.status === 403 ||
        response.status >= 500
      ) {
        if (attempt < retries) {
          const delay =
            1200 * Math.pow(2, attempt);

          console.warn(
            `HTTP ${response.status} for ${url} - retrying in ${delay}ms`,
          );

          await sleep(delay);
          continue;
        }
      }

      throw new Error(
        `HTTP ${response.status} ${response.statusText}`,
      );
    } catch (error) {
      lastError = error;

      if (attempt < retries) {
        const delay =
          1200 * Math.pow(2, attempt);

        console.warn(
          `Fetch failed: ${url} - retrying in ${delay}ms`,
        );

        await sleep(delay);
      }
    }
  }

  throw lastError || new Error("Request failed");
};

const fetchText = async (url) => {
  const response = await fetchWithRetry(url, {
    accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  });

  return response.text();
};

const fetchJson = async (url) => {
  const response = await fetchWithRetry(url, {
    accept:
      "application/json,text/javascript,application/javascript,*/*;q=0.8",
  });

  return response.json();
};

/* ============================================================
 * ImageMagick
 * ============================================================ */

const commandExists = (command) => {
  try {
    execFileSync(command, ["-version"], {
      stdio: ["ignore", "ignore", "ignore"],
    });

    return true;
  } catch {
    return false;
  }
};

const detectImageMagick = () => {
  if (commandExists("identify") && commandExists("convert")) {
    return {
      identify: "identify",
      convert: "convert",
    };
  }

  if (commandExists("magick")) {
    try {
      const version = execFileSync(
        "magick",
        ["-version"],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        },
      );

      const major = Number(
        version.match(/ImageMagick\s+(\d+)/i)?.[1] || 7,
      );

      /*
       * ImageMagick 7:
       *
       * magick identify file
       *
       * ImageMagick 6:
       *
       * identify file
       */
      if (major >= 7) {
        return {
          identify: ["magick", "identify"],
          convert: ["magick"],
        };
      }
    } catch {
      // ignore
    }
  }

  return null;
};

const IM = detectImageMagick();

if (IM) {
  console.log(
    `ImageMagick identify command: ${
      Array.isArray(IM.identify)
        ? IM.identify.join(" ")
        : IM.identify
    }`,
  );

  console.log(
    `ImageMagick convert command: ${
      Array.isArray(IM.convert)
        ? IM.convert.join(" ")
        : IM.convert
    }`,
  );

  try {
    const command = Array.isArray(IM.identify)
      ? IM.identify[0]
      : IM.identify;

    const args = Array.isArray(IM.identify)
      ? IM.identify.slice(1).concat(["-version"])
      : ["-version"];

    const version = execFileSync(command, args, {
      encoding: "utf8",
    });

    console.log(
      `ImageMagick: ${version.trim()}`,
    );
  } catch {
    // ignore
  }
} else {
  console.warn(
    "ImageMagick not detected. Magic-byte validation will still be used.",
  );
}

/* ============================================================
 * Image validation
 * ============================================================ */

const detectImageType = (buffer) => {
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
    return "image/jpeg";
  }

  /*
   * PNG
   */
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  /*
   * GIF
   */
  const gifHeader = buffer
    .subarray(0, 6)
    .toString("ascii");

  if (
    gifHeader === "GIF87a" ||
    gifHeader === "GIF89a"
  ) {
    return "image/gif";
  }

  /*
   * WEBP
   */
  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }

  /*
   * AVIF / HEIF
   */
  if (
    buffer.subarray(4, 12).toString("ascii").includes("ftyp")
  ) {
    const brand = buffer
      .subarray(8, 16)
      .toString("ascii");

    if (
      brand.includes("avif") ||
      brand.includes("avis")
    ) {
      return "image/avif";
    }
  }

  return null;
};

const validateWithImageMagick = (
  filePath,
) => {
  if (!IM) {
    return {
      valid: true,
      width: null,
      height: null,
    };
  }

  try {
    let command;
    let args;

    if (Array.isArray(IM.identify)) {
      command = IM.identify[0];
      args = [
        ...IM.identify.slice(1),
        "-format",
        "%m %wx%h",
        filePath,
      ];
    } else {
      command = IM.identify;
      args = [
        "-format",
        "%m %wx%h",
        filePath,
      ];
    }

    const output = execFileSync(
      command,
      args,
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trim();

    const match = output.match(
      /^([A-Z0-9]+)\s+(\d+)x(\d+)/i,
    );

    if (!match) {
      return {
        valid: false,
        reason: "ImageMagick could not determine image dimensions",
      };
    }

    const width = Number(match[2]);
    const height = Number(match[3]);

    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width < 100 ||
      height < 100
    ) {
      return {
        valid: false,
        reason: `Image too small: ${width}x${height}`,
      };
    }

    return {
      valid: true,
      format: match[1],
      width,
      height,
    };
  } catch (error) {
    return {
      valid: false,
      reason: `ImageMagick validation failed: ${error.message}`,
    };
  }
};

/* ============================================================
 * Duplicate detection
 * ============================================================ */

const hashBuffer = (buffer) =>
  crypto
    .createHash("sha256")
    .update(buffer)
    .digest("hex");

const getVisualFingerprint = (buffer) => {
  if (!IM) {
    return null;
  }

  try {
    let command;
    let args;

    if (Array.isArray(IM.convert)) {
      command = IM.convert[0];

      args = [
        ...IM.convert.slice(1),
        "-",
        "-auto-orient",
        "-colorspace",
        "Gray",
        "-resize",
        "64x64!",
        "-depth",
        "8",
        "gray:-",
      ];
    } else {
      command = IM.convert;

      args = [
        "-",
        "-auto-orient",
        "-colorspace",
        "Gray",
        "-resize",
        "64x64!",
        "-depth",
        "8",
        "gray:-",
      ];
    }

    const output = execFileSync(
      command,
      args,
      {
        input: buffer,
        maxBuffer: 1024 * 1024,
        stdio: ["pipe", "pipe", "ignore"],
      },
    );

    if (output.length !== 64 * 64) {
      return null;
    }

    const quantized = Buffer.alloc(
      output.length,
    );

    for (
      let i = 0;
      i < output.length;
      i++
    ) {
      quantized[i] = output[i] >> 4;
    }

    const canonicalHash = crypto
      .createHash("sha256")
      .update(quantized)
      .digest("hex");

    const average =
      output.reduce(
        (sum, value) => sum + value,
        0,
      ) / output.length;

    let averageHash = "";

    for (const value of output) {
      averageHash +=
        value >= average ? "1" : "0";
    }

    let differenceHash = "";

    for (let y = 0; y < 64; y++) {
      const row = y * 64;

      for (let x = 0; x < 63; x++) {
        differenceHash +=
          output[row + x] >
          output[row + x + 1]
            ? "1"
            : "0";
      }
    }

    return {
      canonicalHash,
      averageHash,
      differenceHash,
    };
  } catch {
    return null;
  }
};

const hammingDistance = (a, b) => {
  if (
    !a ||
    !b ||
    a.length !== b.length
  ) {
    return Infinity;
  }

  let distance = 0;

  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      distance++;
    }
  }

  return distance;
};

const isVisuallyDuplicate = (
  fingerprint,
  previousFingerprints,
) => {
  if (!fingerprint) {
    return false;
  }

  for (const previous of previousFingerprints) {
    if (
      fingerprint.canonicalHash &&
      previous.canonicalHash &&
      fingerprint.canonicalHash ===
        previous.canonicalHash
    ) {
      return true;
    }

    const aHashDistance =
      hammingDistance(
        fingerprint.averageHash,
        previous.averageHash,
      );

    const dHashDistance =
      hammingDistance(
        fingerprint.differenceHash,
        previous.differenceHash,
      );

    if (
      aHashDistance <= 12 &&
      dHashDistance <= 20
    ) {
      return true;
    }

    if (
      aHashDistance <= 24 &&
      dHashDistance <= 32
    ) {
      return true;
    }
  }

  return false;
};

/* ============================================================
 * Image extension
 * ============================================================ */

const extensionFor = (
  contentType,
  detectedType,
  url,
) => {
  const type = String(
    detectedType ||
      contentType ||
      "",
  )
    .split(";")[0]
    .toLowerCase();

  if (type === "image/jpeg") return ".jpg";
  if (type === "image/png") return ".png";
  if (type === "image/webp") return ".webp";
  if (type === "image/gif") return ".gif";
  if (type === "image/avif") return ".avif";

  try {
    const ext = path
      .extname(new URL(url).pathname)
      .toLowerCase();

    if (
      [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"].includes(
        ext,
      )
    ) {
      return ext === ".jpeg"
        ? ".jpg"
        : ext;
    }
  } catch {
    // ignore
  }

  return ".jpg";
};

/* ============================================================
 * Download + validate + deduplicate
 * ============================================================ */

const downloadUniqueImage = async (
  candidates,
  index,
  usedHashes,
  usedFingerprints,
) => {
  const candidateList = unique(candidates);

  console.log(
    `Trying ${candidateList.length} image candidates...`,
  );

  for (
    let candidateIndex = 0;
    candidateIndex < candidateList.length;
    candidateIndex++
  ) {
    const candidate =
      candidateList[candidateIndex];

    const url =
      normalizeBloggerImageUrl(candidate);

    if (!url) {
      continue;
    }

    if (isUnsplashPageUrl(url)) {
      console.log(
        `  Candidate ${candidateIndex + 1}: skipped Unsplash page URL`,
      );
      continue;
    }

    if (isIncompleteBloggerUrl(url)) {
      console.log(
        `  Candidate ${candidateIndex + 1}: skipped incomplete Blogger URL`,
      );
      continue;
    }

    console.log(
      `  Candidate ${candidateIndex + 1}: ${url}`,
    );

    try {
      const response =
        await fetchWithRetry(
          url,
          {
            accept:
              "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          },
          2,
        );

      const contentType =
        response.headers.get(
          "content-type",
        ) || "";

      const buffer =
        Buffer.from(
          await response.arrayBuffer(),
        );

      console.log(
        `    HTTP ${response.status}`,
      );

      console.log(
        `    Content-Type: ${contentType}`,
      );

      console.log(
        `    Downloaded: ${buffer.length} bytes`,
      );

      if (buffer.length < 5000) {
        console.log(
          "    Rejected: image is too small",
        );
        continue;
      }

      /*
       * Do not trust Content-Type.
       * Inspect actual bytes.
       */
      const detectedType =
        detectImageType(buffer);

      if (!detectedType) {
        console.log(
          "    Rejected: downloaded content is not a recognized image",
        );
        continue;
      }

      console.log(
        `    Detected image type: ${detectedType}`,
      );

      const tempPath = path.join(
        POSTS_DIR,
        `.post-${index + 1}-candidate.tmp`,
      );

      fs.writeFileSync(
        tempPath,
        buffer,
      );

      const validation =
        validateWithImageMagick(
          tempPath,
        );

      fs.rmSync(tempPath, {
        force: true,
      });

      if (!validation.valid) {
        console.log(
          `    Rejected: ${validation.reason}`,
        );
        continue;
      }

      if (
        validation.width &&
        validation.height
      ) {
        console.log(
          `    Dimensions: ${validation.width}x${validation.height}`,
        );
      }

      const hash =
        hashBuffer(buffer);

      if (usedHashes.has(hash)) {
        console.log(
          "    Rejected: exact duplicate image",
        );
        continue;
      }

      const fingerprint =
        getVisualFingerprint(
          buffer,
        );

      if (
        fingerprint &&
        isVisuallyDuplicate(
          fingerprint,
          usedFingerprints,
        )
      ) {
        console.log(
          "    Rejected: visually duplicate image",
        );
        continue;
      }

      const ext =
        extensionFor(
          contentType,
          detectedType,
          url,
        );

      const filename =
        `post-${index + 1}${ext}`;

      const outputPath =
        path.join(
          POSTS_DIR,
          filename,
        );

      fs.writeFileSync(
        outputPath,
        buffer,
      );

      usedHashes.add(hash);

      if (fingerprint) {
        usedFingerprints.push(
          fingerprint,
        );
      }

      console.log(
        `    SELECTED: ${filename}`,
      );

      return {
        localImage:
          `blog/images/${filename}`,
        imageUrl:
          response.url || url,
        imageHash: hash,
        bytes: buffer.length,
        width:
          validation.width || null,
        height:
          validation.height || null,
        detectedType,
      };
    } catch (error) {
      console.log(
        `    Rejected: ${error.message}`,
      );
    }
  }

  return null;
};

/* ============================================================
 * Topic analysis
 * ============================================================ */

const topicRules = [
  {
    name: "Markets & Investing",
    keywords: [
      "stock",
      "stocks",
      "investing",
      "investor",
      "market",
      "markets",
      "nasdaq",
      "s&p",
      "sp500",
      "dow",
      "futures",
      "bond",
      "bonds",
      "etf",
      "portfolio",
      "trading",
    ],
  },
  {
    name: "Economy & Macro",
    keywords: [
      "inflation",
      "cpi",
      "ppi",
      "gdp",
      "fed",
      "federal reserve",
      "interest rate",
      "rates",
      "economy",
      "economic",
      "macro",
      "employment",
      "jobs",
      "unemployment",
    ],
  },
  {
    name: "Technology",
    keywords: [
      "ai",
      "artificial intelligence",
      "technology",
      "software",
      "semiconductor",
      "chip",
      "chips",
      "cloud",
      "robotics",
      "amd",
      "nvidia",
    ],
  },
  {
    name: "Business",
    keywords: [
      "business",
      "company",
      "companies",
      "earnings",
      "revenue",
      "profit",
      "finance",
      "industry",
    ],
  },
  {
    name: "Asia Markets",
    keywords: [
      "korea",
      "korean",
      "hong kong",
      "hang seng",
      "china",
      "japan",
      "nikkei",
      "asia",
      "asian",
    ],
  },
];

/* ============================================================
 * Main
 * ============================================================ */

console.log(
  "============================================================",
);

console.log(
  `BLOG ANALYZER v${VERSION}`,
);

console.log(
  "Blogger feed-first image extraction",
);

console.log(
  "Actual <img> / srcset / anchor image extraction",
);

console.log(
  "No dependency on fragile post-container classes",
);

console.log(
  "Real-image validation after download",
);

console.log(
  "Unsplash attribution URL rejection",
);

console.log(
  "URL-extension independent image detection",
);

console.log(
  "ImageMagick 6 / 7 compatible",
);

console.log(
  "Exact + perceptual duplicate protection",
);

console.log(
  `Blog URL: ${parsedUrl.href}`,
);

console.log(
  `Output: ${OUTPUT_DIR}`,
);

console.log(
  "============================================================",
);

let feed = null;
let homepageHtml = "";

try {
  const feedUrl =
    new URL(
      "/feeds/posts/default?alt=json&max-results=10",
      parsedUrl.origin,
    ).href;

  console.log(
    `Feed URL: ${feedUrl}`,
  );

  feed =
    await fetchJson(feedUrl);

  console.log(
    "Feed fetched successfully.",
  );
} catch (error) {
  throw new Error(
    `Blogger feed fetch failed: ${error.message}`,
  );
}

try {
  homepageHtml =
    await fetchText(
      parsedUrl.href,
    );

  console.log(
    `Homepage fetched: ${homepageHtml.length} bytes`,
  );
} catch (error) {
  console.warn(
    `Homepage fetch warning: ${error.message}`,
  );
}

if (
  !feed?.feed?.entry?.length
) {
  throw new Error(
    "No Blogger feed entries found.",
  );
}

const feedInfo =
  feed.feed;

const entries =
  asArray(feedInfo.entry).slice(
    0,
    5,
  );

console.log(
  `Feed entries: ${feedInfo.entry.length}`,
);

const usedHashes = new Set();
const usedFingerprints = [];
const posts = [];

for (
  let i = 0;
  i < entries.length;
  i++
) {
  const entry =
    entries[i];

  const content =
    entry?.content?.$t || "";

  const summary =
    entry?.summary?.$t || "";

  const title =
    clean(
      entry?.title?.$t || "",
    );

  const url =
    absoluteUrl(
      getEntryLink(entry),
    );

  const published =
    clean(
      entry?.published?.$t ||
        entry?.updated?.$t ||
        "",
    );

  const categories =
    unique(
      asArray(
        entry?.category,
      ).map(
        (item) =>
          clean(
            item?.term || "",
          ),
      ),
    );

  console.log(
    "------------------------------------------------------------",
  );

  console.log(
    `Post ${i + 1}: ${title}`,
  );

  console.log(
    `URL: ${url}`,
  );

  /*
   * ----------------------------------------------------------
   * Feed-first
   * ----------------------------------------------------------
   */
  let candidates =
    feedImageCandidates(
      entry,
    );

  console.log(
    `Feed image candidates: ${candidates.length}`,
  );

  for (
    const candidate of candidates.slice(
      0,
      10,
    )
  ) {
    console.log(
      `  feed: ${candidate}`,
    );
  }

  let image = null;
  let imageSource =
    "feed-content";

  /*
   * ----------------------------------------------------------
   * Try feed candidates first.
   * ----------------------------------------------------------
   */
  if (candidates.length) {
    image =
      await downloadUniqueImage(
        candidates,
        i,
        usedHashes,
        usedFingerprints,
      );
  }

  /*
   * ----------------------------------------------------------
   * Article fallback
   *
   * IMPORTANT:
   * We no longer trust a single "exact container".
   * The previous v11 failure came from selecting a tiny
   * 2251-byte container containing zero images.
   * ----------------------------------------------------------
   */
  if (!image && url) {
    console.log(
      "Feed candidates failed. Fetching article page for fallback...",
    );

    try {
      const postHtml =
        await fetchText(url);

      console.log(
        `Article page fetched: ${postHtml.length} bytes`,
      );

      const articleCandidates =
        findArticleImageCandidates(
          postHtml,
          title,
        );

      console.log(
        `Article image candidates: ${articleCandidates.length}`,
      );

      for (
        const candidate of articleCandidates.slice(
          0,
          20,
        )
      ) {
        console.log(
          `  article: ${candidate}`,
        );
      }

      if (
        articleCandidates.length
      ) {
        imageSource =
          "post-body";

        image =
          await downloadUniqueImage(
            articleCandidates,
            i,
            usedHashes,
            usedFingerprints,
          );
      }
    } catch (error) {
      console.warn(
        `Article fallback failed: ${error.message}`,
      );
    }
  }

  /*
   * ----------------------------------------------------------
   * Last fallback:
   *
   * If feed and article candidates both failed,
   * perform a raw page extraction without structural
   * assumptions.
   * ----------------------------------------------------------
   */
  if (!image && url) {
    console.log(
      "Structured article extraction failed. Running raw HTML image scan...",
    );

    try {
      const postHtml =
        await fetchText(url);

      const rawCandidates =
        extractImageUrlsFromHtml(
          postHtml,
          {
            allowAnchors: true,
            includeRawUrls: true,
          },
        );

      console.log(
        `Raw HTML image candidates: ${rawCandidates.length}`,
      );

      imageSource =
        "post-raw";

      image =
        await downloadUniqueImage(
          rawCandidates,
          i,
          usedHashes,
          usedFingerprints,
        );
    } catch (error) {
      console.warn(
        `Raw HTML fallback failed: ${error.message}`,
      );
    }
  }

  if (!image) {
    throw new Error(
      `All image candidates were rejected for Post ${i + 1}: ${title}`,
    );
  }

  const date =
    published
      ? new Date(
          published,
        ).toLocaleDateString(
          "en-US",
          {
            year: "numeric",
            month: "long",
            day: "2-digit",
            timeZone: "UTC",
          },
        )
      : "";

  posts.push({
    index: i,
    title,
    url,
    published,
    date,
    excerpt:
      stripHtml(
        content || summary,
      ).slice(0, 300),
    categories,
    localImage:
      image.localImage,
    imageUrl:
      image.imageUrl,
    imageSource,
    imageHash:
      image.imageHash,
    imageBytes:
      image.bytes,
    imageWidth:
      image.width,
    imageHeight:
      image.height,
    imageType:
      image.detectedType,
  });

  console.log(
    `Selected image: ${image.localImage}`,
  );

  console.log(
    `Image source: ${imageSource}`,
  );

  console.log(
    `Image size: ${image.bytes} bytes`,
  );
}

/* ============================================================
 * Blog analysis
 * ============================================================ */

const combinedText =
  clean(
    [
      feedInfo.title?.$t,
      feedInfo.subtitle?.$t,
      ...posts.flatMap(
        (post) => [
          post.title,
          post.excerpt,
        ],
      ),
    ].join(" "),
  );

const lowerText =
  combinedText.toLowerCase();

const topicScores =
  topicRules
    .map(
      (rule) => ({
        name: rule.name,
        score:
          rule.keywords.reduce(
            (
              score,
              keyword,
            ) =>
              score +
              (lowerText.includes(
                keyword,
              )
                ? 1
                : 0),
            0,
          ),
      }),
    )
    .sort(
      (a, b) =>
        b.score - a.score,
    );

const topics =
  topicScores
    .filter(
      (item) =>
        item.score > 0,
    )
    .slice(0, 3)
    .map(
      (item) =>
        item.name,
    );

if (!topics.length) {
  topics.push(
    "General Insights",
  );
}

const hasMarketTerms =
  /stock|market|nasdaq|s&p|futures|hang seng|nikkei|trading/i.test(
    combinedText,
  );

const hasQuestionTitles =
  posts.some(
    (post) =>
      /^(what|why|how|when|where|can|should|will|is|are)\b/i.test(
        post.title,
      ),
  );

const audience =
  hasMarketTerms
    ? "Investors and market-focused readers"
    : "Readers looking for practical insights and analysis";

const contentStyle =
  hasQuestionTitles ||
  /guide|how to|what is|explained/i.test(
    combinedText,
  )
    ? "Educational and explanatory"
    : "News, analysis and commentary";

const valueProposition =
  hasMarketTerms
    ? "Clear market context, timely analysis and practical insights for investors."
    : "Curated ideas and useful insights presented in an easy-to-follow format.";

const identity =
  clean(
    feedInfo.subtitle?.$t ||
      "",
  ) ||
  valueProposition;

const siteTitle =
  clean(
    feedInfo.title?.$t ||
      "",
  ) ||
  parsedUrl.hostname;

/*
 * Homepage OG image is metadata only.
 * It is NOT used as a post image.
 */
const homepageMetaCandidates =
  extractImageUrlsFromHtml(
    homepageHtml,
    {
      allowAnchors: false,
      includeRawUrls: false,
    },
  );

const ogImage =
  homepageMetaCandidates[0] ||
  "";

const realImageCount =
  posts.filter(
    (post) =>
      post.localImage,
  ).length;

const uniqueImageCount =
  new Set(
    posts
      .map(
        (post) =>
          post.imageHash,
      )
      .filter(Boolean),
  ).size;

if (
  realImageCount !== 5 ||
  uniqueImageCount !== 5
) {
  throw new Error(
    `Image validation failed: realImages=${realImageCount}, uniqueImages=${uniqueImageCount}, required=5`,
  );
}

/* ============================================================
 * blog.json
 * ============================================================ */

const result = {
  version: 8,

  capturedAt:
    new Date().toISOString(),

  url:
    parsedUrl.href,

  hostname:
    parsedUrl.hostname,

  siteTitle,

  description:
    clean(
      feedInfo.subtitle?.$t ||
        "",
    ),

  pageHeading:
    siteTitle,

  ogImage,

  language:
    "en",

  postCount:
    posts.length,

  analysis: {
    identity,
    topics,
    audience,
    contentStyle,
    valueProposition,
  },

  posts,

  imageStats: {
    realImages:
      realImageCount,

    uniqueImages:
      uniqueImageCount,

    requiredImages:
      5,
  },
};

const outputJson =
  path.join(
    OUTPUT_DIR,
    "blog.json",
  );

fs.writeFileSync(
  outputJson,
  JSON.stringify(
    result,
    null,
    2,
  ),
  "utf8",
);

console.log(
  "============================================================",
);

console.log(
  "BLOG ANALYZER COMPLETED",
);

console.log(
  `Version: ${VERSION}`,
);

console.log(
  `Posts: ${posts.length}`,
);

console.log(
  `Real images: ${realImageCount}`,
);

console.log(
  `Unique images: ${uniqueImageCount}`,
);

console.log(
  `blog.json: ${outputJson}`,
);

console.log(
  "============================================================",
);
