import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// ============================================================
// BLOG ANALYZER v10.3
//
// Fixes:
// 1. ImageMagick 6 / 7 command separation.
// 2. Never use "magick identify".
// 3. Use identify directly for image validation.
// 4. Reject resize-only Blogger URLs.
// 5. Do not globally scrape arbitrary Blogger CDN URLs.
// 6. Prefer current post's feed/body images.
// 7. Avoid unrelated previous-post images.
// 8. Validate Content-Type before ImageMagick.
// 9. Prevent duplicate images between posts.
// 10. Keep existing blog.json / Remotion compatibility.
// ============================================================

const __filename =
  fileURLToPath(import.meta.url);

const __dirname =
  path.dirname(__filename);

const BLOG_URL =
  process.argv[2];

if (!BLOG_URL) {
  console.error(
    "Usage: node scripts/capture-blog.mjs <BLOG_URL>"
  );

  process.exit(1);
}

// ============================================================
// Paths
// ============================================================

const OUTPUT_DIR =
  path.resolve(
    __dirname,
    "../template/public/blog"
  );

const IMAGE_DIR =
  path.join(
    OUTPUT_DIR,
    "images"
  );

fs.rmSync(
  OUTPUT_DIR,
  {
    recursive: true,
    force: true
  }
);

fs.mkdirSync(
  IMAGE_DIR,
  {
    recursive: true
  }
);

// ============================================================
// ImageMagick detection
//
// IMPORTANT:
//
// Ubuntu runner currently has ImageMagick 6.
//
// ImageMagick 6:
//   identify
//   convert
//
// ImageMagick 7:
//   magick identify
//   magick
//
// The workflow creates:
//
//   magick -> convert
//
// Therefore we NEVER execute:
//   magick identify
//
// Instead identifyImage() always uses the real "identify"
// binary when available.
// ============================================================

function commandExists(
  command
) {
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

const HAS_MAGICK =
  commandExists("magick");

const HAS_IDENTIFY =
  commandExists("identify");

const HAS_CONVERT =
  commandExists("convert");

if (
  !HAS_IDENTIFY &&
  !HAS_MAGICK
) {
  console.error(
    "ERROR: ImageMagick identify/magick command was not found."
  );

  process.exit(1);
}

const IDENTIFY_COMMAND =
  HAS_IDENTIFY
    ? "identify"
    : "magick";

const CONVERT_COMMAND =
  HAS_CONVERT
    ? "convert"
    : "magick";

console.log(
  `ImageMagick identify command: ${IDENTIFY_COMMAND}`
);

console.log(
  `ImageMagick convert command: ${CONVERT_COMMAND}`
);

try {
  const version =
    execFileSync(
      IDENTIFY_COMMAND,
      [
        "-version"
      ],
      {
        encoding: "utf8"
      }
    );

  console.log(
    version
      .split("\n")[0]
  );
} catch {
  // ignore
}

// ============================================================
// Helpers
// ============================================================

function sleep(
  ms
) {
  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        ms
      )
  );
}

function normalizeText(
  value
) {
  return String(
    value || ""
  )
    .replace(
      /\s+/g,
      " "
    )
    .trim()
    .toLowerCase();
}

function htmlDecode(
  value
) {
  return String(
    value || ""
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
            parseInt(
              value,
              16
            )
          );
        } catch {
          return _;
        }
      }
    );
}

