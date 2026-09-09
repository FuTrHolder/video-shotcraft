import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// ============================================================
// BLOG ANALYZER v10.5
//
// Main goals:
//
// 1. Do NOT require the blog homepage before reading the feed.
// 2. Handle Blogger HTTP 429 with retries + exponential backoff.
// 3. Use Blogger JSON Feed as the primary source.
// 4. Extract images from the exact post only.
// 5. Never mix images from other posts.
// 6. Never scrape arbitrary Blogger CDN strings.
// 7. Reject incomplete Blogger resize-only URLs.
// 8. Validate downloaded files with Content-Type + ImageMagick.
// 9. Prevent exact and perceptual duplicate images.
// 10. Never borrow another post's image.
// 11. Keep blog.json compatible with Remotion BlogPromo.
//
// ============================================================

const VERSION = "10.5";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BLOG_URL = process.argv[2];

if (!BLOG_URL) {
  console.error(
    "Usage: node scripts/capture-blog.mjs <BLOG_URL>"
  );
  process.exit(1);
}

// ============================================================
// Paths
// ============================================================

const OUTPUT_DIR = path.resolve(
  __dirname,
  "../template/public/blog"
);

const IMAGE_DIR = path.join(
  OUTPUT_DIR,
  "images"
);

fs.rmSync(OUTPUT_DIR, {
  recursive: true,
  force: true
});

fs.mkdirSync(IMAGE_DIR, {
  recursive: true
});

// ============================================================
// Runtime configuration
// ============================================================

const MAX_POSTS = 5;

const FETCH_RETRIES = 5;

const INITIAL_RETRY_DELAY = 1500;

const REQUEST_TIMEOUT = 30000;

const IMAGE_TIMEOUT = 30000;

const MIN_IMAGE_BYTES = 5000;

const MIN_IMAGE_WIDTH = 320;

const MIN_IMAGE_HEIGHT = 180;

const MAX_IMAGE_WIDTH = 6000;

const MAX_IMAGE_HEIGHT = 6000;

// ============================================================
// ImageMagick detection
// ============================================================

function commandExists(command) {
  try {
    execFileSync(
      "bash",
      [
        "-lc",
        `command -v ${command}`
      ],
      {
        stdio: "ignore"
      }
    );

    return true;
  } catch {
    return false;
  }
}

const HAS_IDENTIFY = commandExists("identify");

const HAS_MAGICK = commandExists("magick");

const HAS_CONVERT = commandExists("convert");

if (!HAS_IDENTIFY && !HAS_MAGICK) {
  console.error(
    "ERROR: ImageMagick identify/magick was not found."
  );
  process.exit(1);
}

const IDENTIFY_COMMAND = HAS_IDENTIFY
  ? "identify"
  : "magick";

const CONVERT_COMMAND = HAS_CONVERT
  ? "convert"
  : "magick";

console.log(
  `ImageMagick identify command: ${IDENTIFY_COMMAND}`
);

console.log(
  `ImageMagick convert command: ${CONVERT_COMMAND}`
);

try {
  const version = execFileSync(
    IDENTIFY_COMMAND,
    [
      "-version"
    ],
    {
      encoding: "utf8"
    }
  );

  console.log(
    version.split("\n")[0]
  );
} catch {
  // Ignore version failure.
}

// ============================================================
// General helpers
// ============================================================

