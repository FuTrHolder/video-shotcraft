import path from "node:path";

export const BLOG_URL = process.env.BLOG_URL || process.argv[2];

if (!BLOG_URL) {
  console.error("Usage: node scripts/capture-blog.mjs <BLOG_URL>");
  process.exit(1);
}

export const OUTPUT_DIR =
  process.env.OUTPUT_DIR ||
  path.resolve(process.cwd(), "template/public/blog-assets");

export const BLOG_JSON =
  process.env.BLOG_JSON ||
  path.resolve(process.cwd(), "template/public/blog.json");

export const USER_AGENT =
  process.env.USER_AGENT ||
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36";

export const MIN_FILE_SIZE = 5000;
export const MIN_WIDTH = 200;
export const MIN_HEIGHT = 150;

export const MAX_POSTS = 5;
export const MAX_FEED_ENTRIES = 10;

export const FETCH_TIMEOUT = 30000;

export const IMAGE_FETCH_TIMEOUT = 60000;
export const IMAGE_MAX_RETRIES = 4;
export const CURL_MAX_BYTES = 50 * 1024 * 1024;
