import puppeteer from "puppeteer";
import fs from "node:fs";
import path from "node:path";

const rawUrl = process.argv[2];

if (!rawUrl) {
  console.error("Usage: node scripts/capture-blog.mjs <blog-url>");
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

const OUTPUT_DIR = path.resolve("template/public/blog");
const POSTS_DIR = path.join(OUTPUT_DIR, "posts");

fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
fs.mkdirSync(POSTS_DIR, { recursive: true });

const clean = (value = "") =>
  String(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const absoluteUrl = (value) => {
  if (!value) return "";

  try {
    return new URL(value, parsedUrl.href).href;
  } catch {
    return "";
  }
};

console.log("========================================");
console.log("BLOG ANALYZER");
console.log("========================================");
console.log(`Blog URL: ${parsedUrl.href}`);
console.log(`Output: ${OUTPUT_DIR}`);
console.log("========================================");

const browser = await puppeteer.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
  ],
});

try {
  const page = await browser.newPage();

  await page.setViewport({
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
  });

  page.setDefaultNavigationTimeout(60000);

  console.log("Opening blog...");

  const response = await page.goto(parsedUrl.href, {
    waitUntil: "networkidle2",
    timeout: 60000,
  });

  if (!response) {
    throw new Error("No response received from blog");
  }

  console.log(`HTTP status: ${response.status()}`);

  await page.evaluate(async () => {
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }

    const images = Array.from(document.images);

    await Promise.all(
      images.map((img) => {
        if (img.complete) return Promise.resolve();

        return new Promise((resolve) => {
          img.addEventListener("load", resolve, { once: true });
          img.addEventListener("error", resolve, { once: true });
        });
      }),
    );
  });

  await new Promise((resolve) => setTimeout(resolve, 1500));

  const extracted = await page.evaluate(() => {
    const cleanText = (element) =>
      element?.textContent?.replace(/\s+/g, " ").trim() || "";

    const meta = (selector) =>
      document.querySelector(selector)?.getAttribute("content") || "";

    const firstAttr = (selectors, attr) => {
      for (const selector of selectors) {
        const value =
          document.querySelector(selector)?.getAttribute(attr) || "";

        if (value) return value;
      }

      return "";
    };

    const selectors = [
      ".post-outer",
      ".post-outer-container",
      "article.post",
      ".blog-post",
      ".hentry",
      "article",
      ".post",
    ];

    let postSelector = "";
    let postElements = [];

    for (const selector of selectors) {
      const elements = Array.from(
        document.querySelectorAll(selector),
      );

      if (elements.length > 0) {
        postSelector = selector;
        postElements = elements;
        break;
      }
    }

    const posts = postElements
      .map((post, index) => {
        const titleElement =
          post.querySelector(
            ".post-title, .entry-title, .post-title-link, h1, h2, h3, h4",
          );

        const linkElement =
          post.querySelector(
            ".post-title a, .entry-title a, .post-title-link, h1 a, h2 a, h3 a, a[rel='bookmark']",
          ) ||
          (titleElement?.closest("a") ?? null);

        const imageElement =
          post.querySelector(
            "img[src], img[data-src], img[data-original], img[data-lazy-src]",
          );

        const dateElement =
          post.querySelector(
            "time, .date-header, .post-timestamp, .published, .updated",
          );

        const contentElement =
          post.querySelector(
            ".post-body, .post-snippet, .entry-summary, .entry-content, .post-snippet-container, .post-body-container",
          );

        const image =
          imageElement?.getAttribute("data-src") ||
          imageElement?.getAttribute("data-original") ||
          imageElement?.getAttribute("data-lazy-src") ||
          imageElement?.getAttribute("src") ||
          "";

        const title = cleanText(
          titleElement || linkElement,
        );

        const url = linkElement?.href || "";

        const date = cleanText(dateElement);

        const excerpt = cleanText(contentElement).slice(
          0,
          420,
        );

        return {
          index,
          title,
          url,
          date,
          excerpt,
          image,
        };
      })
      .filter((post) => post.title || post.url)
      .slice(0, 5);

    return {
      postSelector,
      posts,

      siteTitle:
        meta('meta[property="og:site_name"]') ||
        meta('meta[property="og:title"]') ||
        cleanText(document.querySelector(".header-title")) ||
        cleanText(document.querySelector("#Header1 h1")) ||
        cleanText(document.querySelector(".title")) ||
        document.title ||
        location.hostname,

      description:
        meta('meta[name="description"]') ||
        meta('meta[property="og:description"]') ||
        cleanText(document.querySelector(".description")) ||
        cleanText(
          document.querySelector(".header-description"),
        ) ||
        "",

      pageHeading: cleanText(
        document.querySelector("h1"),
      ),

      ogImage: firstAttr(
        [
          'meta[property="og:image"]',
          'meta[name="twitter:image"]',
        ],
        "content",
      ),

      bodyText: cleanText(document.body).slice(
        0,
        12000,
      ),

      language:
        document.documentElement.lang || "",
    };
  });

  const posts = extracted.posts.map((post) => ({
    ...post,
    title: clean(post.title),
    date: clean(post.date),
    excerpt: clean(post.excerpt),
    url: absoluteUrl(post.url),
    image: absoluteUrl(post.image),
  }));

  const bodyText = clean(extracted.bodyText);

  const combinedText = clean(
    [
      extracted.siteTitle,
      extracted.description,
      extracted.pageHeading,

      ...posts.flatMap((post) => [
        post.title,
        post.excerpt,
      ]),
    ].join(" "),
  );

  /*
   * -------------------------------------------------------
   * BLOG TOPIC ANALYSIS
   * -------------------------------------------------------
   */

  const topicRules = [
    {
      name: "Markets & Investing",
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
      name: "Economy & Macro",
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
      name: "Technology",
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
      ],
    },
  ];

  const lowerText = combinedText.toLowerCase();

  const topicScores = topicRules
    .map((rule) => ({
      name: rule.name,

      score: rule.keywords.reduce(
        (score, keyword) =>
          score +
          (lowerText.includes(keyword) ? 1 : 0),
        0,
      ),
    }))
    .sort((a, b) => b.score - a.score);

  const topics = topicScores
    .filter((item) => item.score > 0)
    .slice(0, 3)
    .map((item) => item.name);

  if (topics.length === 0) {
    topics.push("General Insights");
  }

  /*
   * -------------------------------------------------------
   * AUDIENCE / STYLE ANALYSIS
   * -------------------------------------------------------
   */

  const hasQuestionTitles = posts.some((post) =>
    /^(what|why|how|when|where|can|should|will|is|are)\b/i.test(
      post.title,
    ),
  );

  const hasMarketTerms =
    /stock|market|nasdaq|s&p|futures|hang seng|nikkei|trading/i.test(
      combinedText,
    );

  const audience = hasMarketTerms
    ? "Investors and market-focused readers"
    : "Readers looking for practical insights and analysis";

  const contentStyle =
    hasQuestionTitles ||
    /guide|how to|what is|explained/i.test(
      combinedText,
    )
      ? "Educational and explanatory"
      : "News, analysis and commentary";

  const valueProposition = hasMarketTerms
    ? "Clear market context, timely analysis and practical insights for investors."
    : "Curated ideas and useful insights presented in an easy-to-follow format.";

  console.log(
    `Detected post selector: ${
      extracted.postSelector || "none"
    }`,
  );

  console.log(
    `Detected posts: ${posts.length}`,
  );

  /*
   * -------------------------------------------------------
   * HOMEPAGE SCREENSHOT
   * -------------------------------------------------------
   */

  console.log("Capturing homepage...");

  await page.screenshot({
    path: path.join(
      OUTPUT_DIR,
      "home.png",
    ),
    fullPage: true,
  });

  /*
   * -------------------------------------------------------
   * POST SCREENSHOTS
   * -------------------------------------------------------
   */

  if (
    extracted.postSelector &&
    posts.length > 0
  ) {
    const postElements = await page.$$(
      extracted.postSelector,
    );

    const limit = Math.min(
      postElements.length,
      posts.length,
      5,
    );

    for (let i = 0; i < limit; i++) {
      try {
        await postElements[i].evaluate(
          (element) => {
            element.scrollIntoView({
              block: "center",
              inline: "nearest",
            });
          },
        );

        await new Promise((resolve) =>
          setTimeout(resolve, 300),
        );

        const screenshotPath = path.join(
          POSTS_DIR,
          `post-${i + 1}.png`,
        );

        await postElements[i].screenshot({
          path: screenshotPath,
        });

        posts[i].localScreenshot =
          `blog/posts/post-${i + 1}.png`;

        console.log(
          `Captured post ${i + 1}: ${
            posts[i].title ||
            "(untitled)"
          }`,
        );
      } catch (error) {
        console.warn(
          `Could not capture post ${
            i + 1
          }: ${error.message}`,
        );
      }
    }
  }

  /*
   * -------------------------------------------------------
   * FINAL BLOG DATA
   * -------------------------------------------------------
   */

  const result = {
    version: 3,

    url: parsedUrl.href,

    siteTitle:
      clean(extracted.siteTitle) ||
      parsedUrl.hostname,

    description:
      clean(extracted.description),

    pageHeading:
      clean(extracted.pageHeading),

    ogImage:
      absoluteUrl(extracted.ogImage),

    language:
      clean(extracted.language),

    posts,

    postCount:
      posts.length,

    analysis: {
      topics,

      audience,

      contentStyle,

      valueProposition,

      sourceTextLength:
        bodyText.length,
    },

    capturedAt:
      new Date().toISOString(),
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
    `Site: ${result.siteTitle}`,
  );

  console.log(
    `Posts: ${result.postCount}`,
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
    "========================================",
  );

  console.log(
    JSON.stringify(
      result,
      null,
      2,
    ),
  );
} catch (error) {
  console.error("");

  console.error(
    "========================================",
  );

  console.error(
    "BLOG ANALYSIS FAILED",
  );

  console.error(
    "========================================",
  );

  console.error(error);

  process.exitCode = 1;
} finally {
  await browser.close();
}
