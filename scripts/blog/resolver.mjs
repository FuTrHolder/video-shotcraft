import { fetchText } from "./fetch.mjs";
import { log, warn } from "./logger.mjs";

import {
  dedupeCandidates,
} from "./feed.mjs";

import {
  extractArticleMetaImages,
  findExactPostRegion,
  findUnsplashAttributionCandidates,
} from "./article.mjs";

import {
  extractImageCandidatesFromHtml,
} from "./candidates.mjs";

import {
  downloadAndValidateCandidate,
} from "./image-download.mjs";

async function resolveArticleImage(
  post,
  feedEntry,
  index,
  usedHashes,
  usedFingerprints
) {
  log("");
  log(
    `Candidate Post ${index}: ${post.title}`
  );

  log(
    `URL: ${post.url}`
  );

  let articleHtml;

  try {
    articleHtml =
      await fetchText(
        post.url,
        {
          maxRetries: 3,
        }
      );

    log(
      `Article page fetched: ${articleHtml.length} bytes`
    );
  } catch (error) {
    throw new Error(
      `Unable to fetch exact article page: ${error.message}`
    );
  }

  /*
   * STEP 1
   * Exact article metadata.
   */

  const metaCandidates =
    extractArticleMetaImages(
      articleHtml
    );

  log(
    `Article-specific meta image candidates: ${metaCandidates.length}`
  );

  for (
    const candidate of
      metaCandidates
  ) {
    if (
      !candidate.association
    ) {
      candidate.association =
        candidate.source;
    }
  }

  for (
    const candidate of
      dedupeCandidates(
        metaCandidates
      )
  ) {
    const result =
      await downloadAndValidateCandidate(
        candidate,
        index,
        usedHashes,
        usedFingerprints
      );

    if (result) {
      log(
        `Selected article-specific image: ${result.imageSource}`
      );

      return result;
    }
  }

  /*
   * STEP 2
   * Exact post container.
   */

  const postRegion =
    findExactPostRegion(
      articleHtml,
      post.title
    );

  if (!postRegion) {
    warn(
      "Exact post container: NOT FOUND"
    );
  } else {
    log(
      `Exact post container: FOUND ` +
        `(tag=${postRegion.tag}, ` +
        `attrs=${postRegion.attrs || "none"}, ` +
        `length=${postRegion.html.length})`
    );
  }

  if (postRegion) {
    /*
     * STEP 3
     * Exact body images.
     */

    const bodyCandidates =
      extractImageCandidatesFromHtml(
        postRegion.html,
        {
          source:
            "post-body",
        }
      );

    for (
      const candidate of
        bodyCandidates
    ) {
      candidate.association =
        "article-body";
    }

    log(
      `Exact post-body image candidates: ${bodyCandidates.length}`
    );

    /*
     * STEP 4
     * Unsplash attribution.
     */

    const attributionCandidates =
      findUnsplashAttributionCandidates(
        postRegion.html
      );

    log(
      `Unsplash-attribution candidates: ${attributionCandidates.length}`
    );

    const combined =
      dedupeCandidates([
        ...attributionCandidates,
        ...bodyCandidates,
      ]);

    for (
      const candidate of
        combined
    ) {
      const result =
        await downloadAndValidateCandidate(
          candidate,
          index,
          usedHashes,
          usedFingerprints
        );

      if (result) {
        log(
          `Selected article-specific image: ${result.imageSource}`
        );

        return result;
      }
    }
  }

  /*
   * STEP 5
   * Exact feed-entry images.
   */

  const feedCandidates =
    feedEntry?.imageCandidates ||
    [];

  for (
    const candidate of
      feedCandidates
  ) {
    candidate.association =
      "feed-content";
  }

  log(
    `Exact feed-entry image candidates: ${feedCandidates.length}`
  );

  for (
    const candidate of
      dedupeCandidates(
        feedCandidates
      )
  ) {
    const result =
      await downloadAndValidateCandidate(
        candidate,
        index,
        usedHashes,
        usedFingerprints
      );

    if (result) {
      log(
        "Selected article-specific image: feed-content"
      );

      return result;
    }
  }

  /*
   * No generic fallback.
   */

  throw new Error(
    "No article-specific image could be verified."
  );
}

export {
  resolveArticleImage,
};
