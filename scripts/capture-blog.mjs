import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// ============================================================
// BLOG ANALYZER v10.4
//
// Main goals:
//
// 1. Extract the image that belongs to EACH individual post.
// 2. Never mix images from other posts on the same page.
// 3. Prefer Blogger JSON Feed content.
// 4. Fall back to the exact post article only.
// 5. Never scrape arbitrary blogger CDN strings.
// 6. Reject incomplete Blogger resize URLs.
// 7. Validate downloaded files with Content-Type + ImageMagick.
// 8. Prevent exact and visual duplicate images.
// 9. Never borrow another post's image.
// 10. Keep blog.json compatible with Remotion BlogPromo.
//
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

const HAS_IDENTIFY =
  commandExists("identify");

const HAS_MAGICK =
  commandExists("magick");

const HAS_CONVERT =
  commandExists("convert");

if (
  !HAS_IDENTIFY &&
  !HAS_MAGICK
) {
  console.error(
    "ERROR: ImageMagick identify/magick was not found."
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
  // Ignore version failure.
}

// ============================================================
// General helpers
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
      "\""
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

  // Ignore javascript/data/blob URLs.
  if (
    /^(javascript|data|blob):/i.test(
      value
    )
  ) {
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

// ============================================================
// Blogger image URL normalization
// ============================================================

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
    url =
      new URL(
        absolute
      );
  } catch {
    return "";
  }

  const host =
    url.hostname.toLowerCase();

  const isBloggerHost =
    host.includes(
      "blogger.googleusercontent.com"
    ) ||
    host.endsWith(
      ".bp.blogspot.com"
    ) ||
    host ===
      "bp.blogspot.com";

  if (!isBloggerHost) {
    return url.href;
  }

  let pathname =
    url.pathname;

  // ----------------------------------------------------------
  // Reject resize-only URLs.
  //
  // Examples:
  //
  // /w1200/
  // /s1600/
  // /s72-c/
  // /w144-h144-p-k-no-nu/
  // ----------------------------------------------------------

  if (
    /\/(?:w\d+|h\d+|s\d+(?:-c)?|w\d+-h\d+(?:-[^/]*)?)\/$/i.test(
      pathname
    )
  ) {
    return "";
  }

  // ----------------------------------------------------------
  // Normalize Blogger resize path when a filename exists.
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // Remove resize query parameters.
  // ----------------------------------------------------------

  const paramsToDelete = [
    "w",
    "h",
    "s",
    "resize"
  ];

  for (
    const parameter
    of paramsToDelete
  ) {
    url.searchParams.delete(
      parameter
    );
  }

  url.pathname =
    pathname;

  return url.href;
}

// ============================================================
// Candidate URL validation
// ============================================================

