import fs from "node:fs";
import path from "node:path";

/*
=========================================================
BLOG VIDEO CAPTURE v4
=========================================================

Input:
  node scripts/capture-blog.mjs <blog-url>

Output:
  template/public/blog/
    ├── blog.json
    └── posts/
        ├── post-1.webp / jpg / png / ...
        ├── post-2.webp / jpg / png / ...
        ├── post-3.webp / jpg / png / ...
        ├── post-4.webp / jpg / png / ...
        └── post-5.webp / jpg / png / ...

Data source:
  Blogger JSON Feed

Image extraction priority:

  1. Blogger media$thumbnail
  2. Blogger media$content
  3. Feed HTML data-src
  4. Feed HTML data-original
  5. Feed HTML data-lazy-src
  6. Feed HTML src
  7. Post page og:image
  8. Post page twitter:image
  9. Post page image_src
 10. Post page data-* image
 11. Post page first <img>

Important:
  - Never stores Base64 images in blog.json
  - Downloads images to local files
  - Verifies image response
  - Creates fallback SVG only when no real image exists
=========================================================
*/

const MAX_POSTS = 5;

const rawUrl = process.argv[2];

if (!rawUrl) {
  console.error(
    "Usage: node scripts/capture-blog.mjs <blog-url>",
  );
  process.exit(1);
}

/* ======================================================
   URL NORMALIZATION
====================================================== */

const normalizeInputUrl = (value) => {
  let url = String(value || "").trim();

  /*
   GitHub Actions input may occasionally contain:

   [https://example.com/](https://example.com/)

   or markdown-style wrapping.
  */

  const markdownMatch = url.match(
    /^\[([^\]]+)\]\(([^)]+)\)$/,
  );

  if (markdownMatch) {
    url = markdownMatch[2];
  }

  url = url
    .replace(/^<|>$/g, "")
    .trim();

  return url;
};

const BLOG_URL = normalizeInputUrl(rawUrl);

let parsedUrl;

try {
  parsedUrl = new URL(BLOG_URL);

  if (
    !["http:", "https:"].includes(
      parsedUrl.protocol,
    )
  ) {
    throw new Error(
      "Unsupported protocol",
    );
  }
} catch {
  console.error(
    `Invalid blog URL: ${BLOG_URL}`,
  );
  process.exit(1);
}

/* ======================================================
   SETTINGS
====================================================== */

const OUTPUT_DIR = path.resolve(
  "template/public/blog",
);

const POSTS_DIR = path.join(
  OUTPUT_DIR,
  "posts",
);

/* ======================================================
   FILE SYSTEM
====================================================== */

fs.rmSync(OUTPUT_DIR, {
  recursive: true,
  force: true,
});

fs.mkdirSync(POSTS_DIR, {
  recursive: true,
});

/* ======================================================
   TEXT HELPERS
====================================================== */

