import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const MAX_POSTS = 5;
const rawUrl = process.argv[2];

if (!rawUrl) {
  console.error("Usage: node scripts/capture-blog.mjs <blog-url>");
  process.exit(1);
}

const normalizeInputUrl = (value) => {
  const match = String(value).trim().match(/^\[[^\]]+\]\(([^)]+)\)$/);
  return (match ? match[1] : String(value)).trim().replace(/^<|>$/g, "");
};

const BLOG_URL = normalizeInputUrl(rawUrl);
let blogUrl;
try {
  blogUrl = new URL(BLOG_URL);
  if (!/^https?:$/.test(blogUrl.protocol)) throw new Error("Unsupported protocol");
} catch {
  console.error(`Invalid blog URL: ${BLOG_URL}`);
  process.exit(1);
}

const OUTPUT_DIR = path.resolve("template/public/blog");
const POSTS_DIR = path.join(OUTPUT_DIR, "posts");
fs.rmSync(OUTPUT_DIR, {recursive: true, force: true});
fs.mkdirSync(POSTS_DIR, {recursive: true});

const clean = (value = "") => String(value).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
const truncate = (value = "", length = 320) => {
  const text = clean(value);
  return text.length <= length ? text : `${text.slice(0, Math.max(1, length - 1))}…`;
};
const decodeHtml = (value = "") => String(value)
  .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
  .replace(/&#39;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
  .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)));
const htmlToText = (html = "") => clean(decodeHtml(String(html)
  .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<[^>]+>/g, " ")));

