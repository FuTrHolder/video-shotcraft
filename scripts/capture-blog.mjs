import fs from "node:fs";
import path from "node:path";

/*
=========================================================
BLOG VIDEO CAPTURE
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

No Puppeteer.
No homepage screenshot.
No Base64 image inside blog.json.

=========================================================
*/

const rawUrl = process.argv[2];

if (!rawUrl) {
  console.error(
    "Usage: node scripts/capture-blog.mjs <blog-url>",
  );
  process.exit(1);
}

const BLOG_URL = rawUrl.trim();

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

/* ======================================================
   SETTINGS
====================================================== */

const MAX_POSTS = 5;

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
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(
      /&#(\d+);/g,
      (_, code) =>
        String.fromCharCode(Number(code)),
    )
    .replace(
      /&#x([0-9a-f]+);/gi,
      (_, code) =>
        String.fromCharCode(
          parseInt(code, 16),
        ),
    );

const htmlToText = (html = "") => {
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

const absoluteUrl = (value = "") => {
  if (!value) {
    return "";
  }

  try {
    return new URL(
      value,
      parsedUrl.href,
    ).href;
  } catch {
    return "";
  }
};

/* ======================================================
   BLOGGER IMAGE EXTRACTION
====================================================== */

const extractImageFromHtml = (
  html = "",
) => {
  const source = String(html);

  const patterns = [
    /<img[^>]+data-src=["']([^"']+)["']/i,
    /<img[^>]+data-original=["']([^"']+)["']/i,
    /<img[^>]+data-lazy-src=["']([^"']+)["']/i,
    /<img[^>]+src=["']([^"']+)["']/i,
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);

    if (match?.[1]) {
      const candidate = match[1];

      if (
        !candidate.startsWith("data:") &&
        !candidate.startsWith("blob:")
      ) {
        return candidate;
      }
    }
  }

  return "";
};

const upgradeBloggerImageUrl = (
  value = "",
) => {
  let url = absoluteUrl(value);

  if (!url) {
    return "";
  }

  /*
  Blogger thumbnail examples:

  /s72-c/
  /s1600/
  /w400-h300/
  /w640-h360-p-k-no/
  */

  url = url.replace(
    /\/s\d+(?:-c)?\//i,
    "/s1600/",
  );

  url = url.replace(
    /\/w\d+-h\d+(?:-[^/]+)?\//i,
    "/s1600/",
  );

  return url;
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

  const alternate = links.find(
    (link) =>
      link?.rel === "alternate" &&
      link?.href,
  );

  return alternate?.href || "";
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
  const categories = Array.isArray(
    entry?.category,
  )
    ? entry.category
    : [];

  return [
    ...new Set(
      categories
        .map(
          (item) =>
            clean(item?.term),
        )
        .filter(Boolean),
    ),
  ];
};

const getEntryImage = (
  entry,
) => {
  const thumbnail =
    entry?.media$thumbnail?.url;

  if (thumbnail) {
    return upgradeBloggerImageUrl(
      thumbnail,
    );
  }

  return upgradeBloggerImageUrl(
    extractImageFromHtml(
      getEntryHtml(entry),
    ),
  );
};

/* ======================================================
   NETWORK
====================================================== */

const fetchText = async (
  url,
) => {
  const response = await fetch(
    url,
    {
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; BlogVideoGenerator/3.0)",
        Accept:
          "application/json,text/plain,*/*",
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText}`,
    );
  }

  return response.text();
};

const fetchJson = async (
  url,
) => {
  const text =
    await fetchText(url);

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Response was not valid JSON: ${url}`,
    );
  }
};

/* ======================================================
   IMAGE DOWNLOAD
====================================================== */

const extensionFromContentType = (
  contentType = "",
) => {
  const type = contentType
    .split(";")[0]
    .trim()
    .toLowerCase();

  switch (type) {
    case "image/png":
      return ".png";

    case "image/webp":
      return ".webp";

    case "image/gif":
      return ".gif";

    case "image/avif":
      return ".avif";

    case "image/jpeg":
    case "image/jpg":
      return ".jpg";

    default:
      return ".jpg";
  }
};

