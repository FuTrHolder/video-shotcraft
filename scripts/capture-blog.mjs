import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {execFileSync} from "node:child_process";

const rawUrl = process.argv[2];

if (!rawUrl) {
  console.error("Usage: node scripts/capture-blog.mjs <blog-url>");
  process.exit(1);
}

const stripMarkdownUrl = (value) => {
  const text = String(value || "").trim();
  const match = text.match(
    /^\[[^\]]+\]\((https?:\/\/[^)]+)\)$/i,
  );

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

const OUTPUT_DIR = path.resolve(
  "template/public/blog",
);

const POSTS_DIR = path.join(
  OUTPUT_DIR,
  "images",
);

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

const unique = (items) =>
  [...new Set(
    (items || []).filter(Boolean),
  )];

const asArray = (value) =>
  Array.isArray(value)
    ? value
    : value
      ? [value]
      : [];

const absoluteUrl = (value) => {
  if (!value) {
    return "";
  }

  try {
    const url = new URL(
      String(value).trim(),
      parsedUrl.href,
    );

    if (
      !["http:", "https:"].includes(
        url.protocol,
      )
    ) {
      return "";
    }

    return url.href;
  } catch {
    return "";
  }
};

/*
 * ============================================================
 * Blogger image URL normalization
 * ============================================================
 *
 * Converts:
 *
 * /s72-c/image.jpg
 * /s300/image.jpg
 * /s1600/image.jpg
 * /w144-h144-p-k-no-nu/image.jpg
 * /w600-h338-p-k-no-nu/image.jpg
 * /w1000-h562-p-k-no/image.jpg
 *
 * into:
 *
 * /s1600/image.jpg
 *
 * This lets Blogger thumbnail/size variants resolve to
 * the same original image.
 */

const normalizeBloggerImageUrl = (value) => {
  const url = absoluteUrl(value);

  if (!url) {
    return "";
  }

  let normalized = url;

  /*
   * /s72-c/
   * /s300/
   * /s640/
   * /s1600/
   */
  normalized = normalized.replace(
    /\/s\d+(?:-[^/]+)?\//gi,
    "/s1600/",
  );

  /*
   * /w144-h144-p-k-no-nu/
   * /w600-h338-p-k-no-nu/
   * /w1000-h562-p-k-no/
   */
  normalized = normalized.replace(
    /\/w\d+(?:-h\d+)?(?:-[^/]+)*\//gi,
    "/s1600/",
  );

  /*
   * Query-string variants.
   */
  normalized = normalized.replace(
    /=s\d+(?:-[^&]*)?/gi,
    "=s1600",
  );

  normalized = normalized.replace(
    /=w\d+(?:-h\d+)?(?:-[^&]*)?/gi,
    "=s1600",
  );

  try {
    const parsed = new URL(normalized);

    for (const key of [
      "w",
      "h",
      "s",
      "resize",
      "crop",
    ]) {
      parsed.searchParams.delete(key);
    }

    normalized = parsed.href;
  } catch {
    // Keep normalized URL.
  }

  return normalized;
};

const decodeHtml = (value = "") =>
  String(value)
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, "/");

const stripHtml = (value = "") =>
  clean(
    decodeHtml(
      String(value)
        .replace(
          /<script[\s\S]*?<\/script>/gi,
          " ",
        )
        .replace(
          /<style[\s\S]*?<\/style>/gi,
          " ",
        )
        .replace(
          /<[^>]+>/g,
          " ",
        ),
    ),
  );

/*
 * ============================================================
 * HTML image extraction
 * ============================================================
 *
 * Priority:
 *
 * 1. data-src
 * 2. data-original
 * 3. data-lazy-src
 * 4. data-lazy
 * 5. src
 * 6. srcset
 * 7. CSS background-image
 */