function stripHtml(
  html
) {
  return htmlDecode(
    String(
      html || ""
    )
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
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

function absoluteUrl(
  rawUrl,
  baseUrl
) {
  if (!rawUrl) {
    return "";
  }

  let value =
    htmlDecode(
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

    if (
      ![
        "http:",
        "https:"
      ].includes(
        url.protocol
      )
    ) {
      return "";
    }

    return url.href;
  } catch {
    return "";
  }
}

// ============================================================
// Blogger URL normalization
// ============================================================

function normalizeBloggerImageUrl(
  rawUrl
) {
  const absolute =
    absoluteUrl(
      rawUrl,
      BLOG_URL
    );

  if (!absolute) {
    return "";
  }

  let url;

  try {
    url =
      new URL(
        absolute
      );
  } catch {
    return "";
  }

  const pathname =
    url.pathname;

  // ----------------------------------------------------------
  // Reject resize-only paths.
  //
  // Examples:
  //
  // /w1200/
  // /h60/
  // /w144-h144-p-k-no-nu/
  // /s72-c/
  //
  // These are NOT complete image URLs.
  // ----------------------------------------------------------

  if (
    /\/(?:w\d+|h\d+|s\d+(?:-c)?|w\d+-h\d+(?:-[^/]*)?)\/$/i.test(
      pathname
    )
  ) {
    return "";
  }

  // ----------------------------------------------------------
  // Blogger resize path with actual filename.
  // ----------------------------------------------------------

  let normalized =
    pathname;

  normalized =
    normalized.replace(
      /\/s\d+(?:-c)?\/([^/]+)$/i,
      "/s1600/$1"
    );

  normalized =
    normalized.replace(
      /\/w\d+-h\d+(?:-[^/]*)?\/([^/]+)$/i,
      "/s1600/$1"
    );

  normalized =
    normalized.replace(
      /\/w\d+\/([^/]+)$/i,
      "/s1600/$1"
    );

  normalized =
    normalized.replace(
      /\/h\d+\/([^/]+)$/i,
      "/s1600/$1"
    );

  // ----------------------------------------------------------
  // Query resize parameters.
  // ----------------------------------------------------------

  normalized =
    normalized.replace(
      /([?&])w=\d+/gi,
      "$1"
    );

  normalized =
    normalized.replace(
      /([?&])h=\d+/gi,
      "$1"
    );

  normalized =
    normalized.replace(
      /([?&])s=\d+/gi,
      "$1"
    );

  // Remove dangling ? / &
  normalized =
    normalized.replace(
      /[?&]+$/,
      ""
    );

  // ----------------------------------------------------------
  // Final safety check.
  // ----------------------------------------------------------

  if (
    /\/(?:w\d+|h\d+|s\d+(?:-c)?|w\d+-h\d+(?:-[^/]*)?)\/$/i.test(
      normalized
    )
  ) {
    return "";
  }

  url.pathname =
    normalized;

  return url.href;
}

// ============================================================
// Image URL validation
// ============================================================

function isObviouslyBadImageUrl(
  url,
  pageUrl = ""
) {
  if (!url) {
    return true;
  }

  const value =
    String(url)
      .trim();

  const lower =
    value.toLowerCase();

  if (
    /^data:/i.test(
      value
    )
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
    /\/(?:w\d+|h\d+|s\d+(?:-c)?|w\d+-h\d+(?:-[^/]*)?)\/$/i.test(
      lower
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

  for (
    const pattern
    of badPatterns
  ) {
    if (
      lower.includes(
        pattern
      )
    ) {
      return true;
    }
  }

  return false;
}

function samePageUrl(
  candidateUrl,
  pageUrl
) {
  if (
    !candidateUrl ||
    !pageUrl
  ) {
    return false;
  }

  try {
    const candidate =
      new URL(
        candidateUrl
      );

    const page =
      new URL(
        pageUrl
      );

    return (
      candidate.origin ===
        page.origin &&
      candidate.pathname ===
        page.pathname
    );
  } catch {
    return false;
  }
}

function isLikelyImageUrl(
  url
) {
  if (!url) {
    return false;
  }

  const lower =
    String(url)
      .toLowerCase();

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
// HTML attribute
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

  if (
    quoted?.[1]
  ) {
    return quoted[1];
  }

  const unquoted =
    tag.match(
      new RegExp(
        `\\b${name}\\s*=\\s*([^\\s>]+)`,
        "i"
      )
    );

  return (
    unquoted?.[1] ||
    ""
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
    of String(srcset)
      .split(",")
  ) {
    const value =
      item.trim();

    if (!value) {
      continue;
    }

    const match =
      value.match(
        /^(.+?)(?:\s+\d+(?:w|x))?$/
      );

    if (!match?.[1]) {
      continue;
    }

    const url =
      absoluteUrl(
        match[1].trim(),
        baseUrl
      );

    if (url) {
      results.push(
        url
      );
    }
  }

  return results;
}

// ============================================================
// Candidate helper
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
// HTML image extraction
//
// IMPORTANT:
//
// We only accept URLs coming from actual HTML attributes.
//
// We DO NOT scan arbitrary:
// blogger.googleusercontent.com
//
// strings in the whole page.
// ============================================================

function extractImagesFromHtml(
  html,
  baseUrl,
  source,
  scoreBonus = 0
) {
  const candidates = [];

  if (!html) {
    return candidates;
  }

  let order = 0;

  function add(
    rawUrl,
    meta = {},
    score = scoreBonus
  ) {
    const absolute =
      absoluteUrl(
        rawUrl,
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

    candidates.push({
      url:
        normalized,
      source,
      score:
        score +
        getContextScore(
          meta
        ) -
        order * 0.5,
      alt:
        meta.alt || "",
      title:
        meta.title || "",
      className:
        meta.className || "",
      id:
        meta.id || ""
    });

    order += 1;
  }

  // ----------------------------------------------------------
  // IMG
  // ----------------------------------------------------------

  const imgRegex =
    /<img\b[^>]*>/gi;

  for (
    const match
    of html.matchAll(
      imgRegex
    )
  ) {
    const tag =
      match[0];

    const meta = {
      alt:
        getAttribute(
          tag,
          "alt"
        ),
      title:
        getAttribute(
          tag,
          "title"
        ),
      className:
        getAttribute(
          tag,
          "class"
        ),
      id:
        getAttribute(
          tag,
          "id"
        )
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
      add(
        src,
        meta,
        scoreBonus + 20
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
        add(
          value,
          meta,
          scoreBonus + 18
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
        const url
        of extractSrcsetUrls(
          value,
          baseUrl
        )
      ) {
        add(
          url,
          meta,
          scoreBonus + 15
        );
      }
    }
  }

  // ----------------------------------------------------------
  // <source srcset>
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
      const url
      of extractSrcsetUrls(
        srcset,
        baseUrl
      )
    ) {
      add(
        url,
        {
          className:
            getAttribute(
              tag,
              "class"
            )
        },
        scoreBonus + 10
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
    add(
      match[1],
      {
        className:
          "background-image"
      },
      scoreBonus
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

    const isImageMeta =
      [
        "og:image",
        "og:image:url",
        "twitter:image",
        "twitter:image:src",
        "image_src"
      ].includes(
        property
      ) ||
      [
        "twitter:image",
        "twitter:image:src",
        "image_src"
      ].includes(
        name
      );

    if (
      isImageMeta &&
      content
    ) {
      add(
        content,
        {
          className:
            "meta-image"
        },
        scoreBonus
      );
    }
  }

  return dedupeCandidates(
    candidates
  );
}

// ============================================================
// Feed helpers
// ============================================================

function feedValue(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  if (
    typeof value ===
    "string"
  ) {
    return value;
  }

  if (
    typeof value ===
    "object"
  ) {
    return (
      value.$t ||
      value["$t"] ||
      ""
    );
  }

  return "";
}

function asArray(
  value
) {
  if (
    Array.isArray(
      value
    )
  ) {
    return value;
  }

  if (
    value &&
    typeof value ===
      "object"
  ) {
    return [value];
  }

  return [];
}

// ============================================================
// Feed image extraction
// ============================================================

function extractFeedCandidates(
  entry,
  postUrl
) {
  const candidates = [];

  // ----------------------------------------------------------
  // media$thumbnail
  // ----------------------------------------------------------

  const thumbnail =
    entry?.[
      "media$thumbnail"
    ];

  if (thumbnail) {
    const url =
      thumbnail.url ||
      thumbnail.src ||
      feedValue(
        thumbnail
      );

    if (url) {
      candidates.push({
        url,
        source:
          "feed-thumbnail",
        score:
          40
      });
    }
  }

  // ----------------------------------------------------------
  // media$group
  // ----------------------------------------------------------

  const mediaGroup =
    entry?.[
      "media$group"
    ];

  if (mediaGroup) {
    const content =
      asArray(
        mediaGroup[
          "media$content"
        ]
      );

    for (
      const media
      of content
    ) {
      const url =
        media?.url ||
        media?.src ||
        feedValue(
          media
        );

      if (url) {
        candidates.push({
          url,
          source:
            "feed-content",
          score:
            50,
          alt:
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
    asArray(
      entry?.[
        "media$content"
      ]
    );

  for (
    const media
    of directMedia
  ) {
    const url =
      media?.url ||
      media?.src ||
      feedValue(
        media
      );

    if (url) {
      candidates.push({
        url,
        source:
          "feed-content",
        score:
          50,
        alt:
          media?.title ||
          ""
      });
    }
  }

  // ----------------------------------------------------------
  // content HTML
  // ----------------------------------------------------------

  const content =
    feedValue(
      entry?.content
    );

  if (content) {
    candidates.push(
      ...extractImagesFromHtml(
        content,
        postUrl,
        "feed-content",
        70
      )
    );
  }

  // ----------------------------------------------------------
  // summary HTML
  // ----------------------------------------------------------

  const summary =
    feedValue(
      entry?.summary
    );

  if (summary) {
    candidates.push(
      ...extractImagesFromHtml(
        summary,
        postUrl,
        "feed-summary",
        40
      )
    );
  }

  const normalized =
    [];

  for (
    const candidate
    of candidates
  ) {
    const url =
      normalizeBloggerImageUrl(
        candidate.url
      );

    if (!url) {
      continue;
    }

    if (
      isObviouslyBadImageUrl(
        url,
        postUrl
      )
    ) {
      continue;
    }

    if (
      !isLikelyImageUrl(
        url
      )
    ) {
      continue;
    }

    normalized.push({
      ...candidate,
      url
    });
  }

  return dedupeCandidates(
    normalized
  );
}

// ============================================================
// Balanced HTML element
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

  let cursor =
    startIndex;

  let depth = 0;

  while (
    cursor <
    html.length
  ) {
    openRegex.lastIndex =
      cursor;

    closeRegex.lastIndex =
      cursor;

    const open =
      openRegex.exec(
        html
      );

    const close =
      closeRegex.exec(
        html
      );

    if (
      !open &&
      !close
    ) {
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

    if (
      depth <= 0
    ) {
      return html.slice(
        startIndex,
        end
      );
    }

    cursor =
      end;
  }

  return "";
}

// ============================================================
// Scoped Blogger post body
//
// IMPORTANT:
//
// Do NOT use generic "hentry" as an image source container.
// Blogger pages can contain multiple hentry/post fragments,
// related posts, archives, etc.
//
// We only use:
//   post-body
//   entry-content
//   post-content
//   article
// ============================================================

function findScopedPostBodies(
  html
) {
  const results = [];

  const classNames = [
    "post-body",
    "entry-content",
    "post-content"
  ];

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

      if (
        !container
      ) {
        continue;
      }

      const imageCount =
        (
          container.match(
            /<img\b/gi
          ) || []
        ).length;

      if (
        imageCount === 0
      ) {
        continue;
      }

      results.push({
        html:
          container,
        score:
          className ===
          "post-body"
            ? 100
            : 90,
        type:
          className
      });
    }
  }

  // ----------------------------------------------------------
  // article
  // ----------------------------------------------------------

  const articleRegex =
    /<article\b[^>]*>/gi;

  for (
    const match
    of html.matchAll(
      articleRegex
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

    if (
      !container
    ) {
      continue;
    }

    const imageCount =
      (
        container.match(
          /<img\b/gi
        ) || []
      ).length;

    if (
      imageCount === 0
    ) {
      continue;
    }

    results.push({
      html:
        container,
      score:
        80,
      type:
        "article"
    });
  }

  return results;
}

// ============================================================
// Page-local candidates
// ============================================================

function extractPageCandidates(
  html,
  pageUrl,
  postTitle
) {
  const candidates = [];

  const scopes =
    findScopedPostBodies(
      html
    );

  console.log(
    `Scoped post containers: ${scopes.length}`
  );

  // ----------------------------------------------------------
  // Prefer post-body over article.
  // ----------------------------------------------------------

  scopes.sort(
    (a, b) =>
      b.score -
      a.score
  );

  const seen =
    new Set();

  for (
    const scope
    of scopes
  ) {
    const key =
      scope.html.slice(
        0,
        500
      );

    if (
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);

    const images =
      extractImagesFromHtml(
        scope.html,
        pageUrl,
        `post-${scope.type}`,
        scope.score
      );

    candidates.push(
      ...images
    );
  }

  // ----------------------------------------------------------
  // Do NOT fall back to page-wide Blogger CDN scanning.
  //
  // Only use OG/Twitter meta if no post-body image exists.
  // ----------------------------------------------------------

  if (
    candidates.length === 0
  ) {
    const metaImages =
      extractImagesFromHtml(
        html,
        pageUrl,
        "post-meta",
        10
      );

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
        redirect:
          "follow",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; BlogAnalyzer/10.3)",
          "Accept":
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
      }
    );

  if (
    !response.ok
  ) {
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
        redirect:
          "follow",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; BlogAnalyzer/10.3)",
          "Accept":
            "application/json,text/plain,*/*"
        }
      }
    );

  if (
    !response.ok
  ) {
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
// ImageMagick identification
//
// THIS IS THE CRITICAL v10.3 FIX.
//
// Never:
//   magick identify file
//
// Use:
//   identify file
//
// on ImageMagick 6.
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
          encoding:
            "utf8",
          stdio: [
            "ignore",
            "pipe",
            "pipe"
          ]
        }
      ).trim();

    if (
      !output
    ) {
      throw new Error(
        "ImageMagick returned empty identification"
      );
    }

    return output;
  } catch (error) {
    throw new Error(
      `ImageMagick could not identify image: ${error.message}`
    );
  }
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
        redirect:
          "follow",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; BlogAnalyzer/10.3)",
          "Accept":
            "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
        }
      }
    );

  if (
    !response.ok
  ) {
    throw new Error(
      `HTTP ${response.status}`
    );
  }

  const contentType =
    String(
      response.headers.get(
        "content-type"
      ) || ""
    )
      .toLowerCase();

  console.log(
    `Content-Type: ${contentType || "unknown"}`
  );

  // ----------------------------------------------------------
  // Reject known non-image responses.
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
    buffer.length <
    5000
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
  // CRITICAL:
  // Direct identify command.
  // ----------------------------------------------------------

  const identified =
    identifyImage(
      outputPath
    );

  console.log(
    `ImageMagick: ${identified}`
  );

  return {
    bytes:
      buffer.length,
    contentType,
    identified
  };
}

