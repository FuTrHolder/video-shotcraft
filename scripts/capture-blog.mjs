import puppeteer from "puppeteer";
import fs from "node:fs";
import path from "node:path";

const BLOG_URL = process.argv[2];

if (!BLOG_URL) {
  console.error("Usage: node scripts/capture-blog.mjs <blog-url>");
  process.exit(1);
}

let parsedUrl;

try {
  parsedUrl = new URL(BLOG_URL);
} catch {
  console.error(`Invalid blog URL: ${BLOG_URL}`);
  process.exit(1);
}

const OUTPUT_DIR = path.resolve("template/public/blog");

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

console.log(`Blog URL: ${parsedUrl.href}`);
console.log(`Output: ${OUTPUT_DIR}`);

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

  await page.goto(parsedUrl.href, {
    waitUntil: "networkidle2",
    timeout: 60000,
  });

  await page.evaluate(async () => {
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }
  });

  await new Promise((resolve) => setTimeout(resolve, 1500));

  const title = await page.title();

  const metaDescription = await page
    .$eval(
      'meta[name="description"]',
      (el) => el.getAttribute("content") || "",
    )
    .catch(() => "");

  const h1 = await page
    .$eval("h1", (el) => el.textContent?.trim() || "")
    .catch(() => "");

  const ogImage = await page
    .$eval(
      'meta[property="og:image"]',
      (el) => el.getAttribute("content") || "",
    )
    .catch(() => "");

  const result = {
    url: parsedUrl.href,
    title,
    description: metaDescription,
    h1,
    ogImage,
    capturedAt: new Date().toISOString(),
  };

  await page.screenshot({
    path: path.join(OUTPUT_DIR, "home.png"),
    fullPage: true,
  });

  fs.writeFileSync(
    path.join(OUTPUT_DIR, "blog.json"),
    JSON.stringify(result, null, 2),
  );

  console.log("Captured blog:");
  console.log(JSON.stringify(result, null, 2));

  console.log(
    `Screenshot written to ${path.join(OUTPUT_DIR, "home.png")}`,
  );
} catch (error) {
  console.error("Blog capture failed:");
  console.error(error);

  process.exitCode = 1;
} finally {
  await browser.close();
}