const htmlImageCandidates = (html = "") => {
  const candidates = [];
  const source = String(html);

  /*
   * <img>
   */
  for (
    const match of source.matchAll(
      /<img\b[^>]*>/gi,
    )
  ) {
    const tag = match[0];

    for (
      const attr of [
        "data-src",
        "data-original",
        "data-lazy-src",
        "data-lazy",
        "src",
      ]
    ) {
      const escapedAttr = attr.replace(
        /[-/\\^$*+?.()|[\]{}]/g,
        "\\$&",
      );

      const value = tag.match(
        new RegExp(
          `${escapedAttr}\\s*=\\s*["']([^"']+)`,
          "i",
        ),
      )?.[1];

      if (value) {
        candidates.push(value);
      }
    }

    /*
     * srcset
     */
    const srcset =
      tag.match(
        /(?:srcset|data-srcset)\s*=\s*["']([^"']+)/i,
      )?.[1] || "";

    for (
      const item of srcset.split(",")
    ) {
      const url = item
        .trim()
        .split(/\s+/)[0];

      if (url) {
        candidates.push(url);
      }
    }
  }

  /*
   * CSS background-image.
   *
   * Some Blogger templates use a background image
   * instead of <img>.
   */
  for (
    const match of source.matchAll(
      /background-image\s*:\s*url\(\s*["']?([^"')]+)["']?\s*\)/gi,
    )
  ) {
    candidates.push(match[1]);
  }

  /*
   * data-image / data-image-url
   */
  for (
    const match of source.matchAll(
      /(?:data-image|data-image-url)\s*=\s*["']([^"']+)["']/gi,
    )
  ) {
    candidates.push(match[1]);
  }

  return unique(
    candidates
      .map(normalizeBloggerImageUrl)
      .filter(Boolean),
  );
};

/*
 * ============================================================
 * Meta image extraction
 * ============================================================
 *
 * These are FALLBACKS only.
 *
 * They are intentionally not used before article/feed images.
 */

const metaImageCandidates = (html = "") => {
  const candidates = [];

  for (
    const match of String(html).matchAll(
      /<meta\b[^>]*>/gi,
    )
  ) {
    const tag = match[0];

    const property =
      tag
        .match(
          /(?:property|name)\s*=\s*["']([^"']+)["']/i,
        )?.[1]
        ?.toLowerCase() || "";

    if (
      ![
        "og:image",
        "twitter:image",
        "twitter:image:src",
        "image_src",
      ].includes(property)
    ) {
      continue;
    }

    const content =
      tag.match(
        /content\s*=\s*["']([^"']+)["']/i,
      )?.[1] || "";

    if (content) {
      candidates.push(content);
    }
  }

  return unique(
    candidates
      .map(normalizeBloggerImageUrl)
      .filter(Boolean),
  );
};

/*
 * ============================================================
 * Balanced HTML element extraction
 * ============================================================
 *
 * Regular expressions alone cannot safely extract nested
 * <div> structures.
 *
 * This helper finds the matching closing tag by tracking
 * nested elements of the same type.
 */

const extractBalancedTag = (
  html,
  start,
  tagName,
) => {
  const source = String(html);

  const tagRe = new RegExp(
    `</?${tagName}\\b[^>]*>`,
    "gi",
  );

  tagRe.lastIndex = start;

  let depth = 0;

  for (
    const match of source
      .slice(start)
      .matchAll(tagRe)
  ) {
    const tag = match[0];

    const end =
      start +
      match.index +
      tag.length;

    if (/^<\//.test(tag)) {
      depth -= 1;

      if (depth === 0) {
        return source.slice(
          start,
          end,
        );
      }
    } else if (
      !/\/>$/.test(tag)
    ) {
      depth += 1;
    }
  }

  return "";
};

/*
 * ============================================================
 * Extract element by class
 * ============================================================
 */

const extractElementByClass = (
  html,
  classToken,
) => {
  const source = String(html);

  const openRe = new RegExp(
    `<([a-z0-9]+)\\b[^>]*\\bclass\\s*=\\s*["'][^"']*\\b${classToken}\\b[^"']*["'][^>]*>`,
    "i",
  );

  const match =
    openRe.exec(source);

  if (!match) {
    return "";
  }

  const tagName =
    match[1].toLowerCase();

  const start =
    match.index;

  return extractBalancedTag(
    source,
    start,
    tagName,
  );
};

/*
 * ============================================================
 * Find the exact post container by TITLE
 * ============================================================
 *
 * This is the most important v8 fix.
 *
 * We do NOT simply search the whole post page for images.
 *
 * Instead:
 *
 *     Post title
 *          ↓
 *     nearest <article>
 *          ↓
 *     nearest Blogger post container
 *          ↓
 *     post-body
 *          ↓
 *     images
 *
 * This prevents related-post cards, sidebar images and other
 * posts from entering the candidate list.
 */

const findTitleScopedContainer = (
  html,
  title,
) => {
  const source = String(html);

  const wanted =
    clean(title);

  if (!wanted) {
    return "";
  }

  for (
    const match of source.matchAll(
      /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi,
    )
  ) {
    const headingText =
      clean(
        stripHtml(match[1]),
      );

    if (
      headingText !== wanted
    ) {
      continue;
    }

    const headingStart =
      match.index;

    /*
     * --------------------------------------------------------
     * 1. Prefer nearest enclosing <article>
     * --------------------------------------------------------
     */

    const articleStarts =
      [
        ...source
          .slice(0, headingStart)
          .matchAll(
            /<article\b[^>]*>/gi,
          ),
      ];

    for (
      let i =
        articleStarts.length - 1;
      i >= 0;
      i--
    ) {
      const start =
        articleStarts[i].index;

      const article =
        extractBalancedTag(
          source,
          start,
          "article",
        );

      if (
        article &&
        start <= headingStart &&
        start + article.length >
          headingStart
      ) {
        return article;
      }
    }

    /*
     * --------------------------------------------------------
     * 2. Blogger <div class="post hentry">
     * --------------------------------------------------------
     */

    const divStarts =
      [
        ...source
          .slice(0, headingStart)
          .matchAll(
            /<div\b[^>]*\bclass\s*=\s*["'][^"']*\b(?:post|hentry|post-outer)\b[^"']*["'][^>]*>/gi,
          ),
      ];

    for (
      let i =
        divStarts.length - 1;
      i >= 0;
      i--
    ) {
      const start =
        divStarts[i].index;

      const div =
        extractBalancedTag(
          source,
          start,
          "div",
        );

      if (
        div &&
        start + div.length >
          headingStart
      ) {
        return div;
      }
    }
  }

  return "";
};

/*
 * ============================================================
 * Extract the current post body
 * ============================================================
 */

const extractFirstArticleBody = (
  html,
  title,
) => {
  const source = String(html);

  /*
   * FIRST:
   *
   * Isolate the exact container belonging to the title.
   */
  const scopedContainer =
    findTitleScopedContainer(
      source,
      title,
    );

  if (scopedContainer) {
    const classTokens = [
      "post-body",
      "post-body-container",
      "entry-content",
      "post-content",
    ];

    for (
      const token of classTokens
    ) {
      const section =
        extractElementByClass(
          scopedContainer,
          token,
        );

      if (
        section &&
        htmlImageCandidates(
          section,
        ).length
      ) {
        return {
          html: section,
          method:
            `title-scoped:${token}`,
        };
      }
    }

    /*
     * If there is no recognizable body class,
     * use the isolated post container itself.
     */
    if (
      htmlImageCandidates(
        scopedContainer,
      ).length
    ) {
      return {
        html: scopedContainer,
        method:
          "title-scoped:container",
      };
    }
  }

  /*
   * ----------------------------------------------------------
   * PAGE-LOCAL FALLBACKS
   * ----------------------------------------------------------
   *
   * These still operate on THIS post page.
   *
   * They never use the whole Blogger feed.
   */

  const classTokens = [
    "post-body",
    "post-body-container",
    "entry-content",
    "post-content",
  ];

  for (
    const token of classTokens
  ) {
    const section =
      extractElementByClass(
        source,
        token,
      );

    if (
      section &&
      htmlImageCandidates(
        section,
      ).length
    ) {
      return {
        html: section,
        method:
          `page-fallback:${token}`,
      };
    }
  }

  /*
   * Article fallback.
   */
  const articleOpen =
    /<article\b[^>]*>/i.exec(
      source,
    );

  if (articleOpen) {
    const start =
      articleOpen.index;

    const article =
      extractBalancedTag(
        source,
        start,
        "article",
      );

    if (
      article &&
      htmlImageCandidates(
        article,
      ).length
    ) {
      return {
        html: article,
        method:
          "page-fallback:article",
      };
    }
  }

  return {
    html: "",
    method: "none",
  };
};

/*
 * ============================================================
 * HTTP
 * ============================================================
 */

const fetchText = async (
  url,
) => {
  const response =
    await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; BlogPromoBot/1.0)",
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });

  if (!response.ok) {
    throw new Error(
      `${response.status} ${response.statusText}`,
    );
  }

  return response.text();
};