function isResizeOnlyUrl(
  url
) {
  if (!url) {
    return true;
  }

  try {
    const parsed =
      new URL(
        url
      );

    return /\/(?:w\d+|h\d+|s\d+(?:-c)?|w\d+-h\d+(?:-[^/]*)?)\/$/i.test(
      parsed.pathname
    );
  } catch {
    return true;
  }
}

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
    /^javascript:/i.test(
      value
    )
  ) {
    return true;
  }

  if (
    /^blob:/i.test(
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
    isResizeOnlyUrl(
      value
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

  if (
    quoted?.[1]
  ) {
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
// srcset parser
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

    // The URL is everything before an optional descriptor.
    const match =
      value.match(
        /^(.+?)(?:\s+\d+(?:w|x))?$/
      );

    if (
      !match?.[1]
    ) {
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
// Candidate object
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
    context: normalizeText(
      context
    ),
    alt: normalizeText(
      alt
    ),
    title: normalizeText(
      title
    )
  };
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

    const existing =
      map.get(
        candidate.url
      );

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
      b.score -
      a.score
  );
}

// ============================================================
// Extract image URLs from actual HTML attributes only.
// ============================================================

function extractImagesFromHtml(
  html,
  baseUrl,
  source,
  baseScore = 0
) {
  if (!html) {
    return [];
  }

  const candidates = [];

  // ----------------------------------------------------------
  // <img ...>
  // ----------------------------------------------------------

  const imgRegex =
    /<img\b[^>]*>/gi;

  let match;

  while (
    (match =
      imgRegex.exec(
        html
      )) !== null
  ) {
    const tag =
      match[0];

    const src =
      getAttribute(
        tag,
        "src"
      );

    const dataSrc =
      getAttribute(
        tag,
        "data-src"
      );

    const dataOriginal =
      getAttribute(
        tag,
        "data-original"
      );

    const dataLazySrc =
      getAttribute(
        tag,
        "data-lazy-src"
      );

    const dataLazy =
      getAttribute(
        tag,
        "data-lazy"
      );

    const dataImage =
      getAttribute(
        tag,
        "data-image"
      );

    const dataImageUrl =
      getAttribute(
        tag,
        "data-image-url"
      );

    const dataUrl =
      getAttribute(
        tag,
        "data-url"
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

    const directAttributes = [
      {
        value: src,
        score: 100
      },
      {
        value: dataSrc,
        score: 95
      },
      {
        value: dataOriginal,
        score: 95
      },
      {
        value: dataLazySrc,
        score: 90
      },
      {
        value: dataLazy,
        score: 90
      },
      {
        value: dataImage,
        score: 90
      },
      {
        value: dataImageUrl,
        score: 90
      },
      {
        value: dataUrl,
        score: 85
      }
    ];

    for (
      const item
      of directAttributes
    ) {
      if (!item.value) {
        continue;
      }

      const candidate =
        makeCandidate(
          item.value,
          {
            baseUrl,
            source,
            score:
              baseScore +
              item.score,
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
      const item
      of [
        srcset,
        dataSrcset
      ]
    ) {
      if (!item) {
        continue;
      }

      for (
        const srcsetUrl
        of extractSrcsetUrls(
          item,
          baseUrl
        )
      ) {
        const candidate =
          makeCandidate(
            srcsetUrl,
            {
              baseUrl,
              source:
                `${source}-srcset`,
              score:
                baseScore +
                80,
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

  // ----------------------------------------------------------
  // <source srcset="...">
  // ----------------------------------------------------------

  const sourceRegex =
    /<source\b[^>]*>/gi;

  while (
    (match =
      sourceRegex.exec(
        html
      )) !== null
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
      const srcsetUrl
      of extractSrcsetUrls(
        srcset,
        baseUrl
      )
    ) {
      const candidate =
        makeCandidate(
          srcsetUrl,
          {
            baseUrl,
            source:
              `${source}-source`,
            score:
              baseScore +
              70
          }
        );

      if (candidate) {
        candidates.push(
          candidate
        );
      }
    }
  }

  // ----------------------------------------------------------
  // CSS background-image.
  // Only inspect actual style attributes.
  // ----------------------------------------------------------

  const styleRegex =
    /<[^>]+\bstyle\s*=\s*["'][^"']*background(?:-image)?\s*:[^"']*["'][^>]*>/gi;

  while (
    (match =
      styleRegex.exec(
        html
      )) !== null
  ) {
    const tag =
      match[0];

    const style =
      getAttribute(
        tag,
        "style"
      );

    const urls =
      [];

    const urlRegex =
      /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;

    let urlMatch;

    while (
      (urlMatch =
        urlRegex.exec(
          style
        )) !== null
    ) {
      urls.push(
        urlMatch[1]
      );
    }

    for (
      const rawUrl
      of urls
    ) {
      const candidate =
        makeCandidate(
          rawUrl,
          {
            baseUrl,
            source:
              `${source}-background`,
            score:
              baseScore +
              40
          }
        );

      if (candidate) {
        candidates.push(
          candidate
        );
      }
    }
  }

  return dedupeCandidates(
    candidates
  );
}

// ============================================================
// Meta image extraction
// ============================================================

function extractMetaImages(
  html,
  baseUrl
) {
  if (!html) {
    return [];
  }

  const candidates = [];

  const metaRegex =
    /<meta\b[^>]*>/gi;

  let match;

  while (
    (match =
      metaRegex.exec(
        html
      )) !== null
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

    const content =
      getAttribute(
        tag,
        "content"
      );

    const key =
      normalizeText(
        property ||
        name
      );

    if (
      !content
    ) {
      continue;
    }

    if (
      [
        "og:image",
        "og:image:url",
        "og:image:secure_url",
        "twitter:image",
        "twitter:image:src",
        "image_src"
      ].includes(
        key
      )
    ) {
      const candidate =
        makeCandidate(
          content,
          {
            baseUrl,
            source:
              "post-meta",
            score:
              key.startsWith(
                "og:image"
              )
                ? 300
                : 250
          }
        );

      if (candidate) {
        candidates.push(
          candidate
        );
      }
    }
  }

  return dedupeCandidates(
    candidates
  );
}

// ============================================================
// Feed image extraction
// ============================================================

function extractFeedImages(
  entry,
  postUrl
) {
  const candidates = [];

  const feedBase =
    postUrl ||
    BLOG_URL;

  // ----------------------------------------------------------
  // Blogger media$thumbnail
  // ----------------------------------------------------------

  const thumbnail =
    entry?.["media$thumbnail"]?.url;

  if (thumbnail) {
    const candidate =
      makeCandidate(
        thumbnail,
        {
          baseUrl: feedBase,
          source:
            "feed-thumbnail",
          score:
            120
        }
      );

    if (candidate) {
      candidates.push(
        candidate
      );
    }
  }

  // ----------------------------------------------------------
  // Blogger media$group
  // ----------------------------------------------------------

  const group =
    entry?.["media$group"];

  const groupContents =
    group?.["media$content"];

  if (
    Array.isArray(
      groupContents
    )
  ) {
    for (
      const item
      of groupContents
    ) {
      const rawUrl =
        item?.url;

      if (!rawUrl) {
        continue;
      }

      const candidate =
        makeCandidate(
          rawUrl,
          {
            baseUrl: feedBase,
            source:
              "feed-media-content",
            score:
              150
          }
        );

      if (candidate) {
        candidates.push(
          candidate
        );
      }
    }
  }

  // ----------------------------------------------------------
  // Alternative media$content representation.
  // ----------------------------------------------------------

  const mediaContent =
    entry?.["media$content"];

  if (
    Array.isArray(
      mediaContent
    )
  ) {
    for (
      const item
      of mediaContent
    ) {
      const rawUrl =
        item?.url;

      if (!rawUrl) {
        continue;
      }

      const candidate =
        makeCandidate(
          rawUrl,
          {
            baseUrl: feedBase,
            source:
              "feed-media-content",
            score:
              145
          }
        );

      if (candidate) {
        candidates.push(
          candidate
        );
      }
    }
  }

  // ----------------------------------------------------------
  // entry.content.$t
  //
  // This is the most important fallback for Blogger feeds.
  // ----------------------------------------------------------

  const contentHtml =
    entry?.content?.$t ||
    "";

  if (contentHtml) {
    candidates.push(
      ...extractImagesFromHtml(
        contentHtml,
        feedBase,
        "feed-content",
        180
      )
    );
  }

  // ----------------------------------------------------------
  // entry.summary.$t
  // ----------------------------------------------------------

  const summaryHtml =
    entry?.summary?.$t ||
    "";

  if (summaryHtml) {
    candidates.push(
      ...extractImagesFromHtml(
        summaryHtml,
        feedBase,
        "feed-summary",
        100
      )
    );
  }

  return dedupeCandidates(
    candidates
  );
}

// ============================================================
// Extract title-linked article container.
//
// IMPORTANT:
//
// We do NOT return all .post-body elements.
//
// We locate the current post title first and then climb to the
// nearest likely post container.
//
// This prevents:
//   Post 1 -> Post 2 image
//   Post 2 -> Post 3 image
//   etc.
//
// ============================================================

function findCurrentPostContainer(
  html,
  title,
  postUrl
) {
  if (!html) {
    return null;
  }

  const normalizedTitle =
    normalizeText(
      title
    );

  if (!normalizedTitle) {
    return null;
  }

  // ----------------------------------------------------------
  // 1. Look for an element whose visible text contains the
  //    exact post title.
  // ----------------------------------------------------------

  const headingRegex =
    /<(h1|h2|h3|h4|h5|h6)\b[^>]*>([\s\S]*?)<\/\1>/gi;

  let match;

  while (
    (match =
      headingRegex.exec(
        html
      )) !== null
  ) {
    const headingHtml =
      match[0];

    const headingText =
      normalizeText(
        stripHtml(
          match[2]
        )
      );

    if (
      headingText !==
        normalizedTitle &&
      !headingText.includes(
        normalizedTitle
      ) &&
      !normalizedTitle.includes(
        headingText
      )
    ) {
      continue;
    }

    const headingStart =
      match.index;

    const container =
      climbToPostContainer(
        html,
        headingStart
      );

    if (container) {
      return container;
    }
  }

  // ----------------------------------------------------------
  // 2. Look for exact title in anchor text.
  // ----------------------------------------------------------

  const anchorRegex =
    /<a\b[^>]*>([\s\S]*?)<\/a>/gi;

  while (
    (match =
      anchorRegex.exec(
        html
      )) !== null
  ) {
    const anchorText =
      normalizeText(
        stripHtml(
          match[1]
        )
      );

    if (
      !anchorText
    ) {
      continue;
    }

    if (
      anchorText !==
        normalizedTitle &&
      !anchorText.includes(
        normalizedTitle
      )
    ) {
      continue;
    }

    const anchorStart =
      match.index;

    const container =
      climbToPostContainer(
        html,
        anchorStart
      );

    if (container) {
      return container;
    }
  }

  // ----------------------------------------------------------
  // 3. If the post URL is present in a container, use that.
  // ----------------------------------------------------------

  if (postUrl) {
    const normalizedPostPath =
      getNormalizedPath(
        postUrl
      );

    if (normalizedPostPath) {
      const index =
        html.indexOf(
          normalizedPostPath
        );

      if (
        index >= 0
      ) {
        const container =
          climbToPostContainer(
            html,
            index
          );

        if (container) {
          return container;
        }
      }
    }
  }

  return null;
}

// ============================================================
// Get URL pathname for matching.
// ============================================================

function getNormalizedPath(
  url
) {
  try {
    return new URL(
      url
    ).pathname;
  } catch {
    return "";
  }
}

// ============================================================
// Climb backwards through HTML to locate the opening tag of
// the nearest likely post container.
//
// This is intentionally conservative.
// ============================================================

function climbToPostContainer(
  html,
  position
) {
  const before =
    html.slice(
      0,
      position
    );

  const tagRegex =
    /<\/?([a-z0-9]+)\b[^>]*>/gi;

  const stack = [];

  let match;

  while (
    (match =
      tagRegex.exec(
        before
      )) !== null
  ) {
    const fullTag =
      match[0];

    const tagName =
      match[1].toLowerCase();

    if (
      fullTag.startsWith(
        "</"
      )
    ) {
      // Pop matching opening tag.
      for (
        let i =
          stack.length - 1;
        i >= 0;
        i--
      ) {
        if (
          stack[i].tag ===
          tagName
        ) {
          stack.splice(
            i,
            1
          );
          break;
        }
      }

      continue;
    }

    if (
      /\/>$/.test(
        fullTag
      )
    ) {
      continue;
    }

    stack.push(
      {
        tag:
          tagName,
        start:
          match.index,
        html:
          fullTag
      }
    );
  }

  // Search nearest suitable ancestor.
  for (
    let i =
      stack.length - 1;
    i >= 0;
    i--
  ) {
    const item =
      stack[i];

    const tag =
      item.html;

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

    const combined =
      normalizeText(
        `${className} ${id}`
      );

    const isLikelyPost =
      /(?:post|entry|article|hentry|blog-post|post-body|entry-content|post-content)/i.test(
        combined
      ) ||
      item.tag ===
        "article";

    if (!isLikelyPost) {
      continue;
    }

    const end =
      findMatchingClosingTag(
        html,
        item.start,
        item.tag
      );

    if (
      end <=
      item.start
    ) {
      continue;
    }

    return {
      html:
        html.slice(
          item.start,
          end
        ),
      start:
        item.start,
      end
    };
  }

  return null;
}

// ============================================================
// Find matching closing HTML tag.
//
// Handles nested tags of the same type.
// ============================================================

function findMatchingClosingTag(
  html,
  start,
  tagName
) {
  const regex =
    new RegExp(
      `<\\/?${tagName}\\b[^>]*>`,
      "gi"
    );

  regex.lastIndex =
    start;

  let depth = 0;
  let match;

  while (
    (match =
      regex.exec(
        html
      )) !== null
  ) {
    const tag =
      match[0];

    if (
      /^<\//.test(
        tag
      )
    ) {
      depth--;

      if (
        depth ===
        0
      ) {
        return (
          regex.lastIndex
        );
      }
    } else if (
      !/\/>$/.test(
        tag
      )
    ) {
      depth++;
    }
  }

  return -1;
}

// ============================================================
// Article-local image extraction
// ============================================================

function extractArticleImages(
  html,
  title,
  postUrl
) {
  const container =
    findCurrentPostContainer(
      html,
      title,
      postUrl
    );

  if (!container) {
    console.log(
      "Current post container: NOT FOUND"
    );

    return [];
  }

  console.log(
    `Current post container: FOUND (${container.html.length} bytes)`
  );

  const candidates =
    extractImagesFromHtml(
      container.html,
      postUrl,
      "post-article",
      200
    );

  return dedupeCandidates(
    candidates
  );
}

// ============================================================
// Fetch helper
// ============================================================

async function fetchText(
  url,
  options = {}
) {
  const response =
    await fetch(
      url,
      {
        redirect:
          "follow",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/128 Safari/537.36",
          "Accept":
            options.accept ||
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
      }
    );

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText}`
    );
  }

  return {
    text:
      await response.text(),
    contentType:
      response.headers.get(
        "content-type"
      ) || "",
    finalUrl:
      response.url ||
      url
  };
}

// ============================================================
// Feed discovery
// ============================================================

function getFeedUrl(
  blogUrl
) {
  const url =
    new URL(
      blogUrl
    );

  url.pathname =
    "/feeds/posts/default";

  url.search =
    "?alt=json&max-results=10";

  return url.href;
}

// ============================================================
// Parse Blogger feed
// ============================================================

async function fetchFeed(
  blogUrl
) {
  const feedUrl =
    getFeedUrl(
      blogUrl
    );

  console.log(
    `Feed URL: ${feedUrl}`
  );

  const result =
    await fetchText(
      feedUrl,
      {
        accept:
          "application/json,text/javascript,*/*;q=0.8"
      }
    );

  let data;

  try {
    data =
      JSON.parse(
        result.text
      );
  } catch {
    throw new Error(
      "Blogger feed returned invalid JSON."
    );
  }

  const entries =
    Array.isArray(
      data?.feed?.entry
    )
      ? data.feed.entry
      : [];

  return {
    feedUrl,
    entries
  };
}

// ============================================================
// Feed post metadata
// ============================================================

function getEntryTitle(
  entry
) {
  return (
    entry?.title?.$t ||
    entry?.title ||
    ""
  )
    .toString()
    .trim();
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
      item =>
        item?.rel ===
          "alternate" &&
        item?.href
    );

  return (
    alternate?.href ||
    ""
  );
}

function getEntryPublished(
  entry
) {
  return (
    entry?.published?.$t ||
    entry?.published ||
    ""
  )
    .toString()
    .trim();
}

function getEntryUpdated(
  entry
) {
  return (
    entry?.updated?.$t ||
    entry?.updated ||
    ""
  )
    .toString()
    .trim();
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
      item =>
        item?.term
    )
    .filter(Boolean);
}

// ============================================================
// Excerpt
// ============================================================

function getExcerpt(
  entry
) {
  const source =
    entry?.summary?.$t ||
    entry?.content?.$t ||
    "";

  return stripHtml(
    source
  )
    .slice(
      0,
      280
    )
    .trim();
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

  let response;

  try {
    response =
      await fetch(
        url,
        {
          redirect:
            "follow",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/128 Safari/537.36",
            "Accept":
              "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
          }
        }
      );
  } catch (error) {
    throw new Error(
      `Image download failed: ${error.message}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `Image HTTP ${response.status}`
    );
  }

  const contentType =
    (
      response.headers.get(
        "content-type"
      ) || ""
    ).toLowerCase();

  console.log(
    `Content-Type: ${contentType || "unknown"}`
  );

  // ----------------------------------------------------------
  // Never accept HTML/JSON/XML as an image.
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
      "text/xml"
    ) ||
    contentType.includes(
      "application/xml"
    )
  ) {
    throw new Error(
      `Rejected non-image Content-Type: ${contentType}`
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
      `Image too small: ${buffer.length} bytes`
    );
  }

  fs.writeFileSync(
    outputPath,
    buffer
  );

  console.log(
    `Downloaded: ${buffer.length} bytes`
  );

  return {
    bytes:
      buffer.length,
    contentType
  };
}

// ============================================================
// ImageMagick identify
// ============================================================

function identifyImage(
  filePath
) {
  try {
    const result =
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
          stdio:
            [
              "ignore",
              "pipe",
              "pipe"
            ]
        }
      )
        .trim();

    if (!result) {
      throw new Error(
        "ImageMagick returned empty result."
      );
    }

    const parts =
      result.split("|");

    const format =
      parts[0] ||
      "";

    const width =
      Number(
        parts[1]
      );

    const height =
      Number(
        parts[2]
      );

    if (
      !format ||
      !Number.isFinite(
        width
      ) ||
      !Number.isFinite(
        height
      )
    ) {
      throw new Error(
        `Invalid ImageMagick result: ${result}`
      );
    }

    if (
      width < 200 ||
      height < 100
    ) {
      throw new Error(
        `Image dimensions too small: ${width}x${height}`
      );
    }

    return {
      format,
      width,
      height
    };
  } catch (error) {
    throw new Error(
      `ImageMagick could not identify image: ${error.message}`
    );
  }
}

// ============================================================
// Convert to final JPG.
//
// This makes all output images consistent for Remotion.
// ============================================================

function convertToJpeg(
  inputPath,
  outputPath
) {
  const tempOutput =
    `${outputPath}.tmp.jpg`;

  try {
    execFileSync(
      CONVERT_COMMAND,
      [
        inputPath,
        "-auto-orient",
        "-strip",
        "-sampling-factor",
        "4:2:0",
        "-quality",
        "90",
        tempOutput
      ],
      {
        stdio:
          "pipe"
      }
    );

    fs.renameSync(
      tempOutput,
      outputPath
    );

    return fs.statSync(
      outputPath
    ).size;
  } catch (error) {
    try {
      if (
        fs.existsSync(
          tempOutput
        )
      ) {
        fs.unlinkSync(
          tempOutput
        );
      }
    } catch {
      // ignore
    }

    throw new Error(
      `ImageMagick conversion failed: ${error.message}`
    );
  }
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
// Visual fingerprint.
//
// Uses ImageMagick to create a small grayscale representation.
// This catches visually identical images saved with different
// JPEG quality / encoding / dimensions.
//
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
        tempPath
      ],
      {
        stdio:
          "pipe"
      }
    );

    const hash =
      crypto.createHash(
        "sha256"
      );

    hash.update(
      fs.readFileSync(
        tempPath
      )
    );

    return hash.digest(
      "hex"
    );
  } catch {
    return "";
  } finally {
    try {
      if (
        fs.existsSync(
          tempPath
        )
      ) {
        fs.unlinkSync(
          tempPath
        );
      }
    } catch {
      // ignore
    }
  }
}

