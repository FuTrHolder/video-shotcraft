import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// ============================================================
// BLOG ANALYZER v10.1
// ============================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BLOG_URL = process.argv[2];

if (!BLOG_URL) {
  console.error("Usage: node scripts/capture-blog.mjs <BLOG_URL>");
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
// ImageMagick detection
// ============================================================

function findImageMagick() {
  const candidates = [
    "magick",
    "convert"
  ];

  for (const command of candidates) {
    try {
      execFileSync(
        command,
        ["-version"],
        {
          stdio: "ignore"
        }
      );

      return command;
    } catch {
      // continue
    }
  }

  return null;
}

const IMAGE_MAGICK =
  findImageMagick();

if (!IMAGE_MAGICK) {
  console.error(
    "ERROR: ImageMagick was not found."
  );

  console.error(
    "Expected either 'magick' or 'convert'."
  );

  process.exit(1);
}

console.log(
  `ImageMagick command: ${IMAGE_MAGICK}`
);

try {
  const version =
    execFileSync(
      IMAGE_MAGICK,
      ["-version"],
      {
        encoding: "utf8"
      }
    );

  console.log(
    version.split("\n")[0]
  );
} catch {
  // ignore
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
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003d/gi, "=")
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
  url,
  baseUrl
) {
  if (!url) {
    return null;
  }

  let value =
    htmlDecode(
      String(url)
        .trim()
        .replace(/^['"]|['"]$/g, "")
    );

  if (!value) {
    return null;
  }

  if (
    value.startsWith("//")
  ) {
    value =
      "https:" + value;
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

// ============================================================
// URL helpers
// ============================================================

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

function normalizeImageUrl(url) {
  if (!url) {
    return null;
  }

  let value =
    htmlDecode(
      String(url).trim()
    );

  if (!value) {
    return null;
  }

  if (
    value.startsWith("//")
  ) {
    value =
      "https:" + value;
  }

  try {
    const parsed =
      new URL(value);

    // Blogger image resizing
    parsed.pathname =
      parsed.pathname
        .replace(
          /\/s\d+(?:-c)?\//i,
          "/s1600/"
        )
        .replace(
          /\/w\d+-h\d+(?:-p)?\//i,
          "/s1600/"
        )
        .replace(
          /\/s\d+-c\//i,
          "/s1600/"
        )
        .replace(
          /\/s\d+\//i,
          "/s1600/"
        );

    return parsed.href;
  } catch {
    return null;
  }
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

  // Data URI
  if (
    /^data:/i.test(value)
  ) {
    return true;
  }

  // Current page itself
  if (
    pageUrl &&
    samePageUrl(
      value,
      pageUrl
    )
  ) {
    return true;
  }

  // HTML pages
  if (
    /\.html?(?:[?#]|$)/i.test(
      lower
    )
  ) {
    return true;
  }

  // JSON / XML endpoints
  if (
    /\.json(?:[?#]|$)/i.test(
      lower
    ) ||
    /\.xml(?:[?#]|$)/i.test(
      lower
    )
  ) {
    return true;
  }

  // Obvious non-content assets
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
    "blank.gif"
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
      ".bp.blogspot.com/"
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

  if (
    text.includes("hero")
  ) {
    score += 25;
  }

  if (
    text.includes("featured")
  ) {
    score += 20;
  }

  if (
    text.includes("thumbnail")
  ) {
    score += 5;
  }

  if (
    text.includes("cover")
  ) {
    score += 10;
  }

  if (
    text.includes("article")
  ) {
    score += 8;
  }

  if (
    text.includes("post-body")
  ) {
    score += 15;
  }

  if (
    text.includes("entry-content")
  ) {
    score += 15;
  }

  if (
    text.includes("image")
  ) {
    score += 3;
  }

  if (
    text.includes("logo")
  ) {
    score -= 60;
  }

  if (
    text.includes("avatar")
  ) {
    score -= 60;
  }

  if (
    text.includes("icon")
  ) {
    score -= 40;
  }

  if (
    text.includes("social")
  ) {
    score -= 30;
  }

  if (
    text.includes("related")
  ) {
    score -= 25;
  }

  if (
    text.includes("sidebar")
  ) {
    score -= 40;
  }

  if (
    text.includes("footer")
  ) {
    score -= 40;
  }

  if (
    text.includes("header")
  ) {
    score -= 25;
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
      .map(
        x => x.trim()
      )
      .filter(Boolean);

  for (
    const part
    of parts
  ) {
    const pieces =
      part.split(/\s+/);

    const rawUrl =
      pieces[0];

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
// Generic HTML image extraction
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
          .replace(
            /^['"]|['"]$/g,
            ""
          )
      );

    if (!cleaned) {
      return;
    }

    // Remove common trailing HTML characters
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
      normalizeImageUrl(
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

    const contextScore =
      getContextScore(meta);

    candidates.push({
      url: normalized,
      source,
      order: order++,
      score:
        extraScore +
        contextScore -
        Math.min(order, 30) * 1.5,
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

  // ==========================================================
  // IMG
  // ==========================================================

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

    const src =
      tag.match(
        /\bsrc\s*=\s*["']([^"']+)["']/i
      )?.[1] ||
      tag.match(
        /\bsrc\s*=\s*([^\s>]+)/i
      )?.[1];

    const lazyAttributes = [
      "data-src",
      "data-original",
      "data-lazy-src",
      "data-lazy",
      "data-image",
      "data-image-url",
      "data-url"
    ];

    const lazyUrls = [];

    for (
      const attribute
      of lazyAttributes
    ) {
      const match =
        tag.match(
          new RegExp(
            `\\b${attribute}\\s*=\\s*["']([^"']+)["']`,
            "i"
          )
        );

      if (
        match?.[1]
      ) {
        lazyUrls.push(
          match[1]
        );
      }
    }

    const srcset =
      tag.match(
        /\bsrcset\s*=\s*["']([^"']+)["']/i
      )?.[1] ||
      tag.match(
        /\bdata-srcset\s*=\s*["']([^"']+)["']/i
      )?.[1];

    const alt =
      tag.match(
        /\balt\s*=\s*["']([^"']*)["']/i
      )?.[1] || "";

    const title =
      tag.match(
        /\btitle\s*=\s*["']([^"']*)["']/i
      )?.[1] || "";

    const className =
      tag.match(
        /\bclass\s*=\s*["']([^"']*)["']/i
      )?.[1] || "";

    const id =
      tag.match(
        /\bid\s*=\s*["']([^"']*)["']/i
      )?.[1] || "";

    const meta = {
      alt,
      title,
      className,
      id
    };

    if (src) {
      addCandidate(
        src,
        meta
      );
    }

    for (
      const lazyUrl
      of lazyUrls
    ) {
      addCandidate(
        lazyUrl,
        meta
      );
    }

    if (srcset) {
      for (
        const url
        of extractSrcsetUrls(
          srcset,
          baseUrl
        )
      ) {
        addCandidate(
          url,
          meta
        );
      }
    }
  }

  // ==========================================================
  // SOURCE
  // ==========================================================

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

    const src =
      tag.match(
        /\bsrc\s*=\s*["']([^"']+)["']/i
      )?.[1];

    const srcset =
      tag.match(
        /\bsrcset\s*=\s*["']([^"']+)["']/i
      )?.[1];

    if (src) {
      addCandidate(
        src,
        {
          className:
            "source"
        }
      );
    }

    if (srcset) {
      for (
        const url
        of extractSrcsetUrls(
          srcset,
          baseUrl
        )
      ) {
        addCandidate(
          url,
          {
            className:
              "source"
          }
        );
      }
    }
  }

  // ==========================================================
  // META OG IMAGE
  // ==========================================================

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
      tag.match(
        /\bproperty\s*=\s*["']([^"']+)["']/i
      )?.[1] ||
      tag.match(
        /\bname\s*=\s*["']([^"']+)["']/i
      )?.[1] ||
      "";

    const content =
      tag.match(
        /\bcontent\s*=\s*["']([^"']+)["']/i
      )?.[1] || "";

    const key =
      property.toLowerCase();

    if (
      key === "og:image"
    ) {
      addCandidate(
        content,
        {
          className:
            "og-image"
        }
      );
    }

    if (
      key === "twitter:image" ||
      key === "twitter:image:src"
    ) {
      addCandidate(
        content,
        {
          className:
            "twitter-image"
        }
      );
    }

    if (
      key === "image_src"
    ) {
      addCandidate(
        content,
        {
          className:
            "image-src"
        }
      );
    }
  }

  // ==========================================================
  // CSS background image
  // ==========================================================

  const bgRegex =
    /background(?:-image)?\s*:\s*[^;{}]*url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;

  for (
    const match
    of html.matchAll(
      bgRegex
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

  // ==========================================================
  // data-* outside img
  // ==========================================================

  const dataRegex =
    /\b(?:data-image|data-image-url|data-original|data-src|data-lazy-src|data-url)\s*=\s*["']([^"']+)["']/gi;

  for (
    const match
    of html.matchAll(
      dataRegex
    )
  ) {
    addCandidate(
      match[1],
      {
        className:
          "data-image"
      }
    );
  }

  return dedupeCandidates(
    candidates
  );
}

// ============================================================
// Direct Blogger CDN extraction
// ============================================================

function extractBloggerImageUrls(
  html,
  baseUrl
) {
  const candidates = [];

  if (!html) {
    return candidates;
  }

  const patterns = [

    // Blogger Googleusercontent
    /https?:\/\/blogger\.googleusercontent\.com\/img\/[^"'<>\\\s)]+/gi,

    // bp.blogspot.com
    /https?:\/\/[^"'<>\\\s]+\.bp\.blogspot\.com\/[^"'<>\\\s)]+/gi,

    // protocol-relative Googleusercontent
    /\/\/blogger\.googleusercontent\.com\/img\/[^"'<>\\\s)]+/gi,

    // generic image extension
    /https?:\/\/[^"'<>\\\s)]+\.(?:jpg|jpeg|png|webp|gif|avif)(?:\?[^"'<>\\\s)]*)?/gi
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
      let rawUrl =
        match[0];

      rawUrl =
        htmlDecode(
          rawUrl
        )
          .replace(
            /[),.;]+$/g,
            ""
          )
          .replace(
            /\\u0026/gi,
            "&"
          );

      const absolute =
        absoluteUrl(
          rawUrl,
          baseUrl
        );

      if (!absolute) {
        continue;
      }

      const normalized =
        normalizeImageUrl(
          absolute
        );

      if (!normalized) {
        continue;
      }

      if (
        isObviouslyBadImageUrl(
          normalized,
          baseUrl
        )
      ) {
        continue;
      }

      if (
        !isLikelyImageUrl(
          normalized
        )
      ) {
        continue;
      }

      candidates.push({
        url: normalized,
        source:
          "blogger-image",
        order:
          candidates.length,
        score: 150
      });
    }
  }

  return dedupeCandidates(
    candidates
  );
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
      normalizeImageUrl(
        candidate.url
      );

    if (!normalized) {
      continue;
    }

    const key =
      normalized
        .replace(
          /[?#].*$/,
          ""
        )
        .toLowerCase();

    if (
      !map.has(key)
    ) {
      map.set(
        key,
        {
          ...candidate,
          url: normalized
        }
      );

      continue;
    }

    const existing =
      map.get(key);

    if (
      candidate.score >
      existing.score
    ) {
      map.set(
        key,
        {
          ...candidate,
          url: normalized
        }
      );
    }
  }

  return [
    ...map.values()
  ].sort(
    (a, b) => {
      if (
        b.score !==
        a.score
      ) {
        return (
          b.score -
          a.score
        );
      }

      return (
        a.order -
        b.order
      );
    }
  );
}

// ============================================================
// Feed candidate extraction
// ============================================================

function extractFeedCandidates(
  entry,
  postUrl
) {
  const candidates = [];

  // ----------------------------------------------------------
  // Content
  // ----------------------------------------------------------

  let contentHtml = "";

  if (
    typeof entry?.content ===
    "string"
  ) {
    contentHtml =
      entry.content;
  } else {
    contentHtml =
      entry?.content?.$t ||
      entry?.content?.["$t"] ||
      "";
  }

  if (contentHtml) {
    candidates.push(
      ...extractImagesFromHtml(
        contentHtml,
        postUrl,
        "feed-content",
        120
      )
    );
  }

  // ----------------------------------------------------------
  // Summary
  // ----------------------------------------------------------

  let summaryHtml = "";

  if (
    typeof entry?.summary ===
    "string"
  ) {
    summaryHtml =
      entry.summary;
  } else {
    summaryHtml =
      entry?.summary?.$t ||
      entry?.summary?.["$t"] ||
      "";
  }

  if (summaryHtml) {
    candidates.push(
      ...extractImagesFromHtml(
        summaryHtml,
        postUrl,
        "feed-summary",
        90
      )
    );
  }

  // ----------------------------------------------------------
  // media$group
  // ----------------------------------------------------------

  const mediaGroup =
    entry?.["media$group"] ||
    entry?.media$group ||
    null;

  if (mediaGroup) {
    let mediaContent =
      mediaGroup?.[
        "media$content"
      ] ||
      mediaGroup?.media$content ||
      [];

    if (
      !Array.isArray(
        mediaContent
      )
    ) {
      mediaContent = [
        mediaContent
      ];
    }

    for (
      const item
      of mediaContent
    ) {
      if (!item) {
        continue;
      }

      const url =
        item.url ||
        item.src ||
        item["$t"] ||
        null;

      if (!url) {
        continue;
      }

      const absolute =
        absoluteUrl(
          url,
          postUrl
        );

      const normalized =
        normalizeImageUrl(
          absolute
        );

      if (
        !normalized ||
        isObviouslyBadImageUrl(
          normalized,
          postUrl
        )
      ) {
        continue;
      }

      candidates.push({
        url: normalized,
        source:
          "feed-media",
        order:
          candidates.length,
        score: 80
      });
    }
  }

  // ----------------------------------------------------------
  // media$thumbnail
  // ----------------------------------------------------------

  const thumbnail =
    entry?.[
      "media$thumbnail"
    ] ||
    entry?.media$thumbnail ||
    null;

  if (thumbnail) {
    const thumbnailUrl =
      thumbnail.url ||
      thumbnail.src ||
      thumbnail["$t"] ||
      null;

    if (thumbnailUrl) {
      const absolute =
        absoluteUrl(
          thumbnailUrl,
          postUrl
        );

      const normalized =
        normalizeImageUrl(
          absolute
        );

      if (
        normalized &&
        !isObviouslyBadImageUrl(
          normalized,
          postUrl
        )
      ) {
        candidates.push({
          url: normalized,
          source:
            "feed-thumbnail",
          order:
            candidates.length,
          score: 60
        });
      }
    }
  }

  // ----------------------------------------------------------
  // Direct media$content
  // ----------------------------------------------------------

  let directMedia =
    entry?.[
      "media$content"
    ] ||
    entry?.media$content ||
    null;

  if (directMedia) {
    if (
      !Array.isArray(
        directMedia
      )
    ) {
      directMedia = [
        directMedia
      ];
    }

    for (
      const item
      of directMedia
    ) {
      const url =
        item?.url ||
        item?.src ||
        item?.["$t"];

      if (!url) {
        continue;
      }

      const absolute =
        absoluteUrl(
          url,
          postUrl
        );

      const normalized =
        normalizeImageUrl(
          absolute
        );

      if (
        !normalized ||
        isObviouslyBadImageUrl(
          normalized,
          postUrl
        )
      ) {
        continue;
      }

      candidates.push({
        url: normalized,
        source:
          "feed-direct-media",
        order:
          candidates.length,
        score: 75
      });
    }
  }

  return dedupeCandidates(
    candidates
  );
}

// ============================================================
// Balanced element extraction
// ============================================================

function extractBalancedElement(
  html,
  openingIndex,
  tagName
) {
  const tagRegex =
    new RegExp(
      `<\\/?${tagName}\\b[^>]*>`,
      "gi"
    );

  tagRegex.lastIndex =
    openingIndex;

  let depth = 0;
  let started = false;

  let match;

  while (
    (match =
      tagRegex.exec(html))
  ) {
    const tag =
      match[0];

    const isClosing =
      /^<\//.test(tag);

    const isSelfClosing =
      /\/>$/.test(tag);

    if (!isClosing) {
      depth++;
      started = true;

      if (
        isSelfClosing
      ) {
        depth--;
      }
    } else {
      depth--;
    }

    if (
      started &&
      depth === 0
    ) {
      return html.slice(
        openingIndex,
        tagRegex.lastIndex
      );
    }
  }

  return null;
}

// ============================================================
// Blogger post containers
// ============================================================

function findPostContainers(
  html
) {
  const containers = [];

  // ----------------------------------------------------------
  // ARTICLE
  // ----------------------------------------------------------

  const articleRegex =
    /<article\b[^>]*>/gi;

  for (
    const match
    of html.matchAll(
      articleRegex
    )
  ) {
    const block =
      extractBalancedElement(
        html,
        match.index,
        "article"
      );

    if (block) {
      containers.push({
        html: block,
        type: "article"
      });
    }
  }

  // ----------------------------------------------------------
  // Blogger DIV containers
  // ----------------------------------------------------------

  const divRegex =
    /<div\b[^>]*>/gi;

  for (
    const match
    of html.matchAll(
      divRegex
    )
  ) {
    const tag =
      match[0];

    const className =
      tag.match(
        /\bclass\s*=\s*["']([^"']+)["']/i
      )?.[1] || "";

    const id =
      tag.match(
        /\bid\s*=\s*["']([^"']+)["']/i
      )?.[1] || "";

    const marker =
      `${className} ${id}`
        .toLowerCase();

    const isPostContainer =
      marker.includes(
        "post-body"
      ) ||
      marker.includes(
        "entry-content"
      ) ||
      marker.includes(
        "post-content"
      ) ||
      marker.includes(
        "postbody"
      ) ||
      marker.includes(
        "post hentry"
      ) ||
      marker.includes(
        "post-hentry"
      ) ||
      marker.includes(
        "blog-post"
      ) ||
      marker.includes(
        "hentry"
      );

    if (
      !isPostContainer
    ) {
      continue;
    }

    const block =
      extractBalancedElement(
        html,
        match.index,
        "div"
      );

    if (block) {
      containers.push({
        html: block,
        type:
          "blogger-container"
      });
    }
  }

  return containers;
}

// ============================================================
// Extract page candidates
// ============================================================

function extractPageCandidates(
  html,
  postUrl,
  title
) {
  if (!html) {
    return [];
  }

  const allCandidates = [];

  // ==========================================================
  // 1. Find title-specific containers FIRST
  // ==========================================================

  const containers =
    findPostContainers(
      html
    );

  const normalizedTitle =
    normalizeText(title);

  const titleContainers =
    [];

  for (
    const container
    of containers
  ) {
    const text =
      normalizeText(
        stripHtml(
          container.html
        )
      );

    if (!text) {
      continue;
    }

    if (
      text.includes(
        normalizedTitle
      )
    ) {
      titleContainers.push(
        container
      );

      continue;
    }

    const titleWords =
      normalizedTitle
        .split(/\s+/)
        .filter(
          word =>
            word.length > 3
        );

    let matched =
      0;

    for (
      const word
      of titleWords
    ) {
      if (
        text.includes(word)
      ) {
        matched++;
      }
    }

    if (
      titleWords.length >= 3 &&
      matched >=
        Math.ceil(
          titleWords.length *
          0.65
        )
    ) {
      titleContainers.push(
        container
      );
    }
  }

  // ==========================================================
  // 2. Extract images ONLY from title-specific containers
  // ==========================================================

  for (
    const container
    of titleContainers
  ) {
    const candidates =
      extractImagesFromHtml(
        container.html,
        postUrl,
        "post-body",
        140
      );

    allCandidates.push(
      ...candidates
    );

    const bloggerCandidates =
      extractBloggerImageUrls(
        container.html,
        postUrl
      );

    for (
      const candidate
      of bloggerCandidates
    ) {
      candidate.score += 50;
    }

    allCandidates.push(
      ...bloggerCandidates
    );
  }

  // ==========================================================
  // 3. If title containers failed, use post-body containers
  // ==========================================================

  if (
    allCandidates.length === 0
  ) {
    for (
      const container
      of containers
    ) {
      const candidates =
        extractImagesFromHtml(
          container.html,
          postUrl,
          "post-container",
          100
        );

      allCandidates.push(
        ...candidates
      );

      const bloggerCandidates =
        extractBloggerImageUrls(
          container.html,
          postUrl
        );

      for (
        const candidate
        of bloggerCandidates
      ) {
        candidate.score += 30;
      }

      allCandidates.push(
        ...bloggerCandidates
      );
    }
  }

  // ==========================================================
  // 4. Search around exact title
  // ==========================================================

  if (
    allCandidates.length === 0 &&
    normalizedTitle
  ) {
    const rawText =
      normalizeText(html);

    const titleIndex =
      rawText.indexOf(
        normalizedTitle
      );

    if (
      titleIndex >= 0
    ) {
      const start =
        Math.max(
          0,
          titleIndex - 10000
        );

      const end =
        Math.min(
          html.length,
          titleIndex + 120000
        );

      const windowHtml =
        html.slice(
          start,
          end
        );

      allCandidates.push(
        ...extractImagesFromHtml(
          windowHtml,
          postUrl,
          "post-title-window",
          80
        )
      );

      const bloggerCandidates =
        extractBloggerImageUrls(
          windowHtml,
          postUrl
        );

      for (
        const candidate
        of bloggerCandidates
      ) {
        candidate.score += 40;
      }

      allCandidates.push(
        ...bloggerCandidates
      );
    }
  }

  // ==========================================================
  // 5. Direct Blogger CDN extraction from THIS post page
  // ==========================================================

  const directCandidates =
    extractBloggerImageUrls(
      html,
      postUrl
    );

  for (
    const candidate
    of directCandidates
  ) {
    candidate.score +=
      titleContainers.length > 0
        ? 10
        : 0;
  }

  allCandidates.push(
    ...directCandidates
  );

  // ==========================================================
  // 6. Generic page fallback
  // ==========================================================

  if (
    allCandidates.length === 0
  ) {
    allCandidates.push(
      ...extractImagesFromHtml(
        html,
        postUrl,
        "post-page",
        20
      )
    );
  }

  // ==========================================================
  // 7. Final hard filtering
  // ==========================================================

  return dedupeCandidates(
    allCandidates
  ).filter(
    candidate => {
      if (
        !candidate?.url
      ) {
        return false;
      }

      if (
        isObviouslyBadImageUrl(
          candidate.url,
          postUrl
        )
      ) {
        return false;
      }

      if (
        samePageUrl(
          candidate.url,
          postUrl
        )
      ) {
        return false;
      }

      return true;
    }
  );
}

// ============================================================
// Fetch text
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
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",

          "Accept":
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

          "Accept-Language":
            "en-US,en;q=0.9"
        }
      }
    );

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText}`
    );
  }

  return await response.text();
}

// ============================================================
// Download image
// ============================================================

async function downloadImage(
  url,
  outputFile,
  referer
) {
  const response =
    await fetch(
      url,
      {
        redirect:
          "follow",

        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",

          "Accept":
            "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",

          "Referer":
            referer ||
            BLOG_URL
        }
      }
    );

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText}`
    );
  }

  const contentType =
    response.headers.get(
      "content-type"
    ) || "";

  if (
    /text\/html/i.test(
      contentType
    ) ||
    /application\/json/i.test(
      contentType
    ) ||
    /application\/xml/i.test(
      contentType
    )
  ) {
    throw new Error(
      `URL returned non-image content-type: ${contentType}`
    );
  }

  const buffer =
    Buffer.from(
      await response.arrayBuffer()
    );

  if (
    buffer.length < 1000
  ) {
    throw new Error(
      `Downloaded file too small: ${buffer.length} bytes`
    );
  }

  fs.writeFileSync(
    outputFile,
    buffer
  );

  return buffer.length;
}

// ============================================================
// ImageMagick helpers
// ============================================================

function runImageMagick(
  args,
  options = {}
) {
  return execFileSync(
    IMAGE_MAGICK,
    args,
    {
      stdio:
        options.stdio ||
        "pipe"
    }
  );
}

function identifyImage(
  file
) {
  try {
    const output =
      runImageMagick(
        [
          "identify",
          "-format",
          "%w %h %m",
          file
        ],
        {
          stdio: "pipe"
        }
      )
        .toString("utf8")
        .trim();

    const [
      width,
      height,
      format
    ] =
      output.split(
        /\s+/
      );

    if (
      !width ||
      !height ||
      !format
    ) {
      return null;
    }

    return {
      width:
        Number(width),

      height:
        Number(height),

      format
    };
  } catch {
    try {
      const output =
        runImageMagick(
          [
            "-format",
            "%w %h %m",
            file
          ],
          {
            stdio: "pipe"
          }
        )
          .toString("utf8")
          .trim();

      const [
        width,
        height,
        format
      ] =
        output.split(
          /\s+/
        );

      if (
        !width ||
        !height ||
        !format
      ) {
        return null;
      }

      return {
        width:
          Number(width),

        height:
          Number(height),

        format
      };
    } catch {
      return null;
    }
  }
}

// ============================================================
// Convert to JPG
// ============================================================

function convertToJpeg(
  inputFile,
  outputFile
) {
  try {
    runImageMagick(
      [
        inputFile,

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

        outputFile
      ],
      {
        stdio:
          "ignore"
      }
    );

    return true;
  } catch (
    error
  ) {
    console.error(
      "ImageMagick conversion failed:",
      error.message
    );

    return false;
  }
}

// ============================================================
// SHA-256
// ============================================================

function sha256File(
  file
) {
  const hash =
    crypto.createHash(
      "sha256"
    );

  hash.update(
    fs.readFileSync(
      file
    )
  );

  return hash.digest(
    "hex"
  );
}

// ============================================================
// Grayscale pixels
// ============================================================

function getGrayPixels(
  file,
  width = 64,
  height = 64
) {
  try {
    const buffer =
      runImageMagick(
        [
          file,

          "-auto-orient",

          "-resize",
          `${width}x${height}!`,

          "-colorspace",
          "Gray",

          "-depth",
          "8",

          "gray:-"
        ],
        {
          stdio: "pipe"
        }
      );

    const expected =
      width * height;

    if (
      buffer.length <
      expected
    ) {
      return null;
    }

    return Buffer.from(
      buffer.subarray(
        0,
        expected
      )
    );
  } catch {
    return null;
  }
}

// ============================================================
// Block hash
// ============================================================

function averageBlockHash(
  pixels,
  width,
  height,
  blocks = 16
) {
  const values = [];

  for (
    let by = 0;
    by < blocks;
    by++
  ) {
    for (
      let bx = 0;
      bx < blocks;
      bx++
    ) {
      const x0 =
        Math.floor(
          bx *
          width /
          blocks
        );

      const x1 =
        Math.max(
          x0 + 1,
          Math.floor(
            (bx + 1) *
            width /
            blocks
          )
        );

      const y0 =
        Math.floor(
          by *
          height /
          blocks
        );

      const y1 =
        Math.max(
          y0 + 1,
          Math.floor(
            (by + 1) *
            height /
            blocks
          )
        );

      let sum = 0;
      let count = 0;

      for (
        let y = y0;
        y < y1;
        y++
      ) {
        for (
          let x = x0;
          x < x1;
          x++
        ) {
          sum +=
            pixels[
              y * width + x
            ];

          count++;
        }
      }

      values.push(
        Math.round(
          sum / count
        )
      );
    }
  }

  return values
    .map(
      value =>
        Math.floor(
          value / 16
        ).toString(16)
    )
    .join("");
}

// ============================================================
// aHash
// ============================================================

function aHash(
  pixels,
  width,
  height
) {
  const size = 8;
  const values = [];

  for (
    let y = 0;
    y < size;
    y++
  ) {
    for (
      let x = 0;
      x < size;
      x++
    ) {
      const px =
        pixels[
          Math.floor(
            y *
            height /
            size
          ) *
            width +
          Math.floor(
            x *
            width /
            size
          )
        ];

      values.push(
        px
      );
    }
  }

  const average =
    values.reduce(
      (a, b) =>
        a + b,
      0
    ) /
    values.length;

  return values
    .map(
      value =>
        value >= average
          ? "1"
          : "0"
    )
    .join("");
}

// ============================================================
// dHash
// ============================================================

function dHash(
  pixels,
  width,
  height
) {
  const w = 9;
  const h = 8;

  const bits = [];

  for (
    let y = 0;
    y < h;
    y++
  ) {
    for (
      let x = 0;
      x < w - 1;
      x++
    ) {
      const left =
        pixels[
          Math.floor(
            y *
            height /
            h
          ) *
            width +
          Math.floor(
            x *
            width /
            w
          )
        ];

      const right =
        pixels[
          Math.floor(
            y *
            height /
            h
          ) *
            width +
          Math.floor(
            (x + 1) *
            width /
            w
          )
        ];

      bits.push(
        left < right
          ? "1"
          : "0"
      );
    }
  }

  return bits.join("");
}

// ============================================================
// Hamming distance
// ============================================================

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
    return Number.MAX_SAFE_INTEGER;
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

// ============================================================
// Fingerprint
// ============================================================

function fingerprintImage(
  file
) {
  const pixels =
    getGrayPixels(
      file,
      64,
      64
    );

  if (!pixels) {
    return null;
  }

  const hashPixels =
    getGrayPixels(
      file,
      32,
      32
    );

  if (!hashPixels) {
    return null;
  }

  return {
    sha256:
      sha256File(file),

    aHash:
      aHash(
        pixels,
        64,
        64
      ),

    dHash:
      dHash(
        pixels,
        64,
        64
      ),

    blockHash:
      averageBlockHash(
        hashPixels,
        32,
        32,
        16
      )
  };
}

// ============================================================
// Visual duplicate detection
// ============================================================

function areVisualDuplicates(
  a,
  b
) {
  if (!a || !b) {
    return false;
  }

  // Exact duplicate
  if (
    a.sha256 &&
    b.sha256 &&
    a.sha256 ===
      b.sha256
  ) {
    return true;
  }

  const aDistance =
    hammingDistance(
      a.aHash,
      b.aHash
    );

  const dDistance =
    hammingDistance(
      a.dHash,
      b.dHash
    );

  if (
    aDistance <= 4 &&
    dDistance <= 4
  ) {
    return true;
  }

  if (
    a.blockHash &&
    b.blockHash &&
    a.blockHash ===
      b.blockHash
  ) {
    return true;
  }

  return false;
}

// ============================================================
// Temporary files
// ============================================================

function tempFile(
  prefix,
  extension = ".bin"
) {
  const random =
    crypto
      .randomBytes(8)
      .toString("hex");

  return path.join(
    OUTPUT_DIR,
    `${prefix}-${random}${extension}`
  );
}

// ============================================================
// Candidate evaluation
// ============================================================

async function evaluateCandidate(
  candidate,
  post,
  postIndex
) {
  const tempInput =
    tempFile(
      `candidate-${postIndex}`,
      ".bin"
    );

  const tempOutput =
    tempFile(
      `candidate-${postIndex}`,
      ".jpg"
    );

  try {
    console.log(
      `  Trying: ${candidate.source} | score=${candidate.score.toFixed(1)}`
    );

    console.log(
      `    URL: ${candidate.url}`
    );

    const bytes =
      await downloadImage(
        candidate.url,
        tempInput,
        post.url
      );

    console.log(
      `    Downloaded: ${bytes} bytes`
    );

    // IMPORTANT:
    // Validate downloaded bytes immediately.
    const inputInfo =
      identifyImage(
        tempInput
      );

    if (!inputInfo) {
      throw new Error(
        "ImageMagick could not identify image"
      );
    }

    console.log(
      `    Source image: ${inputInfo.width}x${inputInfo.height} ${inputInfo.format}`
    );

    if (
      inputInfo.width < 200 ||
      inputInfo.height < 120
    ) {
      throw new Error(
        `Image too small: ${inputInfo.width}x${inputInfo.height}`
      );
    }

    if (
      !convertToJpeg(
        tempInput,
        tempOutput
      )
    ) {
      throw new Error(
        "Failed to convert image to JPEG"
      );
    }

    const outputInfo =
      identifyImage(
        tempOutput
      );

    if (!outputInfo) {
      throw new Error(
        "Converted JPEG could not be identified"
      );
    }

    const outputSize =
      fs.statSync(
        tempOutput
      ).size;

    if (
      outputSize < 5000
    ) {
      throw new Error(
        `Converted image too small: ${outputSize} bytes`
      );
    }

    const fingerprint =
      fingerprintImage(
        tempOutput
      );

    if (!fingerprint) {
      throw new Error(
        "Could not generate visual fingerprint"
      );
    }

    return {
      candidate,
      tempInput,
      tempOutput,
      fingerprint,
      width:
        outputInfo.width,
      height:
        outputInfo.height,
      size:
        outputSize
    };
  } catch (
    error
  ) {
    console.log(
      `    Rejected: ${error.message}`
    );

    try {
      fs.unlinkSync(
        tempInput
      );
    } catch {}

    try {
      fs.unlinkSync(
        tempOutput
      );
    } catch {}

    return null;
  }
}

// ============================================================
// Select image for ONE post
// ============================================================

async function selectImageForPost(
  post,
  postIndex,
  feedCandidates,
  pageCandidates,
  usedFingerprints
) {
  console.log("");

  console.log(
    `Selecting image for Post ${postIndex}: ${post.title}`
  );

  // ==========================================================
  // ONLY this post's candidates
  // ==========================================================

  const candidates =
    dedupeCandidates([
      ...feedCandidates,
      ...pageCandidates
    ]).filter(
      candidate =>
        !isObviouslyBadImageUrl(
          candidate.url,
          post.url
        )
    );

  console.log(
    ` Image candidates belonging to this post: ${candidates.length}`
  );

  if (
    candidates.length === 0
  ) {
    throw new Error(
      `No usable image candidate found for Post ${postIndex}: ${post.title}`
    );
  }

  console.log(
    " Selection scope: THIS POST ONLY"
  );

  for (
    let i = 0;
    i < candidates.length;
    i++
  ) {
    console.log(
      `  Candidate ${i + 1}: ${candidates[i].source} | score=${candidates[i].score.toFixed(1)}`
    );

    console.log(
      `    ${candidates[i].url}`
    );
  }

  // ==========================================================
  // Try candidates in ranked order
  // ==========================================================

  for (
    const candidate
    of candidates
  ) {
    const result =
      await evaluateCandidate(
        candidate,
        post,
        postIndex
      );

    if (!result) {
      continue;
    }

    // ========================================================
    // Cross-post duplicate check
    // ========================================================

    let duplicate =
      false;

    for (
      const previous
      of usedFingerprints
    ) {
      if (
        areVisualDuplicates(
          result.fingerprint,
          previous.fingerprint
        )
      ) {
        duplicate = true;

        console.log(
          `    Rejected: visually duplicates Post ${previous.postIndex}`
        );

        break;
      }
    }

    if (duplicate) {
      try {
        fs.unlinkSync(
          result.tempInput
        );
      } catch {}

      try {
        fs.unlinkSync(
          result.tempOutput
        );
      } catch {}

      // IMPORTANT:
      // Do NOT borrow another post's image.
      // Try the next candidate belonging to this post.
      continue;
    }

    return result;
  }

  throw new Error(
    `All image candidates were rejected for Post ${postIndex}: ${post.title}`
  );
}

// ============================================================
// Post metadata
// ============================================================

function getPostUrl(
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
    null
  );
}

function getPostTitle(
  entry
) {
  return (
    entry?.title?.$t ||
    entry?.title?.["$t"] ||
    entry?.title ||
    ""
  ).trim();
}

function getPostDate(
  entry
) {
  return (
    entry?.published?.$t ||
    entry?.published?.["$t"] ||
    entry?.updated?.$t ||
    entry?.updated?.["$t"] ||
    ""
  );
}

function getCategories(
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
      item =>
        item?.term
    )
    .filter(Boolean);
}

// ============================================================
// Excerpt
// ============================================================

function createExcerpt(
  entry
) {
  let html = "";

  if (
    typeof entry?.summary ===
    "string"
  ) {
    html =
      entry.summary;
  } else {
    html =
      entry?.summary?.$t ||
      entry?.summary?.["$t"] ||
      "";
  }

  if (!html) {
    if (
      typeof entry?.content ===
      "string"
    ) {
      html =
        entry.content;
    } else {
      html =
        entry?.content?.$t ||
        entry?.content?.["$t"] ||
        "";
    }
  }

  const text =
    stripHtml(html);

  if (
    text.length <= 240
  ) {
    return text;
  }

  return (
    text
      .slice(
        0,
        237
      )
      .trimEnd() +
    "..."
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
  const titles =
    posts.map(
      p => p.title
    );

  const excerpts =
    posts.map(
      p => p.excerpt
    );

  const combined =
    [
      ...titles,
      ...excerpts
    ]
      .join(" ")
      .toLowerCase();

  const topics = [];

  const topicKeywords = [
    ["s&p 500", "S&P 500"],
    ["nasdaq", "NASDAQ"],
    ["stock market", "Stock Market"],
    ["stocks", "Stocks"],
    ["federal reserve", "Federal Reserve"],
    ["fed", "Federal Reserve"],
    ["interest rate", "Interest Rates"],
    ["inflation", "Inflation"],
    ["cpi", "CPI"],
    ["bonds", "Bonds"],
    ["treasury", "Treasury"],
    ["china", "China"],
    ["japan", "Japan"],
    ["asia", "Asian Markets"],
    ["hang seng", "Hang Seng"],
    ["kospi", "KOSPI"],
    ["oil", "Oil"],
    ["gold", "Gold"],
    ["safe-haven", "Safe-Haven Assets"]
  ];

  for (
    const [
      needle,
      label
    ]
    of topicKeywords
  ) {
    if (
      combined.includes(
        needle
      )
    ) {
      topics.push(
        label
      );
    }
  }

  return {
    identity:
      siteTitle ||
      "Financial Market Blog",

    topics,

    audience:
      "Readers interested in financial markets, U.S. stocks, global markets and market-moving events.",

    contentStyle:
      "Short, information-focused financial market updates with headlines, summaries and market context.",

    valueProposition:
      "Provides concise market information and explanations designed to help readers quickly understand important financial developments."
  };
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log(
    "========================================"
  );

  console.log(
    "BLOG ANALYZER v10.1"
  );

  console.log(
    "========================================"
  );

  console.log(
    `Blog URL: ${BLOG_URL}`
  );

  console.log(
    `Output: ${OUTPUT_DIR}`
  );

  // ==========================================================
  // Blogger feed
  // ==========================================================

  const feedUrl =
    new URL(
      "/feeds/posts/default?alt=json&max-results=10",
      BLOG_URL
    ).href;

  console.log("");

  console.log(
    `Fetching Blogger feed: ${feedUrl}`
  );

  const feedResponse =
    await fetch(
      feedUrl,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",

          "Accept":
            "application/json,text/plain,*/*"
        }
      }
    );

  if (
    !feedResponse.ok
  ) {
    throw new Error(
      `Feed HTTP ${feedResponse.status} ${feedResponse.statusText}`
    );
  }

  const feed =
    await feedResponse.json();

  const entries =
    Array.isArray(
      feed?.feed?.entry
    )
      ? feed.feed.entry
      : [];

  if (
    entries.length === 0
  ) {
    throw new Error(
      "No Blogger posts were found."
    );
  }

  const selectedEntries =
    entries.slice(0, 5);

  // ==========================================================
  // Site metadata
  // ==========================================================

  const siteTitle =
    feed?.feed?.title?.$t ||
    feed?.feed?.title?.["$t"] ||
    "";

  const description =
    feed?.feed?.subtitle?.$t ||
    feed?.feed?.subtitle?.["$t"] ||
    "";

  // ==========================================================
  // Homepage metadata
  // ==========================================================

  let pageHeading = "";
  let ogImage = "";
  let language = "en";

  try {
    const homeHtml =
      await fetchText(
        BLOG_URL
      );

    const h1Match =
      homeHtml.match(
        /<h1\b[^>]*>([\s\S]*?)<\/h1>/i
      );

    if (h1Match) {
      pageHeading =
        stripHtml(
          h1Match[1]
        );
    }

    const ogMatch =
      homeHtml.match(
        /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
      ) ||
      homeHtml.match(
        /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i
      );

    if (ogMatch) {
      ogImage =
        ogMatch[1];
    }

    const languageMatch =
      homeHtml.match(
        /<html[^>]+lang=["']([^"']+)["']/i
      );

    if (languageMatch) {
      language =
        languageMatch[1];
    }
  } catch (
    error
  ) {
    console.log(
      `Home page metadata warning: ${error.message}`
    );
  }

  // ==========================================================
  // Process posts
  // ==========================================================

  const posts = [];
  const usedFingerprints = [];

  for (
    let index = 0;
    index <
      selectedEntries.length;
    index++
  ) {
    const entry =
      selectedEntries[index];

    const postIndex =
      index + 1;

    const title =
      getPostTitle(
        entry
      );

    const postUrl =
      getPostUrl(
        entry
      );

    if (
      !title ||
      !postUrl
    ) {
      throw new Error(
        `Post ${postIndex} has missing title or URL.`
      );
    }

    console.log("");

    console.log(
      `Post ${postIndex}: ${title}`
    );

    console.log(
      ` URL: ${postUrl}`
    );

    // ========================================================
    // Feed candidates
    // ========================================================

    const feedCandidates =
      extractFeedCandidates(
        entry,
        postUrl
      );

    console.log(
      ` Feed image candidates: ${feedCandidates.length}`
    );

    for (
      const candidate
      of feedCandidates.slice(
        0,
        10
      )
    ) {
      console.log(
        `  Feed: ${candidate.source} | ${candidate.url}`
      );
    }

    // ========================================================
    // Fetch actual post page
    // ========================================================

    let postHtml = "";

    try {
      postHtml =
        await fetchText(
          postUrl
        );

      console.log(
        ` Article page fetched: ${postHtml.length} bytes`
      );
    } catch (
      error
    ) {
      console.log(
        ` Article page fetch warning: ${error.message}`
      );
    }

    // ========================================================
    // Page-local candidates
    // ========================================================

    const pageCandidates =
      postHtml
        ? extractPageCandidates(
            postHtml,
            postUrl,
            title
          )
        : [];

    console.log(
      ` Page-local image candidates: ${pageCandidates.length}`
    );

    for (
      const candidate
      of pageCandidates.slice(
        0,
        10
      )
    ) {
      console.log(
        `  Page: ${candidate.source} | score=${candidate.score.toFixed(1)} | ${candidate.url}`
      );
    }

    // ========================================================
    // Select image
    // ========================================================

    const selected =
      await selectImageForPost(
        {
          title,
          url: postUrl
        },
        postIndex,
        feedCandidates,
        pageCandidates,
        usedFingerprints
      );

    // ========================================================
    // Save final image
    // ========================================================

    const finalImagePath =
      path.join(
        IMAGE_DIR,
        `post-${postIndex}.jpg`
      );

    fs.copyFileSync(
      selected.tempOutput,
      finalImagePath
    );

    try {
      fs.unlinkSync(
        selected.tempInput
      );
    } catch {}

    try {
      fs.unlinkSync(
        selected.tempOutput
      );
    } catch {}

    const finalSize =
      fs.statSync(
        finalImagePath
      ).size;

    if (
      finalSize < 5000
    ) {
      throw new Error(
        `Final image too small: ${finalSize} bytes`
      );
    }

    // ========================================================
    // Record fingerprint
    // ========================================================

    usedFingerprints.push({
      postIndex,
      fingerprint:
        selected.fingerprint
    });

    console.log("");

    console.log(
      ` SELECTED IMAGE FOR POST ${postIndex}`
    );

    console.log(
      `   Source: ${selected.candidate.source}`
    );

    console.log(
      `   URL: ${selected.candidate.url}`
    );

    console.log(
      `   Size: ${selected.width}x${selected.height}`
    );

    console.log(
      `   File: ${finalImagePath}`
    );

    // ========================================================
    // Post JSON
    // ========================================================

    const published =
      getPostDate(
        entry
      );

    posts.push({
      index:
        postIndex,

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

      excerpt:
        createExcerpt(
          entry
        ),

      categories:
        getCategories(
          entry
        ),

      localImage:
        `blog/images/post-${postIndex}.jpg`,

      imageSource:
        selected.candidate.source,

      imageUrl:
        selected.candidate.url
    });

    await sleep(
      200
    );
  }

  // ==========================================================
  // Final duplicate validation
  // ==========================================================

  console.log("");

  console.log(
    "========================================"
  );

  console.log(
    "FINAL IMAGE DUPLICATE VALIDATION"
  );

  console.log(
    "========================================"
  );

  for (
    let i = 0;
    i <
      usedFingerprints.length;
    i++
  ) {
    for (
      let j = i + 1;
      j <
        usedFingerprints.length;
      j++
    ) {
      if (
        areVisualDuplicates(
          usedFingerprints[i]
            .fingerprint,

          usedFingerprints[j]
            .fingerprint
        )
      ) {
        throw new Error(
          `FINAL VALIDATION FAILED: Post ${usedFingerprints[i].postIndex} and Post ${usedFingerprints[j].postIndex} use visually duplicate images.`
        );
      }
    }
  }

  console.log(
    `Unique images: ${usedFingerprints.length}/${posts.length}`
  );

  console.log(
    "Duplicate detection: SHA-256 + aHash + dHash + blockHash"
  );

  // ==========================================================
  // Validate saved images
  // ==========================================================

  for (
    const post
    of posts
  ) {
    const imagePath =
      path.resolve(
        OUTPUT_DIR,
        "..",
        post.localImage
      );

    if (
      !fs.existsSync(
        imagePath
      )
    ) {
      throw new Error(
        `Missing image file: ${imagePath}`
      );
    }

    const size =
      fs.statSync(
        imagePath
      ).size;

    if (
      size < 5000
    ) {
      throw new Error(
        `Image file too small: ${imagePath}`
      );
    }

    const info =
      identifyImage(
        imagePath
      );

    if (!info) {
      throw new Error(
        `Invalid image file: ${imagePath}`
      );
    }

    if (
      info.width < 200 ||
      info.height < 120
    ) {
      throw new Error(
        `Image dimensions too small: ${imagePath} ${info.width}x${info.height}`
      );
    }
  }

  // ==========================================================
  // blog.json
  // ==========================================================

  const blogJson = {
    version: 10,

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

    pageHeading,

    ogImage:
      ogImage
        ? normalizeImageUrl(
            absoluteUrl(
              ogImage,
              BLOG_URL
            )
          )
        : "",

    language,

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
      blogJson,
      null,
      2
    ),
    "utf8"
  );

  // ==========================================================
  // Final summary
  // ==========================================================

  console.log("");

  console.log(
    "========================================"
  );

  console.log(
    "BLOG ANALYZER v10.1 COMPLETE"
  );

  console.log(
    "========================================"
  );

  console.log(
    `Posts: ${posts.length}`
  );

  console.log(
    `Real images: ${posts.length}/${posts.length}`
  );

  console.log(
    `Unique images: ${usedFingerprints.length}/${posts.length}`
  );

  console.log(
    `JSON: ${jsonPath}`
  );

  console.log("");

  for (
    const post
    of posts
  ) {
    console.log(
      `${post.index}. ${post.title}`
    );

    console.log(
      `   Image: ${post.localImage}`
    );

    console.log(
      `   Source: ${post.imageSource}`
    );

    console.log(
      `   URL: ${post.imageUrl}`
    );
  }

  console.log("");

  console.log(
    "All image validation checks passed."
  );
}

// ============================================================
// Execute
// ============================================================

main().catch(
  error => {
    console.error("");

    console.error(
      "========================================"
    );

    console.error(
      "BLOG ANALYZER v10.1 FAILED"
    );

    console.error(
      "========================================"
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

    process.exit(1);
  }
);