const fetchJson = async (
  url,
) => {
  const response =
    await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; BlogPromoBot/1.0)",
        accept:
          "application/json,text/javascript,*/*;q=0.8",
      },
      redirect: "follow",
    });

  if (!response.ok) {
    throw new Error(
      `${response.status} ${response.statusText}`,
    );
  }

  return response.json();
};

/*
 * ============================================================
 * Blogger feed helpers
 * ============================================================
 */

const getEntryLink = (
  entry,
) => {
  const links =
    Array.isArray(entry?.link)
      ? entry.link
      : [];

  return (
    links.find(
      (item) =>
        item.rel ===
        "alternate",
    )?.href ||
    links.find(
      (item) =>
        item.href,
    )?.href ||
    ""
  );
};

/*
 * IMPORTANT:
 *
 * feedImageCandidates(entry) only examines THIS Blogger
 * feed entry.
 *
 * It does not inspect the homepage.
 */

const feedImageCandidates = (
  entry,
) => {
  const body = unique([
    ...htmlImageCandidates(
      entry?.content?.$t ||
        "",
    ),
    ...htmlImageCandidates(
      entry?.summary?.$t ||
        "",
    ),
  ]);

  const media = [];

  const group =
    entry?.media$group;

  if (group) {
    for (
      const item of asArray(
        group.media$content,
      )
    ) {
      if (item?.url) {
        media.push(
          item.url,
        );
      }
    }

    for (
      const item of asArray(
        group.media$thumbnail,
      )
    ) {
      if (item?.url) {
        media.push(
          item.url,
        );
      }
    }
  }

  const thumbnail =
    entry?.media$thumbnail?.url
      ? [
          entry.media$thumbnail.url,
        ]
      : [];

  return {
    body: unique(
      body
        .map(
          normalizeBloggerImageUrl,
        )
        .filter(Boolean),
    ),

    media: unique(
      media
        .map(
          normalizeBloggerImageUrl,
        )
        .filter(Boolean),
    ),

    thumbnail: unique(
      thumbnail
        .map(
          normalizeBloggerImageUrl,
        )
        .filter(Boolean),
    ),
  };
};