function sleep(ms) {
  return new Promise(
    resolve => setTimeout(resolve, ms)
  );
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function htmlDecode(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(
      /&#(\d+);/g,
      (_, value) => {
        try {
          return String.fromCodePoint(
            Number(value)
          );
        } catch {
          return _;
        }
      }
    )
    .replace(
      /&#x([0-9a-f]+);/gi,
      (_, value) => {
        try {
          return String.fromCodePoint(
            parseInt(value, 16)
          );
        } catch {
          return _;
        }
      }
    );
}

function stripHtml(html) {
  return htmlDecode(
    String(html || "")
      .replace(
        /<script[\s\S]*?<\/script>/gi,
        " "
      )
      .replace(
        /<style[\s\S]*?<\/style>/gi,
        " "
      )
      .replace(
        /<noscript[\s\S]*?<\/noscript>/gi,
        " "
      )
      .replace(
        /<[^>]+>/g,
        " "
      )
  )
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(rawUrl, baseUrl) {
  if (!rawUrl) {
    return "";
  }

  let value = htmlDecode(
    String(rawUrl)
      .trim()
      .replace(
        /^['"]|['"]$/g,
        ""
      )
  );

  if (!value) {
    return "";
  }

  if (
    /^(javascript|data|blob):/i.test(value)
  ) {
    return "";
  }

  if (value.startsWith("//")) {
    value = `https:${value}`;
  }

  try {
    const url = new URL(
      value,
      baseUrl
    );

    if (
      ![
        "http:",
        "https:"
      ].includes(url.protocol)
    ) {
      return "";
    }

    return url.href;
  } catch {
    return "";
  }
}

function samePageUrl(candidateUrl, pageUrl) {
  if (!candidateUrl || !pageUrl) {
    return false;
  }

  try {
    const candidate = new URL(candidateUrl);
    const page = new URL(pageUrl);

    return (
      candidate.origin === page.origin &&
      candidate.pathname === page.pathname
    );
  } catch {
    return false;
  }
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    if (!value) {
      continue;
    }

    const key = String(value).trim();

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(key);
  }

  return result;
}

// ============================================================
// HTTP request helpers
// ============================================================

function buildHeaders(url, {
  accept = "*/*",
  referer = ""
} = {}) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (X11; Linux x86_64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/131.0.0.0 Safari/537.36",

    "Accept": accept,

    "Accept-Language":
      "en-US,en;q=0.9,ko;q=0.8",

    "Cache-Control":
      "no-cache",

    "Pragma":
      "no-cache"
  };

  if (referer) {
    headers.Referer = referer;
  }

  try {
    const parsed = new URL(url);

    if (
      parsed.hostname.includes(
        "blogspot.com"
      )
    ) {
      headers["Sec-Fetch-Dest"] = "document";
      headers["Sec-Fetch-Mode"] = "navigate";
      headers["Sec-Fetch-Site"] = "same-origin";
    }
  } catch {
    // Ignore.
  }

  return headers;
}

async function fetchWithRetry(
  url,
  {
    accept = "*/*",
    referer = "",
    timeout = REQUEST_TIMEOUT,
    retries = FETCH_RETRIES,
    label = "HTTP request"
  } = {}
) {
  let lastError = null;

  for (
    let attempt = 1;
    attempt <= retries;
    attempt++
  ) {
    let response = null;

    try {
      const controller =
        new AbortController();

      const timer = setTimeout(
        () => controller.abort(),
        timeout
      );

      response = await fetch(
        url,
        {
          method: "GET",
          headers: buildHeaders(
            url,
            {
              accept,
              referer
            }
          ),
          redirect: "follow",
          signal: controller.signal
        }
      );

      clearTimeout(timer);

      if (response.ok) {
        return response;
      }

      const status =
        response.status;

      const retryable =
        status === 429 ||
        status === 408 ||
        status === 425 ||
        status >= 500;

      if (!retryable) {
        throw new Error(
          `${label}: HTTP ${status} ${response.statusText}`
        );
      }

      const retryAfter =
        response.headers.get(
          "retry-after"
        );

      let delay =
        INITIAL_RETRY_DELAY *
        Math.pow(
          2,
          attempt - 1
        );

      if (retryAfter) {
        const seconds =
          Number(retryAfter);

        if (
          Number.isFinite(seconds) &&
          seconds >= 0
        ) {
          delay =
            Math.max(
              delay,
              seconds * 1000
            );
        }
      }

      // Small deterministic jitter.
      delay +=
        Math.floor(
          Math.random() * 500
        );

      console.warn(
        `${label}: HTTP ${status}. ` +
        `Retry ${attempt}/${retries} ` +
        `after ${delay}ms`
      );

      if (
        attempt < retries
      ) {
        await sleep(delay);
        continue;
      }

      throw new Error(
        `${label}: HTTP ${status} ${response.statusText}`
      );
    } catch (error) {
      lastError = error;

      const message =
        error?.name === "AbortError"
          ? "request timeout"
          : error?.message ||
            String(error);

      if (
        attempt >= retries
      ) {
        throw new Error(
          `${label}: ${message}`
        );
      }

      const delay =
        INITIAL_RETRY_DELAY *
          Math.pow(
            2,
            attempt - 1
          ) +
        Math.floor(
          Math.random() * 500
        );

      console.warn(
        `${label}: ${message}. ` +
        `Retry ${attempt}/${retries} ` +
        `after ${delay}ms`
      );

      await sleep(delay);
    }
  }

  throw (
    lastError ||
    new Error(`${label}: request failed`)
  );
}

// ============================================================
// Blogger image URL normalization
// ============================================================

function isResizeOnlyPath(pathname) {
  if (!pathname) {
    return true;
  }

  return /\/(?:w\d+|h\d+|s\d+(?:-c)?|w\d+-h\d+(?:-[^/]*)?)\/?$/i.test(
    pathname
  );
}

function normalizeBloggerImageUrl(
  rawUrl,
  baseUrl = BLOG_URL
) {
  const absolute =
    absoluteUrl(
      rawUrl,
      baseUrl
    );

  if (!absolute) {
    return "";
  }

  let url;

  try {
    url = new URL(absolute);
  } catch {
    return "";
  }

  const host =
    url.hostname.toLowerCase();

  const isBloggerHost =
    host.includes(
      "blogger.googleusercontent.com"
    ) ||
    host === "bp.blogspot.com" ||
    host.endsWith(".bp.blogspot.com");

  if (!isBloggerHost) {
    return url.href;
  }

  let pathname =
    url.pathname;

  // Reject:
  //
  // /w1200/
  // /s1600/
  // /s72-c/
  // /w144-h144-p-k-no-nu/
  //
  // These are incomplete image URLs.
  if (
    isResizeOnlyPath(pathname)
  ) {
    return "";
  }

  // Convert:
  //
  // /s72-c/file.jpg
  // /s1600/file.jpg
  // /w1200/file.jpg
  // /w1200-h800/file.jpg
  //
  // into:
  //
  // /s1600/file.jpg

  pathname =
    pathname.replace(
      /\/s\d+(?:-c)?\/([^/]+)$/i,
      "/s1600/$1"
    );

  pathname =
    pathname.replace(
      /\/w\d+-h\d+(?:-[^/]*)?\/([^/]+)$/i,
      "/s1600/$1"
    );

  pathname =
    pathname.replace(
      /\/w\d+\/([^/]+)$/i,
      "/s1600/$1"
    );

  pathname =
    pathname.replace(
      /\/h\d+\/([^/]+)$/i,
      "/s1600/$1"
    );

  url.pathname =
    pathname;

  for (
    const parameter
    of [
      "w",
      "h",
      "s",
      "resize"
    ]
  ) {
    url.searchParams.delete(
      parameter
    );
  }

  return url.href;
}

// ============================================================
// URL validation
// ============================================================

function isObviouslyBadImageUrl(
  url,
  pageUrl = ""
) {
  if (!url) {
    return true;
  }

  const value =
    String(url).trim();

  const lower =
    value.toLowerCase();

  if (
    /^data:/i.test(value) ||
    /^javascript:/i.test(value) ||
    /^blob:/i.test(value)
  ) {
    return true;
  }

  if (
    pageUrl &&
    samePageUrl(
      value,
      pageUrl
    )
  ) {
    return true;
  }

  if (
    /\.html?(?:[?#]|$)/i.test(
      lower
    )
  ) {
    return true;
  }

  if (
    /\.(json|xml)(?:[?#]|$)/i.test(
      lower
    )
  ) {
    return true;
  }

  if (
    isResizeOnlyPath(
      (() => {
        try {
          return new URL(value).pathname;
        } catch {
          return "";
        }
      })()
    )
  ) {
    return true;
  }

  const badPatterns = [
    "favicon",
    "sprite",
    "emoji",
    "avatar",
    "profile-picture",
    "profile_image",
    "profile-image",
    "default-avatar",
    "author-avatar",
    "blogger-logo",
    "tracking",
    "pixel.gif",
    "tracking.gif",
    "transparent.gif",
    "spacer.gif",
    "blank.gif",
    "1x1"
  ];

  return badPatterns.some(
    pattern =>
      lower.includes(pattern)
  );
}

function isLikelyImageUrl(url) {
  if (!url) {
    return false;
  }

  const lower =
    String(url).toLowerCase();

  if (
    lower.includes(
      "blogger.googleusercontent.com/img/"
    )
  ) {
    return true;
  }

  if (
    lower.includes(
      "bp.blogspot.com/"
    )
  ) {
    return true;
  }

  return /\.(jpg|jpeg|png|webp|gif|avif)(?:[?#]|$)/i.test(
    lower
  );
}

// ============================================================
// Candidate creation
// ============================================================

function makeCandidate(
  rawUrl,
  {
    baseUrl,
    source,
    score = 0,
    context = "",
    alt = "",
    title = ""
  }
) {
  const normalized =
    normalizeBloggerImageUrl(
      rawUrl,
      baseUrl
    );

  if (!normalized) {
    return null;
  }

  if (
    isObviouslyBadImageUrl(
      normalized,
      baseUrl
    )
  ) {
    return null;
  }

  if (
    !isLikelyImageUrl(
      normalized
    )
  ) {
    return null;
  }

  return {
    url: normalized,
    source,
    score,
    context: String(
      context || ""
    ),
    alt: String(
      alt || ""
    ),
    title: String(
      title || ""
    )
  };
}

function mergeCandidates(
  candidates
) {
  const map = new Map();

  for (
    const candidate
    of candidates
  ) {
    if (!candidate?.url) {
      continue;
    }

    const existing =
      map.get(candidate.url);

    if (
      !existing ||
      candidate.score >
        existing.score
    ) {
      map.set(
        candidate.url,
        candidate
      );
    }
  }

  return Array.from(
    map.values()
  ).sort(
    (a, b) =>
      b.score - a.score
  );
}

// ============================================================
// HTML attribute helpers
// ============================================================

function getAttribute(
  tag,
  name
) {
  const quoted =
    tag.match(
      new RegExp(
        `\\b${name}\\s*=\\s*["']([^"']+)["']`,
        "i"
      )
    );

  if (quoted?.[1]) {
    return htmlDecode(
      quoted[1]
    );
  }

  const unquoted =
    tag.match(
      new RegExp(
        `\\b${name}\\s*=\\s*([^\\s>]+)`,
        "i"
      )
    );

  return htmlDecode(
    unquoted?.[1] || ""
  );
}

// ============================================================
// srcset
// ============================================================

function extractSrcsetUrls(
  srcset,
  baseUrl
) {
  if (!srcset) {
    return [];
  }

  const results = [];

  for (
    const item
    of String(srcset).split(",")
  ) {
    const value =
      item.trim();

    if (!value) {
      continue;
    }

    const parts =
      value.split(/\s+/);

    const rawUrl =
      parts[0];

    const url =
      absoluteUrl(
        rawUrl,
        baseUrl
      );

    if (url) {
      results.push(url);
    }
  }

  return results;
}

// ============================================================
// Extract image URLs ONLY from real HTML attributes.
//
// IMPORTANT:
// We intentionally do NOT use a global regex such as:
//
// https://*.blogspot.com/...
//
// because that was causing unrelated / malformed URLs to
// become candidates.
// ============================================================

function extractImagesFromHtml(
  html,
  baseUrl,
  {
    source = "html",
    score = 0,
    pageUrl = baseUrl
  } = {}
) {
  const candidates = [];

  const imageTagRegex =
    /<img\b[^>]*>/gi;

  let match;

  while (
    (match =
      imageTagRegex.exec(html))
  ) {
    const tag =
      match[0];

    const alt =
      getAttribute(
        tag,
        "alt"
      );

    const title =
      getAttribute(
        tag,
        "title"
      );

    const className =
      getAttribute(
        tag,
        "class"
      );

    const id =
      getAttribute(
        tag,
        "id"
      );

    const context =
      [
        alt,
        title,
        className,
        id
      ]
        .filter(Boolean)
        .join(" ");

    const attributes = [
      "src",
      "data-src",
      "data-original",
      "data-lazy-src",
      "data-lazy",
      "data-image",
      "data-image-url",
      "data-url",
      "data-fallback-src"
    ];

    for (
      const attribute
      of attributes
    ) {
      const raw =
        getAttribute(
          tag,
          attribute
        );

      if (!raw) {
        continue;
      }

      const candidate =
        makeCandidate(
          raw,
          {
            baseUrl,
            source,
            score:
              score +
              (
                attribute ===
                "src"
                  ? 10
                  : 5
              ),
            context,
            alt,
            title
          }
        );

      if (candidate) {
        candidates.push(
          candidate
        );
      }
    }

    for (
      const attribute
      of [
        "srcset",
        "data-srcset"
      ]
    ) {
      const raw =
        getAttribute(
          tag,
          attribute
        );

      if (!raw) {
        continue;
      }

      for (
        const imageUrl
        of extractSrcsetUrls(
          raw,
          baseUrl
        )
      ) {
        const candidate =
          makeCandidate(
            imageUrl,
            {
              baseUrl,
              source,
              score:
                score + 7,
              context,
              alt,
              title
            }
          );

        if (candidate) {
          candidates.push(
            candidate
          );
        }
      }
    }
  }

  // <source srcset="...">
  const sourceRegex =
    /<source\b[^>]*>/gi;

  while (
    (match =
      sourceRegex.exec(html))
  ) {
    const tag =
      match[0];

    const srcset =
      getAttribute(
        tag,
        "srcset"
      );

    if (!srcset) {
      continue;
    }

    for (
      const imageUrl
      of extractSrcsetUrls(
        srcset,
        baseUrl
      )
    ) {
      const candidate =
        makeCandidate(
          imageUrl,
          {
            baseUrl,
            source,
            score:
              score + 4
          }
        );

      if (candidate) {
        candidates.push(
          candidate
        );
      }
    }
  }

  // CSS background-image.
  const backgroundRegex =
    /background-image\s*:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;

  while (
    (match =
      backgroundRegex.exec(html))
  ) {
    const candidate =
      makeCandidate(
        match[1],
        {
          baseUrl,
          source:
            `${source}-background`,
          score:
            score - 10
        }
      );

    if (candidate) {
      candidates.push(
        candidate
      );
    }
  }

  // Image metadata.
  const metaRegex =
    /<meta\b[^>]*>/gi;

  while (
    (match =
      metaRegex.exec(html))
  ) {
    const tag =
      match[0];

    const property =
      getAttribute(
        tag,
        "property"
      );

    const name =
      getAttribute(
        tag,
        "name"
      );

    if (
      ![
        "og:image",
        "og:image:url",
        "twitter:image",
        "twitter:image:src",
        "image_src"
      ].includes(
        String(
          property || name
        ).toLowerCase()
      )
    ) {
      continue;
    }

    const raw =
      getAttribute(
        tag,
        "content"
      );

    const candidate =
      makeCandidate(
        raw,
        {
          baseUrl,
          source:
            `${source}-meta`,
          score:
            score + 15
        }
      );

    if (candidate) {
      candidates.push(
        candidate
      );
    }
  }

  return mergeCandidates(
    candidates
  );
}

// ============================================================
// Post title matching
// ============================================================

function titleSimilarity(
  target,
  candidate
) {
  const a =
    normalizeText(target);

  const b =
    normalizeText(candidate);

  if (!a || !b) {
    return 0;
  }

  if (a === b) {
    return 100;
  }

  if (
    b.includes(a) ||
    a.includes(b)
  ) {
    return 80;
  }

  const aWords =
    new Set(
      a
        .split(/\s+/)
        .filter(
          word =>
            word.length > 2
        )
    );

  const bWords =
    new Set(
      b
        .split(/\s+/)
        .filter(
          word =>
            word.length > 2
        )
    );

  if (
    !aWords.size ||
    !bWords.size
  ) {
    return 0;
  }

  let common = 0;

  for (
    const word
    of aWords
  ) {
    if (
      bWords.has(word)
    ) {
      common++;
    }
  }

  return Math.round(
    (common /
      Math.max(
        aWords.size,
        bWords.size
      )) *
      100
  );
}

// ============================================================
// Exact post container extraction
//
// The important difference from v10.4:
//
// v10.4 collected ALL .post-body / article containers.
//
// v10.5 first tries to locate the container whose text/title
// belongs to the requested post.
// ============================================================

function findExactPostScopes(
  html,
  post
) {
  const scopes = [];

  const title =
    normalizeText(
      post.title
    );

  const postUrl =
    post.url || "";

  // ----------------------------------------------------------
  // 1. <article> blocks
  // ----------------------------------------------------------

  const articleRegex =
    /<article\b[^>]*>[\s\S]*?<\/article>/gi;

  let match;

  while (
    (match =
      articleRegex.exec(html))
  ) {
    const block =
      match[0];

    const text =
      normalizeText(
        stripHtml(block)
      );

    const score =
      titleSimilarity(
        title,
        text
      );

    if (score >= 35) {
      scopes.push({
        html: block,
        score:
          100 + score,
        source:
          "post-article-title"
      });
    }
  }

  // ----------------------------------------------------------
  // 2. Known Blogger post containers
  // ----------------------------------------------------------

  const classPatterns = [
    "post-body",
    "entry-content",
    "post-content",
    "hentry",
    "blog-post"
  ];

  for (
    const className
    of classPatterns
  ) {
    const regex =
      new RegExp(
        `<[^>]+class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>[\\s\\S]*?<\\/[^>]+>`,
        "gi"
      );

    while (
      (match =
        regex.exec(html))
    ) {
      const block =
        match[0];

      const text =
        normalizeText(
          stripHtml(block)
        );

      const score =
        titleSimilarity(
          title,
          text
        );

      if (score >= 35) {
        scopes.push({
          html: block,
          score:
            80 + score,
          source:
            `post-${className}`
        });
      }
    }
  }

  // ----------------------------------------------------------
  // 3. Exact URL occurrence.
  //
  // This helps when Blogger's DOM does not expose the post
  // title in a conventional container.
  // ----------------------------------------------------------

  if (postUrl) {
    const normalizedPostUrl =
      normalizeText(
        postUrl
      );

    const index =
      html.indexOf(
        postUrl
      );

    if (index >= 0) {
      const start =
        Math.max(
          0,
          index - 15000
        );

      const end =
        Math.min(
          html.length,
          index + 15000
        );

      const nearby =
        html.slice(
          start,
          end
        );

      const nearbyCandidates =
        extractImagesFromHtml(
          nearby,
          postUrl,
          {
            source:
              "post-url-nearby",
            score: 30,
            pageUrl:
              postUrl
          }
        );

      if (
        nearbyCandidates.length
      ) {
        scopes.push({
          html: nearby,
          score: 70,
          source:
            "post-url-nearby"
        });
      }

      void normalizedPostUrl;
    }
  }

  scopes.sort(
    (a, b) =>
      b.score - a.score
  );

  return scopes;
}

// ============================================================
// Feed image extraction
// ============================================================

function getFeedContent(
  entry
) {
  const values = [];

  const content =
    entry?.content?.$t;

  const summary =
    entry?.summary?.$t;

  if (content) {
    values.push(content);
  }

  if (summary) {
    values.push(summary);
  }

  return values;
}

function getFeedMediaUrls(
  entry
) {
  const urls = [];

  const thumbnail =
    entry?.media$thumbnail?.url;

  if (thumbnail) {
    urls.push(thumbnail);
  }

  const mediaGroup =
    entry?.media$group;

  if (
    mediaGroup?.["media$content"]
  ) {
    for (
      const item
      of mediaGroup[
        "media$content"
      ]
    ) {
      if (item?.url) {
        urls.push(item.url);
      }
    }
  }

  if (
    Array.isArray(
      entry?.["media$content"]
    )
  ) {
    for (
      const item
      of entry[
        "media$content"
      ]
    ) {
      if (item?.url) {
        urls.push(item.url);
      }
    }
  }

  return uniqueStrings(
    urls
  );
}

function extractFeedImageCandidates(
  entry,
  postUrl
) {
  const candidates = [];

  // ----------------------------------------------------------
  // Feed media
  // ----------------------------------------------------------

  for (
    const url
    of getFeedMediaUrls(
      entry
    )
  ) {
    const candidate =
      makeCandidate(
        url,
        {
          baseUrl:
            postUrl,
          source:
            "feed-media",
          score: 100
        }
      );

    if (candidate) {
      candidates.push(
        candidate
      );
    }
  }

  // ----------------------------------------------------------
  // Feed content
  // ----------------------------------------------------------

  for (
    const content
    of getFeedContent(
      entry
    )
  ) {
    const contentCandidates =
      extractImagesFromHtml(
        content,
        postUrl,
        {
          source:
            "feed-content",
          score: 95,
          pageUrl:
            postUrl
        }
      );

    candidates.push(
      ...contentCandidates
    );
  }

  return mergeCandidates(
    candidates
  );
}

// ============================================================
// Extract candidates from the exact post page
// ============================================================

function extractPostPageCandidates(
  html,
  post
) {
  const candidates = [];

  const scopes =
    findExactPostScopes(
      html,
      post
    );

  console.log(
    `Scoped post containers: ${scopes.length}`
  );

  // Only the best matching scope(s).
  //
  // Do NOT collect every .post-body from the page.
  const bestScopes =
    scopes
      .slice(
        0,
        2
      );

  for (
    const scope
    of bestScopes
  ) {
    const extracted =
      extractImagesFromHtml(
        scope.html,
        post.url,
        {
          source:
            scope.source,
          score:
            scope.score,
          pageUrl:
            post.url
        }
      );

    candidates.push(
      ...extracted
    );
  }

  // ----------------------------------------------------------
  // Post-level metadata is safe because it belongs to this
  // exact fetched post URL.
  // ----------------------------------------------------------

  const metaCandidates =
    extractImagesFromHtml(
      html,
      post.url,
      {
        source:
          "post-meta",
        score: 60,
        pageUrl:
          post.url
      }
    ).filter(
      candidate =>
        candidate.source
          .includes("meta")
    );

  candidates.push(
    ...metaCandidates
  );

  return mergeCandidates(
    candidates
  );
}

// ============================================================
// Download image
// ============================================================

async function downloadImage(
  url,
  destination,
  referer
) {
  console.log(
    `Downloading image: ${url}`
  );

  const response =
    await fetchWithRetry(
      url,
      {
        accept:
          "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        referer,
        timeout:
          IMAGE_TIMEOUT,
        retries: 3,
        label:
          "Image download"
      }
    );

  const contentType =
    (
      response.headers.get(
        "content-type"
      ) || ""
    ).toLowerCase();

  console.log(
    `Content-Type: ${contentType || "unknown"}`
  );

  if (
    contentType.includes(
      "text/html"
    ) ||
    contentType.includes(
      "application/json"
    ) ||
    contentType.includes(
      "application/xml"
    ) ||
    contentType.includes(
      "text/xml"
    )
  ) {
    throw new Error(
      `Downloaded response is not an image: ${contentType}`
    );
  }

  const buffer =
    Buffer.from(
      await response.arrayBuffer()
    );

  console.log(
    `Downloaded: ${buffer.length} bytes`
  );

  if (
    buffer.length <
    MIN_IMAGE_BYTES
  ) {
    throw new Error(
      `Image is too small: ${buffer.length} bytes`
    );
  }

  fs.writeFileSync(
    destination,
    buffer
  );

  return {
    bytes:
      buffer.length,
    contentType
  };
}

// ============================================================
// ImageMagick inspection
// ============================================================

function identifyImage(
  filePath
) {
  try {
    const output =
      execFileSync(
        IDENTIFY_COMMAND,
        [
          "-format",
          "%m|%w|%h",
          filePath
        ],
        {
          encoding: "utf8",
          stdio: [
            "ignore",
            "pipe",
            "pipe"
          ]
        }
      )
        .trim();

    const [
      format,
      widthText,
      heightText
    ] =
      output.split("|");

    const width =
      Number(widthText);

    const height =
      Number(heightText);

    if (
      !format ||
      !Number.isFinite(width) ||
      !Number.isFinite(height)
    ) {
      throw new Error(
        "ImageMagick returned invalid image information"
      );
    }

    return {
      format,
      width,
      height
    };
  } catch {
    throw new Error(
      "ImageMagick could not identify image"
    );
  }
}

function convertToJpeg(
  sourcePath,
  destinationPath
) {
  execFileSync(
    CONVERT_COMMAND,
    [
      sourcePath,
      "-auto-orient",
      "-strip",
      "-quality",
      "88",
      destinationPath
    ],
    {
      stdio: "pipe"
    }
  );
}

function validateImageFile(
  filePath
) {
  const stat =
    fs.statSync(
      filePath
    );

  if (
    stat.size <
    MIN_IMAGE_BYTES
  ) {
    throw new Error(
      `Image file is too small: ${stat.size} bytes`
    );
  }

  const info =
    identifyImage(
      filePath
    );

  console.log(
    `ImageMagick: ${info.format}|${info.width}|${info.height}`
  );

  if (
    info.width <
    MIN_IMAGE_WIDTH ||
    info.height <
    MIN_IMAGE_HEIGHT
  ) {
    throw new Error(
      `Image dimensions too small: ${info.width}x${info.height}`
    );
  }

  if (
    info.width >
    MAX_IMAGE_WIDTH ||
    info.height >
    MAX_IMAGE_HEIGHT
  ) {
    throw new Error(
      `Image dimensions too large: ${info.width}x${info.height}`
    );
  }

  return {
    ...info,
    bytes:
      stat.size
  };
}

// ============================================================
// SHA-256
// ============================================================

function sha256File(
  filePath
) {
  const hash =
    crypto.createHash(
      "sha256"
    );

  hash.update(
    fs.readFileSync(
      filePath
    )
  );

  return hash.digest(
    "hex"
  );
}

// ============================================================
// Perceptual fingerprint
//
// ImageMagick converts the image into a small grayscale PNG.
// The resulting pixels are hashed.
//
// This catches visually identical images saved with different
// file encodings or dimensions better than SHA-256 alone.
// ============================================================

function visualFingerprint(
  filePath
) {
  const tempPath =
    `${filePath}.fingerprint.png`;

  try {
    execFileSync(
      CONVERT_COMMAND,
      [
        filePath,
        "-auto-orient",
        "-resize",
        "32x32!",
        "-colorspace",
        "Gray",
        "-depth",
        "8",
        "PNG24:" + tempPath
      ],
      {
        stdio: "pipe"
      }
    );

    return sha256File(
      tempPath
    );
  } finally {
    try {
      fs.rmSync(
        tempPath,
        {
          force: true
        }
      );
    } catch {
      // Ignore.
    }
  }
}

// ============================================================
// Candidate download + validation
// ============================================================

async function tryCandidate(
  candidate,
  index,
  post
) {
  const temporaryPath =
    path.join(
      IMAGE_DIR,
      `.candidate-${index}.bin`
    );

  const convertedPath =
    path.join(
      IMAGE_DIR,
      `.candidate-${index}.jpg`
    );

  try {
    await downloadImage(
      candidate.url,
      temporaryPath,
      post.url
    );

    const originalInfo =
      validateImageFile(
        temporaryPath
      );

    convertToJpeg(
      temporaryPath,
      convertedPath
    );

    const finalInfo =
      validateImageFile(
        convertedPath
      );

    const hash =
      sha256File(
        convertedPath
      );

    const fingerprint =
      visualFingerprint(
        convertedPath
      );

    return {
      temporaryPath,
      convertedPath,
      originalInfo,
      finalInfo,
      hash,
      fingerprint
    };
  } catch (error) {
    try {
      fs.rmSync(
        temporaryPath,
        {
          force: true
        }
      );
    } catch {
      // Ignore.
    }

    try {
      fs.rmSync(
        convertedPath,
        {
          force: true
        }
      );
    } catch {
      // Ignore.
    }

    console.warn(
      `Rejected: ${error.message}`
    );

    return null;
  }
}

// ============================================================
// Feed URL
// ============================================================

function buildFeedUrl(
  blogUrl
) {
  const url =
    new URL(
      blogUrl
    );

  url.pathname =
    "/feeds/posts/default";

  url.search = "";

  url.searchParams.set(
    "alt",
    "json"
  );

  url.searchParams.set(
    "max-results",
    "10"
  );

  return url.href;
}

// ============================================================
// Parse Blogger feed
// ============================================================

function parseFeed(
  json
) {
  if (
    !json ||
    typeof json !== "object"
  ) {
    throw new Error(
      "Invalid Blogger feed JSON"
    );
  }

  const feed =
    json.feed;

  if (!feed) {
    throw new Error(
      "Blogger feed does not contain feed object"
    );
  }

  const entries =
    Array.isArray(
      feed.entry
    )
      ? feed.entry
      : [];

  return {
    feed,
    entries
  };
}

function getEntryText(
  entry,
  key
) {
  return (
    entry?.[key]?.$t ||
    ""
  );
}

function getEntryUrl(
  entry
) {
  const links =
    Array.isArray(
      entry?.link
    )
      ? entry.link
      : [];

  const alternate =
    links.find(
      link =>
        link?.rel ===
        "alternate"
    );

  return (
    alternate?.href ||
    ""
  );
}

function getEntryCategories(
  entry
) {
  if (
    !Array.isArray(
      entry?.category
    )
  ) {
    return [];
  }

  return entry.category
    .map(
      category =>
        category?.term
    )
    .filter(Boolean);
}

function getEntryDate(
  entry
) {
  const published =
    getEntryText(
      entry,
      "published"
    );

  if (!published) {
    return "";
  }

  try {
    return new Date(
      published
    )
      .toISOString()
      .slice(
        0,
        10
      );
  } catch {
    return published.slice(
      0,
      10
    );
  }
}

// ============================================================
// Blog metadata
// ============================================================

function getBlogMetadata(
  feed
) {
  const title =
    getEntryText(
      feed,
      "title"
    );

  const description =
    getEntryText(
      feed,
      "subtitle"
    );

  return {
    siteTitle:
      title ||
      "",
    description:
      description ||
      ""
  };
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log(
    "============================================================"
  );

  console.log(
    `BLOG ANALYZER v${VERSION}`
  );

  console.log(
    `Blog URL: ${BLOG_URL}`
  );

  console.log(
    `Output: ${OUTPUT_DIR}`
  );

  console.log(
    "============================================================"
  );

  // ----------------------------------------------------------
  // IMPORTANT v10.5 CHANGE:
  //
  // Do NOT fetch the blog homepage first.
  //
  // The v10.4 failure happened here:
  //
  // Fetching blog page...
  // Error: HTTP 429 Too Many Requests
  //
  // The homepage is not required to obtain the posts.
  // Blogger's JSON feed is sufficient.
  // ----------------------------------------------------------

  const feedUrl =
    buildFeedUrl(
      BLOG_URL
    );

  console.log(
    "Fetching Blogger JSON Feed..."
  );

  console.log(
    `Feed URL: ${feedUrl}`
  );

  let feedResponse;

  try {
    feedResponse =
      await fetchWithRetry(
        feedUrl,
        {
          accept:
            "application/atom+json, application/json, text/json, */*",
          referer:
            BLOG_URL,
          retries:
            FETCH_RETRIES,
          label:
            "Blogger feed"
        }
      );
  } catch (error) {
    // --------------------------------------------------------
    // Only if the feed fails, try the homepage as a fallback.
    // --------------------------------------------------------

    console.warn(
      `Feed request failed: ${error.message}`
    );

    console.warn(
      "Attempting blog homepage as fallback..."
    );

    let blogResponse;

    try {
      blogResponse =
        await fetchWithRetry(
          BLOG_URL,
          {
            accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            referer:
              "",
            retries:
              FETCH_RETRIES,
            label:
              "Blog homepage"
          }
        );
    } catch (homepageError) {
      throw new Error(
        `Unable to access Blogger feed or homepage. ` +
        `Feed: ${error.message}. ` +
        `Homepage: ${homepageError.message}`
      );
    }

    const homepageHtml =
      await blogResponse.text();

    console.log(
      `Blog homepage fetched: ${homepageHtml.length} bytes`
    );

    // Try feed again after a successful homepage request.
    await sleep(1500);

    feedResponse =
      await fetchWithRetry(
        feedUrl,
        {
          accept:
            "application/atom+json, application/json, text/json, */*",
          referer:
            BLOG_URL,
          retries:
            3,
          label:
            "Blogger feed retry"
        }
      );
  }

  const feedText =
    await feedResponse.text();

  let feedJson;

  try {
    feedJson =
      JSON.parse(
        feedText
      );
  } catch {
    throw new Error(
      "Blogger feed returned non-JSON content"
    );
  }

  const {
    feed,
    entries
  } =
    parseFeed(
      feedJson
    );

  console.log(
    "Feed fetched successfully."
  );

  console.log(
    `Feed entries: ${entries.length}`
  );

  if (
    entries.length === 0
  ) {
    throw new Error(
      "No Blogger posts found in feed."
    );
  }

  const metadata =
    getBlogMetadata(
      feed
    );

  const selectedPosts = [];

  const usedHashes =
    new Set();

  const usedFingerprints =
    new Set();

  // ----------------------------------------------------------
  // Process first MAX_POSTS posts.
  // ----------------------------------------------------------

  for (
    let i = 0;
    i <
      Math.min(
        MAX_POSTS,
        entries.length
      );
    i++
  ) {
    const entry =
      entries[i];

    const title =
      getEntryText(
        entry,
        "title"
      );

    const postUrl =
      getEntryUrl(
        entry
      );

    if (
      !title ||
      !postUrl
    ) {
      console.warn(
        `Skipping feed entry ${i + 1}: missing title or URL`
      );

      continue;
    }

    const published =
      getEntryText(
        entry,
        "published"
      );

    const updated =
      getEntryText(
        entry,
        "updated"
      );

    const excerpt =
      stripHtml(
        getEntryText(
          entry,
          "summary"
        ) ||
        getEntryText(
          entry,
          "content"
        )
      )
        .slice(
          0,
          500
        );

    const categories =
      getEntryCategories(
        entry
      );

    const date =
      getEntryDate(
        entry
      );

    console.log(
      "\n------------------------------------------------------------"
    );

    console.log(
      `Post ${selectedPosts.length + 1}: ${title}`
    );

    console.log(
      `URL: ${postUrl}`
    );

    // --------------------------------------------------------
    // 1. Feed image candidates
    // --------------------------------------------------------

    let candidates =
      extractFeedImageCandidates(
        entry,
        postUrl
      );

    console.log(
      `Feed image candidates: ${candidates.length}`
    );

    // --------------------------------------------------------
    // 2. Exact post page
    //
    // Fetch only if feed did not provide a good image.
    // --------------------------------------------------------

    if (
      candidates.length === 0
    ) {
      console.log(
        "Fetching exact article page..."
      );

      try {
        const articleResponse =
          await fetchWithRetry(
            postUrl,
            {
              accept:
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              referer:
                BLOG_URL,
              retries:
                4,
              label:
                `Article page ${i + 1}`
            }
          );

        const articleHtml =
          await articleResponse.text();

        console.log(
          `Article page fetched: ${articleHtml.length} bytes`
        );

        const pageCandidates =
          extractPostPageCandidates(
            articleHtml,
            {
              title,
              url:
                postUrl
            }
          );

        console.log(
          `Page-local image candidates: ${pageCandidates.length}`
        );

        candidates =
          mergeCandidates(
            pageCandidates
          );
      } catch (error) {
        console.warn(
          `Article page fetch failed: ${error.message}`
        );
      }
    }

    // --------------------------------------------------------
    // If feed candidates exist, still allow article candidates
    // to be used if every feed image fails validation.
    // --------------------------------------------------------

    if (
      candidates.length > 0
    ) {
      console.log(
        `Image candidates for Post ${selectedPosts.length + 1}: ${candidates.length}`
      );
    }

    // --------------------------------------------------------
    // 3. If feed candidates exist but cannot be downloaded,
    //    fetch the exact article as a second chance.
    // --------------------------------------------------------

    let result =
      await selectImageForPost(
        candidates,
        {
          title,
          url:
            postUrl,
          postIndex:
            selectedPosts.length + 1,
          usedHashes,
          usedFingerprints
        }
      );

    if (
      !result
    ) {
      console.log(
        "Feed candidates failed. Fetching exact article page for fallback..."
      );

      try {
        const articleResponse =
          await fetchWithRetry(
            postUrl,
            {
              accept:
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              referer:
                BLOG_URL,
              retries:
                4,
              label:
                `Article fallback ${i + 1}`
            }
          );

        const articleHtml =
          await articleResponse.text();

        console.log(
          `Article page fetched: ${articleHtml.length} bytes`
        );

        const pageCandidates =
          extractPostPageCandidates(
            articleHtml,
            {
              title,
              url:
                postUrl
            }
          );

        console.log(
          `Page-local image candidates: ${pageCandidates.length}`
        );

        result =
          await selectImageForPost(
            pageCandidates,
            {
              title,
              url:
                postUrl,
              postIndex:
                selectedPosts.length + 1,
              usedHashes,
              usedFingerprints
            }
          );
      } catch (error) {
        console.warn(
          `Article fallback failed: ${error.message}`
        );
      }
    }

    if (!result) {
      throw new Error(
        `All image candidates were rejected for Post ${selectedPosts.length + 1}: ${title}`
      );
    }

    const finalPath =
      path.join(
        IMAGE_DIR,
        `post-${selectedPosts.length + 1}.jpg`
      );

    fs.copyFileSync(
      result.convertedPath,
      finalPath
    );

    // Remove temporary files.
    try {
      fs.rmSync(
        result.convertedPath,
        {
          force:
            true
        }
      );
    } catch {
      // Ignore.
    }

    try {
      fs.rmSync(
        result.temporaryPath,
        {
          force:
            true
        }
      );
    } catch {
      // Ignore.
    }

    const localImage =
      `blog/images/post-${selectedPosts.length + 1}.jpg`;

    usedHashes.add(
      result.hash
    );

    usedFingerprints.add(
      result.fingerprint
    );

    selectedPosts.push({
      index:
        selectedPosts.length + 1,
      title,
      url:
        postUrl,
      published,
      date,
      excerpt,
      categories,
      localImage,
      imageSource:
        result.candidate.source,
      imageUrl:
        result.candidate.url
    });

    console.log(
      `Selected image: ${localImage}`
    );

    console.log(
      `Selected source: ${result.candidate.source}`
    );

    console.log(
      `Selected URL: ${result.candidate.url}`
    );

    console.log(
      `Selected bytes: ${result.finalInfo.bytes}`
    );
  }

  // ----------------------------------------------------------
  // Require exactly MAX_POSTS.
  // ----------------------------------------------------------

  if (
    selectedPosts.length <
    MAX_POSTS
  ) {
    throw new Error(
      `Only ${selectedPosts.length} valid posts/images were captured. Required: ${MAX_POSTS}.`
    );
  }

  // ----------------------------------------------------------
  // Final validation
  // ----------------------------------------------------------

  console.log(
    "\n============================================================"
  );

  console.log(
    "Final image validation"
  );

  console.log(
    "============================================================"
  );

  const finalHashes =
    new Set();

  const finalFingerprints =
    new Set();

  for (
    const post
    of selectedPosts
  ) {
    const filePath =
      path.resolve(
        OUTPUT_DIR,
        "..",
        post.localImage
      );

    if (
      !fs.existsSync(
        filePath
      )
    ) {
      throw new Error(
        `Missing final image: ${filePath}`
      );
    }

    const hash =
      sha256File(
        filePath
      );

    const fingerprint =
      visualFingerprint(
        filePath
      );

    if (
      finalHashes.has(
        hash
      )
    ) {
      throw new Error(
        `Exact duplicate image detected: ${filePath}`
      );
    }

    if (
      finalFingerprints.has(
        fingerprint
      )
    ) {
      throw new Error(
        `Visual duplicate image detected: ${filePath}`
      );
    }

    finalHashes.add(
      hash
    );

    finalFingerprints.add(
      fingerprint
    );

    const info =
      validateImageFile(
        filePath
      );

    console.log(
      `${post.index}. ${post.title}`
    );

    console.log(
      `   ${info.width}x${info.height}, ${info.bytes} bytes`
    );
  }

  // ----------------------------------------------------------
  // blog.json
  // ----------------------------------------------------------

  const blogJson = {
    version:
      10.5,

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
      metadata.siteTitle,

    description:
      metadata.description,

    pageHeading:
      metadata.siteTitle,

    ogImage:
      "",

    language:
      "en",

    postCount:
      selectedPosts.length,

    analysis: {
      identity:
        metadata.siteTitle ||
        "Financial market blog",

      topics: [
        "stock market",
        "financial markets",
        "market news",
        "economic indicators"
      ],

      audience:
        "Readers interested in financial markets and investing",

      contentStyle:
        "Short-form market news and analysis",

      valueProposition:
        "Concise financial market information and analysis"
    },

    posts:
      selectedPosts
  };

  const blogJsonPath =
    path.join(
      OUTPUT_DIR,
      "blog.json"
    );

  fs.writeFileSync(
    blogJsonPath,
    JSON.stringify(
      blogJson,
      null,
      2
    ),
    "utf8"
  );

  console.log(
    "\n============================================================"
  );

  console.log(
    `BLOG ANALYZER v${VERSION} COMPLETE`
  );

  console.log(
    `Posts: ${selectedPosts.length}`
  );

  console.log(
    `blog.json: ${blogJsonPath}`
  );

  console.log(
    "============================================================"
  );
}

// ============================================================
// Select image for one post
//
// CRITICAL:
// If an image is a duplicate of an earlier post, we simply
// reject it and try the NEXT candidate belonging to THIS post.
//
// We never search another post's image.
// ============================================================

async function selectImageForPost(
  candidates,
  {
    title,
    url,
    postIndex,
    usedHashes,
    usedFingerprints
  }
) {
  if (
    !candidates ||
    candidates.length === 0
  ) {
    return null;
  }

  let candidateIndex = 0;

  for (
    const candidate
    of candidates
  ) {
    candidateIndex++;

    console.log(
      `Candidate ${candidateIndex}: ${candidate.url}`
    );

    // --------------------------------------------------------
    // Candidate title/context scoring.
    // --------------------------------------------------------

    const context =
      [
        candidate.alt,
        candidate.title,
        candidate.context
      ]
        .filter(Boolean)
        .join(" ");

    const similarity =
      titleSimilarity(
        title,
        context
      );

    let effectiveScore =
      candidate.score;

    if (
      similarity >= 80
    ) {
      effectiveScore += 50;
    } else if (
      similarity >= 50
    ) {
      effectiveScore += 25;
    }

    candidate.effectiveScore =
      effectiveScore;

    // --------------------------------------------------------
    // Download + validate.
    // --------------------------------------------------------

    const result =
      await tryCandidate(
        candidate,
        candidateIndex,
        {
          title,
          url
        }
      );

    if (!result) {
      continue;
    }

    // --------------------------------------------------------
    // Exact duplicate.
    // --------------------------------------------------------

    if (
      usedHashes.has(
        result.hash
      )
    ) {
      console.warn(
        `Rejected duplicate SHA-256 image for Post ${postIndex}`
      );

      try {
        fs.rmSync(
          result.convertedPath,
          {
            force:
              true
          }
        );
      } catch {
        // Ignore.
      }

      try {
        fs.rmSync(
          result.temporaryPath,
          {
            force:
              true
          }
        );
      } catch {
        // Ignore.
      }

      continue;
    }

    // --------------------------------------------------------
    // Visual duplicate.
    // --------------------------------------------------------

    if (
      usedFingerprints.has(
        result.fingerprint
      )
    ) {
      console.warn(
        `Rejected visually duplicate image for Post ${postIndex}`
      );

      try {
        fs.rmSync(
          result.convertedPath,
          {
            force:
              true
          }
        );
      } catch {
        // Ignore.
      }

      try {
        fs.rmSync(
          result.temporaryPath,
          {
            force:
              true
          }
        );
      } catch {
        // Ignore.
      }

      continue;
    }

    result.candidate =
      candidate;

    return result;
  }

  return null;
}

// ============================================================
// Execute
// ============================================================

main().catch(
  error => {
    console.error(
      "\n============================================================"
    );

    console.error(
      `BLOG ANALYZER v${VERSION} FAILED`
    );

    console.error(
      `Error: ${error.message}`
    );

    console.error(
      "============================================================"
    );

    process.exit(1);
  }
);
