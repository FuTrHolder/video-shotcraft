import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// ============================================================
// BLOG ANALYZER v10.2
//
// Main goals
// 1. Never treat the current article URL as an image.
// 2. Never accept malformed Blogger CDN URLs such as /w1200/.
// 3. Prefer images belonging to the current post only.
// 4. Avoid page-wide Blogger image scraping whenever possible.
// 5. Validate downloaded content with Content-Type + ImageMagick.
// 6. Prevent duplicate images between posts.
// 7. Keep blog.json compatible with the existing Remotion workflow.
// ============================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BLOG_URL = process.argv[2];

if (!BLOG_URL) {
  console.error(
    "Usage: node scripts/capture-blog.mjs <BLOG_URL>"
  );
  process.exit(1);
}

const OUTPUT_DIR = path.resolve(
  __dirname,
  "../template/public/blog"
);

const IMAGE_DIR = path.join(
  OUTPUT_DIR,
  "images"
);

fs.mkdirSync(
  OUTPUT_DIR,
  { recursive: true }
);

fs.mkdirSync(
  IMAGE_DIR,
  { recursive: true }
);

// ============================================================
// ImageMagick
// ============================================================

function findImageMagick() {
  for (const command of ["magick", "convert"]) {
    try {
      execFileSync(
        command,
        ["-version"],
        { stdio: "ignore" }
      );

      return command;
    } catch {
      // continue
    }
  }

  return null;
}

const IMAGE_MAGICK = findImageMagick();

if (!IMAGE_MAGICK) {
  console.error(
    "ERROR: ImageMagick was not found."
  );

  process.exit(1);
}

console.log(
  `ImageMagick command: ${IMAGE_MAGICK}`
);

try {
  const version = execFileSync(
    IMAGE_MAGICK,
    ["-version"],
    { encoding: "utf8" }
  );

  console.log(
    version.split("\n")[0]
  );
} catch {
  // ignore
}

// ============================================================
// Helpers
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
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => {
      try {
        return String.fromCodePoint(
          Number(n)
        );
      } catch {
        return _;
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      try {
        return String.fromCodePoint(
          parseInt(n, 16)
        );
      } catch {
        return _;
      }
    });
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