/*
 * ============================================================
 * ImageMagick
 * ============================================================
 *
 * Supports both:
 *
 * ImageMagick 7:
 *     magick
 *
 * ImageMagick 6 on Ubuntu 24.04:
 *     convert
 *
 * We no longer require a fake "magick" symlink.
 */

const detectImageTool = () => {
  for (
    const command of [
      "magick",
      "convert",
    ]
  ) {
    try {
      const version =
        execFileSync(
          command,
          ["-version"],
          {
            encoding: "utf8",
            stdio: [
              "ignore",
              "pipe",
              "pipe",
            ],
          },
        ).trim();

      console.log(
        `ImageMagick command: ${command}`,
      );

      console.log(
        version
          .split("\n")
          .find(Boolean) ||
          "ImageMagick detected",
      );

      return command;
    } catch {
      // Try next command.
    }
  }

  console.error(
    "ERROR: ImageMagick is required.",
  );

  console.error(
    "Expected either 'magick' or 'convert'.",
  );

  process.exit(1);
};

const IMAGE_TOOL =
  detectImageTool();

const runImageMagick = (
  args,
  input,
) =>
  execFileSync(
    IMAGE_TOOL,
    args,
    {
      input,
      maxBuffer:
        1024 * 1024 * 8,
      stdio: [
        "pipe",
        "pipe",
        "pipe",
      ],
    },
  );

/*
 * ============================================================
 * Image information
 * ============================================================
 */

const getImageInfo = (
  buffer,
) => {
  try {
    const text =
      runImageMagick(
        [
          "-",
          "-auto-orient",
          "-format",
          "%m|%w|%h|%z",
          "info:",
        ],
        buffer,
      )
        .toString("utf8")
        .trim();

    const [
      format,
      width,
      height,
      depth,
    ] = text.split("|");

    return {
      format:
        format || "",
      width:
        Number(width) || 0,
      height:
        Number(height) || 0,
      depth:
        Number(depth) || 0,
    };
  } catch {
    return {
      format: "",
      width: 0,
      height: 0,
      depth: 0,
    };
  }
};

/*
 * ============================================================
 * Perceptual image fingerprint
 * ============================================================
 */