// ============================================================
// Convert to JPG
// ============================================================

function convertToJpg(
  sourcePath,
  outputPath
) {
  identifyImage(
    sourcePath
  );

  try {
    execFileSync(
      CONVERT_COMMAND,
      [
        sourcePath,
        "-auto-orient",
        "-strip",
        "-background",
        "white",
        "-alpha",
        "remove",
        "-alpha",
        "off",
        "-quality",
        "90",
        outputPath
      ],
      {
        stdio:
          "ignore"
      }
    );
  } catch (error) {
    throw new Error(
      `ImageMagick conversion failed: ${error.message}`
    );
  }

  if (
    !fs.existsSync(
      outputPath
    )
  ) {
    throw new Error(
      "Converted JPG was not created"
    );
  }

  const stat =
    fs.statSync(
      outputPath
    );

  if (
    stat.size <
    5000
  ) {
    throw new Error(
      `Converted JPG is too small: ${stat.size} bytes`
    );
  }

  identifyImage(
    outputPath
  );

  return stat.size;
}

// ============================================================
// File hash
// ============================================================

function getFileHash(
  filePath
) {
  return crypto
    .createHash(
      "sha256"
    )
    .update(
      fs.readFileSync(
        filePath
      )
    )
    .digest(
      "hex"
    );
}