// ============================================================
// Candidate scoring based on post title.
//
// This is only an additional signal.
//
// We never use it to select an image from another post.
// ============================================================

function scoreCandidateForTitle(
  candidate,
  title
) {
  if (
    !candidate
  ) {
    return 0;
  }

  const normalizedTitle =
    normalizeText(
      title
    );

  if (!normalizedTitle) {
    return 0;
  }

  let score =
    candidate.score ||
    0;

  const titleWords =
    normalizedTitle
      .split(/\s+/)
      .filter(
        word =>
          word.length >=
          3
      );

  const context =
    [
      candidate.alt,
      candidate.title,
      candidate.context,
      candidate.url
    ]
      .join(" ")
      .toLowerCase();

  let matched =
    0;

  for (
    const word
    of titleWords
  ) {
    if (
      context.includes(
        word
      )
    ) {
      matched++;
    }
  }

  if (
    matched > 0
  ) {
    score +=
      Math.min(
        100,
        matched * 10
      );
  }

  return score;
}

// ============================================================
// Candidate validation and selection
// ============================================================

async function tryCandidate(
  candidate,
  outputPath,
  tempPath
) {
  if (
    !candidate?.url
  ) {
    return null;
  }

  if (
    isObviouslyBadImageUrl(
      candidate.url
    )
  ) {
    return null;
  }

  try {
    await downloadImage(
      candidate.url,
      tempPath
    );

    const identified =
      identifyImage(
        tempPath
      );

    console.log(
      `ImageMagick: ${identified.format}|${identified.width}|${identified.height}`
    );

    // Convert to a stable JPEG.
    const finalBytes =
      convertToJpeg(
        tempPath,
        outputPath
      );

    const finalInfo =
      identifyImage(
        outputPath
      );

    return {
      candidate,
      bytes:
        finalBytes,
      width:
        finalInfo.width,
      height:
        finalInfo.height,
      sha256:
        sha256File(
          outputPath
        ),
      visual:
        visualFingerprint(
          outputPath
        )
    };
  } catch (error) {
    console.log(
      `Rejected: ${error.message}`
    );

    try {
      if (
        fs.existsSync(
          tempPath
        )
      ) {
        fs.unlinkSync(
          tempPath
        );
      }
    } catch {
      // ignore
    }

    try {
      if (
        fs.existsSync(
          outputPath
        )
      ) {
        fs.unlinkSync(
          outputPath
        );
      }
    } catch {
      // ignore
    }

    return null;
  }
}

