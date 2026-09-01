import puppeteer from "puppeteer";
import fs from "node:fs";
import path from "node:path";

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

const OUTPUT_DIR = path.resolve(
  "template/public/blog",
);

const POSTS_DIR = path.join(
  OUTPUT_DIR,
  "posts",
);

fs.rmSync(OUTPUT_DIR, {
  recursive: true,
  force: true,
});

fs.mkdirSync(POSTS_DIR, {
  recursive: true,
});

const MAX_POSTS = 5;

const clean = (value = "") =>
  String(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const absoluteUrl = (value) => {
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
    .replace(/&#(\d+);/g, (_, code) =>
      String.fromCharCode(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
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
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<\/div>/gi, "\n")
        .replace(/<[^>]+>/g, " "),
    ),
  );

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
      return match[1];
    }
  }

  return "";
};

const getEntryText = (entry) => {
  return (
    entry?.content?.$t ||
    entry?.summary?.$t ||
    ""
  );
};

const getEntryUrl = (entry) => {
  const links = Array.isArray(entry?.link)
    ? entry.link
    : [];

  const alternate = links.find(
    (link) =>
      link?.rel === "alternate" &&
      link?.href,
  );

  if (alternate?.href) {
    return alternate.href;
  }

  const first = links.find(
    (link) => link?.href,
  );

  return first?.href || "";
};

const getEntryImage = (entry) => {
  const thumbnail =
    entry?.media$thumbnail?.url;

  if (thumbnail) {
    return thumbnail;
  }

  const html = getEntryText(entry);

  return extractImageFromHtml(html);
};

