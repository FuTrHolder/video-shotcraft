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

fs.rmSync(OUTPUT_DIR, {recursive: true, force: true});
fs.mkdirSync(POSTS_DIR, {recursive: true});

const clean = (value = "") =>
  String(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const unique = (items) =>
  [...new Set((items || []).filter(Boolean))];

const asArray = (value) =>
  Array.isArray(value)
    ? value
    : value
      ? [value]
      : [];

const absoluteUrl = (value) => {
  if (!value) return "";

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

const normalizeBloggerImageUrl = (value) => {
  const url = absoluteUrl(value);

  if (!url) return "";

  return url
    .replace(
      /\/s\d+(?:-c)?\//i,
      "/s1600/",
    )
    .replace(
      /=s\d+(?:-c)?(?:-[^&]*)?/i,
      "=s1600",
    )
    .replace(
      /\/w\d+-h\d+(?:-p-k-no)?\//i,
      "/s1600/",
    );
};

const decodeHtml = (value = "") =>
  String(value)
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");

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

const htmlImageCandidates = (html = "") => {
  const candidates = [];
  const source = String(html);

  const imgRe = /<img\b[^>]*>/gi;

  for (const match of source.matchAll(imgRe)) {
    const tag = match[0];

    for (const attr of [
      "data-src",
      "data-original",
      "data-lazy-src",
      "src",
    ]) {
      const m = tag.match(
        new RegExp(
          `${attr}\\s*=\\s*[\\\"']([^\\\"']+)`,
          "i",
        ),
      );

      if (m?.[1]) {
        candidates.push(m[1]);
      }
    }

    const srcset =
      tag.match(
        /(?:srcset|data-srcset)\s*=\s*[\"']([^\"']+)/i,
      )?.[1] || "";

    if (srcset) {
      for (const item of srcset.split(",")) {
        const url = item
          .trim()
          .split(/\s+/)[0];

        if (url) {
          candidates.push(url);
        }
      }
    }
  }

  return unique(
    candidates.map(
      normalizeBloggerImageUrl,
    ),
  );
};

const metaImageCandidates = (html = "") => {
  const candidates = [];
  const metaRe = /<meta\b[^>]*>/gi;

  for (const match of String(html).matchAll(metaRe)) {
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
    candidates.map(
      normalizeBloggerImageUrl,
    ),
  );
};

const fetchText = async (url) => {
  const response = await fetch(url, {
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

const fetchJson = async (url) => {
  const response = await fetch(url, {
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

const getEntryLink = (entry) => {
  const links = Array.isArray(entry?.link)
    ? entry.link
    : [];

  return (
    links.find(
      (item) =>
        item.rel === "alternate",
    )?.href ||
    links[0]?.href ||
    ""
  );
};

const feedImageCandidates = (entry) => {
  const candidates = [];

  const add = (value) => {
    if (
      typeof value === "string" &&
      value.trim()
    ) {
      candidates.push(
        value.trim(),
      );
    }
  };

  add(
    entry?.media$thumbnail?.url,
  );

  const group =
    entry?.media$group;

  if (group) {
    for (const item of asArray(
      group.media$content,
    )) {
      add(item?.url);
    }

    for (const item of asArray(
      group.media$thumbnail,
    )) {
      add(item?.url);
    }
  }

  const content =
    entry?.content?.$t || "";

  const summary =
    entry?.summary?.$t || "";

  candidates.push(
    ...htmlImageCandidates(
      content,
    ),
  );

  candidates.push(
    ...htmlImageCandidates(
      summary,
    ),
  );

  return unique(
    candidates.map(
      normalizeBloggerImageUrl,
    ),
  );
};

const hashBuffer = (buffer) =>
  crypto
    .createHash("sha256")
    .update(buffer)
    .digest("hex");

const getVisualFingerprint = (
  buffer,
) => {
  /*
   * Build several content-based signatures
   * from a canonical representation of the
   * downloaded image.
   *
   * This is intentionally stronger than SHA-256
   * of the original file because the same photo
   * may be served as:
   *
   * - JPEG vs WebP
   * - different resolutions
   * - different compression levels
   * - different Blogger image-size URLs
   */

  try {
    const output = execFileSync(
      "magick",
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
      {
        input: buffer,
        maxBuffer:
          1024 * 1024,
        stdio: [
          "pipe",
          "pipe",
          "ignore",
        ],
      },
    );

    if (
      output.length !==
      64 * 64
    ) {
      return null;
    }

    /*
     * Quantized canonical pixels.
     *
     * 8-bit grayscale ->
     * 4-bit grayscale.
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
      ) /
      output.length;

    let averageHash = "";

    for (const value of output) {
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
      const row = y * 64;

      for (
        let x = 0;
        x < 63;
        x++
      ) {
        differenceHash +=
          output[row + x] >
          output[row + x + 1]
            ? "1"
            : "0";
      }
    }

    /*
     * Coarse 16x16 block signature.
     *
     * Each block contains the average
     * luminance of a 4x4 area.
     */
    const blocks =
      Buffer.alloc(
        16 * 16,
      );

    for (
      let by = 0;
      by < 16;
      by++
    ) {
      for (
        let bx = 0;
        bx < 16;
        bx++
      ) {
        let sum = 0;

        for (
          let y = 0;
          y < 4;
          y++
        ) {
          for (
            let x = 0;
            x < 4;
            x++
          ) {
            const index =
              (by * 4 + y) *
                64 +
              (bx * 4 + x);

            sum +=
              output[index];
          }
        }

        blocks[
          by * 16 + bx
        ] =
          Math.round(
            sum / 16,
          ) >> 3;
      }
    }

    const blockHash =
      crypto
        .createHash("sha256")
        .update(blocks)
        .digest("hex");

    return {
      canonicalHash,
      blockHash,
      averageHash,
      differenceHash,
    };
  } catch {
    /*
     * If ImageMagick is unavailable,
     * SHA-256 still provides exact-byte
     * duplicate detection.
     */
    return null;
  }
};

const hammingDistance = (
  a,
  b,
) => {
  if (
    !a ||
    !b ||
    a.length !== b.length
  ) {
    return Number.POSITIVE_INFINITY;
  }

  let distance = 0;

  for (
    let i = 0;
    i < a.length;
    i++
  ) {
    if (a[i] !== b[i]) {
      distance++;
    }
  }

  return distance;
};

const isVisuallyDuplicate = (
  fingerprint,
  usedFingerprints,
) => {
  if (!fingerprint) {
    return false;
  }

  for (const previous of usedFingerprints) {
    /*
     * Same normalized/quantized
     * pixels.
     */
    if (
      fingerprint.canonicalHash &&
      previous.canonicalHash &&
      fingerprint.canonicalHash ===
        previous.canonicalHash
    ) {
      return true;
    }

    /*
     * Same coarse block signature.
     */
    if (
      fingerprint.blockHash &&
      previous.blockHash &&
      fingerprint.blockHash ===
        previous.blockHash
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

    /*
     * Conservative perceptual thresholds.
     */
    if (
      aHashDistance <= 48 &&
      dHashDistance <= 72
    ) {
      return true;
    }

    if (
      aHashDistance <= 24 ||
      dHashDistance <= 32
    ) {
      return true;
    }
  }

  return false;
};

const extensionFor = (
  contentType,
  url,
) => {
  const type = String(
    contentType || "",
  )
    .split(";")[0]
    .toLowerCase();

  if (
    type === "image/jpeg"
  ) {
    return ".jpg";
  }

  if (
    type === "image/png"
  ) {
    return ".png";
  }

  if (
    type === "image/webp"
  ) {
    return ".webp";
  }

  if (
    type === "image/gif"
  ) {
    return ".gif";
  }

  try {
    const ext =
      path
        .extname(
          new URL(url)
            .pathname,
        )
        .toLowerCase();

    if (
      [
        ".jpg",
        ".jpeg",
        ".png",
        ".webp",
        ".gif",
      ].includes(ext)
    ) {
      return ext;
    }
  } catch {
    // Ignore invalid extension.
  }

  return ".jpg";
};

const downloadUniqueImage = async (
  candidates,
  index,
  usedHashes,
  usedFingerprints,
) => {
  for (
    const candidate of unique(
      candidates,
    )
  ) {
    const url =
      normalizeBloggerImageUrl(
        candidate,
      );

    if (
      !url ||
      /^data:/i.test(url)
    ) {
      continue;
    }

    try {
      const response =
        await fetch(url, {
          headers: {
            "user-agent":
              "Mozilla/5.0 (compatible; BlogPromoBot/1.0)",
            accept:
              "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          },
          redirect:
            "follow",
        });

      if (!response.ok) {
        continue;
      }

      const contentType =
        response.headers.get(
          "content-type",
        ) || "";

      const buffer =
        Buffer.from(
          await response.arrayBuffer(),
        );

      if (
        !contentType
          .toLowerCase()
          .startsWith("image/")
      ) {
        continue;
      }

      if (
        buffer.length < 5000
      ) {
        continue;
      }

      /*
       * Exact byte duplicate.
       */
      const hash =
        hashBuffer(buffer);

      if (
        usedHashes.has(hash)
      ) {
        console.log(
          `  Exact duplicate image skipped: ${url}`,
        );

        continue;
      }

      /*
       * Perceptual duplicate.
       */
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
          `  Visual duplicate image skipped: ${url}`,
        );

        continue;
      }

      const ext =
        extensionFor(
          contentType,
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

      usedHashes.add(
        hash,
      );

      if (fingerprint) {
        usedFingerprints.push(
          fingerprint,
        );
      }

      return {
        localImage:
          `blog/images/${filename}`,

        imageUrl:
          response.url || url,

        imageSource:
          "feed",

        imageHash:
          hash,

        bytes:
          buffer.length,
      };
    } catch (error) {
      console.warn(
        `  Image failed: ${url} (${error.message})`,
      );
    }
  }

  return null;
};

const topicRules = [
  {
    name:
      "Markets & Investing",

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
    name:
      "Economy & Macro",

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
    name:
      "Technology",

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
    ],
  },

  {
    name:
      "Business",

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
    name:
      "Asia Markets",

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

console.log(
  "========================================",
);

console.log(
  "BLOG ANALYZER v6",
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

try {
  const feedUrl =
    new URL(
      "/feeds/posts/default?alt=json&max-results=10",
      parsedUrl.origin,
    ).href;

  console.log(
    `Fetching Blogger feed: ${feedUrl}`,
  );

  feed =
    await fetchJson(
      feedUrl,
    );
} catch (error) {
  console.warn(
    `Blogger JSON feed unavailable: ${error.message}`,
  );
}

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

if (
  !feed?.feed?.entry?.length
) {
  throw new Error(
    "No Blogger feed entries found. This v6 capture currently requires a Blogger-compatible JSON feed.",
  );
}

const feedInfo =
  feed.feed;

const entries =
  asArray(
    feedInfo.entry,
  ).slice(
    0,
    5,
  );

const usedHashes =
  new Set();

const usedFingerprints =
  [];

const posts = [];

for (
  let i = 0;
  i < entries.length;
  i++
) {
  const entry =
    entries[i];

  const content =
    entry?.content?.$t ||
    "";

  const summary =
    entry?.summary?.$t ||
    "";

  const title =
    clean(
      entry?.title?.$t ||
        "",
    );

  const url =
    absoluteUrl(
      getEntryLink(
        entry,
      ),
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
            item?.term ||
              "",
          ),
      ),
    );

  let candidates =
    feedImageCandidates(
      entry,
    );

  let imageSource =
    "feed";

  if (url) {
    try {
      console.log(
        `Post ${i + 1}: fetching page image metadata...`,
      );

      const postHtml =
        await fetchText(
          url,
        );

      const pageMeta =
        metaImageCandidates(
          postHtml,
        );

      const pageImages =
        htmlImageCandidates(
          postHtml,
        );

      /*
       * Prefer article page images over
       * feed-level images.
       *
       * If the site-wide OG image is reused,
       * the duplicate detector rejects it
       * and moves to the next candidate.
       */
      candidates =
        unique([
          ...pageMeta,
          ...pageImages,
          ...candidates,
        ]);

      if (
        pageMeta.length
      ) {
        imageSource =
          "post-og";
      } else if (
        pageImages.length
      ) {
        imageSource =
          "post-img";
      }
    } catch (error) {
      console.warn(
        `  Post page fetch failed: ${error.message}`,
      );
    }
  }

  console.log(
    `Post ${i + 1}: ${title}`,
  );

  console.log(
    `  Image candidates: ${candidates.length}`,
  );

  const image =
    await downloadUniqueImage(
      candidates,
      i,
      usedHashes,
      usedFingerprints,
    );

  posts.push({
    index: i,

    title,

    url,

    published,

    date: published
      ? new Date(
          published,
        ).toLocaleDateString(
          "en-US",
          {
            year:
              "numeric",

            month:
              "long",

            day:
              "2-digit",

            timeZone:
              "UTC",
          },
        )
      : "",

    excerpt:
      stripHtml(
        content ||
          summary,
      ).slice(
        0,
        300,
      ),

    categories,

    localImage:
      image?.localImage ||
      "",

    imageUrl:
      image?.imageUrl ||
      "",

    imageSource:
      image
        ? imageSource
        : "none",

    imageHash:
      image?.imageHash ||
      "",

    imageBytes:
      image?.bytes ||
      0,
  });

  if (image) {
    console.log(
      `  Real image: ${image.localImage} (${image.bytes} bytes)`,
    );
  } else {
    console.warn(
      "  NO UNIQUE REAL IMAGE FOUND",
    );
  }
}

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
        name:
          rule.name,

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
        b.score -
        a.score,
    );

const topics =
  topicScores
    .filter(
      (item) =>
        item.score > 0,
    )
    .slice(
      0,
      3,
    )
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

const ogImage =
  metaImageCandidates(
    homepageHtml,
  )[0] || "";

const realImageCount =
  posts.filter(
    (post) =>
      post.localImage &&
      post.imageSource !==
        "none",
  ).length;

const uniqueImageCount =
  new Set(
    posts
      .filter(
        (post) =>
          post.imageHash,
      )
      .map(
        (post) =>
          post.imageHash,
      ),
  ).size;

const result = {
  version: 6,

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
      posts.length,
  },
};

fs.writeFileSync(
  path.join(
    OUTPUT_DIR,
    "blog.json",
  ),
  JSON.stringify(
    result,
    null,
    2,
  ),
  "utf8",
);

console.log("");

console.log(
  "========================================",
);

console.log(
  "BLOG ANALYSIS COMPLETE",
);

console.log(
  "========================================",
);

console.log(
  `Site: ${siteTitle}`,
);

console.log(
  `Posts: ${posts.length}`,
);

console.log(
  `Real images: ${realImageCount}/${posts.length}`,
);

console.log(
  `Unique images: ${uniqueImageCount}/${realImageCount}`,
);

console.log(
  "Image duplicate detection: SHA-256 + canonical pixels + block hash + aHash/dHash",
);

console.log(
  `Topics: ${topics.join(", ")}`,
);

console.log(
  "========================================",
);

if (
  posts.length < 5
) {
  throw new Error(
    `Only ${posts.length} posts were captured; 5 recent posts are required for the promo.`,
  );
}

if (
  realImageCount <
  posts.length
) {
  throw new Error(
    `Only ${realImageCount}/${posts.length} posts have unique real images. Fix image extraction before rendering.`,
  );
}

if (
  uniqueImageCount <
  realImageCount
) {
  throw new Error(
    `Image uniqueness check failed: ${uniqueImageCount} unique images for ${realImageCount} real images.`,
  );
}
