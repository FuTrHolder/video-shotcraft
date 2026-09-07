import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

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

fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
fs.mkdirSync(POSTS_DIR, { recursive: true });

const clean = (value = "") =>
  String(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const unique = (items) =>
  [...new Set((items || []).filter(Boolean))];

const asArray = (value) =>
  Array.isArray(value) ? value : value ? [value] : [];

const absoluteUrl = (value) => {
  if (!value) return "";

  try {
    const url = new URL(String(value).trim(), parsedUrl.href);

    if (!["http:", "https:"].includes(url.protocol)) {
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
    .replace(/\/s\d+(?:-c)?\//i, "/s1600/")
    .replace(/=s\d+(?:-c)?(?:-[^&]*)?/i, "=s1600")
    .replace(/\/w\d+-h\d+(?:-p-k-no)?\//i, "/s1600/");
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
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
    )
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
        new RegExp(`${attr}\\s*=\\s*[\\\"']([^\\\"']+)`, "i")
      );

      if (m?.[1]) {
        candidates.push(m[1]);
      }
    }

    const srcset =
      tag.match(
        /(?:srcset|data-srcset)\s*=\s*[\"']([^\"']+)/i
      )?.[1] || "";

    if (srcset) {
      for (const item of srcset.split(",")) {
        const url = item.trim().split(/\s+/)[0];

        if (url) {
          candidates.push(url);
        }
      }
    }
  }

  return unique(
    candidates.map(normalizeBloggerImageUrl)
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
          /(?:property|name)\s*=\s*["']([^"']+)["']/i
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
        /content\s*=\s*["']([^"']+)["']/i
      )?.[1] || "";

    if (content) {
      candidates.push(content);
    }
  }

  return unique(
    candidates.map(normalizeBloggerImageUrl)
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
    throw new Error(`${response.status} ${response.statusText}`);
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
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return response.json();
};

const getEntryLink = (entry) => {
  const links = Array.isArray(entry?.link)
    ? entry.link
    : [];

  return (
    links.find((item) => item.rel === "alternate")?.href ||
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
      candidates.push(value.trim());
    }
  };

  add(entry?.media$thumbnail?.url);

  const group = entry?.media$group;

  if (group) {
    for (const item of asArray(group.media$content)) {
      add(item?.url);
    }

    for (const item of asArray(group.media$thumbnail)) {
      add(item?.url);
    }
  }

  const content = entry?.content?.$t || "";
  const summary = entry?.summary?.$t || "";

  candidates.push(
    ...htmlImageCandidates(content)
  );

  candidates.push(
    ...htmlImageCandidates(summary)
  );

  return unique(
    candidates.map(normalizeBloggerImageUrl)
  );
};

const hashBuffer = (buffer) =>
  crypto
    .createHash("sha256")
    .update(buffer)
    .digest("hex");

const extensionFor = (contentType, url) => {
  const type = String(contentType || "")
    .split(";")[0]
    .toLowerCase();

  if (type === "image/jpeg") return ".jpg";
  if (type === "image/png") return ".png";
  if (type === "image/webp") return ".webp";
  if (type === "image/gif") return ".gif";

  const ext = path
    .extname(new URL(url).pathname)
    .toLowerCase();

  return [
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".gif",
  ].includes(ext)
    ? ext
    : ".jpg";
};

const downloadUniqueImage = async (
  candidates,
  index,
  usedHashes
) => {
  for (const candidate of unique(candidates)) {
    const url = normalizeBloggerImageUrl(candidate);

    if (!url || /^data:/i.test(url)) {
      continue;
    }

    try {
      const response = await fetch(url, {
        headers: {
          "user-agent":
            "Mozilla/5.0 (compatible; BlogPromoBot/1.0)",
          accept:
            "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        },
        redirect: "follow",
      });

      if (!response.ok) {
        continue;
      }

      const contentType =
        response.headers.get("content-type") || "";

      const buffer = Buffer.from(
        await response.arrayBuffer()
      );

      if (
        !contentType
          .toLowerCase()
          .startsWith("image/") ||
        buffer.length < 5000
      ) {
        continue;
      }

      const hash = hashBuffer(buffer);

      if (usedHashes.has(hash)) {
        console.log(
          `  Duplicate image skipped: ${url}`
        );
        continue;
      }

      const ext = extensionFor(
        contentType,
        url
      );

      const filename = `post-${index + 1}${ext}`;
      const outputPath = path.join(
        POSTS_DIR,
        filename
      );

      fs.writeFileSync(
        outputPath,
        buffer
      );

      usedHashes.add(hash);

      return {
        localImage: `blog/images/${filename}`,
        imageUrl: response.url || url,
        imageSource: "feed",
        imageHash: hash,
        bytes: buffer.length,
      };
    } catch (error) {
      console.warn(
        `  Image failed: ${url} (${error.message})`
      );
    }
  }

  return null;
};

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

console.log(
  "========================================"
);
console.log("BLOG ANALYZER v4");
console.log(
  "========================================"
);
console.log(`Blog URL: ${parsedUrl.href}`);
console.log(`Output: ${OUTPUT_DIR}`);
console.log(
  "========================================"
);

let feed;
let homepageHtml = "";

try {
  const feedUrl = new URL(
    "/feeds/posts/default?alt=json&max-results=10",
    parsedUrl.origin
  ).href;

  console.log(
    `Fetching Blogger feed: ${feedUrl}`
  );

  feed = await fetchJson(feedUrl);
} catch (error) {
  console.warn(
    `Blogger JSON feed unavailable: ${error.message}`
  );
}

try {
  homepageHtml = await fetchText(
    parsedUrl.href
  );
} catch (error) {
  console.warn(
    `Homepage fetch failed: ${error.message}`
  );
}

if (!feed?.feed?.entry?.length) {
  throw new Error(
    "No Blogger feed entries found. This v4 capture currently requires a Blogger-compatible JSON feed."
  );
}

const feedInfo = feed.feed;

const entries = asArray(
  feedInfo.entry
).slice(0, 5);

const usedHashes = new Set();
const posts = [];

for (let i = 0; i < entries.length; i++) {
  const entry = entries[i];

  const content =
    entry?.content?.$t || "";

  const summary =
    entry?.summary?.$t || "";

  const title = clean(
    entry?.title?.$t || ""
  );

  const url = absoluteUrl(
    getEntryLink(entry)
  );

  const published = clean(
    entry?.published?.$t ||
      entry?.updated?.$t ||
      ""
  );

  const categories = unique(
    asArray(entry?.category).map(
      (item) =>
        clean(item?.term || "")
    )
  );

  let candidates =
    feedImageCandidates(entry);

  let imageSource = "feed";

  if (url) {
    try {
      console.log(
        `Post ${i + 1}: fetching page image metadata...`
      );

      const postHtml =
        await fetchText(url);

      const pageMeta =
        metaImageCandidates(postHtml);

      const pageImages =
        htmlImageCandidates(postHtml);

      candidates = unique([
        ...pageMeta,
        ...candidates,
        ...pageImages,
      ]);

      if (pageMeta.length) {
        imageSource = "post-og";
      } else if (pageImages.length) {
        imageSource = "post-img";
      }
    } catch (error) {
      console.warn(
        `  Post page fetch failed: ${error.message}`
      );
    }
  }

  console.log(
    `Post ${i + 1}: ${title}`
  );

  console.log(
    `  Image candidates: ${candidates.length}`
  );

  const image =
    await downloadUniqueImage(
      candidates,
      i,
      usedHashes
    );

  posts.push({
    index: i,
    title,
    url,
    published,
    date: published
      ? new Date(
          published
        ).toLocaleDateString(
          "en-US",
          {
            year: "numeric",
            month: "long",
            day: "2-digit",
            timeZone: "UTC",
          }
        )
      : "",
    excerpt: stripHtml(
      content || summary
    ).slice(0, 300),
    categories,
    localImage:
      image?.localImage || "",
    imageUrl:
      image?.imageUrl || "",
    imageSource:
      image ? imageSource : "none",
    imageHash:
      image?.imageHash || "",
    imageBytes:
      image?.bytes || 0,
  });

  if (image) {
    console.log(
      `  Real image: ${image.localImage} (${image.bytes} bytes)`
    );
  } else {
    console.warn(
      "  NO UNIQUE REAL IMAGE FOUND"
    );
  }
}

const combinedText = clean(
  [
    feedInfo.title?.$t,
    feedInfo.subtitle?.$t,
    ...posts.flatMap(
      (post) => [
        post.title,
        post.excerpt,
      ]
    ),
  ].join(" ")
);

const lowerText =
  combinedText.toLowerCase();

const topicScores = topicRules
  .map((rule) => ({
    name: rule.name,
    score: rule.keywords.reduce(
      (score, keyword) =>
        score +
        (lowerText.includes(keyword)
          ? 1
          : 0),
      0
    ),
  }))
  .sort(
    (a, b) => b.score - a.score
  );

const topics = topicScores
  .filter(
    (item) => item.score > 0
  )
  .slice(0, 3)
  .map((item) => item.name);

if (!topics.length) {
  topics.push("General Insights");
}

const hasMarketTerms =
  /stock|market|nasdaq|s&p|futures|hang seng|nikkei|trading/i.test(
    combinedText
  );

const hasQuestionTitles =
  posts.some((post) =>
    /^(what|why|how|when|where|can|should|will|is|are)\b/i.test(
      post.title
    )
  );

const audience = hasMarketTerms
  ? "Investors and market-focused readers"
  : "Readers looking for practical insights and analysis";

const contentStyle =
  hasQuestionTitles ||
  /guide|how to|what is|explained/i.test(
    combinedText
  )
    ? "Educational and explanatory"
    : "News, analysis and commentary";

const valueProposition =
  hasMarketTerms
    ? "Clear market context, timely analysis and practical insights for investors."
    : "Curated ideas and useful insights presented in an easy-to-follow format.";

const identity =
  clean(
    feedInfo.subtitle?.$t || ""
  ) || valueProposition;

const siteTitle =
  clean(
    feedInfo.title?.$t || ""
  ) || parsedUrl.hostname;

const ogImage =
  metaImageCandidates(
    homepageHtml
  )[0] || "";

const realImageCount =
  posts.filter(
    (post) =>
      post.localImage &&
      post.imageSource !== "none"
  ).length;

const uniqueImageCount =
  new Set(
    posts
      .filter(
        (post) =>
          post.imageHash
      )
      .map(
        (post) =>
          post.imageHash
      )
  ).size;

const result = {
  version: 4,
  capturedAt:
    new Date().toISOString(),
  url: parsedUrl.href,
  hostname:
    parsedUrl.hostname,
  siteTitle,
  description:
    clean(
      feedInfo.subtitle?.$t || ""
    ),
  pageHeading:
    siteTitle,
  ogImage,
  language: "en",
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
    "blog.json"
  ),
  JSON.stringify(
    result,
    null,
    2
  ),
  "utf8"
);

console.log("");
console.log(
  "========================================"
);
console.log(
  "BLOG ANALYSIS COMPLETE"
);
console.log(
  "========================================"
);
console.log(
  `Site: ${siteTitle}`
);
console.log(
  `Posts: ${posts.length}`
);
console.log(
  `Real images: ${realImageCount}/${posts.length}`
);
console.log(
  `Unique images: ${uniqueImageCount}/${realImageCount}`
);
console.log(
  `Topics: ${topics.join(", ")}`
);
console.log(
  "========================================"
);

if (posts.length < 5) {
  throw new Error(
    `Only ${posts.length} posts were captured; 5 recent posts are required for the promo.`
  );
}

if (realImageCount < posts.length) {
  throw new Error(
    `Only ${realImageCount}/${posts.length} posts have unique real images. Fix image extraction before rendering.`
  );
}

if (uniqueImageCount < realImageCount) {
  throw new Error(
    `Image uniqueness check failed: ${uniqueImageCount} unique images for ${realImageCount} real images.`
  );
}
