#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import {
  BLOG_URL,
  OUTPUT_DIR,
  BLOG_JSON,
  MAX_POSTS,
  MAX_FEED_ENTRIES,
} from "./blog/config.mjs";

import {
  log,
  warn,
} from "./blog/logger.mjs";

import {
  normalizeWhitespace,
} from "./blog/utils.mjs";

import {
  stripHtml,
} from "./blog/html.mjs";

import {
  fetchText,
} from "./blog/fetch.mjs";

import {
  extractFeedEntries,
} from "./blog/feed.mjs";

import {
  resolveArticleImage,
} from "./blog/resolver.mjs";

import {
  extractPageMetadata,
} from "./blog/metadata.mjs";

async function main() {
  log("");
  log(
    "===================================================="
  );
  log(
    "BLOG ANALYZER v14.1"
  );
  log(
    "===================================================="
  );
  log(
    "Exact article-specific image association"
  );
  log(
    "Nesting-aware post container extraction"
  );
  log(
    "Feed candidate fallback across up to 10 entries"
  );
  log(
    "Skip failed posts and continue until 5 verified posts"
  );
  log(
    "No site-wide image fallback"
  );
  log(
    "Real-image validation after download"
  );
  log(
    "Exact + perceptual duplicate protection"
  );
  log(
    "===================================================="
  );
  log("");

  fs.mkdirSync(
    OUTPUT_DIR,
    {
      recursive: true,
    }
  );

  /*
   * Clean previous captured images.
   */
  for (
    const filename of
      fs.readdirSync(
        OUTPUT_DIR
      )
  ) {
    if (
      /^post-\d+\.(jpg|jpeg|png|gif|webp|avif|svg|bmp)$/i.test(
        filename
      )
    ) {
      try {
        fs.unlinkSync(
          path.join(
            OUTPUT_DIR,
            filename
          )
        );
      } catch {}
    }
  }

  /*
   * ------------------------------------------------------------------------
   * Feed
   * ------------------------------------------------------------------------
   */

  const feedUrl =
    new URL(
      `/feeds/posts/default?alt=atom&max-results=${MAX_FEED_ENTRIES}`,
      BLOG_URL
    ).href;

  log(
    `Feed URL: ${feedUrl}`
  );

  let feedXml;

  try {
    feedXml =
      await fetchText(
        feedUrl,
        {
          maxRetries: 4,
        }
      );
  } catch (error) {
    throw new Error(
      `Feed fetch failed: ${error.message}`
    );
  }

  const feedEntries =
    extractFeedEntries(
      feedXml
    );

  log(
    "Feed fetched successfully."
  );

  log(
    `Feed entries: ${feedEntries.length}`
  );

  if (!feedEntries.length) {
    throw new Error(
      "No feed entries were found."
    );
  }

  /*
   * ------------------------------------------------------------------------
   * Blog homepage metadata
   *
   * Homepage metadata is allowed for site identity only.
   * It is NEVER used as a post image.
   * ------------------------------------------------------------------------
   */

  let homepageHtml = "";

  try {
    homepageHtml =
      await fetchText(
        BLOG_URL,
        {
          maxRetries: 2,
        }
      );
  } catch (error) {
    warn(
      `Homepage metadata fetch failed: ${error.message}`
    );
  }

  const pageMetadata =
    extractPageMetadata(
      homepageHtml
    );

  /*
   * ------------------------------------------------------------------------
   * Build candidate post pool
   *
   * IMPORTANT:
   * Do NOT stop at the first five feed entries.
   *
   * Some recent posts may have malformed image markup.
   * We need enough candidates to obtain exactly five
   * verified article-specific images.
   * ------------------------------------------------------------------------
   */

  const candidatePosts =
    feedEntries
      .filter(
        (entry) =>
          entry.url
      )
      .slice(
        0,
        MAX_FEED_ENTRIES
      )
      .map(
        (entry) => ({
          title:
            entry.title,

          url:
            entry.url,

          published:
            entry.published,

          date:
            entry.published
              ? entry.published.slice(
                  0,
                  10
                )
              : null,

          excerpt:
            normalizeWhitespace(
              stripHtml(
                entry.summary ||
                  entry.content ||
                  ""
              )
            ).slice(
              0,
              500
            ),

          categories:
            entry.categories ||
            [],

          feedEntry:
            entry,
        })
      )
      .sort(
        (a, b) => {
          const aTime =
            Date.parse(
              a.published || ""
            );

          const bTime =
            Date.parse(
              b.published || ""
            );

          if (
            Number.isFinite(
              aTime
            ) &&
            Number.isFinite(
              bTime
            )
          ) {
            return (
              bTime -
              aTime
            );
          }

          if (
            Number.isFinite(
              bTime
            )
          ) {
            return 1;
          }

          if (
            Number.isFinite(
              aTime
            )
          ) {
            return -1;
          }

          return 0;
        }
      );

  if (
    candidatePosts.length <
    MAX_POSTS
  ) {
    throw new Error(
      `Only ${candidatePosts.length} feed candidates available. ` +
        `At least ${MAX_POSTS} candidates are required.`
    );
  }

  log("");
  log(
    `Candidate post pool: ${candidatePosts.length}`
  );

  /*
   * ------------------------------------------------------------------------
   * Capture images
   * ------------------------------------------------------------------------
   */

  const usedHashes =
    new Set();

  const usedFingerprints =
    [];

  const capturedPosts =
    [];

  for (
    const candidate of
      candidatePosts
  ) {
    if (
      capturedPosts.length >=
      MAX_POSTS
    ) {
      break;
    }

    const captureIndex =
      capturedPosts.length +
      1;

    log("");
    log(
      "----------------------------------------------------"
    );
    log(
      `Trying candidate ${captureIndex} / ${MAX_POSTS} target`
    );
    log(
      `Feed title: ${candidate.title}`
    );
    log(
      `Feed date: ${candidate.date || "unknown"}`
    );
    log(
      "----------------------------------------------------"
    );

    try {
      const image =
        await resolveArticleImage(
          candidate,
          candidate.feedEntry,
          captureIndex,
          usedHashes,
          usedFingerprints
        );

      if (
        !image ||
        !image.localImage ||
        !image.imageUrl
      ) {
        throw new Error(
          "No verified image result returned."
        );
      }

      const allowedAssociations =
        new Set([
          "article-og",
          "article-twitter",
          "article-meta",
          "article-body",
          "feed-content",
        ]);

      if (
        !image.imageAssociation ||
        !allowedAssociations.has(
          image.imageAssociation
        )
      ) {
        throw new Error(
          `Invalid image association "${image.imageAssociation}".`
        );
      }

      capturedPosts.push({
        index:
          captureIndex,

        title:
          candidate.title,

        url:
          candidate.url,

        published:
          candidate.published,

        date:
          candidate.date,

        excerpt:
          candidate.excerpt,

        categories:
          candidate.categories,

        localImage:
          image.localImage,

        imageUrl:
          image.imageUrl,

        imageSource:
          image.imageSource,

        imageAssociation:
          image.imageAssociation,

        imageReason:
          image.imageReason,

        imageStats: {
          sha256:
            image.sha256,

          perceptualFingerprint:
            image.perceptualFingerprint,

          width:
            image.width,

          height:
            image.height,

          bytes:
            image.bytes,
        },
      });

      log("");
      log(
        `VERIFIED POST ${capturedPosts.length}/${MAX_POSTS}`
      );
      log(
        `Title: ${candidate.title}`
      );
      log(
        `Image: ${image.localImage}`
      );
      log(
        `Association: ${image.imageAssociation}`
      );
    } catch (error) {
      /*
       * IMPORTANT:
       *
       * One bad article must NOT abort the entire capture.
       * The candidate is skipped and the next feed entry
       * is tested.
       */

      warn("");
      warn(
        `SKIPPED candidate: ${candidate.title}`
      );
      warn(
        `Reason: ${error?.message || error}`
      );
      warn(
        "Continuing with the next feed entry..."
      );

      continue;
    }
  }

  /*
   * ------------------------------------------------------------------------
   * Final requirement
   * ------------------------------------------------------------------------
   */

  if (
    capturedPosts.length !==
    MAX_POSTS
  ) {
    throw new Error(
      `Unable to obtain ${MAX_POSTS} verified article-specific posts. ` +
        `Only ${capturedPosts.length} were verified from ` +
        `${candidatePosts.length} feed candidates. ` +
        `No generic fallback image will be used.`
    );
  }

  /*
   * ------------------------------------------------------------------------
   * Final validation
   * ------------------------------------------------------------------------
   */

  const localImages =
    capturedPosts.map(
      (post) =>
        post.localImage
    );

  const uniqueLocalImages =
    new Set(
      localImages
    );

  if (
    uniqueLocalImages.size !==
    capturedPosts.length
  ) {
    throw new Error(
      "Duplicate localImage references detected."
    );
  }

  const hashes =
    capturedPosts.map(
      (post) =>
        post.imageStats.sha256
    );

  if (
    new Set(hashes).size !==
    hashes.length
  ) {
    throw new Error(
      "Duplicate image SHA-256 detected."
    );
  }

  for (
    const post of
      capturedPosts
  ) {
    if (
      !post.imageAssociation
    ) {
      throw new Error(
        `Post ${post.index}: missing imageAssociation.`
      );
    }

    if (
      post.imageSource ===
        "fallback" ||
      post.imageAssociation ===
        "fallback"
    ) {
      throw new Error(
        `Post ${post.index}: forbidden fallback image detected.`
      );
    }
  }

  /*
   * ------------------------------------------------------------------------
   * Site analysis
   * ------------------------------------------------------------------------
   */

  const analysis = {
    identity:
      pageMetadata.title ||
      "Funds Up",

    topics: [
      "US stock market",
      "market news",
      "technology stocks",
      "financial markets",
    ],

    audience:
      "Investors and readers interested in financial markets and stock-market news.",

    contentStyle:
      "Concise market-news summaries focused on actionable financial information.",

    valueProposition:
      "Fast summaries of market movements, signals, and major financial developments.",
  };

  /*
   * ------------------------------------------------------------------------
   * blog.json
   * ------------------------------------------------------------------------
   */

  const output = {
    version: 5,

    capturedAt:
      new Date().toISOString(),

    url:
      BLOG_URL,

    hostname:
      new URL(
        BLOG_URL
      ).hostname,

    siteTitle:
      pageMetadata.title ||
      "Funds Up",

    description:
      pageMetadata.description ||
      "",

    pageHeading:
      pageMetadata.title ||
      "Funds Up",

    /*
     * Site metadata only.
     * NEVER used as a post image.
     */
    ogImage:
      pageMetadata.ogImage,

    language:
      pageMetadata.language ||
      "en",

    postCount:
      capturedPosts.length,

    analysis,

    posts:
      capturedPosts.map(
        (post) => ({
          index:
            post.index,

          title:
            post.title,

          url:
            post.url,

          published:
            post.published,

          date:
            post.date,

          excerpt:
            post.excerpt,

          categories:
            post.categories,

          localImage:
            post.localImage,

          imageSource:
            post.imageSource,

          imageAssociation:
            post.imageAssociation,

          imageReason:
            post.imageReason,

          imageUrl:
            post.imageUrl,

          imageStats:
            post.imageStats,
        })
      ),

    imageStats: {
      realImages:
        capturedPosts.length,

      uniqueImages:
        uniqueLocalImages.size,

      uniqueHashes:
        new Set(hashes).size,

      articleSpecific:
        capturedPosts.length,
    },
  };

  fs.mkdirSync(
    path.dirname(
      BLOG_JSON
    ),
    {
      recursive: true,
    }
  );

  fs.writeFileSync(
    BLOG_JSON,
    JSON.stringify(
      output,
      null,
      2
    ) + "\n",
    "utf8"
  );

  /*
   * ------------------------------------------------------------------------
   * Final success output
   * ------------------------------------------------------------------------
   */

  log("");
  log(
    "===================================================="
  );
  log(
    "BLOG ANALYZER v14.1 SUCCESS"
  );
  log(
    "===================================================="
  );

  for (
    const post of
      capturedPosts
  ) {
    log(
      `Post ${post.index}: ${post.title}`
    );

    log(
      `  Image: ${post.localImage}`
    );

    log(
      `  Source: ${post.imageSource}`
    );

    log(
      `  Association: ${post.imageAssociation}`
    );

    log(
      `  URL: ${post.imageUrl}`
    );
  }

  log("");
  log(
    `blog.json: ${BLOG_JSON}`
  );
  log(
    `Images: ${capturedPosts.length}`
  );
  log(
    `Unique images: ${uniqueLocalImages.size}`
  );
  log(
    `Article-specific images: ${capturedPosts.length}`
  );
  log(
    "===================================================="
  );
}

main().catch(
  (error) => {
    console.error("");
    console.error(
      "===================================================="
    );
    console.error(
      "BLOG ANALYZER v14.1 FAILED"
    );
    console.error(
      "===================================================="
    );
    console.error(
      error?.stack ||
        error?.message ||
        error
    );
    console.error(
      "===================================================="
    );

    process.exit(1);
  }
);