// ============================================================
// Select image for one post.
//
// IMPORTANT:
//
// This function ONLY receives candidates belonging to the
// current post.
//
// It never looks at another post's candidates.
// ============================================================

async function selectImageForPost(
  candidates,
  post,
  usedHashes,
  usedVisualHashes,
  outputPath
) {
  const scored =
    candidates
      .map(
        candidate => ({
          ...candidate,
          finalScore:
            scoreCandidateForTitle(
              candidate,
              post.title
            )
        })
      )
      .sort(
        (a, b) =>
          b.finalScore -
          a.finalScore
      );

  console.log(
    `Image candidates for Post ${post.index}: ${scored.length}`
  );

  if (
    scored.length ===
    0
  ) {
    throw new Error(
      `No valid image candidates found for Post ${post.index}: ${post.title}`
    );
  }

  const tempPath =
    `${outputPath}.download`;

  for (
    const candidate
    of scored
  ) {
    console.log(
      `Candidate: ${candidate.url}`
    );

    const result =
      await tryCandidate(
        candidate,
        outputPath,
        tempPath
      );

    if (!result) {
      continue;
    }

    // --------------------------------------------------------
    // Exact duplicate.
    // --------------------------------------------------------

    if (
      usedHashes.has(
        result.sha256
      )
    ) {
      console.log(
        `Rejected: exact duplicate image`
      );

      try {
        fs.unlinkSync(
          outputPath
        );
      } catch {
        // ignore
      }

      continue;
    }

    // --------------------------------------------------------
    // Visual duplicate.
    // --------------------------------------------------------

    if (
      result.visual &&
      usedVisualHashes.has(
        result.visual
      )
    ) {
      console.log(
        `Rejected: visual duplicate image`
      );

      try {
        fs.unlinkSync(
          outputPath
        );
      } catch {
        // ignore
      }

      continue;
    }

    usedHashes.add(
      result.sha256
    );

    if (
      result.visual
    ) {
      usedVisualHashes.add(
        result.visual
      );
    }

    return {
      ...result,
      localImage:
        path
          .relative(
            OUTPUT_DIR,
            outputPath
          )
          .split(
            path.sep
          )
          .join("/")
    };
  }

  throw new Error(
    `All image candidates were rejected for Post ${post.index}: ${post.title}`
  );
}