const getVisualFingerprint = (
  buffer,
) => {
  const output =
    runImageMagick(
      [
        "-",
        "-auto-orient",
        "-colorspace",
        "Gray",
        "-resize",
        "64x64!",
        "-depth",
        "8",
        "gray:-",
      ],
      buffer,
    );

  if (
    output.length !==
    64 * 64
  ) {
    throw new Error(
      `Unexpected ImageMagick output size: ${output.length}`,
    );
  }

  /*
   * Quantized canonical pixels.
   *
   * 8-bit → 4-bit.
   */
  const quantized =
    Buffer.alloc(
      output.length,
    );

  for (
    let i = 0;
    i < output.length;
    i++
  ) {
    quantized[i] =
      output[i] >> 4;
  }

  const canonicalHash =
    crypto
      .createHash("sha256")
      .update(quantized)
      .digest("hex");

  /*
   * Average hash.
   */
  const average =
    output.reduce(
      (sum, value) =>
        sum + value,
      0,
    ) / output.length;

  let averageHash = "";

  for (
    const value of output
  ) {
    averageHash +=
      value >= average
        ? "1"
        : "0";
  }

  /*
   * Difference hash.
   */
  let differenceHash = "";

  for (
    let y = 0;
    y < 64;
    y++
  ) {
    for (
      let x = 0;
      x < 63;
      x++
    ) {
      const left =
        output[
          y * 64 + x
        ];

      const right =
        output[
          y * 64 + x + 1
        ];

      differenceHash +=
        right >= left
          ? "1"
          : "0";
    }
  }

  return {
    canonicalHash,
    averageHash,
    differenceHash,
  };
};

const hammingDistance = (
  a,
  b,
) => {
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
};

const isVisuallyDuplicate = (
  a,
  b,
) => {
  if (!a || !b) {
    return false;
  }

  if (
    a.canonicalHash ===
    b.canonicalHash
  ) {
    return true;
  }

  const averageDistance =
    hammingDistance(
      a.averageHash,
      b.averageHash,
    );

  const differenceDistance =
    hammingDistance(
      a.differenceHash,
      b.differenceHash,
    );

  return (
    averageDistance <= 180 &&
    differenceDistance <= 180
  );
};

/*
 * ============================================================
 * Content image validation
 * ============================================================
 */

const isLikelyContentImage = (
  buffer,
  info,
) => {
  if (
    !buffer ||
    buffer.length < 5000
  ) {
    return false;
  }

  if (
    !info.width ||
    !info.height
  ) {
    return false;
  }

  /*
   * Reject tiny icons, avatars, logos,
   * tracking pixels and thumbnails.
   */
  if (
    info.width < 250 ||
    info.height < 150
  ) {
    return false;
  }

  if (
    info.width *
      info.height <
    50000
  ) {
    return false;
  }

  return true;
};

/*
 * ============================================================
 * Download and analyze an image
 * ============================================================
 */