const clean = (value = "") =>
  String(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const truncate = (
  value = "",
  length = 320,
) => {
  const text = clean(value);

  if (text.length <= length) {
    return text;
  }

  return (
    text.slice(
      0,
      Math.max(1, length - 1),
    ) + "…"
  );
};

const decodeHtml = (value = "") =>
  String(value)
    .replace(
      /&nbsp;/gi,
      " ",
    )
    .replace(
      /&amp;/gi,
      "&",
    )
    .replace(
      /&quot;/gi,
      '"',
    )
    .replace(
      /&#39;/gi,
      "'",
    )
    .replace(
      /&lt;/gi,
      "<",
    )
    .replace(
      /&gt;/gi,
      ">",
    )
    .replace(
      /&#(\d+);/g,
      (_, code) =>
        String.fromCharCode(
          Number(code),
        ),
    )
    .replace(
      /&#x([0-9a-f]+);/gi,
      (_, code) =>
        String.fromCharCode(
          parseInt(code, 16),
        ),
    );

const htmlToText = (
  html = "",
) => {
  const stripped = String(html)
    .replace(
      /<script[\s\S]*?<\/script>/gi,
      " ",
    )
    .replace(
      /<style[\s\S]*?<\/style>/gi,
      " ",
    )
    .replace(
      /<noscript[\s\S]*?<\/noscript>/gi,
      " ",
    )
    .replace(
      /<br\s*\/?>/gi,
      "\n",
    )
    .replace(
      /<\/p>/gi,
      "\n",
    )
    .replace(
      /<\/div>/gi,
      "\n",
    )
    .replace(
      /<[^>]+>/g,
      " ",
    );

  return clean(
    decodeHtml(stripped),
  );
};

/* ======================================================
   URL HELPERS
====================================================== */

const absoluteUrl = (
  value = "",
  baseUrl = parsedUrl.href,
) => {
  if (!value) {
    return "";
  }

  let candidate = String(
    value,
  )
    .trim()
    .replace(/^['"]|['"]$/g, "");

  if (
    candidate.startsWith("//")
  ) {
    candidate =
      `${parsedUrl.protocol}${candidate}`;
  }

  try {
    const url = new URL(
      candidate,
      baseUrl,
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

/* ======================================================
   BLOGGER IMAGE URL
====================================================== */

const upgradeBloggerImageUrl = (
  value = "",
  baseUrl = parsedUrl.href,
) => {
  let url = absoluteUrl(
    value,
    baseUrl,
  );

  if (!url) {
    return "";
  }

  /*
  Blogger image variants:

  /s72-c/
  /s400/
  /s640/
  /s1600/
  /w400-h300/
  /w640-h360-p-k-no/
  */

  url = url.replace(
    /\/s\d+(?:-[^/]+)?\//i,
    "/s1600/",
  );

  url = url.replace(
    /\/w\d+(?:-h\d+)?(?:-[^/]+)?\//i,
    "/s1600/",
  );

  return url;
};

/* ======================================================
   HTML ATTRIBUTE EXTRACTION
====================================================== */

const extractAttribute = (
  tag,
  attribute,
) => {
  const pattern = new RegExp(
    `${attribute}\\s*=\\s*["']([^"']+)["']`,
    "i",
  );

  const match = String(tag).match(
    pattern,
  );

  return match?.[1] || "";
};

/* ======================================================
   HTML IMAGE EXTRACTION
====================================================== */

const extractImagesFromHtml = (
  html = "",
  baseUrl = parsedUrl.href,
) => {
  const source = String(html);

  const candidates = [];

  /*
  Find every img tag rather than stopping
  at the first image.
  */

  const imgTags =
    source.match(
      /<img\b[^>]*>/gi,
    ) || [];

  for (const tag of imgTags) {
    const attributes = [
      "data-src",
      "data-original",
      "data-lazy-src",
      "data-image",
      "data-url",
      "src",
    ];

    for (const attribute of attributes) {
      const value =
        extractAttribute(
          tag,
          attribute,
        );

      if (!value) {
        continue;
      }

      if (
        value.startsWith("data:") ||
        value.startsWith("blob:")
      ) {
        continue;
      }

      const url =
        upgradeBloggerImageUrl(
          value,
          baseUrl,
        );

      if (url) {
        candidates.push(url);
      }
    }

    /*
    srcset support.
    */

    const srcset =
      extractAttribute(
        tag,
        "srcset",
      );

    if (srcset) {
      const entries =
        srcset
          .split(",")
          .map(
            (item) =>
              item.trim().split(/\s+/)[0],
          );

      for (const item of entries) {
        const url =
          upgradeBloggerImageUrl(
            item,
            baseUrl,
          );

        if (url) {
          candidates.push(url);
        }
      }
    }
  }

  return [
    ...new Set(
      candidates,
    ),
  ];
};

const extractFirstImageFromHtml = (
  html = "",
  baseUrl = parsedUrl.href,
) => {
  return (
    extractImagesFromHtml(
      html,
      baseUrl,
    )[0] || ""
  );
};

/* ======================================================
   META IMAGE EXTRACTION
====================================================== */

const extractMetaImages = (
  html = "",
  baseUrl = parsedUrl.href,
) => {
  const source = String(html);

  const candidates = [];

  /*
  og:image
  */

  const ogPatterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
  ];

  for (const pattern of ogPatterns) {
    const match =
      source.match(pattern);

    if (match?.[1]) {
      const url =
        upgradeBloggerImageUrl(
          match[1],
          baseUrl,
        );

      if (url) {
        candidates.push(url);
      }
    }
  }

  /*
  twitter:image
  */

  const twitterPatterns = [
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
  ];

  for (const pattern of twitterPatterns) {
    const match =
      source.match(pattern);

    if (match?.[1]) {
      const url =
        upgradeBloggerImageUrl(
          match[1],
          baseUrl,
        );

      if (url) {
        candidates.push(url);
      }
    }
  }

  /*
  image_src
  */

  const imageSrcPatterns = [
    /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i,
    /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']image_src["']/i,
  ];

  for (const pattern of imageSrcPatterns) {
    const match =
      source.match(pattern);

    if (match?.[1]) {
      const url =
        upgradeBloggerImageUrl(
          match[1],
          baseUrl,
        );

      if (url) {
        candidates.push(url);
      }
    }
  }

  return [
    ...new Set(
      candidates,
    ),
  ];
};

/* ======================================================
   BLOGGER ENTRY HELPERS
====================================================== */

const getEntryHtml = (
  entry,
) =>
  entry?.content?.$t ||
  entry?.summary?.$t ||
  "";

const getEntryUrl = (
  entry,
) => {
  const links = Array.isArray(
    entry?.link,
  )
    ? entry.link
    : [];

  const alternate =
    links.find(
      (link) =>
        link?.rel ===
          "alternate" &&
        link?.href,
    );

  return (
    alternate?.href || ""
  );
};

const getEntryDate = (
  entry,
) =>
  entry?.published?.$t ||
  entry?.updated?.$t ||
  "";

const getEntryTitle = (
  entry,
) =>
  clean(
    entry?.title?.$t ||
      "Untitled Post",
  );

const getEntryCategories = (
  entry,
) => {
  const categories =
    Array.isArray(
      entry?.category,
    )
      ? entry.category
      : [];

  return [
    ...new Set(
      categories
        .map(
          (item) =>
            clean(
              item?.term,
            ),
        )
        .filter(Boolean),
    ),
  ];
};

/* ======================================================
   FEED IMAGE EXTRACTION
====================================================== */

const getFeedImageCandidates = (
  entry,
) => {
  const candidates = [];

  /*
  1. Blogger media$thumbnail
  */

  if (
    entry?.media$thumbnail?.url
  ) {
    candidates.push(
      upgradeBloggerImageUrl(
        entry.media$thumbnail.url,
      ),
    );
  }

  /*
  2. Blogger media$content
  */

  const mediaContent =
    Array.isArray(
      entry?.media$content,
    )
      ? entry.media$content
      : [];

  for (const item of mediaContent) {
    if (item?.url) {
      candidates.push(
        upgradeBloggerImageUrl(
          item.url,
        ),
      );
    }
  }

  /*
  3-6. Images inside Feed HTML
  */

  candidates.push(
    ...extractImagesFromHtml(
      getEntryHtml(entry),
    ),
  );

  return [
    ...new Set(
      candidates.filter(
        Boolean,
      ),
    ),
  ];
};

/* ======================================================
   NETWORK
====================================================== */

const fetchResponse = async (
  url,
  options = {},
) => {
  const response =
    await fetch(
      url,
      {
        redirect: "follow",
        ...options,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; BlogVideoGenerator/4.0)",
          Accept:
            options.accept ||
            "text/html,application/xhtml+xml,application/json,*/*",
          ...(options.headers || {}),
        },
      },
    );

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText}`,
    );
  }

  return response;
};

const fetchText = async (
  url,
) => {
  const response =
    await fetchResponse(
      url,
    );

  return response.text();
};

const fetchJson = async (
  url,
) => {
  const text =
    await fetchText(
      url,
    );

  try {
    return JSON.parse(
      text,
    );
  } catch {
    throw new Error(
      `Response was not valid JSON: ${url}`,
    );
  }
};

/* ======================================================
   POST PAGE IMAGE DISCOVERY
====================================================== */

const discoverPostPageImages =
  async (
    postUrl,
  ) => {
    if (!postUrl) {
      return [];
    }

    try {
      console.log(
        `Fetching post page: ${postUrl}`,
      );

      const html =
        await fetchText(
          postUrl,
        );

      const candidates = [
        ...extractMetaImages(
          html,
          postUrl,
        ),
        ...extractImagesFromHtml(
          html,
          postUrl,
        ),
      ];

      return [
        ...new Set(
          candidates.filter(
            Boolean,
          ),
        ),
      ];
    } catch (error) {
      console.warn(
        `Post page fetch failed: ${error.message}`,
      );

      return [];
    }
  };

/* ======================================================
   IMAGE SIGNATURE
====================================================== */

const detectImageSignature = (
  buffer,
) => {
  if (!buffer || buffer.length < 12) {
    return "";
  }

  /*
  JPEG
  */

  if (
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "jpeg";
  }

  /*
  PNG
  */

  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "png";
  }

  /*
  GIF
  */

  if (
    buffer
      .subarray(0, 6)
      .toString("ascii") ===
    "GIF89a" ||
    buffer
      .subarray(0, 6)
      .toString("ascii") ===
    "GIF87a"
  ) {
    return "gif";
  }

  /*
  WEBP
  */

  if (
    buffer
      .subarray(0, 4)
      .toString("ascii") ===
      "RIFF" &&
    buffer
      .subarray(8, 12)
      .toString("ascii") ===
      "WEBP"
  ) {
    return "webp";
  }

  /*
  AVIF / ISO BMFF
  */

  if (
    buffer
      .subarray(4, 12)
      .toString("ascii")
      .includes("ftyp")
  ) {
    return "avif";
  }

  /*
  SVG is text-based.
  */

  const beginning =
    buffer
      .subarray(
        0,
        Math.min(
          buffer.length,
          1000,
        ),
      )
      .toString("utf8")
      .trim()
      .toLowerCase();

  if (
    beginning.includes("<svg") ||
    beginning.includes(
      "<?xml",
    ) &&
      beginning.includes(
        "<svg",
      )
  ) {
    return "svg";
  }

  return "";
};

/* ======================================================
   EXTENSION
====================================================== */

const extensionFromSignature =
  (
    signature,
    contentType = "",
  ) => {
    switch (signature) {
      case "jpeg":
        return ".jpg";

      case "png":
        return ".png";

      case "webp":
        return ".webp";

      case "gif":
        return ".gif";

      case "avif":
        return ".avif";

      case "svg":
        return ".svg";

      default:
        break;
    }

    const type =
      contentType
        .split(";")[0]
        .trim()
        .toLowerCase();

    switch (type) {
      case "image/jpeg":
        return ".jpg";

      case "image/png":
        return ".png";

      case "image/webp":
        return ".webp";

      case "image/gif":
        return ".gif";

      case "image/avif":
        return ".avif";

      case "image/svg+xml":
        return ".svg";

      default:
        return ".jpg";
    }
  };

/* ======================================================
   IMAGE DOWNLOAD
====================================================== */

const downloadImage = async (
  imageUrl,
  index,
) => {
  if (!imageUrl) {
    return null;
  }

  try {
    console.log(
      `Downloading image: ${imageUrl}`,
    );

    const response =
      await fetchResponse(
        imageUrl,
        {
          accept:
            "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        },
      );

    const contentType =
      response.headers.get(
        "content-type",
      ) || "";

    /*
    Some Blogger/CDN endpoints may return
    an image without the expected Content-Type.
    Therefore we don't immediately reject it.
    */

    const buffer =
      Buffer.from(
        await response.arrayBuffer(),
      );

    if (buffer.length < 500) {
      throw new Error(
        `Image response too small: ${buffer.length} bytes`,
      );
    }

    const signature =
      detectImageSignature(
        buffer,
      );

    /*
    Reject HTML pages masquerading as images.
    */

    const firstBytes =
      buffer
        .subarray(
          0,
          Math.min(
            buffer.length,
            200,
          ),
        )
        .toString("utf8")
        .trim()
        .toLowerCase();

    if (
      firstBytes.startsWith(
        "<!doctype html",
      ) ||
      firstBytes.startsWith(
        "<html",
      )
    ) {
      throw new Error(
        "Server returned HTML instead of an image",
      );
    }

    if (!signature) {
      throw new Error(
        `Unknown image format. Content-Type: ${contentType}`,
      );
    }

    const extension =
      extensionFromSignature(
        signature,
        contentType,
      );

    const filename =
      `post-${index}${extension}`;

    const outputPath =
      path.join(
        POSTS_DIR,
        filename,
      );

    fs.writeFileSync(
      outputPath,
      buffer,
    );

    console.log(
      `Image saved: ${filename} (${buffer.length} bytes, ${signature})`,
    );

    return {
      filename,
      localPath:
        `blog/posts/${filename}`,
      bytes: buffer.length,
      sourceUrl: imageUrl,
      contentType:
        contentType ||
        `image/${signature}`,
      signature,
      fallback: false,
    };
  } catch (error) {
    console.warn(
      `Image download failed: ${imageUrl}`,
    );

    console.warn(
      `Reason: ${error.message}`,
    );

    return null;
  }
};

/* ======================================================
   FALLBACK SVG
====================================================== */

const escapeXml = (
  value = "",
) =>
  String(value)
    .replace(
      /&/g,
      "&amp;",
    )
    .replace(
      /</g,
      "&lt;",
    )
    .replace(
      />/g,
      "&gt;",
    )
    .replace(
      /"/g,
      "&quot;",
    )
    .replace(
      /'/g,
      "&apos;",
    );

const createFallbackPostImage = (
  index,
  title,
) => {
  const filename =
    `post-${index}.svg`;

  const outputPath =
    path.join(
      POSTS_DIR,
      filename,
    );

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg"
     width="1600"
     height="900"
     viewBox="0 0 1600 900">

  <defs>
    <linearGradient
      id="bg"
      x1="0"
      y1="0"
      x2="1"
      y2="1">
      <stop offset="0%" stop-color="#10141c"/>
      <stop offset="100%" stop-color="#252d3a"/>
    </linearGradient>
  </defs>

  <rect
    width="1600"
    height="900"
    fill="url(#bg)"
  />

  <rect
    x="70"
    y="70"
    width="1460"
    height="760"
    rx="36"
    fill="#171c25"
    stroke="#3b4555"
    stroke-width="2"
  />

  <text
    x="120"
    y="180"
    fill="#91a4c4"
    font-size="30"
    font-family="Arial, Helvetica, sans-serif"
    letter-spacing="7">
    BLOG FEATURE
  </text>

  <text
    x="120"
    y="340"
    fill="#ffffff"
    font-size="58"
    font-weight="700"
    font-family="Arial, Helvetica, sans-serif">
    ${escapeXml(
      truncate(
        title,
        46,
      ),
    )}
  </text>

  <text
    x="120"
    y="750"
    fill="#8d98a8"
    font-size="26"
    font-family="Arial, Helvetica, sans-serif">
    ${escapeXml(
      parsedUrl.hostname,
    )}
  </text>

</svg>
`;

  fs.writeFileSync(
    outputPath,
    svg,
    "utf8",
  );

  return {
    filename,
    localPath:
      `blog/posts/${filename}`,
    bytes:
      Buffer.byteLength(svg),
    sourceUrl: "",
    contentType:
      "image/svg+xml",
    signature: "svg",
    fallback: true,
  };
};

/* ======================================================
   TOPIC ANALYSIS
====================================================== */

const TOPIC_RULES = [
  {
    label: "US Markets",
    keywords: [
      "s&p",
      "sp500",
      "s&p 500",
      "nasdaq",
      "dow jones",
      "dow",
      "wall street",
      "nyse",
      "russell",
      "us market",
      "us stock",
      "stock market",
      "stocks",
    ],
  },

  {
    label: "Global Markets",
    keywords: [
      "hong kong",
      "hang seng",
      "china",
      "japan",
      "nikkei",
      "taiwan",
      "asia",
      "europe",
      "european",
      "global market",
      "global markets",
    ],
  },

  {
    label: "Macro & Economy",
    keywords: [
      "cpi",
      "inflation",
      "interest rate",
      "interest rates",
      "federal reserve",
      "fed",
      "fomc",
      "gdp",
      "employment",
      "jobs",
      "economic",
      "economy",
      "yield",
      "yields",
      "treasury",
      "bond",
      "bonds",
    ],
  },

  {
    label: "Technology",
    keywords: [
      "technology",
      "tech",
      "artificial intelligence",
      "ai",
      "semiconductor",
      "semiconductors",
      "chip",
      "chips",
      "software",
      "nvidia",
      "apple",
      "microsoft",
      "google",
      "amazon",
      "meta",
      "tesla",
    ],
  },

  {
    label: "Investing",
    keywords: [
      "investing",
      "investment",
      "investor",
      "trading",
      "day trading",
      "portfolio",
      "market analysis",
      "stocks",
      "shares",
      "equity",
    ],
  },
];

const analyzeTopics = (
  siteTitle,
  description,
  posts,
) => {
  const source = clean(
    [
      siteTitle,
      description,
      ...posts.map(
        (post) =>
          `${post.title} ${post.excerpt} ${post.categories.join(" ")}`,
      ),
    ].join(" "),
  ).toLowerCase();

  const scored =
    TOPIC_RULES.map(
      (rule) => {
        let score = 0;

        for (const keyword of rule.keywords) {
          if (
            source.includes(
              keyword.toLowerCase(),
            )
          ) {
            score += 1;
          }
        }

        return {
          label: rule.label,
          score,
        };
      },
    )
      .filter(
        (item) =>
          item.score > 0,
      )
      .sort(
        (a, b) =>
          b.score - a.score,
      );

  let topics =
    scored
      .slice(0, 4)
      .map(
        (item) =>
          item.label,
      );

  if (!topics.length) {
    topics = [
      "Markets",
      "Analysis",
      "Insights",
    ];
  }

  const identity =
    truncate(
      description ||
        `${siteTitle} provides market insights and analysis.`,
      240,
    );

  let audience =
    "Readers interested in the topics covered by this blog";

  if (
    topics.includes(
      "US Markets",
    ) ||
    topics.includes(
      "Global Markets",
    ) ||
    topics.includes(
      "Investing",
    )
  ) {
    audience =
      "Investors following markets, trends and economic signals";
  }

  let contentStyle =
    "Expert Insights";

  if (
    topics.includes(
      "US Markets",
    ) ||
    topics.includes(
      "Global Markets",
    )
  ) {
    contentStyle =
      "Market & Macro Analysis";
  }

  const valueProposition =
    topics.includes(
      "US Markets",
    )
      ? "Timely US markets updates and signals to help readers stay informed."
      : `Focused ${topics
          .slice(0, 2)
          .join(
            " and ",
          )} insights to help readers stay informed.`;

  return {
    identity,
    topics,
    audience,
    contentStyle,
    valueProposition,
  };
};

/* ======================================================
   BLOG FEED
====================================================== */

const feedUrl =
  `${parsedUrl.origin}${parsedUrl.pathname.replace(/\/$/, "")}/feeds/posts/default?alt=json&max-results=${MAX_POSTS}`;

console.log(
  "========================================",
);

console.log(
  "Capturing blog",
);

console.log(
  "========================================",
);

console.log(
  `Blog URL: ${BLOG_URL}`,
);

console.log(
  `Blogger Feed: ${feedUrl}`,
);

let feed;

try {
  feed =
    await fetchJson(
      feedUrl,
    );
} catch (error) {
  console.error(
    "Blogger Feed request failed:",
  );

  console.error(
    error.message,
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

/* ======================================================
   SITE METADATA
====================================================== */

const siteTitle =
  clean(
    feedData?.title?.$t ||
      parsedUrl.hostname,
  );

const description =
  clean(
    feedData?.subtitle?.$t ||
      "",
  );

const pageHeading =
  siteTitle;

/* ======================================================
   PROCESS POSTS
====================================================== */

const posts = [];

for (
  let i = 0;
  i <
  Math.min(
    entries.length,
    MAX_POSTS,
  );
  i += 1
) {
  const entry =
    entries[i];

  const index =
    i + 1;

  const title =
    getEntryTitle(
      entry,
    );

  const postUrl =
    getEntryUrl(
      entry,
    );

  const published =
    getEntryDate(
      entry,
    );

  const categories =
    getEntryCategories(
      entry,
    );

  const entryHtml =
    getEntryHtml(
      entry,
    );

  const excerpt =
    truncate(
      htmlToText(
        entryHtml,
      ),
      320,
    );

  console.log(
    `Post ${index}: ${title}`,
  );

  /*
  ------------------------------------------------------
  IMAGE DISCOVERY
  ------------------------------------------------------
  */

  let imageCandidates =
    getFeedImageCandidates(
      entry,
    );

  console.log(
    `Feed image candidates: ${imageCandidates.length}`,
  );

  /*
  If Feed contains no usable image,
  inspect actual post page.
  */

  if (
    imageCandidates.length === 0 &&
    postUrl
  ) {
    const pageCandidates =
      await discoverPostPageImages(
        postUrl,
      );

    imageCandidates = [
      ...new Set([
        ...imageCandidates,
        ...pageCandidates,
      ]),
    ];

    console.log(
      `Post page image candidates: ${pageCandidates.length}`,
    );
  }

  /*
  ------------------------------------------------------
  DOWNLOAD FIRST VALID IMAGE
  ------------------------------------------------------
  */

  let imageInfo = null;

  for (const candidate of imageCandidates) {
    imageInfo =
      await downloadImage(
        candidate,
        index,
      );

    if (imageInfo) {
      break;
    }
  }

  /*
  ------------------------------------------------------
  FALLBACK
  ------------------------------------------------------
  */

  if (!imageInfo) {
    console.log(
      `Using fallback image for post ${index}`,
    );

    imageInfo =
      createFallbackPostImage(
        index,
        title,
      );
  }

  console.log(
    `Image source: ${
      imageInfo.fallback
        ? "fallback"
        : imageInfo.sourceUrl
    }`,
  );

  posts.push({
    index,
    title,
    url: postUrl,
    published,
    date: published
      ? new Date(
          published,
        ).toLocaleDateString(
          "en-US",
          {
            month: "short",
            day: "numeric",
            year: "numeric",
          },
        )
      : "",
    excerpt,
    categories,
    localImage:
      imageInfo.localPath,
    imageSource:
      imageInfo.fallback
        ? "fallback"
        : "post-image",
    imageUrl:
      imageInfo.fallback
        ? ""
        : imageInfo.sourceUrl,
    imageBytes:
      imageInfo.bytes,
    imageContentType:
      imageInfo.contentType,
    imageSignature:
      imageInfo.signature,
  });
}

/* ======================================================
   ANALYSIS
====================================================== */

const analysis =
  analyzeTopics(
    siteTitle,
    description,
    posts,
  );

/* ======================================================
   COUNTS
====================================================== */

const realImageCount =
  posts.filter(
    (post) =>
      post.imageSource ===
      "post-image",
  ).length;

const fallbackImageCount =
  posts.filter(
    (post) =>
      post.imageSource ===
      "fallback",
  ).length;

/* ======================================================
   BLOG JSON
====================================================== */

const blogData = {
  version: 4,

  capturedAt:
    new Date().toISOString(),

  url: BLOG_URL,

  hostname:
    parsedUrl.hostname,

  siteTitle,

  description,

  pageHeading,

  ogImage: "",

  language: "",

  postCount:
    posts.length,

  imageStats: {
    realImages:
      realImageCount,

    fallbackImages:
      fallbackImageCount,

    total:
      posts.length,
  },

  analysis,

  posts,
};

/* ======================================================
   WRITE JSON
====================================================== */

const blogJsonPath =
  path.join(
    OUTPUT_DIR,
    "blog.json",
  );

fs.writeFileSync(
  blogJsonPath,
  JSON.stringify(
    blogData,
    null,
    2,
  ),
  "utf8",
);

/* ======================================================
   FINAL OUTPUT
====================================================== */

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
  `Site: ${siteTitle}`,
);

console.log(
  `Posts: ${posts.length}`,
);

console.log(
  `Topics: ${analysis.topics.join(", ")}`,
);

console.log(
  `Real images: ${realImageCount}/${posts.length}`,
);

console.log(
  `Fallback images: ${fallbackImageCount}/${posts.length}`,
);

console.log(
  `Output: ${OUTPUT_DIR}`,
);

console.log(
  `JSON: ${blogJsonPath}`,
);

console.log(
  "Files:",
);

for (const post of posts) {
  console.log(
    `- ${post.localImage} [${post.imageSource}]`,
  );
}

console.log(
  "========================================",
);