// ============================================================
// Site metadata
// ============================================================

function extractMetaValue(
  html,
  keys
) {
  if (!html) {
    return "";
  }

  const keySet =
    new Set(
      keys.map(
        normalizeText
      )
    );

  const metaRegex =
    /<meta\b[^>]*>/gi;

  let match;

  while (
    (match =
      metaRegex.exec(
        html
      )) !== null
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

    const key =
      normalizeText(
        property ||
        name
      );

    if (
      !keySet.has(
        key
      )
    ) {
      continue;
    }

    const content =
      getAttribute(
        tag,
        "content"
      );

    if (
      content
    ) {
      return content.trim();
    }
  }

  return "";
}

function extractPageHeading(
  html
) {
  if (!html) {
    return "";
  }

  const h1 =
    html.match(
      /<h1\b[^>]*>([\s\S]*?)<\/h1>/i
    );

  if (
    h1?.[1]
  ) {
    return stripHtml(
      h1[1]
    );
  }

  const title =
    html.match(
      /<title\b[^>]*>([\s\S]*?)<\/title>/i
    );

  if (
    title?.[1]
  ) {
    return stripHtml(
      title[1]
    );
  }

  return "";
}

// ============================================================
// Blog-level description
// ============================================================

function extractDescription(
  html
) {
  return (
    extractMetaValue(
      html,
      [
        "description",
        "og:description"
      ]
    ) ||
    ""
  );
}