const downloadImage = async (
  url,
) => {
  try {
    const response =
      await fetch(url, {
        headers: {
          "user-agent":
            "Mozilla/5.0 (compatible; BlogPromoBot/1.0)",
          accept:
            "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        },
        redirect: "follow",
      });

    if (!response.ok) {
      return null;
    }

    const contentType =
      response.headers.get(
        "content-type",
      ) || "";

    if (
      !contentType.startsWith(
        "image/",
      )
    ) {
      return null;
    }

    const arrayBuffer =
      await response.arrayBuffer();

    const buffer =
      Buffer.from(
        arrayBuffer,
      );

    const info =
      getImageInfo(
        buffer,
      );

    if (
      !isLikelyContentImage(
        buffer,
        info,
      )
    ) {
      return null;
    }

    const hash =
      crypto
        .createHash(
          "sha256",
        )
        .update(buffer)
        .digest("hex");

    const fingerprint =
      getVisualFingerprint(
        buffer,
      );

    return {
      buffer,
      bytes:
        buffer.length,
      hash,
      fingerprint,
      info,
    };
  } catch {
    return null;
  }
};

/*
 * ============================================================
 * Candidate helper
 * ============================================================
 */

const makeCandidate = (
  url,
  source,
  priority,
) => ({
  url:
    normalizeBloggerImageUrl(
      url,
    ),
  source,
  priority,
});

/*
 * ============================================================
 * POST-LOCAL IMAGE SELECTION
 * ============================================================
 *
 * THIS IS THE CORE v8 FIX.
 *
 * Candidate priority:
 *
 *   10  Blogger feed content for THIS entry
 *   20  Actual post body for THIS URL
 *   30  Metadata from THIS URL
 *   40  Blogger media for THIS entry
 *   50  Blogger thumbnail for THIS entry
 *
 * There is NO global "used image pool".
 *
 * Each post independently chooses its own best image.
 *
 * Duplicate checking occurs only AFTER all posts have been
 * independently resolved.
 */

const selectPostImage = async (
  post,
) => {
  const candidates = [];

  const addCandidates = (
    urls,
    source,
    priority,
  ) => {
    for (
      const url of urls || []
    ) {
      const normalized =
        normalizeBloggerImageUrl(
          url,
        );

      if (!normalized) {
        continue;
      }

      /*
       * Only remove duplicates WITHIN THIS POST'S candidate
       * list. We never compare against another post here.
       */
      if (
        candidates.some(
          (item) =>
            item.url ===
            normalized,
        )
      ) {
        continue;
      }

      candidates.push(
        makeCandidate(
          normalized,
          source,
          priority,
        ),
      );
    }
  };

  /*
   * ----------------------------------------------------------
   * 1. THIS POST'S BLOGGER FEED ENTRY
   * ----------------------------------------------------------
   *
   * This is the strongest source because a feed entry belongs
   * to one specific post.
   */

  addCandidates(
    post.feedImages.body,
    "feed-content",
    10,
  );

  /*
   * ----------------------------------------------------------
   * 2. THIS POST'S ACTUAL PAGE
   * ----------------------------------------------------------
   */

  if (post.pageHtml) {
    const body =
      extractFirstArticleBody(
        post.pageHtml,
        post.title,
      );

    if (body.html) {
      console.log(
        `  Article image container: ${body.method}`,
      );

      addCandidates(
        htmlImageCandidates(
          body.html,
        ),
        "post-body",
        20,
      );
    }
  }

  /*
   * ----------------------------------------------------------
   * 3. THIS POST'S OG/Twitter image
   * ----------------------------------------------------------
   */

  if (post.pageHtml) {
    addCandidates(
      metaImageCandidates(
        post.pageHtml,
      ),
      "post-meta",
      30,
    );
  }

  /*
   * ----------------------------------------------------------
   * 4. THIS POST'S Blogger media
   * ----------------------------------------------------------
   */

  addCandidates(
    post.feedImages.media,
    "feed-media",
    40,
  );

  /*
   * ----------------------------------------------------------
   * 5. THIS POST'S thumbnail
   * ----------------------------------------------------------
   */

  addCandidates(
    post.feedImages.thumbnail,
    "feed-thumbnail",
    50,
  );

  candidates.sort(
    (a, b) =>
      a.priority -
      b.priority,
  );

  console.log(
    `  Image candidates belonging to this post: ${candidates.length}`,
  );

  console.log(
    "  Selection scope: THIS POST ONLY",
  );

  candidates
    .slice(0, 10)
    .forEach(
      (
        candidate,
        index,
      ) => {
        console.log(
          `    Candidate ${index + 1} [${candidate.source}]: ${candidate.url}`,
        );
      },
    );

  /*
   * ----------------------------------------------------------
   * Download candidates in priority order.
   * ----------------------------------------------------------
   */

  for (
    const candidate of candidates
  ) {
    const image =
      await downloadImage(
        candidate.url,
      );

    if (!image) {
      console.log(
        `    Rejected image (not a usable content image): ${candidate.url}`,
      );

      continue;
    }

    return {
      ...candidate,
      ...image,
    };
  }

  return null;
};

/*
 * ============================================================
 * Blog analysis defaults
 * ============================================================
 */

const analysis = {
  identity: "",

  topics: [],

  audience:
    "Investors and market-focused readers",

  contentStyle:
    "Educational and explanatory",

  valueProposition:
    "Clear market context, timely analysis and practical insights for investors.",
};

/*
 * ============================================================
 * START
 * ============================================================
 */

console.log(
  "========================================",
);

console.log(
  "BLOG ANALYZER v8",
);

console.log(
  "========================================",
);

console.log(
  `Blog URL: ${parsedUrl.href}`,
);

console.log(
  `Output: ${OUTPUT_DIR}`,
);

console.log(
  "========================================",
);

let feed;
let homepageHtml = "";

/*
 * Homepage.
 */
try {
  homepageHtml =
    await fetchText(
      parsedUrl.href,
    );
} catch (error) {
  console.warn(
    `Homepage fetch failed: ${error.message}`,
  );
}

/*
 * Blogger feed.
 */

const feedUrl =
  new URL(
    "/feeds/posts/default?alt=json&max-results=10",
    parsedUrl.origin,
  ).href;

console.log(
  `Fetching Blogger feed: ${feedUrl}`,
);

try {
  feed =
    await fetchJson(
      feedUrl,
    );
} catch (error) {
  console.error(
    `Failed to fetch Blogger feed: ${error.message}`,
  );

  process.exit(1);
}

const feedData =
  feed?.feed || {};

const entries =
  Array.isArray(
    feedData.entry,
  )
    ? feedData.entry
    : [];

if (!entries.length) {
  console.error(
    "No Blogger posts found.",
  );

  process.exit(1);
}

/*
 * ============================================================
 * Site analysis
 * ============================================================
 */

analysis.identity =
  clean(
    feedData.subtitle?.$t,
  ) ||
  clean(
    feedData.title?.$t,
  ) ||
  clean(
    homepageHtml.match(
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i,
    )?.[1] || "",
  );

analysis.topics =
  unique(
    entries
      .flatMap(
        (entry) =>
          asArray(
            entry?.category,
          ).map(
            (item) =>
              clean(
                item?.term,
              ),
          ),
      )
      .filter(Boolean),
  ).slice(0, 8);

/*
 * ============================================================
 * Build post records
 * ============================================================
 */

const posts =
  entries
    .slice(0, 5)
    .map(
      (
        entry,
        index,
      ) => ({
        index,

        title:
          clean(
            entry?.title?.$t,
          ),

        url:
          absoluteUrl(
            getEntryLink(
              entry,
            ),
          ),

        published:
          entry?.published?.$t ||
          "",

        date:
          entry?.published?.$t
            ? new Date(
                entry.published.$t,
              ).toLocaleDateString(
                "en-US",
                {
                  month:
                    "long",
                  day:
                    "2-digit",
                  year:
                    "numeric",
                },
              )
            : "",

        excerpt:
          clean(
            stripHtml(
              entry?.content?.$t ||
                entry?.summary?.$t ||
                "",
            ),
          ).slice(
            0,
            500,
          ),

        categories:
          asArray(
            entry?.category,
          )
            .map(
              (item) =>
                clean(
                  item?.term,
                ),
            )
            .filter(Boolean),

        /*
         * CRITICAL:
         *
         * These candidates belong ONLY to this feed entry.
         */
        feedImages:
          feedImageCandidates(
            entry,
          ),

        pageHtml: "",
      }),
    );

if (
  posts.length !== 5
) {
  console.error(
    `Expected at least 5 posts, got ${posts.length}`,
  );

  process.exit(1);
}

/*
 * ============================================================
 * Fetch EACH post page
 * ============================================================
 *
 * No image is selected yet.
 *
 * First we collect the actual page belonging to every post.
 */

for (
  let i = 0;
  i < posts.length;
  i++
) {
  const post =
    posts[i];

  if (!post.url) {
    console.error(
      `Post ${i + 1} has no alternate URL.`,
    );

    process.exit(1);
  }

  console.log("");

  console.log(
    `Post ${i + 1}: ${post.title}`,
  );

  console.log(
    `  URL: ${post.url}`,
  );

  try {
    post.pageHtml =
      await fetchText(
        post.url,
      );

    console.log(
      `  Article page fetched: ${post.pageHtml.length} bytes`,
    );
  } catch (error) {
    console.warn(
      `  Article page fetch failed: ${error.message}`,
    );
  }
}

/*
 * ============================================================
 * Independently select image for every post
 * ============================================================
 *
 * IMPORTANT:
 *
 * There is intentionally NO:
 *
 *     usedImages
 *     usedHashes
 *     usedFingerprints
 *
 * here.
 *
 * Every post is resolved independently.
 */

const selected = [];

for (
  let i = 0;
  i < posts.length;
  i++
) {
  const post =
    posts[i];

  console.log("");

  console.log(
    `Selecting image for Post ${i + 1}: ${post.title}`,
  );

  const image =
    await selectPostImage(
      post,
    );

  if (!image) {
    console.error(
      `ERROR: No usable image found for Post ${i + 1}: ${post.title}`,
    );

    process.exit(1);
  }

  let extension =
    ".jpg";

  const format =
    image.info.format.toLowerCase();

  if (
    format === "png"
  ) {
    extension =
      ".png";
  } else if (
    format === "webp"
  ) {
    extension =
      ".webp";
  } else if (
    format === "jpeg" ||
    format === "jpg"
  ) {
    extension =
      ".jpg";
  } else {
    try {
      extension =
        path.extname(
          new URL(
            image.url,
          ).pathname,
        ) || ".jpg";
    } catch {
      extension =
        ".jpg";
    }
  }

  const localImage =
    `blog/images/post-${i + 1}${extension}`;

  fs.writeFileSync(
    path.join(
      "template/public",
      localImage,
    ),
    image.buffer,
  );

  selected.push({
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

    localImage,

    imageUrl:
      image.url,

    imageSource:
      image.source,

    imageHash:
      image.hash,

    imageBytes:
      image.bytes,

    imageWidth:
      image.info.width,

    imageHeight:
      image.info.height,

    imageFormat:
      image.info.format,

    visualFingerprint:
      image.fingerprint,
  });

  console.log(
    `  Selected image: ${localImage}`,
  );

  console.log(
    `  Selected source: ${image.source}`,
  );

  console.log(
    `  Selected URL: ${image.url}`,
  );

  console.log(
    `  Dimensions: ${image.info.width}x${image.info.height}`,
  );

  console.log(
    `  Bytes: ${image.bytes}`,
  );
}

/*
 * ============================================================
 * CROSS-POST VALIDATION
 * ============================================================
 *
 * This is intentionally AFTER selection.
 *
 * If two posts genuinely resolve to the same image:
 *
 *     FAIL
 *
 * We do NOT silently substitute another image.
 *
 * This prevents the v7 "leftover image assignment" problem.
 */

const hashOwners =
  new Map();

const fingerprintOwners =
  [];

for (
  const post of selected
) {
  const previous =
    hashOwners.get(
      post.imageHash,
    );

  if (previous) {
    throw new Error(
      [
        "Exact duplicate image detected:",
        `Post ${post.index + 1}`,
        `duplicates Post ${previous.index + 1}`,
        `(${post.imageUrl})`,
      ].join(" "),
    );
  }

  hashOwners.set(
    post.imageHash,
    post,
  );

  for (
    const owner of
      fingerprintOwners
  ) {
    if (
      isVisuallyDuplicate(
        post.visualFingerprint,
        owner.visualFingerprint,
      )
    ) {
      throw new Error(
        [
          "Visual duplicate image detected:",
          `Post ${post.index + 1}`,
          `duplicates Post ${owner.index + 1}`,
          `(${post.imageUrl})`,
        ].join(" "),
      );
    }
  }

  fingerprintOwners.push(
    post,
  );
}

/*
 * ============================================================
 * Build blog.json
 * ============================================================
 */

const blog = {
  version: 8,

  capturedAt:
    new Date().toISOString(),

  url:
    parsedUrl.href,

  hostname:
    parsedUrl.hostname,

  siteTitle:
    clean(
      feedData.title?.$t,
    ) ||
    parsedUrl.hostname,

  description:
    analysis.identity,

  pageHeading:
    clean(
      homepageHtml.match(
        /<h1\b[^>]*>([\s\S]*?)<\/h1>/i,
      )?.[1] || "",
    ),

  ogImage:
    metaImageCandidates(
      homepageHtml,
    )[0] || "",

  language:
    "en",

  postCount:
    selected.length,

  analysis: {
    identity:
      analysis.identity,

    topics:
      analysis.topics,

    audience:
      analysis.audience,

    contentStyle:
      analysis.contentStyle,

    valueProposition:
      analysis.valueProposition,
  },

  posts:
    selected.map(
      ({
        visualFingerprint,
        ...post
      }) => post,
    ),

  imageStats: {
    realImages:
      selected.length,

    uniqueImages:
      new Set(
        selected.map(
          (post) =>
            post.imageHash,
        ),
      ).size,

    requiredImages:
      5,
  },
};

fs.writeFileSync(
  path.join(
    OUTPUT_DIR,
    "blog.json",
  ),
  JSON.stringify(
    blog,
    null,
    2,
  ),
);

/*
 * ============================================================
 * COMPLETE
 * ============================================================
 */

console.log("");

console.log(
  "========================================",
);

console.log(
  "BLOG CAPTURE COMPLETE",
);

console.log(
  "========================================",
);

console.log(
  `Posts: ${selected.length}`,
);

console.log(
  `Real images: ${selected.length}/${selected.length}`,
);

console.log(
  `Unique images: ${new Set(
    selected.map(
      (post) =>
        post.imageHash,
    ),
  ).size}/${selected.length}`,
);

console.log(
  `Output: ${OUTPUT_DIR}/blog.json`,
);

console.log(
  "========================================",
);
