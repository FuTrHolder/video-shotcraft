import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer";

/*
=========================================================
BLOG VIDEO CONTENT CAPTURE
---------------------------------------------------------
Input:
  node scripts/capture-blog.mjs <blog-url>

Output:
  template/public/blog/
    ├── blog.json
    ├── home.png
    └── posts/
        ├── post-1.jpg
        ├── post-2.jpg
        ├── post-3.jpg
        ├── post-4.jpg
        └── post-5.jpg

Design goal:
  BLOG URL
      ↓
  Blogger Feed
      ↓
  Recent Posts
      ↓
  Images + Titles + Excerpts
      ↓
  Content Analysis
      ↓
  blog.json
      ↓
  Remotion BlogPromo
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

const htmlToText = (html = "") =>
  clean(
    decodeHtml(
      String(html)
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
        ),
    ),
  );

/* ======================================================
   HTML IMAGE EXTRACTION
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
    const match =
      source.match(pattern);

    if (match?.[1]) {
      return match[1];
    }
  }

  return "";
};

/* ======================================================
   BLOGGER ENTRY HELPERS
====================================================== */

const getEntryHtml = (entry) =>
  entry?.content?.$t ||
  entry?.summary?.$t ||
  "";

const getEntryUrl = (entry) => {
  const links = Array.isArray(
    entry?.link,
  )
    ? entry.link
    : [];

  const alternate =
    links.find(
      (link) =>
        link?.rel === "alternate" &&
        link?.href,
    );

  if (alternate?.href) {
    return alternate.href;
  }

  return (
    links.find(
      (link) => link?.href,
    )?.href || ""
  );
};

const getEntryImage = (entry) => {
  const thumbnail =
    entry?.media$thumbnail?.url;

  if (thumbnail) {
    return thumbnail;
  }

  return extractImageFromHtml(
    getEntryHtml(entry),
  );
};

const getEntryDate = (entry) =>
  entry?.published?.$t ||
  entry?.updated?.$t ||
  "";

/* ======================================================
   IMAGE URL QUALITY
---------------------------------------------------------
Blogger thumbnails often look like:

  .../s72-c/image.jpg

Upgrade them where possible to:

  .../s1600/image.jpg

This gives Remotion a much better source image.
====================================================== */

const upgradeBloggerImageUrl = (
  value = "",
) => {
  let url = absoluteUrl(value);

  if (!url) {
    return "";
  }

  url = url.replace(
    /\/s\d+(?:-c)?\//i,
    "/s1600/",
  );

  url = url.replace(
    /\/w\d+-h\d+(?:-p-k-no)?\//i,
    "/s1600/",
  );

  return url;
};

/* ======================================================
   NETWORK
====================================================== */