function absoluteUrl(
  rawUrl,
  baseUrl
) {
  if (!rawUrl) {
    return null;
  }

  let value = htmlDecode(
    String(rawUrl)
      .trim()
      .replace(/^['"]|['"]$/g, "")
  );

  if (!value) {
    return null;
  }

  if (value.startsWith("//")) {
    value = `https:${value}`;
  }

  try {
    return new URL(
      value,
      baseUrl
    ).href;
  } catch {
    return null;
  }
}

function samePageUrl(
  candidateUrl,
  pageUrl
) {
  if (!candidateUrl || !pageUrl) {
    return false;
  }

  try {
    const candidate =
      new URL(candidateUrl);

    const page =
      new URL(pageUrl);

    return (
      candidate.origin === page.origin &&
      candidate.pathname === page.pathname
    );
  } catch {
    return false;
  }
}

// ============================================================
// Blogger URL normalization
// ============================================================

function normalizeBloggerImageUrl(
  rawUrl
) {
  if (!rawUrl) {
    return null;
  }

  let value = htmlDecode(
    String(rawUrl)
      .trim()
      .replace(/^['"]|['"]$/g, "")
  );

  if (!value) {
    return null;
  }

  if (value.startsWith("//")) {
    value = `https:${value}`;
  }

  let parsed;

  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  const originalPath =
    parsed.pathname;

  // ----------------------------------------------------------
  // IMPORTANT
  //
  // Blogger URLs can look like:
  //
  // /img/.../w1200/
  //
  // That is NOT sufficient.
  //
  // A real image URL normally has an image identifier after
  // the resize segment.
  //
  // Therefore:
  //
  // /w1200/
  //
  // is rejected.
  // ----------------------------------------------------------

  const resizePatterns = [
    /\/s\d+(?:-c)?\/$/i,
    /\/s\d+(?:-c)?\/([^/]+)$/i,
    /\/w\d+\/$/i,
    /\/w\d+-h\d+(?:-p)?\/$/i,
    /\/w\d+-h\d+(?:-p)?\/([^/]+)$/i,
  ];

  const isResizeOnly =
    resizePatterns.some(
      pattern => pattern.test(
        originalPath
      )
    ) &&
    (
      /\/w\d+\/$/i.test(originalPath) ||
      /\/w\d+-h\d+(?:-p)?\/$/i.test(originalPath) ||
      /\/s\d+(?:-c)?\/$/i.test(originalPath)
    );

  if (isResizeOnly) {
    return null;
  }

  let normalizedPath =
    originalPath;

  // Standard Blogger resizing path.
  normalizedPath =
    normalizedPath.replace(
      /\/s\d+(?:-c)?\/([^/]+)$/i,
      "/s1600/$1"
    );

  normalizedPath =
    normalizedPath.replace(
      /\/w\d+-h\d+(?:-p)?\/([^/]+)$/i,
      "/s1600/$1"
    );

  normalizedPath =
    normalizedPath.replace(
      /\/w\d+\/([^/]+)$/i,
      "/s1600/$1"
    );

  normalizedPath =
    normalizedPath.replace(
      /\/s\d+(?:-c)?\/([^/]+)$/i,
      "/s1600/$1"
    );

  // Do not accept a resize directory without an image tail.
  if (
    /\/(?:w\d+|w\d+-h\d+(?:-p)?|s\d+(?:-c)?)\/$/i.test(
      normalizedPath
    )
  ) {
    return null;
  }

  parsed.pathname =
    normalizedPath;

  return parsed.href;
}

// ============================================================
// Image URL validation
// ============================================================

function isObviouslyBadImageUrl(
  url,
  pageUrl = null
) {
  if (!url) {
    return true;
  }

  const value =
    String(url).trim();

  const lower =
    value.toLowerCase();

  if (
    /^data:/i.test(value)
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
    /\.html?(?:[?#]|$)/i.test(lower)
  ) {
    return true;
  }

  if (
    /\.json(?:[?#]|$)/i.test(lower) ||
    /\.xml(?:[?#]|$)/i.test(lower)
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
    "icon-",
    "/icons/",
    "/icon/",
    "tracking",
    "pixel.gif",
    "tracking.gif",
    "1x1",
    "transparent.gif",
    "spacer.gif",
    "blank.gif",
    "default-avatar",
    "author-avatar",
    "blogger-logo"
  ];

  for (
    const pattern
    of badPatterns
  ) {
    if (
      lower.includes(pattern)
    ) {
      return true;
    }
  }

  // Resize-only Blogger URLs.
  if (
    /\/(?:w\d+|w\d+-h\d+(?:-p)?|s\d+(?:-c)?)\/(?:[?#].*)?$/i.test(
      lower
    )
  ) {
    return true;
  }

  return false;
}

function isLikelyImageUrl(
  url
) {
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

  if (
    /\.(jpg|jpeg|png|webp|gif|avif)(?:[?#]|$)/i.test(
      lower
    )
  ) {
    return true;
  }

  return false;
}

// ============================================================
// Candidate scoring
// ============================================================

function getContextScore(
  meta = {}
) {
  const text = [
    meta.alt,
    meta.title,
    meta.className,
    meta.id,
    meta.parentClass,
    meta.caption
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  let score = 0;

  if (text.includes("hero")) {
    score += 30;
  }

  if (text.includes("featured")) {
    score += 25;
  }

  if (text.includes("post-body")) {
    score += 25;
  }

  if (text.includes("entry-content")) {
    score += 25;
  }

  if (text.includes("article")) {
    score += 15;
  }

  if (text.includes("post-content")) {
    score += 20;
  }

  if (text.includes("thumbnail")) {
    score += 5;
  }

  if (text.includes("cover")) {
    score += 10;
  }

  if (text.includes("image")) {
    score += 5;
  }

  if (text.includes("logo")) {
    score -= 80;
  }

  if (text.includes("avatar")) {
    score -= 80;
  }

  if (text.includes("icon")) {
    score -= 50;
  }

  if (text.includes("social")) {
    score -= 40;
  }

  if (text.includes("related")) {
    score -= 35;
  }

  if (text.includes("sidebar")) {
    score -= 60;
  }

  if (text.includes("footer")) {
    score -= 60;
  }

  if (text.includes("header")) {
    score -= 35;
  }

  return score;
}

// ============================================================
// srcset
// ============================================================

function extractSrcsetUrls(
  srcset,
  baseUrl
) {
  const result = [];

  if (!srcset) {
    return result;
  }

  const parts =
    String(srcset)
      .split(",")
      .map(x => x.trim())
      .filter(Boolean);

  for (
    const part
    of parts
  ) {
    const match =
      part.match(
        /^(.+?)(?:\s+\d+(?:w|x))?$/
      );

    const rawUrl =
      match?.[1]?.trim();

    if (!rawUrl) {
      continue;
    }

    const url =
      absoluteUrl(
        rawUrl,
        baseUrl
      );

    if (url) {
      result.push(url);
    }
  }

  return result;
}

// ============================================================
// HTML attribute helper
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
    return quoted[1];
  }

  const unquoted =
    tag.match(
      new RegExp(
        `\\b${name}\\s*=\\s*([^\\s>]+)`,
        "i"
      )
    );

  return unquoted?.[1] || "";
}

// ============================================================
// HTML image extraction
//
// IMPORTANT:
// Only parse actual HTML image attributes here.
//
// We deliberately do NOT globally scan arbitrary
// blogger.googleusercontent.com strings.
// ============================================================

function extractImagesFromHtml(
  html,
  baseUrl,
  source,
  extraScore = 0
) {
  const candidates = [];

  if (!html) {
    return candidates;
  }

  let order = 0;

  function addCandidate(
    rawUrl,
    meta = {}
  ) {
    if (!rawUrl) {
      return;
    }

    let cleaned =
      htmlDecode(
        String(rawUrl)
          .trim()
          .replace(/^['"]|['"]$/g, "")
      );

    if (!cleaned) {
      return;
    }

    cleaned =
      cleaned.replace(
        /[),.;]+$/g,
        ""
      );

    const absolute =
      absoluteUrl(
        cleaned,
        baseUrl
      );

    if (!absolute) {
      return;
    }

    const normalized =
      normalizeBloggerImageUrl(
        absolute
      );

    if (!normalized) {
      return;
    }

    if (
      isObviouslyBadImageUrl(
        normalized,
        baseUrl
      )
    ) {
      return;
    }

    if (
      !isLikelyImageUrl(
        normalized
      )
    ) {
      return;
    }

    const contextScore =
      getContextScore(meta);

    candidates.push({
      url: normalized,
      source,
      order: order++,
      score:
        extraScore +
        contextScore -
        Math.min(order, 30) * 1.2,
      alt:
        meta.alt || "",
      title:
        meta.title || "",
      className:
        meta.className || "",
      id:
        meta.id || ""
    });
  }

  // ----------------------------------------------------------
  // IMG tags
  // ----------------------------------------------------------

  const imgRegex =
    /<img\b[^>]*>/gi;

  for (
    const match
    of html.matchAll(imgRegex)
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

    const meta = {
      alt,
      title,
      className,
      id
    };

    const src =
      getAttribute(
        tag,
        "src"
      );

    const srcset =
      getAttribute(
        tag,
        "srcset"
      );

    const dataSrcset =
      getAttribute(
        tag,
        "data-srcset"
      );

    if (src) {
      addCandidate(
        src,
        meta
      );
    }

    const lazyAttributes = [
      "data-src",
      "data-original",
      "data-lazy-src",
      "data-lazy",
      "data-image",
      "data-image-url",
      "data-url"
    ];

    for (
      const attribute
      of lazyAttributes
    ) {
      const value =
        getAttribute(
          tag,
          attribute
        );

      if (value) {
        addCandidate(
          value,
          meta
        );
      }
    }

    for (
      const value
      of [
        srcset,
        dataSrcset
      ]
    ) {
      if (!value) {
        continue;
      }

      for (
        const srcsetUrl
        of extractSrcsetUrls(
          value,
          baseUrl
        )
      ) {
        addCandidate(
          srcsetUrl,
          meta
        );
      }
    }
  }

  // ----------------------------------------------------------
  // SOURCE srcset
  // ----------------------------------------------------------

  const sourceRegex =
    /<source\b[^>]*>/gi;

  for (
    const match
    of html.matchAll(
      sourceRegex
    )
  ) {
    const tag =
      match[0];

    const srcset =
      getAttribute(
        tag,
        "srcset"
      ) ||
      getAttribute(
        tag,
        "data-srcset"
      );

    if (!srcset) {
      continue;
    }

    for (
      const srcsetUrl
      of extractSrcsetUrls(
        srcset,
        baseUrl
      )
    ) {
      addCandidate(
        srcsetUrl,
        {
          className:
            getAttribute(
              tag,
              "class"
            )
        }
      );
    }
  }

  // ----------------------------------------------------------
  // CSS background-image
  // ----------------------------------------------------------

  const cssRegex =
    /background-image\s*:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;

  for (
    const match
    of html.matchAll(
      cssRegex
    )
  ) {
    addCandidate(
      match[1],
      {
        className:
          "background-image"
      }
    );
  }

  // ----------------------------------------------------------
  // Meta images
  // ----------------------------------------------------------

  const metaRegex =
    /<meta\b[^>]*>/gi;

  for (
    const match
    of html.matchAll(
      metaRegex
    )
  ) {
    const tag =
      match[0];

    const property =
      getAttribute(
        tag,
        "property"
      ).toLowerCase();

    const name =
      getAttribute(
        tag,
        "name"
      ).toLowerCase();

    const content =
      getAttribute(
        tag,
        "content"
      );

    if (
      [
        "og:image",
        "og:image:url",
        "twitter:image",
        "twitter:image:src",
        "image_src"
      ].includes(property) ||
      [
        "twitter:image",
        "twitter:image:src",
        "image_src"
      ].includes(name)
    ) {
      addCandidate(
        content,
        {
          className:
            "meta-image"
        }
      );
    }
  }

  return candidates;
}

// ============================================================
// Candidate de-duplication
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

    if (
      !map.has(
        candidate.url
      )
    ) {
      map.set(
        candidate.url,
        candidate
      );
    }
  }

  return Array.from(
    map.values()
  );
}

// ============================================================
// Feed extraction
// ============================================================

function getFeedValue(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  if (
    typeof value === "string"
  ) {
    return value;
  }

  if (
    typeof value === "object"
  ) {
    if (
      typeof value.$t === "string"
    ) {
      return value.$t;
    }

    if (
      typeof value["$t"] === "string"
    ) {
      return value["$t"];
    }
  }

  return "";
}

function getArray(
  value
) {
  if (Array.isArray(value)) {
    return value;
  }

  if (
    value &&
    typeof value === "object"
  ) {
    return [value];
  }

  return [];
}

function extractFeedCandidates(
  entry,
  baseUrl
) {
  const candidates = [];

  // ----------------------------------------------------------
  // media$thumbnail
  // ----------------------------------------------------------

  const thumbnail =
    entry?.["media$thumbnail"];

  if (thumbnail) {
    const url =
      thumbnail.url ||
      thumbnail.src ||
      getFeedValue(
        thumbnail
      );

    if (url) {
      candidates.push({
        url,
        source:
          "feed-thumbnail",
        score: 20,
        alt: "",
        title: ""
      });
    }
  }

  // ----------------------------------------------------------
  // media$group / media$content
  // ----------------------------------------------------------

  const mediaGroup =
    entry?.["media$group"];

  if (mediaGroup) {
    const mediaContent =
      getArray(
        mediaGroup[
          "media$content"
        ]
      );

    for (
      const media
      of mediaContent
    ) {
      const url =
        media?.url ||
        media?.src ||
        getFeedValue(
          media
        );

      if (url) {
        candidates.push({
          url,
          source:
            "feed-content",
          score: 30,
          alt:
            media?.title ||
            "",
          title:
            media?.title ||
            ""
        });
      }
    }
  }

  // ----------------------------------------------------------
  // direct media$content
  // ----------------------------------------------------------

  const directMedia =
    getArray(
      entry?.["media$content"]
    );

  for (
    const media
    of directMedia
  ) {
    const url =
      media?.url ||
      media?.src ||
      getFeedValue(
        media
      );

    if (url) {
      candidates.push({
        url,
        source:
          "feed-content",
        score: 30,
        alt:
          media?.title ||
          "",
        title:
          media?.title ||
          ""
      });
    }
  }

  // ----------------------------------------------------------
  // Feed content HTML
  // ----------------------------------------------------------

  const content =
    getFeedValue(
      entry?.content
    );

  if (content) {
    candidates.push(
      ...extractImagesFromHtml(
        content,
        baseUrl,
        "feed-content",
        50
      )
    );
  }

  // ----------------------------------------------------------
  // Feed summary HTML
  // ----------------------------------------------------------

  const summary =
    getFeedValue(
      entry?.summary
    );

  if (summary) {
    candidates.push(
      ...extractImagesFromHtml(
        summary,
        baseUrl,
        "feed-summary",
        35
      )
    );
  }

  const normalized =
    candidates
      .map(candidate => {
        const url =
          normalizeBloggerImageUrl(
            absoluteUrl(
              candidate.url,
              baseUrl
            )
          );

        if (!url) {
          return null;
        }

        if (
          isObviouslyBadImageUrl(
            url,
            baseUrl
          )
        ) {
          return null;
        }

        if (
          !isLikelyImageUrl(
            url
          )
        ) {
          return null;
        }

        return {
          ...candidate,
          url
        };
      })
      .filter(Boolean);

  return dedupeCandidates(
    normalized
  );
}

// ============================================================
// Post container extraction
// ============================================================

function extractBalancedElement(
  html,
  startIndex,
  tagName
) {
  const openRegex =
    new RegExp(
      `<${tagName}\\b[^>]*>`,
      "gi"
    );

  const closeRegex =
    new RegExp(
      `</${tagName}\\s*>`,
      "gi"
    );

  openRegex.lastIndex =
    startIndex;

  closeRegex.lastIndex =
    startIndex;

  let depth = 0;
  let cursor = startIndex;

  while (cursor < html.length) {
    openRegex.lastIndex =
      cursor;

    closeRegex.lastIndex =
      cursor;

    const open =
      openRegex.exec(html);

    const close =
      closeRegex.exec(html);

    if (!open && !close) {
      break;
    }

    if (
      open &&
      (
        !close ||
        open.index <
          close.index
      )
    ) {
      depth += 1;
      cursor =
        open.index +
        open[0].length;

      continue;
    }

    depth -= 1;

    const end =
      close.index +
      close[0].length;

    if (depth <= 0) {
      return html.slice(
        startIndex,
        end
      );
    }

    cursor = end;
  }

  return null;
}

function findClassContainers(
  html,
  classNames
) {
  const results = [];

  for (
    const className
    of classNames
  ) {
    const regex =
      new RegExp(
        `<([a-z0-9]+)\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>`,
        "gi"
      );

    for (
      const match
      of html.matchAll(
        regex
      )
    ) {
      const start =
        match.index;

      if (
        start === undefined
      ) {
        continue;
      }

      const tagName =
        match[1];

      const container =
        extractBalancedElement(
          html,
          start,
          tagName
        );

      if (container) {
        results.push({
          html: container,
          className,
          score:
            className ===
            "post-body"
              ? 100
              : 90
        });
      }
    }
  }

  return results;
}

function findArticles(
  html
) {
  const results = [];

  const regex =
    /<article\b[^>]*>/gi;

  for (
    const match
    of html.matchAll(
      regex
    )
  ) {
    const start =
      match.index;

    if (
      start === undefined
    ) {
      continue;
    }

    const container =
      extractBalancedElement(
        html,
        start,
        "article"
      );

    if (container) {
      results.push({
        html: container,
        className:
          "article",
        score: 95
      });
    }
  }

  return results;
}

// ============================================================
// Title-scoped container selection
// ============================================================

function findTitleRelatedContainers(
  html,
  title
) {
  const results = [];

  if (!title) {
    return results;
  }

  const normalizedTitle =
    normalizeText(
      title
    );

  const titleWords =
    normalizedTitle
      .split(/\s+/)
      .filter(
        word =>
          word.length >= 4
      )
      .slice(0, 10);

  if (!titleWords.length) {
    return results;
  }

  const headings =
    /<(h1|h2|h3|h4|h5|h6)\b[^>]*>([\s\S]*?)<\/\1>/gi;

  for (
    const match
    of html.matchAll(
      headings
    )
  ) {
    const headingText =
      normalizeText(
        stripHtml(
          match[2]
        )
      );

    if (!headingText) {
      continue;
    }

    const overlap =
      titleWords.filter(
        word =>
          headingText.includes(
            word
          )
      ).length;

    if (
      overlap < 2 &&
      !headingText.includes(
        normalizedTitle
      )
    ) {
      continue;
    }

    const headingStart =
      match.index;

    if (
      headingStart === undefined
    ) {
      continue;
    }

    // Search forward for a post/article container.
    const after =
      html.slice(
        headingStart,
        Math.min(
          html.length,
          headingStart + 200000
        )
      );

    const localContainers =
      [
        ...findClassContainers(
          after,
          [
            "post-body",
            "entry-content",
            "post-content",
            "blog-post",
            "hentry"
          ]
        ),
        ...findArticles(after)
      ];

    for (
      const container
      of localContainers
    ) {
      const imageCount =
        (
          container.html.match(
            /<img\b/gi
          ) || []
        ).length;

      if (
        imageCount > 0
      ) {
        results.push({
          ...container,
          score:
            container.score +
            overlap * 15 +
            30
        });
      }
    }
  }

  return results;
}

// ============================================================
// Page-local extraction
// ============================================================

function extractPageCandidates(
  html,
  pageUrl,
  title
) {
  const scoped = [];

  // ----------------------------------------------------------
  // 1. Title-related containers
  // ----------------------------------------------------------

  scoped.push(
    ...findTitleRelatedContainers(
      html,
      title
    )
  );

  // ----------------------------------------------------------
  // 2. Standard Blogger post-body
  // ----------------------------------------------------------

  scoped.push(
    ...findClassContainers(
      html,
      [
        "post-body",
        "entry-content",
        "post-content",
        "blog-post",
        "hentry"
      ]
    )
  );

  // ----------------------------------------------------------
  // 3. Articles
  // ----------------------------------------------------------

  scoped.push(
    ...findArticles(
      html
    )
  );

  // Sort best scopes first.
  scoped.sort(
    (a, b) =>
      b.score - a.score
  );

  const candidates = [];

  const seenScopes =
    new Set();

  for (
    const scope
    of scoped
  ) {
    const fingerprint =
      scope.html.slice(
        0,
        300
      );

    if (
      seenScopes.has(
        fingerprint
      )
    ) {
      continue;
    }

    seenScopes.add(
      fingerprint
    );

    const images =
      extractImagesFromHtml(
        scope.html,
        pageUrl,
        `post-${scope.className}`,
        scope.score
      );

    candidates.push(
      ...images
    );
  }

  // ----------------------------------------------------------
  // 4. Page metadata as a last resort.
  //
  // IMPORTANT:
  // Only meta image extraction is allowed here.
  // We do NOT globally regex-search Blogger CDN URLs.
  // ----------------------------------------------------------

  const metaImages =
    extractImagesFromHtml(
      html,
      pageUrl,
      "post-meta",
      10
    );

  // Only take meta candidates if scoped extraction found none.
  if (
    candidates.length === 0
  ) {
    candidates.push(
      ...metaImages
    );
  }

  return dedupeCandidates(
    candidates
  );
}

// ============================================================
// Fetch
// ============================================================

async function fetchText(
  url
) {
  const response =
    await fetch(
      url,
      {
        redirect: "follow",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; BlogAnalyzer/10.2)",
          "Accept":
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
      }
    );

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} for ${url}`
    );
  }

  return await response.text();
}

async function fetchJson(
  url
) {
  const response =
    await fetch(
      url,
      {
        redirect: "follow",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; BlogAnalyzer/10.2)",
          "Accept":
            "application/json,text/plain,*/*"
        }
      }
    );

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} for ${url}`
    );
  }

  return await response.json();
}

// ============================================================
// Blogger feed URL
// ============================================================

function buildFeedUrl(
  blogUrl
) {
  const parsed =
    new URL(
      blogUrl
    );

  parsed.search = "";
  parsed.hash = "";

  parsed.pathname =
    "/feeds/posts/default";

  parsed.searchParams.set(
    "alt",
    "json"
  );

  parsed.searchParams.set(
    "max-results",
    "10"
  );

  return parsed.href;
}

// ============================================================
// Download image
// ============================================================

async function downloadImage(
  url,
  outputPath
) {
  console.log(
    `Downloading image: ${url}`
  );

  const response =
    await fetch(
      url,
      {
        redirect: "follow",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; BlogAnalyzer/10.2)",
          "Accept":
            "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
        }
      }
    );

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}`
    );
  }

  const contentType =
    String(
      response.headers.get(
        "content-type"
      ) || ""
    ).toLowerCase();

  console.log(
    `Content-Type: ${contentType || "unknown"}`
  );

  // ----------------------------------------------------------
  // Reject HTML/JSON/XML before ImageMagick.
  // ----------------------------------------------------------

  if (
    contentType.includes(
      "text/html"
    ) ||
    contentType.includes(
      "application/xhtml"
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
      `Server returned non-image content: ${contentType}`
    );
  }

  const arrayBuffer =
    await response.arrayBuffer();

  const buffer =
    Buffer.from(
      arrayBuffer
    );

  if (
    buffer.length < 5000
  ) {
    throw new Error(
      `Image is too small: ${buffer.length} bytes`
    );
  }

  fs.writeFileSync(
    outputPath,
    buffer
  );

  console.log(
    `Downloaded: ${buffer.length} bytes`
  );

  // ----------------------------------------------------------
  // Validate with ImageMagick immediately.
  // ----------------------------------------------------------

  try {
    const identifyOutput =
      execFileSync(
        IMAGE_MAGICK,
        [
          "identify",
          "-format",
          "%m|%w|%h",
          outputPath
        ],
        {
          encoding: "utf8",
          stdio: [
            "ignore",
            "pipe",
            "pipe"
          ]
        }
      ).trim();

    if (!identifyOutput) {
      throw new Error(
        "ImageMagick returned no identification"
      );
    }

    console.log(
      `ImageMagick: ${identifyOutput}`
    );
  } catch {
    try {
      execFileSync(
        IMAGE_MAGICK === "convert"
          ? "identify"
          : IMAGE_MAGICK,
        [
          outputPath
        ],
        {
          stdio: "ignore"
        }
      );
    } catch {
      throw new Error(
        "ImageMagick could not identify image"
      );
    }
  }

  return {
    bytes:
      buffer.length,
    contentType
  };
}

// ============================================================
// Convert to final JPG
// ============================================================

function convertToJpg(
  sourcePath,
  outputPath
) {
  const identifyCommand =
    IMAGE_MAGICK === "convert"
      ? "identify"
      : "magick";

  try {
    execFileSync(
      identifyCommand,
      [
        sourcePath
      ],
      {
        stdio: "ignore"
      }
    );
  } catch {
    throw new Error(
      "Source image failed ImageMagick validation"
    );
  }

  try {
    execFileSync(
      IMAGE_MAGICK,
      [
        sourcePath,
        "-auto-orient",
        "-strip",
        "-quality",
        "90",
        outputPath
      ],
      {
        stdio: "ignore"
      }
    );
  } catch {
    throw new Error(
      "Failed to convert image to JPG"
    );
  }

  if (
    !fs.existsSync(
      outputPath
    )
  ) {
    throw new Error(
      "JPG output was not created"
    );
  }

  const stat =
    fs.statSync(
      outputPath
    );

  if (
    stat.size < 5000
  ) {
    throw new Error(
      `Converted JPG is too small: ${stat.size} bytes`
    );
  }

  return stat.size;
}

// ============================================================
// Image fingerprint
//
// We use a small grayscale perceptual fingerprint so that
// visually identical images with different encodings can also
// be detected.
// ============================================================

function getImageFingerprint(
  imagePath
) {
  const tempPath =
    `${imagePath}.fingerprint.png`;

  try {
    execFileSync(
      IMAGE_MAGICK,
      [
        imagePath,
        "-auto-orient",
        "-resize",
        "32x32!",
        "-colorspace",
        "Gray",
        "-depth",
        "8",
        tempPath
      ],
      {
        stdio: "ignore"
      }
    );

    const data =
      fs.readFileSync(
        tempPath
      );

    return crypto
      .createHash("sha256")
      .update(data)
      .digest("hex");
  } finally {
    try {
      fs.unlinkSync(
        tempPath
      );
    } catch {
      // ignore
    }
  }
}

// ============================================================
// Exact file hash
// ============================================================

function getFileHash(
  filePath
) {
  return crypto
    .createHash("sha256")
    .update(
      fs.readFileSync(
        filePath
      )
    )
    .digest("hex");
}

// ============================================================
// Semantic title matching
//
// This is not intended to prove that an image is semantically
// correct. It only gives a modest preference to images whose
// alt/title/caption contains words from the article title.
// ============================================================

function titleImageScore(
  title,
  candidate
) {
  const titleWords =
    normalizeText(
      title
    )
      .split(/\s+/)
      .filter(
        word =>
          word.length >= 4
      );

  if (
    titleWords.length === 0
  ) {
    return 0;
  }

  const imageText =
    normalizeText(
      [
        candidate.alt,
        candidate.title,
        candidate.className,
        candidate.id
      ]
        .filter(Boolean)
        .join(" ")
    );

  if (!imageText) {
    return 0;
  }

  let matches = 0;

  for (
    const word
    of titleWords
  ) {
    if (
      imageText.includes(
        word
      )
    ) {
      matches += 1;
    }
  }

  return Math.min(
    30,
    matches * 6
  );
}

// ============================================================
// Candidate evaluation
// ============================================================

async function evaluateCandidate(
  candidate,
  postIndex
) {
  const tempPath =
    path.join(
      IMAGE_DIR,
      `.candidate-${postIndex}-${crypto.randomUUID()}.bin`
    );

  try {
    await downloadImage(
      candidate.url,
      tempPath
    );

    const sourceHash =
      getFileHash(
        tempPath
      );

    const finalTempPath =
      path.join(
        IMAGE_DIR,
        `.candidate-${postIndex}-${crypto.randomUUID()}.jpg`
      );

    convertToJpg(
      tempPath,
      finalTempPath
    );

    const fingerprint =
      getImageFingerprint(
        finalTempPath
      );

    const result = {
      ...candidate,
      sourceHash,
      fingerprint,
      tempPath: finalTempPath
    };

    return result;
  } catch (error) {
    console.log(
      `Rejected: ${error.message}`
    );

    try {
      fs.unlinkSync(
        tempPath
      );
    } catch {
      // ignore
    }

    return null;
  }
}

// ============================================================
// Post extraction
// ============================================================

function getEntryTitle(
  entry
) {
  return getFeedValue(
    entry?.title
  ).trim();
}

function getEntryUrl(
  entry,
  fallbackBase
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

  if (
    alternate?.href
  ) {
    return alternate.href;
  }

  const self =
    links.find(
      link =>
        link?.href
    );

  if (
    self?.href
  ) {
    return self.href;
  }

  return fallbackBase;
}

function getEntryPublished(
  entry
) {
  return (
    getFeedValue(
      entry?.published
    ) ||
    getFeedValue(
      entry?.updated
    ) ||
    ""
  );
}

function getCategories(
  entry
) {
  const categories =
    Array.isArray(
      entry?.category
    )
      ? entry.category
      : [];

  return categories
    .map(
      item =>
        item?.term ||
        getFeedValue(
          item
        )
    )
    .filter(Boolean);
}

function getExcerpt(
  entry
) {
  const summary =
    getFeedValue(
      entry?.summary
    );

  const content =
    getFeedValue(
      entry?.content
    );

  const text =
    stripHtml(
      summary ||
      content
    );

  return text.slice(
    0,
    320
  );
}

// ============================================================
// Blog analysis
// ============================================================

function buildAnalysis(
  siteTitle,
  description,
  posts
) {
  const topicWords =
    new Map();

  for (
    const post
    of posts
  ) {
    const text =
      normalizeText(
        `${post.title} ${post.excerpt}`
      );

    for (
      const word
      of text.split(/\s+/)
    ) {
      if (
        word.length < 5
      ) {
        continue;
      }

      if (
        [
          "about",
          "which",
          "their",
          "there",
          "these",
          "those",
          "today",
          "using",
          "could",
          "would",
          "should",
          "after",
          "before",
          "where",
          "while",
          "into",
          "from"
        ].includes(word)
      ) {
        continue;
      }

      topicWords.set(
        word,
        (
          topicWords.get(
            word
          ) || 0
        ) + 1
      );
    }
  }

  const topics =
    Array.from(
      topicWords.entries()
    )
      .sort(
        (a, b) =>
          b[1] - a[1]
      )
      .slice(0, 6)
      .map(
        ([word]) =>
          word.toUpperCase()
      );

  return {
    identity:
      description ||
      `${siteTitle} provides practical information and analysis.`,
    topics:
      topics.length
        ? topics
        : ["INSIGHTS"],
    audience:
      "Readers looking for practical information, analysis, and useful insights.",
    contentStyle:
      "Focused articles built around current topics, explanations, and practical information.",
    valueProposition:
      "Clear, useful information presented in an accessible format."
  };
}

// ============================================================
// Select image for one post
//
// IMPORTANT:
// We do not borrow candidates from another post.
// Each post is responsible for finding its own image.
// ============================================================

async function selectImageForPost(
  post,
  feedCandidates,
  pageCandidates,
  postIndex,
  usedFingerprints
) {
  const combined =
    dedupeCandidates([
      ...feedCandidates,
      ...pageCandidates
    ]);

  const scored =
    combined.map(
      candidate => ({
        ...candidate,
        score:
          Number(
            candidate.score || 0
          ) +
          titleImageScore(
            post.title,
            candidate
          )
      })
    );

  scored.sort(
    (a, b) =>
      b.score - a.score
  );

  console.log(
    `Image candidates for Post ${postIndex}: ${scored.length}`
  );

  for (
    const candidate
    of scored
  ) {
    console.log(
      `Candidate: ${candidate.url}`
    );

    const evaluated =
      await evaluateCandidate(
        candidate,
        postIndex
      );

    if (!evaluated) {
      continue;
    }

    if (
      usedFingerprints.has(
        evaluated.fingerprint
      )
    ) {
      console.log(
        "Rejected: visually duplicated image"
      );

      try {
        fs.unlinkSync(
          evaluated.tempPath
        );
      } catch {
        // ignore
      }

      continue;
    }

    usedFingerprints.add(
      evaluated.fingerprint
    );

    const finalName =
      `post-${postIndex}.jpg`;

    const finalPath =
      path.join(
        IMAGE_DIR,
        finalName
      );

    try {
      fs.renameSync(
        evaluated.tempPath,
        finalPath
      );
    } catch {
      fs.copyFileSync(
        evaluated.tempPath,
        finalPath
      );

      fs.unlinkSync(
        evaluated.tempPath
      );
    }

    return {
      localImage:
        `blog/images/${finalName}`,
      imageSource:
        candidate.source,
      imageUrl:
        candidate.url,
      imageBytes:
        fs.statSync(
          finalPath
        ).size,
      fingerprint:
        evaluated.fingerprint
    };
  }

  return null;
}

// ============================================================
// Clean previous generated images
// ============================================================

function cleanPreviousImages() {
  if (
    !fs.existsSync(
      IMAGE_DIR
    )
  ) {
    return;
  }

  for (
    const name
    of fs.readdirSync(
      IMAGE_DIR
    )
  ) {
    const file =
      path.join(
        IMAGE_DIR,
        name
      );

    try {
      if (
        fs.statSync(
          file
        ).isFile()
      ) {
        fs.unlinkSync(
          file
        );
      }
    } catch {
      // ignore
    }
  }
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log(
    "============================================================"
  );

  console.log(
    "BLOG ANALYZER v10.2"
  );

  console.log(
    `Blog URL: ${BLOG_URL}`
  );

  console.log(
    "============================================================"
  );

  cleanPreviousImages();

  const blogUrl =
    new URL(
      BLOG_URL
    ).href;

  // ----------------------------------------------------------
  // Fetch main blog page
  // ----------------------------------------------------------

  console.log(
    "Fetching blog page..."
  );

  const blogHtml =
    await fetchText(
      blogUrl
    );

  console.log(
    `Blog page fetched: ${blogHtml.length} bytes`
  );

  // ----------------------------------------------------------
  // Basic metadata
  // ----------------------------------------------------------

  const titleMatch =
    blogHtml.match(
      /<title[^>]*>([\s\S]*?)<\/title>/i
    );

  const siteTitle =
    stripHtml(
      titleMatch?.[1] ||
      new URL(
        blogUrl
      ).hostname
    );

  const descriptionMatch =
    blogHtml.match(
      /<meta\b[^>]*(?:name|property)=["'](?:description|og:description)["'][^>]*>/i
    );

  const description =
    descriptionMatch
      ? getAttribute(
          descriptionMatch[0],
          "content"
        )
      : "";

  // ----------------------------------------------------------
  // Fetch Blogger JSON feed
  // ----------------------------------------------------------

  const feedUrl =
    buildFeedUrl(
      blogUrl
    );

  console.log(
    `Feed URL: ${feedUrl}`
  );

  let feed;

  try {
    feed =
      await fetchJson(
        feedUrl
      );

    console.log(
      "Feed fetched successfully."
    );
  } catch (error) {
    console.log(
      `Feed fetch failed: ${error.message}`
    );

    feed = null;
  }

  const entries =
    Array.isArray(
      feed?.feed?.entry
    )
      ? feed.feed.entry
      : [];

  console.log(
    `Feed entries: ${entries.length}`
  );

  if (
    entries.length < 5
  ) {
    throw new Error(
      `Expected at least 5 feed entries, got ${entries.length}`
    );
  }

  // ----------------------------------------------------------
  // Process first 5 posts
  // ----------------------------------------------------------

  const posts = [];

  const usedFingerprints =
    new Set();

  for (
    let i = 0;
    i < 5;
    i++
  ) {
    const entry =
      entries[i];

    const postTitle =
      getEntryTitle(
        entry
      );

    const postUrl =
      getEntryUrl(
        entry,
        blogUrl
      );

    const published =
      getEntryPublished(
        entry
      );

    const categories =
      getCategories(
        entry
      );

    const excerpt =
      getExcerpt(
        entry
      );

    console.log(
      ""
    );

    console.log(
      "------------------------------------------------------------"
    );

    console.log(
      `Post ${i + 1}: ${postTitle}`
    );

    console.log(
      `URL: ${postUrl}`
    );

    // --------------------------------------------------------
    // Feed candidates
    // --------------------------------------------------------

    const feedCandidates =
      extractFeedCandidates(
        entry,
        postUrl
      );

    console.log(
      `Feed image candidates: ${feedCandidates.length}`
    );

    // --------------------------------------------------------
    // Article page
    // --------------------------------------------------------

    let pageCandidates = [];

    try {
      const postHtml =
        await fetchText(
          postUrl
        );

      console.log(
        `Article page fetched: ${postHtml.length} bytes`
      );

      pageCandidates =
        extractPageCandidates(
          postHtml,
          postUrl,
          postTitle
        );

      console.log(
        `Page-local image candidates: ${pageCandidates.length}`
      );
    } catch (error) {
      console.log(
        `Article page fetch failed: ${error.message}`
      );
    }

    // --------------------------------------------------------
    // Select only from this post's own candidates.
    // --------------------------------------------------------

    const selected =
      await selectImageForPost(
        {
          title:
            postTitle,
          url:
            postUrl
        },
        feedCandidates,
        pageCandidates,
        i + 1,
        usedFingerprints
      );

    if (!selected) {
      throw new Error(
        `All image candidates were rejected for Post ${i + 1}: ${postTitle}`
      );
    }

    console.log(
      `Selected image: ${selected.localImage}`
    );

    console.log(
      `Selected source: ${selected.imageSource}`
    );

    console.log(
      `Selected URL: ${selected.imageUrl}`
    );

    console.log(
      `Selected bytes: ${selected.imageBytes}`
    );

    posts.push({
      index:
        i + 1,
      title:
        postTitle,
      url:
        postUrl,
      published,
      date:
        published
          ? published.slice(
              0,
              10
            )
          : "",
      excerpt,
      categories,
      localImage:
        selected.localImage,
      imageSource:
        selected.imageSource
    });
  }

  // ----------------------------------------------------------
  // Final duplicate verification
  // ----------------------------------------------------------

  const finalFingerprints =
    new Set();

  const finalHashes =
    new Set();

  for (
    const post
    of posts
  ) {
    const file =
      path.resolve(
        OUTPUT_DIR,
        "..",
        post.localImage
      );

    if (
      !fs.existsSync(
        file
      )
    ) {
      throw new Error(
        `Missing final image: ${file}`
      );
    }

    const stat =
      fs.statSync(
        file
      );

    if (
      stat.size < 5000
    ) {
      throw new Error(
        `Final image is too small: ${file}`
      );
    }

    const hash =
      getFileHash(
        file
      );

    const fingerprint =
      getImageFingerprint(
        file
      );

    if (
      finalHashes.has(
        hash
      )
    ) {
      throw new Error(
        `Exact duplicate final image detected: ${file}`
      );
    }

    if (
      finalFingerprints.has(
        fingerprint
      )
    ) {
      throw new Error(
        `Visual duplicate final image detected: ${file}`
      );
    }

    finalHashes.add(
      hash
    );

    finalFingerprints.add(
      fingerprint
    );
  }

  // ----------------------------------------------------------
  // Site analysis
  // ----------------------------------------------------------

  const analysis =
    buildAnalysis(
      siteTitle,
      description,
      posts
    );

  // ----------------------------------------------------------
  // OG image
  // ----------------------------------------------------------

  let ogImage = "";

  const ogTag =
    blogHtml.match(
      /<meta\b[^>]*(?:property|name)=["']og:image["'][^>]*>/i
    );

  if (ogTag) {
    ogImage =
      absoluteUrl(
        getAttribute(
          ogTag[0],
          "content"
        ),
        blogUrl
      ) || "";
  }

  // ----------------------------------------------------------
  // Final JSON
  // ----------------------------------------------------------

  const data = {
    version: 10,
    capturedAt:
      new Date().toISOString(),
    url:
      blogUrl,
    hostname:
      new URL(
        blogUrl
      ).hostname,
    siteTitle:
      siteTitle,
    description:
      description,
    pageHeading:
      siteTitle,
    ogImage,
    language:
      "en",
    postCount:
      posts.length,
    analysis,
    posts
  };

  const jsonPath =
    path.join(
      OUTPUT_DIR,
      "blog.json"
    );

  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      data,
      null,
      2
    ),
    "utf8"
  );

  console.log(
    ""
  );

  console.log(
    "============================================================"
  );

  console.log(
    "BLOG ANALYZER v10.2 COMPLETE"
  );

  console.log(
    `blog.json: ${jsonPath}`
  );

  console.log(
    `Posts captured: ${posts.length}`
  );

  console.log(
    `Unique final images: ${finalFingerprints.size}`
  );

  console.log(
    "============================================================"
  );
}

main().catch(
  error => {
    console.error(
      ""
    );

    console.error(
      "============================================================"
    );

    console.error(
      "BLOG ANALYZER v10.2 FAILED"
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