const downloadImage = async (
  imageUrl,
  index,
) => {
  if (!imageUrl) {
    return null;
  }

  try {
    const response =
      await fetch(
        imageUrl,
        {
          redirect: "follow",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; BlogVideoGenerator/3.0)",
            Accept:
              "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          },
        },
      );

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`,
      );
    }

    const contentType =
      response.headers.get(
        "content-type",
      ) || "";

    if (
      !contentType
        .toLowerCase()
        .startsWith("image/")
    ) {
      throw new Error(
        `Not an image: ${contentType}`,
      );
    }

    const buffer =
      Buffer.from(
        await response.arrayBuffer(),
      );

    if (buffer.length < 100) {
      throw new Error(
        "Image response is too small",
      );
    }

    const extension =
      extensionFromContentType(
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

    return {
      filename,
      localPath:
        `blog/posts/${filename}`,
      bytes: buffer.length,
      sourceUrl: imageUrl,
      contentType,
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

  <rect
    width="1600"
    height="900"
    fill="#111318"
  />

  <rect
    x="70"
    y="70"
    width="1460"
    height="760"
    rx="36"
    fill="#191d24"
    stroke="#353b45"
    stroke-width="2"
  />

  <text
    x="120"
    y="180"
    fill="#8ea4c7"
    font-size="30"
    font-family="Arial, Helvetica, sans-serif"
    letter-spacing="7"
  >
    BLOG FEATURE
  </text>

  <text
    x="120"
    y="340"
    fill="#ffffff"
    font-size="60"
    font-weight="700"
    font-family="Arial, Helvetica, sans-serif"
  >
    ${escapeXml(
      truncate(title, 48),
    )}
  </text>

  <text
    x="120"
    y="750"
    fill="#89919e"
    font-size="26"
    font-family="Arial, Helvetica, sans-serif"
  >
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
      "tesla",
    ],
  },

  {
    label: "Investing",
    keywords: [
      "investing",
      "investor",
      "investment",
      "portfolio",
      "valuation",
      "dividend",
      "risk",
      "asset allocation",
      "long-term",
      "trading",
      "day trading",
    ],
  },

  {
    label: "Commodities",
    keywords: [
      "oil",
      "crude",
      "gold",
      "silver",
      "commodity",
      "commodities",
      "natural gas",
    ],
  },
];

const analyzeTopics = (
  posts,
) => {
  const scores = new Map();

  for (const rule of TOPIC_RULES) {
    scores.set(
      rule.label,
      0,
    );
  }

  for (const post of posts) {
    const source = [
      post.title,
      post.excerpt,
      ...(post.categories || []),
    ]
      .join(" ")
      .toLowerCase();

    for (const rule of TOPIC_RULES) {
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

      scores.set(
        rule.label,
        scores.get(rule.label) + score,
      );
    }
  }

  return [...scores.entries()]
    .sort(
      (a, b) =>
        b[1] - a[1],
    )
    .filter(
      ([, score]) =>
        score > 0,
    )
    .slice(0, 4)
    .map(
      ([label]) =>
        label,
    );
};

/* ======================================================
   CONTENT STYLE
====================================================== */

const detectContentStyle = (
  posts,
) => {
  const text = posts
    .map(
      (post) =>
        `${post.title} ${post.excerpt}`,
    )
    .join(" ")
    .toLowerCase();

  const hasMarket =
    /market|stocks|nasdaq|s&p|dow|futures|wall street|trading/
      .test(text);

  const hasMacro =
    /cpi|inflation|fed|fomc|interest rate|yield|gdp|economy/
      .test(text);

  if (
    hasMarket &&
    hasMacro
  ) {
    return "Market & Macro Analysis";
  }

  if (hasMarket) {
    return "Timely Market Updates";
  }

  if (hasMacro) {
    return "Economic Insights";
  }

  return "Expert Insights";
};

/* ======================================================
   BLOG ANALYSIS
====================================================== */

const buildAnalysis = (
  siteTitle,
  description,
  posts,
) => {
  const topics =
    analyzeTopics(posts);

  const safeTopics =
    topics.length
      ? topics
      : [
          "Insights",
          "Analysis",
          "Trends",
        ];

  const topicText =
    safeTopics
      .slice(0, 3)
      .join(", ");

  const identity =
    description ||
    `${siteTitle} focuses on ${topicText}.`;

  const audience =
    safeTopics.includes(
      "US Markets",
    ) ||
    safeTopics.includes(
      "Global Markets",
    )
      ? "Investors following markets, trends and economic signals"
      : "Readers looking for useful insights, trends and analysis";

  const contentStyle =
    detectContentStyle(
      posts,
    );

  const valueProposition =
    safeTopics.includes(
      "US Markets",
    )
      ? "Timely US markets updates and signals to help readers stay informed."
      : `Focused ${contentStyle.toLowerCase()} covering ${topicText}.`;

  return {
    identity: truncate(
      identity,
      240,
    ),
    topics:
      safeTopics,
    audience,
    contentStyle,
    valueProposition,
  };
};

/* ======================================================
   MAIN
====================================================== */

const main = async () => {
  console.log(
    `Blog URL: ${BLOG_URL}`,
  );

  const feedUrl =
    new URL(
      "/feeds/posts/default",
      parsedUrl.origin,
    );

  feedUrl.searchParams.set(
    "alt",
    "json",
  );

  feedUrl.searchParams.set(
    "max-results",
    String(MAX_POSTS),
  );

  console.log(
    `Blogger Feed: ${feedUrl.href}`,
  );

  const feed =
    await fetchJson(
      feedUrl.href,
    );

  const feedData =
    feed?.feed || {};

  const entries =
    Array.isArray(
      feedData.entry,
    )
      ? feedData.entry
      : [];

  if (!entries.length) {
    throw new Error(
      "No Blogger posts were found in the feed.",
    );
  }

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

  /*
  Feed should already be recent-first,
  but sort explicitly to guarantee consistency.
  */

  const sortedEntries =
    [...entries].sort(
      (a, b) => {
        const dateA =
          new Date(
            getEntryDate(a),
          ).getTime() || 0;

        const dateB =
          new Date(
            getEntryDate(b),
          ).getTime() || 0;

        return (
          dateB - dateA
        );
      },
    );

  const selectedEntries =
    sortedEntries.slice(
      0,
      MAX_POSTS,
    );

  const posts = [];

  for (
    let i = 0;
    i < selectedEntries.length;
    i += 1
  ) {
    const entry =
      selectedEntries[i];

    const index =
      i + 1;

    const title =
      getEntryTitle(entry);

    const url =
      absoluteUrl(
        getEntryUrl(entry),
      );

    const published =
      getEntryDate(entry);

    const excerpt =
      truncate(
        htmlToText(
          getEntryHtml(entry),
        ),
        360,
      );

    const categories =
      getEntryCategories(
        entry,
      );

    const imageUrl =
      getEntryImage(entry);

    console.log(
      `\nPost ${index}: ${title}`,
    );

    console.log(
      `Image: ${imageUrl || "none"}`,
    );

    let imageResult = null;

    if (imageUrl) {
      imageResult =
        await downloadImage(
          imageUrl,
          index,
        );
    }

    if (!imageResult) {
      console.log(
        `Using fallback image for post ${index}`,
      );

      imageResult =
        createFallbackPostImage(
          index,
          title,
        );
    }

    posts.push({
      index,
      title,
      url,
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
        imageResult.localPath,

      imageSource:
        imageResult.fallback
          ? "fallback"
          : "post-image",
    });
  }

  const analysis =
    buildAnalysis(
      siteTitle,
      description,
      posts,
    );

  const blogData = {
    version: 3,

    capturedAt:
      new Date().toISOString(),

    url: BLOG_URL,

    hostname:
      parsedUrl.hostname,

    siteTitle,

    description,

    pageHeading:
      siteTitle,

    ogImage: "",

    language: "",

    postCount:
      posts.length,

    analysis,

    posts,
  };

  const jsonPath =
    path.join(
      OUTPUT_DIR,
      "blog.json",
    );

  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      blogData,
      null,
      2,
    ),
    "utf8",
  );

  console.log(
    "\n========================================",
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
    `Output: ${OUTPUT_DIR}`,
  );

  console.log(
    "\nFiles:",
  );

  console.log(
    `- ${jsonPath}`,
  );

  for (const post of posts) {
    console.log(
      `- ${post.localImage}`,
    );
  }
};

main().catch(
  (error) => {
    console.error(
      "\nBLOG CAPTURE FAILED",
    );

    console.error(
      error?.stack ||
        error?.message ||
        String(error),
    );

    process.exit(1);
  },
);
