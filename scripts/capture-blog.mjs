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

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.mkdirSync(POSTS_DIR, { recursive: true });

const clean = (value = "") =>
  value.replace(/\s+/g, " ").trim();

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
        if (img.complete) {
          return Promise.resolve();
        }

        return new Promise((resolve) => {
          img.addEventListener("load", resolve, {
            once: true,
          });

          img.addEventListener("error", resolve, {
            once: true,
          });
        });
      }),
    );
  });

  await new Promise((resolve) => setTimeout(resolve, 1500));

  const blogData = await page.evaluate(() => {
    const text = (element) =>
      element?.textContent?.replace(/\s+/g, " ").trim() || "";

    const meta = (selector) =>
      document
        .querySelector(selector)
        ?.getAttribute("content") || "";

    const firstAttr = (selectors, attr) => {
      for (const selector of selectors) {
        const value =
          document.querySelector(selector)?.getAttribute(attr);

        if (value) {
          return value;
        }
      }

      return "";
    };

    const postSelectors = [
      ".post-outer-container",
      ".post-outer",
      ".post",
      "article.post",
      ".blog-post",
      ".hentry",
      "article",
    ];

    let postElements = [];

    for (const selector of postSelectors) {
      const elements = Array.from(
        document.querySelectorAll(selector),
      );

      if (elements.length > 0) {
        postElements = elements;
        break;
      }
    }

    const posts = postElements
      .map((post, index) => {
        const titleElement = post.querySelector(
          [
            ".post-title",
            ".entry-title",
            "h1",
            "h2",
            "h3",
            "h4",
          ].join(","),
        );

        const linkElement = post.querySelector(
          [
            ".post-title a",
            ".entry-title a",
            "h1 a",
            "h2 a",
            "h3 a",
            'a[rel="bookmark"]',
          ].join(","),
        );

        const imageElement = post.querySelector(
          "img[src], img[data-src], img[data-original]",
        );

        const dateElement = post.querySelector(
          [
            "time",
            ".date-header",
            ".post-timestamp",
            ".published",
          ].join(","),
        );

        const contentElement = post.querySelector(
          [
            ".post-body",
            ".post-snippet",
            ".entry-summary",
            ".entry-content",
            ".post-snippet-container",
          ].join(","),
        );

        const image =
          imageElement?.getAttribute("src") ||
          imageElement?.getAttribute("data-src") ||
          imageElement?.getAttribute("data-original") ||
          "";

        return {
          index,
          title: text(titleElement || linkElement),
          url: linkElement?.href || "",
          date: text(dateElement),
          excerpt: text(contentElement).slice(0, 300),
          image,
        };
      })
      .filter(
        (post) =>
          post.title ||
          post.url ||
          post.image,
      )
      .slice(0, 5);

    return {
      siteTitle:
        meta('meta[property="og:site_name"]') ||
        meta('meta[property="og:title"]') ||
        text(document.querySelector(".header-title")) ||
        text(document.querySelector("#Header1 h1")) ||
        text(document.querySelector("h1")) ||
        document.title ||
        location.hostname,

      description:
        meta('meta[name="description"]') ||
        meta('meta[property="og:description"]') ||
        text(document.querySelector(".description")) ||
        text(document.querySelector(".header-description")) ||
        "",

      url: location.href,

      ogImage:
        firstAttr(
          [
            'meta[property="og:image"]',
            'meta[name="twitter:image"]',
          ],
          "content",
        ),

      pageHeading: text(
        document.querySelector("h1"),
      ),

      posts,
    };
  });

  blogData.url = parsedUrl.href;

  blogData.siteTitle =
    clean(blogData.siteTitle) ||
    parsedUrl.hostname;

  blogData.description =
    clean(blogData.description);

  blogData.ogImage =
    absoluteUrl(blogData.ogImage);

  blogData.posts = blogData.posts
    .map((post) => ({
      ...post,
      title: clean(post.title),
      date: clean(post.date),
      excerpt: clean(post.excerpt),
      url: absoluteUrl(post.url),
      image: absoluteUrl(post.image),
    }))
    .filter(
      (post) =>
        post.title ||
        post.url ||
        post.image,
    );

  console.log("Capturing homepage...");

  await page.screenshot({
    path: path.join(
      OUTPUT_DIR,
      "home.png",
    ),
    fullPage: true,
  });

  const postSelectors = [
    "article",
    ".post-outer",
    ".post",
    ".blog-post",
    ".hentry",
    ".entry",
  ];

  let detectedSelector = null;

  for (const selector of postSelectors) {
    const count = await page.$$eval(
      selector,
      (elements) => elements.length,
    );

    if (count > 0) {
      detectedSelector = selector;
      break;
    }
  }

  if (detectedSelector) {
    const postElements = await page.$$(detectedSelector);

    const limit = Math.min(
      postElements.length,
      blogData.posts.length,
      5,
    );

    for (let i = 0; i < limit; i++) {
      const element = postElements[i];

      try {
        await element.scrollIntoView();

        await new Promise((resolve) =>
          setTimeout(resolve, 250),
        );

        const screenshotPath = path.join(
          POSTS_DIR,
          `post-${i + 1}.png`,
        );

        await element.screenshot({
          path: screenshotPath,
        });

        blogData.posts[i].localScreenshot =
          `blog/posts/post-${i + 1}.png`;

        console.log(
          `Captured post ${i + 1}: ${blogData.posts[i].title}`,
        );
      } catch (error) {
        console.warn(
          `Could not capture post ${i + 1}:`,
          error.message,
        );
      }
    }
  }

  const result = {
    version: 2,
    url: blogData.url,
    siteTitle: blogData.siteTitle,
    description: blogData.description,
    pageHeading: blogData.pageHeading,
    ogImage: blogData.ogImage,
    posts: blogData.posts,
    postCount: blogData.posts.length,
    capturedAt: new Date().toISOString(),
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
  console.log("========================================");
  console.log("BLOG ANALYSIS COMPLETE");
  console.log("========================================");

  console.log(
    JSON.stringify(
      result,
      null,
      2,
    ),
  );
} catch (error) {
  console.error("");
  console.error("========================================");
  console.error("BLOG ANALYSIS FAILED");
  console.error("========================================");

  console.error(error);

  process.exitCode = 1;
} finally {
  await browser.close();
}