// ============================================================
// Perceptual fingerprint
// ============================================================

function getImageFingerprint(
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
        tempPath
      ],
      {
        stdio:
          "ignore"
      }
    );

    const buffer =
      fs.readFileSync(
        tempPath
      );

    return crypto
      .createHash(
        "sha256"
      )
      .update(
        buffer
      )
      .digest(
        "hex"
      );
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
// Context score
// ============================================================

function getContextScore(
  meta = {}
) {
  const text =
    [
      meta.alt,
      meta.title,
      meta.className,
      meta.id
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

  let score = 0;

  if (
    text.includes(
      "hero"
    )
  ) {
    score += 25;
  }

  if (
    text.includes(
      "featured"
    )
  ) {
    score += 20;
  }

  if (
    text.includes(
      "cover"
    )
  ) {
    score += 15;
  }

  if (
    text.includes(
      "post-body"
    )
  ) {
    score += 20;
  }

  if (
    text.includes(
      "entry-content"
    )
  ) {
    score += 20;
  }

  if (
    text.includes(
      "post-content"
    )
  ) {
    score += 20;
  }

  if (
    text.includes(
      "logo"
    )
  ) {
    score -= 100;
  }

  if (
    text.includes(
      "avatar"
    )
  ) {
    score -= 100;
  }

  if (
    text.includes(
      "icon"
    )
  ) {
    score -= 60;
  }

  if (
    text.includes(
      "sidebar"
    )
  ) {
    score -= 80;
  }

  if (
    text.includes(
      "related"
    )
  ) {
    score -= 50;
  }

  if (
    text.includes(
      "footer"
    )
  ) {
    score -= 70;
  }

  return score;
}

// ============================================================
// Title / image text score
// ============================================================

function getTitleImageScore(
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
    !titleWords.length
  ) {
    return 0;
  }

  const imageText =
    normalizeText(
      [
        candidate.alt,
        candidate.title
      ]
        .filter(Boolean)
        .join(" ")
    );

  if (
    !imageText
  ) {
    return 0;
  }

  let matches =
    0;

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
// Evaluate candidate
// ============================================================

async function evaluateCandidate(
  candidate,
  postIndex
) {
  const tempSource =
    path.join(
      IMAGE_DIR,
      `.candidate-${postIndex}-${crypto.randomUUID()}.source`
    );

  const tempJpg =
    path.join(
      IMAGE_DIR,
      `.candidate-${postIndex}-${crypto.randomUUID()}.jpg`
    );

  try {
    await downloadImage(
      candidate.url,
      tempSource
    );

    convertToJpg(
      tempSource,
      tempJpg
    );

    const sourceHash =
      getFileHash(
        tempJpg
      );

    const fingerprint =
      getImageFingerprint(
        tempJpg
      );

    return {
      ...candidate,
      tempPath:
        tempJpg,
      sourceHash,
      fingerprint
    };
  } catch (error) {
    console.log(
      `Rejected: ${error.message}`
    );

    try {
      fs.unlinkSync(
        tempSource
      );
    } catch {
      // ignore
    }

    try {
      fs.unlinkSync(
        tempJpg
      );
    } catch {
      // ignore
    }

    return null;
  }
}

// ============================================================
// Select image
// ============================================================

async function selectImageForPost(
  post,
  feedCandidates,
  pageCandidates,
  postIndex,
  usedFingerprints
) {
  const candidates =
    dedupeCandidates([
      ...feedCandidates,
      ...pageCandidates
    ]);

  const scored =
    candidates.map(
      candidate => ({
        ...candidate,
        score:
          Number(
            candidate.score ||
              0
          ) +
          getTitleImageScore(
            post.title,
            candidate
          )
      })
    );

  scored.sort(
    (a, b) =>
      b.score -
      a.score
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

    const filename =
      `post-${postIndex}.jpg`;

    const finalPath =
      path.join(
        IMAGE_DIR,
        filename
      );

    fs.renameSync(
      evaluated.tempPath,
      finalPath
    );

    return {
      localImage:
        `blog/images/${filename}`,
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
// Entry metadata
// ============================================================

function getEntryTitle(
  entry
) {
  return feedValue(
    entry?.title
  ).trim();
}

function getEntryUrl(
  entry,
  fallback
) {
  const links =
    Array.isArray(
      entry?.link
    )
      ? entry.link
      : [];

  const alternate =
    links.find(
      item =>
        item?.rel ===
        "alternate" &&
        item?.href
    );

  if (
    alternate?.href
  ) {
    return alternate.href;
  }

  return fallback;
}

function getEntryPublished(
  entry
) {
  return (
    feedValue(
      entry?.published
    ) ||
    feedValue(
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
        feedValue(
          item
        )
    )
    .filter(Boolean);
}

function getExcerpt(
  entry
) {
  const summary =
    feedValue(
      entry?.summary
    );

  const content =
    feedValue(
      entry?.content
    );

  return stripHtml(
    summary ||
      content
  ).slice(
    0,
    320
  );
}

// ============================================================
// Analysis
// ============================================================

function buildAnalysis(
  siteTitle,
  description,
  posts
) {
  const frequencies =
    new Map();

  for (
    const post
    of posts
  ) {
    const words =
      normalizeText(
        `${post.title} ${post.excerpt}`
      )
        .split(/\s+/)
        .filter(
          word =>
            word.length >= 5
        );

    for (
      const word
      of words
    ) {
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
        ].includes(
          word
        )
      ) {
        continue;
      }

      frequencies.set(
        word,
        (
          frequencies.get(
            word
          ) || 0
        ) + 1
      );
    }
  }

  const topics =
    Array.from(
      frequencies.entries()
    )
      .sort(
        (a, b) =>
          b[1] -
          a[1]
      )
      .slice(
        0,
        6
      )
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
        : [
            "INSIGHTS"
          ],
    audience:
      "Readers looking for practical information, analysis, and useful insights.",
    contentStyle:
      "Focused articles built around current topics, explanations, and practical information.",
    valueProposition:
      "Clear, useful information presented in an accessible format."
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
    "BLOG ANALYZER v10.3"
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
  // Main blog page
  // ----------------------------------------------------------

  console.log(
    "Fetching blog page..."
  );

  let blogHtml =
    "";

  try {
    blogHtml =
      await fetchText(
        BLOG_URL
      );

    console.log(
      `Blog page fetched: ${blogHtml.length} bytes`
    );
  } catch (error) {
    console.log(
      `Home page fetch warning: ${error.message}`
    );
  }

  // ----------------------------------------------------------
  // Site metadata
  // ----------------------------------------------------------

  const titleMatch =
    blogHtml.match(
      /<title[^>]*>([\s\S]*?)<\/title>/i
    );

  const siteTitle =
    stripHtml(
      titleMatch?.[1] ||
      new URL(
        BLOG_URL
      ).hostname
    );

  let description =
    "";

  const descriptionMeta =
    blogHtml.match(
      /<meta\b[^>]*(?:name|property)=["'](?:description|og:description)["'][^>]*>/i
    );

  if (
    descriptionMeta
  ) {
    description =
      getAttribute(
        descriptionMeta[0],
        "content"
      );
  }

  // ----------------------------------------------------------
  // Feed
  // ----------------------------------------------------------

  const feedUrl =
    buildFeedUrl(
      BLOG_URL
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
    throw new Error(
      `Unable to fetch Blogger feed: ${error.message}`
    );
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
    entries.length <
    5
  ) {
    throw new Error(
      `Expected at least 5 posts, got ${entries.length}`
    );
  }

  // ----------------------------------------------------------
  // Posts
  // ----------------------------------------------------------

  const posts =
    [];

  const usedFingerprints =
    new Set();

  for (
    let index = 0;
    index < 5;
    index += 1
  ) {
    const entry =
      entries[index];

    const title =
      getEntryTitle(
        entry
      );

    const postUrl =
      getEntryUrl(
        entry,
        BLOG_URL
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
      `Post ${index + 1}: ${title}`
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

    let pageCandidates =
      [];

    try {
      const articleHtml =
        await fetchText(
          postUrl
        );

      console.log(
        `Article page fetched: ${articleHtml.length} bytes`
      );

      pageCandidates =
        extractPageCandidates(
          articleHtml,
          postUrl,
          title
        );

      console.log(
        `Page-local image candidates: ${pageCandidates.length}`
      );
    } catch (error) {
      console.log(
        `Article page warning: ${error.message}`
      );
    }

    // --------------------------------------------------------
    // Select image
    // --------------------------------------------------------

    const selected =
      await selectImageForPost(
        {
          title,
          url:
            postUrl
        },
        feedCandidates,
        pageCandidates,
        index + 1,
        usedFingerprints
      );

    if (!selected) {
      throw new Error(
        `All image candidates were rejected for Post ${index + 1}: ${title}`
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
        index + 1,
      title,
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

    // Small delay to avoid hammering Blogger.
    await sleep(
      250
    );
  }

  // ==========================================================
  // Final validation
  // ==========================================================

  const finalHashes =
    new Set();

  const finalFingerprints =
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
      stat.size <
      5000
    ) {
      throw new Error(
        `Final image too small: ${file}`
      );
    }

    identifyImage(
      file
    );

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
        `Exact duplicate image detected: ${file}`
      );
    }

    if (
      finalFingerprints.has(
        fingerprint
      )
    ) {
      throw new Error(
        `Visual duplicate image detected: ${file}`
      );
    }

    finalHashes.add(
      hash
    );

    finalFingerprints.add(
      fingerprint
    );
  }

  // ==========================================================
  // OG image
  // ==========================================================

  let ogImage =
    "";

  const ogTag =
    blogHtml.match(
      /<meta\b[^>]*(?:property|name)=["']og:image["'][^>]*>/i
    );

  if (
    ogTag
  ) {
    ogImage =
      absoluteUrl(
        getAttribute(
          ogTag[0],
          "content"
        ),
        BLOG_URL
      );
  }

  // ==========================================================
  // Final JSON
  // ==========================================================

  const data = {
    version:
      10.3,
    capturedAt:
      new Date().toISOString(),
    url:
      BLOG_URL,
    hostname:
      new URL(
        BLOG_URL
      ).hostname,
    siteTitle,
    description,
    pageHeading:
      siteTitle,
    ogImage,
    language:
      "en",
    postCount:
      posts.length,
    analysis:
      buildAnalysis(
        siteTitle,
        description,
        posts
      ),
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
    "BLOG ANALYZER v10.3 COMPLETE"
  );

  console.log(
    `blog.json: ${jsonPath}`
  );

  console.log(
    `Posts captured: ${posts.length}`
  );

  console.log(
    `Unique images: ${finalFingerprints.size}`
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
      "BLOG ANALYZER v10.3 FAILED"
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