const fetchText = async (
  url,
  options = {},
) => {
  const response = await fetch(
    url,
    {
      redirect: "follow",
      ...options,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; BlogVideoGenerator/2.0)",
        Accept:
          "application/json,text/plain,*/*",
        ...(options.headers || {}),
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

const fetchJson = async (url) => {
  const text =
    await fetchText(url);

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Response was not valid JSON from ${url}`,
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

  if (type === "image/png") {
    return ".png";
  }

  if (type === "image/webp") {
    return ".webp";
  }

  if (type === "image/gif") {
    return ".gif";
  }

  if (type === "image/avif") {
    return ".avif";
  }

  return ".jpg";
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
              "Mozilla/5.0 (compatible; BlogVideoGenerator/2.0)",
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
   FALLBACK IMAGE
====================================================== */

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

  const safeTitle =
    String(title || "Blog Post")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg"
     width="1600"
     height="900"
     viewBox="0 0 1600 900">
  <rect width="1600"
        height="900"
        fill="#101010"/>

  <rect x="80"
        y="80"
        width="1440"
        height="740"
        rx="32"
        fill="#171717"
        stroke="#3a3a3a"/>

  <text x="120"
        y="170"
        fill="#ffffff"
        font-size="34"
        font-family="Arial, Helvetica, sans-serif"
        letter-spacing="6">
    BLOG FEATURE
  </text>

  <text x="120"
        y="310"
        fill="#ffffff"
        font-size="64"
        font-weight="700"
        font-family="Arial, Helvetica, sans-serif">
    ${safeTitle}
  </text>

  <text x="120"
        y="730"
        fill="#888888"
        font-size="28"
        font-family="Arial, Helvetica, sans-serif">
    ${escapeXml(parsedUrl.hostname)}
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
    bytes: Buffer.byteLength(svg),
    sourceUrl: "",
    fallback: true,
  };
};

const escapeXml = (
  value = "",
) =>
  String(value)
    .replace(/&/g, "&amp;")
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
      "american market",
      "stocks",
      "stock market",
    ],
  },

  {
    label: "Global Markets",
    keywords: [
      "hong kong",
      "hang seng",
      "taiwan",
      "china",
      "japan",
      "nikkei",
      "asia",
      "europe",
      "european",
      "global market",
      "world market",
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
    label: "Investing",
    keywords: [
      "investing",
      "investor",
      "investment",
      "portfolio",
      "dollar-cost",
      "dca",
      "dividend",
      "valuation",
      "risk",
      "asset allocation",
      "long-term",
    ],
  },

  {
    label: "Technology",
    keywords: [
      "technology",
      "tech",
      "ai",
      "artificial intelligence",
      "semiconductor",
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
    label: "Commodities",
    keywords: [
      "oil",
      "wti",
      "brent",
      "gold",
      "silver",
      "commodity",
      "commodities",
      "energy",
    ],
  },

  {
    label: "Crypto",
    keywords: [
      "bitcoin",
      "ethereum",
      "crypto",
      "cryptocurrency",
      "btc",
      "eth",
      "defi",
      "blockchain",
    ],
  },
];

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "what",
  "how",
  "why",
  "when",
  "into",
  "your",
  "about",
  "after",
  "before",
  "will",
  "are",
  "was",
  "were",
  "has",
  "have",
  "had",
  "their",
  "they",
  "them",
  "than",
  "then",
  "its",
  "our",
  "you",
  "not",
  "but",
  "can",
  "may",
  "all",
  "new",
  "more",
  "key",
  "guide",
  "explained",
  "latest",
  "update",
  "updates",
]);

const tokenize = (value = "") =>
  clean(value)
    .toLowerCase()
    .replace(
      /[^a-z0-9\s&.-]/g,
      " ",
    )
    .split(/\s+/)
    .filter(
      (token) =>
        token.length >= 3 &&
        !STOP_WORDS.has(token),
    );

const analyzeTopics = (
  siteDescription,
  posts,
) => {
  const source = [
    siteDescription,
    ...posts.map(
      (post) =>
        `${post.title} ${post.excerpt} ${(
          post.categories || []
        ).join(" ")}`,
    ),
  ]
    .join(" ")
    .toLowerCase();

  const scored =
    TOPIC_RULES.map(
      (rule) => {
        let score = 0;

        for (
          const keyword of rule.keywords
        ) {
          const occurrences =
            source
              .split(keyword)
              .length - 1;

          score +=
            Math.min(
              occurrences,
              8,
            );
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

  const topics =
    scored
      .slice(0, 4)
      .map(
        (item) =>
          item.label,
      );

  if (topics.length === 0) {
    topics.push(
      "Insights",
      "Analysis",
      "Trends",
    );
  }

  return topics;
};

/* ======================================================
   CONTENT STYLE ANALYSIS
====================================================== */

const analyzeContentStyle = (
  posts,
) => {
  const text = posts
    .map(
      (post) =>
        `${post.title} ${post.excerpt}`,
    )
    .join(" ")
    .toLowerCase();

  const educationalSignals = [
    "what is",
    "how to",
    "guide",
    "explained",
    "beginner",
    "definition",
  ];

  const newsSignals = [
    "today",
    "latest",
    "futures",
    "close",
    "drop",
    "rise",
    "surge",
    "market",
    "before open",
  ];

  const analysisSignals = [
    "analysis",
    "signals",
    "outlook",
    "why",
    "strategy",
    "trend",
    "risk",
  ];

  const score = (
    keywords,
  ) =>
    keywords.reduce(
      (sum, keyword) =>
        sum +
        (text.includes(keyword)
          ? 1
          : 0),
      0,
    );

  const educational =
    score(
      educationalSignals,
    );

  const news =
    score(newsSignals);

  const analysis =
    score(
      analysisSignals,
    );

  if (
    analysis >= news &&
    analysis >= educational
  ) {
    return "Analysis & Commentary";
  }

  if (
    educational >= news
  ) {
    return "Educational & Practical";
  }

  return "Timely Market Updates";
};

/* ======================================================
   AUDIENCE
====================================================== */

const analyzeAudience = (
  topics,
  contentStyle,
) => {
  const topicText =
    topics.join(" ");

  if (
    topicText.includes(
      "Markets",
    ) ||
    topicText.includes(
      "Investing",
    )
  ) {
    if (
      contentStyle.includes(
        "Educational",
      )
    ) {
      return "Readers and investors seeking practical market knowledge";
    }

    return "Investors following markets, trends and economic signals";
  }

  if (
    topicText.includes(
      "Technology",
    )
  ) {
    return "Readers interested in technology, innovation and market trends";
  }

  return "Readers looking for useful insights and practical information";
};

/* ======================================================
   VALUE PROPOSITION
====================================================== */

const createValueProposition = (
  topics,
  contentStyle,
) => {
  const primary =
    topics[0] || "Insights";

  if (
    contentStyle ===
    "Educational & Practical"
  ) {
    return `Practical ${primary.toLowerCase()} knowledge, explained clearly and simply.`;
  }

  if (
    contentStyle ===
    "Timely Market Updates"
  ) {
    return `Timely ${primary.toLowerCase()} updates and signals to help readers stay informed.`;
  }

  return `Clear ${primary.toLowerCase()} analysis, timely context and practical insights for informed decisions.`;
};

/* ======================================================
   HOMEPAGE PREVIEW
---------------------------------------------------------
This is intentionally generated locally.
We DO NOT navigate to the blog homepage with Puppeteer,
which avoids CAPTCHA / anti-bot pages.
====================================================== */

const createHomePreview = async (
  siteTitle,
  description,
  topics,
  posts,
) => {
  const browser =
    await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
      ],
    });

  const page =
    await browser.newPage();

  try {
    await page.setViewport({
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
    });

    const safeSiteTitle =
      escapeHtml(
        siteTitle,
      );

    const safeDescription =
      escapeHtml(
        truncate(
          description,
          180,
        ),
      );

    const topicHtml =
      topics
        .map(
          (topic) =>
            `<span class="topic">${escapeHtml(topic)}</span>`,
        )
        .join("");

    const postHtml =
      posts
        .slice(0, 5)
        .map(
          (post, index) =>
            `<div class="post">
              <span class="number">0${
                index + 1
              }</span>
              <span>${escapeHtml(
                truncate(
                  post.title,
                  72,
                ),
              )}</span>
            </div>`,
        )
        .join("");

    const html = `
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  width: 100%;
  height: 100%;
}

body {
  background:
    radial-gradient(
      circle at 82% 18%,
      #273449 0,
      #111827 28%,
      #080808 68%
    );
  color: #fff;
  font-family:
    Arial,
    Helvetica,
    sans-serif;
}

.page {
  width: 100%;
  height: 100%;
  padding: 90px 110px;
}

.kicker {
  font-size: 22px;
  letter-spacing: 8px;
  color: #9ca3af;
  margin-bottom: 28px;
}

.title {
  font-size: 82px;
  line-height: 1;
  font-weight: 900;
  max-width: 1300px;
}

.description {
  margin-top: 30px;
  font-size: 28px;
  line-height: 1.45;
  color: #cbd5e1;
  max-width: 1150px;
}

.topics {
  display: flex;
  gap: 14px;
  margin-top: 34px;
  flex-wrap: wrap;
}

.topic {
  padding: 12px 20px;
  border: 1px solid rgba(255,255,255,.2);
  border-radius: 999px;
  color: #e5e7eb;
  font-size: 19px;
}

.posts {
  margin-top: 48px;
  width: 1100px;
}

.post {
  display: flex;
  align-items: center;
  gap: 25px;
  padding: 13px 0;
  border-bottom: 1px solid rgba(255,255,255,.12);
  font-size: 22px;
  color: #e5e7eb;
}

.number {
  width: 42px;
  color: #6b7280;
  font-size: 16px;
  letter-spacing: 2px;
}

.footer {
  position: absolute;
  right: 110px;
  bottom: 80px;
  color: #64748b;
  font-size: 18px;
}
</style>
</head>

<body>
<div class="page">

  <div class="kicker">
    BLOG INTELLIGENCE
  </div>

  <div class="title">
    ${safeSiteTitle}
  </div>

  <div class="description">
    ${safeDescription}
  </div>

  <div class="topics">
    ${topicHtml}
  </div>

  <div class="posts">
    ${postHtml}
  </div>

  <div class="footer">
    ${escapeHtml(
      parsedUrl.hostname,
    )}
  </div>

</div>
</body>
</html>
`;

    await page.setContent(
      html,
      {
        waitUntil: "load",
      },
    );

    await page.screenshot({
      path: path.join(
        OUTPUT_DIR,
        "home.png",
      ),
      fullPage: false,
    });
  } finally {
    await page.close();
    await browser.close();
  }
};

/* ======================================================
   MAIN
====================================================== */

console.log(
  "========================================",
);

console.log(
  "BLOG VIDEO CONTENT CAPTURE v2",
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

/* ======================================================
   1. BLOGGER FEED
====================================================== */

const feedUrl =
  new URL(
    "/feeds/posts/default",
    parsedUrl.href,
  );

feedUrl.searchParams.set(
  "alt",
  "json",
);

feedUrl.searchParams.set(
  "max-results",
  String(MAX_POSTS),
);

let feed;

try {
  console.log(
    "Fetching Blogger Feed...",
  );

  console.log(
    `Feed URL: ${feedUrl.href}`,
  );

  feed =
    await fetchJson(
      feedUrl.href,
    );

  console.log(
    "Blogger Feed loaded successfully.",
  );
} catch (error) {
  console.error(
    "Failed to load Blogger Feed.",
  );

  console.error(
    error,
  );

  process.exit(1);
}

/* ======================================================
   2. BLOG INFORMATION
====================================================== */

const feedInfo =
  feed?.feed || {};

const entries =
  Array.isArray(
    feedInfo.entry,
  )
    ? feedInfo.entry
    : [];

const siteTitle =
  clean(
    feedInfo?.title?.$t,
  ) ||
  parsedUrl.hostname;

const description =
  clean(
    feedInfo?.subtitle?.$t,
  );

const language =
  clean(
    feedInfo?.language?.$t,
  ) ||
  clean(
    feedInfo?.[
      "xml:lang"
    ],
  );

console.log(
  `Site title: ${siteTitle}`,
);

console.log(
  `Description: ${
    description || "(none)"
  }`,
);

console.log(
  `Entries found: ${entries.length}`,
);

/* ======================================================
   3. EXTRACT POSTS
====================================================== */

const extractedPosts =
  entries
    .map(
      (entry) => {
        const html =
          getEntryHtml(entry);

        const text =
          htmlToText(html);

        const title =
          clean(
            entry?.title?.$t,
          );

        const url =
          absoluteUrl(
            getEntryUrl(
              entry,
            ),
          );

        const published =
          getEntryDate(entry);

        const rawImage =
          getEntryImage(
            entry,
          );

        const image =
          upgradeBloggerImageUrl(
            rawImage,
          );

        const categories =
          Array.isArray(
            entry?.category,
          )
            ? entry.category
                .map(
                  (
                    category,
                  ) =>
                    clean(
                      category?.term,
                    ),
                )
                .filter(Boolean)
            : [];

        return {
          title,
          url,
          published,
          date: published
            ? new Date(
                published,
              ).toLocaleDateString(
                "en-US",
                {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                },
              )
            : "",
          excerpt:
            truncate(
              text,
              420,
            ),
          image,
          categories,
        };
      },
    )
    .filter(
      (post) =>
        post.title &&
        post.url,
    )
    .sort(
      (a, b) =>
        new Date(
          b.published || 0,
        ).getTime() -
        new Date(
          a.published || 0,
        ).getTime(),
    )
    .slice(0, MAX_POSTS);

console.log(
  `Usable posts: ${extractedPosts.length}`,
);

/* ======================================================
   4. CONTENT ANALYSIS
====================================================== */

const topics =
  analyzeTopics(
    description,
    extractedPosts,
  );

const contentStyle =
  analyzeContentStyle(
    extractedPosts,
  );

const audience =
  analyzeAudience(
    topics,
    contentStyle,
  );

const valueProposition =
  createValueProposition(
    topics,
    contentStyle,
  );

const identity =
  `${siteTitle} focuses on ${topics
    .slice(0, 3)
    .join(", ")}.`;

console.log(
  "----------------------------------------",
);

console.log(
  "BLOG ANALYSIS",
);

console.log(
  `Topics: ${topics.join(
    ", ",
  )}`,
);

console.log(
  `Audience: ${audience}`,
);

console.log(
  `Content style: ${contentStyle}`,
);

console.log(
  `Value proposition: ${valueProposition}`,
);

console.log(
  "----------------------------------------",
);

/* ======================================================
   5. DOWNLOAD POST IMAGES
====================================================== */

const posts = [];

for (
  let i = 0;
  i < extractedPosts.length;
  i++
) {
  const post =
    extractedPosts[i];

  console.log(
    `Processing post ${
      i + 1
    }/${extractedPosts.length}: ${
      post.title
    }`,
  );

  const downloaded =
    await downloadImage(
      post.image,
      i + 1,
    );

  const localImage =
    downloaded ||
    createFallbackPostImage(
      i + 1,
      post.title,
    );

  posts.push({
    ...post,

    index: i + 1,

    image:
      post.image,

    localImage:
      localImage.localPath,

    imageSource:
      downloaded
        ? "post-image"
        : "generated-fallback",
  });
}

/* ======================================================
   6. GENERATE LOCAL HOME PREVIEW
====================================================== */

try {
  await createHomePreview(
    siteTitle,
    description ||
      valueProposition,
    topics,
    posts,
  );

  console.log(
    "home.png created.",
  );
} catch (error) {
  console.warn(
    "Could not create home.png.",
  );

  console.warn(
    error.message,
  );
}

/* ======================================================
   7. BLOG JSON
====================================================== */

const blogData = {
  version: 2,

  capturedAt:
    new Date().toISOString(),

  url:
    parsedUrl.href,

  hostname:
    parsedUrl.hostname,

  siteTitle,

  description,

  pageHeading:
    siteTitle,

  ogImage: "",

  language,

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

/* ======================================================
   8. SUMMARY
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
  `Topics: ${topics.join(
    ", ",
  )}`,
);

console.log(
  `JSON: ${jsonPath}`,
);

console.log(
  "Images:",
);

for (const post of posts) {
  console.log(
    `  ${post.index}. ${post.localImage}`,
  );
}

console.log(
  "========================================",
);