// ============================================================
// Site language
// ============================================================

function extractLanguage(
  html
) {
  const match =
    String(
      html || ""
    ).match(
      /<html\b[^>]*\blang\s*=\s*["']([^"']+)["']/i
    );

  return (
    match?.[1] ||
    "en"
  );
}

// ============================================================
// Site title
// ============================================================

function extractSiteTitle(
  html
) {
  return (
    extractMetaValue(
      html,
      [
        "og:site_name"
      ]
    ) ||
    extractPageHeading(
      html
    )
  );
}

// ============================================================
// Lightweight content analysis.
//
// No external AI/API is required.
// ============================================================

function analyzeBlog(
  posts,
  siteTitle,
  description
) {
  const allText =
    [
      siteTitle,
      description,
      ...posts.map(
        post =>
          `${post.title} ${post.excerpt} ${post.categories.join(" ")}`
      )
    ]
      .join(" ")
      .toLowerCase();

  const topics =
    [];

  const topicRules = [
    [
      "stocks",
      /stock|stocks|equity|equities|nasdaq|nyse|s&p|dow|wall street/
    ],
    [
      "markets",
      /market|markets|trading|futures|pre-market|premarket/
    ],
    [
      "technology",
      /technology|tech|ai|artificial intelligence|semiconductor|chip/
    ],
    [
      "economy",
      /economy|economic|inflation|cpi|gdp|employment|fed|interest rate/
    ],
    [
      "commodities",
      /oil|gold|commodity|commodities/
    ],
    [
      "asia",
      /kospi|hang seng|nikkei|china|japan|korea|asia/
    ]
  ];

  for (
    const [
      name,
      regex
    ]
    of topicRules
  ) {
    if (
      regex.test(
        allText
      )
    ) {
      topics.push(
        name
      );
    }
  }

  return {
    identity:
      siteTitle ||
      "Financial Markets Blog",
    topics,
    audience:
      "Readers interested in financial markets, stocks, trading, and economic news.",
    contentStyle:
      "Concise financial news and market analysis.",
    valueProposition:
      "Fast summaries of market-moving developments and financial indicators."
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
    "BLOG ANALYZER v10.4"
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
  // Fetch blog homepage.
  // ----------------------------------------------------------

  console.log(
    "Fetching blog page..."
  );

  const blogPage =
    await fetchText(
      BLOG_URL
    );

  const blogHtml =
    blogPage.text;

  console.log(
    `Blog page fetched: ${Buffer.byteLength(blogHtml, "utf8")} bytes`
  );

  // ----------------------------------------------------------
  // Fetch feed.
  // ----------------------------------------------------------

  const {
    feedUrl,
    entries
  } =
    await fetchFeed(
      BLOG_URL
    );

  console.log(
    "Feed fetched successfully."
  );

  console.log(
    `Feed entries: ${entries.length}`
  );

  if (
    entries.length <
    5
  ) {
    throw new Error(
      `Expected at least 5 blog posts, found ${entries.length}`
    );
  }

  // ----------------------------------------------------------
  // Build posts.
  // ----------------------------------------------------------

  const posts =
    entries
      .slice(
        0,
        5
      )
      .map(
        (entry, index) => ({
          index:
            index + 1,
          title:
            getEntryTitle(
              entry
            ),
          url:
            getEntryUrl(
              entry
            ),
          published:
            getEntryPublished(
              entry
            ),
          updated:
            getEntryUpdated(
              entry
            ),
          date:
            (
              getEntryPublished(
                entry
              ) ||
              getEntryUpdated(
                entry
              )
            ).slice(
              0,
              10
            ),
          excerpt:
            getExcerpt(
              entry
            ),
          categories:
            getEntryCategories(
              entry
            ),
          entry
        })
      );

  for (
    const post
    of posts
  ) {
    if (
      !post.title
    ) {
      throw new Error(
        `Post ${post.index} has no title.`
      );
    }

    if (
      !post.url
    ) {
      throw new Error(
        `Post ${post.index} has no URL.`
      );
    }
  }

  // ----------------------------------------------------------
  // Used-image tracking.
  //
  // These sets are only used AFTER selecting candidates.
  //
  // We never remove candidates from other posts.
  // ----------------------------------------------------------

  const usedHashes =
    new Set();

  const usedVisualHashes =
    new Set();

  // ----------------------------------------------------------
  // Process posts independently.
  // ----------------------------------------------------------

  for (
    const post
    of posts
  ) {
    console.log(
      "\n------------------------------------------------------------"
    );

    console.log(
      `Post ${post.index}: ${post.title}`
    );

    console.log(
      `URL: ${post.url}`
    );

    // --------------------------------------------------------
    // 1. Feed candidates.
    // --------------------------------------------------------

    const feedCandidates =
      extractFeedImages(
        post.entry,
        post.url
      );

    console.log(
      `Feed image candidates: ${feedCandidates.length}`
    );

    let candidates =
      [
        ...feedCandidates
      ];

    // --------------------------------------------------------
    // 2. Only fetch article page when feed did not provide a
    //    usable image candidate.
    // --------------------------------------------------------

    let articleHtml =
      "";

    if (
      candidates.length ===
      0
    ) {
      console.log(
        "No feed image found. Fetching article page..."
      );

      try {
        const articlePage =
          await fetchText(
            post.url
          );

        articleHtml =
          articlePage.text;

        console.log(
          `Article page fetched: ${Buffer.byteLength(articleHtml, "utf8")} bytes`
        );
      } catch (error) {
        console.log(
          `Article fetch failed: ${error.message}`
        );
      }

      // ------------------------------------------------------
      // 2A. Current-post container ONLY.
      // ------------------------------------------------------

      if (
        articleHtml
      ) {
        const articleCandidates =
          extractArticleImages(
            articleHtml,
            post.title,
            post.url
          );

        console.log(
          `Page-local image candidates: ${articleCandidates.length}`
        );

        candidates.push(
          ...articleCandidates
        );
      }

      // ------------------------------------------------------
      // 2B. Meta images are a last-resort fallback.
      //
      // We only use them if the exact article container did
      // not provide candidates.
      // ------------------------------------------------------

      if (
        candidates.length ===
        0 &&
        articleHtml
      ) {
        const metaCandidates =
          extractMetaImages(
            articleHtml,
            post.url
          );

        console.log(
          `Post meta image candidates: ${metaCandidates.length}`
        );

        candidates.push(
          ...metaCandidates
        );
      }
    }

    candidates =
      dedupeCandidates(
        candidates
      );

    // --------------------------------------------------------
    // Log candidates.
    // --------------------------------------------------------

    console.log(
      `Image candidates for Post ${post.index}: ${candidates.length}`
    );

    if (
      candidates.length >
      0
    ) {
      for (
        const candidate
        of candidates
      ) {
        console.log(
          `Candidate: ${candidate.url}`
        );
      }
    }

    // --------------------------------------------------------
    // Output paths.
    // --------------------------------------------------------

    const outputPath =
      path.join(
        IMAGE_DIR,
        `post-${post.index}.jpg`
      );

    // --------------------------------------------------------
    // Select image.
    // --------------------------------------------------------

    const selected =
      await selectImageForPost(
        candidates,
        post,
        usedHashes,
        usedVisualHashes,
        outputPath
      );

    console.log(
      `Selected image: ${selected.localImage}`
    );

    console.log(
      `Selected source: ${selected.candidate.source}`
    );

    console.log(
      `Selected URL: ${selected.candidate.url}`
    );

    console.log(
      `Selected bytes: ${selected.bytes}`
    );

    // --------------------------------------------------------
    // Replace internal fields with JSON-safe fields.
    // --------------------------------------------------------

    post.localImage =
      selected.localImage;

    post.imageSource =
      selected.candidate.source;

    post.imageUrl =
      selected.candidate.url;

    delete post.entry;
    delete post.updated;
  }

  // ==========================================================
  // Final validation
  // ==========================================================

  console.log(
    "\n============================================================"
  );

  console.log(
    "FINAL IMAGE VALIDATION"
  );

  console.log(
    "============================================================"
  );

  const finalHashes =
    new Set();

  const finalVisualHashes =
    new Set();

  for (
    const post
    of posts
  ) {
    if (
      !post.localImage
    ) {
      throw new Error(
        `Post ${post.index} has no localImage.`
      );
    }

    const filePath =
      path.resolve(
        OUTPUT_DIR,
        post.localImage
      );

    if (
      !fs.existsSync(
        filePath
      )
    ) {
      throw new Error(
        `Missing image file: ${filePath}`
      );
    }

    const stat =
      fs.statSync(
        filePath
      );

    if (
      stat.size <
      5000
    ) {
      throw new Error(
        `Image too small: ${filePath}`
      );
    }

    const hash =
      sha256File(
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

    finalHashes.add(
      hash
    );

    const visual =
      visualFingerprint(
        filePath
      );

    if (
      visual &&
      finalVisualHashes.has(
        visual
      )
    ) {
      throw new Error(
        `Visual duplicate image detected: ${filePath}`
      );
    }

    if (
      visual
    ) {
      finalVisualHashes.add(
        visual
      );
    }

    const info =
      identifyImage(
        filePath
      );

    console.log(
      `Post ${post.index}: ${post.localImage} | ${info.format} | ${info.width}x${info.height} | ${stat.size} bytes`
    );
  }

  // ==========================================================
  // Site metadata
  // ==========================================================

  const siteTitle =
    extractSiteTitle(
      blogHtml
    );

  const description =
    extractDescription(
      blogHtml
    );

  const pageHeading =
    extractPageHeading(
      blogHtml
    );

  const ogImage =
    extractMetaValue(
      blogHtml,
      [
        "og:image"
      ]
    );

  const language =
    extractLanguage(
      blogHtml
    );

  const analysis =
    analyzeBlog(
      posts,
      siteTitle,
      description
    );

  // ==========================================================
  // Final blog.json
  // ==========================================================

  const blogJson = {
    version:
      10.4,

    capturedAt:
      new Date()
        .toISOString(),

    url:
      BLOG_URL,

    hostname:
      new URL(
        BLOG_URL
      ).hostname,

    siteTitle,

    description,

    pageHeading,

    ogImage,

    language,

    feedUrl,

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
    "BLOG ANALYZER v10.4 COMPLETE"
  );

  console.log(
    `blog.json: ${jsonPath}`
  );

  console.log(
    `Posts: ${posts.length}`
  );

  console.log(
    "============================================================"
  );
}

// ============================================================
// Execute
// ============================================================

main()
  .catch(
    error => {
      console.error(
        "\n============================================================"
      );

      console.error(
        "BLOG ANALYZER v10.4 FAILED"
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