const absoluteUrl = (value, baseUrl = blogUrl.href) => {
  if (!value) return "";
  try {
    const url = new URL(String(value).trim().replace(/^['"]|['"]$/g, ""), baseUrl);
    return /^https?:$/.test(url.protocol) ? url.href : "";
  } catch { return ""; }
};

// Blogger CDN serves the same image under many sizes. Use one stable original-size
// URL for both download and URL-level de-duplication.
const upgradeBloggerImageUrl = (value, baseUrl) => absoluteUrl(value, baseUrl)
  .replace(/\/s\d+(?:-[^/]+)?\//i, "/s1600/")
  .replace(/\/w\d+(?:-h\d+)?(?:-[^/]+)?\//i, "/s1600/");
const urlKey = (value) => {
  try {
    const url = new URL(value);
    url.hash = "";
    // Cache/signature parameters do not identify the editorial image.
    ["utm_source", "utm_medium", "utm_campaign", "fbclid", "gclid"].forEach((key) => url.searchParams.delete(key));
    return url.href;
  } catch { return value; }
};

const attr = (tag, name) => String(tag).match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1] || "";
const imagesFromHtml = (html = "", baseUrl) => {
  const candidates = [];
  for (const tag of String(html).match(/<img\b[^>]*>/gi) || []) {
    for (const name of ["data-src", "data-original", "data-lazy-src", "data-image", "data-url", "src"]) {
      const value = attr(tag, name);
      if (value && !/^(?:data|blob):/i.test(value)) candidates.push(upgradeBloggerImageUrl(value, baseUrl));
    }
    for (const item of attr(tag, "srcset").split(",")) {
      const value = item.trim().split(/\s+/)[0];
      if (value) candidates.push(upgradeBloggerImageUrl(value, baseUrl));
    }
  }
  return [...new Set(candidates.filter(Boolean))];
};

const metaImages = (html = "", baseUrl) => {
  const values = [];
  const tags = String(html).match(/<(?:meta|link)\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const property = (attr(tag, "property") || attr(tag, "name") || attr(tag, "rel")).toLowerCase();
    if (["og:image", "twitter:image", "twitter:image:src", "image_src"].includes(property)) {
      values.push(upgradeBloggerImageUrl(attr(tag, "content") || attr(tag, "href"), baseUrl));
    }
  }
  return [...new Set(values.filter(Boolean))];
};

const entryHtml = (entry) => entry?.content?.$t || entry?.summary?.$t || "";
const entryUrl = (entry) => (Array.isArray(entry?.link) ? entry.link : [])
  .find((link) => link?.rel === "alternate" && link?.href)?.href || "";
const entryDate = (entry) => entry?.published?.$t || entry?.updated?.$t || "";
const entryTitle = (entry) => clean(entry?.title?.$t || "Untitled Post");
const entryCategories = (entry) => [...new Set((Array.isArray(entry?.category) ? entry.category : [])
  .map((item) => clean(item?.term)).filter(Boolean))];

const pushCandidate = (into, url, source, baseUrl) => {
  const normalized = upgradeBloggerImageUrl(url, baseUrl);
  if (normalized) into.push({url: normalized, source, key: urlKey(normalized)});
};
const uniqueCandidates = (items) => {
  const keys = new Set();
  return items.filter((item) => !keys.has(item.key) && keys.add(item.key));
};

const feedCandidates = (entry) => {
  const candidates = [];
  // Prefer body images: generic Blogger thumbnails are frequently shared site images.
  imagesFromHtml(entryHtml(entry)).forEach((url) => pushCandidate(candidates, url, "feed-html"));
  const mediaContent = Array.isArray(entry?.media$content) ? entry.media$content : [];
  mediaContent.forEach((item) => pushCandidate(candidates, item?.url, "media-content"));
  pushCandidate(candidates, entry?.media$thumbnail?.url, "media-thumbnail");
  const links = Array.isArray(entry?.link) ? entry.link : [];
  links.filter((link) => ["enclosure", "related"].includes(link?.rel)).forEach((link) => pushCandidate(candidates, link.href, `link-${link.rel}`));
  const enclosures = Array.isArray(entry?.enclosure) ? entry.enclosure : [];
  enclosures.forEach((item) => pushCandidate(candidates, item?.url || item?.href, "enclosure"));
  return uniqueCandidates(candidates);
};

const fetchResponse = async (url, options = {}) => {
  const response = await fetch(url, {redirect: "follow", ...options, headers: {
    "User-Agent": "Mozilla/5.0 (compatible; BlogVideoGenerator/5.0)",
    Accept: options.accept || "text/html,application/xhtml+xml,application/json,*/*",
    ...(options.headers || {}),
  }});
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  return response;
};
const fetchText = async (url) => (await fetchResponse(url)).text();
const fetchJson = async (url) => JSON.parse(await fetchText(url));

const pageCandidates = async (postUrl) => {
  if (!postUrl) return [];
  try {
    console.log(`Fetching post page: ${postUrl}`);
    const html = await fetchText(postUrl);
    const candidates = [];
    // The page body is more specific than OG metadata, which is often the site default.
    imagesFromHtml(html, postUrl).forEach((url) => pushCandidate(candidates, url, "post-html", postUrl));
    metaImages(html, postUrl).forEach((url) => pushCandidate(candidates, url, "post-meta", postUrl));
    return uniqueCandidates(candidates);
  } catch (error) {
    console.warn(`Post page fetch failed: ${error.message}`);
    return [];
  }
};

const detectSignature = (buffer) => {
  if (buffer.length < 12) return "";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"))) return "gif";
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  if (buffer.subarray(4, 12).toString("ascii").includes("ftyp")) return "avif";
  if (buffer.subarray(0, 1000).toString("utf8").toLowerCase().includes("<svg")) return "svg";
  return "";
};
const extensions = {jpeg: ".jpg", png: ".png", gif: ".gif", webp: ".webp", avif: ".avif", svg: ".svg"};
const fetchImage = async (candidate) => {
  try {
    const response = await fetchResponse(candidate.url, {accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"});
    const buffer = Buffer.from(await response.arrayBuffer());
    const signature = detectSignature(buffer);
    if (buffer.length < 500) throw new Error(`response too small (${buffer.length} bytes)`);
    if (!signature) throw new Error(`not a recognized image (${response.headers.get("content-type") || "unknown type"})`);
    return {buffer, signature, bytes: buffer.length, contentType: response.headers.get("content-type") || `image/${signature}`,
      sha256: crypto.createHash("sha256").update(buffer).digest("hex")};
  } catch (error) {
    console.warn(`Candidate rejected [${candidate.source}]: ${candidate.url} (${error.message})`);
    return null;
  }
};

const escapeXml = (value = "") => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const createFallback = (index, title, reason) => {
  const filename = `post-${index}.svg`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="#10141c"/><rect x="70" y="70" width="1460" height="760" rx="36" fill="#171c25" stroke="#3b4555" stroke-width="2"/><text x="120" y="180" fill="#91a4c4" font-size="30" font-family="Arial" letter-spacing="7">BLOG FEATURE ${index}</text><text x="120" y="340" fill="#fff" font-size="58" font-weight="700" font-family="Arial">${escapeXml(truncate(title, 46))}</text><text x="120" y="750" fill="#8d98a8" font-size="24" font-family="Arial">${escapeXml(reason)}</text></svg>`;
  fs.writeFileSync(path.join(POSTS_DIR, filename), svg, "utf8");
  return {filename, localPath: `blog/posts/${filename}`, bytes: Buffer.byteLength(svg), contentType: "image/svg+xml", signature: "svg",
    sha256: crypto.createHash("sha256").update(svg).digest("hex"), fallback: true, sourceUrl: "", candidateSource: "fallback", fallbackReason: reason};
};

const writeSelectedImage = (index, candidate, image) => {
  const filename = `post-${index}${extensions[image.signature]}`;
  fs.writeFileSync(path.join(POSTS_DIR, filename), image.buffer);
  return {filename, localPath: `blog/posts/${filename}`, ...image, fallback: false, sourceUrl: candidate.url,
    candidateSource: candidate.source, fallbackReason: ""};
};

const TOPIC_RULES = [["US Markets", ["s&p", "nasdaq", "dow", "wall street", "nyse", "stock"]], ["Global Markets", ["hong kong", "hang seng", "china", "japan", "nikkei", "asia", "europe"]], ["Macro & Economy", ["inflation", "interest rate", "federal reserve", "yield", "bond"]], ["Technology", ["technology", "tech", "ai", "semiconductor", "nvidia"]], ["Investing", ["investing", "investment", "trading", "portfolio"]]];
const analyzeTopics = (siteTitle, description, posts) => {
  const source = clean([siteTitle, description, ...posts.map((post) => `${post.title} ${post.excerpt} ${post.categories.join(" ")}`)].join(" ")).toLowerCase();
  const topics = TOPIC_RULES.map(([label, keywords]) => ({label, score: keywords.filter((word) => source.includes(word)).length}))
    .filter((item) => item.score).sort((a, b) => b.score - a.score).slice(0, 4).map((item) => item.label);
  const selected = topics.length ? topics : ["Markets", "Analysis", "Insights"];
  return {identity: truncate(description || `${siteTitle} provides market insights and analysis.`, 240), topics: selected,
    audience: selected.some((topic) => ["US Markets", "Global Markets", "Investing"].includes(topic)) ? "Investors following markets, trends and economic signals" : "Readers interested in the topics covered by this blog",
    contentStyle: selected.some((topic) => ["US Markets", "Global Markets"].includes(topic)) ? "Market & Macro Analysis" : "Expert Insights",
    valueProposition: "Focused insights to help readers stay informed."};
};

const feedUrl = `${blogUrl.origin}${blogUrl.pathname.replace(/\/$/, "")}/feeds/posts/default?alt=json&max-results=${MAX_POSTS}`;
console.log("========================================\nCapturing blog\n========================================");
console.log(`Blog URL: ${BLOG_URL}\nBlogger Feed: ${feedUrl}`);
let feed;
try { feed = await fetchJson(feedUrl); } catch (error) { console.error(`Blogger Feed request failed: ${error.message}`); process.exit(1); }
const feedData = feed?.feed || {};
const entries = Array.isArray(feedData.entry) ? feedData.entry : [];
if (!entries.length) { console.error("No Blogger posts found."); process.exit(1); }

const posts = [];
const usedUrlKeys = new Set();
const usedHashes = new Set();
for (let i = 0; i < Math.min(entries.length, MAX_POSTS); i += 1) {
  const entry = entries[i];
  const index = i + 1;
  const title = entryTitle(entry);
  const postUrl = entryUrl(entry);
  console.log(`\nPost ${index}: ${title}`);
  // Always include page candidates. This is deliberate: an available thumbnail is not proof it belongs uniquely to this post.
  const candidates = uniqueCandidates([...feedCandidates(entry), ...(await pageCandidates(postUrl))]);
  console.log(`Image candidates: ${candidates.length}`);
  let imageInfo = null;
  let duplicateCount = 0;
  for (const candidate of candidates) {
    if (usedUrlKeys.has(candidate.key)) { duplicateCount += 1; console.log(`Candidate skipped (duplicate URL): ${candidate.url}`); continue; }
    const image = await fetchImage(candidate);
    if (!image) continue;
    if (usedHashes.has(image.sha256)) { duplicateCount += 1; console.log(`Candidate skipped (duplicate SHA-256): ${candidate.url}`); continue; }
    imageInfo = writeSelectedImage(index, candidate, image);
    usedUrlKeys.add(candidate.key);
    usedHashes.add(image.sha256);
    console.log(`Image selected [${candidate.source}]: ${imageInfo.filename} SHA256: ${image.sha256}`);
    break;
  }
  if (!imageInfo) {
    const reason = candidates.length === 0 ? "No image candidates found" : duplicateCount ? "All usable candidates duplicate another post" : "No candidate produced a valid image";
    console.log(`Using fallback image for post ${index}: ${reason}`);
    imageInfo = createFallback(index, title, reason);
  }
  const published = entryDate(entry);
  posts.push({index, title, url: postUrl, published, date: published ? new Date(published).toLocaleDateString("en-US", {month: "short", day: "numeric", year: "numeric"}) : "",
    excerpt: truncate(htmlToText(entryHtml(entry)), 320), categories: entryCategories(entry), localImage: imageInfo.localPath,
    imageSource: imageInfo.fallback ? "fallback" : "post-image", imageUrl: imageInfo.sourceUrl, imageBytes: imageInfo.bytes,
    imageContentType: imageInfo.contentType, imageSignature: imageInfo.signature, imageSha256: imageInfo.sha256,
    imageCandidateSource: imageInfo.candidateSource, fallbackReason: imageInfo.fallbackReason});
}

const realImages = posts.filter((post) => post.imageSource === "post-image").length;
const fallbackImages = posts.length - realImages;
const uniqueImages = new Set(posts.map((post) => post.imageSha256)).size;
const siteTitle = clean(feedData?.title?.$t || blogUrl.hostname);
const description = clean(feedData?.subtitle?.$t || "");
const blogData = {version: 5, capturedAt: new Date().toISOString(), url: BLOG_URL, hostname: blogUrl.hostname, siteTitle, description, pageHeading: siteTitle, ogImage: "", language: "", postCount: posts.length,
  imageStats: {realImages, fallbackImages, uniqueImages, total: posts.length}, analysis: analyzeTopics(siteTitle, description, posts), posts};
fs.writeFileSync(path.join(OUTPUT_DIR, "blog.json"), JSON.stringify(blogData, null, 2), "utf8");
console.log("\n========================================\nBLOG CAPTURE COMPLETE\n========================================");
console.log(`Site: ${siteTitle}\nPosts: ${posts.length}\nReal images: ${realImages}/${posts.length}\nFallback images: ${fallbackImages}/${posts.length}\nUnique image SHA-256: ${uniqueImages}/${posts.length}`);
for (const post of posts) console.log(`- ${post.localImage} [${post.imageSource}; ${post.imageCandidateSource}; ${post.imageSha256}]`);