const getPublishedDate = (entry) =>
  entry?.published?.$t ||
  entry?.updated?.$t ||
  "";

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
          "Mozilla/5.0 (compatible; BlogVideoGenerator/1.0)",
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
  const text = await fetchText(url);

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Response was not valid JSON from ${url}`,
    );
  }
};

const extensionFromContentType = (
  contentType = "",
) => {
  const type =
    contentType
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

  if (
    type === "image/avif"
  ) {
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
    const response = await fetch(
      imageUrl,
      {
        redirect: "follow",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; BlogVideoGenerator/1.0)",
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

    const buffer = Buffer.from(
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

    const outputPath = path.join(
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

const createFallbackScreenshot = async (
  browser,
) => {
  const page =
    await browser.newPage();

  try {
    await page.setViewport({
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
    });

    await page.setContent(
      `
      <!doctype html>
      <html>
      <head>
        <style>
          * {
            box-sizing: border-box;
          }

          html,
          body {
            margin: 0;
            width: 100%;
            height: 100%;
            background: #0b1220;
            color: white;
            font-family:
              Arial,
              Helvetica,
              sans-serif;
          }

          body {
            display: flex;
            align-items: center;
            justify-content: center;
          }

          .container {
            width: 1500px;
            padding: 100px;
          }

          .label {
            font-size: 24px;
            letter-spacing: 7px;
            opacity: 0.55;
            margin-bottom: 35px;
          }

          .title {
            font-size: 76px;
            font-weight: 800;
            line-height: 1.08;
          }

          .url {
            margin-top: 35px;
            font-size: 28px;
            opacity: 0.6;
          }

          .line {
            margin-top: 60px;
            width: 180px;
            height: 5px;
            background: white;
            opacity: 0.5;
          }
        </style>
      </head>

      <body>
        <div class="container">
          <div class="label">
            BLOG PREVIEW
          </div>

          <div class="title">
            ${escapeHtml(
              parsedUrl.hostname,
            )}
          </div>

          <div class="url">
            ${escapeHtml(
              parsedUrl.href,
            )}
          </div>

          <div class="line"></div>
        </div>
      </body>
      </html>
      `,
      {
        waitUntil:
          "load",
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
  }
};

const escapeHtml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

console.log(
  "========================================",
);

console.log(
  "BLOG VIDEO CONTENT CAPTURE",
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

/*
 * -------------------------------------------------------
 * 1. BLOGGER FEED
 * -------------------------------------------------------
 */

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

  feed = await fetchJson(
    feedUrl.href,
  );

  console.log(
    "Blogger Feed loaded successfully.",
  );
} catch (error) {
  console.error(
    "Failed to load Blogger Feed.",
  );

  console.error(error);

  process.exit(1);
}

const feedInfo =
  feed?.feed || {};

const entries = Array.isArray(
  feedInfo.entry,
)
  ? feedInfo.entry
  : [];

console.log(
  `Feed entries found: ${entries.length}`,
);

/*
 * -------------------------------------------------------
 * 2. BLOG INFORMATION
 * -------------------------------------------------------
 */

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
    feedInfo?.["xml:lang"],
  );

console.log(
  `Site title: ${siteTitle}`,
);

console.log(
  `Description: ${
    description || "(none)"
  }`,
);

/*
 * -------------------------------------------------------
 * 3. POST EXTRACTION
 * -------------------------------------------------------
 */

const posts = entries
  .map((entry, index) => {
    const html =
      getEntryText(entry);

    const text =
      htmlToText(html);

    const title =
      clean(
        entry?.title?.$t,
      );

    const url =
      absoluteUrl(
        getEntryUrl(entry),
      );

    const published =
      getPublishedDate(entry);

    const image =
      absoluteUrl(
        getEntryImage(entry),
      );

    const categories =
      Array.isArray(
        entry?.category,
      )
        ? entry.category
            .map(
              (category) =>
                clean(
                  category?.term,
                ),
            )
            .filter(Boolean)
        : [];

    return {
      index,

      title,

      url,

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

      published,

      excerpt: truncate(
        text,
        360,
      ),

      image,

      categories,

      localScreenshot: "",
    };
  })
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
  `Usable posts: ${posts.length}`,
);

for (
  let i = 0;
  i < posts.length;
  i++
) {
  console.log(
    `${i + 1}. ${posts[i].title}`,
  );
}

/*
 * -------------------------------------------------------
 * 4. BLOG TOPIC ANALYSIS
 * -------------------------------------------------------
 */

const combinedText =
  clean(
    [
      siteTitle,
      description,

      ...posts.flatMap(
        (post) => [
          post.title,
          post.excerpt,
          ...post.categories,
        ],
      ),
    ].join(" "),
  );

const lowerText =
  combinedText.toLowerCase();

const topicRules = [
  {
    name: "Markets & Investing",

    keywords: [
      "stock",
      "stocks",
      "investing",
      "investor",
      "investors",
      "market",
      "markets",
      "nasdaq",
      "s&p",
      "sp500",
      "s&p 500",
      "dow",
      "futures",
      "bond",
      "bonds",
      "etf",
      "portfolio",
      "trading",
      "trader",
    ],
  },

  {
    name: "Economy & Macro",

    keywords: [
      "inflation",
      "cpi",
      "ppi",
      "gdp",
      "fed",
      "federal reserve",
      "interest rate",
      "interest rates",
      "rates",
      "economy",
      "economic",
      "macro",
      "employment",
      "jobs",
      "unemployment",
      "consumer price",
    ],
  },

  {
    name: "Technology",

    keywords: [
      "ai",
      "artificial intelligence",
      "technology",
      "software",
      "semiconductor",
      "semiconductors",
      "chip",
      "chips",
      "cloud",
      "robotics",
      "nvidia",
    ],
  },

  {
    name: "Business",

    keywords: [
      "business",
      "company",
      "companies",
      "earnings",
      "revenue",
      "profit",
      "finance",
      "industry",
      "corporate",
    ],
  },

  {
    name: "Asia Markets",

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
      "kospi",
      "kosdaq",
    ],
  },
];

const topicScores =
  topicRules
    .map((rule) => ({
      name: rule.name,

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
    }))
    .sort(
      (a, b) =>
        b.score - a.score,
    );

const topics =
  topicScores
    .filter(
      (item) =>
        item.score > 0,
    )
    .slice(0, 3)
    .map(
      (item) =>
        item.name,
    );

if (topics.length === 0) {
  topics.push(
    "General Insights",
  );
}

const marketFocused =
  /stock|market|nasdaq|s&p|futures|hang seng|nikkei|invest/i.test(
    combinedText,
  );

const educational =
  /how to|what is|explained|guide|why|strategy/i.test(
    combinedText,
  );

const audience =
  marketFocused
    ? "Investors and market-focused readers"
    : "Readers looking for practical insights and analysis";

const contentStyle =
  educational
    ? "Educational and explanatory"
    : "News, analysis and commentary";

const valueProposition =
  marketFocused
    ? "Clear market context, timely analysis and practical insights for investors."
    : "Curated ideas and useful insights presented in an easy-to-follow format.";

console.log(
  `Topics: ${topics.join(", ")}`,
);

console.log(
  `Audience: ${audience}`,
);

console.log(
  `Content style: ${contentStyle}`,
);

/*
 * -------------------------------------------------------
 * 5. IMAGE DOWNLOAD
 * -------------------------------------------------------
 */

const browser =
  await puppeteer.launch({
    headless: true,

    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

try {
  console.log(
    "Downloading post images...",
  );

  for (
    let i = 0;
    i < posts.length;
    i++
  ) {
    const post =
      posts[i];

    const image =
      await downloadImage(
        post.image,
        i + 1,
      );

    if (image) {
      post.localScreenshot =
        image.localPath;

      console.log(
        `Saved image for post ${i + 1}: ${image.filename}`,
      );
    } else {
      console.log(
        `No downloadable image for post ${i + 1}`,
      );
    }
  }

  /*
   * -----------------------------------------------------
   * 6. HOMEPAGE SCREENSHOT
   * -----------------------------------------------------
   */

  console.log(
    "Opening homepage for visual capture...",
  );

  const page =
    await browser.newPage();

  try {
    await page.setViewport({
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
    });

    page.setDefaultNavigationTimeout(
      45000,
    );

    let homepageLoaded =
      false;

    try {
      const response =
        await page.goto(
          parsedUrl.href,
          {
            waitUntil:
              "domcontentloaded",
            timeout: 45000,
          },
        );

      if (response) {
        console.log(
          `Homepage HTTP status: ${response.status()}`,
        );
      }

      await new Promise(
        (resolve) =>
          setTimeout(
            resolve,
            2500,
          ),
      );

      homepageLoaded = true;
    } catch (error) {
      console.warn(
        `Homepage navigation failed: ${error.message}`,
      );
    }

    const pageText =
      homepageLoaded
        ? clean(
            await page.evaluate(
              () =>
                document.body
                  ?.innerText ||
                "",
            ),
          )
        : "";

    const captchaDetected =
      /unusual traffic|not a robot|recaptcha|captcha|our systems have detected/i.test(
        pageText,
      );

    if (
      homepageLoaded &&
      !captchaDetected
    ) {
      console.log(
        "Normal homepage detected.",
      );

      await page.screenshot({
        path: path.join(
          OUTPUT_DIR,
          "home.png",
        ),
        fullPage: true,
      });
    } else {
      console.log(
        "CAPTCHA / blocked homepage detected.",
      );

      console.log(
        "Creating local fallback preview instead.",
      );

      await createFallbackScreenshot(
        browser,
      );
    }
  } finally {
    await page.close();
  }
} finally {
  await browser.close();
}

/*
 * -------------------------------------------------------
 * 7. FALLBACK IMAGE ASSIGNMENT
 * -------------------------------------------------------
 */

for (const post of posts) {
  if (!post.localScreenshot) {
    post.localScreenshot =
      "blog/home.png";
  }
}

/*
 * -------------------------------------------------------
 * 8. BLOG JSON
 * -------------------------------------------------------
 */

const result = {
  version: 4,

  url: parsedUrl.href,

  siteTitle,

  description,

  pageHeading:
    siteTitle,

  ogImage:
    "",

  language,

  posts,

  postCount:
    posts.length,

  analysis: {
    topics,

    audience,

    contentStyle,

    valueProposition,

    sourceTextLength:
      combinedText.length,
  },

  source: {
    type: "blogger-feed",

    feedUrl:
      feedUrl.href,

    homepageBlocked:
      true,
  },

  capturedAt:
    new Date().toISOString(),
};

const outputPath =
  path.join(
    OUTPUT_DIR,
    "blog.json",
  );

fs.writeFileSync(
  outputPath,
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
  `Topics: ${topics.join(", ")}`,
);

console.log(
  `Audience: ${audience}`,
);

console.log(
  `Style: ${contentStyle}`,
);

console.log(
  `JSON: ${outputPath}`,
);

console.log(
  "========================================",
);

console.log(
  JSON.stringify(
    result,
    null,
    2,
  ),
);
